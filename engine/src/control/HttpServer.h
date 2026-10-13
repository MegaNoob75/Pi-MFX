#pragma once

#include "control/AccessControl.h"

#include <atomic>
#include <cstdint>
#include <deque>
#include <functional>
#include <fstream>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace pimfx {

struct HttpRequest {
    uint64_t clientId = 0;
    bool local = false; ///< Actual loopback peer, never a browser-supplied header.
    std::string method;
    std::string path;
    std::map<std::string, std::string> query;
    std::map<std::string, std::string> headers;
    std::string body;

    std::string header(const std::string& name) const;
    std::string queryValue(const std::string& name, const std::string& fallback = std::string()) const;
};

struct HttpResponse {
    bool deferred = false;
    int status = 200;
    std::string contentType = "application/json";
    std::string body;
    std::string filePath;
    uint64_t fileSize = 0;
    std::vector<std::pair<std::string, std::string>> extraHeaders;

    void json(const std::string& payload, int statusCode = 200);
    void text(const std::string& payload, int statusCode = 200);
    void error(int statusCode, const std::string& message);
};

/// The one server the UI talks to: static files, a REST API, and a WebSocket
/// for live state, all on a single port.
///
/// It runs on its own thread and is deliberately modest — a handful of browser
/// clients on a LAN. Nothing here ever touches the audio thread directly; the
/// API layer hands work across through queues.
class HttpServer {
public:
    using RequestHandler = std::function<bool(const HttpRequest&, HttpResponse&)>;
    using SocketOpenHandler = std::function<void(uint64_t clientId)>;
    using SocketMessageHandler = std::function<void(uint64_t clientId, const std::string& message)>;
    using SocketCloseHandler = std::function<void(uint64_t clientId)>;

    HttpServer();
    ~HttpServer();

    /// `webRoot` is served for anything the request handler declines. Unknown
    /// paths fall back to index.html so the single-page UI can own its routes.
    bool start(uint16_t port, const std::string& webRoot, std::string& error);
    void stop();
    bool isRunning() const { return running_.load(std::memory_order_acquire); }

    void setRequestHandler(RequestHandler handler) { requestHandler_ = std::move(handler); }
    void setAccessFile(const std::string& file) { access_.load(file); }
    void setSocketOpenHandler(SocketOpenHandler handler) { socketOpen_ = std::move(handler); }
    void setSocketMessageHandler(SocketMessageHandler handler) { socketMessage_ = std::move(handler); }
    void setSocketCloseHandler(SocketCloseHandler handler) { socketClose_ = std::move(handler); }

    /// Queues a text frame for every connected client. Safe to call from any
    /// non-realtime thread.
    void broadcast(const std::string& message);
    void sendTo(uint64_t clientId, const std::string& message);
    void completeResponse(uint64_t clientId, HttpResponse response);

    size_t clientCount() const;
    uint16_t port() const { return port_; }

private:
    struct Client {
        int fd = -1;
        uint64_t id = 0;
        bool websocket = false;
        bool local = false;
        bool trustedLocal = false;
        std::string accessToken;
        std::string inbox;
        std::string outbox;
        std::string frameBuffer;   ///< reassembles fragmented WebSocket messages
        std::ifstream responseFile; ///< bounded streaming for large downloads
        int fragmentOpcode = 0;
        bool closing = false;
        bool requestPending = false;
        std::vector<std::pair<std::string, std::string>> pendingHeaders;
    };

    void run();
    void acceptClient();
    bool serviceClient(Client& client);
    bool handleHttp(Client& client);
    bool sendHttpResponse(Client& client, HttpResponse response);
    bool handleWebSocketFrames(Client& client);
    void completeUpgrade(Client& client, const HttpRequest& request);
    void serveStatic(const HttpRequest& request, HttpResponse& response);
    void queueFrame(Client& client, const std::string& payload, int opcode);
    void flush(Client& client);
    void dropClient(size_t index);

    int listenFd_ = -1;
    uint16_t port_ = 0;
    std::string webRoot_;

    std::thread thread_;
    std::atomic<bool> running_{false};
    std::atomic<bool> stopRequested_{false};

    std::vector<Client> clients_;
    mutable std::mutex clientMutex_;
    uint64_t nextClientId_ = 1;

    struct OutgoingMessage {
        uint64_t clientId; ///< 0 means broadcast
        std::string payload;
    };
    std::deque<OutgoingMessage> pending_;
    std::mutex pendingMutex_;
    std::deque<std::pair<uint64_t, HttpResponse>> completedResponses_;

    RequestHandler requestHandler_;
    AccessControl access_;
    SocketOpenHandler socketOpen_;
    SocketMessageHandler socketMessage_;
    SocketCloseHandler socketClose_;
};

std::string urlDecode(const std::string& text);
std::string guessContentType(const std::string& path);

} // namespace pimfx
