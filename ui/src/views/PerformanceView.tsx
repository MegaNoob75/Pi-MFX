import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { findBank, findPreset, isAnalogKind, type EngineSnapshot } from "../api";
import { bool, num, obj, str, objects, type JsonObject } from "../json";
import { askText } from "../keyboard/ask";
import { loadUiBehavior } from "../uiBehavior";
import {
    STATUS_WIDGET_IDS,
    STATUS_WIDGET_LABELS,
    analogMinSize,
    clampRect,
    gridCellRect,
    readStatusWidgets,
    unplacedIds
} from "../layout";
import {
    analogFeedback,
    PerformanceControl,
    type AnalogFeedback,
    type LightState,
    type PerformanceTile,
    type SwitchRole
} from "./PerformanceControl";

const SNAPSHOT_GRID_COLUMNS = 3;
const SNAPSHOT_GRID_ROWS = 2;
const SNAPSHOT_SLOT_COUNT = SNAPSHOT_GRID_COLUMNS * SNAPSHOT_GRID_ROWS;
const PRESET_DRAG_THRESHOLD = 24;
const PRESET_BASELINE_KEY = "pimfx-preset-baseline";

type PresetMenu = {
    kind: "preset";
    controlId: string;
    slotIndex: number;
    presetId: string;
    canAssign: boolean;
};

type AssignMenu = {
    kind: "assign";
    controlId: string;
    slotIndex: number;
};

type DeleteMenu = {
    kind: "delete";
    controlId: string;
    presetId: string;
    name: string;
};

type SnapshotMenu = {
    kind: "snapshot";
    snapshotId: string;
    index: number;
    empty?: boolean;
};

type TileMenu = PresetMenu | AssignMenu | DeleteMenu | SnapshotMenu;

type PresetDrag = {
    pointerId: number;
    controlId: string;
    slotIndex: number;
    name: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    dragging: boolean;
    holdTimer: number | null;
    holdFired: boolean;
};

