#include "community/CommunityPresetPackage.h"

#include "core/Crypto.h"
#include "model/Storage.h"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <set>

namespace pimfx {
namespace {

constexpr size_t kMaxManifestBytes = 1024u * 1024u;
constexpr const char* kTooBNamUri = "http://two-play.com/plugins/toob-nam";
constexpr const char* kTooBCabIrUri = "http://two-play.com/plugins/toob-cab-ir";

std::string lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return value;
}

bool safeId(const std::string& value, size_t maximum = 80) {
    if (value.empty() || value.size() > maximum) return false;
    for (unsigned char c : value) {
        if (!std::isalnum(c) && c != '-' && c != '_' && c != '.') return false;
    }
    return true;
}

bool safeFileName(const std::string& value) {
    if (value.empty() || value.size() > 180 || value == "." || value == "..") return false;
    return value.find('/') == std::string::npos
        && value.find('\\') == std::string::npos
        && value.find(':') == std::string::npos;
}

bool sha256Text(const std::string& value) {
    if (value.size() != 64) return false;
    return std::all_of(value.begin(), value.end(), [](unsigned char c) {
        return std::isdigit(c) || (c >= 'a' && c <= 'f');
    });
}

bool semanticVersion(const std::string& value) {
    int dots = 0;
    if (value.empty() || value.size() > 32) return false;
    for (unsigned char c : value) {
        if (c == '.') { ++dots; continue; }
        if (!std::isdigit(c)) return false;
    }
    return dots == 2;
}

bool forbiddenKey(const std::string& key) {
    const std::string name = lower(key);
    if (name == "url" || (name.size() > 3 && name.compare(name.size() - 3, 3, "url") == 0)) return true;
    return name == "script" || name == "scripts" || name == "command"
        || name == "commands" || name == "executable" || name == "javascript"
        || name == "html" || name == "svg" || name == "symlink" || name == "installer";
}

bool validateTree(const Json& value, const std::string& key, int depth, std::string& error) {
    if (depth > 20) {
        error = "the manifest is nested too deeply";
        return false;
    }
    if (value.isString()) {
        const std::string text = value.asString();
        if (text.size() > 16384) {
            error = "a manifest string exceeds 16 KiB";
            return false;
        }
        const std::string folded = lower(text);
        if (key != "uri" && (folded.rfind("http://", 0) == 0 || folded.rfind("https://", 0) == 0
                             || folded.rfind("file:", 0) == 0 || folded.rfind("data:", 0) == 0
                             || folded.rfind("javascript:", 0) == 0)) {
            error = "packages cannot contain download URLs or data URLs";
            return false;
        }
        if (folded.find("<script") != std::string::npos || folded.find("<html") != std::string::npos
            || folded.find("<svg") != std::string::npos || folded.rfind("#!", 0) == 0) {
            error = "packages cannot contain scripts or markup";
            return false;
        }
        return true;
    }
    if (value.isArray()) {
        if (value.size() > 256) {
            error = "a manifest array has too many entries";
            return false;
        }
        for (const Json& item : value.items()) {
            if (!validateTree(item, key, depth + 1, error)) return false;
        }
    } else if (value.isObject()) {
        if (value.members().size() > 256) {
            error = "a manifest object has too many fields";
            return false;
        }
        for (const Json::Member& member : value.members()) {
            if (forbiddenKey(member.first)) {
                error = "forbidden manifest field: " + member.first;
                return false;
            }
            if (!validateTree(member.second, member.first, depth + 1, error)) return false;
        }
    }
    return true;
}

bool requireString(const Json& object, const char* key, size_t maximum, std::string& error) {
    const std::string value = object[key].asString();
    if (value.empty() || value.size() > maximum) {
        error = std::string("invalid or missing ") + key;
        return false;
    }
    return true;
}

bool allowedKeys(const Json& object, std::initializer_list<const char*> allowed,
                 const char* label, std::string& error) {
    if (!object.isObject()) { error = std::string(label) + " must be an object"; return false; }
    for (const Json::Member& member : object.members()) {
        bool found = false;
        for (const char* key : allowed) if (member.first == key) { found = true; break; }
        if (!found) {
            error = std::string("unknown ") + label + " field: " + member.first;
            return false;
        }
    }
    return true;
}

bool allowedAssetExtension(const std::string& file, const std::string& kind) {
    const std::string extension = lower(std::filesystem::path(file).extension().string());
    if (kind == "ir") return extension == ".wav";
    if (kind == "aidax") return extension == ".json" || extension == ".aidax";
    return extension == ".nam";
}

bool validateAsset(const Json& item, bool providerRequired, std::string& error) {
    if (!item.isObject() || !requireString(item, "expectedFilename", 180, error)
        || !safeFileName(item["expectedFilename"].asString())) {
        if (error.empty()) error = "an asset has an unsafe filename";
        return false;
    }
    if (!sha256Text(item["sha256"].asString())) {
        error = "an asset has an invalid SHA-256 checksum";
        return false;
    }
    if (providerRequired && (!requireString(item, "provider", 40, error)
        || !requireString(item, "sourceId", 120, error))) return false;
    return true;
}

Json cleanState(const Json& state, const std::string& pluginUri, const Paths& paths,
                Json& localAssets, std::string& error) {
    if (!state.isObject() || !state["properties"].isObject()) return state;
    Json properties = Json::object();
    for (const Json::Member& property : state["properties"].members()) {
        const std::string path = property.second.asString();
        if (path.empty()) {
            properties.set(property.first, Json(""));
            continue;
        }
        const std::string resolved = Storage(paths).resolveLibraryFile(path, error);
        if (resolved.empty()) return Json();
        std::string bytes;
        if (!readFile(resolved, bytes)) {
            error = "could not read " + fileName(resolved) + " for sharing";
            return Json();
        }
        const std::string extension = lower(std::filesystem::path(resolved).extension().string());
        if (extension == ".nam" && pluginUri != kTooBNamUri) {
            error = "community NAM files must use TooB Neural Amp Modeler";
            return Json();
        }
        if (extension == ".wav" && pluginUri != kTooBCabIrUri) {
            error = "community cabinet IR files must use TooB Cab IR";
            return Json();
        }
        Json dependency = Json::object();
        dependency.set("kind", extension == ".wav" ? "ir" : "model");
        dependency.set("expectedFilename", fileName(resolved));
        dependency.set("sha256", toHex(sha256(bytes)));
        localAssets.push(dependency);
        properties.set(property.first, fileName(resolved));
    }
    Json cleaned = state;
    cleaned.set("properties", properties);
    return cleaned;
}

} // namespace

