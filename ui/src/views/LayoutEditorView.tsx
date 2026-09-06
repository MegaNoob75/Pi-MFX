import { useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { EngineSnapshot } from "../api";
import { bool, num, obj, str, objects, type JsonObject } from "../json";
import {
    STATUS_WIDGET_IDS,
    STATUS_WIDGET_LABELS,
    analogMinSize,
    clampRect,
    gridCellRect,
    readStatusWidgets,
    snapRect,
    statusWidgetsToJson,
    unplacedIds,
    type LayoutRect,
    type StatusWidget
} from "../layout";

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
    const [widgets, setWidgets] = useState(() => readStatusWidgets(layout));
    const [draftRects, setDraftRects] = useState<Record<string, LayoutRect>>({});
    const [selectedId, setSelectedId] = useState("");
    const [snap, setSnap] = useState(true);
    const stageRef = useRef<HTMLDivElement>(null);
    const drag = useRef<{ id: string; startX: number; startY: number; rect: LayoutRect; last: LayoutRect } | null>(null);

    const mode = str(controller.layoutMode, "grid");
    const rows = Math.max(1, num(controller.gridRows, 2));
    const columns = Math.max(1, num(controller.gridColumns, 4));
    const hidden = new Set(unplacedIds(layout));

    const save = (next: JsonObject) => {
        void run(() => engine.client.request("controller/config", next));
    };

    const commitWidgets = (nextWidgets: Record<string, StatusWidget>, extra: JsonObject = {}) => {
        setWidgets(nextWidgets);
        save({
            ...controller,
            performanceLayout: {
                ...layout,
                elements: statusWidgetsToJson(nextWidgets),
                unplacedControlIds: extra.unplacedControlIds ?? layout.unplacedControlIds
            },
            ...extra
        });
    };

    const controlRect = (control: JsonObject, index: number): LayoutRect => {
        const id = str(control.id);
        if (draftRects[id]) {
            return draftRects[id];
        }
        const min = analogMinSize(str(control.kind, "switch"));
        return mode === "freeform"
            ? clampRect({
                x: num(control.x, gridCellRect(index, columns, rows).x),
                y: num(control.y, gridCellRect(index, columns, rows).y),
                width: Math.max(min.width, num(control.width, 0.18)),
                height: Math.max(min.height, num(control.height, 0.2))
            })
            : gridCellRect(index, columns, rows);
    };

    const onPointerDown = (id: string, rect: LayoutRect, event: ReactPointerEvent) => {
        if (mode !== "freeform") {
            return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id, startX: event.clientX, startY: event.clientY, rect, last: rect };
        setSelectedId(id);
    };

    const onPointerMove = (event: ReactPointerEvent) => {
        if (!drag.current || !stageRef.current) {
            return;
        }
        const box = stageRef.current.getBoundingClientRect();
        const dx = (event.clientX - drag.current.startX) / box.width;
        const dy = (event.clientY - drag.current.startY) / box.height;
        const next = snap
            ? snapRect({ ...drag.current.rect, x: drag.current.rect.x + dx, y: drag.current.rect.y + dy })
            : clampRect({ ...drag.current.rect, x: drag.current.rect.x + dx, y: drag.current.rect.y + dy });
        const id = drag.current.id;
        drag.current.last = next;
        if (STATUS_WIDGET_IDS.includes(id as typeof STATUS_WIDGET_IDS[number])) {
            setWidgets((current) => ({ ...current, [id]: { ...current[id], rect: next } }));
        } else {
            setDraftRects((current) => ({ ...current, [id]: next }));
        }
    };

    const onPointerUp = () => {
        if (!drag.current) {
            return;
        }
        const id = drag.current.id;
        const last = drag.current.last;
        drag.current = null;
        if (STATUS_WIDGET_IDS.includes(id as typeof STATUS_WIDGET_IDS[number])) {
            commitWidgets({
                ...widgets,
                [id]: { ...widgets[id], rect: last }
            });
            return;
        }
        setDraftRects((current) => ({ ...current, [id]: last }));
        save({
            ...controller,
            controls: controls.map((item) => str(item.id) === id
                ? { ...item, x: last.x, y: last.y, width: last.width, height: last.height }
                : item)
        });
    };

    const placedControls = useMemo(
        () => controls.filter((control) => !hidden.has(str(control.id))),
        [controls, hidden]
    );

    const toggleHidden = (id: string) => {
        const next = new Set(hidden);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        save({
            ...controller,
            performanceLayout: {
                ...layout,
                elements: statusWidgetsToJson(widgets),
                unplacedControlIds: [...next]
            }
        });
    };

    const exportLayout = () => {
        const payload = {
            format: "pimfx-layout",
            version: 1,
            layoutMode: mode,
            gridRows: rows,
            gridColumns: columns,
            performanceLayout: {
                ...layout,
                elements: statusWidgetsToJson(widgets)
            },
            controls: controls.map((control) => ({
                id: control.id,
                x: control.x,
                y: control.y,
                width: control.width,
                height: control.height
            }))
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
            const imported = objects(parsed.controls);
            save({
                ...controller,
                layoutMode: str(parsed.layoutMode, mode),
                gridRows: num(parsed.gridRows, rows),
                gridColumns: num(parsed.gridColumns, columns),
                performanceLayout: obj(parsed.performanceLayout),
                controls: controls.map((control) => {
                    const match = imported.find((item) => str(item.id) === str(control.id));
                    return match
                        ? { ...control, x: match.x, y: match.y, width: match.width, height: match.height }
                        : control;
                })
            });
            setWidgets(readStatusWidgets(obj(parsed.performanceLayout)));
        }).catch((error: unknown) => {
            window.alert(error instanceof Error ? error.message : String(error));
        });
    };

    return (
        <div className="page-scroll stack">
            <div className="panel stack">
                <h2>PERFORMANCE LAYOUT</h2>
                <div className="muted">
                    Grid lines up switches in rows. Freeform lets you drag tiles to match a
                    physical board. Layout does not change what a switch does.
                </div>
                <div className="row">
                    {(["grid", "freeform"] as const).map((item) => (
                        <button
                            key={item}
                            type="button"
                            className={`btn ${mode === item ? "btn-active" : ""}`}
                            onClick={() => save({ ...controller, layoutMode: item })}
                        >
                            {item.toUpperCase()}
                        </button>
                    ))}
                    <button type="button" className={`btn ${snap ? "btn-active" : ""}`} onClick={() => setSnap((value) => !value)}>
                        SNAP
                    </button>
                    <button type="button" className="btn" onClick={exportLayout}>DOWNLOAD</button>
                    <label className="btn">
                        UPLOAD
                        <input type="file" accept="application/json" hidden onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) {
                                importLayout(file);
                            }
                            event.target.value = "";
                        }} />
                    </label>
                </div>
                {mode === "grid" && (
                    <div className="row">
                        <label className="field">
                            <span>Rows</span>
                            <input type="number" min={1} max={8} value={rows}
                                onChange={(event) => save({ ...controller, gridRows: Number(event.target.value) })} />
                        </label>
                        <label className="field">
                            <span>Columns</span>
                            <input type="number" min={1} max={12} value={columns}
                                onChange={(event) => save({ ...controller, gridColumns: Number(event.target.value) })} />
                        </label>
                    </div>
                )}
            </div>

            <div className="panel stack">
                <h2>STATUS WIDGETS</h2>
                <div className="row" style={{ flexWrap: "wrap" }}>
                    {STATUS_WIDGET_IDS.map((id) => (
                        <button
                            key={id}
                            type="button"
                            className={`btn ${widgets[id].visible ? "btn-active" : ""}`}
                            onClick={() => commitWidgets({
                                ...widgets,
                                [id]: { ...widgets[id], visible: !widgets[id].visible }
                            })}
                        >
                            {STATUS_WIDGET_LABELS[id]}
                        </button>
                    ))}
                </div>
            </div>

            <div className="panel stack">
                <h2>SWITCHES ON THIS BOARD</h2>
                <div className="row" style={{ flexWrap: "wrap" }}>
                    {controls.map((control) => (
                        <button
                            key={str(control.id)}
                            type="button"
                            className={`btn ${hidden.has(str(control.id)) ? "" : "btn-active"}`}
                            onClick={() => toggleHidden(str(control.id))}
                        >
                            {str(control.label, str(control.id))}
                        </button>
                    ))}
                    {controls.length === 0 && <div className="muted">Add controls in Settings → Controller.</div>}
                </div>
            </div>

            <div
                ref={stageRef}
                className="layout-stage"
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                {STATUS_WIDGET_IDS.filter((id) => widgets[id].visible).map((id) => {
                    const widget = widgets[id];
                    return (
                        <button
                            key={id}
                            type="button"
                            className={`layout-item status${selectedId === id ? " selected" : ""}`}
                            style={rectStyle(widget.rect)}
                            onPointerDown={(event) => onPointerDown(id, widget.rect, event)}
                        >
                            {STATUS_WIDGET_LABELS[id]}
                        </button>
                    );
                })}
                {placedControls.map((control, index) => {
                    const id = str(control.id);
                    const rect = controlRect(control, index);
                    return (
                        <button
                            key={id}
                            type="button"
                            className={`layout-item switch${selectedId === id ? " selected" : ""}`}
                            style={rectStyle(rect)}
                            onPointerDown={(event) => onPointerDown(id, rect, event)}
                        >
                            {str(control.label, id)}
                        </button>
                    );
                })}
            </div>
            <div className="muted">
                {bool(controller.mirrorLayoutOnScreen, true)
                    ? "This layout is what the Performance screen shows."
                    : "Turn on mirror layout in Controller settings to show this on Performance."}
            </div>
        </div>
    );
}

function rectStyle(rect: LayoutRect): CSSProperties {
    return {
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.width * 100}%`,
        height: `${rect.height * 100}%`
    };
}
