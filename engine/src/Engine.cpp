#include "Engine.h"

#include "core/Log.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>

namespace pimfx {
namespace {

constexpr size_t kTunerRingSize = 16384;
constexpr float kTunerMinFrequency = 60.0f;   // below a dropped-B seven string
constexpr float kTunerMaxFrequency = 1400.0f; // above the 24th fret of a high E

float dbToGain(float db) {
    return std::pow(10.0f, db / 20.0f);
}

/// Performance stores switch → preset as { bankId: { controlId: presetId } }.
/// MIDI selectPreset used to ignore that map and only read binding.presetId,
/// which Learn never fills, so learned footswitches did nothing.
std::string assignedPresetForControl(const ControllerConfig& config,
                                     const std::string& bankId,
                                     const std::string& controlId) {
    if (bankId.empty() || controlId.empty() || !config.presetAssignments.isObject()) {
        return {};
    }
    if (!config.presetAssignments.has(bankId)) {
        return {};
    }
    const Json& bankMap = config.presetAssignments[bankId];
    if (!bankMap.isObject() || !bankMap.has(controlId)) {
        return {};
    }
    return bankMap[controlId].asString();
}

const char* kNoteNames[] = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};

TunerReading analysePitch(const std::vector<float>& samples, unsigned sampleRate) {
    TunerReading reading;
    if (samples.size() < 1024 || sampleRate == 0) {
        return reading;
    }

    // Autocorrelation over the guitar's range. It is not the most accurate
    // method published, but it is stable on a plucked string, cheap enough to
    // run continuously, and independent of the audio thread.
    double energy = 0.0;
    for (float sample : samples) {
        energy += static_cast<double>(sample) * sample;
    }
    const double rms = std::sqrt(energy / samples.size());
    if (rms < 0.0025) {
        return reading; // silence, or noise floor
    }

    const size_t minLag = static_cast<size_t>(sampleRate / kTunerMaxFrequency);
    const size_t maxLag = std::min(samples.size() / 2, static_cast<size_t>(sampleRate / kTunerMinFrequency));
    if (maxLag <= minLag) {
        return reading;
    }

    double bestScore = 0.0;
    size_t bestLag = 0;
    for (size_t lag = minLag; lag < maxLag; ++lag) {
        double correlation = 0.0;
        for (size_t i = 0; i + lag < samples.size(); ++i) {
            correlation += static_cast<double>(samples[i]) * samples[i + lag];
        }
        correlation /= static_cast<double>(samples.size() - lag);
        if (correlation > bestScore) {
            bestScore = correlation;
            bestLag = lag;
        }
    }

    if (bestLag == 0 || bestScore < energy / samples.size() * 0.35) {
        return reading;
    }

    const double frequency = static_cast<double>(sampleRate) / static_cast<double>(bestLag);
    if (frequency < kTunerMinFrequency || frequency > kTunerMaxFrequency) {
        return reading;
    }

    const double midi = 69.0 + 12.0 * std::log2(frequency / 440.0);
    const int nearest = static_cast<int>(std::lround(midi));

    reading.valid = true;
    reading.frequency = static_cast<float>(frequency);
    reading.midiNote = nearest;
    reading.cents = static_cast<float>((midi - nearest) * 100.0);
    reading.noteName = std::string(kNoteNames[((nearest % 12) + 12) % 12])
                     + std::to_string(nearest / 12 - 1);
    return reading;
}

} // namespace

Engine::Engine(Paths paths)
    : storage_(std::move(paths)),
      tunerRing_(kTunerRingSize, 0.0f) {}

Engine::~Engine() {
    stop();
}

void Engine::setStateListener(StateListener listener) {
    std::lock_guard<std::mutex> lock(listenerMutex_);
    listener_ = std::move(listener);
}

bool Engine::start(std::string& error) {
    settings_ = storage_.loadSettings();
    banks_ = storage_.loadBanks();

    activeBankId_ = settings_.activeBankId;
    activePresetId_ = settings_.activePresetId;
    if (!activeBank() && !banks_.empty()) {
        activeBankId_ = banks_.front().id;
        activePresetId_.clear();
    }
    if (!activePreset()) {
        const Bank* bank = activeBank();
        if (bank && !bank->presets.empty()) {
            activePresetId_ = bank->presets.front().id;
        }
    }

    std::string catalogError;
    catalog_.setUserBundleDirectory(storage_.paths().lv2Dir);
    if (!catalog_.rescan(catalogError)) {
        logWarn("lv2: " + catalogError);
    }

    if (settings_.system.lockMemory) {
        std::string message;
        if (rt::lockMemory(message)) {
            logInfo("rt: " + message);
        } else {
            logWarn("rt: " + message);
        }
    }
    if (settings_.system.holdCpuLatency) {
        latencyGuard_ = std::make_unique<rt::CpuLatencyGuard>();
        logInfo("rt: " + latencyGuard_->status());
    }

    backend_ = createAudioBackend();
    backend_->setFailureHandler([this](const std::string& message) {
        std::lock_guard<std::mutex> lock(stateMutex_);
        audioError_ = message;
        notify();
    });

    inputGain_.store(dbToGain(settings_.audio.inputGainDb), std::memory_order_relaxed);
    targetOutputGain_.store(dbToGain(settings_.audio.outputGainDb), std::memory_order_relaxed);
    outputGain_.store(targetOutputGain_.load(std::memory_order_relaxed), std::memory_order_relaxed);
    guitarInputChannel_.store(settings_.audio.inputChannelOffset, std::memory_order_relaxed);

    std::string audioError;
    if (!restartAudio(audioError)) {
        // Not fatal. The UI needs to come up so the user can choose a device
        // that works instead of being locked out with a dead service.
        audioError_ = audioError;
        logWarn("audio: " + audioError);
    }

    controller_.setConfig(settings_.controller);
    midi_.setMessageHandler([this](const MidiMessage& message) { handleMidiMessage(message); });
    midi_.setSysExHandler([this](const std::vector<uint8_t>& sysex) { handleSysEx(sysex); });
    if (settings_.controller.enabled) {
        std::string midiError;
        if (!midi_.start(settings_.controller.midiPort, midiError)) {
            controllerError_ = midiError;
            logInfo("midi: " + midiError);
        } else if (settings_.controller.midiPort != midi_.activePort()) {
            settings_.controller.midiPort = midi_.activePort();
            persistSettings();
        }
    }

    shuttingDown_.store(false);
    tunerThread_ = std::thread(&Engine::tunerThread, this);
    housekeepingThread_ = std::thread(&Engine::housekeepingThread, this);

    error.clear();
    return true;
}

