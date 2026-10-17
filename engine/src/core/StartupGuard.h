#pragma once

#include "core/Paths.h"
#include <filesystem>
#if defined(__linux__)
#include <fcntl.h>
#include <unistd.h>
#endif

namespace pimfx {
// Deliberately not cleared by a destructor: only a completed engine shutdown
// proves that automatically restoring the last preset is safe.
class StartupGuard {
public:
    explicit StartupGuard(const std::string& root)
        : root_(root), marker_(joinPath(root, "engine-running")) {}

    bool arm(bool& recovery, std::string& error) {
        std::error_code ec;
        recovery = std::filesystem::exists(marker_, ec);
        if (ec || !makeDirectories(root_)) {
            error = "Cannot inspect startup recovery marker";
            return false;
        }
#if defined(__linux__)
        // Persist both the file and directory entry before any plugin runs.
        const int fd = ::open(marker_.c_str(), O_WRONLY | O_CREAT | O_CLOEXEC, 0600);
        if (fd < 0) { error = "Cannot create startup recovery marker"; return false; }
        const bool synced = ::fsync(fd) == 0;
        ::close(fd);
        if (!synced || !syncDirectory()) {
            error = "Cannot persist startup recovery marker";
            return false;
        }
#else
        if (!writeFileAtomic(marker_, "Engine shutdown has not completed.\n")) {
            error = "Cannot write startup recovery marker";
            return false;
        }
#endif
        return true;
    }

    bool finish() {
        std::error_code ec;
        if (!std::filesystem::remove(marker_, ec) || ec) return false;
#if defined(__linux__)
        return syncDirectory();
#else
        return true;
#endif
    }

private:
#if defined(__linux__)
    bool syncDirectory() const {
        const int fd = ::open(root_.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
        if (fd < 0) return false;
        const bool synced = ::fsync(fd) == 0;
        ::close(fd);
        return synced;
    }
#endif
    std::string root_, marker_;
};
} // namespace pimfx
