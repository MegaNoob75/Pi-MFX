#pragma once

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <sstream>
#include <string>

namespace pimfx {

struct PreloadMemory {
    static constexpr int64_t MiB = 1024 * 1024;
    int64_t total = 0, available = 0, resident = 0;
    bool valid() const { return total > 0 && available >= 0 && available <= total && resident > 0; }

    static PreloadMemory read() {
        PreloadMemory result;
#ifdef __linux__
        const auto readKb = [](const char* path, const auto& accept) {
            std::ifstream input(path);
            std::string line;
            while (std::getline(input, line)) {
                std::istringstream entry(line);
                std::string key, unit;
                int64_t value = 0;
                if (entry >> key >> value >> unit && unit == "kB" && value >= 0)
                    accept(key, value * 1024);
            }
        };
        bool foundAvailable = false;
        readKb("/proc/meminfo", [&](const std::string& key, int64_t bytes) {
            if (key == "MemTotal:") result.total = bytes;
            if (key == "MemAvailable:") { result.available = bytes; foundAvailable = true; }
        });
        readKb("/proc/self/status", [&](const std::string& key, int64_t bytes) {
            if (key == "VmRSS:") result.resident = bytes;
        });
        if (!foundAvailable) result.total = 0;
#endif
        return result;
    }

    // A ceiling, never a reservation. Leave room for media, the desktop, and
    // foreground preset loads even on smaller Pis. Do not count swap as RAM.
    int64_t reserve() const { return std::max<int64_t>(512 * MiB, total / 5); }
    int64_t budget() const {
        return valid() ? std::max<int64_t>(0, std::min(total / 2, available - reserve())) : 0;
    }
    bool canLoad(int64_t used, int64_t estimate, int64_t ceiling) const {
        return valid() && used >= 0 && estimate > 0 && used <= ceiling
            && estimate <= ceiling - used && available >= reserve() + estimate;
    }
};

} // namespace pimfx
