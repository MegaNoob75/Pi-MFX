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
    virtualControlPageId,
    virtualControlPages,
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
    const sharedSaved = obj(engine.state.sharedVirtualControls);
    const [surfaceMode, setSurfaceMode] = useState(() => str(engine.state.virtualControlsMode, "shared"));
    const [pages, setPages] = useState<JsonObject[]>(() => virtualControlPages(saved));
    const [controls, setControls] = useState<JsonObject[]>(() => {
        const initialPages = virtualControlPages(saved);
        return objects(saved.controls).map((control) => ({
            ...control, pageId: virtualControlPageId(control, initialPages)
        }));
    });
    const [layoutName, setLayoutName] = useState(() => str(saved.layoutName, "default"));
    const [activePageId, setActivePageId] = useState(() => str(virtualControlPages(saved)[0]?.id, "page-1"));
    const [selectedId, setSelectedId] = useState(() => str(objects(saved.controls)[0]?.id));
    const [dirty, setDirty] = useState(false);
    const [picker, setPicker] = useState<"load" | "save" | null>(null);
    const [deleteId, setDeleteId] = useState("");
    const [deletePageId, setDeletePageId] = useState("");
    const [pendingSurfaceMode, setPendingSurfaceMode] = useState<"shared" | "custom" | "auto" | "">("");
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
    const pageControls = controls.filter((control) => virtualControlPageId(control, pages) === activePageId);
    const selected = controls.find((control) => str(control.id) === selectedId);
    const kind = str(obj(selected).kind, "pot");
    const binding = virtualBindingFor(preset, selectedId);
    const presetKey = `${str(obj(bank).id)}:${str(obj(preset).id)}`;
    const previousPresetKey = useRef(presetKey);

    useEffect(() => {
        if (previousPresetKey.current === presetKey) return;
        previousPresetKey.current = presetKey;
        const nextSaved = obj(engine.state.virtualControls);
        const nextPages = virtualControlPages(nextSaved);
        const nextControls: JsonObject[] = objects(nextSaved.controls).map((control): JsonObject => ({
            ...control, pageId: virtualControlPageId(control, nextPages)
        }));
        setSurfaceMode(str(engine.state.virtualControlsMode, "shared"));
        setPages(nextPages);
        setControls(nextControls);
        setLayoutName(str(nextSaved.layoutName, "default"));
        setActivePageId(str(nextPages[0]?.id, "page-1"));
        setSelectedId(str(nextControls[0]?.id));
        setDirty(false);
        onDirtyChange?.(false);
        setMessage("");
    }, [presetKey, engine.state.virtualControls, engine.state.virtualControlsMode, onDirtyChange]);

    const markDirty = () => {
        if (surfaceMode === "auto") {
            setSurfaceMode("custom");
            setMessage("This generated surface is now a custom preset layout. Save to keep your edits.");
        }
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
            pageControls.map((control) => ({
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
            pageId: activePageId,
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
        }, pageControls.map((control) => ({
            x: num(control.x), y: num(control.y), width: num(control.width), height: num(control.height)
        })), virtualControlMinSize(kind, str(selected.orientation)));
        if (!rect) { setMessage("No empty space for a duplicate."); return; }
        const id = `vctl-${Date.now().toString(36)}-${controls.length}`;
        setControls((current) => [...current, {
            ...selected,
            id,
            label: nextLabel(kind, current),
            automaticLabel: false,
            pageId: activePageId,
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
            version: 2, layoutName: savedName, pages, controls, groups: [],
            ...(surfaceMode === "shared" ? {} : { scope: "preset", mode: "custom" })
        });
        if (surfaceMode === "auto") setSurfaceMode("custom");
        setLayoutName(savedName);
        setDirty(false);
        onDirtyChange?.(false);
        setMessage(`Virtual Controls layout “${savedName}” saved.`);
    };

    const useSharedLayout = async () => {
        await engine.client.request("virtual-controls/config", {
            scope: "preset", mode: "shared", preserveBindings: true
        });
        const nextPages = virtualControlPages(sharedSaved);
        const nextControls = objects(sharedSaved.controls);
        setSurfaceMode("shared");
        setPages(nextPages);
        setControls(nextControls);
        setActivePageId(str(nextPages[0]?.id, "page-1"));
        setSelectedId(str(nextControls[0]?.id));
        setDirty(false);
        onDirtyChange?.(false);
        setMessage("This preset now uses the shared Virtual Controls layout.");
    };

    const usePresetLayout = async () => {
        await engine.client.request("virtual-controls/config", {
            version: 2, layoutName, pages, controls, groups: [],
            scope: "preset", mode: "custom", preserveBindings: true
        });
        setSurfaceMode("custom");
        setDirty(false);
        onDirtyChange?.(false);
        setMessage("A custom copy of this layout now belongs to the current preset.");
    };

    const generateFromPreset = async () => {
        const generatedPages: JsonObject[] = [];
        const generatedControls: JsonObject[] = [];
        const generatedBindings: JsonObject[] = [];
        const perPage = 8;
        for (const slot of chain) {
            const slotId = str(slot.id);
            const effectName = str(slot.name) || str(obj(slot.plugin).name, "Effect");
            const ports = objects(obj(slot.plugin).ports).filter((port) =>
                str(port.kind) === "control" && bool(port.input, true) && !bool(port.notOnGui));
            const entries: Array<{ control: JsonObject; binding: JsonObject }> = [{
                control: { id: `auto:${slotId}:bypass`, kind: "latching", label: `${effectName} Bypass`, automaticLabel: false },
                binding: { action: "toggleEffect", slotId }
            }, ...ports.map((port) => ({
                control: {
                    id: `auto:${slotId}:${str(port.symbol)}`,
                    kind: bool(port.trigger) ? "momentary" : bool(port.toggled) ? "latching" : bool(port.enumerated) ? "encoder" : "pot",
                    label: str(port.name, str(port.symbol)),
                    automaticLabel: true
                },
                binding: {
                    action: "setParameter", slotId, portSymbol: str(port.symbol),
                    min: num(port.min, 0), max: num(port.max, 1)
                }
            }))];
            for (let start = 0; start < entries.length; start += perPage) {
                const chunk = entries.slice(start, start + perPage);
                const part = Math.floor(start / perPage);
                const pageId = `auto-page:${slotId}:${part}`;
                generatedPages.push({ id: pageId, name: entries.length > perPage ? `${effectName} ${part + 1}` : effectName });
                chunk.forEach((entry, index) => {
                    const column = index % 4;
                    const row = Math.floor(index / 4);
                    generatedControls.push({
                        ...entry.control, pageId,
                        x: 0.025 + column * 0.245,
                        y: 0.04 + row * 0.48,
                        width: 0.215,
                        height: 0.42,
                        orientation: "vertical",
                        appearance: {}
                    });
                    generatedBindings.push({ controlId: str(entry.control.id), ...entry.binding });
                });
            }
        }
        if (generatedPages.length === 0) generatedPages.push({ id: "auto-page:empty", name: "Empty Preset" });
        await engine.client.request("virtual-controls/config", {
            version: 2, layoutName: `${str(obj(preset).name, "Preset")} Auto`,
            pages: generatedPages, controls: generatedControls, groups: [],
            scope: "preset", mode: "auto"
        });
        for (const binding of generatedBindings) {
            await engine.client.request("preset/bind", {
                ...binding,
                ownerBankId: str(obj(bank).id),
                ownerPresetId: str(obj(preset).id)
            });
        }
        setSurfaceMode("auto");
        setPages(generatedPages);
        setControls(generatedControls);
        setLayoutName(`${str(obj(preset).name, "Preset")} Auto`);
        setActivePageId(str(generatedPages[0]?.id));
        setSelectedId(str(generatedControls[0]?.id));
        setDirty(false);
        onDirtyChange?.(false);
        setMessage("Automatic pages generated from the current preset. Choose CUSTOM PRESET to rearrange them.");
    };

    const applySurfaceMode = async () => {
        const next = pendingSurfaceMode;
        setPendingSurfaceMode("");
        if (next === "shared") await useSharedLayout();
        else if (next === "custom") await usePresetLayout();
        else if (next === "auto") await generateFromPreset();
    };

    const layoutFile = (name = layoutName) => JSON.stringify({
        format: "pimfx-virtual-controls-layout",
        version: 2,
        layoutName: name.trim() || "default",
        pages,
        controls,
        groups: []
    }, null, 2);

    const loadLayout = (parsed: JsonObject, path: string) => {
        if (str(parsed.format) !== "pimfx-virtual-controls-layout") {
            setMessage("That is not a Virtual Controls layout.");
            return;
        }
        const nextPages = virtualControlPages(parsed);
        const next = objects(parsed.controls).map((control): JsonObject => ({
            ...control, pageId: virtualControlPageId(control, nextPages)
        }));
        setPages(nextPages);
        setControls(next);
        setLayoutName(str(parsed.layoutName) || layoutNameFromPath(path));
        setActivePageId(str(nextPages[0]?.id, "page-1"));
        setSelectedId(str(next.find((control) => virtualControlPageId(control, nextPages) === str(nextPages[0]?.id))?.id));
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

    const addPage = () => {
        const id = `page-${Date.now().toString(36)}`;
        const page = { id, name: `Page ${pages.length + 1}` };
        setPages((current) => [...current, page]);
        setActivePageId(id);
        setSelectedId("");
        markDirty();
    };

    const switchPage = (id: string) => {
        setActivePageId(id);
        setSelectedId(str(controls.find((control) => virtualControlPageId(control, pages) === id)?.id));
    };

    const removePage = (id: string) => {
        if (pages.length <= 1) return;
        const nextPages = pages.filter((page) => str(page.id) !== id);
        const nextControls = controls.filter((control) => virtualControlPageId(control, pages) !== id);
        const nextId = str(nextPages[0]?.id, "page-1");
        setPages(nextPages);
        setControls(nextControls);
        setActivePageId(nextId);
        setSelectedId(str(nextControls.find((control) => virtualControlPageId(control, nextPages) === nextId)?.id));
        setDeletePageId("");
        markDirty();
    };

    useEffect(() => () => onDirtyChange?.(false), []);

    return (
        <div className="virtual-layout-editor">
            <div className="virtual-layout-toolbar">
                <span className="virtual-controls-layout">{surfaceMode.toUpperCase()}</span>
                <button type="button" className={`btn ${surfaceMode === "shared" ? "btn-active" : ""}`} onClick={() => surfaceMode !== "shared" && setPendingSurfaceMode("shared")}>SHARED</button>
                <button type="button" className={`btn ${surfaceMode === "custom" ? "btn-active" : ""}`} onClick={() => surfaceMode !== "custom" && setPendingSurfaceMode("custom")}>CUSTOM PRESET</button>
                <button type="button" className={`btn ${surfaceMode === "auto" ? "btn-active" : ""}`} onClick={() => setPendingSurfaceMode("auto")}>AUTO FROM EFFECTS</button>
                <label className="field"><span>LAYOUT</span><input value={layoutName} onChange={(event) => { setLayoutName(event.target.value); markDirty(); }} /></label>
                <button type="button" className="btn" onClick={() => setPicker("load")}>LOAD</button>
                <button type="button" className="btn" onClick={() => setPicker("save")}>SAVE AS</button>
                <button type="button" className="btn btn-accent" disabled={!dirty || surfaceMode === "auto"} onClick={() => void run(() => saveConfig())}>{surfaceMode === "shared" ? "SAVE SHARED LAYOUT" : "SAVE PRESET LAYOUT"}</button>
            </div>
            {message && <div className="muted virtual-layout-message">{message}</div>}
            <div className="virtual-layout-body">
                <aside className="virtual-layout-inspector">
                    <section className="stack">
                        <h3>PAGES</h3>
                        <div className="virtual-page-list">
                            {pages.map((page, index) => <button key={str(page.id)} type="button"
                                className={`btn ${activePageId === str(page.id) ? "btn-active" : ""}`}
                                onClick={() => switchPage(str(page.id))}>{str(page.name, `Page ${index + 1}`)}</button>)}
                        </div>
                        <div className="row"><button type="button" className="btn" onClick={addPage}>ADD PAGE</button>
                            <button type="button" className="btn btn-danger" disabled={pages.length <= 1}
                                onClick={() => setDeletePageId(activePageId)}>DELETE PAGE</button></div>
                        <label className="field"><span>Page name</span><input
                            value={str(pages.find((page) => str(page.id) === activePageId)?.name)}
                            onChange={(event) => { setPages((current) => current.map((page) => str(page.id) === activePageId ? { ...page, name: event.target.value } : page)); markDirty(); }} /></label>
                    </section>
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
                                {["pot", "slider", "encoder"].includes(kind) && <label className="field"><span>Reverse</span><button type="button" className={`btn ${bool(obj(binding).inverted) ? "btn-active" : ""}`} onClick={() => bind({ ...binding, action: "setParameter", inverted: !bool(obj(binding).inverted) })}>{bool(obj(binding).inverted) ? "REVERSED" : "NORMAL"}</button></label>}
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
                    {pageControls.map((control) => {
                        const id = str(control.id);
                        const controlKind = str(control.kind, "pot");
                        const controlBinding = virtualBindingFor(preset, id);
                        const controlDisplay = resolveVirtualControlDisplay(control, controlBinding, chain, engine.state);
                        return <div key={id} className={`virtual-layout-item${selectedId === id ? " selected" : ""}`} style={{ left: `${num(control.x) * 100}%`, top: `${num(control.y) * 100}%`, width: `${num(control.width, 0.18) * 100}%`, height: `${num(control.height, 0.28) * 100}%` }} onPointerDown={(event) => startDrag(event, control, "move")}>
                            <PerformanceControl tile={{ id, switchLabel: controlDisplay.label, valueText: controlDisplay.valueText || controlDisplay.context, role: "utility", lightState: controlDisplay.missing ? "modified" : "inactive", active: false, analog: ["pot", "slider", "encoder"].includes(controlKind), analogSource: controlDisplay.label, analogFunction: controlDisplay.context, analogValue: controlDisplay.valueText, assigned: controlDisplay.assigned, kind: controlKind, orientation: str(control.orientation) === "horizontal" ? "horizontal" : "vertical", value: controlDisplay.range, onEngage: () => setSelectedId(id), onPress: () => setSelectedId(id) }} switchStyle="tiles" bypassed={false} renderMenu={false} />
                            <button type="button" className="virtual-layout-resize" aria-label="Resize" onPointerDown={(event) => startDrag(event, control, "resize")} />
                        </div>;
                    })}
                </div>
            </div>
            {picker && <LibraryJsonPicker engine={engine} run={run} kind="virtuallayout" mode={picker} title={picker === "load" ? "LOAD VIRTUAL CONTROLS LAYOUT" : "SAVE VIRTUAL CONTROLS LAYOUT AS"} defaultName={layoutName || "default"} contents={picker === "save" ? (name) => layoutFile(name) : undefined} onClose={() => setPicker(null)} onLoad={loadLayout} onSaved={(path) => void run(() => saveConfig(layoutNameFromPath(path, layoutName)))} />}
            {deleteId && <ConfirmDialog title="DELETE VIRTUAL CONTROL?" body={surfaceMode === "shared" ? "This removes the control and its bindings from every preset using the shared layout." : "This removes the control and its binding from this preset."} confirmLabel="DELETE" danger onCancel={() => setDeleteId("")} onConfirm={() => {
                const next = controls.filter((control) => str(control.id) !== deleteId);
                setControls(next); setSelectedId(str(next.find((control) => virtualControlPageId(control, pages) === activePageId)?.id)); setDeleteId(""); markDirty();
            }} />}
            {deletePageId && <ConfirmDialog title="DELETE PAGE?" body={surfaceMode === "shared" ? "This removes the page, its controls, and their bindings from every preset using the shared layout." : "This removes the page, its controls, and their bindings from this preset."} confirmLabel="DELETE PAGE" danger onCancel={() => setDeletePageId("")} onConfirm={() => removePage(deletePageId)} />}
            {pendingSurfaceMode && <ConfirmDialog
                title={pendingSurfaceMode === "auto" ? "REBUILD CONTROLS FROM EFFECTS?" : "CHANGE VIRTUAL CONTROLS LAYOUT?"}
                body={pendingSurfaceMode === "auto"
                    ? `This replaces this preset's Virtual Controls pages and bindings with controls generated from its current effects.${dirty ? " Your unsaved layout edits will be discarded." : ""}`
                    : `This changes which Virtual Controls layout this preset uses.${dirty ? " Your unsaved layout edits will be discarded." : " Existing compatible bindings will be kept."}`}
                confirmLabel={pendingSurfaceMode === "auto" ? "REBUILD" : "CHANGE LAYOUT"}
                danger={pendingSurfaceMode === "auto"}
                onCancel={() => setPendingSurfaceMode("")}
                onConfirm={() => void run(applySurfaceMode)}
            />}
        </div>
    );
}