void Engine::stop() {
    shuttingDown_.store(true);
    if (tunerThread_.joinable()) {
        tunerThread_.join();
    }
    if (housekeepingThread_.joinable()) {
        housekeepingThread_.join();
    }

    midi_.stop();
    if (backend_) {
        backend_->stop();
    }

    Chain* chain = activeChain_.exchange(nullptr);
    delete chain;
    retiredChains_.clear();
    latencyGuard_.reset();
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

bool Engine::restartAudio(std::string& error) {
    if (!backend_) {
        error = "no audio backend";
        return false;
    }

    backend_->stop();

    if (!backend_->start(settings_.audio, this, &metrics_, error)) {
        return false;
    }

    const AudioSettings actual = backend_->actualSettings();
    sampleRate_.store(actual.sampleRate, std::memory_order_release);
    maxFrames_.store(actual.periodFrames, std::memory_order_release);

    // ALSA is allowed to round what we asked for. Storing what we actually got
    // means the UI never shows a number the hardware is not using.
    settings_.audio.sampleRate = actual.sampleRate;
    settings_.audio.periodFrames = actual.periodFrames;
    settings_.audio.periodCount = actual.periodCount;
    settings_.audio.useMmap = actual.useMmap;
    settings_.audio.device = actual.device;
    settings_.audio.inputChannels = actual.inputChannels;
    settings_.audio.outputChannels = actual.outputChannels;
    if (settings_.audio.inputChannelOffset >= settings_.audio.inputChannels) {
        settings_.audio.inputChannelOffset = settings_.audio.inputChannels - 1;
    }
    guitarInputChannel_.store(settings_.audio.inputChannelOffset, std::memory_order_relaxed);

    if (const Preset* preset = activePreset()) {
        std::string chainError;
        if (std::unique_ptr<Chain> chain = buildChain(*preset, chainError)) {
            publishChain(std::move(chain));
        } else if (!chainError.empty()) {
            logWarn("chain: " + chainError);
        }
    }

    audioError_.clear();
    return true;
}

bool Engine::applyAudioSettings(const Json& json, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);

    const AudioSettings previous = settings_.audio;
    settings_.audio = audioSettingsFromJson(json, settings_.audio);

    inputGain_.store(dbToGain(settings_.audio.inputGainDb), std::memory_order_relaxed);
    targetOutputGain_.store(dbToGain(settings_.audio.outputGainDb), std::memory_order_relaxed);
    guitarInputChannel_.store(settings_.audio.inputChannelOffset, std::memory_order_relaxed);

    const bool needsRestart = previous != settings_.audio;
    if (needsRestart) {
        std::string restartError;
        if (!restartAudio(restartError)) {
            // Put the working configuration back rather than leaving the user
            // with silence and a dialog.
            settings_.audio = previous;
            std::string recoveryError;
            if (!restartAudio(recoveryError)) {
                audioError_ = restartError;
            }
            error = restartError;
            persistSettings();
            notify();
            return false;
        }
    }

    persistSettings();
    notify();
    return true;
}

bool Engine::applySystemSettings(const Json& json, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    settings_.system = SystemSettings::fromJson(json);

    if (settings_.system.holdCpuLatency && !latencyGuard_) {
        latencyGuard_ = std::make_unique<rt::CpuLatencyGuard>();
    } else if (!settings_.system.holdCpuLatency) {
        latencyGuard_.reset();
    }

    // Thread priority and affinity are read when the audio thread starts, so
    // changing them means restarting the stream.
    std::string restartError;
    if (!restartAudio(restartError)) {
        error = restartError;
    }
    persistSettings();
    notify();
    return error.empty();
}

void Engine::resetMeters() {
    metrics_.xruns.store(0, std::memory_order_relaxed);
    metrics_.dspLoadPeak.store(0.0f, std::memory_order_relaxed);
}

void Engine::prepareToPlay(unsigned sampleRate, unsigned maxFrames) {
    sampleRate_.store(sampleRate, std::memory_order_release);
    maxFrames_.store(maxFrames, std::memory_order_release);
}

void Engine::releaseResources() {}

void Engine::processAudio(const float* const* inputs, unsigned inputChannels,
                          float* const* outputs, unsigned outputChannels,
                          unsigned frames) {
    audioGeneration_.fetch_add(1, std::memory_order_release);

    Chain* chain = activeChain_.load(std::memory_order_acquire);

    ControlUpdate update;
    while (controlUpdates_.pop(update)) {
        if (chain && update.slotIndex < chain->slots.size()) {
            chain->slots[update.slotIndex]->plugin->setControl(update.portIndex, update.value);
        }
    }

    const unsigned channels = chain ? chain->channels : std::min(outputChannels, 2u);
    const float inputGain = inputGain_.load(std::memory_order_relaxed);
    unsigned guitar = guitarInputChannel_.load(std::memory_order_relaxed);
    if (inputChannels == 0) {
        guitar = 0;
    } else if (guitar >= inputChannels) {
        guitar = inputChannels - 1;
    }

    const auto copyGuitar = [&](float* destination) {
        const float* source = inputs[guitar];
        for (unsigned frame = 0; frame < frames; ++frame) {
            destination[frame] = source[frame] * inputGain;
        }
    };

    const auto feedTuner = [&]() {
        if (!tunerEnabled_.load(std::memory_order_relaxed) || inputChannels == 0) {
            return;
        }
        const float* source = inputs[guitar];
        size_t write = tunerWrite_.load(std::memory_order_relaxed);
        for (unsigned frame = 0; frame < frames; ++frame) {
            tunerRing_[write] = source[frame];
            write = (write + 1) % kTunerRingSize;
        }
        tunerWrite_.store(write, std::memory_order_release);
    };

    if (!chain || chain->bufferA.empty()) {
        feedTuner();
        for (unsigned channel = 0; channel < outputChannels; ++channel) {
            if (inputChannels > 0) {
                copyGuitar(outputs[channel]);
            } else {
                std::fill(outputs[channel], outputs[channel] + frames, 0.0f);
            }
        }
        return;
    }

    for (unsigned channel = 0; channel < channels; ++channel) {
        float* destination = chain->bufferA[channel].data();
        if (inputChannels > 0) {
            copyGuitar(destination);
        } else {
            std::fill(destination, destination + frames, 0.0f);
        }
    }

    feedTuner();

    if (!bypassAll_.load(std::memory_order_relaxed)) {
        std::vector<float*>* source = &chain->pointersA;
        std::vector<float*>* destination = &chain->pointersB;

        for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
            if (!slot->enabled.load(std::memory_order_relaxed) || !slot->plugin) {
                continue;
            }

            const unsigned pluginInputs = slot->plugin->audioInputs();
            const unsigned pluginOutputs = slot->plugin->audioOutputs();
            if (pluginInputs == 0 && pluginOutputs == 0) {
                continue; // a plugin with no audio ports has nothing to do here
            }

            slot->plugin->process(reinterpret_cast<const float* const*>(source->data()),
                                  std::min(pluginInputs, channels),
                                  destination->data(),
                                  std::min(pluginOutputs, channels),
                                  frames);

            // A mono plugin in a stereo chain feeds both sides rather than
            // silencing the right channel.
            if (pluginOutputs == 1 && channels > 1) {
                for (unsigned channel = 1; channel < channels; ++channel) {
                    std::memcpy((*destination)[channel], (*destination)[0], frames * sizeof(float));
                }
            }

            std::swap(source, destination);
        }

        if (source != &chain->pointersA) {
            for (unsigned channel = 0; channel < channels; ++channel) {
                std::memcpy(chain->bufferA[channel].data(), (*source)[channel], frames * sizeof(float));
            }
        }
    }

    // Ramp the output gain rather than stepping it, so a fader move or a
    // mute-on-change never produces a click.
    const float target = bypassAll_.load(std::memory_order_relaxed)
                       ? targetOutputGain_.load(std::memory_order_relaxed)
                       : targetOutputGain_.load(std::memory_order_relaxed);
    float gain = outputGain_.load(std::memory_order_relaxed);
    const float step = (target - gain) / static_cast<float>(std::max(1u, frames));

    for (unsigned frame = 0; frame < frames; ++frame) {
        gain += step;
        for (unsigned channel = 0; channel < outputChannels; ++channel) {
            const unsigned source = std::min(channel, channels - 1);
            outputs[channel][frame] = chain->bufferA[source][frame] * gain;
        }
    }
    outputGain_.store(target, std::memory_order_relaxed);
}

// ---------------------------------------------------------------------------
// Chain lifecycle
// ---------------------------------------------------------------------------

