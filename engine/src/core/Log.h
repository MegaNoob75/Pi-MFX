#pragma once

#include <string>

namespace pimfx {

enum class LogLevel { Trace = 0, Debug, Info, Warn, Error };

void logSetLevel(LogLevel level);
LogLevel logLevel();

/// Writes one line to stderr. Never call this from the realtime thread; use
/// the metrics counters or the non-realtime notification queue instead.
void logWrite(LogLevel level, const std::string& message);

void logInfo(const std::string& message);
void logWarn(const std::string& message);
void logError(const std::string& message);
void logDebug(const std::string& message);

/// Formats an errno or a negative ALSA return code as "message: reason".
std::string describeError(const std::string& message, int code);

} // namespace pimfx
