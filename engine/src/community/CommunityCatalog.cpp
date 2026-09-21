#include "community/CommunityCatalog.h"

#include "community/CommunityPresetPackage.h"
#include "core/Log.h"

#include <algorithm>
#include <cctype>

#if defined(PIMFX_HAVE_CURL)
#include <curl/curl.h>
#endif

namespace pimfx {
namespace {

constexpr const char* kCatalogIndex =
    "https://raw.githubusercontent.com/MegaNoob75/Pi-MFX-Community-Presets/main/catalog/index.json";
constexpr const char* kCatalogRaw =
    "https://raw.githubusercontent.com/MegaNoob75/Pi-MFX-Community-Presets/main/";

bool safeCatalogId(const std::string& id) {
    if (id.empty() || id.size() > 64) return false;
    return std::all_of(id.begin(), id.end(), [](unsigned char c) {
        return std::isalnum(c) || c == '-' || c == '_';
    });
}

#if defined(PIMFX_HAVE_CURL)
size_t writeBody(char* data, size_t size, size_t count, void* target) {
    const size_t bytes = size * count;
    auto* body = static_cast<std::string*>(target);
    if (body->size() + bytes > 2u * 1024u * 1024u) return 0;
    body->append(data, bytes);
    return bytes;
}
#endif

} // namespace

CommunityCatalog::CommunityCatalog(Paths paths) : paths_(std::move(paths)) {}

Json CommunityCatalog::status() const {
    Json out = Json::object();
#if defined(PIMFX_HAVE_CURL)
    out.set("available", true);
#else
    out.set("available", false);
#endif
    out.set("featureEnabled", true);
    out.set("submissionAvailable", true);
    out.set("submissionMessage", "Download the safe manifest, then attach it to the GitHub review form.");
    out.set("submissionUrl", "https://github.com/MegaNoob75/Pi-MFX-Community-Presets/issues/new?template=community-preset-submission.yml");
    out.set("submissionMethod", "github-review");
    out.set("catalogRepository", "MegaNoob75/Pi-MFX-Community-Presets");
    return out;
}

bool CommunityCatalog::get(const std::string& url, std::string& body, std::string& error) const {
#if defined(PIMFX_HAVE_CURL)
    if (url != kCatalogIndex && url.rfind(kCatalogRaw, 0) != 0) {
        error = "refused a non-catalog URL";
        return false;
    }
    CURL* curl = curl_easy_init();
    if (!curl) { error = "could not initialize HTTPS"; return false; }
    body.clear();
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeBody);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &body);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 3L);
    curl_easy_setopt(curl, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
    curl_easy_setopt(curl, CURLOPT_REDIR_PROTOCOLS, CURLPROTO_HTTPS);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 10L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "Pi-MFX community catalog");
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);
    const CURLcode result = curl_easy_perform(curl);
    long statusCode = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &statusCode);
    curl_easy_cleanup(curl);
    if (result != CURLE_OK) {
        error = std::string("catalog network error: ") + curl_easy_strerror(result);
        return false;
    }
    if (statusCode < 200 || statusCode >= 300) {
        error = "catalog request failed (HTTP " + std::to_string(statusCode) + ")";
        return false;
    }
    return true;
#else
    (void)url; (void)body;
    error = "this build has no HTTPS support";
    return false;
#endif
}

Json CommunityCatalog::loadCached(const std::string& path) const {
    std::string body;
    if (!readFile(path, body)) return Json();
    std::string parseError;
    Json json = Json::parse(body, &parseError);
    return parseError.empty() ? json : Json();
}

bool CommunityCatalog::saveCached(const std::string& path, const Json& json) const {
    return writeFileAtomic(path, json.dump(2));
}

Json CommunityCatalog::index(bool refresh, std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    const std::string cache = joinPath(paths_.communityDir, "catalog-index-v2.json");
    if (!refresh) {
        Json saved = loadCached(cache);
        if (saved["format"].asString() == "pimfx-community-catalog") return saved;
    }
    std::string body;
    if (!get(kCatalogIndex, body, error)) {
        Json saved = loadCached(cache);
        if (saved["format"].asString() == "pimfx-community-catalog") {
            saved.set("cached", true);
            saved.set("refreshError", error);
            error.clear();
            return saved;
        }
        return Json::object();
    }
    std::string parseError;
    Json json = Json::parse(body, &parseError);
    if (!parseError.empty() || json["format"].asString() != "pimfx-community-catalog"
        || json["formatVersion"].asInt() != 2 || !json["presets"].isArray()) {
        error = "the public catalog index is invalid";
        return Json::object();
    }
    saveCached(cache, json);
    return json;
}

Json CommunityCatalog::preset(const std::string& id, bool refresh, std::string& error) {
    if (!safeCatalogId(id)) { error = "invalid catalog preset ID"; return Json::object(); }
    Json catalog = index(refresh, error);
    if (!error.empty() && !catalog["presets"].isArray()) return Json::object();
    error.clear();
    std::string manifestPath;
    std::string expectedChecksum;
    for (const Json& item : catalog["presets"].items()) {
        if (item["id"].asString() == id) {
            manifestPath = item["manifestPath"].asString("presets/" + id + "/manifest.json");
            expectedChecksum = item["manifestSha256"].asString();
            break;
        }
    }
    if (manifestPath != "presets/" + id + "/manifest.json" || expectedChecksum.size() != 64) {
        error = "the catalog entry has an unsafe path or no manifest checksum";
        return Json::object();
    }
    const std::string cache = joinPath(paths_.communityDir, "v2-" + id + ".json");
    std::string body;
    if (!refresh) {
        Json saved = loadCached(cache);
        std::string validationError;
        if (CommunityPresetPackage::validate(saved, validationError)
            && CommunityPresetPackage::checksum(saved) == expectedChecksum) return saved;
    }
    if (!get(std::string(kCatalogRaw) + manifestPath, body, error)) return Json::object();
    std::string parseError;
    Json manifest = Json::parse(body, &parseError);
    if (!parseError.empty() || !CommunityPresetPackage::validate(manifest, error)) {
        if (error.empty()) error = "the catalog manifest is not valid JSON";
        return Json::object();
    }
    if (manifest["id"].asString() != id) {
        error = "the manifest ID does not match its catalog entry";
        return Json::object();
    }
    if (CommunityPresetPackage::checksum(manifest) != expectedChecksum) {
        error = "the manifest checksum does not match the protected catalog index";
        return Json::object();
    }
    saveCached(cache, manifest);
    return manifest;
}

} // namespace pimfx
