import { arr, bool, num, obj, objects, str, type JsonObject } from "./json";

export const VIRTUAL_CONTROL_TYPES = ["momentary", "latching", "pot", "encoder", "slider"] as const;

export function virtualControlPages(config: JsonObject): JsonObject[] {
    const pages = objects(config.pages);
    return pages.length > 0 ? pages : [{ id: "page-1", name: "Page 1" }];
}

export function virtualControlPageId(control: JsonObject, pages: JsonObject[]): string {
    const requested = str(control.pageId);
    return pages.some((page) => str(page.id) === requested)
        ? requested : str(pages[0]?.id, "page-1");
}

export const VIRTUAL_ACTION_LABELS: Record<string, string> = {
    none: "Unbound",
    setParameter: "LV2 parameter",
    toggleEffect: "Effect bypass",
    selectPreset: "Select preset",
    selectSnapshot: "Select snapshot",
    reloadPreset: "Reload preset",
    presetUp: "Preset up",
    presetDown: "Preset down",
    bankUp: "Bank up",
    bankDown: "Bank down",
    snapshotMode: "Snapshot mode",
    bypassAll: "Chain bypass",
    tapTempo: "Tap tempo",
    tuner: "Tuner",
    backingPlayPause: "Backing play / pause",
    backingStop: "Backing stop",
    backingPrevious: "Backing previous",
    backingNext: "Backing next",
    backingView: "Open backing tracks",
    looperRecord: "Looper record",
    looperToggle: "Looper record / play / overdub",
    looperPlay: "Looper play",
    looperPlayStop: "Looper play / stop",
    looperOverdub: "Looper overdub",
    looperStop: "Looper stop",
    looperRestart: "Looper restart",
    looperMute: "Looper mute",
    looperUndo: "Looper undo",
    looperRedo: "Looper redo",
    looperView: "Open looper",
    recorderToggle: "Recorder record / stop",
    recorderStop: "Recorder stop",
    recorderView: "Open recorder",
    drumToggle: "Drums start / stop",
    drumFill: "Drum fill",
    drumVariationNext: "Next drum variation",
    drumVariationPrevious: "Previous drum variation",
    drumPatternNext: "Next drum pattern",
    drumPatternPrevious: "Previous drum pattern",
    drumView: "Open drum machine"
};

export const VIRTUAL_DISCRETE_ACTIONS = Object.keys(VIRTUAL_ACTION_LABELS)
    .filter((action) => !["none", "setParameter", "toggleEffect"].includes(action));

export function virtualBindingFor(preset: JsonObject | undefined, controlId: string): JsonObject | undefined {
    return objects(obj(preset).parameterBindings).find((item) => str(item.controlId) === controlId);
}

export function virtualControlMinSize(kind: string, orientation = "vertical") {
    if (kind === "slider") {
        return orientation === "horizontal"
            ? { width: 0.22, height: 0.10 }
            : { width: 0.10, height: 0.24 };
    }
    if (kind === "pot" || kind === "encoder") return { width: 0.11, height: 0.18 };
    return { width: 0.12, height: 0.16 };
}

export function virtualTargetCompatible(kind: string, action: string, port?: JsonObject): boolean {
    if (action === "none") return true;
    if (action === "toggleEffect") return kind === "momentary" || kind === "latching" || kind === "encoder";
    if (action === "setParameter") {
        if (!port || !bool(port.input, true) || str(port.kind) !== "control" || bool(port.notOnGui)) return false;
        if (kind === "momentary") return bool(port.trigger);
        if (kind === "latching") return bool(port.toggled);
        if (kind === "pot" || kind === "slider" || kind === "expression") return !bool(port.trigger) && !bool(port.toggled);
        return kind === "encoder" && !bool(port.trigger);
    }
    if (kind === "pot" || kind === "slider") return false;
    return kind !== "encoder" || [
        "presetUp", "presetDown", "bankUp", "bankDown", "selectSnapshot",
        "backingPrevious", "backingNext", "drumVariationNext", "drumVariationPrevious",
        "drumPatternNext", "drumPatternPrevious"
    ].includes(action);
}

