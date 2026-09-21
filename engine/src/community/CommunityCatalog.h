#pragma once

#include "core/Json.h"
#include "core/Paths.h"

#include <mutex>
#include <string>

namespace pimfx {

/// Read-only client for the protected public catalog. URLs are fixed in the
/// application; manifests cannot redirect the client to another host.
class CommunityCatalog {
public:
    explicit CommunityCatalog(Paths paths);

    Json status() const;
    Json index(bool refresh, std::string& error);
    Json preset(const std::string& id, bool refresh, std::string& error);

private:
    bool get(const std::string& url, std::string& body, std::string& error) const;
    Json loadCached(const std::string& path) const;
    bool saveCached(const std::string& path, const Json& json) const;

    Paths paths_;
    mutable std::mutex mutex_;
};

} // namespace pimfx
