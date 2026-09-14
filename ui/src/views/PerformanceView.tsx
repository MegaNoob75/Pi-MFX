import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { findBank, findPreset, isAnalogKind, isEncoderKind, isEncoderPushKind, isLatchingKind, normalizeControlKind, useMeters, type EngineSnapshot } from "../api";
import { bool, num, obj, str, objects, type JsonObject } from "../json";
import { askText } from "../keyboard/ask";
import { loadUiBehavior } from "../uiBehavior";
import { hardwareNavBlocksPerformance } from "../hardwareNav";
import {
    buildPerformanceCatalog,
    catalogIndexOf,
    parsePerformanceEncoderMode,
    performanceEncoderFeedback,
    wrapIndex,
    type PerformanceCatalogEntry
} from "../performanceBrowse";
import { NewPresetDialog } from "./NewPresetDialog";
import {
    STATUS_WIDGET_IDS,
    STATUS_WIDGET_LABELS,
    analogMinSize,
    clampRect,
    gridCellRect,
    isMeterWidget,
    readSnapshotWidgets,
    readStatusWidgets,
    snapshotAtSlot,
    unplacedIds
} from "../layout";
import { GainMeter } from "./GainMeter";
import {
    analogFeedback,
    PerformanceControl,
    type AnalogFeedback,
    type LightState,
    type PerformanceTile,
    type SwitchRole
} from "./PerformanceControl";