std::unique_ptr<Engine::Chain> Engine::buildChain(const Preset& preset, std::string& error) {
    auto chain = std::make_unique<Chain>();
    const unsigned channels = std::max(1u, std::min(settings_.audio.outputChannels, 2u));
    const unsigned frames = std::max(64u, maxFrames_.load(std::memory_order_acquire));

    chain->channels = channels;
    chain->bufferA.assign(channels, std::vector<float>(frames, 0.0f));
    chain->bufferB.assign(channels, std::vector<float>(frames, 0.0f));
    chain->pointersA.resize(channels);
    chain->pointersB.resize(channels);
    for (unsigned channel = 0; channel < channels; ++channel) {
        chain->pointersA[channel] = chain->bufferA[channel].data();
        chain->pointersB[channel] = chain->bufferB[channel].data();
    }

    std::string failures;
    for (const EffectSlot& slot : preset.chain) {
        std::string slotError;
        std::unique_ptr<PluginInstance> plugin = PluginInstance::create(
            catalog_, slot.uri, sampleRate_.load(std::memory_order_acquire), frames, slotError);

        if (!plugin) {
            // A preset that names a plugin the user has not installed still
            // loads; the missing effect is reported and skipped rather than
            // taking the whole preset down.
            failures += (failures.empty() ? "" : "; ") + slotError;
            continue;
        }
        plugin->loadState(slot.state);

        auto chainSlot = std::make_unique<ChainSlot>();
        chainSlot->id = slot.id;
        chainSlot->plugin = std::move(plugin);
        chainSlot->enabled.store(slot.enabled, std::memory_order_relaxed);
        chain->slots.push_back(std::move(chainSlot));
    }

    error = failures;
    return chain;
}

void Engine::publishChain(std::unique_ptr<Chain> chain) {
    std::lock_guard<std::mutex> lock(chainMutex_);
    Chain* previous = activeChain_.exchange(chain.release(), std::memory_order_acq_rel);
    if (previous) {
        // The audio thread may still be inside the old chain. It is retired
        // with the current generation and freed once the audio thread has
        // published two further periods, by which point it cannot be in use.
        retiredChains_.emplace_back(std::unique_ptr<Chain>(previous),
                                    audioGeneration_.load(std::memory_order_acquire));
    }
}

void Engine::collectRetiredChains() {
    std::lock_guard<std::mutex> lock(chainMutex_);
    const uint64_t now = audioGeneration_.load(std::memory_order_acquire);
    const bool audioRunning = backend_ && backend_->isRunning();

    retiredChains_.erase(
        std::remove_if(retiredChains_.begin(), retiredChains_.end(),
                       [&](const std::pair<std::unique_ptr<Chain>, uint64_t>& entry) {
                           return !audioRunning || now > entry.second + 2;
                       }),
        retiredChains_.end());
}

// ---------------------------------------------------------------------------
// Presets and banks
// ---------------------------------------------------------------------------

Bank* Engine::findBank(const std::string& bankId) {
    for (Bank& bank : banks_) {
        if (bank.id == bankId) {
            return &bank;
        }
    }
    return nullptr;
}

Bank* Engine::activeBank() { return findBank(activeBankId_); }

const Bank* Engine::activeBank() const {
    return const_cast<Engine*>(this)->findBank(activeBankId_);
}

Preset* Engine::activePreset() {
    Bank* bank = activeBank();
    if (!bank) {
        return nullptr;
    }
    for (Preset& preset : bank->presets) {
        if (preset.id == activePresetId_) {
            return &preset;
        }
    }
    return nullptr;
}

const Preset* Engine::activePreset() const {
    return const_cast<Engine*>(this)->activePreset();
}

void Engine::syncPresetFromChain() {
    Preset* preset = activePreset();
    Chain* chain = activeChain_.load(std::memory_order_acquire);
    if (!preset || !chain) {
        return;
    }
    // A recalled snapshot is only live parameters. Writing those back into the
    // stored chain would promote the snapshot into the base preset.
    if (preset->activeSnapshot >= 0) {
        return;
    }
    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
        EffectSlot* stored = preset->findSlot(slot->id);
        if (!stored || !slot->plugin) {
            continue;
        }
        stored->state = slot->plugin->saveState();
        stored->enabled = slot->enabled.load(std::memory_order_relaxed);
    }
}

bool Engine::selectPreset(const std::string& bankId, const std::string& presetId, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);

    Bank* bank = findBank(bankId.empty() ? activeBankId_ : bankId);
    if (!bank) {
        error = "no such bank";
        return false;
    }

    Preset* target = nullptr;
    for (Preset& preset : bank->presets) {
        if (preset.id == presetId) {
            target = &preset;
            break;
        }
    }
    if (!target) {
        error = "no such preset";
        return false;
    }

    syncPresetFromChain();

    activeBankId_ = bank->id;
    activePresetId_ = target->id;

    std::string chainError;
    std::unique_ptr<Chain> chain = buildChain(*target, chainError);
    if (!chainError.empty()) {
        logWarn("preset '" + target->name + "': " + chainError);
    }
    publishChain(std::move(chain));

    targetOutputGain_.store(dbToGain(settings_.audio.outputGainDb + target->outputGainDb),
                            std::memory_order_relaxed);

    settings_.activeBankId = activeBankId_;
    settings_.activePresetId = activePresetId_;
    persistSettings();
    refreshLeds();
    notify();
    return true;
}

bool Engine::stepPreset(int delta, std::string& error) {
    const Bank* bank = activeBank();
    if (!bank || bank->presets.empty()) {
        error = "no presets in this bank";
        return false;
    }
    int index = 0;
    for (size_t i = 0; i < bank->presets.size(); ++i) {
        if (bank->presets[i].id == activePresetId_) {
            index = static_cast<int>(i);
            break;
        }
    }
    const int count = static_cast<int>(bank->presets.size());
    index = ((index + delta) % count + count) % count;
    return selectPreset(bank->id, bank->presets[static_cast<size_t>(index)].id, error);
}

bool Engine::stepBank(int delta, std::string& error) {
    if (banks_.empty()) {
        error = "no banks";
        return false;
    }
    int index = 0;
    for (size_t i = 0; i < banks_.size(); ++i) {
        if (banks_[i].id == activeBankId_) {
            index = static_cast<int>(i);
            break;
        }
    }
    const int count = static_cast<int>(banks_.size());
    index = ((index + delta) % count + count) % count;
    const Bank& bank = banks_[static_cast<size_t>(index)];
    if (bank.presets.empty()) {
        error = "that bank is empty";
        return false;
    }
    return selectPreset(bank.id, bank.presets.front().id, error);
}

bool Engine::savePreset(std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    syncPresetFromChain();
    Bank* bank = activeBank();
    if (!bank) {
        error = "no active bank";
        return false;
    }
    if (!storage_.saveBank(*bank)) {
        error = "could not write the bank file";
        return false;
    }
    notify();
    return true;
}

bool Engine::savePresetAs(const std::string& name, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    syncPresetFromChain();

    Bank* bank = activeBank();
    const Preset* source = activePreset();
    if (!bank || !source) {
        error = "nothing to save";
        return false;
    }

    Preset copy = *source;
    copy.id = newId("preset");
    copy.name = name.empty() ? source->name + " copy" : name;
    bank->presets.push_back(copy);
    activePresetId_ = copy.id;

    if (!storage_.saveBank(*bank)) {
        error = "could not write the bank file";
        return false;
    }
    settings_.activePresetId = activePresetId_;
    persistSettings();
    notify();
    return true;
}

bool Engine::renamePreset(const std::string& presetId, const std::string& name, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Bank* bank = activeBank();
    if (!bank) {
        error = "no active bank";
        return false;
    }
    for (Preset& preset : bank->presets) {
        if (preset.id == presetId) {
            preset.name = name;
            storage_.saveBank(*bank);
            notify();
            return true;
        }
    }
    error = "no such preset";
    return false;
}

bool Engine::deletePreset(const std::string& presetId, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Bank* bank = activeBank();
    if (!bank) {
        error = "no active bank";
        return false;
    }
    if (bank->presets.size() <= 1) {
        error = "a bank must keep at least one preset";
        return false;
    }

    const auto found = std::find_if(bank->presets.begin(), bank->presets.end(),
                                    [&](const Preset& preset) { return preset.id == presetId; });
    if (found == bank->presets.end()) {
        error = "no such preset";
        return false;
    }

    const bool wasActive = presetId == activePresetId_;
    bank->presets.erase(found);
    storage_.saveBank(*bank);

    if (wasActive) {
        activePresetId_ = bank->presets.front().id;
        std::string chainError;
        publishChain(buildChain(bank->presets.front(), chainError));
        settings_.activePresetId = activePresetId_;
        persistSettings();
    }
    notify();
    return true;
}

