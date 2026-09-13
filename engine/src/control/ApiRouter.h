#pragma once

#include "Engine.h"
#include "control/HttpServer.h"
#include "library/PluginStore.h"
#include "library/Tone3000.h"

#include <atomic>
#include <memory>
#include <mutex>
#include <string>

namespace pimfx {

/// Turns HTTP requests and WebSocket messages into engine calls.
///
/// REST and the WebSocket share one dispatcher, so `POST /api/preset/select`
/// and `{"command":"preset/select"}` do exactly the same thing and cannot
/// drift apart.
class ApiRouter {
public:
    ApiRouter(Engine& engine, Tone3000Client& tone3000, PluginStore& plugins, HttpServer& server);

    /// Wires the router into the server and starts pushing state to clients.
    void attach();

private:
    bool handleRequest(const HttpRequest& request, HttpResponse& response);
    void handleSocketMessage(uint64_t clientId, const std::string& message);
    void handleSocketOpen(uint64_t clientId);
    void handleSocketClose(uint64_t clientId);

    /// Runs one command. Returns the reply payload; `ok` and `error` describe
    /// the outcome.
    Json dispatch(const std::string& command, const Json& payload, bool& ok, std::string& error);

    Json tone3000Command(const std::string& command, const Json& payload, bool& ok, std::string& error);
    Json pluginsCommand(const std::string& command, const Json& payload, bool& ok, std::string& error);
    Json visibleCatalog(bool includePorts) const;
    void publishCatalog();

    Engine& engine_;
    Tone3000Client& tone3000_;
    PluginStore& plugins_;
    HttpServer& server_;
    std::atomic<uint64_t> uiNavClient_{0};
    std::mutex uiSessionMutex_;
    Json uiSession_ = Json::object();
};

} // namespace pimfx
