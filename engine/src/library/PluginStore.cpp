#include "library/PluginStore.h"

#include "core/Crypto.h"
#include "core/Log.h"
#include "core/Paths.h"

#include <algorithm>
#include <cerrno>
#include <cctype>
#include <cstdint>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <system_error>
#include <unordered_set>
#include <vector>

#if defined(PIMFX_HAVE_CURL)
#include <curl/curl.h>
#endif

#if !defined(_WIN32)
#include <fcntl.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace pimfx {
namespace {

constexpr const char* kHelperSocket = "/run/pimfx/plugin-helper.sock";
constexpr const char* kPatchstorageBase = "https://patchstorage.com/api/beta";
constexpr int64_t kPatchstorageCacheTtlSeconds = 24 * 60 * 60;
const char* kSuggested[] = {
    "calf-plugins",
    "x42-plugins",
    "zam-plugins",
    "guitarix-lv2",
    "gxplugins",
    "lsp-plugins-lv2",
    "eq10q",
    "dragonfly-reverb",
    "tap-plugins",
    "swh-lv2",
    "invada-studio-plugins-lv2",
    "mda-lv2",
    "dpf-plugins",
    "infamous-plugins",
    "rubberband-lv2",
    "toobamp"
};

struct RecommendedPack {
    const char* id;
    const char* package;
    const char* title;
    const char* repo;
    const char* url;
    const char* description;
};

const RecommendedPack kRecommended[] = {
    {
        "toobamp",
        "toobamp",
        "ToobAmp",
        "rerdavies/ToobAmp",
        "https://github.com/rerdavies/ToobAmp",
        "Raspberry Pi guitar LV2 pack: NAM A2, cab IR, delay, reverb, EQ, modulation. "
        "Prefers the ToobAmp `dev` arm64 .deb (v1.3.85). That file is not on GitHub yet, "
        "so INSTALL copies TooB from the latest PiPedal arm64 package without installing PiPedal."
    }
};

namespace fs = std::filesystem;

constexpr const char* kToobAmpDevReadme =
    "https://raw.githubusercontent.com/rerdavies/ToobAmp/dev/README.md";
constexpr const char* kToobAmpNamA2DebUrl =
    "https://github.com/rerdavies/ToobAmp/releases/download/v1.3.85/toobamp_1.3.85_arm64.deb";
constexpr const char* kPipedalRepo = "rerdavies/pipedal";
constexpr int kToobAmpNamA2MinRank = 1 * 1000000 + 3 * 1000 + 78;

struct ToobAmpDeb {
    std::string url;
    std::string name;
    std::string tag;
};

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

bool suggestedPackage(const std::string& name) {
    for (const char* item : kSuggested) {
        if (name == item) {
            return true;
        }
    }
    return false;
}

bool validPackageName(const std::string& name) {
    if (name.empty() || name.size() > 80) {
        return false;
    }
    const unsigned char first = static_cast<unsigned char>(name[0]);
    if (!std::islower(first) && !std::isdigit(first)) {
        return false;
    }
    for (unsigned char c : name) {
        if (!(std::islower(c) || std::isdigit(c) || c == '.' || c == '+' || c == '-')) {
            return false;
        }
    }
    return true;
}

bool validRepoId(const std::string& id) {
    if (id.empty() || id.size() > 40) {
        return false;
    }
    if (!std::islower(static_cast<unsigned char>(id[0])) && !std::isdigit(static_cast<unsigned char>(id[0]))) {
        return false;
    }
    for (unsigned char c : id) {
        if (!(std::islower(c) || std::isdigit(c) || c == '-')) {
            return false;
        }
    }
    return true;
}

bool printableHotspotText(const std::string& text, size_t minLength, size_t maxLength) {
    if (text.size() < minLength || text.size() > maxLength) {
        return false;
    }
    for (unsigned char c : text) {
        if (c < 32 || c > 126) {
            return false;
        }
    }
    return true;
}

Json defaultHotspotConfig() {
    Json json = Json::object();
    json.set("mode", "off");
    json.set("ssid", "PI-MFX");
    json.set("password", "");
    return json;
}

Json readHotspotFile(const Paths& paths) {
    std::string contents;
    if (!readFile(paths.hotspotFile(), contents) || contents.empty()) {
        return defaultHotspotConfig();
    }
    std::string parseError;
    Json json = Json::parse(contents, &parseError);
    if (!parseError.empty() || !json.isObject()) {
        return defaultHotspotConfig();
    }
    if (json["mode"].asString().empty()) {
        json.set("mode", "off");
    }
    if (json["ssid"].asString().empty()) {
        json.set("ssid", "PI-MFX");
    }
    return json;
}

bool writeHotspotFile(const Paths& paths, const Json& json, std::string& error) {
    if (!writeFileAtomic(paths.hotspotFile(), json.dump(2))) {
        error = "could not save hotspot settings";
        return false;
    }
#if !defined(_WIN32)
    std::error_code ec;
    fs::permissions(paths.hotspotFile(),
                    fs::perms::owner_read | fs::perms::owner_write,
                    fs::perm_options::replace, ec);
#endif
    return true;
}

Json publicHotspot(const Json& stored) {
    Json json = Json::object();
    json.set("mode", stored["mode"].asString("off"));
    json.set("ssid", stored["ssid"].asString("PI-MFX"));
    json.set("passwordSet", !stored["password"].asString().empty());
    return json;
}

bool endsWith(const std::string& text, const char* suffix) {
    const size_t length = std::strlen(suffix);
    return text.size() >= length && text.compare(text.size() - length, length, suffix) == 0;
}

std::string toLower(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

Json pickArm64Deb(const Json& release) {
    for (const Json& asset : release["assets"].items()) {
        const std::string name = toLower(asset["name"].asString());
        if (endsWith(name, ".deb.asc") || endsWith(name, ".asc")) {
            continue;
        }
        if (endsWith(name, "_arm64.deb") || endsWith(name, "_aarch64.deb")) {
            return asset;
        }
    }
    return Json();
}

int versionRank(const std::string& tag) {
    size_t i = 0;
    if (i < tag.size() && (tag[i] == 'v' || tag[i] == 'V')) {
        ++i;
    }
    int parts[3] = {0, 0, 0};
    int index = 0;
    int value = 0;
    for (; index < 3 && i <= tag.size(); ++i) {
        const char c = i < tag.size() ? tag[i] : '.';
        if (c >= '0' && c <= '9') {
            value = value * 10 + (c - '0');
            continue;
        }
        parts[index++] = value;
        value = 0;
        if (c != '.') {
            break;
        }
    }
    return parts[0] * 1000000 + parts[1] * 1000 + parts[2];
}

ToobAmpDeb parseToobAmpArm64FromReadme(const std::string& text) {
    const std::string prefix = "https://github.com/rerdavies/ToobAmp/releases/download/";
    size_t pos = 0;
    while ((pos = text.find(prefix, pos)) != std::string::npos) {
        size_t end = pos;
        while (end < text.size()) {
            const unsigned char c = static_cast<unsigned char>(text[end]);
            if (c <= 32 || c == '"' || c == ')' || c == ']' || c == '>') {
                break;
            }
            ++end;
        }
        const std::string url = text.substr(pos, end - pos);
        const std::string lower = toLower(url);
        if (endsWith(lower, "_arm64.deb") || endsWith(lower, "_aarch64.deb")) {
            ToobAmpDeb deb;
            deb.url = url;
            deb.name = fileName(url);
            const size_t tagStart = pos + prefix.size();
            const size_t tagEnd = text.find('/', tagStart);
            if (tagEnd != std::string::npos && tagEnd < end) {
                deb.tag = text.substr(tagStart, tagEnd - tagStart);
            }
            return deb;
        }
        pos = end;
    }
    return {};
}

ToobAmpDeb pickNewestNamA2Arm64(const Json& releases) {
    ToobAmpDeb best;
    int bestRank = -1;
    if (!releases.isArray()) {
        return best;
    }
    for (const Json& release : releases.items()) {
        const std::string tag = release["tag_name"].asString();
        const int rank = versionRank(tag);
        if (rank < kToobAmpNamA2MinRank) {
            continue;
        }
        const Json asset = pickArm64Deb(release);
        if (!asset.isObject() || asset["browser_download_url"].asString().empty()) {
            continue;
        }
        if (rank > bestRank) {
            bestRank = rank;
            best.url = asset["browser_download_url"].asString();
            best.name = asset["name"].asString();
            best.tag = tag;
        }
    }
    return best;
}

bool archivePathSafe(const std::string& member) {
    if (member.empty() || member[0] == '/' || member[0] == '\\') {
        return false;
    }
    fs::path path(member);
    for (const fs::path& part : path) {
        if (part == "..") {
            return false;
        }
    }
    return true;
}

#if defined(PIMFX_HAVE_CURL)

size_t writeToString(void* data, size_t size, size_t count, void* userData) {
    const size_t total = size * count;
    static_cast<std::string*>(userData)->append(static_cast<char*>(data), total);
    return total;
}

size_t writeToStream(void* data, size_t size, size_t count, void* userData) {
    const size_t total = size * count;
    static_cast<std::ofstream*>(userData)->write(static_cast<const char*>(data),
                                                 static_cast<std::streamsize>(total));
    return static_cast<std::ofstream*>(userData)->good() ? total : 0;
}

bool curlPerform(CURL* curl, std::string& error) {
    const CURLcode result = curl_easy_perform(curl);
    if (result != CURLE_OK) {
        error = std::string("network error: ") + curl_easy_strerror(result);
        return false;
    }
    return true;
}

std::string httpsGetBody(const std::string& url, std::string& error, int timeoutSeconds) {
    if (url.rfind("https://", 0) != 0) {
        error = "that URL is not HTTPS";
        return {};
    }

    CURL* curl = curl_easy_init();
    if (!curl) {
        error = "could not start an HTTPS request";
        return {};
    }

    std::string body;
    long status = 0;
    curl_slist* headers = curl_slist_append(nullptr, "Accept: application/vnd.github+json, text/plain, */*");
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeToString);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &body);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, static_cast<long>(timeoutSeconds));
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 15L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "Pi-MFX/" PIMFX_VERSION);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);

    const bool ok = curlPerform(curl, error);
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (!ok) {
        return {};
    }
    if (status < 200 || status >= 300) {
        error = "GitHub request failed (HTTP " + std::to_string(status) + ")";
        return {};
    }
    return body;
}