bool Engine::reorderPreset(const std::string& presetId, int newIndex, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Bank* bank = activeBank();
    if (!bank) {
        error = "no active bank";
        return false;
    }
    const auto found = std::find_if(bank->presets.begin(), bank->presets.end(),
                                    [&](const Preset& preset) { return preset.id == presetId; });
    if (found == bank->presets.end()) {
        error = "no such preset";
        return false;
    }
    Preset moved = *found;
    bank->presets.erase(found);
    newIndex = std::max(0, std::min(newIndex, static_cast<int>(bank->presets.size())));
    bank->presets.insert(bank->presets.begin() + newIndex, std::move(moved));
    storage_.saveBank(*bank);
    notify();
    return true;
}

bool Engine::movePresetToBank(const std::string& presetId, const std::string& targetBankId, int newIndex, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Bank* source = nullptr;
    auto found = std::vector<Preset>::iterator();
    for (Bank& bank : banks_) {
        auto it = std::find_if(bank.presets.begin(), bank.presets.end(),
                               [&](const Preset& preset) { return preset.id == presetId; });
        if (it != bank.presets.end()) {
            source = &bank;
            found = it;
            break;
        }
    }
    if (!source) {
        error = "no such preset";
        return false;
    }
    Bank* target = findBank(targetBankId);
    if (!target) {
        error = "no such bank";
        return false;
    }
    if (source->id == target->id) {
        Preset moved = *found;
        source->presets.erase(found);
        newIndex = std::max(0, std::min(newIndex, static_cast<int>(source->presets.size())));
        source->presets.insert(source->presets.begin() + newIndex, std::move(moved));
        storage_.saveBank(*source);
        notify();
        return true;
    }
    if (source->presets.size() < 2) {
        error = "a bank must keep at least one preset";
        return false;
    }
    Preset moved = *found;
    source->presets.erase(found);
    newIndex = std::max(0, std::min(newIndex, static_cast<int>(target->presets.size())));
    target->presets.insert(target->presets.begin() + newIndex, std::move(moved));
    if (settings_.controller.presetAssignments.has(source->id)) {
        const Json& current = settings_.controller.presetAssignments[source->id];
        Json cleaned = Json::object();
        for (const Json::Member& member : current.members()) {
            if (member.second.asString() != presetId) {
                cleaned.set(member.first, member.second);
            }
        }
        settings_.controller.presetAssignments.set(source->id, cleaned);
    }
    storage_.saveBank(*source);
    storage_.saveBank(*target);
    notify();
    return true;
}

bool Engine::createBank(const std::string& name, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Bank bank;
    bank.id = newId("bank");
    bank.name = name.empty() ? "New Bank" : name;
    bank.order = static_cast<int>(banks_.size());
    Preset preset;
    preset.id = newId("preset");
    preset.name = "Preset 1";
    bank.presets.push_back(std::move(preset));

    if (!storage_.saveBank(bank)) {
        error = "could not write the bank file";
        return false;
    }
    banks_.push_back(std::move(bank));
    notify();
    return true;
}

bool Engine::renameBank(const std::string& bankId, const std::string& name, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Bank* bank = findBank(bankId);
    if (!bank) {
        error = "no such bank";
        return false;
    }
    bank->name = name;
    storage_.saveBank(*bank);
    notify();
    return true;
}

bool Engine::deleteBank(const std::string& bankId, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    if (banks_.size() <= 1) {
        error = "at least one bank has to remain";
        return false;
    }
    const auto found = std::find_if(banks_.begin(), banks_.end(),
                                    [&](const Bank& bank) { return bank.id == bankId; });
    if (found == banks_.end()) {
        error = "no such bank";
        return false;
    }

    storage_.deleteBank(bankId);
    const bool wasActive = bankId == activeBankId_;
    banks_.erase(found);

    if (wasActive) {
        activeBankId_ = banks_.front().id;
        activePresetId_ = banks_.front().presets.empty() ? "" : banks_.front().presets.front().id;
        if (const Preset* preset = activePreset()) {
            std::string chainError;
            publishChain(buildChain(*preset, chainError));
        }
        settings_.activeBankId = activeBankId_;
        settings_.activePresetId = activePresetId_;
        persistSettings();
    }
    notify();
    return true;
}

bool Engine::reorderBank(const std::string& bankId, int newIndex, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    const auto found = std::find_if(banks_.begin(), banks_.end(),
                                    [&](const Bank& bank) { return bank.id == bankId; });
    if (found == banks_.end()) {
        error = "no such bank";
        return false;
    }
    Bank moved = *found;
    banks_.erase(found);
    newIndex = std::max(0, std::min(newIndex, static_cast<int>(banks_.size())));
    banks_.insert(banks_.begin() + newIndex, std::move(moved));
    for (size_t i = 0; i < banks_.size(); ++i) {
        banks_[i].order = static_cast<int>(i);
        storage_.saveBank(banks_[i]);
    }
    notify();
    return true;
}

Json Engine::exportBank(const std::string& bankId) const {
    for (const Bank& bank : banks_) {
        if (bank.id == bankId) {
            Json json = bank.toJson();
            json.set("format", "pimfx-bank");
            json.set("formatVersion", 1);
            return json;
        }
    }
    return Json();
}

bool Engine::importBank(const Json& json, std::string& error) {
    if (json["format"].asString() != "pimfx-bank") {
        error = "that file is not a Pi-MFX bank";
        return false;
    }
    std::lock_guard<std::mutex> lock(stateMutex_);

    Bank bank = Bank::fromJson(json);
    // Fresh identifiers, so importing a bank twice gives two banks rather than
    // silently replacing the first.
    bank.id = newId("bank");
    bank.order = static_cast<int>(banks_.size());
    for (Preset& preset : bank.presets) {
        preset.id = newId("preset");
        for (EffectSlot& slot : preset.chain) {
            slot.id = newId("slot");
        }
    }

    if (!storage_.saveBank(bank)) {
        error = "could not write the imported bank";
        return false;
    }
    banks_.push_back(std::move(bank));
    notify();
    return true;
}

// ---------------------------------------------------------------------------
// Chain editing
// ---------------------------------------------------------------------------

bool Engine::addEffect(const std::string& uri, int index, std::string& slotId, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    const PluginInfo* info = catalog_.find(uri);
    if (!info) {
        error = "that plugin is not installed";
        return false;
    }

    syncPresetFromChain();

    EffectSlot slot;
    slot.id = newId("slot");
    slot.uri = uri;
    slot.name = info->name;
    slot.enabled = true;

    index = index < 0 ? static_cast<int>(preset->chain.size())
                      : std::min(index, static_cast<int>(preset->chain.size()));
    preset->chain.insert(preset->chain.begin() + index, slot);
    slotId = slot.id;

    std::string chainError;
    std::unique_ptr<Chain> chain = buildChain(*preset, chainError);
    if (!chainError.empty()) {
        error = chainError;
    }
    publishChain(std::move(chain));
    notify();
    return true;
}

bool Engine::removeEffect(const std::string& slotId, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    syncPresetFromChain();

    const auto found = std::find_if(preset->chain.begin(), preset->chain.end(),
                                    [&](const EffectSlot& slot) { return slot.id == slotId; });
    if (found == preset->chain.end()) {
        error = "no such effect";
        return false;
    }
    preset->chain.erase(found);

    std::string chainError;
    publishChain(buildChain(*preset, chainError));
    notify();
    return true;
}

