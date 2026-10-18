#include "Engine.h"
#include "core/Log.h"
#include "core/BankPreloadTargets.h"
#include "model/Routing.h"

#include <algorithm>
#include <filesystem>
#include <stdexcept>

#ifdef __linux__
#include <pthread.h>
#include <sched.h>
#endif

namespace pimfx {
namespace {

// Plugin allocations are opaque. This admission estimate is deliberately
// conservative; measured RSS/available-RAM growth is also checked after loading.
int64_t estimatePresetMemory(const Preset& preset, Storage& storage) {
    int64_t bytes = 16 * PreloadMemory::MiB;
    for (const auto& slot : preset.chain) {
        if (slot.kind != "effect") continue;
        bytes += 32 * PreloadMemory::MiB;
        for (const auto& property : slot.state["properties"].members()) {
            const std::string path = property.second.asString();
            if (path.empty()) continue;
            std::string error;
            const std::string resolved = storage.resolveLibraryFile(path, error);
            std::error_code ec;
            const auto size = std::filesystem::file_size(resolved, ec);
            if (!ec) {
                // Saturate unreasonable sizes instead of overflowing the budget.
                const auto bounded = std::min<uintmax_t>(size, 1024ULL * 1024 * 1024);
                bytes += static_cast<int64_t>(bounded) * 8;
            }
        }
    }
    return bytes;
}

} // namespace

Preset Engine::recalledPresetUnlocked(const Preset& preset) const {
    const auto draft = sessionPresetDrafts_.find(preset.id);
    Preset result = draft == sessionPresetDrafts_.end() ? preset : draft->second;
    result.snapshots = preset.snapshots;
    result.rememberedSnapshotSlot = preset.rememberedSnapshotSlot;
    result.rememberedSnapshotEnabled = preset.rememberedSnapshotEnabled;
    result.activeSnapshot = -1;
    if (preset.rememberedSnapshotEnabled && preset.rememberedSnapshotSlot >= 0) {
        if (const Snapshot* snapshot = findSnapshotBySlot(preset, preset.rememberedSnapshotSlot)) {
            for (auto& slot : result.chain) {
                if (slot.kind != "effect") continue;
                if (!snapshot->slots.has(slot.id)) continue;
                slot.state = snapshot->slots[slot.id];
                slot.enabled = slot.state["enabled"].asBool(true);
            }
            result.routing = routingWithMix(result.routing, snapshot->routingMix);
        }
    }
    return result;
}

Engine::ChainBuildContext Engine::preloadContextUnlocked(const Preset& preset) const {
    ChainBuildContext context;
    context.audio = settings_.audio;
    context.rate = sampleRate_.load(std::memory_order_acquire);
    context.frames = maxFrames_.load(std::memory_order_acquire);
    context.tempoEnabled = transportEnabled_.load(std::memory_order_acquire);
    context.bpm = transport_.playing() ? transport_.bpm() : preset.tempo;
    return context;
}

std::string Engine::preloadKey(const Preset& preset, const ChainBuildContext& context) const {
    Json state = preset.toJson();
    state.remove("activeSnapshot");
    return state.dump() + audioSettingsToJson(context.audio).dump()
        + ":" + std::to_string(context.rate) + ":" + std::to_string(context.frames)
        + ":" + std::to_string(context.tempoEnabled) + ":" + std::to_string(context.bpm)
        + ":" + std::to_string(bankPreloadAssetRevision_.load(std::memory_order_acquire));
}

void Engine::invalidateBankPreload() {
    bankPreloadAssetRevision_.fetch_add(1, std::memory_order_acq_rel);
    std::lock_guard<std::mutex> lock(bankPreloadMutex_);
    bankPreloadRequest_ = {};
    bankPreloadReady_ = false;
    bankPreloadStatus_ = "Waiting for bank";
    bankPreloadGeneration_.fetch_add(1, std::memory_order_acq_rel);
    // Destruction of unused plugins belongs to the worker, outside control locks.
}

void Engine::refreshBankPreload() {
    std::lock_guard<std::recursive_mutex> stateLock(stateMutex_);
    BankPreloadRequest request;
    std::string reason = "Off";
    const Bank* bank = activeBank();
    if (settings_.system.preloadBanks && bank && !bank->presets.empty()
        && metrics_.running.load(std::memory_order_acquire)) {
        request.bankId = bank->id;
        request.catalogWorld = catalog_.sharedImpl();
        request.key = bank->id;
        Json sessions = Json::object();
        for (const auto& session : sessionPresets_)
            sessions.set(session.first, Json::object({{"bankId", session.second.bankId}, {"presetId", session.second.presetId}}));
        const size_t fallback = static_cast<size_t>(std::min(settings_.ui.virtualSwitchCount,
            std::max(1, settings_.controller.gridRows) * std::max(1, settings_.controller.gridColumns)));
        const auto targets = bankPreloadTargets(*bank, controller_.config(), sessions, fallback, effectiveActivePreset());
        for (const auto& preset : bank->presets) {
            if (std::find(targets.begin(), targets.end(), preset.id) == targets.end()) continue;
            if (preset.id == activePresetId_) request.activePresetId = activePresetId_;
            request.presets.push_back(recalledPresetUnlocked(preset));
            request.contexts.push_back(preloadContextUnlocked(request.presets.back()));
            request.keys.push_back(preloadKey(request.presets.back(), request.contexts.back()));
            request.key += "\n" + request.keys.back();
        }
        reason = targets.empty() ? "No presets assigned to switches" : "Preparing bank";
    } else if (settings_.system.preloadBanks) reason = "Waiting for audio or a bank";
    const Json loop = looper_ ? looper_->state(false) : Json();
    bankPreloadAllowed_.store(!backupPreparing() && !(recorder_ && recorder_->recording())
        && !loop["recording"].asBool() && !loop["overdubbing"].asBool()
        && loop["status"].asString() != "recording" && loop["status"].asString() != "overdubbing",
        std::memory_order_release);
    std::lock_guard<std::mutex> lock(bankPreloadMutex_);
    if (request.key != bankPreloadRequest_.key || request.catalogWorld != bankPreloadRequest_.catalogWorld) {
        bankPreloadRequest_ = std::move(request);
        bankPreloadReady_ = false;
        bankPreloadStatus_ = reason;
        bankPreloadGeneration_.fetch_add(1, std::memory_order_acq_rel);
    } else {
        bankPreloadRequest_.activePresetId = request.activePresetId;
        if (request.key.empty()) bankPreloadStatus_ = reason;
    }
}

std::unique_ptr<Engine::Chain> Engine::takePreloadedChain(const Preset& preset) {
    const std::string key = preloadKey(preset, preloadContextUnlocked(preset));
    std::lock_guard<std::mutex> lock(bankPreloadMutex_);
    bankPreloadLastSelection_ = "Normal load";
    if (!settings_.system.preloadBanks || !bankPreloadReady_
        || bankPreloadRequest_.bankId != activeBankId_
        || bankPreloadRequest_.catalogWorld != catalog_.sharedImpl()) return nullptr;
    const auto entry = bankPreloadedChains_.find(preset.id);
    if (entry == bankPreloadedChains_.end() || entry->second.key != key) return nullptr;
    auto chain = std::move(entry->second.chain);
    bankPreloadBytes_ -= entry->second.bytes;
    bankPreloadedChains_.erase(entry);
    ++bankPreloadHits_;
    bankPreloadLastSelection_ = "Preloaded";
    bankPreloadStatus_ = "Refilling bank";
    missingPluginFiles_.clear();
    for (const auto& slot : chain->slots) slot->plugin->setPreloadedIdle(false);
    return chain;
}

Json Engine::bankPreloadState() const {
    std::lock_guard<std::mutex> lock(bankPreloadMutex_);
    ActiveChainReadGuard chainGuard(*this);
    const Chain* current = chainGuard.get();
    const bool activePrepared = current && !chainPublicationExpected_.load(std::memory_order_acquire)
        && !bankPreloadRequest_.activePresetId.empty() && current->presetId == bankPreloadRequest_.activePresetId;
    int prepared = activePrepared ? 1 : 0;
    for (size_t i = 0; i < bankPreloadRequest_.presets.size(); ++i) {
        const auto& preset = bankPreloadRequest_.presets[i];
        if (preset.id == bankPreloadRequest_.activePresetId) continue;
        const auto entry = bankPreloadedChains_.find(preset.id);
        if (entry != bankPreloadedChains_.end() && entry->second.key == bankPreloadRequest_.keys[i]) ++prepared;
    }
    return Json::object({{"status", bankPreloadStatus_}, {"bankId", bankPreloadRequest_.bankId},
        {"ready", bankPreloadReady_}, {"prepared", prepared},
        {"total", static_cast<int>(bankPreloadRequest_.presets.size())},
        {"estimatedBytes", bankPreloadBytes_}, {"budgetBytes", bankPreloadBudget_},
        {"baselineAvailableBytes", bankPreloadBaseline_.available},
        {"reserveBytes", bankPreloadBaseline_.valid() ? bankPreloadBaseline_.reserve() : 0},
        {"hits", bankPreloadHits_}, {"lastSelection", bankPreloadLastSelection_}});
}

void Engine::bankPreloadThread() {
#ifdef __linux__
    // Never inherit realtime priority from the thread that started the engine.
    sched_param normal{};
    if (pthread_setschedparam(pthread_self(), SCHED_OTHER, &normal) != 0) {
        std::lock_guard<std::mutex> lock(bankPreloadMutex_);
        bankPreloadStatus_ = "Preload worker scheduling unavailable";
        return;
    }
#endif
    rt::disableDenormals();
    uint64_t generation = ~uint64_t{0}, failedGeneration = ~uint64_t{0};
    uint64_t previousXruns = metrics_.xruns.load(std::memory_order_relaxed);
    auto resumeAt = std::chrono::steady_clock::now() + std::chrono::seconds(3);
    BankPreloadRequest request;
    while (!shuttingDown_.load(std::memory_order_acquire)) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        std::unordered_map<std::string, PreloadEntry> garbage;
        {
            std::lock_guard<std::mutex> lock(bankPreloadMutex_);
            const uint64_t current = bankPreloadGeneration_.load(std::memory_order_acquire);
            if (current != generation) {
                generation = current;
                const bool sameBank = !request.bankId.empty() && request.bankId == bankPreloadRequest_.bankId
                    && request.catalogWorld == bankPreloadRequest_.catalogWorld;
                request = bankPreloadRequest_;
                bankPreloadBytes_ = 0;
                if (!sameBank) garbage.swap(bankPreloadedChains_);
                else {
                    // A reassignment/edit should release obsolete targets, not
                    // rebuild every compatible instance or briefly hold two banks.
                    for (auto it = bankPreloadedChains_.begin(); it != bankPreloadedChains_.end();) {
                        const auto target = std::find_if(request.presets.begin(), request.presets.end(),
                            [&](const Preset& preset) { return preset.id == it->first; });
                        const bool keep = target != request.presets.end()
                            && target->id != request.activePresetId
                            && it->second.key == request.keys[static_cast<size_t>(target - request.presets.begin())];
                        if (keep) { bankPreloadBytes_ += it->second.bytes; ++it; }
                        else { garbage.emplace(it->first, std::move(it->second)); it = bankPreloadedChains_.erase(it); }
                    }
                }
                bankPreloadReady_ = false;
                resumeAt = std::chrono::steady_clock::now() + std::chrono::seconds(2);
            }
        }
        garbage.clear();
        if (request.key.empty() || request.presets.empty() || failedGeneration == generation) continue;
        const auto setStatus = [&](const std::string& status) {
            std::lock_guard<std::mutex> lock(bankPreloadMutex_);
            if (generation == bankPreloadGeneration_.load(std::memory_order_acquire)) bankPreloadStatus_ = status;
        };
        const auto failBank = [&](const std::string& status) {
            std::unordered_map<std::string, PreloadEntry> discarded;
            {
                std::lock_guard<std::mutex> lock(bankPreloadMutex_);
                if (generation != bankPreloadGeneration_.load(std::memory_order_acquire)) return;
                discarded.swap(bankPreloadedChains_);
                bankPreloadBytes_ = 0;
                bankPreloadReady_ = false;
                bankPreloadStatus_ = status;
            }
            failedGeneration = generation;
            logInfo("bank preload: " + status + "; using normal preset loading");
        };
        const uint64_t xruns = metrics_.xruns.load(std::memory_order_relaxed);
        if (xruns > previousXruns) {
            previousXruns = xruns;
            resumeAt = std::chrono::steady_clock::now() + std::chrono::seconds(10);
        } else if (xruns < previousXruns) previousXruns = xruns;
        const PreloadMemory memory = PreloadMemory::read();
        if (!memory.valid() || memory.available < memory.reserve() + 64 * PreloadMemory::MiB) {
            failBank("Not enough free RAM");
            continue;
        }
        const auto idleEnough = [&] {
            return !shuttingDown_.load(std::memory_order_acquire)
                && generation == bankPreloadGeneration_.load(std::memory_order_acquire)
                && !bankPreloadForeground_.load(std::memory_order_acquire)
                && bankPreloadAllowed_.load(std::memory_order_acquire)
                && metrics_.running.load(std::memory_order_acquire)
                && !chainPublicationExpected_.load(std::memory_order_acquire)
                && !metrics_.chainPreparationActive.load(std::memory_order_acquire)
                && !transitionRequested_.load(std::memory_order_acquire)
                && metrics_.activeWorkerTransitions.load(std::memory_order_relaxed) == 0
                && metrics_.dspLoad.load(std::memory_order_relaxed) < 0.65f
                && metrics_.xruns.load(std::memory_order_relaxed) <= previousXruns;
        };
        size_t index = request.presets.size();
        std::vector<size_t> missingIndices;
        int64_t used = 0, budget = 0;
        {
            std::lock_guard<std::mutex> lock(bankPreloadMutex_);
            if (generation != bankPreloadGeneration_.load(std::memory_order_acquire)) continue;
            used = bankPreloadBytes_;
            budget = bankPreloadBudget_;
            for (size_t i = 0; i < request.presets.size(); ++i) {
                if (request.presets[i].id == bankPreloadRequest_.activePresetId) continue;
                if (!bankPreloadedChains_.count(request.presets[i].id)) missingIndices.push_back(i);
            }
            if (!missingIndices.empty()) index = missingIndices.front();
            if (index == request.presets.size()) {
                bankPreloadReady_ = !chainPublicationExpected_.load(std::memory_order_acquire);
                bankPreloadStatus_ = bankPreloadReady_ ? "Bank ready" : "Waiting for selected preset";
            }
        }
        if (index == request.presets.size()) continue;
        if (std::chrono::steady_clock::now() < resumeAt || !idleEnough()) {
            setStatus("Preloading paused - audio takes priority");
            continue;
        }
        try {
            // All-or-nothing admission before preparing the first preset. This
            // is an estimate; per-slot and post-load checks enforce live headroom.
            int64_t remainingEstimate = 0;
            for (size_t i : missingIndices)
                remainingEstimate += estimatePresetMemory(request.presets[i], storage_);
            if (!memory.canLoad(used, remainingEstimate, budget)) {
                failBank("Bank exceeds RAM budget");
                continue;
            }
            const int64_t estimate = estimatePresetMemory(request.presets[index], storage_);
            setStatus("Preparing bank");
            ChainBuildContext context = request.contexts[index];
            bool lowMemory = false;
            context.canContinue = [&] {
                const auto current = PreloadMemory::read();
                lowMemory = !current.valid() || current.available < current.reserve() + 64 * PreloadMemory::MiB
                    || used + std::max<int64_t>(0, current.resident - memory.resident) > budget;
                return !lowMemory && idleEnough();
            };
            std::string error;
            auto chain = buildChain(request.presets[index], error, nullptr, "", &context);
            if (chain && error.empty()) {
                const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(30);
                // Run every unpublished processor once, including plugins with
                // lazy first-run allocation, then drain model/IR worker loading.
                bool first = true;
                const auto pending = [&] {
                    return std::any_of(chain->slots.begin(), chain->slots.end(),
                        [](const auto& slot) { return slot->plugin->preloadPending(); });
                };
                while (first || pending()) {
                    if (!context.canContinue()) { chain.reset(); break; }
                    if (std::chrono::steady_clock::now() >= deadline) {
                        error = "Plugin preparation timed out"; chain.reset(); break;
                    }
                    for (const auto& slot : chain->slots) {
                        if (!slot->plugin || (!first && !slot->plugin->preloadPending())) continue;
                        for (auto& buffer : chain->bufferA) std::fill(buffer.begin(), buffer.end(), 0.0f);
                        slot->plugin->process(reinterpret_cast<const float* const*>(chain->pointersA.data()),
                            std::min(slot->plugin->audioInputs(), chain->channels), chain->pointersB.data(),
                            std::min(slot->plugin->audioOutputs(), chain->channels), context.frames, nullptr);
                    }
                    first = false;
                    std::this_thread::sleep_for(std::chrono::milliseconds(10));
                }
            }
            if (generation != bankPreloadGeneration_.load(std::memory_order_acquire)) continue;
            if (lowMemory) { chain.reset(); failBank("Not enough free RAM"); continue; }
            if (metrics_.xruns.load(std::memory_order_relaxed) > previousXruns) {
                chain.reset(); failBank("Stopped after an audio dropout"); continue;
            }
            if (!idleEnough()) { setStatus("Preloading paused - audio takes priority"); continue; }
            if (!chain || !error.empty()) {
                chain.reset(); failBank("A preset could not be preloaded"); continue;
            }
            const auto after = PreloadMemory::read();
            const int64_t cost = std::max({estimate, after.resident - memory.resident, memory.available - after.available});
            if (!after.valid() || cost > budget - used
                || after.available < after.reserve() + 64 * PreloadMemory::MiB) {
                chain.reset(); failBank("Bank exceeds RAM budget"); continue;
            }
            for (const auto& slot : chain->slots) slot->plugin->setPreloadedIdle(true);
            std::lock_guard<std::mutex> lock(bankPreloadMutex_);
            if (generation != bankPreloadGeneration_.load(std::memory_order_acquire)) continue;
            if (request.presets[index].id == bankPreloadRequest_.activePresetId) continue;
            chain->rebindOnSwap = true;
            bankPreloadedChains_.emplace(request.presets[index].id,
                PreloadEntry{request.keys[index], std::move(chain), cost});
            bankPreloadBytes_ += cost;
        } catch (const std::exception& error) {
            logWarn(std::string("bank preload: ") + error.what());
            failBank("Bank preparation failed");
        }
    }
}

} // namespace pimfx
