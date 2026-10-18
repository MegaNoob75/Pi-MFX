#pragma once

#include "model/Model.h"
#include <algorithm>
#include <unordered_set>
#include <vector>

namespace pimfx {

// Actual switch targets, with session > binding > saved-map priority as in
// recall. Counts are dynamic; stale and duplicate targets are removed.
inline std::vector<std::string> bankPreloadTargets(const Bank& bank,
        const ControllerConfig& config, const Json& sessions, size_t fallbackSwitches,
        const Preset* active = nullptr) {
    std::unordered_set<std::string> selected;
    const auto add = [&](const std::string& bankId, const std::string& presetId) {
        if (bankId == bank.id && !presetId.empty()) selected.insert(presetId);
    };
    for (const auto& control : config.controls) {
        if (control.kind != ControlKind::Momentary && control.kind != ControlKind::Latching
            && control.kind != ControlKind::EncoderPush) continue;
        std::string action = control.binding.action;
        std::string bankId = control.binding.bankId.empty() ? bank.id : control.binding.bankId;
        std::string presetId = control.binding.presetId;
        if (const auto* binding = active ? active->findParameterBinding(control.id) : nullptr) {
            action = binding->action;
            bankId = binding->bankId.empty() ? bank.id : binding->bankId;
            presetId = binding->presetId;
        }
        if (action != "selectPreset" && action != "none" && !action.empty()
            && control.binding.holdAction != "selectPreset"
            && control.binding.doubleAction != "selectPreset") continue;
        const auto& session = sessions[control.id];
        if (!session["presetId"].asString().empty()) {
            if (!session["bankId"].asString().empty()) bankId = session["bankId"].asString();
            presetId = session["presetId"].asString();
        }
        if (presetId.empty()) presetId = config.presetAssignments[bankId][control.id].asString();
        add(bankId, presetId);
    }
    if (config.controls.empty()) {
        for (size_t i = 0; i < std::min(fallbackSwitches, bank.presets.size()); ++i)
            add(bank.id, bank.presets[i].id);
    }
    std::vector<std::string> result;
    for (const auto& preset : bank.presets)
        if (selected.count(preset.id)) result.push_back(preset.id);
    return result;
}

} // namespace pimfx
