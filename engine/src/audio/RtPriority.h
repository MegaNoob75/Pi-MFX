#pragma once

#include <string>
#include <vector>

namespace pimfx {

/// Process- and thread-level realtime setup.
///
/// These are the runtime half of the latency work; the persistent half lives in
/// `scripts/install.sh`. Everything here degrades to a warning if the
/// permission is missing, because a developer build on a normal desktop should
/// still run.
namespace rt {

/// Locks all current and future pages. A single major fault in the audio
/// thread is an audible dropout, so this is not optional on the Pi.
bool lockMemory(std::string& message);

/// Puts the calling thread on SCHED_FIFO at `priority`.
///
/// 80 is the audio thread. Plugin worker threads sit below it, and the MIDI
/// thread below those, so a busy convolution worker can never preempt the
/// thread feeding the card.
bool setThreadRealtime(int priority, std::string& message);

/// Pins the calling thread to `cpus`.
///
/// Pi-MFX does not pin the audio thread or isolate cores. NAM and convolution
/// plugins spawn worker threads, and taking cores away from the scheduler
/// starves them. Passing an empty list clears any affinity.
bool setThreadAffinity(const std::vector<int>& cpus, std::string& message);

/// Holds /dev/cpu_dma_latency open at 0 us for the lifetime of the process,
/// which stops the CPU entering deep idle states between periods. Without it,
/// wake-up latency alone can cost more than a whole 64-frame period.
class CpuLatencyGuard {
public:
    CpuLatencyGuard();
    ~CpuLatencyGuard();

    CpuLatencyGuard(const CpuLatencyGuard&) = delete;
    CpuLatencyGuard& operator=(const CpuLatencyGuard&) = delete;

    bool active() const { return fd_ >= 0; }
    const std::string& status() const { return status_; }

private:
    int fd_ = -1;
    std::string status_;
};

/// Disables denormal arithmetic for this thread where the CPU supports it.
/// A reverb tail decaying into denormals can otherwise cost several times
/// normal CPU for no audible reason.
void disableDenormals();

/// A one-line description of how the OS is currently tuned, shown in the UI's
/// diagnostics panel: governor, timer, threadirqs, RT limits.
std::string describeSystemTuning();

} // namespace rt
} // namespace pimfx