ToobAmpDeb resolveToobAmpArm64Deb(std::string& error) {
    error.clear();
    std::string readmeError;
    const std::string readme = httpsGetBody(kToobAmpDevReadme, readmeError, 20);
    if (readmeError.empty()) {
        const ToobAmpDeb fromReadme = parseToobAmpArm64FromReadme(readme);
        if (!fromReadme.url.empty()) {
            return fromReadme;
        }
    }

    std::string apiError;
    const std::string body = httpsGetBody(
        "https://api.github.com/repos/rerdavies/ToobAmp/releases?per_page=50",
        apiError,
        30);
    if (apiError.empty()) {
        std::string parseError;
        const Json releases = Json::parse(body, &parseError);
        if (parseError.empty()) {
            const ToobAmpDeb newest = pickNewestNamA2Arm64(releases);
            if (!newest.url.empty()) {
                return newest;
            }
        }
    }

    ToobAmpDeb fallback;
    fallback.url = kToobAmpNamA2DebUrl;
    fallback.name = "toobamp_1.3.85_arm64.deb";
    fallback.tag = "v1.3.85";
    return fallback;
}

#else

ToobAmpDeb resolveToobAmpArm64Deb(std::string& error) {
    error = "this build has no HTTPS support";
    return {};
}

#endif

#if !defined(_WIN32)

bool runProcess(const std::vector<std::string>& args, std::string& output, int& exitCode, std::string& error) {
    if (args.empty()) {
        error = "empty command";
        return false;
    }

    int pipefd[2];
    if (pipe(pipefd) != 0) {
        error = "could not create a pipe";
        return false;
    }

    const pid_t pid = fork();
    if (pid < 0) {
        close(pipefd[0]);
        close(pipefd[1]);
        error = "could not start a helper process";
        return false;
    }

    if (pid == 0) {
        close(pipefd[0]);
        dup2(pipefd[1], STDOUT_FILENO);
        dup2(pipefd[1], STDERR_FILENO);
        close(pipefd[1]);
        std::vector<char*> argv;
        argv.reserve(args.size() + 1);
        for (const std::string& arg : args) {
            argv.push_back(const_cast<char*>(arg.c_str()));
        }
        argv.push_back(nullptr);
        execvp(argv[0], argv.data());
        _exit(127);
    }

    close(pipefd[1]);
    output.clear();
    char buffer[4096];
    while (true) {
        const ssize_t n = read(pipefd[0], buffer, sizeof(buffer));
        if (n < 0) {
            close(pipefd[0]);
            error = "could not read command output";
            return false;
        }
        if (n == 0) {
            break;
        }
        output.append(buffer, static_cast<size_t>(n));
        if (output.size() > 2u * 1024u * 1024u) {
            close(pipefd[0]);
            error = "command output was unreasonably large";
            return false;
        }
    }
    close(pipefd[0]);

    int status = 0;
    if (waitpid(pid, &status, 0) < 0) {
        error = "could not wait for the helper process";
        return false;
    }
    if (WIFEXITED(status)) {
        exitCode = WEXITSTATUS(status);
        return true;
    }
    error = "the helper process did not exit normally";
    return false;
}

bool writeAll(int fd, const std::string& data) {
    size_t sent = 0;
    while (sent < data.size()) {
        const ssize_t n = write(fd, data.data() + sent, data.size() - sent);
        if (n <= 0) {
            return false;
        }
        sent += static_cast<size_t>(n);
    }
    return true;
}

