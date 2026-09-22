#include "library/Tone3000.h"

#include "core/Crypto.h"
#include "core/Log.h"
#include "core/Paths.h"

#include <algorithm>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <limits>

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

std::string queryValue(const Json& value) {
    if (value.isBool()) {
        return value.asBool() ? "true" : std::string();
    }
    if (value.isNumber()) {
        return std::to_string(value.asInt());
    }
    return value.asString();
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
             std::string& error,
             long timeoutSeconds = 60) {
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
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, timeoutSeconds);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 15L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "Pi-MFX/" PIMFX_VERSION);
    // Empty string: send Accept-Encoding and decode gzip/deflate so a NAM is
    // never saved as compressed bytes that TooB cannot parse.
    curl_easy_setopt(curl, CURLOPT_ACCEPT_ENCODING, "");
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
    pendingRedirectUri_ = filters["redirectUri"].asString();
    if (pendingRedirectUri_.empty()) {
        pendingRedirectUri_ = redirectUri_;
    }
    if (pendingRedirectUri_.empty()) {
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
                    + "&redirect_uri=" + urlEncode(pendingRedirectUri_)
                    + "&response_type=code"
                    + "&code_challenge=" + urlEncode(challenge)
                    + "&code_challenge_method=S256"
                    + "&state=" + urlEncode(pendingState_);

    if (!prompt.empty()) {
        url += "&prompt=" + urlEncode(prompt);
    }
    for (const char* key : {"gears", "format", "architecture", "tone_id", "calibrated",
                            "menubar", "preview"}) {
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

    const std::string callbackRedirect = pendingRedirectUri_.empty() ? redirectUri_ : pendingRedirectUri_;
    const std::string body = "grant_type=authorization_code"
                             "&code=" + urlEncode(code) +
                             "&code_verifier=" + urlEncode(pendingVerifier_) +
                             "&redirect_uri=" + urlEncode(callbackRedirect) +
                             "&client_id=" + urlEncode(publishableKey_);

    pendingState_.clear();
    pendingVerifier_.clear();
    pendingRedirectUri_.clear();

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
    pendingRedirectUri_.clear();
    saveCredentials();
    // Downloaded / favorited lists belong to the signed-in user.
    removeFile(paths_.tone3000CacheFile());
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

namespace {

int64_t listCacheTtlSeconds(const std::string&) {
    // Catalog tabs stay on disk for a day so a 7" kiosk does not refetch
    // TONE3000 on every visit. REFRESH in the UI still bypasses the cache.
    return 24 * 60 * 60;
}

constexpr size_t kMaxListCacheEntries = 40;

} // namespace

Json Tone3000Client::loadListCache() const {
    std::string text;
    if (!readFile(paths_.tone3000CacheFile(), text) || text.empty()) {
        return Json::object();
    }
    std::string parseError;
    Json json = Json::parse(text, &parseError);
    if (!parseError.empty() || !json.isObject()) {
        return Json::object();
    }
    return json;
}

void Tone3000Client::saveListCache(const Json& cache) const {
    writeFileAtomic(paths_.tone3000CacheFile(), cache.dump());
}

Json Tone3000Client::cachedList(const std::string& key, int64_t ttlSeconds) const {
    const Json cache = loadListCache();
    const Json& entry = cache["entries"][key];
    if (!entry.isObject()) {
        return Json();
    }
    const int64_t fetchedAt = entry["fetchedAt"].asInt64();
    if (fetchedAt <= 0) {
        return Json();
    }
    const int64_t now = static_cast<int64_t>(std::time(nullptr));
    if (now < fetchedAt || now - fetchedAt > ttlSeconds) {
        return Json();
    }
    return entry["payload"];
}

void Tone3000Client::rememberList(const std::string& key, const Json& payload) {
    Json cache = loadListCache();
    Json entries = cache["entries"].isObject() ? cache["entries"] : Json::object();
    Json entry = Json::object();
    entry.set("fetchedAt", static_cast<int64_t>(std::time(nullptr)));
    entry.set("payload", payload);
    entries.set(key, entry);

    while (entries.members().size() > kMaxListCacheEntries) {
        std::string oldestKey;
        int64_t oldest = std::numeric_limits<int64_t>::max();
        for (const auto& member : entries.members()) {
            const int64_t fetchedAt = member.second["fetchedAt"].asInt64();
            if (fetchedAt < oldest) {
                oldest = fetchedAt;
                oldestKey = member.first;
            }
        }
        if (oldestKey.empty()) {
            break;
        }
        entries.remove(oldestKey);
    }

    cache.set("entries", entries);
    saveListCache(cache);
}

Json Tone3000Client::listTones(const std::string& source, const Json& query, std::string& error,
                               bool* cached) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (cached) {
        *cached = false;
    }

    std::string path;
    if (source == "created" || source == "favorited" || source == "downloaded"
        || source == "trending" || source == "latest") {
        path = "/tones/" + source;
    } else {
        error = "this TONE3000 API tier does not permit custom catalog search; use Browse TONE3000";
        return Json();
    }

    std::string separator = "?";
    for (const char* key : {"query", "page", "page_size", "sort", "gears", "sizes",
                            "tags", "makes", "creators", "format", "architecture", "gear",
                            "calibrated", "verified"}) {
        const std::string text = queryValue(query[key]);
        if (text.empty()) {
            continue;
        }
        path += separator + key + "=" + urlEncode(text);
        separator = "&";
    }

    const bool refresh = query["refresh"].asBool(false);
    if (!refresh) {
        Json hit = cachedList(path, listCacheTtlSeconds(source));
        if (!hit.isNull()) {
            if (cached) {
                *cached = true;
            }
            error.clear();
            return hit;
        }
    }

    Json result = authorizedGet(path, error);
    if (error.empty()) {
        rememberList(path, result);
    }
    return result;
}

Json Tone3000Client::listUsers(const Json& query, std::string& error) {
    (void)query;
    error = "creator search is not available under the TONE3000 non-commercial API tier";
    return Json();
}

Json Tone3000Client::tone(const std::string& toneId, std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (toneId.empty()) {
        error = "no tone id";
        return Json();
    }
    return authorizedGet("/tones/" + urlEncode(toneId), error);
}

Json Tone3000Client::model(const std::string& modelId, std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (modelId.empty()) {
        error = "no model id";
        return Json();
    }
    Json json = authorizedGet("/models/" + urlEncode(modelId), error);
    if (!error.empty()) {
        return json;
    }
    if (json["model_url"].asString().empty() && json["data"].isObject()) {
        return json["data"];
    }
    return json;
}

Json Tone3000Client::models(const std::string& toneId, const Json& query, std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (toneId.empty()) {
        error = "no tone id";
        return Json();
    }
    std::string path = "/models?tone_id=" + urlEncode(toneId);
    for (const char* key : {"page", "page_size", "architecture"}) {
        const std::string text = queryValue(query[key]);
        if (!text.empty()) {
            path += std::string("&") + key + "=" + urlEncode(text);
        }
    }
    return authorizedGet(path, error);
}

bool Tone3000Client::downloadModel(const std::string& url,
                                   const std::string& suggestedName,
                                   const std::string& kind,
                                   const std::string& relativeDir,
                                   std::string& storedPath,
                                   std::string& error,
                                   const std::string& expectedSha256,
                                   const Json& provenance) {
#if defined(PIMFX_HAVE_CURL)
    if (url.rfind("https://", 0) != 0) {
        error = "that download link is not an HTTPS URL";
        return false;
    }

    std::string accessToken;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!ensureAccessToken(error)) {
            return false;
        }
        accessToken = tokens_.accessToken;
    }

    std::string body;
    long status = 0;
    // TONE3000's docs say model_url downloads need the access token. Some
    // hosts are pre-signed CDNs that reject a Bearer header, so a 4xx retry
    // without it still lands the file.
    auto fetch = [&](const std::string& bearer) {
        body.clear();
        status = 0;
        error.clear();
        return request(url, "GET", std::string(), bearer, body, status, error, 300);
    };

    if (!fetch(accessToken)) {
        return false;
    }
    if (status == 400 || status == 401 || status == 403) {
        logInfo("tone3000: download HTTP " + std::to_string(status) + " with token, retrying without");
        if (!fetch(std::string())) {
            return false;
        }
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
    if (!expectedSha256.empty() && toHex(sha256(body)) != expectedSha256) {
        error = "the downloaded asset did not match its expected SHA-256 checksum";
        return false;
    }

    const SniffedFile sniffed = sniffBytes(body.data(), body.size());
    if (sniffed == SniffedFile::Html) {
        error = "TONE3000 sent a web page instead of a file (sign-in expired, or the download link died)";
        return false;
    }
    if (sniffed == SniffedFile::Gzip) {
        error = "that download is still gzip-compressed, not a NAM/IR";
        return false;
    }
    if (sniffed == SniffedFile::Zip) {
        error = "that download is a zip archive, not a NAM/IR file";
        return false;
    }
    if (sniffed == SniffedFile::Empty) {
        error = "the download was empty";
        return false;
    }

    // Amp-cab tones list NAMs and cab IRs together. Trust the bytes, not the
    // catalog label — a WAV saved as .nam is exactly "Can't load model".
    bool isIr = kind == "ir" || sniffed == SniffedFile::Impulse;
    bool isAidax = kind == "aidax" || sniffed == SniffedFile::Aidax;
    if (sniffed == SniffedFile::Nam) {
        isIr = false;
        isAidax = false;
    } else if (sniffed == SniffedFile::Impulse) {
        isAidax = false;
    } else if (sniffed == SniffedFile::Aidax) {
        isIr = false;
    }

    auto withExtension = [](std::string fileName, const char* extension) {
        const std::string lower = [&fileName]() {
            std::string out = fileName;
            std::transform(out.begin(), out.end(), out.begin(),
                           [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            return out;
        }();
        const std::string ext(extension);
        if (lower.size() >= ext.size()
            && lower.compare(lower.size() - ext.size(), ext.size(), ext) == 0) {
            return fileName;
        }
        const auto dot = fileName.find_last_of('.');
        if (dot != std::string::npos && fileName.find_first_of("/\\", dot) == std::string::npos) {
            fileName.resize(dot);
        }
        return fileName + extension;
    };

    std::string name = sanitizeFileName(suggestedName.empty() ? "tone3000-download" : suggestedName);
    if (isIr) {
        if (body.size() >= 4 && std::memcmp(body.data(), "fLaC", 4) == 0) {
            name = withExtension(name, ".flac");
        } else if (body.size() >= 4 && std::memcmp(body.data(), "FORM", 4) == 0) {
            name = withExtension(name, ".aiff");
        } else {
            name = withExtension(name, ".wav");
        }
    } else if (isAidax) {
        name = withExtension(name, ".aidax");
    } else {
        name = withExtension(name, ".nam");
    }

    if (sniffed == SniffedFile::Impulse && kind != "ir") {
        logInfo("tone3000: " + name + " is a cab IR, saving under irs/ not models/");
    }

    std::filesystem::path rel;
    for (const auto& part : std::filesystem::path(relativeDir.empty() ? "TONE3000" : relativeDir)) {
        const std::string raw = part.string();
        if (raw.empty() || raw == "." || raw == "..") {
            continue;
        }
        rel /= sanitizeFileName(raw);
    }
    if (rel.empty()) {
        rel = "TONE3000";
    }

    const std::string root = isIr ? paths_.irsDir : (isAidax ? paths_.aidaxDir : paths_.modelsDir);
    const std::string directory = joinPath(root, rel.generic_string());
    if (!makeDirectories(directory)) {
        error = "could not create that folder";
        return false;
    }

    storedPath = joinPath(directory, name);
    if (!writeFileAtomic(storedPath, body)) {
        error = "could not write the downloaded file";
        return false;
    }

    // Keep provider identity beside the library, never inside the downloaded
    // asset. This allows a later preset share to recover stable TONE3000 IDs
    // from the exact bytes without persisting temporary CDN URLs.
    const std::string digest = toHex(sha256(body));
    Json asset = Json::object();
    asset.set("provider", "tone3000");
    asset.set("sha256", digest);
    asset.set("expectedFilename", fileName(storedPath));
    asset.set("kind", isIr ? "ir" : isAidax ? "aidax" : "model");
    for (const char* key : {"toneId", "modelId", "architecture", "toneTitle",
                            "creator", "sourceLicense"}) {
        const std::string value = provenance[key].asString();
        if (!value.empty()) asset.set(key, value);
    }
    {
        // Parallel downloads may finish together. Serialize the shared
        // provenance registry update without serializing the network work.
        std::lock_guard<std::mutex> lock(mutex_);
        Json registry = Json::object();
        std::string registryText;
        std::string registryError;
        if (readFile(paths_.tone3000AssetsFile(), registryText)) {
            Json parsed = Json::parse(registryText, &registryError);
            if (registryError.empty() && parsed.isObject()) registry = parsed;
        }
        registry.set(digest, asset);
        if (!writeFileAtomic(paths_.tone3000AssetsFile(), registry.dump(2))) {
            logWarn("tone3000: could not save asset provenance");
        }
    }

    logInfo("tone3000: saved " + storedPath + " (" + sniffedFileLabel(sniffed) + ")");
    return true;
#else
    (void)url; (void)suggestedName; (void)kind; (void)relativeDir; (void)storedPath; (void)provenance;
    error = "this build has no HTTPS support";
    return false;
#endif
}

} // namespace pimfx
