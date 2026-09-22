#include "core/Paths.h"

#include "core/Log.h"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace fs = std::filesystem;

namespace pimfx {
bool resolveLibraryPath(const std::string& path, std::string& resolved) {
    std::error_code ec;
    fs::path ancestor = fs::absolute(fs::path(path), ec).lexically_normal();
    if (ec) return false;
    std::vector<fs::path> missing;
    for (;;) {
        const auto status = fs::symlink_status(ancestor, ec);
        if (ec && ec != std::errc::no_such_file_or_directory) return false;
        if (!ec && status.type() != fs::file_type::not_found) break;
        ec.clear();
        const auto parent = ancestor.parent_path();
        if (parent.empty() || parent == ancestor) return false;
        missing.push_back(ancestor.filename()); ancestor = parent;
    }
    fs::path result = fs::canonical(ancestor, ec);
    if (ec) return false;
    for (auto it = missing.rbegin(); it != missing.rend(); ++it) result /= *it;
    resolved = result.string(); return true;
}

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
    paths.aidaxDir = joinPath(root, "aidax");
    paths.irsDir = joinPath(root, "irs");
    paths.downloadsDir = joinPath(root, "downloads");
    paths.lv2Dir = joinPath(root, "lv2");
    paths.layoutsDir = joinPath(root, "layouts");
    paths.backupsDir = joinPath(root, "backups");
    paths.bankExportsDir = joinPath(root, "bank-exports");
    paths.backingTracksDir = joinPath(root, "backing-tracks");
    paths.loopsDir = joinPath(root, "loops");
    paths.recordingsDir = joinPath(root, "recordings");
    paths.drumsDir = joinPath(root, "drums");
    paths.communityDir = joinPath(root, "community");

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
    makeDirectories(paths.aidaxDir);
    makeDirectories(paths.irsDir);
    makeDirectories(joinPath(paths.modelsDir, "TONE3000"));
    makeDirectories(joinPath(paths.irsDir, "TONE3000"));
    makeDirectories(paths.downloadsDir);
    makeDirectories(paths.lv2Dir);
    makeDirectories(paths.layoutsDir);
    makeDirectories(paths.backupsDir);
    makeDirectories(paths.bankExportsDir);
    makeDirectories(paths.backingTracksDir);
    makeDirectories(paths.loopsDir);
    makeDirectories(paths.recordingsDir);
    makeDirectories(paths.drumsDir);
    makeDirectories(paths.communityDir);
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
std::string Paths::tone3000CacheFile() const { return joinPath(dataRoot, "tone3000-cache.json"); }
std::string Paths::tone3000AssetsFile() const { return joinPath(dataRoot, "tone3000-assets.json"); }

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

namespace {

std::string lowerCopy(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

const char* skipUtf8BomAndSpace(const char* data, size_t size, size_t& remaining) {
    const char* p = data;
    remaining = size;
    if (remaining >= 3 && static_cast<unsigned char>(p[0]) == 0xEF
        && static_cast<unsigned char>(p[1]) == 0xBB
        && static_cast<unsigned char>(p[2]) == 0xBF) {
        p += 3;
        remaining -= 3;
    }
    while (remaining > 0 && std::isspace(static_cast<unsigned char>(*p))) {
        ++p;
        --remaining;
    }
    return p;
}

std::string jsonStringField(const std::string& text, const char* key) {
    const std::string needle = std::string("\"") + key + "\"";
    const auto pos = text.find(needle);
    if (pos == std::string::npos) {
        return std::string();
    }
    auto colon = text.find(':', pos + needle.size());
    if (colon == std::string::npos) {
        return std::string();
    }
    ++colon;
    while (colon < text.size() && std::isspace(static_cast<unsigned char>(text[colon]))) {
        ++colon;
    }
    if (colon >= text.size() || text[colon] != '"') {
        return std::string();
    }
    ++colon;
    std::string value;
    while (colon < text.size() && text[colon] != '"') {
        if (text[colon] == '\\' && colon + 1 < text.size()) {
            value.push_back(text[colon + 1]);
            colon += 2;
            continue;
        }
        value.push_back(text[colon]);
        ++colon;
    }
    return value;
}

bool namVersionIsA2(const std::string& version) {
    int major = 0;
    int minor = 0;
    int patch = 0;
    if (std::sscanf(version.c_str(), "%d.%d.%d", &major, &minor, &patch) < 2) {
        return false;
    }
    return major > 0 || minor > 5 || (minor == 5 && patch > 4);
}

std::string readPrefix(const std::string& path, size_t maxBytes) {
    std::ifstream stream(path, std::ios::binary);
    if (!stream) {
        return std::string();
    }
    std::string out(maxBytes, '\0');
    stream.read(out.data(), static_cast<std::streamsize>(maxBytes));
    out.resize(static_cast<size_t>(stream.gcount()));
    return out;
}

} // namespace

SniffedFile sniffBytes(const void* data, size_t size) {
    if (!data || size == 0) {
        return SniffedFile::Empty;
    }
    const auto* raw = static_cast<const unsigned char*>(data);
    if (size >= 4 && std::memcmp(raw, "RIFF", 4) == 0) {
        return SniffedFile::Impulse;
    }
    if (size >= 4 && std::memcmp(raw, "fLaC", 4) == 0) {
        return SniffedFile::Impulse;
    }
    if (size >= 4 && std::memcmp(raw, "FORM", 4) == 0) {
        return SniffedFile::Impulse;
    }
    if (size >= 2 && raw[0] == 0x1f && raw[1] == 0x8b) {
        return SniffedFile::Gzip;
    }
    if (size >= 4 && raw[0] == 'P' && raw[1] == 'K' && raw[2] == 3 && raw[3] == 4) {
        return SniffedFile::Zip;
    }

    size_t remaining = size;
    const char* text = skipUtf8BomAndSpace(reinterpret_cast<const char*>(data), size, remaining);
    if (remaining == 0) {
        return SniffedFile::Empty;
    }
    if (text[0] == '<' || (remaining >= 5 && lowerCopy(std::string(text, text + 5)) == "<!doc")) {
        return SniffedFile::Html;
    }
    if (text[0] != '{') {
        return SniffedFile::Other;
    }

    const size_t sample = remaining < 4096 ? remaining : 4096;
    const std::string head(text, text + sample);
    const std::string architecture = jsonStringField(head, "architecture");
    if (!architecture.empty()) {
        return SniffedFile::Nam;
    }
    if (head.find("\"layers\"") != std::string::npos
        && (head.find("lstm") != std::string::npos || head.find("gru") != std::string::npos
            || head.find("dense") != std::string::npos || head.find("conv1d") != std::string::npos)) {
        return SniffedFile::Aidax;
    }
    return SniffedFile::Nam;
}

SniffedFile sniffFile(const std::string& path) {
    if (!fileExists(path)) {
        return SniffedFile::Missing;
    }
    const std::string prefix = readPrefix(path, 4096);
    return sniffBytes(prefix.data(), prefix.size());
}

std::string sniffedFileLabel(SniffedFile kind) {
    switch (kind) {
    case SniffedFile::Missing: return "missing";
    case SniffedFile::Empty: return "empty";
    case SniffedFile::Nam: return "NAM";
    case SniffedFile::Aidax: return "AIDA-X";
    case SniffedFile::Impulse: return "IR";
    case SniffedFile::Html: return "HTML";
    case SniffedFile::Gzip: return "gzip";
    case SniffedFile::Zip: return "zip";
    case SniffedFile::Other: return "unknown";
    }
    return "unknown";
}

std::string describeModelFile(const std::string& path) {
    std::error_code ec;
    const uintmax_t bytes = fs::file_size(path, ec);
    const SniffedFile kind = sniffFile(path);
    std::string line = sniffedFileLabel(kind);
    if (!ec) {
        line += ", " + std::to_string(bytes) + " bytes";
    }
    if (kind == SniffedFile::Nam || kind == SniffedFile::Aidax) {
        const std::string head = readPrefix(path, 65536);
        const std::string architecture = jsonStringField(head, "architecture");
        const std::string version = jsonStringField(head, "version");
        if (!architecture.empty()) {
            line += ", " + architecture;
        }
        if (!version.empty()) {
            line += " v" + version;
            if (namVersionIsA2(version)) {
                line += " (A2)";
            }
        }
    }
    return line;
}

std::string namModelRejectReason(const std::string& path) {
    switch (sniffFile(path)) {
    case SniffedFile::Missing:
        return "that NAM file is not on disk: " + path;
    case SniffedFile::Empty:
        return "that file is empty, so TooB NAM cannot load it";
    case SniffedFile::Impulse:
        return "that's a cabinet IR (WAV/FLAC), not a NAM. Load it in TooB Cab IR.";
    case SniffedFile::Html:
        return "that file is a web page, not a NAM (the download did not land a model)";
    case SniffedFile::Gzip:
        return "that file is gzip-compressed, not a NAM. Re-download it.";
    case SniffedFile::Zip:
        return "that file is a zip archive, not a NAM";
    case SniffedFile::Other:
        return "TooB NAM cannot read that file (it is not NAM JSON)";
    case SniffedFile::Nam:
    case SniffedFile::Aidax:
        return std::string();
    }
    return std::string();
}

} // namespace pimfx