bool readAll(int fd, std::string& out, int timeoutSeconds) {
    out.clear();
    const int timeoutMs = timeoutSeconds * 1000;
    while (true) {
        pollfd poller{};
        poller.fd = fd;
        poller.events = POLLIN;
        const int ready = poll(&poller, 1, timeoutMs);
        if (ready == 0) {
            return false;
        }
        if (ready < 0) {
            return false;
        }
        char buffer[4096];
        const ssize_t n = read(fd, buffer, sizeof(buffer));
        if (n < 0) {
            return false;
        }
        if (n == 0) {
            return true;
        }
        out.append(buffer, static_cast<size_t>(n));
        if (out.size() > 2u * 1024u * 1024u) {
            return false;
        }
    }
}

#endif

void collectBundles(const fs::path& root, std::vector<fs::path>& out) {
    std::error_code ec;
    if (fs::exists(root / "manifest.ttl", ec)) {
        out.push_back(root);
        return;
    }
    if (!fs::is_directory(root, ec)) {
        return;
    }
    for (const fs::directory_entry& entry : fs::directory_iterator(root, ec)) {
        if (!entry.is_directory(ec)) {
            continue;
        }
        const fs::path path = entry.path();
        if (fs::exists(path / "manifest.ttl", ec)) {
            out.push_back(path);
            continue;
        }
        for (const fs::directory_entry& inner : fs::directory_iterator(path, ec)) {
            if (inner.is_directory(ec) && fs::exists(inner.path() / "manifest.ttl", ec)) {
                out.push_back(inner.path());
            }
        }
    }
}

Json summarizePatch(const Json& item, bool installed) {
    Json out = Json::object();
    out.set("id", item["id"].asInt());
    out.set("title", item["title"].asString());
    out.set("excerpt", item["excerpt"].asString());
    out.set("url", item["url"].asString());
    out.set("slug", item["slug"].asString());
    out.set("downloads", item["download_count"].asInt());
    std::string created = item["created_at"].asString();
    if (created.empty()) {
        created = item["date"].asString();
    }
    std::string updated = item["updated_at"].asString();
    if (updated.empty()) {
        updated = item["modified"].asString();
    }
    out.set("date", created);
    out.set("modified", updated);
    out.set("author", item["author"]["name"].asString());
    out.set("installed", installed);
    if (item["license"].isObject()) {
        out.set("license", item["license"]["name"].asString());
    }
    if (item["artwork"].isObject()) {
        out.set("artwork", item["artwork"]["thumbnail_url"].asString());
    }
    return out;
}

} // namespace

PluginStore::PluginStore(Paths paths) : paths_(std::move(paths)) {
    makeDirectories(paths_.lv2Dir);
    makeDirectories(joinPath(paths_.downloadsDir, "patchstorage"));
    makeDirectories(joinPath(paths_.downloadsDir, "github"));
}

Json PluginStore::status() {
    Json json = Json::object();
    json.set("helperAvailable", helperPing());
    json.set("helperSocket", kHelperSocket);
    json.set("lv2Dir", paths_.lv2Dir);
#if defined(PIMFX_HAVE_CURL)
    json.set("httpsAvailable", true);
#else
    json.set("httpsAvailable", false);
#endif
    Json suggested = Json::array();
    for (const char* name : kSuggested) {
        suggested.push(Json(name));
    }
    json.set("suggestedPackages", suggested);
    Json hidden;
    Json bundles;
    Json recommended;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        recommended = recommendedUnlocked(false);
        bundles = installedBundles();
        hidden = loadRegistry()["hidden"];
    }
    json.set("recommended", recommended);
    json.set("bundles", bundles);
    json.set("hidden", hidden);
    return json;
}

Json PluginStore::helperCall(const std::string& op, const Json& args, std::string& error, int timeoutSeconds) {
#if defined(_WIN32)
    (void)op;
    (void)args;
    (void)timeoutSeconds;
    error = "the Pi-MFX helper is only available on the Pi";
    return Json();
#else
    Json request = args.isObject() ? args : Json::object();
    request.set("op", op);
    request.set("timeout", timeoutSeconds);

    const int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) {
        error = "could not open the plugin helper socket";
        return Json();
    }

    sockaddr_un address{};
    address.sun_family = AF_UNIX;
    std::strncpy(address.sun_path, kHelperSocket, sizeof(address.sun_path) - 1);

    const int flags = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, flags | O_NONBLOCK);
    int connected = connect(fd, reinterpret_cast<sockaddr*>(&address), sizeof(address));
    if (connected < 0 && errno != EINPROGRESS) {
        close(fd);
        error = "plugin helper is not running; apt and extra repos need the Pi-MFX helper service";
        return Json();
    }

    pollfd poller{};
    poller.fd = fd;
    poller.events = POLLOUT;
    if (poll(&poller, 1, 2000) <= 0) {
        close(fd);
        error = "plugin helper is not running; apt and extra repos need the Pi-MFX helper service";
        return Json();
    }
    fcntl(fd, F_SETFL, flags);

    const std::string body = request.dump() + "\n";
    if (!writeAll(fd, body)) {
        close(fd);
        error = "could not talk to the plugin helper";
        return Json();
    }
    shutdown(fd, SHUT_WR);

    std::string reply;
    if (!readAll(fd, reply, timeoutSeconds)) {
        close(fd);
        error = "the plugin helper timed out";
        return Json();
    }
    close(fd);

    std::string parseError;
    Json json = Json::parse(reply, &parseError);
    if (!parseError.empty() || !json.isObject()) {
        error = "the plugin helper returned invalid JSON";
        return Json();
    }
    if (!json["ok"].asBool(false)) {
        error = json["error"].asString("plugin helper failed");
        return Json();
    }
    return json;
#endif
}

bool PluginStore::helperPing() {
    std::string error;
    const Json reply = helperCall("ping", Json::object(), error, 3);
    return error.empty() && reply["ok"].asBool(false);
}

Json PluginStore::aptSearch(const std::string& query, std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    Json args = Json::object();
    args.set("query", query);
    return helperCall("apt-search", args, error, 45);
}

Json PluginStore::aptList(std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    return helperCall("apt-list", Json::object(), error, 45);
}