bool Engine::moveEffect(const std::string& slotId, int newIndex, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    syncPresetFromChain();

    const auto found = std::find_if(preset->chain.begin(), preset->chain.end(),
                                    [&](const EffectSlot& slot) { return slot.id == slotId; });
    if (found == preset->chain.end()) {
        error = "no such effect";
        return false;
    }
    EffectSlot moved = *found;
    preset->chain.erase(found);
    newIndex = std::max(0, std::min(newIndex, static_cast<int>(preset->chain.size())));
    preset->chain.insert(preset->chain.begin() + newIndex, std::move(moved));

    std::string chainError;
    publishChain(buildChain(*preset, chainError));
    notify();
    return true;
}

bool Engine::setEffectEnabled(const std::string& slotId, bool enabled, std::string& error) {
    Chain* chain = activeChain_.load(std::memory_order_acquire);
    if (!chain) {
        error = "no chain is running";
        return false;
    }
    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
        if (slot->id == slotId) {
            slot->enabled.store(enabled, std::memory_order_relaxed);
            if (Preset* preset = activePreset()) {
                if (EffectSlot* stored = preset->findSlot(slotId)) {
                    stored->enabled = enabled;
                }
            }
            refreshLeds();
            notifyPerformance();
            return true;
        }
    }
    error = "no such effect";
    return false;
}

bool Engine::setEffectName(const std::string& slotId, const std::string& name, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    EffectSlot* slot = preset->findSlot(slotId);
    if (!slot) {
        error = "no such effect";
        return false;
    }
    slot->name = name;
    notify();
    return true;
}

bool Engine::setControlValue(const std::string& slotId, const std::string& portSymbol,
                             float value, std::string& error) {
    Chain* chain = activeChain_.load(std::memory_order_acquire);
    if (!chain) {
        error = "no chain is running";
        return false;
    }

    for (size_t index = 0; index < chain->slots.size(); ++index) {
        ChainSlot& slot = *chain->slots[index];
        if (slot.id != slotId || !slot.plugin) {
            continue;
        }
        for (const PortInfo& port : slot.plugin->info().ports) {
            if (!port.control || !port.input || port.symbol != portSymbol) {
                continue;
            }
            const float clamped = std::max(port.minimum, std::min(port.maximum, value));
            // Queued rather than written directly: the audio thread applies it
            // between periods so a moving knob cannot land mid-buffer.
            if (!controlUpdates_.push({static_cast<uint32_t>(index), port.index, clamped})) {
                slot.plugin->setControl(port.index, clamped);
            }
            notifyPerformance();
            return true;
        }
        error = "no such control on this effect";
        return false;
    }
    error = "no such effect";
    return false;
}

bool Engine::setEffectProperty(const std::string& slotId, const std::string& propertyUri,
                               const std::string& path, std::string& error) {
    // Paths in presets can come from anywhere, including a bank someone else
    // wrote, so only files inside the library are ever handed to a plugin.
    if (!path.empty() && !storage_.isPathInLibrary(path)) {
        error = "that file is not in the Pi-MFX library";
        return false;
    }

    Chain* chain = activeChain_.load(std::memory_order_acquire);
    if (!chain) {
        error = "no chain is running";
        return false;
    }
    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
        if (slot->id != slotId || !slot->plugin) {
            continue;
        }
        if (!slot->plugin->setProperty(propertyUri, path, error)) {
            return false;
        }
        if (Preset* preset = activePreset()) {
            if (EffectSlot* stored = preset->findSlot(slotId)) {
                Json properties = stored->state["properties"].isObject()
                                ? stored->state["properties"] : Json::object();
                properties.set(propertyUri, Json(path));
                Json state = stored->state.isObject() ? stored->state : Json::object();
                state.set("properties", properties);
                stored->state = state;
            }
        }
        notify();
        return true;
    }
    error = "no such effect";
    return false;
}

bool Engine::setBypassAll(bool bypassed) {
    bypassAll_.store(bypassed, std::memory_order_relaxed);
    refreshLeds();
    notifyPerformance();
    return true;
}

bool Engine::bypassAll() const {
    return bypassAll_.load(std::memory_order_relaxed);
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

Snapshot Engine::captureCurrentChain(const std::string& name) const {
    Snapshot snapshot;
    snapshot.id = newId("snap");
    snapshot.name = name.empty() ? "Snapshot" : name;

    Chain* chain = activeChain_.load(std::memory_order_acquire);
    if (!chain) {
        return snapshot;
    }
    Json slots = Json::object();
    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
        if (!slot->plugin) {
            continue;
        }
        Json state = slot->plugin->saveState();
        state.set("enabled", slot->enabled.load(std::memory_order_relaxed));
        slots.set(slot->id, state);
    }
    snapshot.slots = slots;
    return snapshot;
}

void Engine::applySnapshotToChain(const Snapshot& snapshot) {
    Chain* chain = activeChain_.load(std::memory_order_acquire);
    if (!chain) {
        return;
    }
    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
        if (!slot->plugin || !snapshot.slots.has(slot->id)) {
            continue;
        }
        const Json& state = snapshot.slots[slot->id];
        slot->plugin->loadState(state);
        slot->enabled.store(state["enabled"].asBool(true), std::memory_order_relaxed);
    }
}

bool Engine::captureSnapshot(const std::string& name, std::string& snapshotId, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    Snapshot snapshot = captureCurrentChain(name);
    snapshotId = snapshot.id;
    preset->snapshots.push_back(std::move(snapshot));
    preset->activeSnapshot = static_cast<int>(preset->snapshots.size()) - 1;

    if (Bank* bank = activeBank()) {
        storage_.saveBank(*bank);
    }
    notify();
    return true;
}

bool Engine::selectSnapshot(const std::string& snapshotId, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    for (size_t i = 0; i < preset->snapshots.size(); ++i) {
        if (preset->snapshots[i].id != snapshotId) {
            continue;
        }
        // Nothing is re-instantiated: a snapshot only moves parameters, which
        // is why switching one is instant and gap-free.
        applySnapshotToChain(preset->snapshots[i]);
        preset->activeSnapshot = static_cast<int>(i);
        refreshLeds();
        notify();
        return true;
    }
    error = "no such snapshot";
    return false;
}

bool Engine::updateSnapshot(const std::string& snapshotId, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    for (Snapshot& snapshot : preset->snapshots) {
        if (snapshot.id != snapshotId) {
            continue;
        }
        const Snapshot captured = captureCurrentChain(snapshot.name);
        snapshot.slots = captured.slots;
        if (Bank* bank = activeBank()) {
            storage_.saveBank(*bank);
        }
        notify();
        return true;
    }
    error = "no such snapshot";
    return false;
}

bool Engine::renameSnapshot(const std::string& snapshotId, const std::string& name, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    for (Snapshot& snapshot : preset->snapshots) {
        if (snapshot.id != snapshotId) {
            continue;
        }
        snapshot.name = name.empty() ? snapshot.name : name;
        storage_.saveBank(*activeBank());
        notify();
        return true;
    }
    error = "no such snapshot";
    return false;
}

bool Engine::colorSnapshot(const std::string& snapshotId, const std::string& color, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    for (Snapshot& snapshot : preset->snapshots) {
        if (snapshot.id != snapshotId) {
            continue;
        }
        snapshot.color = color;
        storage_.saveBank(*activeBank());
        notify();
        return true;
    }
    error = "no such snapshot";
    return false;
}

bool Engine::setSnapshotMode(bool enabled) {
    snapshotMode_.store(enabled, std::memory_order_relaxed);
    notify();
    notifyPerformance();
    return true;
}

bool Engine::restoreLiveFromStoredPreset(std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    Chain* chain = activeChain_.load(std::memory_order_acquire);
    if (!preset || !chain) {
        error = "no active preset";
        return false;
    }
    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
        if (!slot->plugin) {
            continue;
        }
        const EffectSlot* stored = preset->findSlot(slot->id);
        if (!stored) {
            continue;
        }
        slot->plugin->loadState(stored->state);
        slot->enabled.store(stored->enabled, std::memory_order_relaxed);
    }
    preset->activeSnapshot = -1;
    refreshLeds();
    notify();
    return true;
}