bool CommunityPresetPackage::validate(const Json& manifest, std::string& error) {
    error.clear();
    if (!manifest.isObject() || manifest.dump().size() > kMaxManifestBytes) {
        error = "the community manifest is invalid or exceeds 1 MiB";
        return false;
    }
    if (!validateTree(manifest, std::string(), 0, error)) return false;
    if (!allowedKeys(manifest, {"format", "formatVersion", "id", "name", "author",
            "description", "tags", "license", "compatibility", "preset", "dependencies",
            "previews", "checksums"}, "manifest", error)) return false;
    if (manifest["format"].asString() != "pimfx-community-preset"
        || manifest["formatVersion"].asInt() != kFormatVersion) {
        error = "unsupported community preset format";
        return false;
    }
    if (manifest["description"].asString().size() > 2000 || !manifest["tags"].isArray()
        || manifest["tags"].size() > 12 || !manifest["compatibility"].isObject()
        || !manifest["checksums"].isObject()) {
        error = "the manifest metadata is invalid";
        return false;
    }
    if (!allowedKeys(manifest["compatibility"], {"minimumPiMfxVersion", "maximumPiMfxVersion",
            "architectures"}, "compatibility", error)
        || !requireString(manifest["compatibility"], "minimumPiMfxVersion", 32, error)) return false;
    if (!semanticVersion(manifest["compatibility"]["minimumPiMfxVersion"].asString())
        || (manifest["compatibility"].has("maximumPiMfxVersion")
            && !semanticVersion(manifest["compatibility"]["maximumPiMfxVersion"].asString()))) {
        error = "compatibility versions must use major.minor.patch";
        return false;
    }
    if (manifest["compatibility"].has("architectures")) {
        const Json& architectures = manifest["compatibility"]["architectures"];
        if (!architectures.isArray() || architectures.size() > 4) {
            error = "the architecture compatibility list is invalid";
            return false;
        }
        for (const Json& architecture : architectures.items()) {
            const std::string value = architecture.asString();
            if (value != "aarch64" && value != "armv7" && value != "x86_64") {
                error = "the package names an unsupported architecture";
                return false;
            }
        }
    }
    std::set<std::string> tags;
    for (const Json& tag : manifest["tags"].items()) {
        if (!tag.isString() || tag.asString().empty() || tag.asString().size() > 32) {
            error = "a manifest tag is invalid";
            return false;
        }
        if (!tags.insert(lower(tag.asString())).second) {
            error = "manifest tags must be unique";
            return false;
        }
    }
    for (const Json::Member& checksum : manifest["checksums"].members()) {
        if (!safeFileName(checksum.first) || !sha256Text(checksum.second.asString())) {
            error = "the package checksum map is invalid";
            return false;
        }
    }
    if (manifest.has("previews")) {
        if (!manifest["previews"].isArray() || manifest["previews"].size() > 2) {
            error = "the preview list is invalid";
            return false;
        }
        for (const Json& preview : manifest["previews"].items()) {
            if (!allowedKeys(preview, {"kind", "filename", "mediaType", "sha256"},
                             "preview", error)) return false;
            const std::string kind = preview["kind"].asString();
            const std::string filename = preview["filename"].asString();
            const bool valid = (kind == "image" && filename == "preview.webp"
                                && preview["mediaType"].asString() == "image/webp")
                || (kind == "audio" && filename == "preview.ogg"
                    && preview["mediaType"].asString() == "audio/ogg");
            if (!valid || !sha256Text(preview["sha256"].asString())) {
                error = "a preview entry is invalid";
                return false;
            }
        }
    }
    if (!safeId(manifest["id"].asString(), 64)
        || !requireString(manifest, "name", 80, error)
        || !requireString(manifest, "author", 80, error)
        || !requireString(manifest, "license", 80, error)) {
        if (error.empty()) error = "the package ID is invalid";
        return false;
    }
    if (manifest["license"].asString() != "MIT") {
        error = "community preset manifests must use the MIT license";
        return false;
    }
    if (!manifest["preset"].isObject()) {
        error = "the package has no preset";
        return false;
    }
    const Json& preset = manifest["preset"];
    if (!allowedKeys(preset, {"name", "author", "tempo", "inputGainDb", "outputGainDb",
            "chain", "snapshots", "parameterBindings"}, "preset", error)) return false;
    if (!requireString(preset, "name", 80, error)
        || preset["tempo"].asDouble(0.0) < 30.0 || preset["tempo"].asDouble(0.0) > 300.0
        || !preset["chain"].isArray() || preset["chain"].size() > 32
        || !preset["snapshots"].isArray() || preset["snapshots"].size() > 16
        || !preset["parameterBindings"].isArray() || preset["parameterBindings"].size() > 64) {
        if (error.empty()) error = "the preset structure is invalid";
        return false;
    }
    std::set<std::string> slotIds;
    std::set<std::string> effectUris;
    for (const Json& slot : preset["chain"].items()) {
        const std::string id = slot["id"].asString();
        const std::string uri = slot["uri"].asString();
        if (!allowedKeys(slot, {"id", "uri", "name", "enabled", "state", "tempoLinks"},
                         "effect slot", error)
            || !safeId(id) || !slotIds.insert(id).second
            || uri.empty() || uri.size() > 300
            || (uri.rfind("urn:", 0) != 0 && uri.rfind("http://", 0) != 0 && uri.rfind("https://", 0) != 0)
            || !slot["state"].isObject()) {
            error = "the preset contains an invalid effect slot";
            return false;
        }
        effectUris.insert(uri);
        for (const Json::Member& property : slot["state"]["properties"].members()) {
            if (!property.second.asString().empty() && !safeFileName(property.second.asString())) {
                error = "plugin file properties must contain filenames only";
                return false;
            }
            const std::string extension = lower(std::filesystem::path(property.second.asString()).extension().string());
            if (extension == ".nam" && uri != kTooBNamUri) {
                error = "community NAM files must use TooB Neural Amp Modeler";
                return false;
            }
            if (extension == ".wav" && uri != kTooBCabIrUri) {
                error = "community cabinet IR files must use TooB Cab IR";
                return false;
            }
        }
    }
    const Json& dependencies = manifest["dependencies"];
    if (!allowedKeys(dependencies, {"effects", "tone3000", "irs", "localAssets"},
                     "dependencies", error)) return false;
    if (!dependencies.isObject() || !dependencies["effects"].isArray()
        || !dependencies["tone3000"].isArray() || !dependencies["irs"].isArray()
        || !dependencies["localAssets"].isArray()) {
        error = "the dependency list is incomplete";
        return false;
    }
    std::set<std::string> declaredUris;
    for (const Json& effect : dependencies["effects"].items()) {
        if (!allowedKeys(effect, {"uri", "catalogId"}, "effect dependency", error)) return false;
        const std::string uri = effect["uri"].asString();
        if (uri.empty() || uri.size() > 300) {
            error = "an effect dependency has no URI";
            return false;
        }
        declaredUris.insert(uri);
    }
    if (declaredUris != effectUris) {
        error = "effect dependencies do not match the preset chain";
        return false;
    }
    if (dependencies["tone3000"].size() > 16 || dependencies["irs"].size() > 16
        || dependencies["localAssets"].size() > 16) {
        error = "the package declares too many assets";
        return false;
    }
    for (const Json& item : dependencies["tone3000"].items()) {
        if (!allowedKeys(item, {"toneId", "modelId", "architecture", "expectedFilename", "sha256",
                                "kind", "toneTitle", "creator", "sourceLicense"},
                         "TONE3000 dependency", error)) return false;
        if (!validateAsset(item, false, error) || !requireString(item, "modelId", 120, error)
            || !requireString(item, "toneId", 120, error)) return false;
        const std::string kind = item["kind"].asString("model");
        if ((kind != "model" && kind != "ir" && kind != "aidax")
            || !allowedAssetExtension(item["expectedFilename"].asString(), kind)) {
            error = "a TONE3000 asset has an invalid type or filename";
            return false;
        }
    }
    for (const Json& item : dependencies["irs"].items()) {
        if (!allowedKeys(item, {"provider", "sourceId", "expectedFilename", "sha256"},
                         "IR dependency", error)
            || !validateAsset(item, true, error)) return false;
        if (!allowedAssetExtension(item["expectedFilename"].asString(), "ir")) {
            error = "an IR dependency must name a WAV file";
            return false;
        }
    }
    for (const Json& item : dependencies["localAssets"].items()) {
        if (!allowedKeys(item, {"kind", "expectedFilename", "sha256"},
                         "local asset dependency", error)
            || !validateAsset(item, false, error)) return false;
        const std::string kind = item["kind"].asString();
        if (kind != "model" && kind != "ir" && kind != "aidax") {
            error = "a local asset has an invalid kind";
            return false;
        }
        if (!allowedAssetExtension(item["expectedFilename"].asString(), kind)) {
            error = "a local asset filename does not match its type";
            return false;
        }
    }
    return true;
}

