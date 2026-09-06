#include "control/HttpServer.h"

#include "core/Crypto.h"
#include "core/Log.h"
#include "core/Paths.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <cstring>

#if defined(_WIN32)
#include <winsock2.h>
#include <ws2tcpip.h>
using SocketHandle = SOCKET;
#define PIMFX_INVALID_SOCKET INVALID_SOCKET
#define pimfx_close closesocket
#define pimfx_poll WSAPoll
#else
#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>
using SocketHandle = int;
#define PIMFX_INVALID_SOCKET (-1)
#define pimfx_close ::close
#define pimfx_poll ::poll
#endif

namespace pimfx {
namespace {

constexpr const char* kWebSocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
constexpr size_t kMaxRequestBytes = 8 * 1024 * 1024; // generous, for theme imports

std::string trim(const std::string& text) {
    size_t start = 0;
    size_t end = text.size();
    while (start < end && (text[start] == ' ' || text[start] == '\t')) {
        ++start;
    }
    while (end > start && (text[end - 1] == ' ' || text[end - 1] == '\t'
                           || text[end - 1] == '\r' || text[end - 1] == '\n')) {
        --end;
    }
    return text.substr(start, end - start);
}

std::string toLower(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

const char* statusText(int status) {
    switch (status) {
        case 200: return "OK";
        case 201: return "Created";
        case 204: return "No Content";
        case 304: return "Not Modified";
        case 400: return "Bad Request";
        case 401: return "Unauthorized";
        case 403: return "Forbidden";
        case 404: return "Not Found";
        case 409: return "Conflict";
        case 413: return "Payload Too Large";
        case 500: return "Internal Server Error";
        case 503: return "Service Unavailable";
        default: return "OK";
    }
}

void setNonBlocking(SocketHandle fd) {
#if defined(_WIN32)
    u_long mode = 1;
    ioctlsocket(fd, FIONBIO, &mode);
#else
    const int flags = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, flags | O_NONBLOCK);
#endif
}

} // namespace

std::string urlDecode(const std::string& text) {
    std::string out;
    out.reserve(text.size());
    for (size_t i = 0; i < text.size(); ++i) {
        if (text[i] == '+') {
            out.push_back(' ');
        } else if (text[i] == '%' && i + 2 < text.size()) {
            const std::string hex = text.substr(i + 1, 2);
            out.push_back(static_cast<char>(std::strtol(hex.c_str(), nullptr, 16)));
            i += 2;
        } else {
            out.push_back(text[i]);
        }
    }
    return out;
}

std::string guessContentType(const std::string& path) {
    const size_t dot = path.find_last_of('.');
    if (dot == std::string::npos) {
        return "application/octet-stream";
    }
    const std::string extension = toLower(path.substr(dot));
    if (extension == ".html") return "text/html; charset=utf-8";
    if (extension == ".js" || extension == ".mjs") return "text/javascript; charset=utf-8";
    if (extension == ".css") return "text/css; charset=utf-8";
    if (extension == ".json") return "application/json";
    if (extension == ".svg") return "image/svg+xml";
    if (extension == ".png") return "image/png";
    if (extension == ".jpg" || extension == ".jpeg") return "image/jpeg";
    if (extension == ".webp") return "image/webp";
    if (extension == ".ico") return "image/x-icon";
    if (extension == ".woff2") return "font/woff2";
    if (extension == ".woff") return "font/woff";
    if (extension == ".txt" || extension == ".md") return "text/plain; charset=utf-8";
    if (extension == ".wav") return "audio/wav";
    return "application/octet-stream";
}

std::string HttpRequest::header(const std::string& name) const {
    const auto found = headers.find(toLower(name));
    return found == headers.end() ? std::string() : found->second;
}

std::string HttpRequest::queryValue(const std::string& name, const std::string& fallback) const {
    const auto found = query.find(name);
    return found == query.end() ? fallback : found->second;
}

void HttpResponse::json(const std::string& payload, int statusCode) {
    status = statusCode;
    contentType = "application/json";
    body = payload;
}

void HttpResponse::text(const std::string& payload, int statusCode) {
    status = statusCode;
    contentType = "text/plain; charset=utf-8";
    body = payload;
}

void HttpResponse::error(int statusCode, const std::string& message) {
    status = statusCode;
    contentType = "application/json";
    body = std::string("{\"ok\":false,\"error\":") + jsonQuote(message) + "}";
}

HttpServer::HttpServer() {
#if defined(_WIN32)
    WSADATA data;
    WSAStartup(MAKEWORD(2, 2), &data);
#endif
}

HttpServer::~HttpServer() {
    stop();
#if defined(_WIN32)
    WSACleanup();
#endif
}

bool HttpServer::start(uint16_t port, const std::string& webRoot, std::string& error) {
    stop();

    webRoot_ = webRoot;
    port_ = port;

    const SocketHandle listenFd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (listenFd == PIMFX_INVALID_SOCKET) {
        error = "cannot create a listening socket";
        return false;
    }

    int reuse = 1;
    ::setsockopt(listenFd, SOL_SOCKET, SO_REUSEADDR,
                 reinterpret_cast<const char*>(&reuse), sizeof(reuse));

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_ANY);
    address.sin_port = htons(port);

