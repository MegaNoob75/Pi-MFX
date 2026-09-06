#include "library/Tone3000.h"

#include "core/Crypto.h"
#include "core/Log.h"

#include <algorithm>

#if defined(PIMFX_HAVE_CURL)
#include <curl/curl.h>
#endif

namespace pimfx {
namespace {

constexpr const char* kBase = "https://www.tone3000.com/api/v1";

std::string urlEncode(const std::string& text) {
    static const char* hex = "0123456789ABCDEF";
    std::string out;
    out.reserve(text.size());
    for (unsigned char c : text) {
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
            || c == '-' || c == '_' || c == '.' || c == '~') {
            out.push_back(static_cast<char>(c));
        } else {
            out.push_back('%');
            out.push_back(hex[c >> 4]);
            out.push_back(hex[c & 0x0F]);
        }
    }
    return out;
}

#if defined(PIMFX_HAVE_CURL)

size_t writeToString(void* data, size_t size, size_t count, void* userData) {
    const size_t total = size * count;
    static_cast<std::string*>(userData)->append(static_cast<char*>(data), total);
    return total;
}

/// One HTTPS request. `bearer` is empty for the token endpoint, which
/// authenticates with the form body rather than a header.
bool request(const std::string& url,
             const std::string& method,
             const std::string& body,
             const std::string& bearer,
             std::string& responseBody,
             long& statusCode,
             std::string& error) {
    CURL* curl = curl_easy_init();
    if (!curl) {
        error = "could not start an HTTPS request";
        return false;
    }

    curl_slist* headers = nullptr;
    if (!bearer.empty()) {
        headers = curl_slist_append(headers, ("Authorization: Bearer " + bearer).c_str());
    }
    if (method == "POST") {
        headers = curl_slist_append(headers, "Content-Type: application/x-www-form-urlencoded");
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
        curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(body.size()));
    }

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeToString);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &responseBody);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 60L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 15L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "Pi-MFX/" PIMFX_VERSION);
    // Certificate verification stays on. A guitar pedal on a hotel network is
    // exactly where you do not want to be trusting any certificate offered.
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);

    const CURLcode result = curl_easy_perform(curl);
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &statusCode);

    if (headers) {
        curl_slist_free_all(headers);
    }
    curl_easy_cleanup(curl);

    if (result != CURLE_OK) {
        error = std::string("network error: ") + curl_easy_strerror(result);
        return false;
    }
    return true;
}

#endif // PIMFX_HAVE_CURL

} // namespace

Tone3000Client::Tone3000Client(Paths paths) : paths_(std::move(paths)) {
    loadCredentials();
}

bool Tone3000Client::available() const {
#if defined(PIMFX_HAVE_CURL)
    return true;
#else
    return false;
#endif
}

void Tone3000Client::configure(const std::string& publishableKey, const std::string& redirectUri) {
    std::lock_guard<std::mutex> lock(mutex_);
    publishableKey_ = publishableKey;
    redirectUri_ = redirectUri;
    saveCredentials();
}

std::string Tone3000Client::publishableKey() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return publishableKey_;
}

bool Tone3000Client::connected() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return !tokens_.accessToken.empty();
}

void Tone3000Client::loadCredentials() {
    std::string contents;
    if (!readFile(paths_.credentialsFile(), contents)) {
        return;
    }
    std::string error;
    const Json json = Json::parse(contents, &error);
    if (!error.empty()) {
        return;
    }

    const Json& t3k = json["tone3000"];
    publishableKey_ = t3k["publishableKey"].asString();
    redirectUri_ = t3k["redirectUri"].asString();
    tokens_.accessToken = t3k["accessToken"].asString();
    tokens_.refreshToken = t3k["refreshToken"].asString();
    tokens_.expiresAt = std::chrono::system_clock::from_time_t(
        static_cast<std::time_t>(t3k["expiresAt"].asInt64(0)));
    profile_ = t3k["profile"].isObject() ? t3k["profile"] : Json::object();
}

void Tone3000Client::saveCredentials() {
    Json t3k = Json::object();
    t3k.set("publishableKey", publishableKey_);
    t3k.set("redirectUri", redirectUri_);
    t3k.set("accessToken", tokens_.accessToken);
    t3k.set("refreshToken", tokens_.refreshToken);
    t3k.set("expiresAt",
            static_cast<int64_t>(std::chrono::system_clock::to_time_t(tokens_.expiresAt)));
    t3k.set("profile", profile_);

    Json json = Json::object();
    json.set("tone3000", t3k);
    // Tokens are the user's, not ours. They stay on the Pi, in the data
    // directory the service owns, and never go near the git tree.
    writeFileAtomic(paths_.credentialsFile(), json.dump(2));
}