bool Engine::deleteSnapshot(const std::string& snapshotId, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    const auto found = std::find_if(preset->snapshots.begin(), preset->snapshots.end(),
                                    [&](const Snapshot& snapshot) { return snapshot.id == snapshotId; });
    if (found == preset->snapshots.end()) {
        error = "no such snapshot";
        return false;
    }
    preset->snapshots.erase(found);
    preset->activeSnapshot = -1;
    if (Bank* bank = activeBank()) {
        storage_.saveBank(*bank);
    }
    notify();
    return true;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

bool Engine::applyControllerConfig(const Json& json, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    const std::string previousPort = settings_.controller.midiPort;
    const bool wasEnabled = settings_.controller.enabled;
    settings_.controller = ControllerConfig::fromJson(json);
    controller_.setConfig(settings_.controller);

    const bool portChanged = settings_.controller.midiPort != previousPort;

    if (settings_.controller.enabled) {
        if (!midi_.isRunning() || portChanged || !wasEnabled) {
            std::string midiError;
            if (!midi_.start(settings_.controller.midiPort, midiError)) {
                controllerError_ = midiError;
            } else {
                controllerError_.clear();
                settings_.controller.midiPort = midi_.activePort();
                controller_.setConfig(settings_.controller);
                midi_.send(ControllerRuntime::encodeIdentityRequest());
            }
        }
    } else if (midi_.isRunning()) {
        midi_.stop();
    }

    persistSettings();
    refreshLeds();
    notify();
    error.clear();
    return true;
}

bool Engine::connectController(const std::string& port, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    if (!midi_.start(port, error)) {
        controllerError_ = error;
        notify();
        return false;
    }
    settings_.controller.enabled = true;
    settings_.controller.midiPort = midi_.activePort();
    controller_.setConfig(settings_.controller);
    controllerError_.clear();
    persistSettings();

    midi_.send(ControllerRuntime::encodeIdentityRequest());
    refreshLeds();
    notify();
    return true;
}

void Engine::disconnectController() {
    std::lock_guard<std::mutex> lock(stateMutex_);
    midi_.stop();
    settings_.controller.enabled = false;
    persistSettings();
    notify();
}

void Engine::beginControlLearn(const std::string& controlId) {
    controller_.beginLearn(controlId);
    notify();
}

void Engine::cancelControlLearn() {
    controller_.cancelLearn();
    notify();
}

bool Engine::pressVirtualControl(const std::string& controlId, bool pressed, std::string& error) {
    const ControllerConfig config = controller_.config();
    for (const ControllerControl& control : config.controls) {
        if (control.id != controlId) {
            continue;
        }
        const bool continuous = control.kind == ControlKind::Pot
                             || control.kind == ControlKind::Slider
                             || control.kind == ControlKind::Expression;
        if (continuous) {
            return true;
        }
        ActionRequest request;
        request.controlId = control.id;
        request.binding = control.binding;
        request.action = control.binding.action;
        request.pressed = pressed;
        request.value = control.binding.minimum;
        if (pressed) {
            runAction(request);
        }
        return true;
    }
    error = "no such control";
    return false;
}

bool Engine::setVirtualControlValue(const std::string& controlId, float value, std::string& error) {
    const ControllerConfig config = controller_.config();
    for (const ControllerControl& control : config.controls) {
        if (control.id != controlId) {
            continue;
        }
        const float visual = std::max(0.0f, std::min(1.0f, value));
        controller_.setPosition(control.id, visual);
        float normalised = visual;
        if (control.binding.inverted) {
            normalised = 1.0f - normalised;
        }
        ActionRequest request;
        request.controlId = control.id;
        request.binding = control.binding;
        request.action = control.binding.action;
        request.pressed = true;
        request.value = control.binding.minimum
            + normalised * (control.binding.maximum - control.binding.minimum);
        runAction(request);
        return true;
    }
    error = "no such control";
    return false;
}

void Engine::handleMidiMessage(const MidiMessage& message) {
    for (const ActionRequest& request : controller_.handleMessage(message)) {
        if (request.action == "learned") {
            // Learning changed the runtime copy of the config; persist it so a
            // reboot does not lose the assignment.
            settings_.controller = controller_.config();
            persistSettings();
            notify();
            continue;
        }
        runAction(request);
    }
}

void Engine::handleSysEx(const std::vector<uint8_t>& sysex) {
    ControllerRuntime::Identity identity;
    if (!ControllerRuntime::parseIdentity(sysex, identity)) {
        return;
    }
    logInfo("controller: firmware " + identity.firmwareVersion + ", "
            + std::to_string(identity.controlCount) + " controls, "
            + std::to_string(identity.ledCount) + (identity.rgbLeds ? " RGB LEDs" : " LEDs"));
    refreshLeds();
    notify();
}

void Engine::runAction(const ActionRequest& request) {
    std::string error;
    const ControlBinding& binding = request.binding;

    if (request.action == "presetUp") {
        stepPreset(1, error);
    } else if (request.action == "presetDown") {
        stepPreset(-1, error);
    } else if (request.action == "bankUp") {
        stepBank(1, error);
    } else if (request.action == "bankDown") {
        stepBank(-1, error);
    } else if (request.action == "selectPreset") {
        const ControllerConfig config = controller_.config();
        std::string bankId = binding.bankId.empty() ? activeBankId_ : binding.bankId;
        std::string presetId = binding.presetId;
        if (presetId.empty()) {
            presetId = assignedPresetForControl(config, bankId, request.controlId);
        }
        selectPreset(bankId, presetId, error);
    } else if (request.action == "selectSnapshot") {
        selectSnapshot(binding.snapshotId, error);
    } else if (request.action == "toggleEffect") {
        Chain* chain = activeChain_.load(std::memory_order_acquire);
        bool enabled = true;
        if (chain) {
            for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
                if (slot->id == binding.slotId) {
                    enabled = !slot->enabled.load(std::memory_order_relaxed);
                    break;
                }
            }
        }
        setEffectEnabled(binding.slotId, enabled, error);
    } else if (request.action == "setParameter") {
        setControlValue(binding.slotId, binding.portSymbol, request.value, error);
        notifyPerformance();
    } else if (request.action == "bypassAll") {
        setBypassAll(!bypassAll_.load(std::memory_order_relaxed));
    } else if (request.action == "snapshotMode") {
        setSnapshotMode(!snapshotMode_.load(std::memory_order_relaxed));
    } else if (request.action == "tapTempo") {
        tapTempo();
    } else if (request.action == "tuner") {
        setTunerEnabled(!tunerEnabled_.load(std::memory_order_relaxed));
        notify();
    } else if (request.action == "none") {
        return;
    }

    if (!error.empty()) {
        logDebug("controller action '" + request.action + "': " + error);
    }
}

