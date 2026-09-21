#pragma once

#include "core/Json.h"
#include "core/Paths.h"
#include "model/Model.h"

#include <string>

namespace pimfx {

/// Strict declarative boundary for presets received from outside the device.
/// This class never installs, executes, or downloads package-supplied content.
class CommunityPresetPackage {
public:
    static constexpr int kFormatVersion = 2;

    static bool validate(const Json& manifest, std::string& error);
    static Json create(const Preset& preset, const Paths& paths,
                       const Json& metadata, std::string& error);
    static Preset presetFromManifest(const Json& manifest);
    static std::string checksum(const Json& manifest);
    /// Stable identity of the actual sound/settings. Display metadata and the
    /// catalog id are intentionally excluded so renaming cannot bypass the
    /// duplicate guard.
    static std::string contentFingerprint(const Json& manifest);
};

} // namespace pimfx
