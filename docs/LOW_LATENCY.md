# Low latency on the Pi 5

Latency is the product requirement, not a tuning exercise afterwards. This page
explains the choices Pi-MFX makes, exactly what `scripts/install.sh` changes on
your system, and how to find the lowest setting your hardware will hold.
Current release criteria and open lifecycle defects are in
[V1_READINESS.md](V1_READINESS.md). No new Pi measurements were taken for this
documentation review.

## The signal path

```
guitar -> interface ADC -> ALSA hw: capture -> Pi-MFX chain -> ALSA hw: playback -> DAC -> amp
```

One process, one realtime thread, no sound server. No JACK, no PipeWire, no
PulseAudio, no `plug:` device doing a hidden rate conversion. The engine reads a
period, runs the plugin chain in place, and writes a period.

Round-trip latency is dominated by:

```
period_frames x period_count / sample_rate   (each direction)
+ converter delay in the interface itself
+ whatever the plugins add internally
```

At 48 kHz, 64 frames × 3 periods is a theoretical 4 ms buffer per direction.
The driver-delay estimate is reported separately from this arithmetic. The
displayed total adds the master limiter's lookahead when enabled; it does not
measure converter delay or all latency inside plugins. Use an external
loopback measurement when establishing the complete physical round trip.

## Settings you control

Settings → System → Audio:

| Setting | Effect |
| --- | --- |
| Sample rate | 44100, 48000, 88200, 96000, ... whatever the card offers |
| Period size (frames) | The callback quantum. 32 or 64 on good hardware; 128 is safe |
| Period count | 2 is lowest, 3 is the usual compromise, 4+ for stability |
| mmap access | Skips a copy per period. On when the driver supports it |
| Start immediately | Begins playback after one period rather than a full buffer |
| Input / output channel offset | Which hardware channel the guitar is on |
| Master output protection | DC blocker, limiter ceiling/release, and lookahead; lookahead adds latency |

Gain and safety controls can update while audio runs. Device, sample-rate,
period, channel-count, and access-mode changes reopen the stream. Save the
loop first. Recording/finalization and loop file operations block unsafe
reconfiguration; the engine stops and joins the relevant workers before
replacing buffers. This implementation still needs the Pi stress checks in
the release checklist.

Some combinations your card will simply refuse; the picker greys those out from
the card's own capability list rather than letting you find out by failing.

## Reading the meters

The Performance and Settings screens show:

- **Round trip** — driver-delay estimate from both streams plus enabled
  limiter lookahead. Treat it as an engine estimate, not a physical loopback
  measurement or a complete plugin-latency report.
- **Buffer** — the theoretical figure, for comparison.
- **DSP load** — fraction of a period spent processing. Above roughly 0.7 you
  have less deadline margin; use the peak as well as the current reading.
- **Engine CPU** — process CPU across logical processors. It includes work
  outside the callback and is a different quantity from DSP deadline load.
- **Xruns** — dropouts since the last reset. **Zero is the only acceptable
  number.** A setting that produces one xrun per minute will fail on stage.

The right method: start at 48000 / 128 / 3, reset the xrun counter, play hard
for two minutes with the chain you actually use, and step down until xruns
appear. Then go back one step.

## What the installer changes

`scripts/uninstall.sh` removes Pi-MFX tuning files/services and reverses the
listed masks/kernel option. It does not record every previous OS setting;
do not assume it recreates an arbitrarily customized pre-install system.

### Realtime limits — `/etc/security/limits.d/95-pimfx-audio.conf`

`rtprio 95`, `memlock unlimited`, `nice -19` for the `audio` group. The audio
thread requests `SCHED_FIFO` at the configured priority (normally 80), and
memory locking is requested by the engine. A realtime thread
that can be preempted or paged out is the most common source of clicks on
Linux.

### CPU governor — `pimfx-governor.service`

Pins every core to `performance`. The `ondemand` governor reacts on a timescale
far longer than a 64-frame period, so the clock is still ramping when the buffer
is already late.

### `/dev/cpu_dma_latency`

When the CPU-latency guard is enabled and permission allows it, the engine
holds this open at 0 µs to request a low-latency idle policy. Verify the actual
diagnostic state rather than assuming the request succeeded.

### Sound servers masked

PipeWire, `pipewire-pulse`, WirePlumber, and PulseAudio are masked. They would
claim the card and insert a mixing server in the path. Masked rather than
stopped, because a desktop session restarts them.

### `threadirqs`

Added to the kernel command line. The sound card's interrupt handler then runs
in a thread with its own realtime priority instead of in hard IRQ context, so
it can be scheduled deliberately rather than whenever it fires.

### Swap and VM tuning — `/etc/sysctl.d/95-pimfx-audio.conf`

Swap is disabled and `vm.swappiness=1`. A dedicated audio machine has no use
for swap, and a page fault in the audio thread is an audible dropout.

### Wi-Fi power saving

Disabled on `wlan0`. Its wake-up stalls are measured in milliseconds and show
up as a stuttering UI, and on some boards as USB latency.

## Default scheduling policy

The normal installation does not add `isolcpus`. Plugin file-loading workers
and any plugin-owned DSP threads need CPU time as well as the audio callback.
Affinity or isolation can help or hurt depending on the complete setup;
compare the actual chain and worker load on the Pi before changing policy.
Pi-MFX normally:

- requests the configured audio-thread `SCHED_FIFO` priority,
- leaves all cores available to plugin workers,
- keeps hosted file-loading workers off the realtime callback. That does not
  guarantee that a heavy load cannot cause resource contention or an XRun.

Record actual scheduling/affinity and repeat a load/transition stress test if
you change them. A lower average CPU reading does not establish a safe audio
deadline.

## Hardware notes

- **The Pi 5 has no analog audio.** You need a USB interface or an I2S HAT.
- **I2S HATs** need the vendor's overlay in `/boot/firmware/config.txt` and a
  reboot. Compare measured latency and XRuns with the actual board/interface;
  connection type alone is not a latency guarantee.
- **USB interfaces** should be plugged directly into the Pi. Hubs add
  scheduling jitter. Class-compliant devices need no driver.
- **Power matters.** An underpowered supply causes throttling, and throttling
  causes xruns. Use the official 27 W supply.
- **Check for throttling** with `vcgencmd get_throttled`; anything other than
  `0x0` means the Pi is being held back.

## If you still get xruns

1. Raise period count from 2 to 3, or period size one step. Prove the rig works
   before optimising it.
2. Watch DSP load. If the peak is near 1.0 the chain is simply too heavy for
   the buffer.
3. Check `vcgencmd get_throttled` and `vcgencmd measure_temp`.
4. Confirm the tuning actually applied: Settings → Diagnostics shows the live
   governor, `threadirqs` state, and RT limits.
5. Try a different USB port, or move to an I2S HAT.
6. Confirm nothing else is competing: `systemctl list-units --state=running`.
   The Pi is meant to be dedicated to this.