export function PerformanceView({
    engine,
    run,
    onEdit,
    onEditSnapshot
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    onSnapshots?: () => void;
    onEdit?: () => void;
    onEditSnapshot?: (snapshotId: string) => void;
}) {
    const { client, state, meters } = engine;
    const bank = findBank(state);
    const preset = findPreset(state);
    const banks = objects(state.banks);
    const ui = obj(state.ui);
    const controller = obj(state.controller);
    const layout = obj(controller.performanceLayout);
    const widgets = readStatusWidgets(layout);
    const controls = objects(controller.controls);
    const hidden = new Set(unplacedIds(layout));
    const presets = objects(obj(bank).presets);
    const snapshots = objects(obj(preset).snapshots);
    const rows = Math.max(1, num(controller.gridRows, 2));
    const columns = Math.max(1, num(controller.gridColumns, 4));
    const switchCount = Math.max(1, num(ui.virtualSwitchCount, 8));
    const bypassAll = bool(state.bypassAll);
    const snapshotMode = bool(state.snapshotMode);
    const tuner = obj(meters.tuner);
    const layoutMode = str(controller.layoutMode, "grid");
    const useFreeform = layoutMode === "freeform" && !snapshotMode;
    const mirror = bool(controller.mirrorLayoutOnScreen, true);
    const switchStyle = document.documentElement.dataset.mfxSwitchStyle || "tiles";
    const activeSnapshot = num(obj(preset).activeSnapshot, -1);
    const snapshotWriteBlocked = snapshotMode || activeSnapshot >= 0;
    const feedbackOn = loadUiBehavior().parameterFeedback;

    const positions = obj(state.controlPositions);
    const chain = objects(state.chain);
    const [bankMenuOpen, setBankMenuOpen] = useState(false);
    const [presetMenuOpen, setPresetMenuOpen] = useState(false);
    const [menu, setMenu] = useState<TileMenu | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [toast, setToast] = useState("");
    const [pressedId, setPressedId] = useState("");
    const [presetDrag, setPresetDrag] = useState<PresetDrag | null>(null);
    const [dropTargetId, setDropTargetId] = useState("");
    const [dragOverTrash, setDragOverTrash] = useState(false);
    const [feedback, setFeedback] = useState<AnalogFeedback | null>(null);
    const [selectedPresetSlot, setSelectedPresetSlot] = useState(0);
    const dragRef = useRef<PresetDrag | null>(null);
    const toastTimer = useRef<number | null>(null);
    const feedbackTimer = useRef<number | null>(null);
    const chainSignature = useMemo(() => signatureForChain(chain), [chain]);
    const presetModified = useMemo(
        () => isPresetModified(str(state.activePresetId), chainSignature),
        [state.activePresetId, chainSignature]
    );

    const showFeedback = (next: AnalogFeedback | null) => {
        setFeedback(next);
        if (feedbackTimer.current !== null) {
            window.clearTimeout(feedbackTimer.current);
            feedbackTimer.current = null;
        }
        if (!next) {
            return;
        }
        const duration = Number.parseInt(
            getComputedStyle(document.documentElement).getPropertyValue("--mfx-feedback-duration-ms"),
            10
        );
        feedbackTimer.current = window.setTimeout(
            () => setFeedback(null),
            Number.isFinite(duration) ? duration : 2600
        );
    };

    const showToast = (text: string) => {
        setToast(text);
        if (toastTimer.current !== null) {
            window.clearTimeout(toastTimer.current);
        }
        toastTimer.current = window.setTimeout(() => setToast(""), 1800);
    };

    useEffect(() => () => {
        if (toastTimer.current !== null) {
            window.clearTimeout(toastTimer.current);
        }
        if (feedbackTimer.current !== null) {
            window.clearTimeout(feedbackTimer.current);
        }
    }, []);

    useEffect(() => {
        rememberPresetBaseline(str(state.activePresetId), chainSignature);
    }, [state.activePresetId]);

    const assigned = (controlId: string) => {
        const bankMap = obj(obj(controller.presetAssignments)[str(bank?.id)]);
        return str(bankMap[controlId]);
    };

    const bankMap = () => ({ ...obj(obj(controller.presetAssignments)[str(obj(bank).id)]) });

    const saveAssignments = (nextMap: JsonObject) => {
        const bankId = str(obj(bank).id);
        if (!bankId) {
            return Promise.resolve();
        }
        return client.request("controller/config", {
            ...controller,
            presetAssignments: {
                ...obj(controller.presetAssignments),
                [bankId]: nextMap
            }
        });
    };

    const pressControl = (id: string, pressed: boolean) => {
        void client.request("controller/press", { controlId: id, pressed }).catch(() => undefined);
    };

    const closeMenu = () => setMenu(null);

    const openPresetMenu = (controlId: string, slotIndex: number, presetId: string, canAssign: boolean) => {
        const item = presets.find((entry) => str(entry.id) === presetId);
        setRenameValue(str(obj(item).name));
        setMenu({ kind: "preset", controlId, slotIndex, presetId, canAssign });
    };

    const roleForAction = (action: string): SwitchRole => {
        if (action === "selectPreset") {
            return "preset";
        }
        if (action === "bankUp" || action === "bankDown") {
            return "navigation";
        }
        if (action === "snapshotMode") {
            return "snapshot";
        }
        if (action === "bypassAll") {
            return "bypass";
        }
        return "utility";
    };

    const valueForAction = (action: string, presetName: string, empty: boolean) => {
        if (action === "selectPreset") {
            return empty ? "+" : presetName || "+";
        }
        if (action === "bankUp") {
            return "BANK UP";
        }
        if (action === "bankDown") {
            return "BANK DOWN";
        }
        if (action === "bypassAll") {
            return bypassAll ? "CHAIN ACTIVE" : "CHAIN BYPASS";
        }
        if (action === "snapshotMode") {
            return snapshotMode ? "EXIT SNAPSHOTS" : "SNAPSHOT MODE";
        }
        if (action === "none" || action === "") {
            return "UNASSIGNED";
        }
        return action.toUpperCase();
    };

    const holdLabelFor = (holdAction: string) => {
        if (!holdAction || holdAction === "none") {
            return undefined;
        }
        if (holdAction === "bankUp") {
            return "BANK UP";
        }
        if (holdAction === "bankDown") {
            return "BANK DOWN";
        }
        if (holdAction === "bypassAll") {
            return "CHAIN BYPASS";
        }
        if (holdAction === "snapshotMode") {
            return "SNAPSHOT MODE";
        }
        if (holdAction === "selectPreset") {
            return "PRESET";
        }
        return holdAction.replace(/([A-Z])/g, " $1").trim().toUpperCase();
    };

    const lightForPreset = (isActive: boolean): LightState => {
        if (!isActive) {
            return "inactive";
        }
        if (bypassAll) {
            return "bypass";
        }
        if (snapshotMode || activeSnapshot >= 0) {
            return "snapshot";
        }
        if (presetModified) {
            return "modified";
        }
        return "active";
    };

    const isTrashAtPoint = (x: number, y: number) => {
        const trash = document.querySelector("[data-mfx-performance-trash='true']") as HTMLElement | null;
        if (!trash) {
            return false;
        }
        const rect = trash.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    const dropTargetAtPoint = (x: number, y: number) => {
        const element = document.elementFromPoint(x, y) as HTMLElement | null;
        const switchEl = element?.closest("[data-mfx-performance-preset-index]") as HTMLElement | null;
        return switchEl?.dataset.mfxPerformancePresetIndex ?? "";
    };

    const swapAssignments = (sourceId: string, targetId: string) => {
        const next = bankMap();
        const sourcePreset = str(next[sourceId]);
        const targetPreset = str(next[targetId]);
        if (!sourcePreset) {
            return;
        }
        if (targetPreset) {
            next[sourceId] = targetPreset;
        } else {
            delete next[sourceId];
        }
        next[targetId] = sourcePreset;
        void run(() => saveAssignments(next)).then(() => {
            showToast(targetPreset ? "Preset assignments swapped" : "Preset moved to empty switch");
        });
    };

    const clearAssignment = (controlId: string) => {
        const next = bankMap();
        delete next[controlId];
        void run(() => saveAssignments(next)).then(() => showToast("Assignment cleared — preset kept"));
    };

    const beginPresetDrag = (event: ReactPointerEvent<HTMLButtonElement>, controlId: string, slotIndex: number, name: string) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const candidate: PresetDrag = {
            pointerId: event.pointerId,
            controlId,
            slotIndex,
            name,
            startX: event.clientX,
            startY: event.clientY,
            x: event.clientX,
            y: event.clientY,
            width: rect.width,
            height: rect.height,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            dragging: false,
            holdTimer: null,
            holdFired: false
        };
        dragRef.current = candidate;
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // optional
        }
        candidate.holdTimer = window.setTimeout(() => {
            if (dragRef.current?.pointerId !== candidate.pointerId || dragRef.current.dragging) {
                return;
            }
            dragRef.current.holdFired = true;
            openPresetMenu(controlId, slotIndex, assigned(controlId), true);
        }, 600);
    };

    const movePresetDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const candidate = dragRef.current;
        if (!candidate || candidate.pointerId !== event.pointerId) {
            return;
        }
        const travel = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
        if (!candidate.dragging && travel >= PRESET_DRAG_THRESHOLD) {
            candidate.dragging = true;
            if (candidate.holdTimer !== null) {
                window.clearTimeout(candidate.holdTimer);
                candidate.holdTimer = null;
            }
        }
        if (!candidate.dragging) {
            return;
        }
        event.preventDefault();
        candidate.x = event.clientX;
        candidate.y = event.clientY;
        const overTrash = isTrashAtPoint(event.clientX, event.clientY);
        setPresetDrag({ ...candidate });
        setDragOverTrash(overTrash);
        setDropTargetId(overTrash ? "" : dropTargetAtPoint(event.clientX, event.clientY));
    };

    const endPresetDrag = (event: ReactPointerEvent<HTMLButtonElement>, onTap: () => void) => {
        const candidate = dragRef.current;
        if (!candidate || candidate.pointerId !== event.pointerId) {
            return;
        }
        if (candidate.holdTimer !== null) {
            window.clearTimeout(candidate.holdTimer);
        }
        const wasDragging = candidate.dragging;
        const holdFired = candidate.holdFired;
        const overTrash = wasDragging && isTrashAtPoint(event.clientX, event.clientY);
        const dropIndex = overTrash ? "" : dropTargetAtPoint(event.clientX, event.clientY);
        dragRef.current = null;
        setPresetDrag(null);
        setDropTargetId("");
        setDragOverTrash(false);
        setPressedId("");
        if (holdFired) {
            return;
        }
        if (wasDragging) {
            event.preventDefault();
            if (overTrash) {
                clearAssignment(candidate.controlId);
                return;
            }
            const target = dropIndex === "" ? undefined : visibleControls[Number(dropIndex)];
            const targetId = str(obj(target).id);
            if (targetId && targetId !== candidate.controlId) {
                swapAssignments(candidate.controlId, targetId);
            }
            return;
        }
        onTap();
    };

    const visibleControls = controls.filter((control) => !hidden.has(str(control.id)));
    const useConfigured = visibleControls.length > 0 && (mirror || controls.length > 0);

    const tiles: PerformanceTile[] = snapshotMode
        ? Array.from({ length: SNAPSHOT_SLOT_COUNT }, (_, index) => {
            const snapshot = snapshots[index];
            const empty = !snapshot;
            return {
                id: snapshot ? str(snapshot.id) : `empty-snap-${index}`,
                switchLabel: `SNAPSHOT ${index + 1}`,
                valueText: empty ? "EMPTY" : str(snapshot.name, `Snapshot ${index + 1}`),
                empty: false,
                role: "snapshot" as const,
                lightState: (!empty && activeSnapshot === index ? "snapshot" : "inactive") as LightState,
                active: !empty && activeSnapshot === index,
                rect: gridCellRect(index, SNAPSHOT_GRID_COLUMNS, SNAPSHOT_GRID_ROWS),
                onPress: () => {
                    if (empty) {
                        showToast(`SNAPSHOT ${index + 1} IS EMPTY — HOLD TO CREATE`);
                        return;
                    }
                    if (activeSnapshot === index) {
                        void run(() => client.request("preset/restoreLive")).then(() => showToast("CLEARED • BASE PRESET"));
                        return;
                    }
                    void run(() => client.request("snapshot/select", { snapshotId: str(snapshot.id) }))
                        .then(() => showToast(`${str(snapshot.name, `SNAPSHOT ${index + 1}`)} ACTIVE`));
                },
                onLongPress: () => {
                    if (empty) {
                        void run(async () => {
                            const result = await client.request("snapshot/capture", { name: `Snapshot ${index + 1}` });
                            const snapshotId = str(result.snapshotId);
                            if (snapshotId) {
                                onEditSnapshot?.(snapshotId);
                            }
                        });
                        return;
                    }
                    setMenu({ kind: "snapshot", snapshotId: str(snapshot.id), index });
                }
            };
        })
        : useConfigured
            ? visibleControls.map((control, index) => {
                const binding = obj(control.binding);
                const controlId = str(control.id);
                const assignedPreset = assigned(controlId);
                const action = str(binding.action, "selectPreset");
                const kind = str(control.kind, "switch");
                const analog = isAnalogKind(kind);
                const canAssign = !analog && (action === "selectPreset" || action === "none" || action === "");
                const presetId = assignedPreset || str(binding.presetId);
                const presetItem = presets.find((entry) => str(entry.id) === presetId);
                const minSize = analogMinSize(kind);
                const empty = canAssign && !presetId;
                const analogInfo = analog ? analogFeedback(control, chain) : null;
                const active = presetId === str(state.activePresetId)
                    || (action === "bypassAll" && bypassAll)
                    || (action === "snapshotMode" && snapshotMode)
                    || (action === "toggleEffect" && bool(
                        obj(chain.find((slot) => str(slot.id) === str(binding.slotId))).enabled,
                        true
                    ));
                const slotIndex = index;
                return {
                    id: controlId,
                    switchLabel: str(control.label, controlId),
                    valueText: analog
                        ? analogInfo?.value || ""
                        : valueForAction(action, str(obj(presetItem).name), empty),
                    holdLabel: analog ? undefined : (empty ? undefined : holdLabelFor(str(binding.holdAction))),
                    empty,
                    role: analog ? "utility" : roleForAction(action),
                    lightState: action === "selectPreset" ? lightForPreset(active) : (active ? "active" : "inactive"),
                    active,
                    analog,
                    analogSource: analogInfo?.source,
                    analogFunction: analog && analogInfo
                        ? (analogInfo.effect ? `${analogInfo.effect} · ${analogInfo.parameter}` : analogInfo.parameter)
                        : undefined,
                    analogValue: analogInfo?.value,
                    assigned: analog ? analogInfo?.parameter !== "UNASSIGNED" : undefined,
                    kind,
                    value: num(positions[controlId], analog ? analogInfo?.range ?? 0 : (active ? 1 : 0)),
                    presetSlotIndex: canAssign ? slotIndex : undefined,
                    dropTarget: dropTargetId === String(slotIndex),
                    dragging: presetDrag?.controlId === controlId && presetDrag.dragging,
                    pressed: pressedId === controlId,
                    encoderSelected: canAssign && slotIndex === selectedPresetSlot,
                    freeform: useFreeform,
                    rect: useFreeform
                        ? clampRect({
                            x: num(control.x, gridCellRect(index, columns, rows).x),
                            y: num(control.y, gridCellRect(index, columns, rows).y),
                            width: Math.max(minSize.width, num(control.width, 0.18)),
                            height: Math.max(minSize.height, num(control.height, 0.2))
                        })
                        : gridCellRect(index, columns, rows),
                    onPress: () => {
                        if (empty) {
                            openPresetMenu(controlId, slotIndex, "", true);
                            return;
                        }
                        if (canAssign && presetId) {
                            void run(() => client.request("preset/select", {
                                bankId: str(obj(bank).id),
                                presetId
                            }));
                            return;
                        }
                        pressControl(controlId, true);
                        window.setTimeout(() => pressControl(controlId, false), 80);
                    },
                    onValue: analog
                        ? (value: number) => {
                            void client.request("controller/value", { controlId, value }).catch(() => undefined);
                        }
                        : undefined,
                    onLongPress: canAssign
                        ? () => openPresetMenu(controlId, slotIndex, presetId, true)
                        : undefined,
                    onFeedback: analog && feedbackOn ? showFeedback : undefined,
                    onPresetPointerDown: canAssign && presetId
                        ? (event) => {
                            setPressedId(controlId);
                            beginPresetDrag(event, controlId, slotIndex, str(obj(presetItem).name, "Preset"));
                        }
                        : undefined,
                    onPresetPointerMove: canAssign && presetId ? movePresetDrag : undefined,
                    onPresetPointerUp: canAssign && presetId
                        ? (event) => {
                            endPresetDrag(event, () => {
                                void run(() => client.request("preset/select", {
                                    bankId: str(obj(bank).id),
                                    presetId
                                }));
                            });
                        }
                        : undefined
                };
            })
            : Array.from({ length: Math.min(switchCount, rows * columns) }, (_, index) => {
                const item = presets[index];
                const presetId = item ? str(item.id) : "";
                const empty = !item;
                return {
                    id: item ? str(item.id) : `empty-${index}`,
                    switchLabel: `SW ${index + 1}`,
                    valueText: empty ? "+" : str(item.name),
                    empty,
                    role: "preset" as const,
                    lightState: lightForPreset(!empty && str(item.id) === str(state.activePresetId)),
                    active: !!(!empty && str(item.id) === str(state.activePresetId)),
                    encoderSelected: index === selectedPresetSlot,
                    rect: gridCellRect(index, columns, rows),
                    onPress: () => {
                        if (item) {
                            void run(() => client.request("preset/select", {
                                bankId: str(obj(bank).id),
                                presetId: str(item.id)
                            }));
                        }
                    },
                    onLongPress: () => openPresetMenu(item ? str(item.id) : `empty-${index}`, index, presetId, false)
                };
            });

    const stageTiles = snapshotMode || useFreeform
        ? tiles
        : tiles.filter((tile) => !tile.analog);

    const presetOptions = (current: PresetMenu) => {
        if (!current.presetId) {
            return current.canAssign
                ? ["Assign Preset to This Switch", "Create New Preset", "Cancel"]
                : ["Create New Preset", "Cancel"];
        }
        const options = ["Load Preset", "Edit Preset"];
        if (current.presetId === str(state.activePresetId) && !snapshotWriteBlocked) {
            options.push("Save Loaded Preset");
        }
        if (current.canAssign) {
            options.push("Assign Different Preset", "Remove From Switch");
        }
        options.push("Delete Preset", "Cancel");
        return options;
    };

    const warnSnapshotWrite = (action: string) => {
        if (!snapshotWriteBlocked) {
            return false;
        }
        window.alert(
            `${activeSnapshot >= 0 ? `Snapshot ${activeSnapshot + 1}` : "Snapshot Mode"} is active. ${action} is disabled until you return to the base preset.`
        );
        return true;
    };

    const runPresetOption = (option: string, current: PresetMenu) => {
        const item = presets.find((entry) => str(entry.id) === current.presetId);
        switch (option) {
            case "Load Preset":
                if (current.presetId) {
                    closeMenu();
                    void run(() => client.request("preset/select", {
                        bankId: str(obj(bank).id),
                        presetId: current.presetId
                    }));
                }
                break;
            case "Edit Preset":
                if (!current.presetId) {
                    break;
                }
                if (current.presetId === str(state.activePresetId) && warnSnapshotWrite("Editing the base preset")) {
                    return;
                }
                closeMenu();
                void run(async () => {
                    if (current.presetId !== str(state.activePresetId)) {
                        await client.request("preset/select", {
                            bankId: str(obj(bank).id),
                            presetId: current.presetId
                        });
                    }
                    onEdit?.();
                });
                break;
            case "Save Loaded Preset":
                if (warnSnapshotWrite("Saving the preset")) {
                    return;
                }
                closeMenu();
                void run(() => client.request("preset/save")).then(() => {
                    rememberPresetBaseline(str(state.activePresetId), signatureForChain(chain), true);
                });
                break;
            case "Assign Preset to This Switch":
            case "Assign Different Preset":
                setMenu({ kind: "assign", controlId: current.controlId, slotIndex: current.slotIndex });
                break;
            case "Remove From Switch": {
                closeMenu();
                clearAssignment(current.controlId);
                break;
            }
            case "Create New Preset":
                if (warnSnapshotWrite("Creating a preset")) {
                    return;
                }
                void askText("New preset name", str(obj(preset).name, "Preset")).then((name) => {
                    if (!name?.trim()) {
                        return;
                    }
                    closeMenu();
                    void run(async () => {
                        const result = await client.request("preset/create", { name: name.trim() });
                        const newId = str(result.presetId, str(client.snapshot.state.activePresetId));
                        if (current.canAssign && newId) {
                            await saveAssignments({ ...bankMap(), [current.controlId]: newId });
                        }
                    });
                });
                break;
            case "Delete Preset":
                if (item) {
                    setMenu({
                        kind: "delete",
                        controlId: current.controlId,
                        presetId: current.presetId,
                        name: str(item.name, "this preset")
                    });
                }
                break;
            default:
                closeMenu();
                break;
        }
    };

    const renameMenuPreset = () => {
        if (menu?.kind !== "preset" || !menu.presetId || !renameValue.trim()) {
            return;
        }
        void run(() => client.request("preset/rename", {
            presetId: menu.presetId,
            name: renameValue.trim()
        }));
    };

    const deleteMenuPreset = (current: DeleteMenu) => {
        closeMenu();
        void run(async () => {
            const next = bankMap();
            for (const key of Object.keys(next)) {
                if (str(next[key]) === current.presetId) {
                    delete next[key];
                }
            }
            await saveAssignments(next);
            await client.request("preset/delete", { presetId: current.presetId });
        });
    };

    const assignPreset = (presetId: string, controlId: string) => {
        closeMenu();
        void run(() => saveAssignments({ ...bankMap(), [controlId]: presetId }))
            .then(() => showToast("Preset assigned to switch"));
    };

    const selectedPreset = menu?.kind === "preset"
        ? presets.find((entry) => str(entry.id) === menu.presetId)
        : undefined;

    const widgetValues = {
        bank: str(obj(bank).name, "—"),
        preset: str(obj(preset).name, "—"),
        dsp: `${(num(meters.dspLoad) * 100).toFixed(0)}%`,
        xruns: `${num(meters.xruns)}`,
        audio: bool(meters.running, bool(state.audioRunning)) ? "RUN" : "STOP",
        bypass: bypassAll ? "ON" : "OFF",
        snaps: snapshotMode ? "ON" : "OFF",
        tuner: bool(tuner.valid)
            ? `${str(tuner.note)} ${num(tuner.cents) >= 0 ? "+" : ""}${num(tuner.cents).toFixed(0)}¢`
            : "—"
    };

    const selectBankId = (id: string) => {
        setBankMenuOpen(false);
        const item = banks.find((entry) => str(entry.id) === id);
        const first = objects(obj(item).presets)[0];
        if (first) {
            void run(() => client.request("preset/select", {
                bankId: id,
                presetId: str(first.id)
            }));
        }
    };

    const selectPresetId = (id: string) => {
        setPresetMenuOpen(false);
        void run(() => client.request("preset/select", {
            bankId: str(obj(bank).id),
            presetId: id
        }));
    };

    const bankPicker = (
        <NamePicker
            variant={useFreeform ? "freeform" : "grid-bank"}
            label="CURRENT BANK"
            value={`${str(obj(bank).name, "No Bank")} \u25BE`}
            open={bankMenuOpen}
            onToggle={() => {
                setPresetMenuOpen(false);
                setBankMenuOpen((open) => !open);
            }}
            options={banks.map((item) => ({
                id: str(item.id),
                name: str(item.name),
                selected: str(item.id) === str(obj(bank).id)
            }))}
            onPick={selectBankId}
        />
    );

    const presetPicker = (
        <NamePicker
            variant={useFreeform ? "freeform" : "grid-preset"}
            label="ACTIVE PRESET"
            value={`${str(obj(preset).name, "No Preset")} \u25BE`}
            open={presetMenuOpen}
            onToggle={() => {
                setBankMenuOpen(false);
                setPresetMenuOpen((open) => !open);
            }}
            options={presets.map((item) => ({
                id: str(item.id),
                name: str(item.name),
                selected: str(item.id) === str(state.activePresetId)
            }))}
            onPick={selectPresetId}
        />
    );

    const presetSlotCount = snapshotMode
        ? SNAPSHOT_SLOT_COUNT
        : tiles.filter((tile) => tile.presetSlotIndex != null).length || tiles.length;

    useEffect(() => {
        setSelectedPresetSlot((current) => Math.min(current, Math.max(0, presetSlotCount - 1)));
    }, [presetSlotCount]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
                return;
            }
            if (menu || bankMenuOpen || presetMenuOpen) {
                return;
            }
            if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
                return;
            }
            event.preventDefault();
            if (event.key === "Escape") {
                setSelectedPresetSlot(0);
                return;
            }
            if (event.key === "Enter" && !event.repeat) {
                const tile = tiles.find((item) => item.presetSlotIndex === selectedPresetSlot) ?? tiles[selectedPresetSlot];
                tile?.onPress();
                return;
            }
            const direction = event.key === "ArrowDown" ? 1 : -1;
            const next = selectedPresetSlot + direction;
            if (next >= 0 && next < presetSlotCount) {
                setSelectedPresetSlot(next);
                return;
            }
            const bankIndex = banks.findIndex((item) => str(item.id) === str(obj(bank).id));
            const neighbour = banks[bankIndex + direction];
            if (!neighbour) {
                return;
            }
            const neighbourPresets = objects(obj(neighbour).presets);
            const pick = direction > 0 ? neighbourPresets[0] : neighbourPresets[neighbourPresets.length - 1];
            if (!pick) {
                return;
            }
            setSelectedPresetSlot(direction > 0 ? 0 : Math.max(0, presetSlotCount - 1));
            void run(() => client.request("preset/select", {
                bankId: str(neighbour.id),
                presetId: str(pick.id)
            }));
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [
        menu,
        bankMenuOpen,
        presetMenuOpen,
        tiles,
        selectedPresetSlot,
        presetSlotCount,
        banks,
        bank,
        client,
        run
    ]);

    return (
        <div className="performance">
            {!useFreeform && (
                <div className="performance-header">
                    {bankPicker}
                    <div className="performance-header-split">
                        {presetPicker}
                    </div>
                </div>
            )}

            <div className={`performance-stage ${useFreeform ? "freeform" : "grid"}`}>
                {useFreeform && STATUS_WIDGET_IDS.filter((id) => widgets[id].visible).map((id) => {
                    const widget = widgets[id];
                    return (
                        <div key={id} className="status-widget" style={rectStyle(widget.rect)}>
                            {id === "currentBank" ? bankPicker
                                : id === "activePreset" ? presetPicker
                                    : (
                                        <>
                                            {widget.showLabel && (
                                                <div className="field-label mfx-performance-ui-label">{STATUS_WIDGET_LABELS[id]}</div>
                                            )}
                                            <strong className="marquee mfx-performance-ui-value">{widgetText(id, widgetValues)}</strong>
                                        </>
                                    )}
                        </div>
                    );
                })}

                {useFreeform
                    ? stageTiles.map((tile) => (
                        <div key={tile.id} className="freeform-slot" style={tile.rect ? rectStyle(tile.rect) : undefined}>
                            <PerformanceControl tile={tile} switchStyle={switchStyle} bypassed={bypassAll} />
                        </div>
                    ))
                    : (
                        <div
                            className="switch-grid"
                            style={{
                                gridTemplateColumns: `repeat(${snapshotMode ? SNAPSHOT_GRID_COLUMNS : columns}, minmax(0, 1fr))`,
                                gridTemplateRows: `repeat(${snapshotMode ? SNAPSHOT_GRID_ROWS : rows}, minmax(0, 1fr))`
                            }}
                        >
                            {stageTiles.map((tile) => (
                                <PerformanceControl key={tile.id} tile={tile} switchStyle={switchStyle} bypassed={bypassAll} />
                            ))}
                        </div>
                    )}
            </div>

            {toast && createPortal(
                <div
                    className="toast toast-ok"
                    role="status"
                    onClick={() => setToast("")}
                >
                    {toast}
                </div>,
                document.body
            )}

            {feedback && createPortal(
                <div className="mfx-theme-feedback performance-feedback" role="status">
                    <div>
                        <div className="performance-feedback-source">{feedback.source}</div>
                        <div className="performance-feedback-param">
                            {feedback.effect ? `${feedback.effect} · ${feedback.parameter}` : feedback.parameter}
                        </div>
                    </div>
                    <strong>{feedback.value}</strong>
                    <div className="performance-feedback-track">
                        <span style={{ width: `${Math.round(feedback.range * 100)}%` }} />
                    </div>
                </div>,
                document.body
            )}

            {presetDrag?.dragging && createPortal(
                <div
                    className="performance-drag-ghost"
                    style={{
                        left: presetDrag.x - presetDrag.offsetX,
                        top: presetDrag.y - presetDrag.offsetY,
                        width: presetDrag.width,
                        height: presetDrag.height
                    }}
                >
                    <div>{presetDrag.name}</div>
                    <small>MOVE PRESET</small>
                </div>,
                document.body
            )}

            {presetDrag?.dragging && createPortal(
                <div
                    data-mfx-performance-trash="true"
                    className={`performance-trash${dragOverTrash ? " active" : ""}`}
                >
                    🗑
                </div>,
                document.body
            )}

            {menu?.kind === "preset" && createPortal(
                <div className="mfx-overlay" onClick={closeMenu}>
                    <div className="mfx-overlay-card" onClick={(event) => event.stopPropagation()}>
                        <div className="mfx-overlay-title">PRESET SWITCH {menu.slotIndex + 1}</div>
                        {selectedPreset && (
                            <div className="row" style={{ marginBottom: 10 }}>
                                <input
                                    className="input"
                                    value={renameValue}
                                    onChange={(event) => setRenameValue(event.target.value)}
                                />
                                <button type="button" className="btn" onClick={renameMenuPreset}>RENAME</button>
                            </div>
                        )}
                        {presetOptions(menu).map((option) => (
                            <button
                                key={option}
                                type="button"
                                className="mfx-overlay-option"
                                onClick={() => runPresetOption(option, menu)}
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                </div>,
                document.body
            )}

            {menu?.kind === "assign" && createPortal(
                <div className="mfx-overlay" onClick={closeMenu}>
                    <div className="mfx-overlay-card" onClick={(event) => event.stopPropagation()}>
                        <div className="mfx-overlay-title">ASSIGN PRESET TO SWITCH</div>
                        {presets.map((item) => (
                            <button
                                key={str(item.id)}
                                type="button"
                                className={`mfx-overlay-option${str(item.id) === str(state.activePresetId) ? " selected" : ""}`}
                                onClick={() => assignPreset(str(item.id), menu.controlId)}
                            >
                                {str(item.name)}
                            </button>
                        ))}
                        {presets.length === 0 && <div className="muted">This bank has no presets yet.</div>}
                        <button type="button" className="mfx-overlay-option" onClick={closeMenu}>CANCEL</button>
                    </div>
                </div>,
                document.body
            )}

            {menu?.kind === "delete" && createPortal(
                <div className="mfx-overlay">
                    <div className="mfx-overlay-card">
                        <div className="mfx-overlay-title danger">DELETE PRESET?</div>
                        <div style={{ margin: "12px 0", fontWeight: 900 }}>{menu.name}</div>
                        <div className="row">
                            <button type="button" className="btn" onClick={closeMenu}>CANCEL</button>
                            <button type="button" className="btn btn-danger" onClick={() => deleteMenuPreset(menu)}>
                                DELETE PRESET
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {menu?.kind === "snapshot" && createPortal(
                <div className="mfx-overlay" onClick={closeMenu}>
                    <div className="mfx-overlay-card" onClick={(event) => event.stopPropagation()}>
                        <div className="mfx-overlay-title">SNAPSHOT {menu.index + 1}</div>
                        <button
                            type="button"
                            className="mfx-overlay-option"
                            onClick={() => {
                                closeMenu();
                                void run(() => client.request("snapshot/select", { snapshotId: menu.snapshotId }));
                            }}
                        >
                            RECALL SNAPSHOT
                        </button>
                        <button
                            type="button"
                            className="mfx-overlay-option"
                            onClick={() => {
                                closeMenu();
                                onEditSnapshot?.(menu.snapshotId);
                            }}
                        >
                            EDIT SNAPSHOT
                        </button>
                        <button
                            type="button"
                            className="mfx-overlay-option"
                            onClick={() => {
                                const current = snapshots.find((item) => str(item.id) === menu.snapshotId);
                                void askText("Snapshot name", str(obj(current).name, `Snap ${menu.index + 1}`)).then((name) => {
                                    if (name?.trim()) {
                                        closeMenu();
                                        void run(() => client.request("snapshot/rename", {
                                            snapshotId: menu.snapshotId,
                                            name: name.trim()
                                        })).then(() => showToast("SNAPSHOT RENAMED"));
                                    }
                                });
                            }}
                        >
                            RENAME
                        </button>
                        <button
                            type="button"
                            className="mfx-overlay-option danger"
                            onClick={() => {
                                closeMenu();
                                void run(() => client.request("snapshot/delete", { snapshotId: menu.snapshotId }))
                                    .then(() => showToast(`SNAPSHOT ${menu.index + 1} DELETED`));
                            }}
                        >
                            DELETE SNAPSHOT
                        </button>
                        <button type="button" className="mfx-overlay-option" onClick={closeMenu}>CANCEL</button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}

function NamePicker({
    variant,
    label,
    value,
    open,
    onToggle,
    options,
    onPick
}: {
    variant: "freeform" | "grid-bank" | "grid-preset";
    label: string;
    value: string;
    open: boolean;
    onToggle: () => void;
    options: { id: string; name: string; selected: boolean }[];
    onPick: (id: string) => void;
}) {
    const menu = open && (
        <div className="identity-menu">
            {options.map((item) => (
                <button
                    key={item.id}
                    type="button"
                    className={`mfx-overlay-option${item.selected ? " selected" : ""}`}
                    onClick={() => onPick(item.id)}
                >
                    {item.name}
                </button>
            ))}
        </div>
    );

    if (variant === "grid-preset") {
        return (
            <div className="identity-select performance-preset-inline">
                <span className="mfx-performance-ui-label">Active Preset:</span>
                <button type="button" className="identity-value mfx-performance-ui-value" onClick={onToggle}>
                    {value}
                </button>
                {menu}
            </div>
        );
    }

    return (
        <div className={`identity-select${variant === "freeform" ? " performance-picker-freeform" : ""}`}>
            <div className="field-label mfx-performance-ui-label">{variant === "grid-bank" ? "Current Bank" : label}</div>
            <button type="button" className="identity-value mfx-performance-ui-value" onClick={onToggle}>
                {value}
            </button>
            {menu}
        </div>
    );
}

function widgetText(id: string, values: Record<string, string>): string {
    switch (id) {
        case "currentBank": return values.bank;
        case "activePreset": return values.preset;
        case "cpuUsage": return values.dsp;
        case "xruns": return values.xruns;
        case "audioStatus": return values.audio;
        case "chainBypassStatus": return values.bypass;
        case "snapshotModeStatus": return values.snaps;
        case "tuner": return values.tuner;
        default: return "—";
    }
}

function rectStyle(rect: { x: number; y: number; width: number; height: number }): CSSProperties {
    return {
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.width * 100}%`,
        height: `${rect.height * 100}%`
    };
}

function signatureForChain(chain: JsonObject[]): string {
    return JSON.stringify(chain.map((slot) => ({
        id: str(slot.id),
        uri: str(slot.uri),
        enabled: bool(slot.enabled, true),
        name: str(slot.name),
        controls: obj(obj(slot.state).controls),
        properties: obj(obj(slot.state).properties)
    })));
}

function readPresetBaseline(): { id: string; signature: string } {
    try {
        const parsed = JSON.parse(sessionStorage.getItem(PRESET_BASELINE_KEY) || "{}") as JsonObject;
        return { id: str(parsed.id), signature: str(parsed.signature) };
    } catch {
        return { id: "", signature: "" };
    }
}

function rememberPresetBaseline(presetId: string, signature: string, force = false) {
    if (!presetId || !signature) {
        return;
    }
    const stored = readPresetBaseline();
    if (!force && stored.id === presetId && stored.signature) {
        return;
    }
    sessionStorage.setItem(PRESET_BASELINE_KEY, JSON.stringify({ id: presetId, signature }));
}

function isPresetModified(presetId: string, signature: string): boolean {
    const stored = readPresetBaseline();
    if (!stored.id || stored.id !== presetId || !stored.signature) {
        return false;
    }
    return stored.signature !== signature;
}
