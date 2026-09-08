#pragma once

#include "core/Paths.h"
#include "model/Model.h"

#include <string>
#include <vector>

namespace pimfx {

/// Reads and writes everything that survives a reboot.
///
/// Each bank is its own file so a corrupted or hand-edited bank costs the user
/// one bank rather than their whole rig, and so banks can be exported by
/// copying a single file.
class Storage {
public:
    explicit Storage(Paths paths);

    const Paths& paths() const { return paths_; }

    Settings loadSettings();
    bool saveSettings(const Settings& settings);

    /// Loads every bank. On first run this writes a starter bank so the user
    /// lands on something playable instead of an empty screen.
    std::vector<Bank> loadBanks();
    bool saveBank(const Bank& bank);
    bool deleteBank(const std::string& bankId);

    /// Files the user can pick in the model and IR browsers.
    struct LibraryEntry {
        std::string path;
        std::string name;
        std::string category; ///< sub-directory, used as a folder in the UI
        uint64_t bytes = 0;
        std::string source;   ///< "local" or "tone3000"
    };

    std::vector<LibraryEntry> listModels() const;
    std::vector<LibraryEntry> listAidax() const;
    std::vector<LibraryEntry> listImpulseResponses() const;

    /// Rejects any path outside the model, AIDA-X, IR, and user LV2 directories. Presets can name
    /// files, and a preset can arrive from someone else, so the path in one is
    /// never trusted.
    bool isPathInLibrary(const std::string& path) const;

private:
    std::string bankFile(const std::string& bankId) const;
    std::vector<LibraryEntry> listLibrary(const std::string& root,
                                          const std::vector<std::string>& extensions) const;

    Paths paths_;
};

/// The bank a fresh install starts with: one clean preset, no plugins assumed
/// to be installed, so it loads on any machine.
Bank makeStarterBank();

} // namespace pimfx
