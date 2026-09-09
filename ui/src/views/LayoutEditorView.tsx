import { useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { findPreset, isAnalogKind, normalizeControlKind, type EngineSnapshot } from "../api";
import { bool, num, obj, str, objects, type JsonObject } from "../json";
import {
    STATUS_WIDGET_IDS,
    STATUS_WIDGET_LABELS,
    analogMinSize,
    clampRect,
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
    statusWidgetsToJson,
    unplacedIds,
    type LayoutGroup,
    type LayoutRect
} from "../layout";
import { GainMeter } from "./GainMeter";
import { analogFeedback, PerformanceControl, type SwitchRole } from "./PerformanceControl";
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
    setParameter: "Set Parameter",
    toggleEffect: "Toggle Effect"
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
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const controller = obj(engine.state.controller);
    const controls = objects(controller.controls);
    const layout = obj(controller.performanceLayout);
    const chain = objects(engine.state.chain);
    const parameterBindings = objects(obj(findPreset(engine.state)).parameterBindings);
    const switchStyle = document.documentElement.dataset.mfxSwitchStyle || "tiles";
    const [mode, setMode] = useState<"grid" | "freeform">(
        str(controller.layoutMode, "grid") === "freeform" ? "freeform" : "grid"
    );
    const [rows, setRows] = useState(() => Math.max(1, num(controller.gridRows, 2)));
    const [columns, setColumns] = useState(() => Math.max(1, num(controller.gridColumns, 4)));
    const [widgets, setWidgets] = useState(() => readStatusWidgets(layout));
    const [snapshotWidgets, setSnapshotWidgets] = useState(() => readSnapshotWidgets(layout));
    const [stage, setStage] = useState<"performance" | "snapshots">("performance");
    const [hiddenIds, setHiddenIds] = useState(() => unplacedIds(layout));
    const [draftRects, setDraftRects] = useState<Record<string, LayoutRect>>({});
    const [selectedId, setSelectedId] = useState("");
    const [groups, setGroups] = useState(() => readLayoutGroups(layout));
    const [activeGroupId, setActiveGroupId] = useState(() => readLayoutGroups(layout)[0]?.id ?? "");
    const [groupMode, setGroupMode] = useState(false);
    const [groupName, setGroupName] = useState("");
    const [snapEnabled, setSnapEnabled] = useState(loadSnapEnabled);
    const [snapPixels, setSnapPixels] = useState(loadSnapPixels);
    const [message, setMessage] = useState("");
    const [swapTargetId, setSwapTargetId] = useState<string | null>(null);
    const [measurement, setMeasurement] = useState<{
        mode: string;
        clientX: number;
        clientY: number;
        rect: LayoutRect;
    } | null>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const groupsRef = useRef(groups);
    groupsRef.current = groups;
    const swapTargetRef = useRef<string | null>(null);
    const drag = useRef<{
        id: string;
        mode: "move" | "resize-se" | "resize-nw";
        startX: number;
        startY: number;
        rect: LayoutRect;
        last: LayoutRect;
        lastValid: Record<string, LayoutRect>;
    } | null>(null);

    const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
    const activeGroup = groups.find((group) => group.id === activeGroupId);
    const grouped = useMemo(() => new Set(activeGroup?.memberIds ?? []), [activeGroup]);
    const canArrange = stage === "snapshots" || mode === "freeform";

    const applySnap = (rect: LayoutRect) => {
        const box = stageRef.current?.getBoundingClientRect();
        if (!snapEnabled || !box) {
            return clampRect(rect);
        }
        return snapRectToPixels(rect, box.width, box.height, snapPixels);
    };

    const controlRect = (control: JsonObject, index: number): LayoutRect => {
        const id = str(control.id);
        if (draftRects[id]) {
            return draftRects[id];
        }
        const min = analogMinSize(normalizeControlKind(str(control.kind, "momentary")));
        return mode === "freeform"
            ? clampRect({
                x: num(control.x, gridCellRect(index, columns, rows).x),
                y: num(control.y, gridCellRect(index, columns, rows).y),
                width: Math.max(min.width, num(control.width, 0.18)),
                height: Math.max(min.height, num(control.height, 0.2))
            })
            : gridCellRect(index, columns, rows);
    };

    const placedControls = useMemo(
        () => controls.filter((control) => !hidden.has(str(control.id))),
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
        return { width: 0.08, height: 0.08 };
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
    };

    const wouldCollide = (updates: Record<string, LayoutRect>, ignore: Set<string>) => {
        const nextById = new Map(placedEntries().map((item) => [item.id, item.rect]));
        for (const [id, rect] of Object.entries(updates)) {
            nextById.set(id, rect);
        }
        return Object.entries(updates).some(([id, rect]) => (
            [...nextById.entries()].some(([otherId, otherRect]) => (
                otherId !== id && !ignore.has(otherId) && rectsOverlap(rect, otherRect)
            ))
        ));
    };

    const groupForId = (id: string) => groupsRef.current.find((group) => group.memberIds.includes(id));

    const applySizeToMembers = (memberIds: string[], size: { width: number; height: number }) => {
        const outsiders = placedEntries().filter((item) => !memberIds.includes(item.id));
        const updates: Record<string, LayoutRect> = {};
        for (const id of memberIds) {
            const current = rectForId(id);
            if (!current) {
                continue;
            }
            const next = sizedRect(id, current, size);
            if (outsiders.some((item) => rectsOverlap(next, item.rect))) {
                continue;
            }
            updates[id] = next;
        }
        if (Object.keys(updates).length > 0) {
            patchRects(updates);
        }
        return updates;
    };

    const matchActiveGroupSize = () => {
        const members = activeGroup?.memberIds.filter((id) => visibleIds.includes(id)) ?? [];
        if (members.length < 2) {
            setMessage("Add at least two widgets to this group first.");
            return;
        }
        const sourceId = members.includes(selectedId) ? selectedId : members[0];
        const source = rectForId(sourceId);
        if (!source) {
            return;
        }
        applySizeToMembers(members, { width: source.width, height: source.height });
        setMessage("Grouped widgets now match that size. Resize one to keep them in sync.");
    };

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
        setGroups((current) => [...current, group]);
        setActiveGroupId(id);
        return id;
    };

    const addGroup = () => {
        const name = groupName.trim() || `Group ${groups.length + 1}`;
        const id = newLayoutGroupId(groups);
        setGroups((current) => [...current, { id, name, memberIds: [] }]);
        setActiveGroupId(id);
        setGroupName("");
        setGroupMode(true);
        setMessage(`Group “${name}” added. Tap widgets or controls to include them.`);
    };

    const renameActiveGroup = () => {
        const name = groupName.trim();
        if (!activeGroup || !name) {
            return;
        }
        setGroups((current) => current.map((group) => (
            group.id === activeGroup.id ? { ...group, name } : group
        )));
        setGroupName("");
        setMessage(`Renamed to “${name}”.`);
    };

    const deleteActiveGroup = () => {
        if (!activeGroup) {
            return;
        }
        setGroups((current) => current.filter((group) => group.id !== activeGroup.id));
        setActiveGroupId("");
        setGroupMode(false);
        setMessage(`Deleted group “${activeGroup.name}”.`);
    };

    const toggleGroupMember = (id: string) => {
        const groupId = ensureActiveGroup();
        setGroups((current) => current.map((group) => {
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
        setSelectedId(id);
        setMessage("");
    };

    const onPointerDown = (
        id: string,
        rect: LayoutRect,
        event: ReactPointerEvent,
        gesture: "move" | "resize-se" | "resize-nw" = "move"
    ) => {
        if (!canArrange) {
            setSelectedId(id);
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (groupMode && gesture === "move") {
            toggleGroupMember(id);
            return;
        }
        stageRef.current?.setPointerCapture(event.pointerId);
        drag.current = {
            id,
            mode: gesture,
            startX: event.clientX,
            startY: event.clientY,
            rect,
            last: rect,
            lastValid: { [id]: rect }
        };
        swapTargetRef.current = null;
        setSwapTargetId(null);
        setSelectedId(id);
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
        const next = drag.current.mode === "move"
            ? applySnap({ ...base, x: base.x + dx, y: base.y + dy })
            : applySnap(resizeRect(base, dx, dy, drag.current.mode === "resize-nw" ? "nw" : "se", min));

        let swapId: string | null = null;
        if (drag.current.mode === "move") {
            const centerX = next.x + next.width / 2;
            const centerY = next.y + next.height / 2;
            const hit = placedEntries().find((item) => (
                item.id !== id && rectContainsPoint(item.rect, centerX, centerY)
            ));
            swapId = hit?.id ?? null;
        }
        if (swapTargetRef.current !== swapId) {
            swapTargetRef.current = swapId;
            setSwapTargetId(swapId);
        }

        const ignore = new Set<string>(swapId ? [swapId] : []);
        const updates: Record<string, LayoutRect> = { [id]: next };
        if (drag.current.mode !== "move") {
            const group = groupForId(id);
            if (group && group.memberIds.length > 1) {
                for (const other of group.memberIds) {
                    if (other === id) {
                        continue;
                    }
                    const current = rectForId(other);
                    if (current) {
                        updates[other] = sizedRect(other, current, { width: next.width, height: next.height });
                    }
                }
            }
        }

        const blocked = wouldCollide(updates, ignore);
        setMeasurement({
            mode: drag.current.mode === "move" ? "MOVE" : "RESIZE",
            clientX: event.clientX,
            clientY: event.clientY,
            rect: next
        });
        if (blocked && !swapId) {
            return;
        }
        drag.current.last = next;
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
            setSelectedId(session.id);
        }
    };

    const toggleHidden = (id: string) => {
        setHiddenIds((current) => (
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
        ));
        setMessage("");
    };

    const toggleWidget = (id: string) => {
        setWidgets((current) => ({
            ...current,
            [id]: { ...current[id], visible: !current[id].visible }
        }));
        setMessage("");
    };

    const layoutPayload = (): JsonObject => {
        const nextControls = controls.map((control, index) => {
            const id = str(control.id);
            const rect = draftRects[id] ?? controlRect(control, index);
            return mode === "freeform"
                ? { ...control, x: rect.x, y: rect.y, width: rect.width, height: rect.height }
                : control;
        });
        return {
            ...controller,
            layoutMode: mode,
            gridRows: rows,
            gridColumns: columns,
            performanceLayout: {
                ...layout,
                elements: statusWidgetsToJson(widgets),
                snapshotElements: snapshotWidgetsToJson(snapshotWidgets),
                unplacedControlIds: hiddenIds,
                groups: layoutGroupsToJson(groups)
            },
            controls: nextControls
        };
    };

    const saveLayout = () => {
        void run(async () => {
            await engine.client.request("controller/config", layoutPayload());
            setMessage("Layout saved. Performance uses this arrangement.");
        });
    };

    const exportLayout = () => {
        const payload = {
            format: "pimfx-layout",
            version: 1,
            ...layoutPayload()
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "pimfx-layout.json";
        link.click();
        URL.revokeObjectURL(url);
    };

    const importLayout = (file: File) => {
        void file.text().then((text) => {
            const parsed = JSON.parse(text) as JsonObject;
            if (str(parsed.format) !== "pimfx-layout") {
                throw new Error("that is not a Pi-MFX layout file");
            }
            const importedLayout = obj(parsed.performanceLayout);
            const imported = objects(parsed.controls);
            const importedGroups = readLayoutGroups(importedLayout);
            setMode(str(parsed.layoutMode, mode) === "freeform" ? "freeform" : "grid");
            setRows(Math.max(1, num(parsed.gridRows, rows)));
            setColumns(Math.max(1, num(parsed.gridColumns, columns)));
            setWidgets(readStatusWidgets(importedLayout));
            setSnapshotWidgets(readSnapshotWidgets(importedLayout));
            setHiddenIds(unplacedIds(importedLayout));
            setGroups(importedGroups);
            setActiveGroupId(importedGroups[0]?.id ?? "");
            const nextRects: Record<string, LayoutRect> = {};
            for (const item of imported) {
                const id = str(item.id);
                if (id) {
                    nextRects[id] = clampRect({
                        x: num(item.x),
                        y: num(item.y),
                        width: num(item.width, 0.18),
                        height: num(item.height, 0.2)
                    });
                }
            }
            setDraftRects(nextRects);
            setGroupMode(false);
            setMessage("Layout imported. Choose SAVE LAYOUT to apply it.");
        }).catch((error: unknown) => {
            window.alert(error instanceof Error ? error.message : String(error));
        });
    };

    const addSnapshotWidget = () => {
        setSnapshotWidgets((current) => {
            const slot = current.reduce((max, item) => Math.max(max, item.slot), -1) + 1;
            return [...current, {
                id: snapshotWidgetId(slot),
                slot,
                rect: gridCellRect(slot, 3, Math.max(2, Math.ceil((slot + 1) / 3)))
            }];
        });
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
        canArrange && (stage === "snapshots" || mode === "freeform") ? (
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
        ) : null
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
                                    setMessage("");
                                }}
                            >
                                {item.toUpperCase()}
                            </button>
                        ))}
                    </div>
                    <div className="layout-editor-title">
                        {stage === "snapshots" ? "SNAPSHOT LAYOUT" : "PERFORMANCE LAYOUT"}
                    </div>
                    <div className="muted">
                        {stage === "snapshots"
                            ? "Add, remove and arrange snapshot tiles. Hardware Setup assigns which control recalls each slot."
                            : "Arrange widgets and controls. Layout does not change what a control does."}
                    </div>
                </div>
                <div className="row">
                    {(["grid", "freeform"] as const).map((item) => (
                        <button
                            key={item}
                            type="button"
                            className={`btn ${mode === item ? "btn-active" : ""}`}
                            onClick={() => {
                                setMode(item);
                                if (item === "grid") {
                                    setGroupMode(false);
                                }
                                setMessage("");
                            }}
                        >
                            {item.toUpperCase()}
                        </button>
                    ))}
                    <button
                        type="button"
                        className={`btn ${snapEnabled ? "btn-active" : ""}`}
                        onClick={() => {
                            setSnapEnabled((value) => {
                                const next = !value;
                                window.localStorage.setItem(SNAP_ENABLED_KEY, next ? "1" : "0");
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
                            }}
                        />
                    </label>
                    <label className="btn">
                        IMPORT
                        <input type="file" accept="application/json" hidden onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) {
                                importLayout(file);
                            }
                            event.target.value = "";
                        }} />
                    </label>
                    <button type="button" className="btn" onClick={exportLayout}>EXPORT</button>
                    <button type="button" className="btn btn-accent" onClick={saveLayout}>SAVE LAYOUT</button>
                </div>
                {canArrange && groupMode && activeGroup && (
                    <div className="layout-group-banner">
                        <span>
                            Grouping <strong>{activeGroup.name}</strong>
                            {" · "}
                            {activeGroup.memberIds.length} item{activeGroup.memberIds.length === 1 ? "" : "s"}
                            {" · tap the stage to add or remove"}
                        </span>
                        <button
                            type="button"
                            className="btn"
                            onClick={() => {
                                setGroupMode(false);
                                setMessage(activeGroup.memberIds.length
                                    ? `${activeGroup.memberIds.length} in “${activeGroup.name}”.`
                                    : "");
                            }}
                        >
                            DONE
                        </button>
                    </div>
                )}
                {mode === "grid" && stage === "performance" && (
                    <div className="row">
                        <label className="field">
                            <span>Rows</span>
                            <input type="number" min={1} max={8} value={rows}
                                onChange={(event) => setRows(Math.max(1, Number(event.target.value)))} />
                        </label>
                        <label className="field">
                            <span>Columns</span>
                            <input type="number" min={1} max={12} value={columns}
                                onChange={(event) => setColumns(Math.max(1, Number(event.target.value)))} />
                        </label>
                    </div>
                )}
                {message && <div className="muted">{message}</div>}
            </div>
            <div className="layout-editor-body">
                <aside className="layout-editor-inspector">
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
                                {groups.map((group) => (
                                    <button
                                        key={group.id}
                                        type="button"
                                        className={`layout-group-chip${activeGroupId === group.id ? " is-active" : ""}`}
                                        onClick={() => {
                                            const same = activeGroupId === group.id && groupMode;
                                            setActiveGroupId(group.id);
                                            setGroupMode(!same);
                                            setGroupName("");
                                            setMessage(same
                                                ? `${group.memberIds.length} in “${group.name}”.`
                                                : `Editing “${group.name}”. Tap widgets or controls to add or remove them.`);
                                        }}
                                    >
                                        <span>{group.name}</span>
                                        <small>{group.memberIds.length}</small>
                                    </button>
                                ))}
                            </div>
                            {activeGroup && (
                                <div className="layout-group-actions">
                                    <button
                                        type="button"
                                        className="btn btn-accent"
                                        disabled={activeGroup.memberIds.length < 2}
                                        onClick={matchActiveGroupSize}
                                    >
                                        MATCH SIZE
                                    </button>
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
                                        className="btn"
                                        onClick={() => {
                                            const groupId = ensureActiveGroup();
                                            setGroups((current) => current.map((group) => (
                                                group.id === groupId
                                                    ? { ...group, memberIds: [...visibleIds] }
                                                    : { ...group, memberIds: group.memberIds.filter((id) => !visibleIds.includes(id)) }
                                            )));
                                            setGroupMode(true);
                                            setMessage(`Added all ${visibleIds.length} items to “${activeGroup.name}”.`);
                                        }}
                                    >
                                        ADD ALL ON STAGE
                                    </button>
                                    <button type="button" className="btn btn-danger" onClick={deleteActiveGroup}>
                                        DELETE
                                    </button>
                                </div>
                            )}
                            {groups.length === 0 && (
                                <div className="muted">
                                    Add a group, then tap widgets and controls on the stage. Saved with SAVE LAYOUT.
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
                                        onClick={() => setSelectedId(widget.id)}
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
                    {controls.map((control) => (
                        <button
                            key={str(control.id)}
                            type="button"
                            className={`btn ${hidden.has(str(control.id)) ? "" : "btn-active"}`}
                            onClick={() => toggleHidden(str(control.id))}
                        >
                            {hidden.has(str(control.id)) ? "+ " : "✓ "}
                            {str(control.label, str(control.id))}
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
                                            switchLabel: str(control.label, id),
                                            valueText: caption,
                                            role: analog ? "utility" : roleForAction(action),
                                            lightState: "inactive",
                                            active: false,
                                            analog,
                                            analogSource: str(control.label, id),
                                            analogFunction: analog ? caption : undefined,
                                            assigned: analog ? caption !== "Unassigned" : undefined,
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
        </div>
    );
}

function functionCaption(control: JsonObject, chain: JsonObject[], presetBind?: JsonObject): string {
    const kind = normalizeControlKind(str(control.kind, "momentary"));
    if (isAnalogKind(kind)) {
        const info = analogFeedback(control, chain, presetBind);
        if (!info.parameter || info.parameter === "UNASSIGNED") {
            return "Unassigned";
        }
        return info.effect ? `${info.effect} · ${info.parameter}` : info.parameter;
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
