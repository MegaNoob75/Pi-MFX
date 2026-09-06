#include "core/Log.h"

#include <atomic>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <mutex>

namespace pimfx {
namespace {

std::atomic<LogLevel> g_level{LogLevel::Info};
std::mutex g_mutex;

const char* levelName(LogLevel level) {
    switch (level) {
        case LogLevel::Trace: return "trace";
        case LogLevel::Debug: return "debug";
        case LogLevel::Info:  return "info";
        case LogLevel::Warn:  return "warn";
        case LogLevel::Error: return "error";
    }
    return "?";
}

} // namespace

void logSetLevel(LogLevel level) { g_level.store(level, std::memory_order_relaxed); }

LogLevel logLevel() { return g_level.load(std::memory_order_relaxed); }

void logWrite(LogLevel level, const std::string& message) {
    if (level < g_level.load(std::memory_order_relaxed)) {
        return;
    }

    char stamp[32] = "";
    const std::time_t now = std::time(nullptr);
    std::tm tm{};
#if defined(_WIN32)
    localtime_s(&tm, &now);
#else
    localtime_r(&now, &tm);
#endif
    std::strftime(stamp, sizeof(stamp), "%H:%M:%S", &tm);

    std::lock_guard<std::mutex> lock(g_mutex);
    std::fprintf(stderr, "[%s] %-5s %s\n", stamp, levelName(level), message.c_str());
    std::fflush(stderr);
}

void logInfo(const std::string& message) { logWrite(LogLevel::Info, message); }
void logWarn(const std::string& message) { logWrite(LogLevel::Warn, message); }
void logError(const std::string& message) { logWrite(LogLevel::Error, message); }
void logDebug(const std::string& message) { logWrite(LogLevel::Debug, message); }

std::string describeError(const std::string& message, int code) {
    const int err = code < 0 ? -code : code;
    return message + ": " + std::strerror(err);
}

} // namespace pimfx