bool PluginStore::aptInstall(const std::string& package, std::string& error) {
    if (!validPackageName(package) || !suggestedPackage(package)) {
        error = "that package is not on the Pi-MFX install list";
        return false;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    Json args = Json::object();
    args.set("package", package);
    const Json reply = helperCall("apt-install", args, error, 180);
    return error.empty() && reply["ok"].asBool(false);
}

bool PluginStore::aptRemove(const std::string& package, std::string& error) {
    if (!validPackageName(package) || !suggestedPackage(package)) {
        error = "that package is not on the Pi-MFX install list";
        return false;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    Json args = Json::object();
    args.set("package", package);
    const Json reply = helperCall("apt-remove", args, error, 120);
    return error.empty() && reply["ok"].asBool(false);
}

Json PluginStore::repoList(std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    return helperCall("repo-list", Json::object(), error, 15);
}

bool PluginStore::repoAdd(const Json& payload, std::string& error) {
    const std::string id = payload["id"].asString();
    if (!validRepoId(id)) {
        error = "repo id must be lowercase letters, digits, and dashes";
        return false;
    }
    if (payload["keyUrl"].asString().empty()) {
        error = "a signing key URL is required";
        return false;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    const Json reply = helperCall("repo-add", payload, error, 120);
    return error.empty() && reply["ok"].asBool(false);
}

bool PluginStore::repoRemove(const std::string& id, std::string& error) {
    if (!validRepoId(id)) {
        error = "that repo id is not allowed";
        return false;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    Json args = Json::object();
    args.set("id", id);
    const Json reply = helperCall("repo-remove", args, error, 120);
    return error.empty() && reply["ok"].asBool(false);
}

Json PluginStore::recommended(bool fetchLatest, std::string& error) {
    error.clear();
    std::lock_guard<std::mutex> lock(mutex_);
    return recommendedUnlocked(fetchLatest);
}

Json PluginStore::recommendedUnlocked(bool fetchLatest) {
    Json list = Json::array();
    for (const RecommendedPack& pack : kRecommended) {
        Json item = Json::object();
        item.set("id", pack.id);
        item.set("package", pack.package);
        item.set("title", pack.title);
        item.set("repo", pack.repo);
        item.set("url", pack.url);
        item.set("description", pack.description);
        item.set("source", "github");

        std::string statusError;
        Json args = Json::object();
        args.set("package", pack.package);
        const Json status = helperCall("package-status", args, statusError, 10);
        const bool aptInstalled = statusError.empty() && status["installed"].asBool(false);
        bool bundleInstalled = false;
        if (std::string(pack.id) == "toobamp") {
            std::error_code ec;
            bundleInstalled = fs::is_directory(fs::path(paths_.lv2Dir) / "ToobAmp.lv2", ec);
            item.set("branch", "dev");
        }
        item.set("installed", aptInstalled || bundleInstalled);

        if (fetchLatest) {
            std::string latestError;
            if (std::string(pack.id) == "toobamp") {
                const ToobAmpDeb deb = resolveToobAmpArm64Deb(latestError);
                if (!deb.tag.empty()) {
                    item.set("latestVersion", deb.tag);
                    item.set("latestName", deb.name);
                }
            } else {
                const std::string url = std::string("https://api.github.com/repos/") + pack.repo + "/releases/latest";
                const Json release = httpsGet(url, latestError, 20);
                if (latestError.empty() && release.isObject()) {
                    item.set("latestVersion", release["tag_name"].asString());
                    item.set("latestName", release["name"].asString());
                }
            }
        }
        list.push(item);
    }
    return list;
}

bool PluginStore::installToobAmpFromPipedalDeb(std::string& error) {
#if defined(_WIN32)
    error = "ToobAmp can only be installed on the Pi";
    return false;
#else
    const Json release = httpsGet(std::string("https://api.github.com/repos/") + kPipedalRepo
                                      + "/releases/latest",
                                  error, 30);
    if (!error.empty()) {
        return false;
    }
    const Json chosen = pickArm64Deb(release);
    if (!chosen.isObject() || chosen["browser_download_url"].asString().empty()) {
        error = "the latest PiPedal release has no Raspberry Pi arm64 .deb";
        return false;
    }

    const std::string filename = sanitizeFileName(chosen["name"].asString());
    const std::string dest = joinPath(joinPath(paths_.downloadsDir, "github"), filename);
    if (!httpsDownload(chosen["browser_download_url"].asString(), dest, error)) {
        return false;
    }

    const std::string extractDir = joinPath(joinPath(paths_.downloadsDir, "github"), "toobamp-from-pipedal");
    std::error_code ec;
    fs::remove_all(extractDir, ec);
    if (!makeDirectories(extractDir)) {
        removeFile(dest);
        error = "could not create the extract folder";
        return false;
    }

    std::string output;
    int exitCode = 0;
    if (!runProcess({"dpkg-deb", "-x", dest, extractDir}, output, exitCode, error)) {
        fs::remove_all(extractDir, ec);
        removeFile(dest);
        return false;
    }
    if (exitCode != 0) {
        error = output.empty() ? "could not unpack that PiPedal package" : output;
        fs::remove_all(extractDir, ec);
        removeFile(dest);
        return false;
    }

    fs::path source = fs::path(extractDir) / "usr" / "lib" / "lv2" / "ToobAmp.lv2";
    if (!fs::is_directory(source, ec)) {
        source = fs::path(extractDir) / "usr" / "local" / "lib" / "lv2" / "ToobAmp.lv2";
    }
    if (!fs::is_directory(source, ec)) {
        error = "that PiPedal package did not contain ToobAmp.lv2";
        fs::remove_all(extractDir, ec);
        removeFile(dest);
        return false;
    }

    const fs::path bundle = fs::path(paths_.lv2Dir) / "ToobAmp.lv2";
    fs::remove_all(bundle, ec);
    fs::copy(source, bundle, fs::copy_options::recursive, ec);
    fs::remove_all(extractDir, ec);
    removeFile(dest);
    if (ec) {
        error = "could not install ToobAmp.lv2";
        return false;
    }

    Json registry = loadRegistry();
    Json remaining = Json::array();
    for (const Json& existing : registry["bundles"].items()) {
        bool keep = true;
        for (const Json& dir : existing["directories"].items()) {
            if (dir.asString() == "ToobAmp.lv2") {
                keep = false;
                break;
            }
        }
        if (keep && existing["directory"].asString() != "ToobAmp.lv2") {
            remaining.push(existing);
        }
    }
    Json record = Json::object();
    record.set("source", "toobamp-dev");
    record.set("title", "ToobAmp");
    record.set("url", "https://github.com/rerdavies/ToobAmp");
    record.set("directory", "ToobAmp.lv2");
    Json directories = Json::array();
    directories.push(Json("ToobAmp.lv2"));
    record.set("directories", directories);
    remaining.push(record);
    registry.set("bundles", remaining);
    saveRegistry(registry);
    logInfo("plugins: installed ToobAmp from PiPedal " + release["tag_name"].asString()
            + " (TooB bundle only; PiPedal was not installed)");
    return true;
#endif
}

bool PluginStore::githubInstall(const std::string& id, std::string& error) {
    const RecommendedPack* pack = nullptr;
    for (const RecommendedPack& item : kRecommended) {
        if (id == item.id || id == item.package) {
            pack = &item;
            break;
        }
    }
    if (!pack) {
        error = "that GitHub plugin pack is not on the recommended list";
        return false;
    }

    std::lock_guard<std::mutex> lock(mutex_);
    if (std::string(pack->id) == "toobamp") {
#if defined(_WIN32)
        error = "ToobAmp can only be installed on the Pi";
        return false;
#else
        Json pipedalArgs = Json::object();
        pipedalArgs.set("package", "pipedal");
        std::string pipedalError;
        const Json pipedal = helperCall("package-status", pipedalArgs, pipedalError, 10);
        if (pipedalError.empty() && pipedal["installed"].asBool(false)) {
            error = "the pipedal package is already installed. TooB ships inside that package; "
                    "do not install the separate toobamp .deb over it.";
            return false;
        }

        const ToobAmpDeb deb = resolveToobAmpArm64Deb(error);
        if (deb.url.empty()) {
            if (error.empty()) {
                error = "could not find a ToobAmp NAM A2 arm64 .deb";
            }
            return false;
        }
        error.clear();

        std::string ignore;
        Json removeArgs = Json::object();
        removeArgs.set("package", "toobamp");
        helperCall("apt-remove", removeArgs, ignore, 120);

        std::error_code ec;
        fs::remove_all(fs::path(paths_.lv2Dir) / "ToobAmp.lv2", ec);
        Json registry = loadRegistry();
        Json remaining = Json::array();
        for (const Json& existing : registry["bundles"].items()) {
            bool keep = true;
            for (const Json& dir : existing["directories"].items()) {
                if (dir.asString() == "ToobAmp.lv2") {
                    keep = false;
                    break;
                }
            }
            if (keep && existing["directory"].asString() != "ToobAmp.lv2") {
                remaining.push(existing);
            }
        }
        registry.set("bundles", remaining);
        saveRegistry(registry);

        const std::string filename = sanitizeFileName(deb.name.empty() ? fileName(deb.url) : deb.name);
        const std::string dest = joinPath(joinPath(paths_.downloadsDir, "github"), filename);
        if (httpsDownload(deb.url, dest, error)) {
            Json args = Json::object();
            args.set("path", dest);
            const Json reply = helperCall("deb-install", args, error, 300);
            removeFile(dest);
            if (!error.empty()) {
                return false;
            }
            logInfo("plugins: installed ToobAmp " + deb.tag + " from ToobAmp dev");
            return reply["ok"].asBool(true);
        }

        logWarn("plugins: ToobAmp standalone .deb is not published (" + error
                + "); copying TooB from the latest PiPedal arm64 package");
        error.clear();
        return installToobAmpFromPipedalDeb(error);
#endif
    }

    const std::string url = std::string("https://api.github.com/repos/") + pack->repo + "/releases/latest";
    const Json release = httpsGet(url, error, 30);
    if (!error.empty()) {
        return false;
    }

    Json chosen;
    const std::string package = toLower(pack->package);
    for (const Json& asset : release["assets"].items()) {
        const std::string name = toLower(asset["name"].asString());
        if (name.find(package) == std::string::npos) {
            continue;
        }
        if (endsWith(name, "_arm64.deb") || endsWith(name, "_aarch64.deb")) {
            chosen = asset;
            break;
        }
    }
    if (!chosen.isObject() || chosen["browser_download_url"].asString().empty()) {
        error = "that release has no Raspberry Pi arm64 .deb";
        return false;
    }

    const std::string filename = sanitizeFileName(chosen["name"].asString());
    const std::string dest = joinPath(joinPath(paths_.downloadsDir, "github"), filename);
    if (!httpsDownload(chosen["browser_download_url"].asString(), dest, error)) {
        return false;
    }

    Json args = Json::object();
    args.set("path", dest);
    const Json reply = helperCall("deb-install", args, error, 300);
    removeFile(dest);
    if (!error.empty()) {
        return false;
    }
    logInfo(std::string("plugins: installed ") + pack->title + " from GitHub");
    return reply["ok"].asBool(true);
}

bool PluginStore::githubRemove(const std::string& id, std::string& error) {
    const RecommendedPack* pack = nullptr;
    for (const RecommendedPack& item : kRecommended) {
        if (id == item.id || id == item.package) {
            pack = &item;
            break;
        }
    }
    if (!pack) {
        error = "that GitHub plugin pack is not on the recommended list";
        return false;
    }

    if (std::string(pack->id) == "toobamp") {
        std::string ignore;
        Json args = Json::object();
        args.set("package", "toobamp");
        helperCall("apt-remove", args, ignore, 120);
        return bundleRemove("ToobAmp.lv2", error);
    }

    return aptRemove(pack->package, error);
}

Json PluginStore::httpsGet(const std::string& url, std::string& error, int timeoutSeconds) {
#if defined(PIMFX_HAVE_CURL)
    if (url.rfind("https://", 0) != 0) {
        error = "that URL is not HTTPS";
        return Json();
    }

    CURL* curl = curl_easy_init();
    if (!curl) {
        error = "could not start an HTTPS request";
        return Json();
    }

    std::string body;
    long status = 0;
    curl_slist* headers = curl_slist_append(nullptr, "Accept: application/vnd.github+json, application/json");
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeToString);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &body);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, static_cast<long>(timeoutSeconds));
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 15L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "Pi-MFX/" PIMFX_VERSION);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);

    const bool ok = curlPerform(curl, error);
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (!ok) {
        return Json();
    }
    if (status < 200 || status >= 300) {
        error = "PatchStorage request failed (HTTP " + std::to_string(status) + ")";
        return Json();
    }

    std::string parseError;
    Json json = Json::parse(body, &parseError);
    if (!parseError.empty()) {
        error = "PatchStorage returned invalid JSON";
        return Json();
    }
    return json;