void Engine::refreshLeds() {
    const ControllerConfig config = controller_.config();
    if (!config.enabled || !config.syncLedColours || config.leds.empty()) {
        return;
    }

    // LED colours come from the same theme roles the on-screen indicators use,
    // so the board and the screen always agree. The UI pushes the resolved RGB
    // for each role; until it does, these defaults match the stock theme.
    struct RoleColour { const char* role; uint8_t r, g, b; };
    static const RoleColour kRoles[] = {
        {"preset", 0x22, 0xD3, 0xEE},
        {"navigation", 0xA7, 0x70, 0xE4},
        {"utility", 0xF5, 0xF3, 0xF7},
        {"snapshot", 0xFB, 0xBF, 0x24},
        {"bypass", 0x64, 0x74, 0x8B},
        {"danger", 0xF8, 0x71, 0x71},
    };

    Chain* chain = activeChain_.load(std::memory_order_acquire);
    std::vector<LedState> states;
    states.reserve(config.leds.size());

    for (const ControllerLed& led : config.leds) {
        LedState state;
        state.ledId = led.id;
        state.pixelIndex = led.pixelIndex;
        state.on = true;

        for (const RoleColour& role : kRoles) {
            if (led.role == role.role) {
                state.red = role.r;
                state.green = role.g;
                state.blue = role.b;
                break;
            }
        }
        const Json& themeColor = settings_.ui.ledColors[led.role];
        if (themeColor.isString()) {
            const std::string hex = themeColor.asString();
            if (hex.size() == 7 && hex[0] == '#') {
                state.red = static_cast<uint8_t>(std::strtol(hex.substr(1, 2).c_str(), nullptr, 16));
                state.green = static_cast<uint8_t>(std::strtol(hex.substr(3, 2).c_str(), nullptr, 16));
                state.blue = static_cast<uint8_t>(std::strtol(hex.substr(5, 2).c_str(), nullptr, 16));
            }
        }

        // An LED tied to a control follows what that control currently does,
        // so a switch bound to an effect lights only while that effect is on.
        for (const ControllerControl& control : config.controls) {
            if (control.ledId != led.id) {
                continue;
            }
            if (control.binding.action == "toggleEffect" && chain) {
                state.on = false;
                for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
                    if (slot->id == control.binding.slotId) {
                        state.on = slot->enabled.load(std::memory_order_relaxed);
                        break;
                    }
                }
            } else if (control.binding.action == "selectPreset") {
                std::string presetId = control.binding.presetId;
                if (presetId.empty()) {
                    presetId = assignedPresetForControl(config, activeBankId_, control.id);
                }
                state.on = !presetId.empty() && presetId == activePresetId_;
            } else if (control.binding.action == "bypassAll") {
                state.on = bypassAll_.load(std::memory_order_relaxed);
            }
            break;
        }

        states.push_back(std::move(state));
    }

    midi_.send(controller_.encodeLedMessage(states, config.ledBrightness));
}

// ---------------------------------------------------------------------------
// Preferences, library, tempo, tuner
// ---------------------------------------------------------------------------

bool Engine::applyUiSettings(const Json& json, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Json merged = settings_.ui.toJson();
    if (json.isObject()) {
        for (const auto& member : json.members()) {
            merged.set(member.first, member.second);
        }
    }
    settings_.ui = UiSettings::fromJson(merged);
    if (!persistSettings()) {
        error = "could not save settings";
        return false;
    }
    refreshLeds();
    notify();
    return true;
}

bool Engine::storeLibraryFile(const std::string& kind, const std::string& name,
                              const std::string& contents, std::string& storedPath,
                              std::string& error) {
    const bool isModel = kind == "model";
    const std::string root = isModel ? storage_.paths().modelsDir : storage_.paths().irsDir;

    const std::string safeName = sanitizeFileName(name);
    if (safeName.empty()) {
        error = "that file name cannot be used";
        return false;
    }
    if (contents.size() > 64u * 1024u * 1024u) {
        error = "that file is too large";
        return false;
    }

    storedPath = joinPath(root, safeName);
    if (!writeFileAtomic(storedPath, contents)) {
        error = "could not write the file";
        return false;
    }
    notify();
    return true;
}

bool Engine::deleteLibraryFile(const std::string& path, std::string& error) {
    if (!storage_.isPathInLibrary(path)) {
        error = "that file is not in the Pi-MFX library";
        return false;
    }
    if (!removeFile(path)) {
        error = "could not delete the file";
        return false;
    }
    notify();
    return true;
}

void Engine::tapTempo() {
    std::lock_guard<std::mutex> lock(tapMutex_);
    const auto now = std::chrono::steady_clock::now();

    // Taps more than two seconds apart start a new count rather than averaging
    // across a pause.
    if (!tapTimes_.empty()
        && std::chrono::duration_cast<std::chrono::milliseconds>(now - tapTimes_.back()).count() > 2000) {
        tapTimes_.clear();
    }
    tapTimes_.push_back(now);
    if (tapTimes_.size() > 4) {
        tapTimes_.erase(tapTimes_.begin());
    }
    if (tapTimes_.size() < 2) {
        return;
    }

    double total = 0.0;
    for (size_t i = 1; i < tapTimes_.size(); ++i) {
        total += std::chrono::duration<double>(tapTimes_[i] - tapTimes_[i - 1]).count();
    }
    const double average = total / static_cast<double>(tapTimes_.size() - 1);
    if (average <= 0.0) {
        return;
    }

    const double bpm = std::max(30.0, std::min(300.0, 60.0 / average));
    if (Preset* preset = activePreset()) {
        preset->tempo = bpm;
    }
    notifyPerformance();
}

TunerReading Engine::tuner() const {
    std::lock_guard<std::mutex> lock(tunerMutex_);
    return tunerReading_;
}

void Engine::setTunerEnabled(bool enabled) {
    tunerEnabled_.store(enabled, std::memory_order_relaxed);
}

void Engine::tunerThread() {
    std::vector<float> window(4096, 0.0f);

    while (!shuttingDown_.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(60));
        if (!tunerEnabled_.load(std::memory_order_relaxed)) {
            continue;
        }

        const size_t write = tunerWrite_.load(std::memory_order_acquire);
        for (size_t i = 0; i < window.size(); ++i) {
            const size_t index = (write + kTunerRingSize - window.size() + i) % kTunerRingSize;
            window[i] = tunerRing_[index];
        }

        const TunerReading reading = analysePitch(window, sampleRate_.load(std::memory_order_acquire));
        {
            std::lock_guard<std::mutex> lock(tunerMutex_);
            tunerReading_ = reading;
        }
    }
}

