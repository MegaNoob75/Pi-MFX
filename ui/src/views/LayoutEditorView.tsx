import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { findPreset, isAnalogKind, isEncoderKind, isEncoderPushKind, normalizeControlKind, type EngineSnapshot } from "../api";
import { arr, bool, num, obj, str, objects, type JsonObject } from "../json";
import {
    STATUS_WIDGET_IDS,
    STATUS_WIDGET_LABELS,
    analogMinSize,
    clampRect,
    fitRectInEmptySpace,
    gridCellRect,
    isMeterWidget,
    layoutGroupsToJson,
    newLayoutGroupId,
    readLayoutGroups,
    readSnapshotWidgets,
    readStatusWidgets,
    rectContainsPoint,
    rectsOverlap,
    resizeRect,
    snapRectToPixels,
    snapshotWidgetId,
    snapshotWidgetsToJson,
    spaceRectsEvenly,
    statusWidgetMinSize,
    statusWidgetsToJson,
    unplacedIds,
    type LayoutGroup,
    type LayoutRect
} from "../layout";
import { GainMeter } from "./GainMeter";
import { analogFeedback, PerformanceControl, type SwitchRole } from "./PerformanceControl";
import { LibraryJsonPicker, utf8ToBase64 } from "./LibraryManager";
import { ConfirmDialog } from "./ConfirmDialog";
import { updateUiSessionSection } from "../uiSession";

function layoutNameFromPath(path: string, fallback = "default"): string {
    const leaf = path.replace(/\\/g, "/").split("/").pop() ?? fallback;
    return leaf.replace(/\.json$/i, "") || fallback;
}

const SNAP_PIXELS_KEY = "pimfx-layout-snap-pixels";
const SNAP_ENABLED_KEY = "pimfx-layout-snap-enabled";

const ACTION_LABELS: Record<string, string> = {
    none: "Unassigned",
    selectPreset: "Select Preset",
    presetUp: "Preset Up",
    presetDown: "Preset Down",
    bankUp: "Bank Up",
    bankDown: "Bank Down",
    snapshotMode: "Snapshot Mode",
    bypassAll: "Bypass All",
    tapTempo: "Tap Tempo",
    tuner: "Tuner",
    navigate: "Navigate menus",
    select: "Select",
    selectSnapshot: "Snapshot",
    reloadPreset: "Reload Preset",
    setParameter: "Set Parameter",
    toggleEffect: "Toggle Effect",
    backingPlayPause: "Backing Play / Pause",
    backingStop: "Backing Stop",
    backingPrevious: "Backing Previous",
    backingNext: "Backing Next",
    backingView: "Open Backing Tracks"
};

function loadSnapPixels(): number {
    const value = Number(window.localStorage.getItem(SNAP_PIXELS_KEY));
    return Number.isFinite(value) ? Math.min(64, Math.max(1, Math.round(value))) : 8;
}

function loadSnapEnabled(): boolean {
    return window.localStorage.getItem(SNAP_ENABLED_KEY) !== "0";
}