Json Tone3000Client::status() const {
    std::lock_guard<std::mutex> lock(mutex_);
    Json json = Json::object();
    json.set("available", available());
    json.set("configured", !publishableKey_.empty());
    json.set("connected", !tokens_.accessToken.empty());
    json.set("redirectUri", redirectUri_);
    json.set("publishableKey", publishableKey_);
    json.set("user", profile_);
    return json;
}

std::string Tone3000Client::beginAuthorization(const std::string& prompt,
                                               const Json& filters,
                                               std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!available()) {
        error = "this build has no HTTPS support, so TONE3000 is unavailable";
        return std::string();
    }
    if (publishableKey_.empty()) {
        error = "add your TONE3000 publishable key first (Settings -> API Keys on tone3000.com)";
        return std::string();
    }
    if (redirectUri_.empty()) {
        error = "set the redirect URI, and register the same value on tone3000.com";
        return std::string();
    }

    // PKCE: the verifier never leaves the Pi, and only its SHA-256 hash is
    // sent, so an intercepted authorization code is useless on its own.
    pendingVerifier_ = randomToken(48);
    pendingState_ = randomToken(16);

    const std::vector<uint8_t> digest = sha256(pendingVerifier_);
    const std::string challenge = base64UrlEncode(digest.data(), digest.size());

    std::string url = std::string(kBase) + "/oauth/authorize"
                    + "?client_id=" + urlEncode(publishableKey_)
                    + "&redirect_uri=" + urlEncode(redirectUri_)
                    + "&response_type=code"
                    + "&code_challenge=" + urlEncode(challenge)
                    + "&code_challenge_method=S256"
                    + "&state=" + urlEncode(pendingState_);

    if (!prompt.empty()) {
        url += "&prompt=" + urlEncode(prompt);
    }
    for (const char* key : {"gears", "format", "architecture", "tone_id", "calibrated"}) {
        const std::string value = filters[key].asString();
        if (!value.empty()) {
            url += std::string("&") + key + "=" + urlEncode(value);
        }
    }

    saveCredentials();
    error.clear();
    return url;
}

bool Tone3000Client::exchange(const std::string& body, std::string& error) {
#if defined(PIMFX_HAVE_CURL)
    std::string response;
    long status = 0;
    if (!request(std::string(kBase) + "/oauth/token", "POST", body, std::string(),
                 response, status, error)) {
        return false;
    }
    if (status < 200 || status >= 300) {
        error = "TONE3000 refused the sign-in (HTTP " + std::to_string(status) + ")";
        return false;
    }

    std::string parseError;
    const Json json = Json::parse(response, &parseError);
    if (!parseError.empty()) {
        error = "TONE3000 returned something unreadable";
        return false;
    }

    tokens_.accessToken = json["access_token"].asString();
    tokens_.refreshToken = json["refresh_token"].asString();
    const int64_t expiresIn = json["expires_in"].asInt64(3600);
    // Refresh a minute early rather than discovering expiry mid-download.
    tokens_.expiresAt = std::chrono::system_clock::now() + std::chrono::seconds(expiresIn - 60);

    if (tokens_.accessToken.empty()) {
        error = "TONE3000 did not return an access token";
        return false;
    }
    saveCredentials();
    return true;
#else
    (void)body;
    error = "this build has no HTTPS support";
    return false;
#endif
}

bool Tone3000Client::completeAuthorization(const std::string& code,
                                           const std::string& state,
                                           std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);

    if (pendingState_.empty() || state != pendingState_) {
        error = "the sign-in response did not match the request; start again";
        return false;
    }

    const std::string body = "grant_type=authorization_code"
                             "&code=" + urlEncode(code) +
                             "&code_verifier=" + urlEncode(pendingVerifier_) +
                             "&redirect_uri=" + urlEncode(redirectUri_) +
                             "&client_id=" + urlEncode(publishableKey_);

    pendingState_.clear();
    pendingVerifier_.clear();

    if (!exchange(body, error)) {
        return false;
    }

    std::string profileError;
    const Json profile = authorizedGet("/user", profileError);
    if (profileError.empty()) {
        profile_ = profile;
        saveCredentials();
    }
    return true;
}

void Tone3000Client::logout() {
    std::lock_guard<std::mutex> lock(mutex_);
    tokens_ = Tokens();
    profile_ = Json::object();
    pendingState_.clear();
    pendingVerifier_.clear();
    saveCredentials();
}

