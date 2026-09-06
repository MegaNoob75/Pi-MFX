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
    return json;
}

EffectSlot EffectSlot::fromJson(const Json& json) {
    EffectSlot slot;
    slot.id = json["id"].asString(newId("slot"));
    slot.uri = json["uri"].asString();
    slot.name = json["name"].asString();
    slot.enabled = json["enabled"].asBool(true);
    slot.state = json["state"].isObject() ? json["state"] : Json::object();
    return slot;
}

Json Snapshot::toJson() const {
    Json json = Json::object();
    json.set("id", id);
    json.set("name", name);
    json.set("slots", slots);
    return json;
}

Snapshot Snapshot::fromJson(const Json& json) {
    Snapshot snapshot;
    snapshot.id = json["id"].asString(newId("snap"));
    snapshot.name = json["name"].asString("Snapshot");
    snapshot.slots = json["slots"].isObject() ? json["slots"] : Json::object();
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
    json.set("activeSnapshot", activeSnapshot);
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
        preset.snapshots.push_back(Snapshot::fromJson(snapshotJson.at(i)));
    }
    preset.activeSnapshot = json["activeSnapshot"].asInt(-1);
    return preset;
}

Json Bank::toJson() const {
    Json json = Json::object();
    json.set("id", id);
    json.set("name", name);
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
        case ControlKind::Switch: return "switch";
        case ControlKind::Momentary: return "momentary";
        case ControlKind::Pot: return "pot";
        case ControlKind::Slider: return "slider";
        case ControlKind::Encoder: return "encoder";
        case ControlKind::Expression: return "expression";
    }
    return "switch";
}

ControlKind controlKindFromString(const std::string& text) {
    if (text == "momentary") return ControlKind::Momentary;
    if (text == "pot") return ControlKind::Pot;
    if (text == "slider") return ControlKind::Slider;
    if (text == "encoder") return ControlKind::Encoder;
    if (text == "expression") return ControlKind::Expression;
    return ControlKind::Switch;
}

Json ControlBinding::toJson() const {
    Json json = Json::object();
    json.set("action", action);
    if (!bankId.empty()) json.set("bankId", bankId);
    if (!presetId.empty()) json.set("presetId", presetId);
    if (!snapshotId.empty()) json.set("snapshotId", snapshotId);
    if (!slotId.empty()) json.set("slotId", slotId);
    if (!portSymbol.empty()) json.set("portSymbol", portSymbol);
    json.set("min", minimum);
    json.set("max", maximum);
    json.set("inverted", inverted);
    if (!holdAction.empty()) {
        json.set("holdAction", holdAction);
        json.set("holdMs", holdMilliseconds);
    }
    return json;
}

ControlBinding ControlBinding::fromJson(const Json& json) {
    ControlBinding binding;
    binding.action = json["action"].asString("none");
    binding.bankId = json["bankId"].asString();
    binding.presetId = json["presetId"].asString();
    binding.snapshotId = json["snapshotId"].asString();
    binding.slotId = json["slotId"].asString();
    binding.portSymbol = json["portSymbol"].asString();
    binding.minimum = json["min"].asFloat(0.0f);
    binding.maximum = json["max"].asFloat(1.0f);
    binding.inverted = json["inverted"].asBool(false);
    binding.holdAction = json["holdAction"].asString();
    binding.holdMilliseconds = json["holdMs"].asInt(600);
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
    json.set("binding", binding.toJson());
    return json;
}

ControllerControl ControllerControl::fromJson(const Json& json) {
    ControllerControl control;
    control.id = json["id"].asString(newId("ctl"));
    control.label = json["label"].asString();
    control.kind = controlKindFromString(json["kind"].asString("switch"));
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
    return json;
}

