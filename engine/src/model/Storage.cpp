#include "model/Storage.h"

#include "core/Log.h"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <sstream>
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

std::string Storage::bankFileStem(const std::string& bankId) const {
    const std::string safe = sanitizeFileName(bankId);
    if (safe == bankId) {
        return safe;
    }
    std::uint32_t hash = 2166136261u;
    for (unsigned char c : bankId) {
        hash ^= c;
        hash *= 16777619u;
    }
    std::ostringstream out;
    out << safe << "-" << std::hex << hash;
    return out.str();
}

std::string Storage::bankFile(const std::string& bankId) const {
    return joinPath(paths_.banksDir(), bankFileStem(bankId) + ".json");
}

std::vector<Bank> Storage::loadBanks() {
    std::vector<Bank> banks;
    brokenBankFiles_.clear();

    for (const std::string& file : listDirectory(paths_.banksDir(), ".json")) {
        std::string contents;
        if (!readFile(file, contents)) {
            continue;
        }
        std::string error;
        const Json json = Json::parse(contents, &error);
        if (!error.empty()) {
            const std::string broken = file + ".broken";
            std::error_code ec;
            fs::rename(file, broken, ec);
            brokenBankFiles_.push_back(fileName(file));
            logError("banks: moved corrupt " + fileName(file) + " to " + fileName(broken)
                     + " (" + error + ")");
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
    const std::string path = bankFile(bank.id);
    if (fileExists(path)) {
        std::string contents;
        std::string parseError;
        if (readFile(path, contents)) {
            const Json json = Json::parse(contents, &parseError);
            const std::string existingId = json["id"].asString();
            if (parseError.empty() && !existingId.empty() && existingId != bank.id) {
                logError("banks: refusing to overwrite " + fileName(path)
                         + " (id " + existingId + ") with bank " + bank.id);
                return false;
            }
        }
    }
    return writeFileAtomic(path, bank.toJson().dump(2));
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
    for (const std::string& root : {
             paths_.modelsDir, paths_.aidaxDir, paths_.irsDir, paths_.lv2Dir,
             paths_.layoutsDir, paths_.backupsDir, paths_.bankExportsDir,
             paths_.backingTracksDir, paths_.themesDir()}) {
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
    std::string error;
    return resolveLibraryFile(path, error);
}

std::string Storage::resolveLibraryFile(const std::string& path, std::string& error) const {
    error.clear();
    if (path.empty()) {
        return std::string();
    }
    std::error_code ec;
    if (fs::is_regular_file(path, ec) && isPathInLibrary(path)) {
        const fs::path canonical = fs::weakly_canonical(fs::path(path), ec);
        return ec ? path : canonical.string();
    }

    const fs::path incoming(path);
    const std::string wantedName = incoming.filename().string();
    const std::string wantedStem = incoming.stem().string();
    std::vector<std::string> parts;
    for (const auto& part : incoming) {
        const std::string raw = part.string();
        if (raw.empty() || raw == "." || raw == ".." || raw == incoming.root_name().string()
            || (raw.size() == 1 && (raw[0] == '/' || raw[0] == '\\'))) {
            continue;
        }
        parts.push_back(raw);
    }

    const std::vector<std::string> roots = {paths_.modelsDir, paths_.aidaxDir, paths_.irsDir};

    for (const std::string& root : roots) {
        for (size_t start = 0; start < parts.size(); ++start) {
            fs::path candidate = fs::path(root);
            for (size_t i = start; i < parts.size(); ++i) {
                candidate /= parts[i];
            }
            if (fs::is_regular_file(candidate, ec) && isPathInLibrary(candidate.string())) {
                const fs::path canonical = fs::weakly_canonical(candidate, ec);
                return ec ? candidate.string() : canonical.string();
            }
        }
    }

    std::vector<std::string> nameHits;
    std::vector<std::string> stemHits;
    auto collect = [&](const std::vector<LibraryEntry>& entries) {
        for (const LibraryEntry& entry : entries) {
            if (!wantedName.empty() && fs::path(entry.path).filename().string() == wantedName) {
                nameHits.push_back(entry.path);
            } else if (!wantedStem.empty() && entry.name == wantedStem) {
                stemHits.push_back(entry.path);
            }
        }
    };
    collect(listModels());
    collect(listAidax());
    collect(listImpulseResponses());

    auto uniqueHit = [&](const std::vector<std::string>& hits, const std::string& label) -> std::string {
        if (hits.size() == 1) {
            return hits.front();
        }
        if (hits.size() > 1) {
            error = "more than one library file is named " + label;
            return std::string();
        }
        return std::string();
    };

    std::string hit = uniqueHit(nameHits, wantedName);
    if (!hit.empty() || !error.empty()) {
        return hit;
    }
    hit = uniqueHit(stemHits, wantedStem);
    if (hit.empty() && error.empty()) {
        error = "can't find that file in the library (" + fileName(path) + ")";
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
