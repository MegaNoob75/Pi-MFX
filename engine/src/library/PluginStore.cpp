#include "library/PluginStore.h"

#include "core/Log.h"

#include <algorithm>
#include <cerrno>
#include <cctype>
#include <cstring>
#include <filesystem>
#include <fstream>
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
const char* kSuggested[] = {
    "calf-plugins",
    "x42-plugins",
    "zam-plugins",
    "guitarix-lv2",
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
        "Raspberry Pi guitar LV2 pack: NAM, cab IR, delay, reverb, EQ, modulation. Installs the project's arm64 .deb."
    }
};

namespace fs = std::filesystem;

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

bool endsWith(const std::string& text, const char* suffix) {
    const size_t length = std::strlen(suffix);
    return text.size() >= length && text.compare(text.size() - length, length, suffix) == 0;
}

std::string toLower(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
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

Json summarizePatch(const Json& item) {
    Json out = Json::object();
    out.set("id", item["id"].asInt());
    out.set("title", item["title"].asString());
    out.set("excerpt", item["excerpt"].asString());
    out.set("url", item["url"].asString());
    out.set("slug", item["slug"].asString());
    out.set("downloads", item["download_count"].asInt());
    out.set("author", item["author"]["name"].asString());
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
    std::lock_guard<std::mutex> lock(mutex_);
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
    json.set("recommended", recommendedUnlocked(false));
    json.set("bundles", installedBundles());
    return json;
}

Json PluginStore::helperCall(const std::string& op, const Json& args, std::string& error, int timeoutSeconds) {
#if defined(_WIN32)
    (void)op;
    (void)args;
    (void)timeoutSeconds;
    error = "apt and extra repos are only available on the Pi";
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
    if (!validPackageName(package)) {
        error = "that is not a valid package name";
        return false;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    Json args = Json::object();
    args.set("package", package);
    const Json reply = helperCall("apt-install", args, error, 180);
    return error.empty() && reply["ok"].asBool(false);
}

bool PluginStore::aptRemove(const std::string& package, std::string& error) {
    if (!validPackageName(package)) {
        error = "that is not a valid package name";
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
        item.set("installed", statusError.empty() && status["installed"].asBool(false));

        if (fetchLatest) {
            std::string latestError;
            const std::string url = std::string("https://api.github.com/repos/") + pack.repo + "/releases/latest";
            const Json release = httpsGet(url, latestError, 20);
            if (latestError.empty() && release.isObject()) {
                item.set("latestVersion", release["tag_name"].asString());
                item.set("latestName", release["name"].asString());
            }
        }
        list.push(item);
    }
    return list;
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
    const Json reply = helperCall("deb-install", args, error, 180);
    removeFile(dest);
    if (!error.empty()) {
        return false;
    }
    logInfo(std::string("plugins: installed ") + pack->title + " from GitHub");
    return reply["ok"].asBool(true);
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

Json PluginStore::patchstorageSearch(const Json& query, std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!resolvePatchstorageIds(error)) {
        return Json();
    }

    const int page = std::max(1, query["page"].asInt(1));
    const int perPage = std::min(40, std::max(1, query["perPage"].asInt(20)));
    const std::string search = query["query"].asString();

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

    Json items = Json::array();
    const Json list = result.isArray() ? result : result["items"];
    for (const Json& item : list.items()) {
        items.push(summarizePatch(item));
    }

    Json wrapper = Json::object();
    wrapper.set("items", items);
    wrapper.set("page", page);
    wrapper.set("platformId", platformId_);
    wrapper.set("targetId", targetId_);
    wrapper.set("target", "rpi-aarch64");
    return wrapper;
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
    if (endsWith(lower, ".zip")) {
        listArgs = {"unzip", "-Z1", archive};
        extractArgs = {"unzip", "-q", "-o", archive, "-d", dest};
    } else if (endsWith(lower, ".tar.xz") || endsWith(lower, ".txz")) {
        listArgs = {"tar", "-tJf", archive};
        extractArgs = {"tar", "-xJf", archive, "-C", dest, "--no-same-owner", "--no-absolute-filenames"};
    } else if (endsWith(lower, ".tar.bz2") || endsWith(lower, ".tbz2")) {
        listArgs = {"tar", "-tjf", archive};
        extractArgs = {"tar", "-xjf", archive, "-C", dest, "--no-same-owner", "--no-absolute-filenames"};
    } else {
        listArgs = {"tar", "-tzf", archive};
        extractArgs = {"tar", "-xzf", archive, "-C", dest, "--no-same-owner", "--no-absolute-filenames"};
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
    return json;
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

} // namespace pimfx
