#include "model/Model.h"

#include "core/Crypto.h"

#include <algorithm>

namespace pimfx {

std::string newId(const std::string& prefix) {
    const std::vector<uint8_t> bytes = randomBytes(6);
    return prefix + "-" + toHex(bytes);
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

Json EffectSlot::toJson() const {
    Json json = Json::object();
    json.set("id", id);
    json.set("uri", uri);
    json.set("name", name);
    json.set("enabled", enabled);
    json.set("state", state);
    if (tempoLinks.isObject() && tempoLinks.size() > 0) {
        json.set("tempoLinks", tempoLinks);
    }
    return json;
}

EffectSlot EffectSlot::fromJson(const Json& json) {
    EffectSlot slot;
    slot.id = json["id"].asString(newId("slot"));
    slot.uri = json["uri"].asString();
    slot.name = json["name"].asString();
    slot.enabled = json["enabled"].asBool(true);
    slot.state = json["state"].isObject() ? json["state"] : Json::object();
    slot.tempoLinks = json["tempoLinks"].isObject() ? json["tempoLinks"] : Json::object();
    return slot;
}

Json Snapshot::toJson() const {
    Json json = Json::object();
    json.set("id", id);
    json.set("name", name);
    json.set("slots", slots);
    json.set("slot", slot);
    if (!color.empty()) {
        json.set("color", color);
    }
    return json;
}

Snapshot Snapshot::fromJson(const Json& json) {
    Snapshot snapshot;
    snapshot.id = json["id"].asString(newId("snap"));
    snapshot.name = json["name"].asString("Snapshot");
    snapshot.slots = json["slots"].isObject() ? json["slots"] : Json::object();
    snapshot.color = json["color"].asString();
    snapshot.slot = json["slot"].asInt(-1);
    return snapshot;
}

const EffectSlot* Preset::findSlot(const std::string& slotId) const {
    for (const EffectSlot& slot : chain) {
        if (slot.id == slotId) {
            return &slot;
        }
    }
    return nullptr;
}

EffectSlot* Preset::findSlot(const std::string& slotId) {
    for (EffectSlot& slot : chain) {
        if (slot.id == slotId) {
            return &slot;
        }
    }
    return nullptr;
}

Json ParameterBinding::toJson() const {
    Json json = Json::object();
    json.set("controlId", controlId);
    json.set("action", action);
    json.set("slotId", slotId);
    if (!portSymbol.empty()) {
        json.set("portSymbol", portSymbol);
    }
    json.set("min", minimum);
    json.set("max", maximum);
    json.set("inverted", inverted);
    return json;
}

ParameterBinding ParameterBinding::fromJson(const Json& json) {
    ParameterBinding binding;
    binding.controlId = json["controlId"].asString();
    binding.action = json["action"].asString("none");
    binding.slotId = json["slotId"].asString();
    binding.portSymbol = json["portSymbol"].asString();
    binding.minimum = json["min"].asFloat(0.0f);
    binding.maximum = json["max"].asFloat(1.0f);
    binding.inverted = json["inverted"].asBool(false);
    return binding;
}

const ParameterBinding* Preset::findParameterBinding(const std::string& controlId) const {
    for (const ParameterBinding& binding : parameterBindings) {
        if (binding.controlId == controlId) {
            return &binding;
        }
    }
    return nullptr;
}

ParameterBinding* Preset::findParameterBinding(const std::string& controlId) {
    for (ParameterBinding& binding : parameterBindings) {
        if (binding.controlId == controlId) {
            return &binding;
        }
    }
    return nullptr;
}

Json Preset::toJson() const {
    Json json = Json::object();
    json.set("id", id);
    json.set("name", name);
    json.set("author", author);
    json.set("tempo", tempo);
    json.set("inputGainDb", inputGainDb);
    json.set("outputGainDb", outputGainDb);

    Json chainJson = Json::array();
    for (const EffectSlot& slot : chain) {
        chainJson.push(slot.toJson());
    }
    json.set("chain", chainJson);

    Json snapshotJson = Json::array();
    for (const Snapshot& snapshot : snapshots) {
        snapshotJson.push(snapshot.toJson());
    }
    json.set("snapshots", snapshotJson);

    Json bindingJson = Json::array();
    for (const ParameterBinding& binding : parameterBindings) {
        bindingJson.push(binding.toJson());
    }
    json.set("parameterBindings", bindingJson);
    if (community.isObject() && !community.members().empty()) {
        json.set("community", community);
    }
    json.set("activeSnapshot", activeSnapshot);
    json.set("rememberedSnapshotSlot", rememberedSnapshotSlot);
    json.set("rememberedSnapshotEnabled", rememberedSnapshotEnabled);
    return json;
}

Preset Preset::fromJson(const Json& json) {
    Preset preset;
    preset.id = json["id"].asString(newId("preset"));
    preset.name = json["name"].asString("Untitled");
    preset.author = json["author"].asString();
    preset.tempo = json["tempo"].asDouble(120.0);
    preset.inputGainDb = json["inputGainDb"].asFloat(0.0f);
    preset.outputGainDb = json["outputGainDb"].asFloat(0.0f);

    const Json& chainJson = json["chain"];
    for (size_t i = 0; i < chainJson.size(); ++i) {
        preset.chain.push_back(EffectSlot::fromJson(chainJson.at(i)));
    }

    const Json& snapshotJson = json["snapshots"];
    for (size_t i = 0; i < snapshotJson.size(); ++i) {
        Snapshot snapshot = Snapshot::fromJson(snapshotJson.at(i));
        if (snapshot.slot < 0) {
            snapshot.slot = static_cast<int>(i);
        }
        preset.snapshots.push_back(std::move(snapshot));
    }

    const Json& bindingJson = json["parameterBindings"];
    for (size_t i = 0; i < bindingJson.size(); ++i) {
        ParameterBinding binding = ParameterBinding::fromJson(bindingJson.at(i));
        if (!binding.controlId.empty()
            && (binding.action == "setParameter" || binding.action == "toggleEffect")) {
            preset.parameterBindings.push_back(std::move(binding));
        }
    }
    preset.community = json["community"].isObject() ? json["community"] : Json::object();
    preset.activeSnapshot = json["activeSnapshot"].asInt(-1);
    preset.rememberedSnapshotSlot = json["rememberedSnapshotSlot"].asInt(-1);
    preset.rememberedSnapshotEnabled = json["rememberedSnapshotEnabled"].asBool(false);
    return preset;
}

Json Bank::toJson() const {
    Json json = Json::object();
    json.set("id", id);
    json.set("name", name);
    json.set("order", order);
    if (communityHolding) json.set("communityHolding", true);
    if (!lastPresetId.empty()) {
        json.set("lastPresetId", lastPresetId);
    }
    Json presetJson = Json::array();
    for (const Preset& preset : presets) {
        presetJson.push(preset.toJson());
    }
    json.set("presets", presetJson);
    return json;
}

Bank Bank::fromJson(const Json& json) {
    Bank bank;
    bank.id = json["id"].asString(newId("bank"));
    bank.name = json["name"].asString("Bank");
    bank.order = json["order"].asInt(0);
    bank.communityHolding = json["communityHolding"].asBool(false);
    bank.lastPresetId = json["lastPresetId"].asString();
    const Json& presetJson = json["presets"];
    for (size_t i = 0; i < presetJson.size(); ++i) {
        bank.presets.push_back(Preset::fromJson(presetJson.at(i)));
    }
    return bank;
}

// ---------------------------------------------------------------------------
// DIY controller
// ---------------------------------------------------------------------------

std::string controlKindToString(ControlKind kind) {
    switch (kind) {
        case ControlKind::Momentary: return "momentary";
        case ControlKind::Latching: return "latching";
        case ControlKind::Pot: return "pot";
        case ControlKind::Slider: return "slider";
        case ControlKind::Encoder: return "encoder";
        case ControlKind::EncoderPush: return "encoderPush";
        case ControlKind::Expression: return "expression";
    }
    return "momentary";
}

ControlKind controlKindFromString(const std::string& text) {
    if (text == "latching") return ControlKind::Latching;
    if (text == "pot") return ControlKind::Pot;
    if (text == "slider") return ControlKind::Slider;
    if (text == "encoder") return ControlKind::Encoder;
    if (text == "encoderPush" || text == "encoder_push") return ControlKind::EncoderPush;
    if (text == "expression") return ControlKind::Expression;
    return ControlKind::Momentary;
}

Json ControlBinding::toJson() const {
    Json json = Json::object();
    json.set("action", action);
    if (!bankId.empty()) json.set("bankId", bankId);
    if (!presetId.empty()) json.set("presetId", presetId);
    if (!snapshotId.empty()) json.set("snapshotId", snapshotId);
    if (snapshotSlot >= 0) json.set("snapshotSlot", snapshotSlot);
    if (!slotId.empty()) json.set("slotId", slotId);
    if (!portSymbol.empty()) json.set("portSymbol", portSymbol);
    json.set("min", minimum);
    json.set("max", maximum);
    json.set("inverted", inverted);
    if (!holdAction.empty()) {
        json.set("holdAction", holdAction);
        json.set("holdMs", holdMilliseconds);
    }
    json.set("doubleAction", doubleAction.empty() ? "none" : doubleAction);
    json.set("doubleMs", doubleTapMilliseconds);
    return json;
}

ControlBinding ControlBinding::fromJson(const Json& json) {
    ControlBinding binding;
    binding.action = json["action"].asString("none");
    binding.bankId = json["bankId"].asString();
    binding.presetId = json["presetId"].asString();
    binding.snapshotId = json["snapshotId"].asString();
    binding.snapshotSlot = json["snapshotSlot"].asInt(-1);
    binding.slotId = json["slotId"].asString();
    binding.portSymbol = json["portSymbol"].asString();
    binding.minimum = json["min"].asFloat(0.0f);
    binding.maximum = json["max"].asFloat(1.0f);
    binding.inverted = json["inverted"].asBool(false);
    binding.holdAction = json["holdAction"].asString();
    binding.holdMilliseconds = json["holdMs"].asInt(600);
    if (json.has("doubleAction")) {
        binding.doubleAction = json["doubleAction"].asString();
    } else if (binding.action == "selectPreset") {
        binding.doubleAction = "reloadPreset";
    }
    binding.doubleTapMilliseconds = json["doubleMs"].asInt(320);
    return binding;
}

Json ControllerControl::toJson() const {
    Json json = Json::object();
    json.set("id", id);
    json.set("label", label);
    json.set("kind", controlKindToString(kind));
    json.set("module", module);
    json.set("channel", channel);
    json.set("midiChannel", midiChannel);
    json.set("useNoteMessages", useNoteMessages);
    json.set("row", row);
    json.set("column", column);
    json.set("x", x);
    json.set("y", y);
    json.set("width", width);
    json.set("height", height);
    json.set("ledId", ledId);
    if (!pairId.empty()) {
        json.set("pairId", pairId);
    }
    json.set("binding", binding.toJson());
    return json;
}

ControllerControl ControllerControl::fromJson(const Json& json) {
    ControllerControl control;
    control.id = json["id"].asString(newId("ctl"));
    control.label = json["label"].asString();
    control.kind = controlKindFromString(json["kind"].asString("momentary"));
    control.module = json["module"].asString();
    control.channel = json["channel"].asInt(-1);
    control.midiChannel = json["midiChannel"].asInt(0);
    control.useNoteMessages = json["useNoteMessages"].asBool(false);
    control.row = json["row"].asInt(0);
    control.column = json["column"].asInt(0);
    control.x = json["x"].asDouble(0.0);
    control.y = json["y"].asDouble(0.0);
    control.width = json["width"].asDouble(0.12);
    control.height = json["height"].asDouble(0.18);
    control.ledId = json["ledId"].asString();
    control.pairId = json["pairId"].asString();
    control.binding = ControlBinding::fromJson(json["binding"]);
    return control;
}

Json ControllerLed::toJson() const {
    Json json = Json::object();
    json.set("id", id);
    json.set("label", label);
    json.set("rgb", rgb);
    json.set("pixelIndex", pixelIndex);
    json.set("module", module);
    json.set("pin", pin);
    json.set("role", role);
    json.set("brightness", brightness);
    return json;
}

ControllerLed ControllerLed::fromJson(const Json& json) {
    ControllerLed led;
    led.id = json["id"].asString(newId("led"));
    led.label = json["label"].asString();
    led.rgb = json["rgb"].asBool(true);
    led.pixelIndex = json["pixelIndex"].asInt(0);
    led.module = json["module"].asString();
    led.pin = json["pin"].asInt(-1);
    led.role = json["role"].asString("preset");
    led.brightness = json["brightness"].asFloat(1.0f);
    return led;
}

Json ControllerConfig::toJson() const {
    Json json = Json::object();
    json.set("enabled", enabled);
    json.set("name", name);
    json.set("layoutMode", layoutMode);
    json.set("gridRows", gridRows);
    json.set("gridColumns", gridColumns);
    json.set("midiPort", midiPort);
    json.set("mirrorLayoutOnScreen", mirrorLayoutOnScreen);
    json.set("syncLedColours", syncLedColours);
    json.set("ledBrightness", ledBrightness);

    Json controlJson = Json::array();
    for (const ControllerControl& control : controls) {
        controlJson.push(control.toJson());
    }
    json.set("controls", controlJson);

    Json ledJson = Json::array();
    for (const ControllerLed& led : leds) {
        ledJson.push(led.toJson());
    }
    json.set("leds", ledJson);
    json.set("performanceLayout", performanceLayout.isObject() ? performanceLayout : Json::object());
    json.set("layoutDefaults", layoutDefaults.isObject() ? layoutDefaults : Json::object());
    json.set("presetAssignments", presetAssignments.isObject() ? presetAssignments : Json::object());
    return json;
}

ControllerConfig ControllerConfig::fromJson(const Json& json) {
    ControllerConfig config;
    config.enabled = json["enabled"].asBool(false);
    config.name = json["name"].asString("My Controller");
    config.layoutMode = json["layoutMode"].asString("freeform");
    config.gridRows = std::max(1, json["gridRows"].asInt(2));
    config.gridColumns = std::max(1, json["gridColumns"].asInt(4));
    config.midiPort = json["midiPort"].asString();
    config.mirrorLayoutOnScreen = json["mirrorLayoutOnScreen"].asBool(true);
    config.syncLedColours = json["syncLedColours"].asBool(true);
    config.ledBrightness = json["ledBrightness"].asFloat(0.7f);

    const Json& controlJson = json["controls"];
    for (size_t i = 0; i < controlJson.size(); ++i) {
        config.controls.push_back(ControllerControl::fromJson(controlJson.at(i)));
    }
    const Json& ledJson = json["leds"];
    for (size_t i = 0; i < ledJson.size(); ++i) {
        config.leds.push_back(ControllerLed::fromJson(ledJson.at(i)));
    }
    if (json["performanceLayout"].isObject()) {
        config.performanceLayout = json["performanceLayout"];
    }
    if (json["layoutDefaults"].isObject()) {
        config.layoutDefaults = json["layoutDefaults"];
    }
    if (json["presetAssignments"].isObject()) {
        config.presetAssignments = json["presetAssignments"];
    }
    return config;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

Json audioSettingsToJson(const AudioSettings& settings) {
    Json json = Json::object();
    json.set("device", settings.device);
    json.set("captureDevice", settings.captureDevice);
    json.set("sampleRate", static_cast<int>(settings.sampleRate));
    json.set("periodFrames", static_cast<int>(settings.periodFrames));
    json.set("periodCount", static_cast<int>(settings.periodCount));
    json.set("inputChannels", static_cast<int>(settings.inputChannels));
    json.set("outputChannels", static_cast<int>(settings.outputChannels));
    json.set("guitarInput", static_cast<int>(settings.inputChannelOffset + 1));
    json.set("inputChannelOffset", static_cast<int>(settings.inputChannelOffset));
    json.set("outputChannelOffset", static_cast<int>(settings.outputChannelOffset));
    json.set("useMmap", settings.useMmap);
    json.set("startImmediately", settings.startImmediately);
    json.set("inputGainDb", settings.inputGainDb);
    json.set("outputGainDb", settings.outputGainDb);
    json.set("inputMode", settings.inputMode);
    json.set("calibrationMode", settings.calibrationMode);
    json.set("instrumentProfileName", settings.instrumentProfileName);
    json.set("instrumentLevelDbU", settings.instrumentLevelDbU);
    json.set("interfaceReferenceDbU", settings.interfaceReferenceDbU);
    json.set("interfaceGainDb", settings.interfaceGainDb);
    json.set("namCalibrationManaged", settings.namCalibrationManaged);
    Json profiles = Json::array();
    for (const InstrumentInputProfile& profile : settings.instrumentProfiles) {
        Json item = Json::object();
        item.set("name", profile.name);
        item.set("inputMode", profile.inputMode);
        item.set("calibrationMode", profile.calibrationMode);
        item.set("instrumentLevelDbU", profile.instrumentLevelDbU);
        item.set("interfaceReferenceDbU", profile.interfaceReferenceDbU);
        item.set("interfaceGainDb", profile.interfaceGainDb);
        profiles.push(std::move(item));
    }
    json.set("instrumentProfiles", std::move(profiles));
    json.set("muteOnChange", settings.muteOnChange);
    json.set("patchFadeOutMs", settings.patchFadeOutMs);
    json.set("patchFadeInMs", settings.patchFadeInMs);
    json.set("dcBlockerEnabled", settings.dcBlockerEnabled);
    json.set("dcBlockerHz", settings.dcBlockerHz);
    json.set("limiterEnabled", settings.limiterEnabled);
    json.set("limiterCeilingDb", settings.limiterCeilingDb);
    json.set("limiterLookaheadMs", settings.limiterLookaheadMs);
    json.set("limiterReleaseMs", settings.limiterReleaseMs);
    json.set("bufferMs", settings.bufferMs());
    return json;
}

AudioSettings audioSettingsFromJson(const Json& json, const AudioSettings& fallback) {
    AudioSettings settings = fallback;
    if (json.has("device")) settings.device = json["device"].asString(fallback.device);
    if (json.has("captureDevice")) settings.captureDevice = json["captureDevice"].asString();
    if (json.has("sampleRate")) settings.sampleRate = static_cast<unsigned>(json["sampleRate"].asInt(static_cast<int>(fallback.sampleRate)));
    if (json.has("periodFrames")) settings.periodFrames = static_cast<unsigned>(json["periodFrames"].asInt(static_cast<int>(fallback.periodFrames)));
    if (json.has("periodCount")) settings.periodCount = static_cast<unsigned>(json["periodCount"].asInt(static_cast<int>(fallback.periodCount)));
    if (json.has("inputChannels")) settings.inputChannels = static_cast<unsigned>(json["inputChannels"].asInt(static_cast<int>(fallback.inputChannels)));
    if (json.has("outputChannels")) settings.outputChannels = static_cast<unsigned>(json["outputChannels"].asInt(static_cast<int>(fallback.outputChannels)));
    if (json.has("guitarInput")) {
        const int oneBased = json["guitarInput"].asInt(1);
        settings.inputChannelOffset = static_cast<unsigned>(std::max(1, oneBased) - 1);
    } else if (json.has("inputChannelOffset")) {
        // Accept the older zero-based field while preserving the fallback for
        // partial live-setting updates that do not mention either channel key.
        settings.inputChannelOffset = static_cast<unsigned>(
            std::max(0, json["inputChannelOffset"].asInt(static_cast<int>(fallback.inputChannelOffset))));
    }
    if (json.has("outputChannelOffset")) settings.outputChannelOffset = static_cast<unsigned>(json["outputChannelOffset"].asInt(0));
    if (json.has("useMmap")) settings.useMmap = json["useMmap"].asBool(fallback.useMmap);
    if (json.has("startImmediately")) settings.startImmediately = json["startImmediately"].asBool(fallback.startImmediately);
    if (json.has("inputGainDb")) settings.inputGainDb = json["inputGainDb"].asFloat(fallback.inputGainDb);
    if (json.has("outputGainDb")) settings.outputGainDb = json["outputGainDb"].asFloat(fallback.outputGainDb);
    if (json.has("inputMode")) settings.inputMode = json["inputMode"].asString(fallback.inputMode);
    if (json.has("calibrationMode")) settings.calibrationMode = json["calibrationMode"].asString(fallback.calibrationMode);
    if (json.has("instrumentProfileName")) settings.instrumentProfileName = json["instrumentProfileName"].asString(fallback.instrumentProfileName);
    if (json.has("instrumentLevelDbU")) settings.instrumentLevelDbU = json["instrumentLevelDbU"].asFloat(fallback.instrumentLevelDbU);
    if (json.has("interfaceReferenceDbU")) settings.interfaceReferenceDbU = json["interfaceReferenceDbU"].asFloat(fallback.interfaceReferenceDbU);
    if (json.has("interfaceGainDb")) settings.interfaceGainDb = json["interfaceGainDb"].asFloat(fallback.interfaceGainDb);
    if (json.has("namCalibrationManaged")) settings.namCalibrationManaged = json["namCalibrationManaged"].asBool(fallback.namCalibrationManaged);
    if (json.has("instrumentProfiles") && json["instrumentProfiles"].isArray()) {
        settings.instrumentProfiles.clear();
        for (const Json& raw : json["instrumentProfiles"].items()) {
            if (!raw.isObject() || settings.instrumentProfiles.size() >= 32) continue;
            InstrumentInputProfile profile;
            profile.name = raw["name"].asString("Guitar");
            profile.inputMode = raw["inputMode"].asString("instrument");
            profile.calibrationMode = raw["calibrationMode"].asString("unmeasured");
            profile.instrumentLevelDbU = raw["instrumentLevelDbU"].asFloat(-6.0f);
            profile.interfaceReferenceDbU = raw["interfaceReferenceDbU"].asFloat(12.0f);
            profile.interfaceGainDb = raw["interfaceGainDb"].asFloat(0.0f);
            settings.instrumentProfiles.push_back(std::move(profile));
        }
    }
    if (json.has("muteOnChange")) settings.muteOnChange = json["muteOnChange"].asBool(fallback.muteOnChange);
    if (json.has("patchFadeOutMs")) settings.patchFadeOutMs = json["patchFadeOutMs"].asFloat(fallback.patchFadeOutMs);
    if (json.has("patchFadeInMs")) settings.patchFadeInMs = json["patchFadeInMs"].asFloat(fallback.patchFadeInMs);
    if (json.has("dcBlockerEnabled")) settings.dcBlockerEnabled = json["dcBlockerEnabled"].asBool(fallback.dcBlockerEnabled);
    if (json.has("dcBlockerHz")) settings.dcBlockerHz = json["dcBlockerHz"].asFloat(fallback.dcBlockerHz);
    if (json.has("limiterEnabled")) settings.limiterEnabled = json["limiterEnabled"].asBool(fallback.limiterEnabled);
    if (json.has("limiterCeilingDb")) settings.limiterCeilingDb = json["limiterCeilingDb"].asFloat(fallback.limiterCeilingDb);
    if (json.has("limiterLookaheadMs")) settings.limiterLookaheadMs = json["limiterLookaheadMs"].asFloat(fallback.limiterLookaheadMs);
    if (json.has("limiterReleaseMs")) settings.limiterReleaseMs = json["limiterReleaseMs"].asFloat(fallback.limiterReleaseMs);

    // Clamp to values the engine can actually run, so a hand-edited settings
    // file cannot leave the service unable to start.
    settings.sampleRate = std::max(8000u, std::min(192000u, settings.sampleRate));
    settings.periodFrames = std::max(8u, std::min(4096u, settings.periodFrames));
    settings.periodCount = std::max(2u, std::min(16u, settings.periodCount));
    settings.inputChannels = std::max(1u, std::min(64u, settings.inputChannels));
    settings.outputChannels = std::max(1u, std::min(64u, settings.outputChannels));
    settings.inputGainDb = std::max(-60.0f, std::min(24.0f, settings.inputGainDb));
    settings.outputGainDb = std::max(-60.0f, std::min(12.0f, settings.outputGainDb));
    if (settings.inputMode != "instrument" && settings.inputMode != "line"
        && settings.inputMode != "mic" && settings.inputMode != "unknown") {
        settings.inputMode = "unknown";
    }
    if (settings.calibrationMode != "unmeasured" && settings.calibrationMode != "measured"
        && settings.calibrationMode != "estimated") {
        settings.calibrationMode = "unmeasured";
    }
    if (settings.instrumentProfileName.empty()) settings.instrumentProfileName = "Guitar 1";
    if (settings.instrumentProfileName.size() > 80) settings.instrumentProfileName.resize(80);
    settings.instrumentLevelDbU = std::max(-30.0f, std::min(12.0f, settings.instrumentLevelDbU));
    settings.interfaceReferenceDbU = std::max(-30.0f, std::min(40.0f, settings.interfaceReferenceDbU));
    settings.interfaceGainDb = std::max(-20.0f, std::min(80.0f, settings.interfaceGainDb));
    for (InstrumentInputProfile& profile : settings.instrumentProfiles) {
        if (profile.name.empty()) profile.name = "Guitar";
        if (profile.name.size() > 80) profile.name.resize(80);
        if (profile.inputMode != "instrument" && profile.inputMode != "line"
            && profile.inputMode != "mic" && profile.inputMode != "unknown") {
            profile.inputMode = "unknown";
        }
        if (profile.calibrationMode != "unmeasured" && profile.calibrationMode != "measured"
            && profile.calibrationMode != "estimated") {
            profile.calibrationMode = "unmeasured";
        }
        profile.instrumentLevelDbU = std::max(-30.0f, std::min(12.0f, profile.instrumentLevelDbU));
        profile.interfaceReferenceDbU = std::max(-30.0f, std::min(40.0f, profile.interfaceReferenceDbU));
        profile.interfaceGainDb = std::max(-20.0f, std::min(80.0f, profile.interfaceGainDb));
    }
    if (settings.instrumentProfiles.empty()) {
        settings.instrumentProfiles.push_back({settings.instrumentProfileName, settings.inputMode,
            settings.calibrationMode, settings.instrumentLevelDbU,
            settings.interfaceReferenceDbU, settings.interfaceGainDb});
    } else if (!json.has("instrumentProfiles")
               && (json.has("instrumentProfileName") || json.has("instrumentLevelDbU"))) {
        settings.instrumentProfiles.front() = {settings.instrumentProfileName, settings.inputMode,
            settings.calibrationMode, settings.instrumentLevelDbU,
            settings.interfaceReferenceDbU, settings.interfaceGainDb};
    }
    settings.patchFadeOutMs = std::max(1.0f, std::min(20.0f, settings.patchFadeOutMs));
    settings.patchFadeInMs = std::max(1.0f, std::min(30.0f, settings.patchFadeInMs));
    settings.dcBlockerHz = std::max(2.0f, std::min(20.0f, settings.dcBlockerHz));
    settings.limiterCeilingDb = std::max(-12.0f, std::min(-0.1f, settings.limiterCeilingDb));
    settings.limiterLookaheadMs = std::max(0.0f, std::min(2.0f, settings.limiterLookaheadMs));
    settings.limiterReleaseMs = std::max(20.0f, std::min(500.0f, settings.limiterReleaseMs));
    if (settings.inputChannelOffset >= settings.inputChannels) {
        settings.inputChannelOffset = settings.inputChannels - 1;
    }
    return settings;
}

Json audioDeviceToJson(const AudioDeviceInfo& device) {
    Json json = Json::object();
    json.set("id", device.id);
    json.set("name", device.name);
    json.set("driver", device.driver);
    json.set("isHat", device.isHat);
    json.set("isHdmi", device.isHdmi);
    json.set("duplex", device.duplex);
    json.set("maxInputChannels", static_cast<int>(device.maxInputChannels));
    json.set("maxOutputChannels", static_cast<int>(device.maxOutputChannels));
    json.set("supportsMmap", device.supportsMmap);
    json.set("minPeriods", static_cast<int>(device.minPeriods));
    json.set("maxPeriods", static_cast<int>(device.maxPeriods));

    Json rates = Json::array();
    for (unsigned rate : device.sampleRates) {
        rates.push(Json(static_cast<int>(rate)));
    }
    json.set("sampleRates", rates);

    Json periods = Json::array();
    for (unsigned period : device.periodSizes) {
        periods.push(Json(static_cast<int>(period)));
    }
    json.set("periodSizes", periods);
    return json;
}

Json UiSettings::toJson() const {
    Json json = Json::object();
    json.set("themeId", themeId);
    json.set("customThemes", customThemes);
    json.set("ledColors", ledColors.isObject() ? ledColors : Json::object());
    json.set("scale", scale);
    json.set("menuOrder", menuOrder.isArray() ? menuOrder : Json::array());
    json.set("shortcuts", shortcuts.isObject() ? shortcuts : Json::object());
    json.set("startupView", startupView);
    json.set("virtualSwitchCount", virtualSwitchCount);
    json.set("performanceEncoder", performanceEncoder);
    json.set("encoderStepsPerDetent", encoderStepsPerDetent);
    json.set("analogDeadband", analogDeadband);
    json.set("switchDebounceMs", switchDebounceMs);
    json.set("communityAuthor", communityAuthor);
    json.set("tuner", tuner.isObject() ? tuner : Json::object());
    return json;
}

UiSettings UiSettings::fromJson(const Json& json) {
    UiSettings settings;
    settings.themeId = json["themeId"].asString("Pi-MFX Purple");
    if (settings.themeId == "MultiFX Purple") {
        settings.themeId = "Pi-MFX Purple";
    }
    settings.customThemes = json["customThemes"].isArray() ? json["customThemes"] : Json::array();
    settings.ledColors = json["ledColors"].isObject() ? json["ledColors"] : Json::object();
    settings.scale = std::max(0.6, std::min(2.0, json["scale"].asDouble(1.0)));
    settings.menuOrder = json["menuOrder"].isArray() ? json["menuOrder"] : Json::array();
    settings.shortcuts = json["shortcuts"].isObject() ? json["shortcuts"] : Json::object();
    settings.startupView = json["startupView"].asString("performance");
    settings.virtualSwitchCount = std::max(1, std::min(64, json["virtualSwitchCount"].asInt(8)));
    const std::string encoderMode = json["performanceEncoder"].asString("browse");
    settings.performanceEncoder = (encoderMode == "live" || encoderMode == "session")
        ? encoderMode
        : "browse";
    settings.encoderStepsPerDetent = std::max(1, std::min(8, json["encoderStepsPerDetent"].asInt(1)));
    settings.analogDeadband = std::max(0, std::min(16, json["analogDeadband"].asInt(0)));
    settings.switchDebounceMs = std::max(0, std::min(80, json["switchDebounceMs"].asInt(0)));
    settings.communityAuthor = json["communityAuthor"].asString();
    if (settings.communityAuthor.size() > 120) settings.communityAuthor.resize(120);
    settings.tuner = json["tuner"].isObject() ? json["tuner"] : Json::object();
    return settings;
}

Json SystemSettings::toJson() const {
    Json json = Json::object();
    json.set("pinAudioThread", pinAudioThread);
    json.set("audioCpu", audioCpu);
    json.set("audioThreadPriority", audioThreadPriority);
    json.set("workerThreadPriority", workerThreadPriority);
    json.set("lockMemory", lockMemory);
    json.set("holdCpuLatency", holdCpuLatency);
    json.set("sharedTransportEnabled", sharedTransportEnabled);
    json.set("backingTracksEnabled", backingTracksEnabled);
    return json;
}

SystemSettings SystemSettings::fromJson(const Json& json) {
    SystemSettings settings;
    settings.pinAudioThread = json["pinAudioThread"].asBool(false);
    settings.audioCpu = std::max(0, std::min(15, json["audioCpu"].asInt(3)));
    settings.audioThreadPriority = std::max(1, std::min(95, json["audioThreadPriority"].asInt(80)));
    settings.workerThreadPriority = std::max(1, std::min(94, json["workerThreadPriority"].asInt(70)));
    settings.lockMemory = json["lockMemory"].asBool(true);
    settings.holdCpuLatency = json["holdCpuLatency"].asBool(true);
    // These compatibility fields may be false in settings saved while the
    // milestones were under test. Completed services are now always enabled;
    // Backing Tracks still reports unavailable when decoder libraries are absent.
    settings.sharedTransportEnabled = true;
    settings.backingTracksEnabled = true;
    return settings;
}

Json TransportSettings::toJson() const {
    Json json = Json::object();
    json.set("beatsPerBar", beatsPerBar);
    json.set("beatUnit", beatUnit);
    json.set("countInBars", countInBars);
    json.set("metronomeEnabled", metronomeEnabled);
    json.set("quantizationEnabled", quantizationEnabled);
    return json;
}

TransportSettings TransportSettings::fromJson(const Json& json) {
    TransportSettings settings;
    settings.beatsPerBar = std::max(1, std::min(32, json["beatsPerBar"].asInt(4)));
    const int unit = json["beatUnit"].asInt(4);
    settings.beatUnit = unit == 1 || unit == 2 || unit == 4 || unit == 8 || unit == 16 || unit == 32
        ? unit : 4;
    settings.countInBars = std::max(0, std::min(8, json["countInBars"].asInt(0)));
    settings.metronomeEnabled = json["metronomeEnabled"].asBool(false);
    settings.quantizationEnabled = json["quantizationEnabled"].asBool(false);
    return settings;
}

Json LooperSettings::toJson() const {
    Json json = Json::object();
    json.set("quantization", quantization);
    json.set("countIn", countIn);
    json.set("level", level);
    json.set("feedback", feedback);
    return json;
}

LooperSettings LooperSettings::fromJson(const Json& json) {
    LooperSettings settings;
    const std::string quantization = json["quantization"].asString("free");
    settings.quantization = quantization == "beat" || quantization == "bar" ? quantization : "free";
    settings.countIn = json["countIn"].asBool(false);
    settings.level = std::max(0.0f, std::min(1.5f, json["level"].asFloat(1.0f)));
    settings.feedback = std::max(0.0f, std::min(1.0f, json["feedback"].asFloat(1.0f)));
    return settings;
}

Json Settings::toJson() const {
    Json json = Json::object();
    json.set("version", 3);
    json.set("audio", audioSettingsToJson(audio));
    json.set("ui", ui.toJson());
    json.set("system", system.toJson());
    json.set("transport", transport.toJson());
    json.set("looper", looper.toJson());
    json.set("controller", controller.toJson());
    json.set("activeBankId", activeBankId);
    json.set("activePresetId", activePresetId);
    return json;
}

Settings Settings::fromJson(const Json& json) {
    Settings settings;
    settings.audio = audioSettingsFromJson(json["audio"], AudioSettings());
    settings.ui = UiSettings::fromJson(json["ui"]);
    settings.system = SystemSettings::fromJson(json["system"]);
    settings.transport = TransportSettings::fromJson(json["transport"]);
    settings.looper = LooperSettings::fromJson(json["looper"]);
    settings.controller = ControllerConfig::fromJson(json["controller"]);
    settings.activeBankId = json["activeBankId"].asString();
    settings.activePresetId = json["activePresetId"].asString();
    return settings;
}

} // namespace pimfx