#else
    (void)url;
    (void)timeoutSeconds;
    error = "this build has no HTTPS support";
    return Json();
#endif
}

bool PluginStore::httpsDownload(const std::string& url, const std::string& destPath, std::string& error) {
#if defined(PIMFX_HAVE_CURL)
    if (url.rfind("https://", 0) != 0) {
        error = "that download link is not HTTPS";
        return false;
    }
    if (!makeDirectories(parentPath(destPath))) {
        error = "could not create the download folder";
        return false;
    }

    std::ofstream stream(destPath, std::ios::binary | std::ios::trunc);
    if (!stream) {
        error = "could not write the download";
        return false;
    }

    CURL* curl = curl_easy_init();
    if (!curl) {
        error = "could not start an HTTPS request";
        return false;
    }

    long status = 0;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeToStream);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &stream);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 180L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 15L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "Pi-MFX/" PIMFX_VERSION);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);
    curl_easy_setopt(curl, CURLOPT_MAXFILESIZE, 256L * 1024L * 1024L);

    const bool ok = curlPerform(curl, error);
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
    curl_easy_cleanup(curl);
    stream.close();

    if (!ok) {
        removeFile(destPath);
        return false;
    }
    if (status < 200 || status >= 300) {
        removeFile(destPath);
        error = "download failed (HTTP " + std::to_string(status) + ")";
        return false;
    }
    return true;
#else
    (void)url;
    (void)destPath;
    error = "this build has no HTTPS support";
    return false;
#endif
}

