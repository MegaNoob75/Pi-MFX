import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { findBank, findPreset, type EngineSnapshot } from "../api";
import { bool, num, obj, objects, str, type JsonObject } from "../json";
import { clampRect, fitRectInEmptySpace, type LayoutRect } from "../layout";
import {
    VIRTUAL_ACTION_LABELS,
    VIRTUAL_CONTROL_TYPES,
    VIRTUAL_DISCRETE_ACTIONS,
    resolveVirtualControlDisplay,
    virtualBindingFor,
    virtualControlMinSize,
    virtualTargetCompatible
} from "../virtualControls";
import { ConfirmDialog } from "./ConfirmDialog";
import { LibraryJsonPicker } from "./LibraryManager";
import { PerformanceControl } from "./PerformanceControl";

type DragState = {
    id: string;
    pointerId: number;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    rect: LayoutRect;
};

const DEFAULT_RECTS: Record<string, LayoutRect> = {
    momentary: { x: 0.08, y: 0.15, width: 0.16, height: 0.22 },
    latching: { x: 0.08, y: 0.15, width: 0.16, height: 0.22 },
    pot: { x: 0.08, y: 0.12, width: 0.18, height: 0.30 },
    encoder: { x: 0.08, y: 0.12, width: 0.18, height: 0.30 },
    slider: { x: 0.08, y: 0.10, width: 0.14, height: 0.38 }
};

function layoutNameFromPath(path: string, fallback = "default") {
    const name = path.split(/[\\/]/).pop()?.replace(/\.json$/i, "").trim();
    return name || fallback;
}

function nextLabel(kind: string, controls: JsonObject[]): string {
    const prefix = kind === "momentary" ? "BUTTON" : kind === "latching" ? "TOGGLE" : kind.toUpperCase();
    let index = 1;
    const labels = new Set(controls.map((control) => str(control.label).toUpperCase()));
    while (labels.has(`${prefix} ${index}`)) index += 1;
    return `${prefix} ${index}`;
}

