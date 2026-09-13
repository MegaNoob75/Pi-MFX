import { str, objects, type JsonObject } from "./json";

export type PerformanceEncoderMode = "browse" | "live" | "session";

export interface PerformanceCatalogEntry {
    bankId: string;
    presetId: string;
    bankName: string;
    presetName: string;
}

export function parsePerformanceEncoderMode(value: string): PerformanceEncoderMode {
    if (value === "live" || value === "session") {
        return value;
    }
    return "browse";
}

export function wrapIndex(index: number, length: number): number {
    if (length <= 0) {
        return 0;
    }
    return ((index % length) + length) % length;
}

export function catalogIndexOf(
    catalog: PerformanceCatalogEntry[],
    bankId: string,
    presetId: string
): number {
    const index = catalog.findIndex((entry) => entry.bankId === bankId && entry.presetId === presetId);
    return index >= 0 ? index : 0;
}

/** Follow bank and preset list order, independently of switch assignments. */
export function buildPerformanceCatalog(banks: JsonObject[]): PerformanceCatalogEntry[] {
    const catalog: PerformanceCatalogEntry[] = [];
    for (const bank of banks) {
        const bankId = str(bank.id);
        const bankName = str(bank.name, "Bank");
        const seen = new Set<string>();
        for (const preset of objects(bank.presets)) {
            const presetId = str(preset.id);
            if (!presetId || seen.has(presetId)) {
                continue;
            }
            seen.add(presetId);
            catalog.push({
                bankId,
                presetId,
                bankName,
                presetName: str(preset.name, "Preset")
            });
        }
    }
    return catalog;
}

/** Navigation feedback follows the target, never the encoder's accumulated turns. */
export function performanceEncoderFeedback(
    catalog: PerformanceCatalogEntry[],
    browseIndex: number,
    mode: PerformanceEncoderMode,
    activeBankId: string,
    activePresetId: string
): { range: number; target: string; position: string } {
    const status = mode === "live" ? "LIVE" : mode === "session" ? "SESSION" : "BROWSE";
    const index = mode === "live"
        ? catalog.findIndex((entry) => entry.bankId === activeBankId && entry.presetId === activePresetId)
        : wrapIndex(browseIndex, catalog.length);
    const entry = catalog[index];
    if (!entry) {
        return { range: 0, target: catalog.length === 0 ? "NO PRESETS" : "NO ACTIVE PRESET", position: status };
    }
    return {
        range: catalog.length > 1 ? index / (catalog.length - 1) : 0,
        target: `${entry.bankName} · ${entry.presetName}`,
        position: status
    };
}
