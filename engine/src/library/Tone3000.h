#pragma once

#include "core/Json.h"
#include "core/Paths.h"

#include <chrono>
#include <mutex>
#include <string>

namespace pimfx {

/// Client for the TONE3000 v1 API.
///
/// Written from the published documentation at https://www.tone3000.com/api.
/// TONE3000 requires OAuth 2.0 with PKCE and issues no anonymous access, so
/// every request here is made on behalf of a signed-in user with their own
/// account. Pi-MFX ships no TONE3000 content and never redistributes any: it
/// downloads a file to the user's own Pi at the user's own request.
///
/// The publishable key (`t3k_pub_...`) is the OAuth `client_id` and is not a
/// secret. Pi-MFX never handles a secret key (`t3k_cs_...`), which TONE3000
/// documents as server-only and which has no business on a device a user owns.
class Tone3000Client {
public:
    explicit Tone3000Client(Paths paths);

    /// The publishable key the user created in TONE3000 Settings -> API Keys,
    /// and the redirect URI they registered alongside it.
    void configure(const std::string& publishableKey, const std::string& redirectUri);
    std::string publishableKey() const;

    bool available() const;   ///< false when the build has no HTTPS support
    bool connected() const;

    /// Builds the authorization URL and remembers the PKCE verifier and state.
    ///
    /// `prompt` is empty for a normal login, "select_tone" to let the user pick
    /// a tone inside TONE3000's own browser, or "load_tone" to verify access to
    /// one tone. `filters` may carry gears, format, and architecture.
    std::string beginAuthorization(const std::string& prompt, const Json& filters, std::string& error);

    /// Exchanges the authorization code for tokens. Verifies `state` against
    /// the value issued by `beginAuthorization`, which is the whole point of
    /// sending it.
    bool completeAuthorization(const std::string& code, const std::string& state, std::string& error);

    void logout();

    Json status() const;

    /// `source` is "search", "favorited", "downloaded", "trending",
    /// or "latest". Results are cached on the Pi so tabbing Trending /
    /// Downloads / gear sections does not hammer TONE3000. Pass
    /// `refresh: true` in `query` to bypass the cache. `cached` is set when
    /// the returned payload came from disk.
    Json listTones(const std::string& source, const Json& query, std::string& error,
                   bool* cached = nullptr);
    Json listUsers(const Json& query, std::string& error);
    Json tone(const std::string& toneId, std::string& error);
    Json model(const std::string& modelId, std::string& error);
    Json models(const std::string& toneId, const Json& query, std::string& error);

    /// Downloads one model file into the library. `kind` is "model" or "ir".
    /// `relativeDir` is a folder under models/ or irs/; empty means TONE3000.
    bool downloadModel(const std::string& url, const std::string& suggestedName,
                       const std::string& kind, const std::string& relativeDir,
                       std::string& storedPath, std::string& error);

private:
    struct Tokens {
        std::string accessToken;
        std::string refreshToken;
        std::chrono::system_clock::time_point expiresAt;
    };

    bool ensureAccessToken(std::string& error);
    bool exchange(const std::string& body, std::string& error);
    Json authorizedGet(const std::string& path, std::string& error);
    void loadCredentials();
    void saveCredentials();
    Json loadListCache() const;
    void saveListCache(const Json& cache) const;
    Json cachedList(const std::string& key, int64_t ttlSeconds) const;
    void rememberList(const std::string& key, const Json& payload);

    Paths paths_;
    mutable std::mutex mutex_;

    std::string publishableKey_;
    std::string redirectUri_;
    std::string pendingVerifier_;
    std::string pendingState_;

    Tokens tokens_;
    Json profile_ = Json::object();
};

} // namespace pimfx
