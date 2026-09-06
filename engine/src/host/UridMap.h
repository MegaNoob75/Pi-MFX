#pragma once

#include <cstdint>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace pimfx {

/// Maps URIs to the integer IDs plugins use in atom messages.
///
/// The map only ever grows, and IDs are never reused, so a plugin may cache an
/// ID for the life of the process. Mapping happens on the control thread during
/// instantiation; the audio thread only ever reads IDs it already has.
class UridMap {
public:
    uint32_t map(const std::string& uri);
    std::string unmap(uint32_t urid) const;

private:
    mutable std::mutex mutex_;
    std::unordered_map<std::string, uint32_t> ids_;
    std::vector<std::string> uris_{std::string()}; // index 0 is reserved by LV2
};

} // namespace pimfx
