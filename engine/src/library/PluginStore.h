#pragma once

#include "core/Json.h"
#include "core/Paths.h"

#include <mutex>
#include <string>

namespace pimfx {

/// Installs and removes LV2 plugins on the Pi.
///
/// Apt and extra repos go through a root helper over a UNIX socket, because
/// the engine itself cannot gain privileges. PatchStorage downloads land in
/// the user's `/var/lib/pimfx/lv2` directory and do not need root. Pi-MFX
/// ships no plugin binaries either way.
class PluginStore {
public:
    explicit PluginStore(Paths paths);

    Json status();

    Json aptSearch(const std::string& query, std::string& error);
    Json aptList(std::string& error);
    bool aptInstall(const std::string& package, std::string& error);
    bool aptRemove(const std::string& package, std::string& error);

    Json repoList(std::string& error);
    bool repoAdd(const Json& payload, std::string& error);
    bool repoRemove(const std::string& id, std::string& error);

    Json patchstorageSearch(const Json& query, std::string& error);
    bool patchstorageInstall(int64_t patchId, std::string& error);

    Json recommended(bool fetchLatest, std::string& error);
    bool githubInstall(const std::string& id, std::string& error);

    Json installedBundles() const;
    bool bundleRemove(const std::string& directory, std::string& error);

    Json hotspotStatus(std::string& error);
    Json hotspotConfig(std::string& error);
    Json applyHotspot(const Json& payload, std::string& error);
    Json wifiScan(std::string& error);
    Json wifiConnect(const Json& payload, std::string& error);
    Json wifiDisconnect(std::string& error);

private:
    Json helperCall(const std::string& op, const Json& args, std::string& error, int timeoutSeconds);
    bool helperPing();
    bool resolvePatchstorageIds(std::string& error);
    Json loadPatchstorageCache() const;
    void savePatchstorageCache(const Json& items, bool complete);
    Json httpsGet(const std::string& url, std::string& error, int timeoutSeconds = 30);
    bool httpsDownload(const std::string& url, const std::string& destPath, std::string& error);
    bool extractArchive(const std::string& archive, const std::string& dest, std::string& error);
    Json loadRegistry() const;
    bool saveRegistry(const Json& registry) const;
    Json recommendedUnlocked(bool fetchLatest);

    Paths paths_;
    mutable std::mutex mutex_;
    int platformId_ = 0;
    int targetId_ = 0;
};

} // namespace pimfx
