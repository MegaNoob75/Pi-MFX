#include "core/Paths.h"

#include "core/Log.h"

#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace fs = std::filesystem;

namespace pimfx {
namespace {

std::string environment(const char* name) {
    const char* value = std::getenv(name);
    return value ? std::string(value) : std::string();
}

} // namespace

Paths Paths::resolve(const std::string& overrideRoot) {
    Paths paths;

    std::string root = overrideRoot;
    if (root.empty()) {
        root = environment("PIMFX_DATA_ROOT");
    }
    if (root.empty()) {
        // The installed service owns /var/lib/pimfx. A developer build that
        // cannot write there falls back to a local directory rather than
        // failing to start.
        const std::string systemRoot = "/var/lib/pimfx";
        std::error_code ec;
        if (fs::exists(systemRoot, ec)) {
            root = systemRoot;
        } else {
            root = (fs::current_path(ec) / "pimfx-data").string();
        }
    }

    paths.dataRoot = root;
    paths.modelsDir = joinPath(root, "models");
    paths.irsDir = joinPath(root, "irs");
    paths.downloadsDir = joinPath(root, "downloads");
    paths.lv2Dir = joinPath(root, "lv2");

    paths.webRoot = environment("PIMFX_WEB_ROOT");
    if (paths.webRoot.empty()) {
        const std::string installed = "/usr/share/pimfx/web";
        std::error_code ec;
        paths.webRoot = fs::exists(installed, ec) ? installed : std::string("ui/dist");
    }

    makeDirectories(paths.dataRoot);
    makeDirectories(paths.banksDir());
    makeDirectories(paths.themesDir());
    makeDirectories(paths.modelsDir);
    makeDirectories(paths.irsDir);
    makeDirectories(paths.downloadsDir);
    makeDirectories(paths.lv2Dir);
    return paths;
}

std::string Paths::settingsFile() const { return joinPath(dataRoot, "settings.json"); }
std::string Paths::banksDir() const { return joinPath(dataRoot, "banks"); }
std::string Paths::controllerFile() const { return joinPath(dataRoot, "controller.json"); }
std::string Paths::themesDir() const { return joinPath(dataRoot, "themes"); }
std::string Paths::credentialsFile() const { return joinPath(dataRoot, "credentials.json"); }
std::string Paths::pluginsFile() const { return joinPath(dataRoot, "plugins.json"); }
std::string Paths::hotspotFile() const { return joinPath(dataRoot, "hotspot.json"); }
std::string Paths::patchstorageCacheFile() const { return joinPath(dataRoot, "patchstorage-cache.json"); }

bool fileExists(const std::string& path) {
    std::error_code ec;
    return fs::is_regular_file(path, ec);
}

bool directoryExists(const std::string& path) {
    std::error_code ec;
    return fs::is_directory(path, ec);
}

bool makeDirectories(const std::string& path) {
    if (path.empty()) {
        return false;
    }
    std::error_code ec;
    if (fs::is_directory(path, ec)) {
        return true;
    }
    fs::create_directories(path, ec);
    if (ec) {
        logWarn("cannot create directory " + path + ": " + ec.message());
        return false;
    }
    return true;
}

bool readFile(const std::string& path, std::string& out) {
    std::ifstream stream(path, std::ios::binary);
    if (!stream) {
        return false;
    }
    out.assign(std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>());
    return true;
}

bool writeFileAtomic(const std::string& path, const std::string& contents) {
    const std::string directory = parentPath(path);
    if (!directory.empty() && !makeDirectories(directory)) {
        return false;
    }

    const std::string temporary = path + ".tmp";
    {
        std::ofstream stream(temporary, std::ios::binary | std::ios::trunc);
        if (!stream) {
            logWarn("cannot write " + temporary);
            return false;
        }
        stream.write(contents.data(), static_cast<std::streamsize>(contents.size()));
        stream.flush();
        if (!stream) {
            logWarn("write failed for " + temporary);
            return false;
        }
    }

    std::error_code ec;
    fs::rename(temporary, path, ec);
    if (ec) {
        // Windows refuses to rename onto an existing file.
        fs::remove(path, ec);
        fs::rename(temporary, path, ec);
    }
    if (ec) {
        logWarn("cannot replace " + path + ": " + ec.message());
        fs::remove(temporary, ec);
        return false;
    }
    return true;
}

bool removeFile(const std::string& path) {
    std::error_code ec;
    return fs::remove(path, ec);
}

std::vector<std::string> listDirectory(const std::string& path, const std::string& suffix) {
    std::vector<std::string> out;
    std::error_code ec;
    if (!fs::is_directory(path, ec)) {
        return out;
    }
    for (const fs::directory_entry& entry : fs::directory_iterator(path, ec)) {
        if (!entry.is_regular_file(ec)) {
            continue;
        }
        const std::string name = entry.path().filename().string();
        if (!suffix.empty()) {
            if (name.size() < suffix.size()
                || name.compare(name.size() - suffix.size(), suffix.size(), suffix) != 0) {
                continue;
            }
        }
        out.push_back(entry.path().string());
    }
    std::sort(out.begin(), out.end());
    return out;
}

std::string joinPath(const std::string& a, const std::string& b) {
    if (a.empty()) {
        return b;
    }
    if (b.empty()) {
        return a;
    }
    return (fs::path(a) / b).string();
}

std::string fileName(const std::string& path) {
    return fs::path(path).filename().string();
}

std::string fileStem(const std::string& path) {
    return fs::path(path).stem().string();
}

std::string parentPath(const std::string& path) {
    return fs::path(path).parent_path().string();
}

std::string sanitizeFileName(const std::string& text) {
    std::string out;
    out.reserve(text.size());
    for (char c : text) {
        const bool safe = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                       || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == ' ' || c == '.';
        out.push_back(safe ? c : '_');
    }
    // Leading dots would hide the file, and a bare ".." would escape the
    // directory, so neither is allowed to survive.
    while (!out.empty() && out.front() == '.') {
        out.erase(out.begin());
    }
    while (!out.empty() && (out.back() == ' ' || out.back() == '.')) {
        out.pop_back();
    }
    if (out.empty()) {
        out = "untitled";
    }
    if (out.size() > 120) {
        out.resize(120);
    }
    return out;
}

} // namespace pimfx