bool PluginStore::resolvePatchstorageIds(std::string& error) {
    if (platformId_ > 0 && targetId_ > 0) {
        return true;
    }

    const Json cache = loadPatchstorageCache();
    platformId_ = cache["platformId"].asInt(0);
    targetId_ = cache["targetId"].asInt(0);
    if (platformId_ > 0 && targetId_ > 0) {
        return true;
    }

    const Json platforms = httpsGet(std::string(kPatchstorageBase) + "/platforms?search=lv2&per_page=100", error);
    if (!error.empty()) {
        return false;
    }
    const Json platformList = platforms.isArray() ? platforms : platforms["items"];
    for (const Json& item : platformList.items()) {
        const std::string slug = toLower(item["slug"].asString());
        if (slug == "lv2-plugins" || slug == "lv2") {
            platformId_ = item["id"].asInt();
            break;
        }
    }
    if (platformId_ <= 0) {
        error = "could not find the PatchStorage LV2 platform";
        return false;
    }

    std::string targetError;
    const Json targets = httpsGet(std::string(kPatchstorageBase) + "/targets?search=rpi&per_page=100", targetError);
    if (!targetError.empty()) {
        error = targetError;
        return false;
    }
    const Json targetList = targets.isArray() ? targets : targets["items"];
    for (const Json& item : targetList.items()) {
        if (toLower(item["slug"].asString()) == "rpi-aarch64") {
            targetId_ = item["id"].asInt();
            break;
        }
    }
    if (targetId_ <= 0) {
        error = "could not find the PatchStorage rpi-aarch64 target";
        return false;
    }
    logInfo("patchstorage: platform " + std::to_string(platformId_)
            + " target " + std::to_string(targetId_));
    return true;
}

Json PluginStore::loadPatchstorageCache() const {
    std::string text;
    if (!readFile(paths_.patchstorageCacheFile(), text) || text.empty()) {
        return Json::object();
    }
    std::string parseError;
    Json json = Json::parse(text, &parseError);
    if (!parseError.empty() || !json.isObject()) {
        return Json::object();
    }
    return json;
}

void PluginStore::savePatchstorageCache(const Json& items, bool complete) {
    Json json = Json::object();
    json.set("fetchedAt", static_cast<int64_t>(std::time(nullptr)));
    json.set("platformId", platformId_);
    json.set("targetId", targetId_);
    json.set("complete", complete);
    json.set("items", items);
    writeFileAtomic(paths_.patchstorageCacheFile(), json.dump(2));
}

Json PluginStore::patchstorageSearch(const Json& query, std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!resolvePatchstorageIds(error)) {
        return Json();
    }

    const int startPage = std::max(1, query["page"].asInt(1));
    const int perPage = std::min(100, std::max(1, query["perPage"].asInt(100)));
    const bool fetchAll = query["all"].asBool(false);
    const bool refresh = query["refresh"].asBool(false);
    const std::string search = query["query"].asString();

    Json cache = loadPatchstorageCache();
    const int64_t fetchedAt = cache["fetchedAt"].asInt64();
    const int64_t now = static_cast<int64_t>(std::time(nullptr));
    const bool cacheFresh = fetchedAt > 0 && (now - fetchedAt) < kPatchstorageCacheTtlSeconds;
    const bool canUseCache = !refresh && search.empty() && cache["items"].isArray()
        && cache["items"].size() > 0;

    auto wrap = [&](const Json& items, bool cached, bool stale, bool complete, bool hasMore, int nextPage) {
        Json wrapper = Json::object();
        wrapper.set("items", items);
        wrapper.set("page", startPage);
        wrapper.set("count", static_cast<int>(items.size()));
        wrapper.set("cached", cached);
        wrapper.set("stale", stale);
        wrapper.set("complete", complete);
        wrapper.set("hasMore", hasMore);
        wrapper.set("nextPage", nextPage);
        wrapper.set("platformId", platformId_);
        wrapper.set("targetId", targetId_);
        wrapper.set("target", "rpi-aarch64");
        return wrapper;
    };

    if (canUseCache) {
        const bool complete = cache["complete"].asBool(false);
        const int next = complete ? 0 : (static_cast<int>(cache["items"].size()) / perPage) + 1;
        return wrap(cache["items"], true, !cacheFresh, complete, !complete, next);
    }

    std::unordered_set<int64_t> installed;
    for (const Json& bundle : loadRegistry()["bundles"].items()) {
        const int64_t patchId = bundle["patchId"].asInt64();
        if (patchId > 0) {
            installed.insert(patchId);
        }
    }

    Json items = Json::array();
    int page = startPage;
    const int lastPage = fetchAll ? startPage + 19 : startPage;
    int lastCount = 0;
    while (page <= lastPage) {
        std::string url = std::string(kPatchstorageBase) + "/patches/?platforms="
            + std::to_string(platformId_)
            + "&targets=" + std::to_string(targetId_)
            + "&page=" + std::to_string(page)
            + "&per_page=" + std::to_string(perPage)
            + "&orderby=download_count";
        if (!search.empty()) {
            url += "&search=" + urlEncode(search);
        }

        const Json result = httpsGet(url, error, 45);
        if (!error.empty()) {
            return Json();
        }

        const Json list = result.isArray() ? result : result["items"];
        int count = 0;
        for (const Json& item : list.items()) {
            const bool have = installed.count(item["id"].asInt64()) > 0;
            items.push(summarizePatch(item, have));
            ++count;
        }
        lastCount = count;
        if (!fetchAll || count < perPage) {
            break;
        }
        ++page;
    }

    const bool hasMore = lastCount >= perPage;
    const bool complete = !hasMore;
    const int nextPage = hasMore ? (fetchAll ? page + 1 : startPage + 1) : 0;

    if (search.empty()) {
        if (startPage <= 1 || fetchAll) {
            savePatchstorageCache(items, complete || fetchAll);
        } else if (cache["items"].isArray()) {
            std::unordered_set<int64_t> seen;
            Json merged = Json::array();
            for (const Json& item : cache["items"].items()) {
                const int64_t id = item["id"].asInt64();
                if (id > 0) {
                    seen.insert(id);
                }
                merged.push(item);
            }
            for (const Json& item : items.items()) {
                const int64_t id = item["id"].asInt64();
                if (id > 0 && seen.count(id) > 0) {
                    continue;
                }
                merged.push(item);
            }
            savePatchstorageCache(merged, complete);
        } else {
            savePatchstorageCache(items, complete);
        }
    }

    return wrap(items, false, false, complete && !fetchAll ? complete : complete, hasMore, nextPage);
}

