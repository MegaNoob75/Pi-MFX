#include "audio/RtPriority.h"

#include "core/Log.h"
#include "core/Paths.h"

#include <cerrno>
#include <cstdint>
#include <cstring>

#if defined(__linux__)
#include <fcntl.h>
#include <pthread.h>
#include <sched.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <unistd.h>
#endif

#if defined(__SSE__) || defined(__x86_64__)
#include <xmmintrin.h>
#include <pmmintrin.h>
#endif

namespace pimfx {
namespace rt {

#if defined(__linux__)

bool lockMemory(std::string& message) {
    if (mlockall(MCL_CURRENT | MCL_FUTURE) != 0) {
        message = describeError("mlockall failed (memory not locked)", errno);
        return false;
    }
    message = "memory locked";
    return true;
}

bool setThreadRealtime(int priority, std::string& message) {
    sched_param param{};
    param.sched_priority = priority;
    const int result = pthread_setschedparam(pthread_self(), SCHED_FIFO, &param);
    if (result != 0) {
        message = describeError("SCHED_FIFO priority " + std::to_string(priority) + " refused", result);
        return false;
    }
    message = "SCHED_FIFO priority " + std::to_string(priority);
    return true;
}

bool setThreadAffinity(const std::vector<int>& cpus, std::string& message) {
    cpu_set_t set;
    CPU_ZERO(&set);
    if (cpus.empty()) {
        const long count = sysconf(_SC_NPROCESSORS_ONLN);
        for (long i = 0; i < count; ++i) {
            CPU_SET(static_cast<int>(i), &set);
        }
        message = "affinity cleared";
    } else {
        for (int cpu : cpus) {
            CPU_SET(cpu, &set);
        }
        message = "pinned to cpu " + std::to_string(cpus.front());
    }
    const int result = pthread_setaffinity_np(pthread_self(), sizeof(set), &set);
    if (result != 0) {
        message = describeError("cannot set thread affinity", result);
        return false;
    }
    return true;
}

CpuLatencyGuard::CpuLatencyGuard() {
    fd_ = ::open("/dev/cpu_dma_latency", O_WRONLY | O_CLOEXEC);
    if (fd_ < 0) {
        status_ = describeError("cpu_dma_latency unavailable", errno);
        return;
    }
    const int32_t target = 0;
    if (::write(fd_, &target, sizeof(target)) != static_cast<ssize_t>(sizeof(target))) {
        status_ = describeError("cpu_dma_latency write failed", errno);
        ::close(fd_);
        fd_ = -1;
        return;
    }
    status_ = "cpu_dma_latency held at 0us";
}

CpuLatencyGuard::~CpuLatencyGuard() {
    if (fd_ >= 0) {
        ::close(fd_);
    }
}

std::string describeSystemTuning() {
    std::string summary;

    std::string governor;
    if (readFile("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor", governor)) {
        while (!governor.empty() && (governor.back() == '\n' || governor.back() == '\r')) {
            governor.pop_back();
        }
        summary += "governor=" + governor;
    } else {
        summary += "governor=unknown";
    }

    std::string cmdline;
    if (readFile("/proc/cmdline", cmdline)) {
        summary += cmdline.find("threadirqs") != std::string::npos ? ", threadirqs=on" : ", threadirqs=off";
        if (cmdline.find("isolcpus") != std::string::npos) {
            summary += ", isolcpus=set";
        }
    }

    rlimit limit{};
    if (getrlimit(RLIMIT_RTPRIO, &limit) == 0) {
        summary += ", rtprio=" + std::to_string(limit.rlim_cur);
    }
    if (getrlimit(RLIMIT_MEMLOCK, &limit) == 0) {
        summary += limit.rlim_cur == RLIM_INFINITY ? ", memlock=unlimited" : ", memlock=limited";
    }

    return summary;
}

#else // not Linux: the development build reports honestly instead of pretending

bool lockMemory(std::string& message) {
    message = "memory locking is only available on Linux";
    return false;
}

bool setThreadRealtime(int priority, std::string& message) {
    (void)priority;
    message = "SCHED_FIFO is only available on Linux";
    return false;
}

bool setThreadAffinity(const std::vector<int>& cpus, std::string& message) {
    (void)cpus;
    message = "thread affinity is only available on Linux";
    return false;
}

CpuLatencyGuard::CpuLatencyGuard() : status_("cpu_dma_latency is only available on Linux") {}
CpuLatencyGuard::~CpuLatencyGuard() = default;

std::string describeSystemTuning() {
    return "development build; OS audio tuning not applied";
}

#endif

void disableDenormals() {
#if defined(__SSE__) || defined(__x86_64__)
    _MM_SET_FLUSH_ZERO_MODE(_MM_FLUSH_ZERO_ON);
    _MM_SET_DENORMALS_ZERO_MODE(_MM_DENORMALS_ZERO_ON);
#elif defined(__aarch64__)
    // AArch64 exposes flush-to-zero as bit 24 of FPCR.
    uint64_t fpcr = 0;
    asm volatile("mrs %0, fpcr" : "=r"(fpcr));
    fpcr |= (1ull << 24);
    asm volatile("msr fpcr, %0" : : "r"(fpcr));
#endif
}

} // namespace rt
} // namespace pimfx
