#include "community/CommunityPresetPackage.h"

#include <cassert>
#include <iostream>

using namespace pimfx;

namespace {

Json validManifest() {
    Json slot = Json::object();
    slot.set("id", "slot-1");
    slot.set("uri", "urn:test:gain");
    slot.set("name", "Gain");
    slot.set("enabled", true);
    slot.set("state", Json::object());
    Json chain = Json::array(); chain.push(slot);

    Json preset = Json::object();
    preset.set("name", "Test"); preset.set("tempo", 120.0);
    preset.set("inputGainDb", 0.0); preset.set("outputGainDb", 0.0);
    preset.set("chain", chain); preset.set("snapshots", Json::array());
    preset.set("parameterBindings", Json::array());

    Json effect = Json::object(); effect.set("uri", "urn:test:gain");
    Json effects = Json::array(); effects.push(effect);
    Json deps = Json::object(); deps.set("effects", effects);
    deps.set("tone3000", Json::array()); deps.set("irs", Json::array());
    deps.set("localAssets", Json::array());

    Json manifest = Json::object();
    manifest.set("format", "pimfx-community-preset"); manifest.set("formatVersion", 2);
    manifest.set("id", "test-preset"); manifest.set("name", "Test");
    manifest.set("author", "Tester"); manifest.set("description", "Safe preset");
    manifest.set("tags", Json::array()); manifest.set("license", "MIT");
    Json compatibility = Json::object(); compatibility.set("minimumPiMfxVersion", "0.1.0");
    manifest.set("compatibility", compatibility); manifest.set("preset", preset);
    manifest.set("dependencies", deps); manifest.set("checksums", Json::object());
    return manifest;
}

} // namespace

int main() {
    std::string error;
    Json manifest = validManifest();
    if (!CommunityPresetPackage::validate(manifest, error)) {
        std::cerr << error << "\n";
        return 1;
    }
    assert(CommunityPresetPackage::checksum(manifest).size() == 64);
    const std::string fingerprint = CommunityPresetPackage::contentFingerprint(manifest);
    Json renamed = manifest; renamed.set("name", "A renamed duplicate"); renamed.set("id", "renamed");
    assert(CommunityPresetPackage::contentFingerprint(renamed) == fingerprint);

    Json unsafe = manifest;
    unsafe.set("downloadUrl", "https://evil.invalid/payload");
    assert(!CommunityPresetPackage::validate(unsafe, error));

    unsafe = manifest;
    Json deps = unsafe["dependencies"];
    Json assets = Json::array();
    Json asset = Json::object(); asset.set("kind", "model");
    asset.set("expectedFilename", "../escape.nam");
    asset.set("sha256", std::string(64, 'a')); assets.push(asset);
    deps.set("localAssets", assets); unsafe.set("dependencies", deps);
    assert(!CommunityPresetPackage::validate(unsafe, error));

    unsafe = manifest;
    Json preset = unsafe["preset"];
    Json chain = preset["chain"];
    Json slot = chain.at(0); slot.set("uri", "file:///tmp/plugin.so");
    Json changed = Json::array(); changed.push(slot); preset.set("chain", changed);
    unsafe.set("preset", preset);
    assert(!CommunityPresetPackage::validate(unsafe, error));

    unsafe = manifest;
    unsafe.set("harmlessLookingExtension", true);
    assert(!CommunityPresetPackage::validate(unsafe, error));

    unsafe = manifest;
    unsafe.set("description", "<script>alert(1)</script>");
    assert(!CommunityPresetPackage::validate(unsafe, error));

    Preset local;
    local.id = "local-id";
    local.name = "Local Clean";
    local.author = "Tester";
    Json metadata = Json::object();
    metadata.set("id", "local-clean"); metadata.set("name", "Local Clean");
    metadata.set("author", "Tester");
    metadata.set("description", "Created from the active preset");
    metadata.set("tags", Json::array());
    Json created = CommunityPresetPackage::create(local, Paths(), metadata, error);
    assert(error.empty());
    assert(CommunityPresetPackage::validate(created, error));
    assert(!created["preset"].has("id"));
    assert(!created["preset"].has("activeSnapshot"));

    std::cout << "community preset package tests passed\n";
    return 0;
}