void Engine::housekeepingThread() {
    int ticks = 0;
    int audioRetryLog = 0;
    while (!shuttingDown_.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(25));

        for (const ActionRequest& request : controller_.pollHolds()) {
            runAction(request);
        }
        collectRetiredChains();

        // Meters update several times a second; the full state only changes
        // when something actually changes, so it is not sent on a timer.
        if (++ticks % 4 == 0) {
            std::lock_guard<std::mutex> lock(listenerMutex_);
            if (listener_) {
                listener_(meterState());
            }
        }

        // USB interfaces often appear after the service has already started.
        // Retry every two seconds until a guitar card is there.
        if (ticks % 80 == 0 && backend_ && !backend_->isRunning()
            && !shuttingDown_.load()) {
            std::lock_guard<std::mutex> lock(stateMutex_);
            if (backend_ && !backend_->isRunning() && !shuttingDown_.load()) {
                std::string err;
                if (restartAudio(err)) {
                    audioError_.clear();
                    persistSettings();
                    notify();
                    logInfo("audio: interface appeared, stream started");
                    audioRetryLog = 0;
                } else {
                    audioError_ = err;
                    if (audioRetryLog++ % 15 == 0) {
                        logWarn("audio: waiting for interface (" + err + ")");
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// State reporting
// ---------------------------------------------------------------------------

bool Engine::persistSettings() {
    settings_.activeBankId = activeBankId_;
    settings_.activePresetId = activePresetId_;
    ControllerConfig config = controller_.config();
    config.enabled = settings_.controller.enabled;
    config.midiPort = midi_.isRunning() ? midi_.activePort() : settings_.controller.midiPort;
    settings_.controller = std::move(config);
    return storage_.saveSettings(settings_);
}

void Engine::notify() {
    std::lock_guard<std::mutex> lock(listenerMutex_);
    if (listener_) {
        listener_(fullState());
    }
}

void Engine::publishState() {
    notify();
}

void Engine::notifyPerformance() {
    std::lock_guard<std::mutex> lock(listenerMutex_);
    if (listener_) {
        listener_(performanceState());
    }
}

Json Engine::fullState() const {
    Json json = Json::object();
    json.set("type", "state");
    json.set("version", PIMFX_VERSION);

    Json bankArray = Json::array();
    for (const Bank& bank : banks_) {
        bankArray.push(bank.toJson());
    }
    json.set("banks", bankArray);
    json.set("activeBankId", activeBankId_);
    json.set("activePresetId", activePresetId_);

    json.set("audio", audioSettingsToJson(settings_.audio));
    json.set("ui", settings_.ui.toJson());
    json.set("system", settings_.system.toJson());
    json.set("controller", describeControllerRuntime());

    json.set("bypassAll", bypassAll_.load(std::memory_order_relaxed));
    json.set("snapshotMode", snapshotMode_.load(std::memory_order_relaxed));
    json.set("audioRunning", backend_ && backend_->isRunning());
    json.set("audioBackend", backend_ ? backend_->name() : std::string("none"));
    if (!audioError_.empty()) {
        json.set("audioError", audioError_);
    }
    if (!controllerError_.empty()) {
        json.set("controllerError", controllerError_);
    }
    json.set("lv2Available", catalog_.available());
    json.set("pluginCount", static_cast<int>(catalog_.plugins().size()));

    // Live chain contents, which can differ from the stored preset when a
    // plugin named by the preset is not installed.
    Json chainArray = Json::array();
    if (Chain* chain = activeChain_.load(std::memory_order_acquire)) {
        for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
            if (!slot->plugin) {
                continue;
            }
            Json slotJson = Json::object();
            slotJson.set("id", slot->id);
            slotJson.set("uri", slot->plugin->uri());
            slotJson.set("enabled", slot->enabled.load(std::memory_order_relaxed));
            if (const Preset* preset = activePreset()) {
                if (const EffectSlot* stored = preset->findSlot(slot->id)) {
                    slotJson.set("name", stored->name);
                }
            }
            slotJson.set("plugin", slot->plugin->info().toJson(true));
            slotJson.set("state", slot->plugin->saveState());
            chainArray.push(slotJson);
        }
    }
    json.set("chain", chainArray);

    Json positions = Json::object();
    for (const auto& entry : controller_.controlPositions()) {
        positions.set(entry.first, Json(entry.second));
    }
    json.set("controlPositions", positions);
    return json;
}

Json Engine::performanceState() const {
    Json json = Json::object();
    json.set("type", "performance");
    json.set("activeBankId", activeBankId_);
    json.set("activePresetId", activePresetId_);
    json.set("bypassAll", bypassAll_.load(std::memory_order_relaxed));
    json.set("snapshotMode", snapshotMode_.load(std::memory_order_relaxed));

    if (const Preset* preset = activePreset()) {
        json.set("tempo", preset->tempo);
        json.set("activeSnapshot", preset->activeSnapshot);
    }

    Json slotArray = Json::array();
    if (Chain* chain = activeChain_.load(std::memory_order_acquire)) {
        for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
            Json slotJson = Json::object();
            slotJson.set("id", slot->id);
            slotJson.set("enabled", slot->enabled.load(std::memory_order_relaxed));
            if (slot->plugin) {
                slotJson.set("state", slot->plugin->saveState());
            }
            slotArray.push(slotJson);
        }
    }
    json.set("slots", slotArray);

    Json positions = Json::object();
    for (const auto& entry : controller_.controlPositions()) {
        positions.set(entry.first, Json(entry.second));
    }
    json.set("controlPositions", positions);
    return json;
}

Json Engine::meterState() const {
    Json json = Json::object();
    json.set("type", "meters");
    json.set("xruns", static_cast<int64_t>(metrics_.xruns.load(std::memory_order_relaxed)));
    json.set("dspLoad", metrics_.dspLoad.load(std::memory_order_relaxed));
    json.set("dspLoadPeak", metrics_.dspLoadPeak.load(std::memory_order_relaxed));
    json.set("inputPeak", metrics_.inputPeak.load(std::memory_order_relaxed));
    json.set("outputPeak", metrics_.outputPeak.load(std::memory_order_relaxed));
    json.set("running", metrics_.running.load(std::memory_order_relaxed));

    const unsigned rate = sampleRate_.load(std::memory_order_acquire);
    const uint32_t frames = metrics_.roundTripFrames.load(std::memory_order_relaxed);
    json.set("roundTripFrames", static_cast<int>(frames));
    json.set("roundTripMs", rate > 0 ? (1000.0 * frames) / rate : 0.0);
    json.set("bufferMs", settings_.audio.bufferMs());

    const TunerReading reading = tuner();
    Json tunerJson = Json::object();
    tunerJson.set("enabled", tunerEnabled_.load(std::memory_order_relaxed));
    tunerJson.set("valid", reading.valid);
    tunerJson.set("frequency", reading.frequency);
    tunerJson.set("note", reading.noteName);
    tunerJson.set("cents", reading.cents);
    json.set("tuner", tunerJson);
    return json;
}

Json Engine::catalogState(bool includePorts) const {
    Json json = Json::object();
    json.set("type", "catalog");
    json.set("available", catalog_.available());

    Json pluginArray = Json::array();
    for (const PluginInfo& info : catalog_.plugins()) {
        pluginArray.push(info.toJson(includePorts));
    }
    json.set("plugins", pluginArray);

    Json categoryArray = Json::array();
    for (const std::string& category : catalog_.categories()) {
        categoryArray.push(Json(category));
    }
    json.set("categories", categoryArray);
    return json;
}

Json Engine::audioDevicesState() {
    Json json = Json::object();
    json.set("type", "audioDevices");
    Json deviceArray = Json::array();
    if (backend_) {
        for (const AudioDeviceInfo& device : backend_->enumerateDevices()) {
            deviceArray.push(audioDeviceToJson(device));
        }
    }
    json.set("devices", deviceArray);
    return json;
}

Json Engine::midiPortsState() const {
    Json json = Json::object();
    json.set("type", "midiPorts");
    Json portArray = Json::array();
    for (const MidiPortInfo& port : MidiInput::enumeratePorts()) {
        Json portJson = Json::object();
        portJson.set("id", port.id);
        portJson.set("name", port.name);
        portJson.set("input", port.input);
        portJson.set("output", port.output);
        portJson.set("looksLikeController", port.looksLikeController);
        portArray.push(portJson);
    }
    json.set("ports", portArray);
    json.set("activePort", midi_.activePort());
    json.set("connected", midi_.isRunning());
    return json;
}

Json Engine::libraryState() const {
    Json json = Json::object();
    json.set("type", "library");

    auto describe = [](const std::vector<Storage::LibraryEntry>& entries) {
        Json array = Json::array();
        for (const Storage::LibraryEntry& entry : entries) {
            Json item = Json::object();
            item.set("path", entry.path);
            item.set("name", entry.name);
            item.set("category", entry.category);
            item.set("bytes", static_cast<int64_t>(entry.bytes));
            item.set("source", entry.source);
            array.push(item);
        }
        return array;
    };

    json.set("models", describe(storage_.listModels()));
    json.set("impulseResponses", describe(storage_.listImpulseResponses()));
    return json;
}

Json Engine::diagnosticsState() const {
    Json json = Json::object();
    json.set("type", "diagnostics");
    json.set("tuning", rt::describeSystemTuning());
    json.set("cpuLatency", latencyGuard_ ? latencyGuard_->status() : std::string("not held"));
    json.set("audioBackend", backend_ ? backend_->name() : std::string("none"));
    if (backend_) {
        json.set("actualAudio", audioSettingsToJson(backend_->actualSettings()));
    }
    json.set("dataRoot", storage_.paths().dataRoot);
    json.set("webRoot", storage_.paths().webRoot);
    return json;
}

Json Engine::describeControllerRuntime() const {
    Json json = controller_.config().toJson();
    json.set("connected", midi_.isRunning());
    json.set("activePort", midi_.activePort());
    json.set("learning", controller_.learning());
    json.set("learningControlId", controller_.learningControlId());
    return json;
}

} // namespace pimfx
