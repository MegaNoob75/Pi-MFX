# Low latency on the Pi 5

Latency is the product requirement, not a tuning exercise afterwards. This page
explains the choices Pi-MFX makes, exactly what `scripts/install.sh` changes on
your system, and how to find the lowest setting your hardware will hold.

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

At 48 kHz, 64 frames × 3 periods is 4 ms of buffering each way. The engine
reports the real figure from the driver rather than this arithmetic, because
the arithmetic ignores what the hardware adds.

## Settings you control

Settings → Audio, applied live:

| Setting | Effect |
| --- | --- |
| Sample rate | 44100, 48000, 88200, 96000, ... whatever the card offers |
| Period size (frames) | The callback quantum. 32 or 64 on good hardware; 128 is safe |
| Period count | 2 is lowest, 3 is the usual compromise, 4+ for stability |
| mmap access | Skips a copy per period. On when the driver supports it |
| Start immediately | Begins playback after one period rather than a full buffer |
| Input / output channel offset | Which hardware channel the guitar is on |

Some combinations your card will simply refuse; the picker greys those out from
the card's own capability list rather than letting you find out by failing.

## Reading the meters

The Performance and Settings screens show:

- **Round trip** — measured from `snd_pcm_delay` on both streams. This is the
  number that matters.
- **Buffer** — the theoretical figure, for comparison.
- **DSP load** — fraction of a period spent processing. Above roughly 0.7 you
  are close to the edge; the peak reading is the honest one.
- **Xruns** — dropouts since the last reset. **Zero is the only acceptable
  number.** A setting that produces one xrun per minute will fail on stage.

The right method: start at 48000 / 128 / 3, reset the xrun counter, play hard
for two minutes with the chain you actually use, and step down until xruns
appear. Then go back one step.

## What the installer changes

Every item is reverted by `scripts/uninstall.sh`.

### Realtime limits — `/etc/security/limits.d/95-pimfx-audio.conf`

`rtprio 95`, `memlock unlimited`, `nice -19` for the `audio` group. The audio
thread runs `SCHED_FIFO` at priority 80 and calls `mlockall`. A realtime thread
that can be preempted or paged out is the most common source of clicks on
Linux.

### CPU governor — `pimfx-governor.service`

Pins every core to `performance`. The `ondemand` governor reacts on a timescale
far longer than a 64-frame period, so the clock is still ramping when the buffer
is already late.

### `/dev/cpu_dma_latency`

The engine holds this open at 0 µs for its whole life, which keeps the CPU out
of deep idle states. Exit latency from a deep C-state alone can exceed a whole
period.

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

## Why there is no `isolcpus` or audio-thread pin

Isolating cores is the usual advice, and for Pi-MFX it is the wrong advice.

Neural Amp Modeler, convolution reverbs, and other heavy plugins spawn worker
threads through the LV2 worker extension and expect them to run on other cores.
`isolcpus` removes those cores from the scheduler's general pool, so the workers
end up competing for the one core the audio thread is already on. Pinning the
audio thread to a single core has the same shape of problem: it takes a core
away from those workers. The result is worse than not isolating at all.

Pi-MFX instead:

- runs the audio thread at `SCHED_FIFO` 80, above everything else,
- leaves all cores available to plugin workers,
- runs plugin workers below the audio thread so a slow load can never delay a
  period.

If you have a specific chain that measurably benefits from isolation, you can
add `isolcpus` by hand, with the warning above attached. It is not the default
because for most NAM chains it makes things worse.

## Hardware notes

- **The Pi 5 has no analog audio.** You need a USB interface or an I2S HAT.
- **I2S HATs** generally reach lower and steadier latency than USB, because
  there is no USB frame scheduling in the path. Enable the vendor's overlay in
  `/boot/firmware/config.txt` and reboot; the card then appears in the picker.
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