export function LayoutEditorView({
    engine,
    run,
    onDirtyChange
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    onDirtyChange?: (dirty: boolean) => void;
}) {
    const controller = obj(engine.state.controller);
    const controls = objects(controller.controls);
    const layout = obj(controller.performanceLayout);
    const chain = objects(engine.state.chain);
    const parameterBindings = objects(obj(findPreset(engine.state)).parameterBindings);
    const switchStyle = document.documentElement.dataset.mfxSwitchStyle || "tiles";
    const [widgets, setWidgets] = useState(() => readStatusWidgets(layout));
    const [snapshotWidgets, setSnapshotWidgets] = useState(() => readSnapshotWidgets(layout));
    const [stage, setStage] = useState<"performance" | "snapshots">("performance");
    const [hiddenIds, setHiddenIds] = useState(() => unplacedIds(layout));
    const [draftRects, setDraftRects] = useState<Record<string, LayoutRect>>({});
    const [selectedId, setSelectedId] = useState("");
    const [groups, setGroups] = useState(() => readLayoutGroups(layout));
    const [snapshotGroups, setSnapshotGroups] = useState(() => readLayoutGroups({ groups: layout.snapshotGroups } as JsonObject));
    const [activeGroupId, setActiveGroupId] = useState("");
    const [groupMode, setGroupMode] = useState(false);
    const [matchSize, setMatchSize] = useState(false);
    const [groupName, setGroupName] = useState("");
    const [snapEnabled, setSnapEnabled] = useState(loadSnapEnabled);
    const [snapPixels, setSnapPixels] = useState(loadSnapPixels);
    const [message, setMessage] = useState("");
    const [swapTargetId, setSwapTargetId] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const [picker, setPicker] = useState<"load" | "save" | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [loadedLayoutName, setLoadedLayoutName] = useState(() => str(layout.layoutName));
    const [measurement, setMeasurement] = useState<{
        mode: string;
        clientX: number;
        clientY: number;
        rect: LayoutRect;
    } | null>(null);
    const applyingSharedDraft = useRef(false);
    const draftReady = useRef(false);
    const lastSharedDraft = useRef("");
    useEffect(() => {
        const shared = obj(engine.uiSession.layoutEditor);
        const sharedStage = str(shared.stage);
        if (sharedStage === "performance" || sharedStage === "snapshots") {
            setStage(sharedStage);
        }
        if (typeof shared.selectedId === "string") {
            setSelectedId(shared.selectedId);
        }
        if (typeof shared.activeGroupId === "string") {
            setActiveGroupId(shared.activeGroupId);
        }
        if (typeof shared.groupMode === "boolean") {
            setGroupMode(shared.groupMode);
        }
        if (typeof shared.matchSize === "boolean") {
            setMatchSize(shared.matchSize);
        }
        if (typeof shared.snapEnabled === "boolean") {
            setSnapEnabled(shared.snapEnabled);
            window.localStorage.setItem(SNAP_ENABLED_KEY, shared.snapEnabled ? "1" : "0");
        }
        if (typeof shared.snapPixels === "number") {
            const next = Math.min(64, Math.max(1, shared.snapPixels));
            setSnapPixels(next);
            window.localStorage.setItem(SNAP_PIXELS_KEY, String(next));
        }
        const sharedPicker = str(shared.picker);
        setPicker(sharedPicker === "load" || sharedPicker === "save" ? sharedPicker : null);
        if (typeof shared.confirmDelete === "boolean") {
            setConfirmDelete(shared.confirmDelete);
        }
        const sharedDraft = obj(shared.draft);
        const sharedDraftJson = Object.keys(sharedDraft).length > 0 ? JSON.stringify(sharedDraft) : "";
        if (sharedDraftJson && sharedDraftJson !== lastSharedDraft.current) {
            lastSharedDraft.current = sharedDraftJson;
            applyingSharedDraft.current = true;
            setWidgets(readStatusWidgets({ elements: sharedDraft.elements }));
            setSnapshotWidgets(readSnapshotWidgets({ snapshotElements: sharedDraft.snapshotElements }));
            setHiddenIds(arr(sharedDraft.hiddenIds).filter((item): item is string => typeof item === "string"));
            setDraftRects(obj(sharedDraft.rects) as unknown as Record<string, LayoutRect>);
            setGroups(readLayoutGroups({ groups: sharedDraft.groups }));
            setSnapshotGroups(readLayoutGroups({ groups: sharedDraft.snapshotGroups }));
            if (typeof sharedDraft.loadedLayoutName === "string") {
                setLoadedLayoutName(sharedDraft.loadedLayoutName);
            }
            if (typeof sharedDraft.dirty === "boolean") {
                setDirty(sharedDraft.dirty);
            }
        }
    }, [engine.uiSession.layoutEditor]);
    const syncLayoutUi = (patch: JsonObject) => updateUiSessionSection(engine.client, "layoutEditor", patch);
    const selectLayoutItem = (id: string) => {
        setSelectedId(id);
        syncLayoutUi({ selectedId: id });
    };
    const showLayoutPicker = (next: "load" | "save" | null) => {
        setPicker(next);
        syncLayoutUi({ picker: next ?? "" });
    };
    const showDeleteConfirmation = (show: boolean) => {
        setConfirmDelete(show);
        syncLayoutUi({ confirmDelete: show });
    };
    useEffect(() => {
        if (!draftReady.current) {
            draftReady.current = true;
            if (applyingSharedDraft.current) {
                applyingSharedDraft.current = false;
                return;
            }
        }
        if (applyingSharedDraft.current) {
            applyingSharedDraft.current = false;
            return;
        }
        const draft = {
            elements: statusWidgetsToJson(widgets),
            snapshotElements: snapshotWidgetsToJson(snapshotWidgets),
            hiddenIds,
            rects: draftRects as unknown as JsonObject,
            groups: layoutGroupsToJson(groups),
            snapshotGroups: layoutGroupsToJson(snapshotGroups),
            loadedLayoutName,
            dirty
        };
        lastSharedDraft.current = JSON.stringify(draft);
        updateUiSessionSection(engine.client, "layoutEditor", { draft });
    }, [widgets, snapshotWidgets, hiddenIds, draftRects, groups, snapshotGroups, loadedLayoutName, dirty, engine.client]);
    const stageRef = useRef<HTMLDivElement>(null);
    const stageGroups = stage === "snapshots" ? snapshotGroups : groups;
    const setStageGroups = stage === "snapshots" ? setSnapshotGroups : setGroups;
    const groupsRef = useRef(stageGroups);
    groupsRef.current = stageGroups;
    const swapTargetRef = useRef<string | null>(null);
    const drag = useRef<{
        id: string;
        mode: "move" | "resize-se" | "resize-nw";
        startX: number;
        startY: number;
        rect: LayoutRect;
        last: LayoutRect;
        lastValid: Record<string, LayoutRect>;
        startedOverlapping: Set<string>;
    } | null>(null);

    const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
    const activeGroup = stageGroups.find((group) => group.id === activeGroupId);
    const grouped = useMemo(() => new Set(activeGroup?.memberIds ?? []), [activeGroup]);
    const canArrange = true;
    const markDirty = () => {
        setDirty(true);
        onDirtyChange?.(true);
    };

    useEffect(() => {
        onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);

    const applySnap = (rect: LayoutRect, min?: { width: number; height: number }) => {
        const box = stageRef.current?.getBoundingClientRect();
        if (!snapEnabled || !box) {
            return clampRect(rect, min);
        }
        return snapRectToPixels(rect, box.width, box.height, snapPixels, min);
    };

    const controlRect = (control: JsonObject, index: number): LayoutRect => {
        const id = str(control.id);
        if (draftRects[id]) {
            return draftRects[id];
        }
        const min = analogMinSize(normalizeControlKind(str(control.kind, "momentary")));
        return clampRect({
            x: num(control.x, gridCellRect(index, 4, 2).x),
            y: num(control.y, gridCellRect(index, 4, 2).y),
            width: Math.max(min.width, num(control.width, 0.18)),
            height: Math.max(min.height, num(control.height, 0.2))
        }, min);
    };

    const placedControls = useMemo(
        () => controls.filter((control) => {
            const id = str(control.id);
            if (hidden.has(id)) {
                return false;
            }
            return !isEncoderPushKind(normalizeControlKind(str(control.kind, "momentary")));
        }),
        [controls, hidden]
    );

    const visibleIds = useMemo(() => {
        if (stage === "snapshots") {
            return snapshotWidgets.map((widget) => widget.id);
        }
        return [
            ...STATUS_WIDGET_IDS.filter((id) => widgets[id].visible),
            ...placedControls.map((control) => str(control.id))
        ];
    }, [stage, snapshotWidgets, widgets, placedControls]);

    const minSizeForId = (id: string): { width: number; height: number } => {
        const control = controls.find((item) => str(item.id) === id);
        if (control) {
            return analogMinSize(normalizeControlKind(str(control.kind, "momentary")));
        }
        return statusWidgetMinSize(id);
    };

    const rectForId = (id: string): LayoutRect | null => {
        if (STATUS_WIDGET_IDS.includes(id as typeof STATUS_WIDGET_IDS[number])) {
            return widgets[id]?.rect ?? null;
        }
        if (id.startsWith("snap-slot-")) {
            return snapshotWidgets.find((item) => item.id === id)?.rect ?? null;
        }
        const control = controls.find((item) => str(item.id) === id);
        if (!control) {
            return null;
        }
        const index = placedControls.findIndex((item) => str(item.id) === id);
        return controlRect(control, index >= 0 ? index : 0);
    };

    const placedEntries = (): { id: string; rect: LayoutRect }[] => (
        visibleIds
            .map((id) => {
                const rect = rectForId(id);
                return rect ? { id, rect } : null;
            })
            .filter((item): item is { id: string; rect: LayoutRect } => item !== null)
    );

    const sizedRect = (id: string, base: LayoutRect, size: { width: number; height: number }): LayoutRect => {
        const min = minSizeForId(id);
        return clampRect({
            ...base,
            width: Math.max(min.width, size.width),
            height: Math.max(min.height, size.height)
        });
    };

    const patchRects = (updates: Record<string, LayoutRect>) => {
        const ids = Object.keys(updates);
        const statusIds = ids.filter((id) => STATUS_WIDGET_IDS.includes(id as typeof STATUS_WIDGET_IDS[number]));
        const snapIds = ids.filter((id) => id.startsWith("snap-slot-"));
        const controlIds = ids.filter((id) => !statusIds.includes(id) && !snapIds.includes(id));
        if (statusIds.length > 0) {
            setWidgets((current) => {
                const next = { ...current };
                for (const id of statusIds) {
                    if (next[id]) {
                        next[id] = { ...next[id], rect: updates[id] };
                    }
                }
                return next;
            });
        }
        if (snapIds.length > 0) {
            setSnapshotWidgets((current) => current.map((item) => (
                updates[item.id] ? { ...item, rect: updates[item.id] } : item
            )));
        }
        if (controlIds.length > 0) {
            setDraftRects((current) => {
                const next = { ...current };
                for (const id of controlIds) {
                    next[id] = updates[id];
                }
                return next;
            });
        }
        markDirty();
    };

    const wouldCreateOverlap = (
        updates: Record<string, LayoutRect>,
        ignore: Set<string>,
        startedOverlapping: Set<string>
    ) => {
        const nextById = new Map(placedEntries().map((item) => [item.id, item.rect]));
        for (const [id, rect] of Object.entries(updates)) {
            nextById.set(id, rect);
        }
        return Object.entries(updates).some(([id, rect]) => {
            const hits = [...nextById.entries()].filter(([otherId, otherRect]) => (
                otherId !== id && !ignore.has(otherId) && rectsOverlap(rect, otherRect)
            ));
            if (hits.length === 0) {
                return false;
            }
            if (startedOverlapping.has(id)) {
                const current = placedEntries().find((item) => item.id === id)?.rect;
                if (!current) {
                    return true;
                }
                const currentHits = placedEntries().filter((item) => (
                    item.id !== id && !ignore.has(item.id) && rectsOverlap(current, item.rect)
                )).length;
                return hits.length > currentHits;
            }
            return true;
        });
    };

    const groupForId = (id: string) => groupsRef.current.find((group) => group.memberIds.includes(id));

    const spaceActiveGroup = () => {
        const members = activeGroup?.memberIds.filter((id) => visibleIds.includes(id)) ?? [];
        if (members.length < 2) {
            setMessage("Add at least two widgets to this group first.");
            return;
        }
        const current = members
            .map((id) => {
                const rect = rectForId(id);
                return rect ? { id, rect } : null;
            })
            .filter((item): item is { id: string; rect: LayoutRect } => item !== null);
        const spaced = spaceRectsEvenly(current.map((item) => item.rect));
        const updates: Record<string, LayoutRect> = {};
        current.forEach((item, index) => {
            updates[item.id] = spaced[index];
        });
        const outsiders = placedEntries().filter((item) => !members.includes(item.id));
        const overlap = Object.entries(updates).some(([, rect]) => (
            outsiders.some((item) => rectsOverlap(rect, item.rect))
        ));
        if (overlap) {
            setMessage("Even spacing would overlap another widget. Move this group first.");
            return;
        }
        patchRects(updates);
        setMessage("Grouped widgets are spaced evenly.");
    };

    const ensureActiveGroup = (): string => {
        if (activeGroupId && groupsRef.current.some((group) => group.id === activeGroupId)) {
            return activeGroupId;
        }
        const id = newLayoutGroupId(groupsRef.current);
        const group: LayoutGroup = { id, name: `Group ${groupsRef.current.length + 1}`, memberIds: [] };
        setStageGroups((current) => [...current, group]);
        setActiveGroupId(id);
        syncLayoutUi({ activeGroupId: id });
        markDirty();
        return id;
    };

    const addGroup = () => {
        const name = groupName.trim() || `Group ${stageGroups.length + 1}`;
        const id = newLayoutGroupId(stageGroups);
        setStageGroups((current) => [...current, { id, name, memberIds: [] }]);
        setActiveGroupId(id);
        setGroupName("");
        setGroupMode(true);
        syncLayoutUi({ activeGroupId: id, groupMode: true });
        markDirty();
        setMessage(`Group “${name}” added. Select widgets, then ADD TO GROUP.`);
    };

    const renameActiveGroup = () => {
        const name = groupName.trim();
        if (!activeGroup || !name) {
            return;
        }
        setStageGroups((current) => current.map((group) => (
            group.id === activeGroup.id ? { ...group, name } : group
        )));
        setGroupName("");
        markDirty();
        setMessage(`Renamed to “${name}”.`);
    };

    const deleteActiveGroup = () => {
        if (!activeGroup) {
            return;
        }
        setStageGroups((current) => current.filter((group) => group.id !== activeGroup.id));
        setActiveGroupId("");
        setGroupMode(false);
        syncLayoutUi({ activeGroupId: "", groupMode: false });
        markDirty();
        setMessage(`Deleted group “${activeGroup.name}”.`);
    };

    const toggleGroupMember = (id: string) => {
        const groupId = ensureActiveGroup();
        setStageGroups((current) => current.map((group) => {
            if (group.id === groupId) {
                const memberIds = group.memberIds.includes(id)
                    ? group.memberIds.filter((item) => item !== id)
                    : [...group.memberIds, id];
                return { ...group, memberIds };
            }
            return {
                ...group,
                memberIds: group.memberIds.filter((item) => item !== id)
            };
        }));
        markDirty();
        setMessage("");
    };

    const onPointerDown = (
        id: string,
        rect: LayoutRect,
        event: ReactPointerEvent,
        gesture: "move" | "resize-se" | "resize-nw" = "move"
    ) => {
        event.preventDefault();
        event.stopPropagation();
        stageRef.current?.setPointerCapture(event.pointerId);
        const started = new Set<string>();
        const others = placedEntries().filter((item) => item.id !== id);
        if (others.some((item) => rectsOverlap(rect, item.rect))) {
            started.add(id);
        }
        drag.current = {
            id,
            mode: gesture,
            startX: event.clientX,
            startY: event.clientY,
            rect,
            last: rect,
            lastValid: { [id]: rect },
            startedOverlapping: started
        };
        swapTargetRef.current = null;
        setSwapTargetId(null);
        selectLayoutItem(id);
        setMeasurement({
            mode: gesture === "move" ? "MOVE" : "RESIZE",
            clientX: event.clientX,
            clientY: event.clientY,
            rect
        });
    };

    const onPointerMove = (event: ReactPointerEvent) => {
        if (!drag.current || !stageRef.current) {
            return;
        }
        const box = stageRef.current.getBoundingClientRect();
        const dx = (event.clientX - drag.current.startX) / box.width;
        const dy = (event.clientY - drag.current.startY) / box.height;
        const base = drag.current.rect;
        const id = drag.current.id;
        const min = minSizeForId(id);
        const raw = drag.current.mode === "move"
            ? { ...base, x: base.x + dx, y: base.y + dy }
            : resizeRect(base, dx, dy, drag.current.mode === "resize-nw" ? "nw" : "se", min);

        let swapId: string | null = null;
        if (drag.current.mode === "move") {
            const centerX = raw.x + raw.width / 2;
            const centerY = raw.y + raw.height / 2;
            const group = groupForId(id);
            const skip = new Set(groupMode && group ? group.memberIds : [id]);
            const hit = placedEntries().find((item) => (
                !skip.has(item.id) && rectContainsPoint(item.rect, centerX, centerY)
            ));
            swapId = hit?.id ?? null;
        }
        if (swapTargetRef.current !== swapId) {
            swapTargetRef.current = swapId;
            setSwapTargetId(swapId);
        }

        const ignore = new Set<string>(swapId ? [swapId] : []);
        if (groupMode && drag.current.mode === "move") {
            const group = groupForId(id);
            group?.memberIds.forEach((member) => ignore.add(member));
        }
        const updates: Record<string, LayoutRect> = { [id]: applySnap(raw, min) };
        if (groupMode && drag.current.mode === "move") {
            const group = groupForId(id);
            if (group && group.memberIds.length > 1) {
                for (const other of group.memberIds) {
                    if (other === id) {
                        continue;
                    }
                    const current = rectForId(other);
                    if (current) {
                        updates[other] = applySnap({
                            ...current,
                            x: current.x + dx,
                            y: current.y + dy
                        }, minSizeForId(other));
                    }
                }
            }
        } else if (matchSize && drag.current.mode !== "move") {
            const group = groupForId(id);
            if (group && group.memberIds.length > 1) {
                for (const other of group.memberIds) {
                    if (other === id) {
                        continue;
                    }
                    const current = rectForId(other);
                    if (current) {
                        updates[other] = sizedRect(other, current, { width: updates[id].width, height: updates[id].height });
                    }
                }
            }
        }

        const blocked = wouldCreateOverlap(updates, ignore, drag.current.startedOverlapping);
        setMeasurement({
            mode: drag.current.mode === "move" ? "MOVE" : "RESIZE",
            clientX: event.clientX,
            clientY: event.clientY,
            rect: updates[id]
        });
        if (blocked && !swapId) {
            return;
        }
        drag.current.last = updates[id];
        drag.current.lastValid = updates;
        patchRects(updates);
        setMessage("");
    };

    const onPointerUp = (event: ReactPointerEvent) => {
        if (!drag.current) {
            return;
        }
        const session = drag.current;
        const swapId = swapTargetRef.current;
        const click = Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 10;
        drag.current = null;
        swapTargetRef.current = null;
        setSwapTargetId(null);
        setMeasurement(null);
        if (session.mode === "move" && swapId && swapId !== session.id && !click) {
            const targetRect = rectForId(swapId);
            if (targetRect) {
                patchRects({
                    [session.id]: { ...targetRect },
                    [swapId]: { ...session.rect }
                });
                setMessage("Widgets swapped.");
                return;
            }
        }
        patchRects(session.lastValid);
        if (click && session.mode === "move") {
            selectLayoutItem(session.id);
        }
    };

    const occupyExcept = (id: string) => (
        placedEntries().filter((item) => item.id !== id).map((item) => item.rect)
    );

    const toggleHidden = (id: string) => {
        if (hidden.has(id)) {
            const control = controls.find((item) => str(item.id) === id);
            if (!control) {
                return;
            }
            const min = minSizeForId(id);
            const compact = { x: 0.02, y: 0.18, width: min.width, height: min.height };
            const occupied = occupyExcept(id);
            const fitted = fitRectInEmptySpace(compact, occupied, min)
                ?? fitRectInEmptySpace(compact, occupied, { width: 0.06, height: 0.08 });
            if (!fitted) {
                setMessage("No empty space for that control. Make a gap first.");
                return;
            }
            setDraftRects((current) => ({ ...current, [id]: fitted }));
            setHiddenIds((current) => current.filter((item) => item !== id));
            setMessage("");
            markDirty();
            return;
        }
        setHiddenIds((current) => [...current, id]);
        setMessage("");
        markDirty();
    };

    const toggleWidget = (id: string) => {
        const widget = widgets[id];
        if (!widget) {
            return;
        }
        if (widget.visible) {
            setWidgets((current) => ({
                ...current,
                [id]: { ...current[id], visible: false }
            }));
            setMessage("");
            markDirty();
            return;
        }
        const min = minSizeForId(id);
        const compact = { x: 0.02, y: 0.02, width: min.width, height: min.height };
        const occupied = occupyExcept(id);
        const fitted = fitRectInEmptySpace(compact, occupied, min)
            ?? fitRectInEmptySpace(compact, occupied, { width: 0.06, height: 0.08 });
        if (!fitted) {
            setMessage("No empty space for that widget. Make a gap first.");
            return;
        }
        setWidgets((current) => ({
            ...current,
            [id]: { ...current[id], visible: true, rect: fitted }
        }));
        setMessage("");
        markDirty();
    };

    const pruneGroups = (items: LayoutGroup[], allowed: Set<string>) => (
        items.map((group) => ({
            ...group,
            memberIds: group.memberIds.filter((id) => allowed.has(id))
        })).filter((group) => group.id)
    );

    const visualLayout = (name = loadedLayoutName): JsonObject => {
        const layoutName = name.trim() || "default";
        const performanceIds = new Set([
            ...STATUS_WIDGET_IDS,
            ...placedControls.map((control) => str(control.id))
        ]);
        const snapshotIds = new Set(snapshotWidgets.map((item) => item.id));
        const nextControls = controls.map((control, index) => {
            const id = str(control.id);
            const rect = draftRects[id] ?? controlRect(control, index);
            return { id, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        });
        return {
            format: "pimfx-layout",
            version: 1,
            performanceLayout: {
                layoutName,
                elements: statusWidgetsToJson(widgets),
                snapshotElements: snapshotWidgetsToJson(snapshotWidgets),
                unplacedControlIds: Array.from(new Set([
                    ...hiddenIds,
                    ...controls
                        .filter((control) => isEncoderPushKind(normalizeControlKind(str(control.kind, "momentary"))))
                        .map((control) => str(control.id))
                        .filter(Boolean)
                ])),
                groups: layoutGroupsToJson(pruneGroups(groups, performanceIds)),
                snapshotGroups: layoutGroupsToJson(pruneGroups(snapshotGroups, snapshotIds))
            },
            controls: nextControls
        };
    };

    const applyVisualLayout = (parsed: JsonObject, name: string) => {
        if (str(parsed.format) !== "pimfx-layout") {
            throw new Error("that is not a Pi-MFX layout file");
        }
        const importedLayout = obj(parsed.performanceLayout);
        const imported = objects(parsed.controls);
        const importedGroups = readLayoutGroups(importedLayout);
        const importedSnapGroups = readLayoutGroups({ groups: importedLayout.snapshotGroups } as JsonObject);
        setWidgets(readStatusWidgets(importedLayout));
        setSnapshotWidgets(readSnapshotWidgets(importedLayout));
        setHiddenIds(unplacedIds(importedLayout));
        setGroups(importedGroups);
        setSnapshotGroups(importedSnapGroups);
        const importedActiveGroupId = (stage === "snapshots" ? importedSnapGroups : importedGroups)[0]?.id ?? "";
        setActiveGroupId(importedActiveGroupId);
        const nextRects: Record<string, LayoutRect> = {};
        for (const item of imported) {
            const id = str(item.id);
            if (id) {
                nextRects[id] = clampRect({
                    x: num(item.x),
                    y: num(item.y),
                    width: num(item.width, 0.18),
                    height: num(item.height, 0.2)
                }, minSizeForId(id));
            }
        }
        setDraftRects(nextRects);
        setGroupMode(false);
        syncLayoutUi({ activeGroupId: importedActiveGroupId, groupMode: false });
        setLoadedLayoutName(name);
    };

    const controllerFromVisual = (visual: JsonObject, name: string): JsonObject => {
        const importedLayout = { ...obj(visual.performanceLayout), layoutName: name };
        const rects = new Map(objects(visual.controls).map((item) => [str(item.id), item]));
        const nextControls = controls.map((control) => {
            const rect = obj(rects.get(str(control.id)));
            return rect.id
                ? { ...control, x: num(rect.x), y: num(rect.y), width: num(rect.width), height: num(rect.height) }
                : control;
        });
        return {
            ...controller,
            layoutMode: "freeform",
            performanceLayout: importedLayout,
            controls: nextControls
        };
    };

    const writeLayoutFile = async (name: string, visual: JsonObject) => {
        await engine.client.request("library/upload", {
            kind: "layout",
            name: `${name}.json`,
            data: utf8ToBase64(JSON.stringify(visual, null, 2)),
            directory: ""
        });
    };

    const syncLayout = async (name: string, visual: JsonObject) => {
        await writeLayoutFile(name, visual);
        await engine.client.request("controller/config", controllerFromVisual(visual, name));
        setLoadedLayoutName(name);
        setDirty(false);
        onDirtyChange?.(false);
    };

    const saveLayout = () => {
        const name = loadedLayoutName.trim() || "default";
        void run(async () => {
            await syncLayout(name, visualLayout(name));
            setMessage(`Saved “${name}”. Performance and the controller use this arrangement.`);
        });
    };

    const deleteLayoutFile = () => {
        const name = loadedLayoutName.trim() || "default";
        showDeleteConfirmation(false);
        void run(async () => {
            const listed = obj(await engine.client.request("library/list", { kind: "layout", directory: "" }));
            const file = objects(listed.files).find((item) => (
                str(item.name).replace(/\.json$/i, "") === name
            ));
            if (!file || !str(file.path)) {
                setMessage(`No saved file named “${name}”.`);
                return;
            }
            await engine.client.request("library/delete", { path: str(file.path) });
            setMessage(`Deleted “${name}”. Performance still uses the current arrangement until you save another.`);
        });
    };

    const addSnapshotWidget = () => {
        const slot = snapshotWidgets.reduce((max, item) => Math.max(max, item.slot), -1) + 1;
        const desired = gridCellRect(slot, 3, Math.max(2, Math.ceil((slot + 1) / 3)));
        const fitted = fitRectInEmptySpace(
            desired,
            snapshotWidgets.map((item) => item.rect),
            { width: 0.12, height: 0.12 }
        );
        if (!fitted) {
            setMessage("No empty space for that snapshot. Make a gap first.");
            return;
        }
        setSnapshotWidgets((current) => [...current, {
            id: snapshotWidgetId(slot),
            slot,
            rect: fitted
        }]);
        setMessage("");
    };

    const removeSnapshotWidget = (slot: number) => {
        setSnapshotWidgets((current) => current.length <= 1 ? current : current.filter((item) => item.slot !== slot));
        setMessage("");
    };

    const itemClassName = (kind: "switch" | "status", id: string) => (
        `layout-item ${kind}${selectedId === id ? " selected" : ""}${grouped.has(id) ? " grouped" : ""}${groupMode && !grouped.has(id) ? " group-dim" : ""}${swapTargetId === id ? " swap-target" : ""}`
    );

    const resizeHandles = (id: string, rect: LayoutRect) => (
        <>
            <span
                className="layout-resize layout-resize-nw"
                onPointerDown={(event) => onPointerDown(id, rect, event, "resize-nw")}
            />
            <span
                className="layout-resize"
                onPointerDown={(event) => onPointerDown(id, rect, event, "resize-se")}
            />
        </>
    );

    return (
        <div className="layout-editor">
            <div className="layout-editor-toolbar">
                <div>
                    <div className="layout-stage-toggle">
                        {(["performance", "snapshots"] as const).map((item) => (
                            <button
                                key={item}
                                type="button"
                                className={`btn ${stage === item ? "btn-active" : ""}`}
                                onClick={() => {
                                    setStage(item);
                                    setSelectedId("");
                                    setGroupMode(false);
                                    syncLayoutUi({ stage: item, selectedId: "", groupMode: false });
                                    setMessage("");
                                }}
                            >
                                {item.toUpperCase()}
                            </button>
                        ))}
                    </div>
                    <div className="layout-editor-title">
                        <span>
                            {stage === "snapshots" ? "SNAPSHOT LAYOUT" : "PERFORMANCE LAYOUT"}
                            {" · "}
                            {loadedLayoutName.trim() || "default"}
                        </span>
                        <button
                            type="button"
                            className="btn layout-name-delete"
                            title={`Delete saved layout “${loadedLayoutName.trim() || "default"}”`}
                            aria-label={`Delete saved layout ${loadedLayoutName.trim() || "default"}`}
                            onClick={() => showDeleteConfirmation(true)}
                        >
                            🗑
                        </button>
                    </div>
                    <div className="muted">
                        {stage === "snapshots"
                            ? "Add, remove and arrange snapshot tiles. Hardware Setup assigns which control recalls each slot."
                            : "Arrange widgets and controls. Layout does not change what a control does."}
                    </div>
                </div>
                <div className="row">
                    <button
                        type="button"
                        className={`btn ${snapEnabled ? "btn-active" : ""}`}
                        onClick={() => {
                            setSnapEnabled((value) => {
                                const next = !value;
                                window.localStorage.setItem(SNAP_ENABLED_KEY, next ? "1" : "0");
                                syncLayoutUi({ snapEnabled: next });
                                return next;
                            });
                        }}
                    >
                        SNAP
                    </button>
                    <label className="field" style={{ minWidth: 92 }}>
                        <span>Snap px</span>
                        <input
                            type="number"
                            min={1}
                            max={64}
                            value={snapPixels}
                            disabled={!snapEnabled}
                            onChange={(event) => {
                                const next = Math.min(64, Math.max(1, Number(event.target.value) || 8));
                                setSnapPixels(next);
                                window.localStorage.setItem(SNAP_PIXELS_KEY, String(next));
                                syncLayoutUi({ snapPixels: next });
                            }}
                        />
                    </label>
                    <button type="button" className="btn" onClick={() => showLayoutPicker("load")}>LOAD</button>
                    <button type="button" className="btn" onClick={() => showLayoutPicker("save")}>SAVE AS</button>
                    <button type="button" className="btn btn-accent" onClick={saveLayout}>SAVE LAYOUT</button>
                </div>
                {groupMode && activeGroup && (
                    <div className="layout-group-banner">
                        <span>
                            Grouping <strong>{activeGroup.name}</strong>
                            {" · "}
                            {activeGroup.memberIds.length} item{activeGroup.memberIds.length === 1 ? "" : "s"}
                            {" · select a widget, then ADD TO GROUP"}
                        </span>
                        <button
                            type="button"
                            className="btn"
                            onClick={() => {
                                setGroupMode(false);
                                syncLayoutUi({ groupMode: false });
                                setMessage(activeGroup.memberIds.length
                                    ? `${activeGroup.memberIds.length} in “${activeGroup.name}”.`
                                    : "");
                            }}
                        >
                            DONE
                        </button>
                    </div>
                )}
                {message && <div className="muted">{message}</div>}
            </div>
            <div className="layout-editor-body">
                <aside className="layout-editor-inspector" data-mfx-sync-scroll="settings-layout-inspector">
                    {canArrange && (
                        <div className="layout-palette">
                            <div className="field-label">GROUPS</div>
                            <div className="row" style={{ gap: 6 }}>
                                <label className="field" style={{ flex: 1, minWidth: 0 }}>
                                    <span>{activeGroup ? "Rename" : "New group"}</span>
                                    <input
                                        value={groupName}
                                        placeholder={activeGroup ? activeGroup.name : "Footswitches"}
                                        onChange={(event) => setGroupName(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key !== "Enter") {
                                                return;
                                            }
                                            if (activeGroup && groupName.trim()) {
                                                renameActiveGroup();
                                                return;
                                            }
                                            addGroup();
                                        }}
                                    />
                                </label>
                                {activeGroup && groupName.trim() ? (
                                    <button type="button" className="btn" onClick={renameActiveGroup}>RENAME</button>
                                ) : (
                                    <button type="button" className="btn btn-accent" onClick={addGroup}>ADD</button>
                                )}
                            </div>
                            <div className="layout-group-list">
                                {stageGroups.map((group) => (
                                    <button
                                        key={group.id}
                                        type="button"
                                        className={`layout-group-chip${activeGroupId === group.id ? " is-active" : ""}`}
                                        onClick={() => {
                                            setActiveGroupId(group.id);
                                            syncLayoutUi({ activeGroupId: group.id });
                                            setGroupName("");
                                            setMessage(`Selected “${group.name}”. Turn on GROUP to move members together.`);
                                        }}
                                    >
                                        <span>{group.name}</span>
                                        <small>{group.memberIds.length}</small>
                                    </button>
                                ))}
                            </div>
                            {stageGroups.length > 0 && (
                                <div className="layout-group-actions">
                                    <button
                                        type="button"
                                        className={`btn ${groupMode ? "btn-active" : ""}`}
                                        onClick={() => {
                                            setGroupMode((on) => {
                                                const next = !on;
                                                setMessage(next
                                                    ? "Group mode on. Drag one member to move the group."
                                                    : "Group mode off. Drag items one at a time.");
                                                syncLayoutUi({ groupMode: next });
                                                return next;
                                            });
                                        }}
                                    >
                                        GROUP {groupMode ? "ON" : "OFF"}
                                    </button>
                                    <button
                                        type="button"
                                        className={`btn ${matchSize ? "btn-active" : ""}`}
                                        onClick={() => {
                                            setMatchSize((on) => {
                                                const next = !on;
                                                setMessage(next
                                                    ? "Match size on. Resize one member to size the group."
                                                    : "Match size off. Resize items one at a time.");
                                                syncLayoutUi({ matchSize: next });
                                                return next;
                                            });
                                        }}
                                    >
                                        MATCH SIZE {matchSize ? "ON" : "OFF"}
                                    </button>
                                </div>
                            )}
                            {activeGroup && (
                                <div className="layout-group-actions">
                                    <button
                                        type="button"
                                        className="btn"
                                        disabled={activeGroup.memberIds.length < 2}
                                        onClick={spaceActiveGroup}
                                    >
                                        SPACE EVENLY
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-accent"
                                        disabled={!selectedId}
                                        onClick={() => {
                                            if (selectedId) {
                                                toggleGroupMember(selectedId);
                                            }
                                        }}
                                    >
                                        {grouped.has(selectedId) ? "REMOVE" : "ADD"}
                                    </button>
                                    <button type="button" className="btn btn-danger" onClick={deleteActiveGroup}>
                                        DELETE
                                    </button>
                                </div>
                            )}
                            {stageGroups.length === 0 && (
                                <div className="muted">
                                    Add a group, then ADD a selected widget. GROUP moves members together. MATCH SIZE resizes them together.
                                </div>
                            )}
                        </div>
                    )}
                    {stage === "snapshots" ? (
                        <div className="layout-palette">
                            <div className="field-label">SNAPSHOTS</div>
                            <button type="button" className="btn btn-accent" onClick={addSnapshotWidget}>ADD SNAPSHOT</button>
                            {snapshotWidgets.map((widget) => (
                                <div key={widget.id} className="row" style={{ gap: 6 }}>
                                    <button
                                        type="button"
                                        className={`btn ${selectedId === widget.id ? "btn-active" : ""}`}
                                        style={{ flex: 1 }}
                                        onClick={() => selectLayoutItem(widget.id)}
                                    >
                                        SNAPSHOT {widget.slot + 1}
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-danger"
                                        disabled={snapshotWidgets.length <= 1}
                                        onClick={() => removeSnapshotWidget(widget.slot)}
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <>
                    <div className="layout-palette">
                    <div className="field-label">WIDGETS</div>
                    {STATUS_WIDGET_IDS.map((id) => (
                        <button
                            key={id}
                            type="button"
                            className={`btn ${widgets[id].visible ? "btn-active" : ""}`}
                            onClick={() => toggleWidget(id)}
                        >
                            {widgets[id].visible ? "✓ " : "+ "}
                            {STATUS_WIDGET_LABELS[id]}
                        </button>
                    ))}
                    </div>
                    <div className="layout-palette">
                    <div className="field-label">CONTROLS</div>
                    {controls.filter((control) => !isEncoderPushKind(normalizeControlKind(str(control.kind, "momentary")))).map((control) => (
                        <button
                            key={str(control.id)}
                            type="button"
                            className={`btn ${hidden.has(str(control.id)) ? "" : "btn-active"}`}
                            onClick={() => toggleHidden(str(control.id))}
                        >
                            {hidden.has(str(control.id)) ? "+ " : "✓ "}
                            {str(control.label).trim() || str(control.id)}
                        </button>
                    ))}
                    {controls.length === 0 && <div className="muted">Add controls in Hardware Setup.</div>}
                    </div>
                        </>
                    )}
                </aside>
                <div
                    ref={stageRef}
                    className={`layout-stage${groupMode ? " is-grouping" : ""}`}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                >
                    {stage === "snapshots"
                        ? snapshotWidgets.map((widget) => (
                            <div
                                key={widget.id}
                                className={itemClassName("switch", widget.id)}
                                style={rectStyle(widget.rect, selectedId === widget.id ? 3 : grouped.has(widget.id) ? 2 : 1)}
                                onPointerDown={(event) => onPointerDown(widget.id, widget.rect, event)}
                            >
                                <div className="layout-item-preview">
                                    <PerformanceControl
                                        tile={{
                                            id: widget.id,
                                            switchLabel: `SNAPSHOT ${widget.slot + 1}`,
                                            valueText: `Snapshot ${widget.slot + 1}`,
                                            role: "snapshot",
                                            lightState: "inactive",
                                            active: false,
                                            freeform: true,
                                            onPress: () => undefined
                                        }}
                                        switchStyle={switchStyle}
                                        bypassed={false}
                                    />
                                </div>
                                {resizeHandles(widget.id, widget.rect)}
                            </div>
                        ))
                        : (
                            <>
                    {STATUS_WIDGET_IDS.filter((id) => widgets[id].visible).map((id) => {
                        const widget = widgets[id];
                        return (
                            <div
                                key={id}
                                className={itemClassName("status", id)}
                                style={rectStyle(widget.rect, selectedId === id ? 3 : grouped.has(id) ? 2 : 1)}
                                onPointerDown={(event) => onPointerDown(id, widget.rect, event)}
                            >
                                <div className={`layout-item-preview layout-item-preview--status${isMeterWidget(id) ? " is-meter" : ""}`}>
                                    {isMeterWidget(id) ? (
                                        <GainMeter label={STATUS_WIDGET_LABELS[id]} peak={0.28} preview />
                                    ) : (
                                        <>
                                            {widget.showLabel && (
                                                <div className="mfx-performance-ui-label">{STATUS_WIDGET_LABELS[id]}</div>
                                            )}
                                            <strong className="mfx-performance-ui-value">{STATUS_WIDGET_LABELS[id]}</strong>
                                        </>
                                    )}
                                </div>
                                {resizeHandles(id, widget.rect)}
                            </div>
                        );
                    })}
                    {placedControls.map((control, index) => {
                        const id = str(control.id);
                        const rect = controlRect(control, index);
                        const kind = normalizeControlKind(str(control.kind, "momentary"));
                        const analog = isAnalogKind(kind);
                        const encoder = isEncoderKind(kind);
                        const action = str(obj(control.binding).action, "none");
                        const presetBind = parameterBindings.find((item) => str(item.controlId) === id);
                        const caption = functionCaption(control, chain, presetBind);
                        return (
                            <div
                                key={id}
                                className={itemClassName("switch", id)}
                                style={rectStyle(rect, selectedId === id ? 3 : grouped.has(id) ? 2 : 1)}
                                onPointerDown={(event) => onPointerDown(id, rect, event)}
                            >
                                <div className="layout-item-preview">
                                    <PerformanceControl
                                        tile={{
                                            id,
                                            switchLabel: str(control.label).trim() || id,
                                            valueText: caption,
                                            role: analog || encoder ? "utility" : roleForAction(action),
                                            lightState: "inactive",
                                            active: false,
                                            analog: analog || encoder,
                                            analogSource: str(control.label).trim() || id,
                                            analogFunction: analog || encoder ? caption : undefined,
                                            assigned: analog || encoder ? caption !== "Unassigned" : undefined,
                                            kind,
                                            value: 0.45,
                                            freeform: true,
                                            onPress: () => undefined
                                        }}
                                        switchStyle={switchStyle}
                                        bypassed={false}
                                    />
                                </div>
                                {resizeHandles(id, rect)}
                            </div>
                        );
                    })}
                            </>
                        )}
                    {measurement && stageRef.current && (
                        <LayoutMeasurementPopup
                            measurement={measurement}
                            canvas={stageRef.current.getBoundingClientRect()}
                        />
                    )}
                </div>
            </div>
            <div className="muted" style={{ padding: "0 12px 8px" }}>
                {bool(controller.mirrorLayoutOnScreen, true)
                    ? "This layout is what the Performance screen shows."
                    : "Turn on mirror layout in Hardware Setup to show this on Performance."}
            </div>
            {confirmDelete && (
                <ConfirmDialog
                    title={`DELETE “${(loadedLayoutName.trim() || "default").toUpperCase()}”?`}
                    body="This removes the saved layout file. Performance keeps the current arrangement until you save another."
                    confirmLabel="DELETE"
                    danger
                    onCancel={() => showDeleteConfirmation(false)}
                    onConfirm={deleteLayoutFile}
                />
            )}
            {picker && (
                <LibraryJsonPicker
                    engine={engine}
                    run={run}
                    kind="layout"
                    mode={picker}
                    title={picker === "save" ? "SAVE LAYOUT AS" : "LOAD LAYOUT"}
                    defaultName={loadedLayoutName.trim() || "default"}
                    contents={picker === "save" ? JSON.stringify(visualLayout(loadedLayoutName.trim() || "default"), null, 2) : undefined}
                    onClose={() => showLayoutPicker(null)}
                    onLoad={(parsed, path) => {
                        const name = str(obj(parsed.performanceLayout).layoutName)
                            || layoutNameFromPath(path, "default");
                        const named = {
                            ...parsed,
                            performanceLayout: { ...obj(parsed.performanceLayout), layoutName: name }
                        };
                        applyVisualLayout(named, name);
                        void run(async () => {
                            await syncLayout(name, named);
                            setMessage(`Loaded “${name}”. Performance and the controller use this arrangement.`);
                        });
                    }}
                    onSaved={(path) => {
                        const name = layoutNameFromPath(path, loadedLayoutName.trim() || "default");
                        void run(async () => {
                            await syncLayout(name, visualLayout(name));
                            setMessage(`Saved “${name}”. Performance and the controller use this arrangement.`);
                        });
                    }}
                />
            )}
        </div>
    );
}

function functionCaption(control: JsonObject, chain: JsonObject[], presetBind?: JsonObject): string {
    const kind = normalizeControlKind(str(control.kind, "momentary"));
    if (isAnalogKind(kind) || isEncoderKind(kind)) {
        const info = analogFeedback(control, chain, presetBind);
        if (info.parameter && info.parameter !== "UNASSIGNED") {
            return info.effect ? `${info.effect} · ${info.parameter}` : info.parameter;
        }
        if (isAnalogKind(kind)) {
            return "Unassigned";
        }
    }
    const action = str(obj(control.binding).action, "none");
    if (!action || action === "none") {
        return "Unassigned";
    }
    return ACTION_LABELS[action] ?? action.replace(/([A-Z])/g, " $1").replace(/^./, (ch) => ch.toUpperCase()).trim();
}

function LayoutMeasurementPopup({
    measurement,
    canvas
}: {
    measurement: { mode: string; clientX: number; clientY: number; rect: LayoutRect };
    canvas: DOMRect;
}) {
    const popupWidth = 188;
    const popupHeight = 62;
    const left = Math.max(8, Math.min(window.innerWidth - popupWidth - 8, measurement.clientX + 16));
    const top = Math.max(8, Math.min(window.innerHeight - popupHeight - 8, measurement.clientY + 16));
    return (
        <div className="layout-measurement" style={{ left, top }}>
            <div className="layout-measurement-mode">{measurement.mode}</div>
            <div className="layout-measurement-values">
                <span>X {Math.round(measurement.rect.x * canvas.width)}px</span>
                <span>Y {Math.round(measurement.rect.y * canvas.height)}px</span>
                <span>W {Math.round(measurement.rect.width * canvas.width)}px</span>
                <span>H {Math.round(measurement.rect.height * canvas.height)}px</span>
            </div>
        </div>
    );
}

function roleForAction(action: string): SwitchRole {
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
    if (action === "looperRecord" || action === "looperClear" || action === "recorderToggle" || action === "drumToggle") {
        return "bypass";
    }
    if (action === "looperOverdub") {
        return "snapshot";
    }
    return "utility";
}

function rectStyle(rect: LayoutRect, zIndex = 1): CSSProperties {
    return {
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.width * 100}%`,
        height: `${rect.height * 100}%`,
        zIndex
    };
}
