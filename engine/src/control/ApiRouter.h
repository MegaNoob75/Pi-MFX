#pragma once

#include "Engine.h"
#include "control/HttpServer.h"
#include "community/CommunityCatalog.h"
#include "library/PluginStore.h"
#include "library/Tone3000.h"

#include <atomic>
#include <cstddef>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>
#include <condition_variable>
#include <deque>
#include <functional>

namespace pimfx {

/// Turns HTTP requests and WebSocket messages into engine calls.
///
/// REST and the WebSocket share one dispatcher, so `POST /api/preset/select`
/// and `{"command":"preset/select"}` do exactly the same thing and cannot
/// drift apart.
class ApiRouter {
public:
    ApiRouter(Engine& engine, Tone3000Client& tone3000, PluginStore& plugins,
              CommunityCatalog& community, HttpServer& server);
    ~ApiRouter();

    /// Wires the router into the server and starts pushing state to clients.
    void attach();
    void stop();

private:
    bool queueWork(std::function<void()> work, size_t bytes = 0);
    void workLoop();
    void reapToneDownloads();
    std::mutex workMutex_;
    std::condition_variable workWake_;
    std::deque<std::pair<std::function<void()>, size_t>> workQueue_;
    size_t queuedWorkBytes_ = 0;
    std::thread workThread_;
    bool stopping_ = false;
    bool handleRequest(const HttpRequest& request, HttpResponse& response);
    bool handleRequestNow(const HttpRequest& request, HttpResponse& response);
    void handleSocketMessage(uint64_t clientId, const std::string& message);
    void handleSocketOpen(uint64_t clientId);
    void handleSocketClose(uint64_t clientId);

    /// Runs one command. Returns the reply payload; `ok` and `error` describe
    /// the outcome.
    Json dispatch(const std::string& command, const Json& payload, bool& ok, std::string& error);
    Json dispatchCommand(const std::string& command, const Json& payload, bool& ok, std::string& error);

    Json tone3000Command(const std::string& command, const Json& payload, bool& ok, std::string& error);
    Json pluginsCommand(const std::string& command, const Json& payload, bool& ok, std::string& error);
    Json communityCommand(const std::string& command, const Json& payload, bool& ok, std::string& error);
    Json communityPlan(const Json& manifest, std::string& error) const;
    Json visibleCatalog(bool includePorts) const;
    void publishCatalog();

    Engine& engine_;
    Tone3000Client& tone3000_;
    PluginStore& plugins_;
    CommunityCatalog& community_;
    HttpServer& server_;
    std::mutex mediaMessagesMutex_;
    std::unordered_map<std::string, std::string> lastMediaMessages_;
    std::atomic<uint64_t> uiNavClient_{0};
    std::mutex uiSessionMutex_;
    Json uiSession_ = Json::object();
    std::mutex communityMutex_;
    Json pendingCommunityManifest_;
    std::string pendingCommunityToken_;
    struct ToneDownloadFile {
        std::string name;
        std::string state = "queued";
        std::string path;
        std::string error;
    };
    struct ToneDownloadJob {
        std::mutex mutex;
        std::vector<ToneDownloadFile> files;
        std::atomic<int> completed{0};
        std::atomic<bool> done{false};
        uint64_t sequence = 0;
        std::thread thread;
    };
    std::mutex toneDownloadJobsMutex_;
    std::unordered_map<std::string, std::shared_ptr<ToneDownloadJob>> toneDownloadJobs_;
    std::atomic<uint64_t> nextToneDownloadJob_{1};
};

} // namespace pimfx
