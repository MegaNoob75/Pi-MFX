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
    type LayoutRect
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
    const [mode, setMode] = useState<"grid" | "freeform">(
        str(controller.layoutMode, "grid") === "freeform" ? "freeform" : "grid"
    );
    const [rows, setRows] = useState(() => Math.max(1, num(controller.gridRows, 2)));
    const [columns, setColumns] = useState(() => Math.max(1, num(controller.gridColumns, 4)));
    const [widgets, setWidgets] = useState(() => readStatusWidgets(layout));
    const [hiddenIds, setHiddenIds] = useState(() => unplacedIds(layout));
    const [draftRects, setDraftRects] = useState<Record<string, LayoutRect>>({});
    const [selectedId, setSelectedId] = useState("");
    const [snap, setSnap] = useState(true);
    const [message, setMessage] = useState("");
    const stageRef = useRef<HTMLDivElement>(null);
    const drag = useRef<{ id: string; startX: number; startY: number; rect: LayoutRect; last: LayoutRect } | null>(null);

    const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);

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
        setMessage("");
    };

    const onPointerUp = () => {
        if (!drag.current) {
            return;
        }
        const id = drag.current.id;
        const last = drag.current.last;
        drag.current = null;
        if (STATUS_WIDGET_IDS.includes(id as typeof STATUS_WIDGET_IDS[number])) {
            setWidgets((current) => ({
                ...current,
                [id]: { ...current[id], rect: last }
            }));
            return;
        }
        setDraftRects((current) => ({ ...current, [id]: last }));
    };

    const placedControls = useMemo(
        () => controls.filter((control) => !hidden.has(str(control.id))),
        [controls, hidden]
    );

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
                unplacedControlIds: hiddenIds
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
            setMode(str(parsed.layoutMode, mode) === "freeform" ? "freeform" : "grid");
            setRows(Math.max(1, num(parsed.gridRows, rows)));
            setColumns(Math.max(1, num(parsed.gridColumns, columns)));
            setWidgets(readStatusWidgets(importedLayout));
            setHiddenIds(unplacedIds(importedLayout));
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
            setMessage("Layout imported. Choose SAVE LAYOUT to apply it.");
        }).catch((error: unknown) => {
            window.alert(error instanceof Error ? error.message : String(error));
        });
    };

    return (
        <div className="layout-editor">
            <div className="layout-editor-toolbar">
                <div>
                    <div className="layout-editor-title">PERFORMANCE LAYOUT</div>
                    <div className="muted">
                        Arrange switches, pots and status panels. Layout does not change what a switch does.
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
                                setMessage("");
                            }}
                        >
                            {item.toUpperCase()}
                        </button>
                    ))}
                    <button type="button" className={`btn ${snap ? "btn-active" : ""}`} onClick={() => setSnap((value) => !value)}>
                        SNAP
                    </button>
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
                {mode === "grid" && (
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
                    <div className="field-label">ELEMENTS</div>
                    {STATUS_WIDGET_IDS.map((id) => (
                        <button
                            key={id}
                            type="button"
                            className={`btn ${widgets[id].visible ? "btn-active" : ""}`}
                            onClick={() => toggleWidget(id)}
                        >
                            {STATUS_WIDGET_LABELS[id]}
                        </button>
                    ))}
                    <div className="field-label" style={{ marginTop: 12 }}>SWITCHES</div>
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
                    {controls.length === 0 && <div className="muted">Add controls in Hardware Setup.</div>}
                </aside>
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
            </div>
            <div className="muted" style={{ padding: "0 12px 8px" }}>
                {bool(controller.mirrorLayoutOnScreen, true)
                    ? "This layout is what the Performance screen shows."
                    : "Turn on mirror layout in Hardware Setup to show this on Performance."}
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
