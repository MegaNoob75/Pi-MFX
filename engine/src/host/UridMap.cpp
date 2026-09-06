#include "host/UridMap.h"

namespace pimfx {

uint32_t UridMap::map(const std::string& uri) {
    std::lock_guard<std::mutex> lock(mutex_);
    const auto found = ids_.find(uri);
    if (found != ids_.end()) {
        return found->second;
    }
    const uint32_t id = static_cast<uint32_t>(uris_.size());
    uris_.push_back(uri);
    ids_.emplace(uri, id);
    return id;
}

std::string UridMap::unmap(uint32_t urid) const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (urid == 0 || urid >= uris_.size()) {
        return std::string();
    }
    return uris_[urid];
}

} // namespace pimfx