    if (::bind(listenFd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0) {
        pimfx_close(listenFd);
        error = "port " + std::to_string(port) + " is already in use";
        return false;
    }
    if (::listen(listenFd, 16) != 0) {
        pimfx_close(listenFd);
        error = "cannot listen on port " + std::to_string(port);
        return false;
    }

    setNonBlocking(listenFd);
    listenFd_ = static_cast<int>(listenFd);

    stopRequested_.store(false, std::memory_order_release);
    running_.store(true, std::memory_order_release);
    thread_ = std::thread(&HttpServer::run, this);

    logInfo("web: listening on port " + std::to_string(port) + ", serving " + webRoot);
    return true;
}

void HttpServer::stop() {
    if (!thread_.joinable()) {
        running_.store(false, std::memory_order_release);
        return;
    }
    stopRequested_.store(true, std::memory_order_release);
    thread_.join();
    running_.store(false, std::memory_order_release);

    std::lock_guard<std::mutex> lock(clientMutex_);
    for (Client& client : clients_) {
        pimfx_close(static_cast<SocketHandle>(client.fd));
    }
    clients_.clear();
    if (listenFd_ >= 0) {
        pimfx_close(static_cast<SocketHandle>(listenFd_));
        listenFd_ = -1;
    }
}

size_t HttpServer::clientCount() const {
    std::lock_guard<std::mutex> lock(clientMutex_);
    return std::count_if(clients_.begin(), clients_.end(),
                         [](const Client& client) { return client.websocket; });
}

void HttpServer::broadcast(const std::string& message) {
    std::lock_guard<std::mutex> lock(pendingMutex_);
    // Drop the oldest updates rather than growing without bound if a client
    // stalls. State messages are snapshots, so a missed one is harmless.
    if (pending_.size() > 512) {
        pending_.pop_front();
    }
    pending_.push_back({0, message});
}

void HttpServer::sendTo(uint64_t clientId, const std::string& message) {
    std::lock_guard<std::mutex> lock(pendingMutex_);
    pending_.push_back({clientId, message});
}

void HttpServer::run() {
    std::vector<pollfd> descriptors;

    while (!stopRequested_.load(std::memory_order_acquire)) {
        {
            std::lock_guard<std::mutex> lock(pendingMutex_);
            std::lock_guard<std::mutex> clientLock(clientMutex_);
            while (!pending_.empty()) {
                const OutgoingMessage message = std::move(pending_.front());
                pending_.pop_front();
                for (Client& client : clients_) {
                    if (!client.websocket || client.closing) {
                        continue;
                    }
                    if (message.clientId == 0 || message.clientId == client.id) {
                        queueFrame(client, message.payload, 0x1);
                    }
                }
            }
        }

        descriptors.clear();
        descriptors.push_back({static_cast<SocketHandle>(listenFd_), POLLIN, 0});
        {
            std::lock_guard<std::mutex> lock(clientMutex_);
            for (const Client& client : clients_) {
                short events = POLLIN;
                if (!client.outbox.empty()) {
                    events |= POLLOUT;
                }
                descriptors.push_back({static_cast<SocketHandle>(client.fd), events, 0});
            }
        }

        const int ready = pimfx_poll(descriptors.data(),
                                     static_cast<unsigned>(descriptors.size()),
                                     20);
        if (ready < 0) {
            continue;
        }

        if (descriptors[0].revents & POLLIN) {
            acceptClient();
        }

        std::vector<size_t> doomed;
        {
            std::lock_guard<std::mutex> lock(clientMutex_);
            for (size_t i = 0; i < clients_.size() && i + 1 < descriptors.size(); ++i) {
                const short revents = descriptors[i + 1].revents;
                Client& client = clients_[i];

                if (revents & (POLLHUP | POLLERR | POLLNVAL)) {
                    doomed.push_back(i);
                    continue;
                }
                if ((revents & POLLOUT) && !client.outbox.empty()) {
                    flush(client);
                }
                if (revents & POLLIN) {
                    if (!serviceClient(client)) {
                        doomed.push_back(i);
                        continue;
                    }
                }
                if (client.closing && client.outbox.empty()) {
                    doomed.push_back(i);
                }
            }

            for (auto it = doomed.rbegin(); it != doomed.rend(); ++it) {
                dropClient(*it);
            }
        }
    }
}

void HttpServer::acceptClient() {
    while (true) {
        sockaddr_in address{};
#if defined(_WIN32)
        int length = sizeof(address);
#else
        socklen_t length = sizeof(address);
#endif
        const SocketHandle fd = ::accept(static_cast<SocketHandle>(listenFd_),
                                         reinterpret_cast<sockaddr*>(&address), &length);
        if (fd == PIMFX_INVALID_SOCKET) {
            return;
        }
        setNonBlocking(fd);

        // Nagle would hold back small control messages waiting for more data,
        // which is exactly the wrong trade for a footswitch press.
        int nodelay = 1;
        ::setsockopt(fd, IPPROTO_TCP, TCP_NODELAY,
                     reinterpret_cast<const char*>(&nodelay), sizeof(nodelay));

        Client client;
        client.fd = static_cast<int>(fd);
        client.id = nextClientId_++;

        std::lock_guard<std::mutex> lock(clientMutex_);
        if (clients_.size() >= 32) {
            pimfx_close(fd);
            return;
        }
        clients_.push_back(std::move(client));
    }
}

void HttpServer::dropClient(size_t index) {
    if (index >= clients_.size()) {
        return;
    }
    Client& client = clients_[index];
    if (client.websocket && socketClose_) {
        socketClose_(client.id);
    }
    pimfx_close(static_cast<SocketHandle>(client.fd));
    clients_.erase(clients_.begin() + static_cast<long>(index));
}

bool HttpServer::serviceClient(Client& client) {
    char buffer[16384];
    while (true) {
        const int received = static_cast<int>(::recv(static_cast<SocketHandle>(client.fd),
                                                     buffer, sizeof(buffer), 0));
        if (received > 0) {
            client.inbox.append(buffer, static_cast<size_t>(received));
            if (client.inbox.size() > kMaxRequestBytes) {
                return false;
            }
            continue;
        }
        if (received == 0) {
            return false; // peer closed
        }
        break; // would block
    }

    return client.websocket ? handleWebSocketFrames(client) : handleHttp(client);
}

bool HttpServer::handleHttp(Client& client) {
    while (true) {
        const size_t headerEnd = client.inbox.find("\r\n\r\n");
        if (headerEnd == std::string::npos) {
            return true; // wait for the rest
        }

        const std::string head = client.inbox.substr(0, headerEnd);
        size_t lineStart = head.find("\r\n");
        const std::string requestLine = head.substr(0, lineStart == std::string::npos ? head.size() : lineStart);

        HttpRequest request;
        {
            const size_t firstSpace = requestLine.find(' ');
            const size_t secondSpace = requestLine.find(' ', firstSpace + 1);
            if (firstSpace == std::string::npos || secondSpace == std::string::npos) {
                return false;
            }
            request.method = requestLine.substr(0, firstSpace);
            std::string target = requestLine.substr(firstSpace + 1, secondSpace - firstSpace - 1);

            const size_t questionMark = target.find('?');
            if (questionMark != std::string::npos) {
                const std::string queryString = target.substr(questionMark + 1);
                target = target.substr(0, questionMark);
                size_t cursor = 0;
                while (cursor < queryString.size()) {
                    const size_t ampersand = queryString.find('&', cursor);
                    const std::string pair = queryString.substr(
                        cursor, ampersand == std::string::npos ? std::string::npos : ampersand - cursor);
                    const size_t equals = pair.find('=');
                    if (equals != std::string::npos) {
                        request.query[urlDecode(pair.substr(0, equals))] =
                            urlDecode(pair.substr(equals + 1));
                    } else if (!pair.empty()) {
                        request.query[urlDecode(pair)] = "";
                    }
                    if (ampersand == std::string::npos) {
                        break;
                    }
                    cursor = ampersand + 1;
                }
            }
            request.path = urlDecode(target);
        }

        while (lineStart != std::string::npos) {
            const size_t next = head.find("\r\n", lineStart + 2);
            const std::string line = head.substr(
                lineStart + 2,
                next == std::string::npos ? std::string::npos : next - lineStart - 2);
            const size_t colon = line.find(':');
            if (colon != std::string::npos) {
                request.headers[toLower(trim(line.substr(0, colon)))] = trim(line.substr(colon + 1));
            }
            lineStart = next;
        }

        size_t bodyLength = 0;
        const std::string contentLength = request.header("content-length");
        if (!contentLength.empty()) {
            bodyLength = static_cast<size_t>(std::strtoul(contentLength.c_str(), nullptr, 10));
        }
        const size_t total = headerEnd + 4 + bodyLength;
        if (client.inbox.size() < total) {
            return true; // body still arriving
        }
        request.body = client.inbox.substr(headerEnd + 4, bodyLength);
        client.inbox.erase(0, total);

        if (toLower(request.header("upgrade")) == "websocket") {
            completeUpgrade(client, request);
            return true;
        }

        HttpResponse response;
        bool handled = false;
        if (requestHandler_) {
            handled = requestHandler_(request, response);
        }
        if (!handled) {
            serveStatic(request, response);
        }

        std::string out = "HTTP/1.1 " + std::to_string(response.status) + " "
                        + statusText(response.status) + "\r\n";
        out += "Content-Type: " + response.contentType + "\r\n";
        out += "Content-Length: " + std::to_string(response.body.size()) + "\r\n";
        out += "Connection: keep-alive\r\n";
        // The UI is served from the same origin, so no cross-origin access is
        // granted. State changes go through the API, and the API is only
        // reachable from this origin.
        out += "X-Content-Type-Options: nosniff\r\n";
        for (const auto& header : response.extraHeaders) {
            out += header.first + ": " + header.second + "\r\n";
        }
        out += "\r\n";
        out += response.body;

        client.outbox += out;
        flush(client);
    }
}

void HttpServer::completeUpgrade(Client& client, const HttpRequest& request) {
    const std::string key = request.header("sec-websocket-key");
    if (key.empty()) {
        client.closing = true;
        return;
    }

    const std::vector<uint8_t> digest = sha1(key + kWebSocketGuid);
    const std::string accept = base64Encode(digest.data(), digest.size());

    std::string response = "HTTP/1.1 101 Switching Protocols\r\n";
    response += "Upgrade: websocket\r\n";
    response += "Connection: Upgrade\r\n";
    response += "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";

    client.outbox += response;
    client.websocket = true;
    flush(client);

    if (socketOpen_) {
        socketOpen_(client.id);
    }
}

bool HttpServer::handleWebSocketFrames(Client& client) {
    while (client.inbox.size() >= 2) {
        const uint8_t* data = reinterpret_cast<const uint8_t*>(client.inbox.data());
        const bool fin = (data[0] & 0x80) != 0;
        const int opcode = data[0] & 0x0F;
        const bool masked = (data[1] & 0x80) != 0;
        uint64_t payloadLength = data[1] & 0x7F;
        size_t offset = 2;

        if (payloadLength == 126) {
            if (client.inbox.size() < 4) {
                return true;
            }
            payloadLength = (static_cast<uint64_t>(data[2]) << 8) | data[3];
            offset = 4;
        } else if (payloadLength == 127) {
            if (client.inbox.size() < 10) {
                return true;
            }
            payloadLength = 0;
            for (int i = 0; i < 8; ++i) {
                payloadLength = (payloadLength << 8) | data[2 + i];
            }
            offset = 10;
        }

        if (payloadLength > kMaxRequestBytes) {
            return false;
        }

        uint8_t mask[4] = {0, 0, 0, 0};
        if (masked) {
            if (client.inbox.size() < offset + 4) {
                return true;
            }
            std::memcpy(mask, data + offset, 4);
            offset += 4;
        }

        if (client.inbox.size() < offset + payloadLength) {
            return true; // frame still arriving
        }

        std::string payload = client.inbox.substr(offset, static_cast<size_t>(payloadLength));
        if (masked) {
            for (size_t i = 0; i < payload.size(); ++i) {
                payload[i] = static_cast<char>(static_cast<uint8_t>(payload[i]) ^ mask[i % 4]);
            }
        }
        client.inbox.erase(0, offset + static_cast<size_t>(payloadLength));

        switch (opcode) {
            case 0x0: // continuation
                client.frameBuffer += payload;
                break;
            case 0x1: // text
            case 0x2: // binary
                client.frameBuffer = payload;
                client.fragmentOpcode = opcode;
                break;
            case 0x8: // close
                queueFrame(client, std::string(), 0x8);
                client.closing = true;
                return true;
            case 0x9: // ping
                queueFrame(client, payload, 0xA);
                continue;
            case 0xA: // pong
                continue;
            default:
                return false;
        }

        if (fin && (opcode == 0x0 || opcode == 0x1 || opcode == 0x2)) {
            if (socketMessage_ && client.fragmentOpcode == 0x1) {
                socketMessage_(client.id, client.frameBuffer);
            }
            client.frameBuffer.clear();
        }
    }
    return true;
}

void HttpServer::queueFrame(Client& client, const std::string& payload, int opcode) {
    std::string frame;
    frame.push_back(static_cast<char>(0x80 | opcode));

    // Server frames are never masked, per RFC 6455.
    if (payload.size() < 126) {
        frame.push_back(static_cast<char>(payload.size()));
    } else if (payload.size() <= 0xFFFF) {
        frame.push_back(static_cast<char>(126));
        frame.push_back(static_cast<char>((payload.size() >> 8) & 0xFF));
        frame.push_back(static_cast<char>(payload.size() & 0xFF));
    } else {
        frame.push_back(static_cast<char>(127));
        for (int i = 7; i >= 0; --i) {
            frame.push_back(static_cast<char>((payload.size() >> (i * 8)) & 0xFF));
        }
    }
    frame += payload;

    // A client that stops reading must not be allowed to grow the outbox
    // forever; dropping it is better than exhausting memory on the Pi.
    if (client.outbox.size() + frame.size() > 4 * 1024 * 1024) {
        client.closing = true;
        return;
    }
    client.outbox += frame;
}

void HttpServer::flush(Client& client) {
    while (!client.outbox.empty()) {
        const int sent = static_cast<int>(::send(static_cast<SocketHandle>(client.fd),
                                                 client.outbox.data(),
#if defined(_WIN32)
                                                 static_cast<int>(client.outbox.size()),
#else
                                                 client.outbox.size(),
#endif
                                                 0));
        if (sent <= 0) {
            return; // would block; POLLOUT will bring us back
        }
        client.outbox.erase(0, static_cast<size_t>(sent));
    }
}

void HttpServer::serveStatic(const HttpRequest& request, HttpResponse& response) {
    if (request.method != "GET" && request.method != "HEAD") {
        response.error(404, "not found");
        return;
    }

    std::string relative = request.path;
    if (relative.empty() || relative == "/") {
        relative = "/index.html";
    }

    // Anything that could climb out of the web root is refused outright rather
    // than normalised, because normalising is where these bugs live.
    if (relative.find("..") != std::string::npos || relative.find('\\') != std::string::npos) {
        response.error(403, "forbidden");
        return;
    }

    std::string path = joinPath(webRoot_, relative.substr(1));
    std::string contents;
    if (!readFile(path, contents)) {
        // Unknown paths fall back to the app shell so the UI owns its routes.
        if (relative.find('.') == std::string::npos) {
            path = joinPath(webRoot_, "index.html");
            if (readFile(path, contents)) {
                response.status = 200;
                response.contentType = "text/html; charset=utf-8";
                response.body = std::move(contents);
                return;
            }
        }
        response.error(404, "not found");
        return;
    }

    response.status = 200;
    response.contentType = guessContentType(path);
    response.body = std::move(contents);

    // Hashed asset names make long caching safe; index.html must not be cached
    // or an upgrade would never be picked up.
    if (relative.rfind("/assets/", 0) == 0) {
        response.extraHeaders.emplace_back("Cache-Control", "public, max-age=31536000, immutable");
    } else {
        response.extraHeaders.emplace_back("Cache-Control", "no-cache");
    }
}

} // namespace pimfx