Json CommunityPresetPackage::create(const Preset& preset, const Paths& paths,
                                    const Json& metadata, std::string& error) {
    error.clear();
    Json cleanPreset = preset.toJson();
    cleanPreset.remove("id");
    cleanPreset.remove("activeSnapshot");
    cleanPreset.remove("rememberedSnapshotSlot");
    cleanPreset.remove("rememberedSnapshotEnabled");
    cleanPreset.remove("community");
    cleanPreset.set("author", metadata["author"].asString(preset.author));

    Json effects = Json::array();
    Json localAssets = Json::array();
    Json chain = Json::array();
    for (const Json& incoming : cleanPreset["chain"].items()) {
        Json slot = incoming;
        slot.set("state", cleanState(incoming["state"], incoming["uri"].asString(), paths,
                                     localAssets, error));
        if (!error.empty()) return Json();
        chain.push(slot);
        Json effect = Json::object();
        effect.set("uri", incoming["uri"].asString());
        if (incoming["uri"].asString() == kTooBNamUri
            || incoming["uri"].asString() == kTooBCabIrUri) effect.set("catalogId", "toobamp");
        effects.push(effect);
    }
    cleanPreset.set("chain", chain);

    Json toneDependencies = metadata["tone3000"].isArray() ? metadata["tone3000"] : Json::array();
    Json provenance = Json::object();
    std::string provenanceText;
    std::string provenanceError;
    if (readFile(paths.tone3000AssetsFile(), provenanceText)) {
        Json parsed = Json::parse(provenanceText, &provenanceError);
        if (provenanceError.empty() && parsed.isObject()) provenance = parsed;
    }
    for (const Json& local : localAssets.items()) {
        const Json& source = provenance[local["sha256"].asString()];
        if (source["provider"].asString() != "tone3000"
            || source["toneId"].asString().empty() || source["modelId"].asString().empty()) continue;
        Json dependency = source;
        dependency.remove("provider");
        dependency.set("expectedFilename", local["expectedFilename"]);
        dependency.set("sha256", local["sha256"]);
        dependency.set("kind", local["kind"]);
        toneDependencies.push(dependency);
    }
    const Json irDependencies = metadata["irs"].isArray() ? metadata["irs"] : Json::array();
    Json unmatchedLocalAssets = Json::array();
    for (const Json& local : localAssets.items()) {
        bool matched = false;
        for (const Json& provider : toneDependencies.items()) {
            if (provider["expectedFilename"].asString() == local["expectedFilename"].asString()) matched = true;
        }
        for (const Json& provider : irDependencies.items()) {
            if (provider["expectedFilename"].asString() == local["expectedFilename"].asString()) matched = true;
        }
        if (!matched) unmatchedLocalAssets.push(local);
    }
    Json dependencies = Json::object();
    dependencies.set("effects", effects);
    dependencies.set("tone3000", toneDependencies);
    dependencies.set("irs", irDependencies);
    dependencies.set("localAssets", unmatchedLocalAssets);

    Json manifest = Json::object();
    manifest.set("format", "pimfx-community-preset");
    manifest.set("formatVersion", kFormatVersion);
    manifest.set("id", metadata["id"].asString());
    manifest.set("name", metadata["name"].asString(preset.name));
    manifest.set("author", metadata["author"].asString(preset.author));
    manifest.set("description", metadata["description"].asString());
    manifest.set("tags", metadata["tags"].isArray() ? metadata["tags"] : Json::array());
    manifest.set("license", "MIT");
    Json compatibility = Json::object();
    compatibility.set("minimumPiMfxVersion", metadata["minimumPiMfxVersion"].asString("0.1.0"));
    manifest.set("compatibility", compatibility);
    manifest.set("preset", cleanPreset);
    manifest.set("dependencies", dependencies);
    manifest.set("checksums", Json::object());
    if (!validate(manifest, error)) return Json();
    return manifest;
}

Preset CommunityPresetPackage::presetFromManifest(const Json& manifest) {
    Preset preset = Preset::fromJson(manifest["preset"]);
    preset.activeSnapshot = -1;
    preset.rememberedSnapshotSlot = -1;
    preset.rememberedSnapshotEnabled = false;
    return preset;
}

std::string CommunityPresetPackage::checksum(const Json& manifest) {
    return toHex(sha256(manifest.dump()));
}

std::string CommunityPresetPackage::contentFingerprint(const Json& manifest) {
    Json identity = manifest;
    for (const char* key : {"id", "name", "author", "description", "tags", "license",
                            "checksums", "previews"}) identity.remove(key);
    Json preset = identity["preset"];
    if (preset.isObject()) {
        preset.remove("name");
        preset.remove("author");
        identity.set("preset", preset);
    }
    return toHex(sha256(identity.dump()));
}

} // namespace pimfx