bool PluginStore::extractArchive(const std::string& archive, const std::string& dest, std::string& error) {
#if defined(_WIN32)
    (void)archive;
    (void)dest;
    error = "plugin archives can only be extracted on the Pi";
    return false;
#else
    if (!makeDirectories(dest)) {
        error = "could not create the extract folder";
        return false;
    }

    std::vector<std::string> listArgs;
    std::vector<std::string> extractArgs;
    const std::string lower = toLower(archive);
    // Raspberry Pi OS ships GNU tar. --no-absolute-filenames is a bsdtar flag
    // and makes GNU tar abort. GNU tar already strips leading '/' unless -P.
    const auto gnuTar = [&](const char* listFlag, const char* extractFlag) {
        listArgs = {"tar", listFlag, archive};
        extractArgs = {"tar", "--no-same-owner", extractFlag, archive, "-C", dest};
    };
    if (endsWith(lower, ".zip")) {
        listArgs = {"unzip", "-Z1", archive};
        extractArgs = {"unzip", "-q", "-o", archive, "-d", dest};
    } else if (endsWith(lower, ".tar.xz") || endsWith(lower, ".txz")) {
        gnuTar("-tJf", "-xJf");
    } else if (endsWith(lower, ".tar.bz2") || endsWith(lower, ".tbz2") || endsWith(lower, ".tbz")) {
        gnuTar("-tjf", "-xjf");
    } else if (endsWith(lower, ".tar") && !endsWith(lower, ".tar.gz") && !endsWith(lower, ".tgz")) {
        gnuTar("-tf", "-xf");
    } else {
        gnuTar("-tzf", "-xzf");
    }

    std::string listing;
    int exitCode = 0;
    if (!runProcess(listArgs, listing, exitCode, error)) {
        return false;
    }
    if (exitCode != 0) {
        error = listing.empty() ? "could not read that archive" : listing;
        return false;
    }
    std::string member;
    for (char c : listing) {
        if (c == '\n') {
            if (!member.empty() && !archivePathSafe(member)) {
                error = "that archive contains an unsafe path";
                return false;
            }
            member.clear();
        } else if (c != '\r') {
            member.push_back(c);
        }
    }
    if (!member.empty() && !archivePathSafe(member)) {
        error = "that archive contains an unsafe path";
        return false;
    }

    std::string extractOutput;
    if (!runProcess(extractArgs, extractOutput, exitCode, error)) {
        return false;
    }
    if (exitCode != 0) {
        error = extractOutput.empty() ? "could not extract that archive" : extractOutput;
        return false;
    }
    return true;
#endif
}

Json PluginStore::loadRegistry() const {
    std::string text;
    if (!readFile(paths_.pluginsFile(), text) || text.empty()) {
        Json json = Json::object();
        json.set("bundles", Json::array());
        return json;
    }
    std::string parseError;
    Json json = Json::parse(text, &parseError);
    if (!parseError.empty() || !json.isObject()) {
        Json fallback = Json::object();
        fallback.set("bundles", Json::array());
        return fallback;
    }
    if (!json["bundles"].isArray()) {
        json.set("bundles", Json::array());
    }
    if (!json["hidden"].isArray()) {
        json.set("hidden", Json::array());
    }
    return json;
}

Json PluginStore::hiddenPlugins() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return loadRegistry()["hidden"];
}

