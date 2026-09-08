#include "model/Storage.h"

#include "core/Log.h"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <system_error>

namespace fs = std::filesystem;

namespace pimfx {

Storage::Storage(Paths paths) : paths_(std::move(paths)) {}

Settings Storage::loadSettings() {
    std::string contents;
    if (!readFile(paths_.settingsFile(), contents)) {
        logInfo("settings: no settings file yet, starting from defaults");
        return Settings();
    }

    std::string error;
    const Json json = Json::parse(contents, &error);
    if (!error.empty()) {
        // Keep the unreadable file rather than overwriting it: it may be the
        // only record of the user's device configuration.
        const std::string backup = paths_.settingsFile() + ".broken";
        writeFileAtomic(backup, contents);
        logError("settings: cannot parse settings.json (" + error + "); kept a copy at " + backup);
        return Settings();
    }
    return Settings::fromJson(json);
}

bool Storage::saveSettings(const Settings& settings) {
    return writeFileAtomic(paths_.settingsFile(), settings.toJson().dump(2));
}

std::string Storage::bankFile(const std::string& bankId) const {
    return joinPath(paths_.banksDir(), sanitizeFileName(bankId) + ".json");
}

std::vector<Bank> Storage::loadBanks() {
    std::vector<Bank> banks;

    for (const std::string& file : listDirectory(paths_.banksDir(), ".json")) {
        std::string contents;
        if (!readFile(file, contents)) {
            continue;
        }
        std::string error;
        const Json json = Json::parse(contents, &error);
        if (!error.empty()) {
            logError("banks: skipping " + fileName(file) + " (" + error + ")");
            continue;
        }
        banks.push_back(Bank::fromJson(json));
    }

    if (banks.empty()) {
        Bank starter = makeStarterBank();
        saveBank(starter);
        banks.push_back(std::move(starter));
        logInfo("banks: created a starter bank");
    }

    const bool hasExplicitOrder = std::any_of(
        banks.begin(), banks.end(), [](const Bank& bank) { return bank.order != 0; });
    std::sort(banks.begin(), banks.end(),
              [hasExplicitOrder](const Bank& a, const Bank& b) {
                  if (hasExplicitOrder && a.order != b.order) {
                      return a.order < b.order;
                  }
                  return a.name < b.name;
              });
    return banks;
}

bool Storage::saveBank(const Bank& bank) {
    if (bank.id.empty()) {
        return false;
    }
    return writeFileAtomic(bankFile(bank.id), bank.toJson().dump(2));
}

bool Storage::deleteBank(const std::string& bankId) {
    return removeFile(bankFile(bankId));
}

std::vector<Storage::LibraryEntry> Storage::listLibrary(
    const std::string& root,
    const std::vector<std::string>& extensions) const {
    std::vector<LibraryEntry> entries;
    std::error_code ec;
    if (!fs::is_directory(root, ec)) {
        return entries;
    }

    for (fs::recursive_directory_iterator it(root, fs::directory_options::skip_permission_denied, ec);
         it != fs::recursive_directory_iterator(); it.increment(ec)) {
        if (ec) {
            break;
        }
        if (!it->is_regular_file(ec)) {
            continue;
        }
        std::string extension = it->path().extension().string();
        std::transform(extension.begin(), extension.end(), extension.begin(),
                       [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        if (std::find(extensions.begin(), extensions.end(), extension) == extensions.end()) {
            continue;
        }

        LibraryEntry entry;
        entry.path = it->path().string();
        entry.name = it->path().stem().string();
        entry.bytes = static_cast<uint64_t>(fs::file_size(it->path(), ec));
        entry.source = "local";

        const fs::path relative = fs::relative(it->path().parent_path(), root, ec);
        entry.category = (ec || relative.empty() || relative == ".") ? "" : relative.string();
        entries.push_back(std::move(entry));
    }

    std::sort(entries.begin(), entries.end(), [](const LibraryEntry& a, const LibraryEntry& b) {
        if (a.category != b.category) {
            return a.category < b.category;
        }
        return a.name < b.name;
    });
    return entries;
}

std::vector<Storage::LibraryEntry> Storage::listModels() const {
    return listLibrary(paths_.modelsDir, {".nam", ".json"});
}

std::vector<Storage::LibraryEntry> Storage::listAidax() const {
    return listLibrary(paths_.aidaxDir, {".aidax"});
}

std::vector<Storage::LibraryEntry> Storage::listImpulseResponses() const {
    return listLibrary(paths_.irsDir, {".wav", ".flac", ".aiff", ".aif"});
}

bool Storage::isPathInLibrary(const std::string& path) const {
    std::error_code ec;
    const fs::path candidate = fs::weakly_canonical(fs::path(path), ec);
    if (ec) {
        return false;
    }
    for (const std::string& root : {paths_.modelsDir, paths_.aidaxDir, paths_.irsDir, paths_.lv2Dir}) {
        const fs::path base = fs::weakly_canonical(fs::path(root), ec);
        if (ec) {
            continue;
        }
        auto candidateIt = candidate.begin();
        auto baseIt = base.begin();
        bool prefix = true;
        for (; baseIt != base.end(); ++baseIt, ++candidateIt) {
            if (candidateIt == candidate.end() || *candidateIt != *baseIt) {
                prefix = false;
                break;
            }
        }
        if (prefix) {
            return true;
        }
    }
    return false;
}

std::string Storage::resolveLibraryFile(const std::string& path) const {
    if (path.empty()) {
        return std::string();
    }
    std::error_code ec;
    if (fs::is_regular_file(path, ec) && isPathInLibrary(path)) {
        const fs::path canonical = fs::weakly_canonical(fs::path(path), ec);
        return ec ? path : canonical.string();
    }

    const std::string wantedName = fs::path(path).filename().string();
    const std::string wantedStem = fs::path(path).stem().string();
    auto search = [&](const std::vector<LibraryEntry>& entries) -> std::string {
        for (const LibraryEntry& entry : entries) {
            if (fs::path(entry.path).filename().string() == wantedName) {
                return entry.path;
            }
        }
        if (wantedStem.empty()) {
            return std::string();
        }
        for (const LibraryEntry& entry : entries) {
            if (entry.name == wantedStem) {
                return entry.path;
            }
        }
        return std::string();
    };

    std::string hit = search(listModels());
    if (hit.empty()) {
        hit = search(listAidax());
    }
    if (hit.empty()) {
        hit = search(listImpulseResponses());
    }
    return hit;
}

Bank makeStarterBank() {
    Bank bank;
    bank.id = "default";
    bank.name = "My Bank";

    // Deliberately empty chains. Assuming a plugin is installed would mean a
    // starter bank that fails to load on a machine that does not have it.
    static const char* names[] = {"Clean", "Crunch", "Lead", "Ambient"};
    for (const char* name : names) {
        Preset preset;
        preset.id = newId("preset");
        preset.name = name;
        bank.presets.push_back(std::move(preset));
    }
    return bank;
}

} // namespace pimfx