function formatValue(value: number, port: JsonObject): string {
    const point = arr(port.scalePoints).map(obj).find((item) => Math.abs(num(item.value) - value) < 0.0001);
    if (point && str(point.label)) {
        const label = str(point.label).trim();
        if (!bool(port.toggled) || !Number.isFinite(Number(label))) return label;
    }
    if (bool(port.toggled)) return "";
    const digits = bool(port.integer) ? 0 : 2;
    const render = str(port.unitRender);
    const placeholder = /%([+.\-0-9]*)(?:\.([0-9]+))?f/;
    const match = render.match(placeholder);
    if (match) {
        const precision = match[2] ? Number(match[2]) : digits;
        return render.replace(placeholder, value.toFixed(precision)).replaceAll("%%", "%");
    }
    const unit = str(port.unit);
    return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

export type VirtualControlDisplay = {
    assigned: boolean;
    missing: boolean;
    label: string;
    context: string;
    valueText: string;
    range: number;
    active: boolean;
    optionCount: number;
    optionIndex: number;
};

export function resolveVirtualControlDisplay(
    control: JsonObject,
    binding: JsonObject | undefined,
    chain: JsonObject[],
    state: JsonObject
): VirtualControlDisplay {
    const custom = str(control.label);
    const automatic = bool(control.automaticLabel, !custom);
    const fallback = custom || "UNASSIGNED";
    if (!binding || !str(binding.action) || str(binding.action) === "none") {
        return { assigned: false, missing: false, label: fallback, context: "UNASSIGNED", valueText: "", range: 0, active: false, optionCount: 0, optionIndex: -1 };
    }
    const action = str(binding.action);
    if (action === "setParameter") {
        const slot = chain.find((item) => str(item.id) === str(binding.slotId));
        const port = objects(obj(obj(slot).plugin).ports).find((item) => str(item.symbol) === str(binding.portSymbol));
        if (!slot || !port) {
            return { assigned: false, missing: true, label: fallback, context: "MISSING TARGET", valueText: "", range: 0, active: false, optionCount: 0, optionIndex: -1 };
        }
        const value = num(obj(obj(slot.state).controls)[str(binding.portSymbol)], num(port.default));
        const min = num(binding.min, num(port.min));
        const max = num(binding.max, num(port.max, 1));
        let range = max === min ? 0 : (value - min) / (max - min);
        if (bool(port.logarithmic) && min !== 0 && max !== 0 && value !== 0 && (min > 0) === (max > 0)) {
            range = Math.log(value / min) / Math.log(max / min);
        }
        range = Math.min(1, Math.max(0, bool(binding.inverted) ? 1 - range : range));
        const parameter = str(port.name, str(binding.portSymbol));
        const effect = str(slot.name) || str(obj(slot.plugin).name, "Effect");
        const options = arr(port.scalePoints).map(obj).sort((left, right) => num(left.value) - num(right.value));
        const optionIndex = options.length > 0
            ? options.reduce((best, item, index) => Math.abs(num(item.value) - value) < Math.abs(num(options[best].value) - value) ? index : best, 0)
            : -1;
        return {
            assigned: true,
            missing: false,
            label: automatic ? parameter : fallback,
            context: effect,
            valueText: formatValue(value, port),
            range,
            active: bool(port.toggled) && value > (num(port.min) + num(port.max, 1)) / 2,
            optionCount: options.length,
            optionIndex
        };
    }
    if (action === "toggleEffect") {
        const slot = chain.find((item) => str(item.id) === str(binding.slotId));
        if (!slot) return { assigned: false, missing: true, label: fallback, context: "MISSING EFFECT", valueText: "", range: 0, active: false, optionCount: 0, optionIndex: -1 };
        const name = str(slot.name) || str(obj(slot.plugin).name, "Effect");
        const enabled = bool(slot.enabled, true);
        return { assigned: true, missing: false, label: automatic ? name : fallback, context: "EFFECT", valueText: enabled ? "ON" : "BYPASSED", range: enabled ? 1 : 0, active: enabled, optionCount: 0, optionIndex: -1 };
    }
    const label = VIRTUAL_ACTION_LABELS[action] ?? action;
    const actionActive = (action === "bypassAll" && bool(state.bypassAll))
        || (action === "snapshotMode" && bool(state.snapshotMode));
    return { assigned: true, missing: false, label: automatic ? label : fallback, context: "PI-MFX ACTION", valueText: actionActive ? "ON" : "", range: actionActive ? 1 : 0, active: actionActive, optionCount: 0, optionIndex: -1 };
}