bool Tone3000Client::ensureAccessToken(std::string& error) {
    if (tokens_.accessToken.empty()) {
        error = "sign in to TONE3000 first";
        return false;
    }
    if (std::chrono::system_clock::now() < tokens_.expiresAt) {
        return true;
    }
    if (tokens_.refreshToken.empty()) {
        error = "your TONE3000 session expired; sign in again";
        return false;
    }

    const std::string body = "grant_type=refresh_token"
                             "&refresh_token=" + urlEncode(tokens_.refreshToken) +
                             "&client_id=" + urlEncode(publishableKey_);
    return exchange(body, error);
}

Json Tone3000Client::authorizedGet(const std::string& path, std::string& error) {
#if defined(PIMFX_HAVE_CURL)
    if (!ensureAccessToken(error)) {
        return Json();
    }

    std::string response;
    long status = 0;
    if (!request(std::string(kBase) + path, "GET", std::string(), tokens_.accessToken,
                 response, status, error)) {
        return Json();
    }
    if (status == 401) {
        error = "TONE3000 rejected the session; sign in again";
        return Json();
    }
    if (status < 200 || status >= 300) {
        error = "TONE3000 returned HTTP " + std::to_string(status);
        return Json();
    }

    std::string parseError;
    Json json = Json::parse(response, &parseError);
    if (!parseError.empty()) {
        error = "TONE3000 returned something unreadable";
        return Json();
    }
    error.clear();
    return json;
#else
    (void)path;
    error = "this build has no HTTPS support";
    return Json();
#endif
}

Json Tone3000Client::listTones(const std::string& source, const Json& query, std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);

    std::string path;
    if (source == "created" || source == "favorited" || source == "downloaded"
        || source == "trending" || source == "latest") {
        path = "/tones/" + source;
    } else {
        path = "/tones/search";
    }

    std::string separator = "?";
    for (const char* key : {"query", "page", "page_size", "sort", "gears", "sizes",
                            "tags", "makes", "creators", "format", "architecture", "gear"}) {
        const Json& value = query[key];
        std::string text = value.isNumber() ? std::to_string(value.asInt()) : value.asString();
        if (text.empty()) {
            continue;
        }
        path += separator + key + "=" + urlEncode(text);
        separator = "&";
    }

    return authorizedGet(path, error);
}

Json Tone3000Client::tone(const std::string& toneId, std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (toneId.empty()) {
        error = "no tone id";
        return Json();
    }
    return authorizedGet("/tones/" + urlEncode(toneId), error);
}

Json Tone3000Client::models(const std::string& toneId, const Json& query, std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (toneId.empty()) {
        error = "no tone id";
        return Json();
    }
    std::string path = "/models?tone_id=" + urlEncode(toneId);
    for (const char* key : {"page", "page_size", "architecture"}) {
        const Json& value = query[key];
        const std::string text = value.isNumber() ? std::to_string(value.asInt()) : value.asString();
        if (!text.empty()) {
            path += std::string("&") + key + "=" + urlEncode(text);
        }
    }
    return authorizedGet(path, error);
}

bool Tone3000Client::downloadModel(const std::string& url,
                                   const std::string& suggestedName,
                                   const std::string& kind,
                                   std::string& storedPath,
                                   std::string& error) {
#if defined(PIMFX_HAVE_CURL)
    std::lock_guard<std::mutex> lock(mutex_);

    if (url.rfind("https://", 0) != 0) {
        error = "that download link is not an HTTPS URL";
        return false;
    }

    // Model URLs from the API are already signed, so no bearer token is sent
    // to whatever storage host they point at.
    std::string body;
    long status = 0;
    if (!request(url, "GET", std::string(), std::string(), body, status, error)) {
        return false;
    }
    if (status < 200 || status >= 300) {
        error = "download failed (HTTP " + std::to_string(status) + ")";
        return false;
    }
    if (body.empty()) {
        error = "the download was empty";
        return false;
    }
    if (body.size() > 256u * 1024u * 1024u) {
        error = "that file is unreasonably large";
        return false;
    }

    const bool isModel = kind != "ir";
    std::string name = sanitizeFileName(suggestedName.empty() ? "tone3000-download" : suggestedName);
    if (name.find('.') == std::string::npos) {
        name += isModel ? ".nam" : ".wav";
    }

    const std::string directory = joinPath(isModel ? paths_.modelsDir : paths_.irsDir, "TONE3000");
    if (!makeDirectories(directory)) {
        error = "could not create the TONE3000 folder";
        return false;
    }

    storedPath = joinPath(directory, name);
    if (!writeFileAtomic(storedPath, body)) {
        error = "could not write the downloaded file";
        return false;
    }

    logInfo("tone3000: saved " + storedPath);
    return true;
#else
    (void)url; (void)suggestedName; (void)kind; (void)storedPath;
    error = "this build has no HTTPS support";
    return false;
#endif
}

} // namespace pimfx