const PRESET_DRAG_THRESHOLD = 48;
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
    const { client, state } = engine;
    const bank = findBank(state);
    const preset = findPreset(state);
    const banks = objects(state.banks);
    const ui = obj(state.ui);
    const controller = obj(state.controller);
    const layout = obj(controller.performanceLayout);
    const widgets = readStatusWidgets(layout);
    const controls = objects(controller.controls);
    const presets = objects(obj(bank).presets);
    const snapshots = objects(obj(preset).snapshots);
    const snapshotWidgets = readSnapshotWidgets(layout);
    const rows = Math.max(1, num(controller.gridRows, 2));
    const columns = Math.max(1, num(controller.gridColumns, 4));
    const switchCount = Math.max(1, num(ui.virtualSwitchCount, 8));
    const bypassAll = bool(state.bypassAll);
    const snapshotMode = bool(state.snapshotMode);
    const useFreeform = true;
    const mirror = bool(controller.mirrorLayoutOnScreen, true);
    const switchStyle = document.documentElement.dataset.mfxSwitchStyle || "tiles";
    const activeSnapshot = num(obj(preset).activeSnapshot, -1);
    const snapshotWriteBlocked = snapshotMode || activeSnapshot >= 0;
    const feedbackOn = loadUiBehavior().parameterFeedback;

    const positions = obj(state.controlPositions);
    const chain = objects(state.chain);
    const parameterBindings = objects(obj(preset).parameterBindings);
    const [bankMenuOpen, setBankMenuOpen] = useState(false);
    const [presetMenuOpen, setPresetMenuOpen] = useState(false);
    const [menu, setMenu] = useState<TileMenu | null>(null);
    const [newPreset, setNewPreset] = useState<{ controlId: string; canAssign: boolean } | null>(null);
    const [pendingSnapshotDelete, setPendingSnapshotDelete] = useState<{ id: string; index: number; name: string } | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [toast, setToast] = useState("");
    const [pressedId, setPressedId] = useState("");
    const [presetDrag, setPresetDrag] = useState<PresetDrag | null>(null);
    const [dropTargetId, setDropTargetId] = useState("");
    const [dragOverTrash, setDragOverTrash] = useState(false);
    const [feedback, setFeedback] = useState<AnalogFeedback | null>(null);
    const [browseIndex, setBrowseIndex] = useState(0);
    const dragRef = useRef<PresetDrag | null>(null);
    const toastTimer = useRef<number | null>(null);
    const feedbackTimer = useRef<number | null>(null);
    const rememberedToastRef = useRef({ ready: false, presetId: "", enabled: false, reloadCount: 0 });
    const bypassToastRef = useRef({ ready: false, bypass: false, reloadCount: 0 });
    const reloadToastRef = useRef({ ready: false, count: 0 });
    const menuArmCleanup = useRef<(() => void) | null>(null);
    const [menuLive, setMenuLive] = useState(false);
    const positionsRef = useRef<Record<string, number>>({});
    const physicalPopoutReady = useRef(false);
    const physicalPopoutTimer = useRef<number | null>(null);
    const [hardwarePopoutId, setHardwarePopoutId] = useState("");
    const encoderDrivingRef = useRef(false);
    const encoderDriveTimer = useRef<number | null>(null);
    const screenEncoderStepRef = useRef<(delta: number) => void>(() => undefined);
    const screenEncoderSelectRef = useRef<() => void>(() => undefined);
    const browseNavRef = useRef({
        catalog: [] as PerformanceCatalogEntry[],
        browseIndex: 0,
        encoderMode: "browse" as ReturnType<typeof parsePerformanceEncoderMode>,
        blocked: false
    });
    const chainSignature = useMemo(() => signatureForChain(chain), [chain]);
    const sharedPicker = str(engine.uiSession.performancePicker);
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
        if (physicalPopoutTimer.current !== null) {
            window.clearTimeout(physicalPopoutTimer.current);
        }
        if (encoderDriveTimer.current !== null) {
            window.clearTimeout(encoderDriveTimer.current);
        }
        menuArmCleanup.current?.();
    }, []);

    useEffect(() => {
        const next: Record<string, number> = {};
        for (const [id, value] of Object.entries(positions)) {
            next[id] = num(value);
        }
        const previous = positionsRef.current;
        const moved = Object.keys(next).filter((id) => {
            const before = previous[id];
            if (before === undefined) {
                return false;
            }
            return Math.abs(next[id] - before) > 0.012;
        });
        positionsRef.current = next;
        if (!physicalPopoutReady.current) {
            physicalPopoutReady.current = true;
            return;
        }
        if (moved.length !== 1 || !loadUiBehavior().physicalControlPopout) {
            return;
        }
        const controlId = moved[0];
        const control = controls.find((item) => str(item.id) === controlId);
        if (!control || !isAnalogKind(normalizeControlKind(str(control.kind, "momentary")))) {
            return;
        }
        setHardwarePopoutId(controlId);
        if (physicalPopoutTimer.current !== null) {
            window.clearTimeout(physicalPopoutTimer.current);
        }
        physicalPopoutTimer.current = window.setTimeout(() => {
            physicalPopoutTimer.current = null;
            setHardwarePopoutId("");
        }, loadUiBehavior().controlPopoutDurationMs);
    }, [positions, controls]);

    useEffect(() => {
        physicalPopoutReady.current = false;
    }, [state.activePresetId]);

    const rememberedEnabled = bool(obj(preset).rememberedSnapshotEnabled);
    const rememberedSlot = num(obj(preset).rememberedSnapshotSlot, -1);
    const reloadCount = num(state.presetReloadCount);
    useEffect(() => {
        const presetId = str(state.activePresetId);
        const previous = rememberedToastRef.current;
        if (!previous.ready) {
            rememberedToastRef.current = { ready: true, presetId, enabled: rememberedEnabled, reloadCount };
            return;
        }
        const reloaded = reloadCount !== previous.reloadCount;
        if (!snapshotMode && presetId === previous.presetId && rememberedEnabled !== previous.enabled && !reloaded) {
            if (!rememberedEnabled) {
                showToast("SNAPSHOT INACTIVE");
            } else {
                const snap = snapshotAtSlot(snapshots, rememberedSlot);
                showToast(`${str(obj(snap).name, `SNAPSHOT ${Math.max(0, rememberedSlot) + 1}`)} ACTIVE`);
            }
        }
        rememberedToastRef.current = { ready: true, presetId, enabled: rememberedEnabled, reloadCount };
    }, [rememberedEnabled, rememberedSlot, snapshotMode, snapshots, state.activePresetId, reloadCount]);

    useEffect(() => {
        const previous = bypassToastRef.current;
        if (!previous.ready) {
            bypassToastRef.current = { ready: true, bypass: bypassAll, reloadCount };
            return;
        }
        if (previous.bypass !== bypassAll && reloadCount === previous.reloadCount) {
            showToast(bypassAll ? "CHAIN BYPASS" : "CHAIN ACTIVE");
        }
        bypassToastRef.current = { ready: true, bypass: bypassAll, reloadCount };
    }, [bypassAll, reloadCount]);

    useEffect(() => {
        const previous = reloadToastRef.current;
        if (!previous.ready) {
            reloadToastRef.current = { ready: true, count: reloadCount };
            return;
        }
        if (reloadCount !== previous.count) {
            showToast("PRESET RELOADED");
            rememberPresetBaseline(str(state.activePresetId), chainSignature, true);
        }
        reloadToastRef.current = { ready: true, count: reloadCount };
    }, [reloadCount, chainSignature, state.activePresetId]);

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

    const fireControl = (id: string, fire: "tap" | "hold" | "double") => {
        void client.request("controller/press", { controlId: id, fire }).catch(() => undefined);
    };

    const closeMenu = () => {
        menuArmCleanup.current?.();
        menuArmCleanup.current = null;
        setMenuLive(false);
        setMenu(null);
    };

    const armMenuUntilIdle = () => {
        menuArmCleanup.current?.();
        setMenuLive(false);
        const swallow = (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
        };
        window.addEventListener("pointerup", swallow, true);
        window.addEventListener("pointercancel", swallow, true);
        window.addEventListener("click", swallow, true);
        const timer = window.setTimeout(() => {
            window.removeEventListener("pointerup", swallow, true);
            window.removeEventListener("pointercancel", swallow, true);
            window.removeEventListener("click", swallow, true);
            menuArmCleanup.current = null;
            setMenuLive(true);
        }, 400);
        menuArmCleanup.current = () => {
            window.clearTimeout(timer);
            window.removeEventListener("pointerup", swallow, true);
            window.removeEventListener("pointercancel", swallow, true);
            window.removeEventListener("click", swallow, true);
        };
    };

    const openPresetMenu = (controlId: string, slotIndex: number, presetId: string, canAssign: boolean) => {
        const item = presets.find((entry) => str(entry.id) === presetId);
        armMenuUntilIdle();
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
        if (action === "snapshotMode" || action === "selectSnapshot") {
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
        if (action === "selectSnapshot") {
            return "SNAPSHOT";
        }
        if (action === "reloadPreset") {
            return "RELOAD PRESET";
        }
        if (action === "tapTempo") {
            return `${num(state.tempo, num(obj(preset).tempo, 120)).toFixed(1)} BPM`;
        }
        return action.toUpperCase();
    };

    const actionLabelFor = (actionName: string) => {
        if (!actionName || actionName === "none") {
            return undefined;
        }
        const labels: Record<string, string> = {
            bankUp: "BANK UP",
            bankDown: "BANK DOWN",
            bypassAll: "CHAIN BYPASS",
            snapshotMode: "SNAPSHOT MODE",
            selectPreset: "PRESET",
            selectSnapshot: "SNAPSHOT",
            reloadPreset: "RELOAD PRESET",
            presetUp: "PRESET UP",
            presetDown: "PRESET DOWN",
            tapTempo: "TAP TEMPO",
            tuner: "TUNER",
            navigate: "NAVIGATE",
            select: "SELECT"
        };
        return labels[actionName]
            ?? formatMenuLabel(actionName).toUpperCase();
    };

    const lightForPreset = (isActive: boolean): LightState => {
        if (!isActive) {
            return "inactive";
        }
        if (bypassAll) {
            return "bypass";
        }
        if (rememberedEnabled || snapshotMode) {
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
            dragging: false
        };
        dragRef.current = candidate;
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // optional
        }
    };

    const movePresetDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const candidate = dragRef.current;
        if (!candidate || candidate.pointerId !== event.pointerId) {
            return;
        }
        const travel = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
        if (!candidate.dragging && travel >= PRESET_DRAG_THRESHOLD) {
            candidate.dragging = true;
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

    const endPresetDrag = (event: ReactPointerEvent<HTMLButtonElement>): boolean => {
        const candidate = dragRef.current;
        if (!candidate || candidate.pointerId !== event.pointerId) {
            return false;
        }
        const wasDragging = candidate.dragging;
        const overTrash = wasDragging && isTrashAtPoint(event.clientX, event.clientY);
        const dropIndex = overTrash ? "" : dropTargetAtPoint(event.clientX, event.clientY);
        dragRef.current = null;
        setPresetDrag(null);
        setDropTargetId("");
        setDragOverTrash(false);
        setPressedId("");
        if (wasDragging) {
            event.preventDefault();
            if (overTrash) {
                clearAssignment(candidate.controlId);
                return true;
            }
            const target = dropIndex === "" ? undefined : visibleControls[Number(dropIndex)];
            const targetId = str(obj(target).id);
            if (targetId && targetId !== candidate.controlId) {
                swapAssignments(candidate.controlId, targetId);
            }
            return true;
        }
        return false;
    };

    const abortPresetDrag = () => {
        const candidate = dragRef.current;
        if (!candidate) {
            return;
        }
        dragRef.current = null;
        setPresetDrag(null);
        setDropTargetId("");
        setDragOverTrash(false);
        setPressedId("");
    };

    useEffect(() => {
        abortPresetDrag();
    }, [snapshotMode]);

    const visibleControls = useMemo(() => {
        const hiddenIds = new Set(unplacedIds(layout));
        return objects(controller.controls).filter((control) => {
            const id = str(control.id);
            if (hiddenIds.has(id)) {
                return false;
            }
            return !isEncoderPushKind(normalizeControlKind(str(control.kind, "momentary")));
        });
    }, [controller.controls, layout]);
    const useConfigured = visibleControls.length > 0 && (mirror || controls.length > 0);
    const encoderMode = parsePerformanceEncoderMode(str(ui.performanceEncoder, "browse"));

    const catalog = useMemo(() => buildPerformanceCatalog(banks), [banks]);
    const navigationFeedback = performanceEncoderFeedback(
        catalog, browseIndex, encoderMode, str(state.activeBankId), str(state.activePresetId)
    );
    const catalogSig = catalog.map((entry) => `${entry.bankId}:${entry.presetId}`).join("|");
    const sessionPayload = useMemo(() => {
        if (encoderMode !== "session" || snapshotMode || !useConfigured || catalog.length === 0) {
            return { enabled: false, assignments: [] as { controlId: string; bankId: string; presetId: string }[] };
        }
        let slot = 0;
        const assignments: { controlId: string; bankId: string; presetId: string }[] = [];
        for (const control of visibleControls) {
            const kind = normalizeControlKind(str(control.kind, "momentary"));
            const analog = isAnalogKind(kind);
            const encoder = isEncoderKind(kind);
            const action = str(obj(control.binding).action, "selectPreset");
            const canAssign = !analog && !encoder && (action === "selectPreset" || action === "none" || action === "");
            if (!canAssign) {
                continue;
            }
            const entry = catalog[wrapIndex(browseIndex + slot, catalog.length)];
            slot += 1;
            if (entry) {
                assignments.push({
                    controlId: str(control.id),
                    bankId: entry.bankId,
                    presetId: entry.presetId
                });
            }
        }
        return { enabled: true, assignments };
    }, [encoderMode, snapshotMode, useConfigured, catalog, visibleControls, browseIndex]);

    const tiles: PerformanceTile[] = snapshotMode
        ? snapshotWidgets.map((widget) => {
            const snapshot = snapshotAtSlot(snapshots, widget.slot);
            const empty = !snapshot;
            return {
                id: snapshot ? str(snapshot.id) : `empty-snap-${widget.slot}`,
                switchLabel: `SNAPSHOT ${widget.slot + 1}`,
                valueText: empty ? "EMPTY" : str(snapshot.name, `Snapshot ${widget.slot + 1}`),
                empty: false,
                role: "snapshot" as const,
                lightState: (!empty && activeSnapshot === widget.slot ? "snapshot" : "inactive") as LightState,
                active: !empty && activeSnapshot === widget.slot,
                rect: widget.rect,
                freeform: true,
                onPress: () => {
                    if (empty) {
                        showToast(`SNAPSHOT ${widget.slot + 1} IS EMPTY — HOLD TO CREATE`);
                        return;
                    }
                    const clearing = activeSnapshot === widget.slot;
                    void run(() => client.request("snapshot/select", { snapshotId: str(snapshot.id) }))
                        .then(() => showToast(clearing
                            ? "SNAPSHOT INACTIVE"
                            : `${str(snapshot.name, `SNAPSHOT ${widget.slot + 1}`)} ACTIVE`));
                },
                onLongPress: () => {
                    if (empty) {
                        void run(async () => {
                            const result = await client.request("snapshot/capture", {
                                name: `Snapshot ${widget.slot + 1}`,
                                slot: widget.slot
                            });
                            const snapshotId = str(result.snapshotId);
                            if (snapshotId) {
                                onEditSnapshot?.(snapshotId);
                            }
                        });
                        return;
                    }
                    setMenu({ kind: "snapshot", snapshotId: str(snapshot.id), index: widget.slot });
                }
            };
        })
        : useConfigured
            ? (() => {
                let nextPresetSlot = 0;
                const pending = catalog[browseIndex];
                return visibleControls.map((control, index) => {
                const binding = obj(control.binding);
                const controlId = str(control.id);
                const assignedPreset = assigned(controlId);
                const action = str(binding.action, "selectPreset");
                const kind = normalizeControlKind(str(control.kind, "momentary"));
                const analog = isAnalogKind(kind);
                const encoder = kind === "encoder";
                const latching = isLatchingKind(kind);
                const holdAction = str(binding.holdAction);
                const doubleAction = str(binding.doubleAction);
                const hasHoldAction = Boolean(holdAction && holdAction !== "none");
                const hasDoubleAction = Boolean(doubleAction && doubleAction !== "none");
                const canAssign = !analog && !encoder && (action === "selectPreset" || action === "none" || action === "");
                const presetId = assignedPreset || str(binding.presetId);
                const presetSlotIndex = canAssign ? nextPresetSlot++ : undefined;
                const sessionEntry = encoderMode === "session" && presetSlotIndex != null && catalog.length > 0
                    ? catalog[wrapIndex(browseIndex + presetSlotIndex, catalog.length)]
                    : undefined;
                const displayPresetId = sessionEntry?.presetId || presetId;
                const displayBankId = sessionEntry?.bankId || str(obj(bank).id);
                const presetItem = presets.find((entry) => str(entry.id) === displayPresetId)
                    || objects(obj(banks.find((item) => str(item.id) === displayBankId)).presets)
                        .find((entry) => str(entry.id) === displayPresetId);
                const minSize = analogMinSize(kind);
                const empty = canAssign && !displayPresetId;
                const presetBind = parameterBindings.find((item) => str(item.controlId) === controlId);
                const analogInfo = analog || encoder ? analogFeedback(control, chain, presetBind) : null;
                const analogAssigned = analog || (encoder && analogInfo?.parameter !== "UNASSIGNED");
                const navigationEncoder = encoder && !analogAssigned && action === "navigate";
                const toggleSlot = str(obj(presetBind).action) === "toggleEffect"
                    ? str(presetBind?.slotId)
                    : (action === "toggleEffect" ? str(binding.slotId) : "");
                const active = (displayPresetId === str(state.activePresetId)
                    && (!sessionEntry || displayBankId === str(state.activeBankId)))
                    || (action === "bypassAll" && bypassAll)
                    || (action === "snapshotMode" && snapshotMode)
                    || (action === "tapTempo" && bool(engine.transport.beatPulse))
                    || (action === "selectSnapshot" && activeSnapshot === num(binding.snapshotSlot, -1)
                        && num(binding.snapshotSlot, -1) >= 0)
                    || (toggleSlot !== "" && bool(
                        obj(chain.find((slot) => str(slot.id) === toggleSlot)).enabled,
                        true
                    ));
                const slotIndex = index;
                const pairId = str(control.pairId);
                const pushPressed = encoder && (
                    pressedId === pairId
                    || (pairId !== "" && num(positions[pairId]) >= 0.5)
                );
                const encoderSelected = encoderMode === "session"
                    ? canAssign && presetSlotIndex === 0
                    : Boolean(canAssign && pending
                        && displayPresetId === pending.presetId
                        && displayBankId === pending.bankId);
                return {
                    id: controlId,
                    switchLabel: str(control.label, controlId),
                    valueText: analogAssigned
                        ? analogInfo?.value || ""
                        : valueForAction(action, sessionEntry?.presetName || str(obj(presetItem).name), empty),
                    holdLabel: analog || encoder || latching ? undefined : actionLabelFor(holdAction),
                    doubleLabel: analog || encoder || latching ? undefined : actionLabelFor(doubleAction),
                    empty,
                    role: analog || encoder ? "utility" : roleForAction(action),
                    lightState: action === "selectPreset" || sessionEntry
                        ? lightForPreset(Boolean(active && displayPresetId === str(state.activePresetId)))
                        : (active ? "active" : "inactive"),
                    active,
                    analog: analogAssigned,
                    analogSource: analogInfo?.source,
                    analogFunction: navigationEncoder
                        ? navigationFeedback.target
                        : analogAssigned && analogInfo
                        ? (analogInfo.effect ? `${analogInfo.effect} · ${analogInfo.parameter}` : analogInfo.parameter)
                        : (encoder ? actionLabelFor(action) : undefined),
                    analogValue: navigationEncoder ? navigationFeedback.position : analogInfo?.value,
                    assigned: analogAssigned ? analogInfo?.parameter !== "UNASSIGNED" : undefined,
                    kind,
                    value: navigationEncoder
                        ? navigationFeedback.range
                        : analogAssigned
                        ? analogInfo?.range ?? 0
                        : encoder
                            ? num(positions[controlId], 0.5)
                            : num(positions[controlId], active ? 1 : 0),
                    presetSlotIndex,
                    dropTarget: dropTargetId === String(slotIndex),
                    dragging: presetDrag?.controlId === controlId && presetDrag.dragging,
                    pressed: encoder ? pushPressed : pressedId === controlId,
                    encoderSelected,
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
                        if (encoder) {
                            if (navigationEncoder) screenEncoderSelectRef.current();
                            else if (pairId) fireControl(pairId, "tap");
                            return;
                        }
                        if (empty) {
                            openPresetMenu(controlId, slotIndex, "", true);
                            return;
                        }
                        if (analogAssigned) {
                            return;
                        }
                        if (sessionEntry) {
                            void run(() => client.request("preset/select", {
                                bankId: sessionEntry.bankId,
                                presetId: sessionEntry.presetId
                            }));
                            return;
                        }
                        fireControl(controlId, "tap");
                    },
                    onValue: analogAssigned
                        ? (value: number) => {
                            void client.request("controller/value", { controlId, value }).catch(() => undefined);
                        }
                        : undefined,
                    onStep: encoder
                        ? (delta: number) => {
                            if (navigationEncoder) {
                                screenEncoderStepRef.current(delta);
                            } else {
                                void client.request("controller/turn", { controlId, delta }).catch(() => undefined);
                            }
                        }
                        : undefined,
                    onLongPress: analog || encoder || !hasHoldAction
                        ? undefined
                        : () => {
                            abortPresetDrag();
                            fireControl(controlId, "hold");
                        },
                    onMenu: canAssign
                        ? () => openPresetMenu(controlId, slotIndex, displayPresetId, true)
                        : undefined,
                    onDoublePress: analog || encoder || latching || !hasDoubleAction
                        ? undefined
                        : () => {
                            abortPresetDrag();
                            fireControl(controlId, "double");
                        },
                    onCancelPress: canAssign ? abortPresetDrag : undefined,
                    onFeedback: analogAssigned && feedbackOn ? showFeedback : undefined,
                    onPresetPointerDown: canAssign && displayPresetId && encoderMode !== "session"
                        ? (event) => {
                            setPressedId(controlId);
                            beginPresetDrag(
                                event,
                                controlId,
                                slotIndex,
                                str(obj(presetItem).name, "Preset")
                            );
                        }
                        : undefined,
                    onPresetPointerMove: canAssign && displayPresetId && encoderMode !== "session" ? movePresetDrag : undefined,
                    onPresetPointerUp: canAssign && displayPresetId && encoderMode !== "session"
                        ? (event) => endPresetDrag(event)
                        : undefined,
                    hardwarePopout: analog && hardwarePopoutId === controlId
                };
                });
            })()
            : Array.from({ length: Math.min(switchCount, rows * columns) }, (_, index) => {
                const pending = catalog[browseIndex];
                const sessionEntry = encoderMode === "session" && catalog.length > 0
                    ? catalog[wrapIndex(browseIndex + index, catalog.length)]
                    : undefined;
                const item = sessionEntry ? undefined : presets[index];
                const presetId = sessionEntry?.presetId || (item ? str(item.id) : "");
                const presetName = sessionEntry?.presetName || (item ? str(item.name) : "");
                const empty = !presetId;
                const bankId = sessionEntry?.bankId || str(obj(bank).id);
                return {
                    id: presetId || `empty-${index}`,
                    switchLabel: `SW ${index + 1}`,
                    valueText: empty ? "+" : presetName,
                    empty,
                    role: "preset" as const,
                    lightState: lightForPreset(!empty && presetId === str(state.activePresetId) && bankId === str(state.activeBankId)),
                    active: !!(!empty && presetId === str(state.activePresetId) && bankId === str(state.activeBankId)),
                    encoderSelected: encoderMode === "session"
                        ? index === 0
                        : Boolean(pending && presetId === pending.presetId && bankId === pending.bankId),
                    presetSlotIndex: index,
                    rect: gridCellRect(index, columns, rows),
                    onPress: () => {
                        if (presetId) {
                            void run(() => client.request("preset/select", {
                                bankId,
                                presetId
                            }));
                        }
                    },
                    onMenu: () => openPresetMenu(presetId || `empty-${index}`, index, presetId, false)
                };
            });

    const stageTiles = tiles;

    const presetOptions = (current: PresetMenu) => {
        if (!current.presetId) {
            return current.canAssign
                ? ["Assign Preset to This Switch", "Create New Preset", "Cancel"]
                : ["Create New Preset", "Cancel"];
        }
        const options = ["Load Preset", "Edit Preset"];
        if (current.presetId === str(state.activePresetId) && !snapshotWriteBlocked && presetModified) {
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
                if (bool(ui.confirmPresetOverwrite, true)
                    && !window.confirm(`Overwrite saved preset “${str(obj(preset).name, "this preset")}”?`)) {
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
                setNewPreset({ controlId: current.controlId, canAssign: current.canAssign });
                closeMenu();
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
    const appliedSnapshot = activeSnapshot >= 0 ? snapshotAtSlot(snapshots, activeSnapshot) : undefined;
    const snapshotStatus = activeSnapshot >= 0
        ? `${str(obj(appliedSnapshot).name, `SNAPSHOT ${activeSnapshot + 1}`)} · ACTIVE`
        : snapshotMode
            ? "SELECT SNAPSHOT"
            : "BASE PRESET";

    const widgetValues = {
        bank: str(obj(bank).name, "—"),
        preset: str(obj(preset).name, "—"),
        bypass: bypassAll ? "ON" : "OFF",
        snaps: snapshotStatus
    };

    const selectBankId = (id: string) => {
        setBankMenuOpen(false);
        client.updateUiSession({ performancePicker: "" });
        const item = banks.find((entry) => str(entry.id) === id);
        if (!objects(obj(item).presets).length) {
            showToast(`“${str(obj(item).name, "This bank")}” has no presets`);
            return;
        }
        void run(() => client.request("bank/select", { bankId: id }));
    };

    const selectPresetId = (id: string) => {
        setPresetMenuOpen(false);
        client.updateUiSession({ performancePicker: "" });
        void run(() => client.request("preset/select", {
            bankId: str(obj(bank).id),
            presetId: id
        }));
    };

    const pending = snapshotMode ? undefined : catalog[browseIndex];
    const previewNav = Boolean(pending && encoderMode !== "live"
        && (pending.presetId !== str(state.activePresetId) || pending.bankId !== str(state.activeBankId)));

    const bankPicker = (
        <NamePicker
            variant={useFreeform ? "freeform" : "grid-bank"}
            label="CURRENT BANK"
            preview={!bankMenuOpen && previewNav}
            value={`${!bankMenuOpen && previewNav && pending
                ? pending.bankName
                : str(obj(bank).name, "No Bank")} \u25BE`}
            open={bankMenuOpen}
            onToggle={() => {
                const next = bankMenuOpen ? "" : "bank";
                setPresetMenuOpen(false);
                setBankMenuOpen(next === "bank");
                client.updateUiSession({ performancePicker: next });
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
            preview={!presetMenuOpen && previewNav}
            value={`${!presetMenuOpen && previewNav && pending
                ? pending.presetName
                : str(obj(preset).name, "No Preset")} \u25BE`}
            open={presetMenuOpen}
            onToggle={() => {
                const next = presetMenuOpen ? "" : "preset";
                setBankMenuOpen(false);
                setPresetMenuOpen(next === "preset");
                client.updateUiSession({ performancePicker: next });
            }}
            options={presets.map((item) => ({
                id: str(item.id),
                name: str(item.name),
                selected: str(item.id) === str(state.activePresetId)
            }))}
            onPick={selectPresetId}
        />
    );

    useEffect(() => {
        const bankOpen = sharedPicker === "bank";
        const presetOpen = sharedPicker === "preset";
        if (bankOpen !== bankMenuOpen) setBankMenuOpen(bankOpen);
        if (presetOpen !== presetMenuOpen) setPresetMenuOpen(presetOpen);
    }, [sharedPicker]);

    useEffect(() => {
        if (!bankMenuOpen && !presetMenuOpen) {
            return;
        }
        const releasePickerFocus = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".identity-select")) {
                return;
            }
            setBankMenuOpen(false);
            setPresetMenuOpen(false);
            client.updateUiSession({ performancePicker: "" });
        };
        document.addEventListener("pointerdown", releasePickerFocus, true);
        return () => document.removeEventListener("pointerdown", releasePickerFocus, true);
    }, [bankMenuOpen, presetMenuOpen, client]);

    browseNavRef.current = {
        catalog,
        browseIndex,
        encoderMode,
        blocked: Boolean(menu || bankMenuOpen || presetMenuOpen || snapshotMode)
    };

    useEffect(() => {
        if ((encoderDrivingRef.current && encoderMode === "live") || catalog.length === 0) {
            return;
        }
        setBrowseIndex(catalogIndexOf(catalog, str(state.activeBankId), str(state.activePresetId)));
    }, [state.activeBankId, state.activePresetId, catalogSig, encoderMode]);

    useEffect(() => {
        const markDriving = () => {
            encoderDrivingRef.current = true;
            if (encoderDriveTimer.current !== null) {
                window.clearTimeout(encoderDriveTimer.current);
            }
            encoderDriveTimer.current = window.setTimeout(() => {
                encoderDriveTimer.current = null;
                encoderDrivingRef.current = false;
            }, 800);
        };
        const stepBrowse = (delta: number) => {
            const current = browseNavRef.current;
            if (current.blocked || current.catalog.length === 0) {
                return;
            }
            markDriving();
            setBrowseIndex((index) => {
                const next = wrapIndex(index + delta, current.catalog.length);
                const entry = current.catalog[next];
                if (current.encoderMode === "live" && entry) {
                    void run(() => client.request("preset/select", {
                        bankId: entry.bankId,
                        presetId: entry.presetId
                    }));
                }
                client.updateUiSession({ performanceBrowseIndex: next });
                return next;
            });
        };
        const confirmBrowse = () => {
            const current = browseNavRef.current;
            if (current.blocked || current.catalog.length === 0) {
                return;
            }
            const entry = current.catalog[current.browseIndex];
            if (!entry) {
                return;
            }
            markDriving();
            void run(() => client.request("preset/select", {
                bankId: entry.bankId,
                presetId: entry.presetId
            }));
        };
        screenEncoderStepRef.current = stepBrowse;
        screenEncoderSelectRef.current = confirmBrowse;
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
                return;
            }
            if (hardwareNavBlocksPerformance() || browseNavRef.current.blocked) {
                return;
            }
            if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
                return;
            }
            event.preventDefault();
            if (event.key === "Escape") {
                setBrowseIndex(catalogIndexOf(
                    browseNavRef.current.catalog,
                    str(state.activeBankId),
                    str(state.activePresetId)
                ));
                return;
            }
            if (event.key === "Enter" && !event.repeat) {
                confirmBrowse();
                return;
            }
            stepBrowse(event.key === "ArrowDown" ? 1 : -1);
        };
        window.addEventListener("keydown", onKey, true);
        const unsubscribe = client.subscribeUiNav((message) => {
            if (hardwareNavBlocksPerformance() || browseNavRef.current.blocked) {
                return;
            }
            if (bool(message.select)) {
                confirmBrowse();
                return true;
            }
            const delta = Math.trunc(num(message.delta));
            if (delta !== 0) {
                stepBrowse(delta > 0 ? 1 : -1);
            }
            return true;
        });
        return () => {
            window.removeEventListener("keydown", onKey, true);
            unsubscribe();
        };
    }, [client, run, state.activeBankId, state.activePresetId]);

    useEffect(() => {
        const sharedIndex = Math.trunc(num(engine.uiSession.performanceBrowseIndex, -1));
        if (sharedIndex >= 0 && catalog.length > 0) {
            setBrowseIndex(wrapIndex(sharedIndex, catalog.length));
        }
    }, [engine.uiSession.performanceBrowseIndex, catalogSig]);

    useEffect(() => {
        if (snapshotMode) {
            return;
        }
        void client.request("controller/sessionPresets", sessionPayload).catch(() => undefined);
    }, [client, snapshotMode, JSON.stringify(sessionPayload)]);

    return (
        <div className="performance">
            <div className="performance-stage freeform">
                {STATUS_WIDGET_IDS.filter((id) => widgets[id].visible).map((id) => {
                    const widget = widgets[id];
                    const pickerOpen = (id === "currentBank" && bankMenuOpen)
                        || (id === "activePreset" && presetMenuOpen);
                    return (
                        <div
                            key={id}
                            className={`status-widget${isMeterWidget(id) ? " is-meter" : ""}`}
                            style={{
                                ...rectStyle(widget.rect),
                                zIndex: pickerOpen ? 50 : undefined
                            }}
                        >
                            {id === "currentBank" ? bankPicker
                                : id === "activePreset" ? presetPicker
                                    : isMeterWidget(id) ? (
                                        <LiveGainMeter
                                            client={client}
                                            label={STATUS_WIDGET_LABELS[id]}
                                            channel={id === "inputMeter" ? "input" : "output"}
                                        />
                                    ) : isLiveMeterText(id) ? (
                                        <>
                                            {widget.showLabel && (
                                                <div className="field-label mfx-performance-ui-label">{STATUS_WIDGET_LABELS[id]}</div>
                                            )}
                                            <strong className="marquee mfx-performance-ui-value">
                                                <LiveMeterText
                                                    client={client}
                                                    id={id}
                                                    audioRunning={bool(state.audioRunning)}
                                                />
                                            </strong>
                                        </>
                                    ) : (
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

                {stageTiles.map((tile) => (
                    <div
                        key={tile.id}
                        className="freeform-slot"
                        style={tile.rect ? { ...rectStyle(tile.rect), zIndex: slotZIndex(tile) } : undefined}
                    >
                        <PerformanceControl tile={tile} switchStyle={switchStyle} bypassed={bypassAll} />
                    </div>
                ))}
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
                <div
                    className="mfx-overlay"
                    onPointerDown={(event) => {
                        if (event.target !== event.currentTarget) {
                            return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        if (menuLive) {
                            closeMenu();
                        }
                    }}
                    onClick={(event) => {
                        if (event.target !== event.currentTarget) {
                            return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        if (menuLive) {
                            closeMenu();
                        }
                    }}
                >
                    <div
                        className="mfx-overlay-card"
                        style={{ pointerEvents: menuLive ? "auto" : "none" }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                    >
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
                                disabled={!menuLive}
                                onClick={() => runPresetOption(option, menu)}
                            >
                                {formatMenuLabel(option)}
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
                                setPendingSnapshotDelete({
                                    id: menu.snapshotId,
                                    index: menu.index,
                                    name: str(obj(snapshots.find((item) => str(item.id) === menu.snapshotId)).name, `Snapshot ${menu.index + 1}`)
                                });
                                closeMenu();
                            }}
                        >
                            DELETE SNAPSHOT
                        </button>
                        <button type="button" className="mfx-overlay-option" onClick={closeMenu}>CANCEL</button>
                    </div>
                </div>,
                document.body
            )}
            {newPreset && (
                <NewPresetDialog
                    banks={banks}
                    defaultBankId={str(obj(bank).id)}
                    defaultName={str(obj(preset).name, "Preset")}
                    onCancel={() => setNewPreset(null)}
                    onCreate={(name, bankId) => {
                        const assignTo = newPreset;
                        setNewPreset(null);
                        void run(async () => {
                            const result = await client.request("preset/create", { name, bankId });
                            const newId = str(result.presetId, str(client.snapshot.state.activePresetId));
                            if (assignTo.canAssign && newId) {
                                await saveAssignments({ ...bankMap(), [assignTo.controlId]: newId });
                            }
                        });
                    }}
                />
            )}
            {pendingSnapshotDelete && createPortal(
                <div className="mfx-overlay">
                    <div className="mfx-overlay-card">
                        <div className="mfx-overlay-title danger">DELETE SNAPSHOT?</div>
                        <div style={{ margin: "12px 0", fontWeight: 900 }}>{pendingSnapshotDelete.name}</div>
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                            <button type="button" className="btn" onClick={() => setPendingSnapshotDelete(null)}>CANCEL</button>
                            <button type="button" className="btn btn-danger" onClick={() => {
                                const pending = pendingSnapshotDelete;
                                setPendingSnapshotDelete(null);
                                void run(() => client.request("snapshot/delete", { snapshotId: pending.id }))
                                    .then(() => showToast(`SNAPSHOT ${pending.index + 1} DELETED`));
                            }}>DELETE</button>
                        </div>
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
    preview,
    onToggle,
    options,
    onPick
}: {
    variant: "freeform" | "grid-bank" | "grid-preset";
    label: string;
    value: string;
    open: boolean;
    preview?: boolean;
    onToggle: () => void;
    options: { id: string; name: string; selected: boolean }[];
    onPick: (id: string) => void;
}) {
    const menu = open && (
        <div
            className="identity-menu"
            data-mfx-nav-list={variant === "grid-bank" || label === "CURRENT BANK"
                ? "performance-banks"
                : "performance-presets"}
        >
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
            <div className={`identity-select performance-preset-inline${preview ? " is-encoder-preview" : ""}`}>
                <span className="mfx-performance-ui-label">Active Preset:</span>
                <button type="button" className="identity-value mfx-performance-ui-value"
                    aria-expanded={open} onClick={onToggle}>
                    {value}
                </button>
                {menu}
            </div>
        );
    }

    return (
        <div className={`identity-select${variant === "freeform" ? " performance-picker-freeform" : ""}${preview ? " is-encoder-preview" : ""}`}>
            <div className="field-label mfx-performance-ui-label">{variant === "grid-bank" ? "Current Bank" : label}</div>
            <button type="button" className="identity-value mfx-performance-ui-value"
                aria-expanded={open} onClick={onToggle}>
                {value}
            </button>
            {menu}
        </div>
    );
}

function isLiveMeterText(id: string): boolean {
    return id === "cpuUsage" || id === "xruns" || id === "audioStatus" || id === "tuner";
}

function LiveGainMeter({
    client,
    label,
    channel
}: {
    client: import("../api").EngineClient;
    label: string;
    channel: "input" | "output";
}) {
    const meters = useMeters(client);
    return (
        <GainMeter
            label={label}
            peak={channel === "input" ? num(meters.inputPeak) : num(meters.outputPeak)}
        />
    );
}

function LiveMeterText({
    client,
    id,
    audioRunning
}: {
    client: import("../api").EngineClient;
    id: string;
    audioRunning: boolean;
}) {
    const meters = useMeters(client);
    const tuner = obj(meters.tuner);
    return widgetText(id, {
        dsp: `${(num(meters.dspLoad) * 100).toFixed(0)}%`,
        xruns: `${num(meters.xruns)}`,
        audio: bool(meters.running, audioRunning) ? "RUN" : "STOP",
        tuner: bool(tuner.valid)
            ? `${str(tuner.note)} ${num(tuner.cents) >= 0 ? "+" : ""}${num(tuner.cents).toFixed(0)}¢`
            : "—"
    });
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

function formatMenuLabel(label: string): string {
    return label
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function slotZIndex(tile: PerformanceTile): number {
    const x = tile.rect?.x ?? 0;
    if (tile.analog) {
        return 6;
    }
    return 14 + Math.round((1 - x) * 18);
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
