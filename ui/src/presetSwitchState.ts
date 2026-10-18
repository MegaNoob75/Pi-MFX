import { arr, bool, isObj, num, str, type JsonObject } from "./json";

/** Reuse only a matching full-library baseline; never guess at missing presets. */
export function mergePresetSwitch(current: JsonObject, update: JsonObject): JsonObject | undefined {
    if (num(update.presetSwitchProtocol) !== 1 || !str(current.stateEpoch)
        || str(update.stateEpoch) !== str(current.stateEpoch)
        || num(update.bankLibraryRevision, -1) !== num(current.bankLibraryRevision, -2)
        || !Array.isArray(current.banks) || bool(update.chainPreparing)
        || !Array.isArray(update.chain) || !Array.isArray(update.chainLayout)
        || str(update.activeChainPresetId) !== str(update.activePresetId)) return;
    const selected = update.selectedPreset;
    if (!isObj(selected) || !str(selected.id) || str(selected.id) !== str(update.activePresetId)
        || !Array.isArray(selected.chain) || !Array.isArray(selected.snapshots)
        || !Array.isArray(selected.parameterBindings)) return;
    const banks = arr(current.banks);
    const selections = arr(update.bankSelections);
    if (banks.length !== selections.length || banks.some(bank => !isObj(bank))) return;
    const lastPresets = new Map<string, string>();
    for (const selection of selections) {
        if (!isObj(selection) || !str(selection.id) || lastPresets.has(str(selection.id))) return;
        lastPresets.set(str(selection.id), str(selection.lastPresetId));
    }
    const targetBankId = str(update.activeBankId);
    let found = false;
    for (const bank of banks) {
        if (!isObj(bank) || !lastPresets.has(str(bank.id))) return;
        const presets = arr(bank.presets);
        if (str(bank.id) === targetBankId)
            found = presets.some(preset => isObj(preset) && str(preset.id) === str(selected.id));
    }
    if (!found) return;
    const next: JsonObject = {
        ...update,
        type: "state",
        banks: banks.map(bankValue => {
            const bank = bankValue as JsonObject;
            return {
                ...bank,
                lastPresetId: lastPresets.get(str(bank.id)) ?? "",
                presets: str(bank.id) === targetBankId
                    ? arr(bank.presets).map(preset => isObj(preset) && str(preset.id) === str(selected.id) ? selected : preset)
                    : bank.presets
            };
        })
    };
    delete next.selectedPreset;
    delete next.bankSelections;
    return next;
}
