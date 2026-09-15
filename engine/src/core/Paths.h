#pragma once

#include <string>
#include <vector>

namespace pimfx {

/// Where Pi-MFX keeps its state.
///
/// On the Pi the service runs as a dedicated user with a fixed data root
/// (`/var/lib/pimfx`). During development the root falls back to a directory
/// beside the working directory so a dev build never writes to system paths.
struct Paths {
    std::string dataRoot;     ///< settings.json, banks/, snapshots/
    std::string webRoot;      ///< built UI served over HTTP
    std::string modelsDir;    ///< NAM captures
    std::string aidaxDir;     ///< AIDA-X captures
    std::string irsDir;       ///< impulse responses
    std::string downloadsDir; ///< partial TONE3000 downloads
    std::string lv2Dir;       ///< user-installed LV2 bundles (PatchStorage, copies)
    std::string layoutsDir;   ///< named Performance layout JSON
    std::string backupsDir;   ///< UI backup JSON
    std::string bankExportsDir; ///< exported bank JSON copies
    std::string backingTracksDir; ///< imported backing-track audio and set lists
    std::string loopsDir;      ///< safely saved stereo looper WAV files
    std::string recordingsDir; ///< multitrack projects, takes, recovery data and exports

    static Paths resolve(const std::string& overrideRoot = std::string());

    std::string settingsFile() const;
    std::string banksDir() const;
    std::string controllerFile() const;
    std::string themesDir() const;
    std::string credentialsFile() const;
    std::string pluginsFile() const;
    std::string hotspotFile() const;
    std::string patchstorageCacheFile() const;
    std::string tone3000CacheFile() const;
};

bool fileExists(const std::string& path);
bool directoryExists(const std::string& path);

/// Creates `path` and any missing parents. Returns false only on real errors,
/// not when the directory already exists.
bool makeDirectories(const std::string& path);

bool readFile(const std::string& path, std::string& out);

/// Writes to a temporary file in the same directory and renames it into place,
/// so a power cut mid-save cannot truncate a bank or the settings file.
bool writeFileAtomic(const std::string& path, const std::string& contents);

bool removeFile(const std::string& path);

std::vector<std::string> listDirectory(const std::string& path, const std::string& suffix = std::string());

std::string joinPath(const std::string& a, const std::string& b);
std::string fileName(const std::string& path);
std::string fileStem(const std::string& path);
std::string parentPath(const std::string& path);

/// Turns arbitrary user text into something safe to use as a file name.
std::string sanitizeFileName(const std::string& text);

/// What a library file actually is, from its first bytes — not from the
/// extension. TONE3000 amp-cab tones ship NAMs and cab IRs in the same list,
/// and a .nam suffix on a WAV is how TooB ends up printing "Can't load model".
enum class SniffedFile {
    Missing,
    Empty,
    Nam,
    Aidax,
    Impulse,
    Html,
    Gzip,
    Zip,
    Other
};

SniffedFile sniffBytes(const void* data, size_t size);
SniffedFile sniffFile(const std::string& path);
std::string sniffedFileLabel(SniffedFile kind);

/// One-line description for the journal: kind, size, NAM architecture/version.
std::string describeModelFile(const std::string& path);

/// Empty if TooB NAM / NeuralAudio can reasonably open this path. Otherwise a
/// sentence suitable for the UI and the journal.
std::string namModelRejectReason(const std::string& path);

} // namespace pimfx