ControllerConfig ControllerConfig::fromJson(const Json& json) {
    ControllerConfig config;
    config.enabled = json["enabled"].asBool(false);
    config.name = json["name"].asString("My Controller");
    config.layoutMode = json["layoutMode"].asString("grid");
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
    json.set("muteOnChange", settings.muteOnChange);
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
    } else {
        // Older files stored inputChannelOffset but the engine never applied it.
        // Two-channel USB boxes (Scarlett Solo) put the instrument jack on input 2.
        settings.inputChannelOffset = settings.inputChannels >= 2 ? 1u : 0u;
    }
    if (json.has("outputChannelOffset")) settings.outputChannelOffset = static_cast<unsigned>(json["outputChannelOffset"].asInt(0));
    if (json.has("useMmap")) settings.useMmap = json["useMmap"].asBool(fallback.useMmap);
    if (json.has("startImmediately")) settings.startImmediately = json["startImmediately"].asBool(fallback.startImmediately);
    if (json.has("inputGainDb")) settings.inputGainDb = json["inputGainDb"].asFloat(fallback.inputGainDb);
    if (json.has("outputGainDb")) settings.outputGainDb = json["outputGainDb"].asFloat(fallback.outputGainDb);
    if (json.has("muteOnChange")) settings.muteOnChange = json["muteOnChange"].asBool(fallback.muteOnChange);

    // Clamp to values the engine can actually run, so a hand-edited settings
    // file cannot leave the service unable to start.
    settings.sampleRate = std::max(8000u, std::min(192000u, settings.sampleRate));
    settings.periodFrames = std::max(8u, std::min(4096u, settings.periodFrames));
    settings.periodCount = std::max(2u, std::min(16u, settings.periodCount));
    settings.inputChannels = std::max(1u, std::min(64u, settings.inputChannels));
    settings.outputChannels = std::max(1u, std::min(64u, settings.outputChannels));
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
    json.set("scale", scale);
    json.set("showTuner", showTuner);
    json.set("showLatencyMeter", showLatencyMeter);
    json.set("confirmPresetOverwrite", confirmPresetOverwrite);
    json.set("startupView", startupView);
    json.set("virtualSwitchCount", virtualSwitchCount);
    return json;
}

UiSettings UiSettings::fromJson(const Json& json) {
    UiSettings settings;
    settings.themeId = json["themeId"].asString("mfx-purple");
    settings.customThemes = json["customThemes"].isArray() ? json["customThemes"] : Json::array();
    settings.scale = std::max(0.6, std::min(2.0, json["scale"].asDouble(1.0)));
    settings.showTuner = json["showTuner"].asBool(true);
    settings.showLatencyMeter = json["showLatencyMeter"].asBool(true);
    settings.confirmPresetOverwrite = json["confirmPresetOverwrite"].asBool(true);
    settings.startupView = json["startupView"].asString("performance");
    settings.virtualSwitchCount = std::max(1, std::min(64, json["virtualSwitchCount"].asInt(8)));
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
    return json;
}

SystemSettings SystemSettings::fromJson(const Json& json) {
    SystemSettings settings;
    settings.pinAudioThread = json["pinAudioThread"].asBool(true);
    settings.audioCpu = std::max(0, std::min(15, json["audioCpu"].asInt(3)));
    settings.audioThreadPriority = std::max(1, std::min(95, json["audioThreadPriority"].asInt(80)));
    settings.workerThreadPriority = std::max(1, std::min(94, json["workerThreadPriority"].asInt(70)));
    settings.lockMemory = json["lockMemory"].asBool(true);
    settings.holdCpuLatency = json["holdCpuLatency"].asBool(true);
    return settings;
}

Json Settings::toJson() const {
    Json json = Json::object();
    json.set("version", 1);
    json.set("audio", audioSettingsToJson(audio));
    json.set("ui", ui.toJson());
    json.set("system", system.toJson());
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
    settings.controller = ControllerConfig::fromJson(json["controller"]);
    settings.activeBankId = json["activeBankId"].asString();
    settings.activePresetId = json["activePresetId"].asString();
    return settings;
}

} // namespace pimfx
