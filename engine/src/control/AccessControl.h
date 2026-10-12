#pragma once

#include <chrono>
#include <cstdint>
#include <map>
#include <string>

namespace pimfx {
struct HttpRequest;
struct HttpResponse;

// Used only on the HTTP thread; credentials never enter engine/UI state.
class AccessControl {
public:
    void load(const std::string& file);
    bool handle(const HttpRequest& request, HttpResponse& response);
    bool authorized(const HttpRequest& request) const;
    bool sessionValid(const std::string& token, bool local) const;
    static bool trustedLocal(const HttpRequest& request);
    static std::string sessionToken(const HttpRequest& request);
private:
    bool verify(const std::string& password) const;
    bool save(const std::string& salt, const std::string& hash,
              const std::map<std::string, int64_t>& sessions) const;
    std::string file_, salt_, hash_;
    std::map<std::string, int64_t> sessions_; // Remembered token hashes; no time expiry.
    std::chrono::steady_clock::time_point nextAttempt_{};
    unsigned failures_ = 0;
    bool firstSetup_ = false;
};
} // namespace pimfx