bool PluginStore::hidePlugin(const std::string& uri, const std::string& name, std::string& error) {
    if (uri.empty() || uri.size() > 400 || uri.find('\n') != std::string::npos) {
        error = "that plugin URI is not allowed";
        return false;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    Json registry = loadRegistry();
    Json hidden = registry["hidden"].isArray() ? registry["hidden"] : Json::array();
    for (const Json& item : hidden.items()) {
        if (item["uri"].asString() == uri || item.asString() == uri) {
            return true;
        }
    }
    Json record = Json::object();
    record.set("uri", uri);
    record.set("name", name);
    hidden.push(record);
    registry.set("hidden", hidden);
    if (!saveRegistry(registry)) {
        error = "could not save the hidden-plugin list";
        return false;
    }
    return true;
}

bool PluginStore::unhidePlugin(const std::string& uri, std::string& error) {
    if (uri.empty()) {
        error = "no plugin URI";
        return false;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    Json registry = loadRegistry();
    Json remaining = Json::array();
    for (const Json& item : registry["hidden"].items()) {
        const std::string stored = item["uri"].asString().empty() ? item.asString() : item["uri"].asString();
        if (stored != uri) {
            remaining.push(item);
        }
    }
    registry.set("hidden", remaining);
    if (!saveRegistry(registry)) {
        error = "could not save the hidden-plugin list";
        return false;
    }
    return true;
}

bool PluginStore::saveRegistry(const Json& registry) const {
    return writeFileAtomic(paths_.pluginsFile(), registry.dump(2));
}

Json PluginStore::installedBundles() const {
    return loadRegistry()["bundles"];
}

bool PluginStore::bundleRemove(const std::string& directory, std::string& error) {
    const std::string name = fileName(directory);
    if (name.empty() || name != directory || !endsWith(toLower(name), ".lv2") || name.find("..") != std::string::npos) {
        error = "that bundle name is not allowed";
        return false;
    }

    std::lock_guard<std::mutex> lock(mutex_);
    const std::string path = joinPath(paths_.lv2Dir, name);
    std::error_code ec;
    if (fs::exists(path, ec)) {
        fs::remove_all(path, ec);
        if (ec) {
            error = "could not delete " + name;
            return false;
        }
    }

    Json registry = loadRegistry();
    Json remaining = Json::array();
    for (const Json& bundle : registry["bundles"].items()) {
        bool keep = true;
        for (const Json& dir : bundle["directories"].items()) {
            if (dir.asString() == name) {
                keep = false;
                break;
            }
        }
        if (keep && bundle["directory"].asString() != name) {
            remaining.push(bundle);
        }
    }
    registry.set("bundles", remaining);
    saveRegistry(registry);
    return true;
}

bool PluginStore::patchstorageInstall(int64_t patchId, std::string& error) {
    if (patchId <= 0) {
        error = "no PatchStorage patch id";
        return false;
    }

    std::lock_guard<std::mutex> lock(mutex_);
    if (!resolvePatchstorageIds(error)) {
        return false;
    }

    const Json patch = httpsGet(std::string(kPatchstorageBase) + "/patches/" + std::to_string(patchId) + "/", error, 45);
    if (!error.empty()) {
        return false;
    }

    Json chosen;
    for (const Json& file : patch["files"].items()) {
        if (toLower(file["target"]["slug"].asString()) == "rpi-aarch64") {
            chosen = file;
            break;
        }
    }
    if (!chosen.isObject() || chosen["url"].asString().empty()) {
        error = "that plugin has no rpi-aarch64 build on PatchStorage";
        return false;
    }

    const std::string filename = sanitizeFileName(chosen["filename"].asString());
    const std::string archive = joinPath(joinPath(paths_.downloadsDir, "patchstorage"),
                                         std::to_string(patchId) + "-" + filename);
    if (!httpsDownload(chosen["url"].asString(), archive, error)) {
        return false;
    }

    const std::string extractDir = joinPath(joinPath(paths_.downloadsDir, "patchstorage"),
                                            "tmp-" + std::to_string(patchId));
    std::error_code ec;
    fs::remove_all(extractDir, ec);
    if (!extractArchive(archive, extractDir, error)) {
        fs::remove_all(extractDir, ec);
        removeFile(archive);
        return false;
    }

    std::vector<fs::path> bundles;
    collectBundles(extractDir, bundles);
    if (bundles.empty()) {
        fs::remove_all(extractDir, ec);
        removeFile(archive);
        error = "that archive did not contain an LV2 bundle";
        return false;
    }

    Json directories = Json::array();
    for (const fs::path& bundle : bundles) {
        std::string destName = bundle.filename().string();
        if (!endsWith(toLower(destName), ".lv2")) {
            destName = sanitizeFileName(patch["title"].asString()) + ".lv2";
        }
        const fs::path dest = fs::path(paths_.lv2Dir) / destName;
        fs::remove_all(dest, ec);
        fs::rename(bundle, dest, ec);
        if (ec) {
            fs::copy(bundle, dest, fs::copy_options::recursive, ec);
            if (ec) {
                error = "could not install " + destName;
                fs::remove_all(extractDir, ec);
                removeFile(archive);
                return false;
            }
        }
        directories.push(Json(destName));
        logInfo("plugins: installed " + dest.string());
    }

    fs::remove_all(extractDir, ec);
    removeFile(archive);

    Json registry = loadRegistry();
    Json remaining = Json::array();
    for (const Json& existing : registry["bundles"].items()) {
        if (existing["patchId"].asInt64() != patchId) {
            remaining.push(existing);
        }
    }
    Json record = Json::object();
    record.set("source", "patchstorage");
    record.set("patchId", static_cast<int>(patchId));
    record.set("title", patch["title"].asString());
    record.set("license", patch["license"]["name"].asString());
    record.set("url", patch["url"].asString());
    record.set("directories", directories);
    remaining.push(record);
    registry.set("bundles", remaining);
    saveRegistry(registry);
    return true;
}

void copyLiveNetwork(Json& json, const Json& live) {
    json.set("active", live["active"].asBool(false));
    json.set("device", live["device"].asString());
    json.set("ip", live["ip"].asString());
    json.set("url", live["url"].asString());
    json.set("otherConnection", live["otherConnection"].asBool(false));
    json.set("error", live["error"].asString());
    json.set("stationSsid", live["stationSsid"].asString());
    json.set("stationConnected", live["stationConnected"].asBool(false));
    if (live["networks"].isArray()) {
        json.set("networks", live["networks"]);
    }
}

Json PluginStore::updateStatus(const Json& payload, std::string& error) {
    Json args = Json::object();
    args.set("fetch", payload["fetch"].asBool(true));
    args.set("branch", payload["branch"].asString());
    return helperCall("update-status", args, error, 60);
}

Json PluginStore::updateInstall(const Json& payload, std::string& error) {
    Json args = Json::object();
    args.set("branch", payload["branch"].asString());
    return helperCall("update-install", args, error, 1800);
}

Json PluginStore::hotspotStatus(std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    Json stored = readHotspotFile(paths_);
    Json json = publicHotspot(stored);
    std::string helperError;
    Json live = helperCall("hotspot-status", Json::object(), helperError, 20);
    if (!helperError.empty()) {
        json.set("helperAvailable", false);
        json.set("active", false);
        json.set("otherConnection", false);
        json.set("stationConnected", false);
        json.set("error", helperError);
        return json;
    }
    json.set("helperAvailable", true);
    copyLiveNetwork(json, live);
    (void)error;
    return json;
}

Json PluginStore::hotspotConfig(std::string& error) {
    return hotspotStatus(error);
}

Json PluginStore::applyHotspot(const Json& payload, std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    Json stored = readHotspotFile(paths_);
    std::string mode = payload["mode"].asString(stored["mode"].asString("off"));
    if (mode != "off" && mode != "auto" && mode != "always") {
        error = "hotspot mode must be off, auto, or always";
        return Json::object();
    }
    std::string ssid = payload["ssid"].asString(stored["ssid"].asString("PI-MFX"));
    if (ssid.empty()) {
        ssid = "PI-MFX";
    }
    if (!printableHotspotText(ssid, 1, 32)) {
        error = "the hotspot name must be 1 to 32 printable characters";
        return Json::object();
    }
    std::string password = payload["password"].asString();
    if (password.empty()) {
        password = stored["password"].asString();
    }
    bool generated = false;
    if (mode != "off" && password.empty()) {
        password = toHex(randomBytes(8));
        generated = true;
    }
    if (mode != "off" && !printableHotspotText(password, 8, 63)) {
        error = "the hotspot password must be 8 to 63 printable characters";
        return Json::object();
    }

    Json next = Json::object();
    next.set("mode", mode);
    next.set("ssid", ssid);
    next.set("password", password);
    if (!writeHotspotFile(paths_, next, error)) {
        return Json::object();
    }

    Json json = publicHotspot(next);
    if (generated) {
        json.set("password", password);
        json.set("generatedPassword", true);
    }
    Json live = helperCall("hotspot-apply", Json::object(), error, 60);
    if (!error.empty()) {
        json.set("helperAvailable", false);
        json.set("error", error);
        return json;
    }
    json.set("helperAvailable", true);
    copyLiveNetwork(json, live);
    if (!live["error"].asString().empty()) {
        error = live["error"].asString();
    }
    return json;
}

Json PluginStore::wifiScan(std::string& error) {
    Json json = hotspotStatus(error);
    Json live = helperCall("wifi-scan", Json::object(), error, 40);
    if (!error.empty()) {
        json.set("helperAvailable", false);
        json.set("error", error);
        return json;
    }
    json.set("helperAvailable", true);
    copyLiveNetwork(json, live);
    if (!live["error"].asString().empty()) {
        error = live["error"].asString();
    }
    return json;
}

Json PluginStore::wifiConnect(const Json& payload, std::string& error) {
    const std::string ssid = payload["ssid"].asString();
    const std::string password = payload["password"].asString();
    if (!printableHotspotText(ssid, 1, 32)) {
        error = "the network name must be 1 to 32 printable characters";
        return Json::object();
    }
    if (!password.empty() && !printableHotspotText(password, 8, 63)) {
        error = "the Wi-Fi password must be 8 to 63 printable characters";
        return Json::object();
    }

    Json stored = readHotspotFile(paths_);
    if (stored["mode"].asString("off") != "off") {
        Json off = Json::object();
        off.set("mode", "off");
        off.set("ssid", stored["ssid"].asString("PI-MFX"));
        off.set("password", stored["password"].asString());
        applyHotspot(off, error);
        error.clear();
    }

    Json args = Json::object();
    args.set("ssid", ssid);
    args.set("password", password);
    Json live = helperCall("wifi-connect", args, error, 60);
    Json json = hotspotStatus(error);
    if (!error.empty() && !live.isObject()) {
        json.set("error", error);
        return json;
    }
    json.set("helperAvailable", true);
    copyLiveNetwork(json, live.isObject() ? live : json);
    json.set("password", readHotspotFile(paths_)["password"].asString());
    if (!live["error"].asString().empty()) {
        error = live["error"].asString();
        json.set("error", error);
    }
    return json;
}

Json PluginStore::wifiDisconnect(std::string& error) {
    Json live = helperCall("wifi-disconnect", Json::object(), error, 40);
    Json json = hotspotStatus(error);
    if (!error.empty() && !live.isObject()) {
        json.set("error", error);
        return json;
    }
    json.set("helperAvailable", true);
    copyLiveNetwork(json, live.isObject() ? live : json);
    if (!live["error"].asString().empty()) {
        error = live["error"].asString();
        json.set("error", error);
    }
    return json;
}

} // namespace pimfx