export function VirtualControlsLayoutEditorView({
    engine,
    run,
    onDirtyChange
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    onDirtyChange?: (dirty: boolean) => void;
}) {
    const saved = obj(engine.state.virtualControls);
    const [controls, setControls] = useState<JsonObject[]>(() => objects(saved.controls));
    const [layoutName, setLayoutName] = useState(() => str(saved.layoutName, "default"));
    const [selectedId, setSelectedId] = useState(() => str(objects(saved.controls)[0]?.id));
    const [dirty, setDirty] = useState(false);
    const [picker, setPicker] = useState<"load" | "save" | null>(null);
    const [deleteId, setDeleteId] = useState("");
    const [message, setMessage] = useState("");
    const stageRef = useRef<HTMLDivElement | null>(null);
    const drag = useRef<DragState | null>(null);
    const preset = findPreset(engine.state);
    const bank = findBank(engine.state);
    const presetChoices = objects(engine.state.banks).flatMap((bankItem) =>
        objects(bankItem.presets).map((presetItem) => ({
            bankId: str(bankItem.id), bankName: str(bankItem.name),
            presetId: str(presetItem.id), presetName: str(presetItem.name), preset: presetItem
        }))
    );
    const chain = objects(engine.state.chain);
    const selected = controls.find((control) => str(control.id) === selectedId);
    const kind = str(obj(selected).kind, "pot");
    const binding = virtualBindingFor(preset, selectedId);

    const markDirty = () => {
        setDirty(true);
        onDirtyChange?.(true);
    };

    const replaceControl = (id: string, patch: JsonObject) => {
        setControls((current) => current.map((control) => str(control.id) === id ? { ...control, ...patch } : control));
        markDirty();
    };

    const addControl = (nextKind: string) => {
        const rect = fitRectInEmptySpace(
            DEFAULT_RECTS[nextKind] ?? DEFAULT_RECTS.pot,
            controls.map((control) => ({
                x: num(control.x), y: num(control.y), width: num(control.width, 0.18), height: num(control.height, 0.28)
            })),
            virtualControlMinSize(nextKind)
        );
        if (!rect) {
            setMessage("No empty space for another control. Resize or move an existing control first.");
            return;
        }
        const id = `vctl-${Date.now().toString(36)}-${controls.length}`;
        setControls((current) => [...current, {
            id,
            label: nextLabel(nextKind, current),
            automaticLabel: true,
            kind: nextKind,
            orientation: "vertical",
            appearance: {},
            ...rect
        }]);
        setSelectedId(id);
        setMessage("");
        markDirty();
    };

    const duplicate = () => {
        if (!selected) return;
        const rect = fitRectInEmptySpace({
            x: num(selected.x) + 0.03,
            y: num(selected.y) + 0.03,
            width: num(selected.width, 0.18),
            height: num(selected.height, 0.28)
        }, controls.map((control) => ({
            x: num(control.x), y: num(control.y), width: num(control.width), height: num(control.height)
        })), virtualControlMinSize(kind, str(selected.orientation)));
        if (!rect) { setMessage("No empty space for a duplicate."); return; }
        const id = `vctl-${Date.now().toString(36)}-${controls.length}`;
        setControls((current) => [...current, {
            ...selected,
            id,
            label: nextLabel(kind, current),
            automaticLabel: false,
            ...rect
        }]);
        setSelectedId(id);
        markDirty();
    };

    const startDrag = (event: ReactPointerEvent, control: JsonObject, mode: DragState["mode"]) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        setSelectedId(str(control.id));
        const state: DragState = {
            id: str(control.id), pointerId: event.pointerId, mode,
            startX: event.clientX, startY: event.clientY,
            rect: { x: num(control.x), y: num(control.y), width: num(control.width, 0.18), height: num(control.height, 0.28) }
        };
        drag.current = state;
        const move = (next: PointerEvent) => {
            if (!drag.current || next.pointerId !== state.pointerId || !stageRef.current) return;
            next.preventDefault();
            const bounds = stageRef.current.getBoundingClientRect();
            const dx = (next.clientX - state.startX) / Math.max(1, bounds.width);
            const dy = (next.clientY - state.startY) / Math.max(1, bounds.height);
            const minimum = virtualControlMinSize(str(control.kind), str(control.orientation));
            const proposed = state.mode === "move"
                ? { ...state.rect, x: state.rect.x + dx, y: state.rect.y + dy }
                : { ...state.rect, width: state.rect.width + dx, height: state.rect.height + dy };
            const rect = clampRect(proposed, minimum);
            setControls((current) => current.map((item) => str(item.id) === state.id ? { ...item, ...rect } : item));
        };
        const finish = (next: PointerEvent) => {
            if (next.pointerId !== state.pointerId) return;
            drag.current = null;
            window.removeEventListener("pointermove", move, true);
            window.removeEventListener("pointerup", finish, true);
            window.removeEventListener("pointercancel", finish, true);
            markDirty();
        };
        window.addEventListener("pointermove", move, { capture: true, passive: false });
        window.addEventListener("pointerup", finish, true);
        window.addEventListener("pointercancel", finish, true);
    };

    const saveConfig = async (name = layoutName) => {
        const savedName = name.trim() || "default";
        await engine.client.request("virtual-controls/config", {
            version: 1, layoutName: savedName, controls, groups: []
        });
        setLayoutName(savedName);
        setDirty(false);
        onDirtyChange?.(false);
        setMessage(`Virtual Controls layout “${savedName}” saved.`);
    };

    const layoutFile = (name = layoutName) => JSON.stringify({
        format: "pimfx-virtual-controls-layout",
        version: 1,
        layoutName: name.trim() || "default",
        controls,
        groups: []
    }, null, 2);

    const loadLayout = (parsed: JsonObject, path: string) => {
        if (str(parsed.format) !== "pimfx-virtual-controls-layout") {
            setMessage("That is not a Virtual Controls layout.");
            return;
        }
        const next = objects(parsed.controls);
        setControls(next);
        setLayoutName(str(parsed.layoutName) || layoutNameFromPath(path));
        setSelectedId(str(next[0]?.id));
        markDirty();
        setPicker(null);
        setMessage("Layout loaded. Choose SAVE LAYOUT to make it active.");
    };

    const bind = (patch: JsonObject) => {
        if (!selectedId || !str(obj(preset).id)) return;
        void run(() => engine.client.request("preset/bind", {
            controlId: selectedId,
            ownerBankId: str(obj(bank).id),
            ownerPresetId: str(obj(preset).id),
            ...patch
        }));
    };

    const chooseAction = (action: string) => {
        if (action === "none") { bind({ action: "none" }); return; }
        if (action === "toggleEffect") {
            const slot = chain[0];
            if (!slot) { setMessage("This preset has no effects to bind."); return; }
            bind({ action, slotId: str(slot.id) });
            return;
        }
        if (action === "setParameter") {
            for (const slot of chain) {
                const port = objects(obj(slot.plugin).ports).find((item) => virtualTargetCompatible(kind, action, item));
                if (port) {
                    bind({ action, slotId: str(slot.id), portSymbol: str(port.symbol), min: num(port.min), max: num(port.max, 1) });
                    return;
                }
            }
            setMessage("This preset has no compatible parameter for that control type.");
            return;
        }
        if (action === "selectPreset") {
            bind({ action, targetBankId: str(obj(bank).id), targetPresetId: str(obj(preset).id) });
            return;
        }
        if (action === "selectSnapshot") {
            const snapshot = objects(obj(preset).snapshots)[0];
            if (!snapshot) { setMessage("This preset has no snapshots to select."); return; }
            bind({ action, snapshotId: str(snapshot?.id), snapshotSlot: num(snapshot?.slot, 0) });
            return;
        }
        bind({ action });
    };

    const actionOptions = useMemo(() => {
        const basic = ["none", "setParameter", "toggleEffect"];
        return [...basic, ...VIRTUAL_DISCRETE_ACTIONS].filter((action) => action === "none"
            || action === "setParameter" || action === "toggleEffect"
            || virtualTargetCompatible(kind, action));
    }, [kind]);
    const selectedSlot = chain.find((slot) => str(slot.id) === str(obj(binding).slotId));
    const compatiblePorts = objects(obj(obj(selectedSlot).plugin).ports)
        .filter((port) => virtualTargetCompatible(kind, "setParameter", port));
    const display = selected
        ? resolveVirtualControlDisplay(selected, binding, chain, engine.state)
        : null;

    useEffect(() => () => onDirtyChange?.(false), []);

    return (
        <div className="virtual-layout-editor">
            <div className="virtual-layout-toolbar">
                <label className="field"><span>LAYOUT</span><input value={layoutName} onChange={(event) => { setLayoutName(event.target.value); markDirty(); }} /></label>
                <button type="button" className="btn" onClick={() => setPicker("load")}>LOAD</button>
                <button type="button" className="btn" onClick={() => setPicker("save")}>SAVE AS</button>
                <button type="button" className="btn btn-accent" disabled={!dirty} onClick={() => void run(() => saveConfig())}>SAVE LAYOUT</button>
            </div>
            {message && <div className="muted virtual-layout-message">{message}</div>}
            <div className="virtual-layout-body">
                <aside className="virtual-layout-inspector">
                    <section className="stack">
                        <h3>ADD CONTROL</h3>
                        <div className="virtual-control-palette">
                            {VIRTUAL_CONTROL_TYPES.map((type) => <button key={type} type="button" className="btn" onClick={() => addControl(type)}>{type.toUpperCase()}</button>)}
                        </div>
                    </section>
                    {selected && <>
                        <section className="stack">
                            <h3>LAYOUT PROPERTIES</h3>
                            <label className="field"><span>Type</span><select value={kind} onChange={(event) => {
                                const nextKind = event.target.value;
                                const min = virtualControlMinSize(nextKind, str(selected.orientation));
                                replaceControl(selectedId, { kind: nextKind, width: Math.max(num(selected.width), min.width), height: Math.max(num(selected.height), min.height) });
                            }}>{VIRTUAL_CONTROL_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
                            <label className="field"><span>Custom label</span><input value={str(selected.label)} disabled={bool(selected.automaticLabel)} onChange={(event) => replaceControl(selectedId, { label: event.target.value })} /></label>
                            <button type="button" className={`btn ${bool(selected.automaticLabel) ? "btn-active" : ""}`} onClick={() => replaceControl(selectedId, { automaticLabel: !bool(selected.automaticLabel) })}>AUTO LABEL {bool(selected.automaticLabel) ? "ON" : "OFF"}</button>
                            {kind === "slider" && <label className="field"><span>Orientation</span><select value={str(selected.orientation, "vertical")} onChange={(event) => replaceControl(selectedId, { orientation: event.target.value })}><option value="vertical">Vertical</option><option value="horizontal">Horizontal</option></select></label>}
                            <div className="row"><button type="button" className="btn" onClick={duplicate}>DUPLICATE</button><button type="button" className="btn btn-danger" onClick={() => setDeleteId(selectedId)}>DELETE</button></div>
                        </section>
                        <section className="stack">
                            <h3>ACTIVE PRESET BINDING</h3>
                            <label className="field"><span>Preset to edit</span><select value={`${str(obj(bank).id)}:${str(obj(preset).id)}`} onChange={(event) => {
                                const choice = presetChoices.find((item) => `${item.bankId}:${item.presetId}` === event.target.value);
                                if (choice) void run(() => engine.client.request("preset/select", { bankId: choice.bankId, presetId: choice.presetId }));
                            }}>{presetChoices.map((item) => <option key={`${item.bankId}:${item.presetId}`} value={`${item.bankId}:${item.presetId}`}>{item.bankName} · {item.presetName}</option>)}</select></label>
                            <label className="field"><span>Function</span><select value={str(obj(binding).action, "none")} onChange={(event) => chooseAction(event.target.value)}>{actionOptions.map((action) => <option key={action} value={action}>{VIRTUAL_ACTION_LABELS[action] ?? action}</option>)}</select></label>
                            {str(obj(binding).action) === "toggleEffect" && <label className="field"><span>Effect</span><select value={str(obj(binding).slotId)} onChange={(event) => bind({ ...binding, action: "toggleEffect", slotId: event.target.value })}>{chain.map((slot) => <option key={str(slot.id)} value={str(slot.id)}>{str(slot.name) || str(obj(slot.plugin).name, "Effect")}</option>)}</select></label>}
                            {str(obj(binding).action) === "setParameter" && <>
                                <label className="field"><span>Effect</span><select value={str(obj(binding).slotId)} onChange={(event) => {
                                    const slot = chain.find((item) => str(item.id) === event.target.value);
                                    const port = objects(obj(obj(slot).plugin).ports).find((item) => virtualTargetCompatible(kind, "setParameter", item));
                                    if (slot && port) bind({ action: "setParameter", slotId: str(slot.id), portSymbol: str(port.symbol), min: num(port.min), max: num(port.max, 1) });
                                }}>{chain.filter((slot) => objects(obj(slot.plugin).ports).some((port) => virtualTargetCompatible(kind, "setParameter", port))).map((slot) => <option key={str(slot.id)} value={str(slot.id)}>{str(slot.name) || str(obj(slot.plugin).name, "Effect")}</option>)}</select></label>
                                <label className="field"><span>Parameter</span><select value={str(obj(binding).portSymbol)} onChange={(event) => {
                                    const port = compatiblePorts.find((item) => str(item.symbol) === event.target.value);
                                    if (port) bind({ ...binding, action: "setParameter", portSymbol: str(port.symbol), min: num(port.min), max: num(port.max, 1) });
                                }}>{compatiblePorts.map((port) => <option key={str(port.symbol)} value={str(port.symbol)}>{str(port.name, str(port.symbol))}</option>)}</select></label>
                                <button type="button" className={`btn ${bool(obj(binding).inverted) ? "btn-active" : ""}`} onClick={() => bind({ ...binding, action: "setParameter", inverted: !bool(obj(binding).inverted) })}>{bool(obj(binding).inverted) ? "REVERSED" : "NORMAL"}</button>
                            </>}
                            {str(obj(binding).action) === "selectPreset" && <label className="field"><span>Target preset</span><select value={`${str(obj(binding).bankId)}:${str(obj(binding).presetId)}`} onChange={(event) => {
                                const choice = presetChoices.find((item) => `${item.bankId}:${item.presetId}` === event.target.value);
                                if (choice) bind({ action: "selectPreset", targetBankId: choice.bankId, targetPresetId: choice.presetId });
                            }}>{presetChoices.map((item) => <option key={`${item.bankId}:${item.presetId}`} value={`${item.bankId}:${item.presetId}`}>{item.bankName} · {item.presetName}</option>)}</select></label>}
                            {str(obj(binding).action) === "selectSnapshot" && <label className="field"><span>Snapshot</span><select value={num(obj(binding).snapshotSlot, -1)} onChange={(event) => {
                                const slot = Number(event.target.value);
                                const snapshot = objects(obj(preset).snapshots).find((item) => num(item.slot, -1) === slot);
                                bind({ action: "selectSnapshot", snapshotSlot: slot, snapshotId: str(snapshot?.id) });
                            }}>{objects(obj(preset).snapshots).map((snapshot, index) => <option key={str(snapshot.id, String(index))} value={num(snapshot.slot, index)}>{str(snapshot.name, `Snapshot ${index + 1}`)}</option>)}</select></label>}
                            <div className={display?.missing ? "danger" : "muted"}>{display?.missing ? "Saved target is missing." : display?.assigned ? `${display.context} · ${display.valueText}` : "Unbound in this preset."}</div>
                            <div className="virtual-binding-summary">
                                <strong>ALL PRESETS</strong>
                                {presetChoices.map((item) => {
                                    const itemBinding = virtualBindingFor(item.preset, selectedId);
                                    return <div key={`${item.bankId}:${item.presetId}`}><span>{item.presetName}</span><small>{VIRTUAL_ACTION_LABELS[str(obj(itemBinding).action, "none")] ?? str(obj(itemBinding).action, "Unbound")}</small></div>;
                                })}
                            </div>
                        </section>
                    </>}
                </aside>
                <div ref={stageRef} className="virtual-layout-stage">
                    {controls.map((control) => {
                        const id = str(control.id);
                        const controlKind = str(control.kind, "pot");
                        const controlBinding = virtualBindingFor(preset, id);
                        const controlDisplay = resolveVirtualControlDisplay(control, controlBinding, chain, engine.state);
                        return <div key={id} className={`virtual-layout-item${selectedId === id ? " selected" : ""}`} style={{ left: `${num(control.x) * 100}%`, top: `${num(control.y) * 100}%`, width: `${num(control.width, 0.18) * 100}%`, height: `${num(control.height, 0.28) * 100}%` }} onPointerDown={(event) => startDrag(event, control, "move")}>
                            <PerformanceControl tile={{ id, switchLabel: controlDisplay.label, valueText: controlDisplay.valueText || controlDisplay.context, role: "utility", lightState: controlDisplay.missing ? "modified" : "inactive", active: false, analog: ["pot", "slider", "encoder"].includes(controlKind), analogSource: controlDisplay.label, analogFunction: controlDisplay.context, analogValue: controlDisplay.valueText, assigned: controlDisplay.assigned, kind: controlKind, orientation: str(control.orientation) === "horizontal" ? "horizontal" : "vertical", value: controlDisplay.range, onPress: () => undefined }} switchStyle="tiles" bypassed={false} renderMenu={false} />
                            <button type="button" className="virtual-layout-resize" aria-label="Resize" onPointerDown={(event) => startDrag(event, control, "resize")} />
                        </div>;
                    })}
                </div>
            </div>
            {picker && <LibraryJsonPicker engine={engine} run={run} kind="virtuallayout" mode={picker} title={picker === "load" ? "LOAD VIRTUAL CONTROLS LAYOUT" : "SAVE VIRTUAL CONTROLS LAYOUT AS"} defaultName={layoutName || "default"} contents={picker === "save" ? (name) => layoutFile(name) : undefined} onClose={() => setPicker(null)} onLoad={loadLayout} onSaved={(path) => void run(() => saveConfig(layoutNameFromPath(path, layoutName)))} />}
            {deleteId && <ConfirmDialog title="DELETE VIRTUAL CONTROL?" body="This removes the control and its bindings from every preset." confirmLabel="DELETE" danger onCancel={() => setDeleteId("")} onConfirm={() => {
                const next = controls.filter((control) => str(control.id) !== deleteId);
                setControls(next); setSelectedId(str(next[0]?.id)); setDeleteId(""); markDirty();
            }} />}
        </div>
    );
}
