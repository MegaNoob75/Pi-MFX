import type { CSSProperties } from "react";
import { findBank, findPreset, formatMs, isAnalogKind, peakDb, type EngineSnapshot } from "../api";
import { bool, num, obj, str, objects } from "../json";
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
import { analogFeedback, PerformanceControl, type PerformanceTile } from "./PerformanceControl";

export function PerformanceView({
    engine,
    run,
    onSnapshots
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    onSnapshots?: () => void;
}) {
    const { client, state, meters } = engine;
    const bank = findBank(state);
    const preset = findPreset(state);
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
    const showTuner = bool(ui.showTuner, true);
    const showLatency = bool(ui.showLatencyMeter, true);
    const layoutMode = str(controller.layoutMode, "grid");
    const mirror = bool(controller.mirrorLayoutOnScreen, true);
    const switchStyle = document.documentElement.dataset.mfxSwitchStyle || "tiles";

    const positions = obj(state.controlPositions);
    const chain = objects(state.chain);
    const feedbackOn = loadUiBehavior().parameterFeedback;

    const assigned = (controlId: string) => {
        const bankMap = obj(obj(controller.presetAssignments)[str(bank?.id)]);
        return str(bankMap[controlId]);
    };

    const pressControl = (id: string, pressed: boolean) => {
        void client.request("controller/press", { controlId: id, pressed }).catch(() => undefined);
    };

    const visibleControls = controls.filter((control) => !hidden.has(str(control.id)));
    const useConfigured = visibleControls.length > 0 && (mirror || controls.length > 0);

    const tiles: PerformanceTile[] = snapshotMode
        ? snapshots.map((snapshot, index) => ({
            id: str(snapshot.id),
            label: str(snapshot.name, `SNAP ${index + 1}`),
            active: num(obj(preset).activeSnapshot, -1) === index,
            color: str(snapshot.color),
            rect: gridCellRect(index, 3, 2),
            onPress: () => void run(() => client.request("snapshot/select", { snapshotId: str(snapshot.id) }))
        }))
        : useConfigured
            ? visibleControls.map((control, index) => {
                const binding = obj(control.binding);
                const assignedPreset = assigned(str(control.id));
                const presetId = assignedPreset || str(binding.presetId);
                const kind = str(control.kind, "switch");
                const analog = isAnalogKind(kind);
                const minSize = analogMinSize(kind);
                const active = presetId === str(state.activePresetId)
                    || (str(binding.action) === "bypassAll" && bypassAll)
                    || (str(binding.action) === "snapshotMode" && snapshotMode)
                    || (str(binding.action) === "toggleEffect" && bool(
                        obj(chain.find((slot) => str(slot.id) === str(binding.slotId))).enabled,
                        true
                    ));
                return {
                    id: str(control.id),
                    label: str(control.label, str(control.id)),
                    active,
                    color: "",
                    kind,
                    analog,
                    value: num(positions[str(control.id)], analog ? 0 : (active ? 1 : 0)),
                    feedback: feedbackOn ? analogFeedback(control, chain) : "",
                    rect: layoutMode === "freeform"
                        ? clampRect({
                            x: num(control.x, gridCellRect(index, columns, rows).x),
                            y: num(control.y, gridCellRect(index, columns, rows).y),
                            width: Math.max(minSize.width, num(control.width, 0.18)),
                            height: Math.max(minSize.height, num(control.height, 0.2))
                        })
                        : gridCellRect(index, columns, rows),
                    onPress: () => {
                        if (presetId && str(binding.action, "selectPreset") === "selectPreset") {
                            void run(() => client.request("preset/select", {
                                bankId: str(obj(bank).id),
                                presetId
                            }));
                            return;
                        }
                        pressControl(str(control.id), true);
                        window.setTimeout(() => pressControl(str(control.id), false), 80);
                    },
                    onValue: analog
                        ? (value: number) => {
                            void client.request("controller/value", {
                                controlId: str(control.id),
                                value
                            }).catch(() => undefined);
                        }
                        : undefined
                };
            })
            : Array.from({ length: Math.min(switchCount, rows * columns) }, (_, index) => {
                const item = presets[index];
                return {
                    id: item ? str(item.id) : `empty-${index}`,
                    label: item ? str(item.name) : "—",
                    active: !!(item && str(item.id) === str(state.activePresetId)),
                    color: "",
                    rect: gridCellRect(index, columns, rows),
                    onPress: () => {
                        if (item) {
                            void run(() => client.request("preset/select", {
                                bankId: str(obj(bank).id),
                                presetId: str(item.id)
                            }));
                        }
                    }
                };
            });

    return (
        <div className="performance">
            <div className="panel identity">
                <div>
                    <div className="field-label">BANK</div>
                    <h1 className="marquee">{str(obj(bank).name, "No bank")}</h1>
                    <div className="muted marquee">{str(obj(preset).name, "No preset")}</div>
                </div>
                <div className="row">
                    <button type="button" className="btn" onClick={() => void run(() => client.request("bank/step", { delta: -1 }))}>BANK −</button>
                    <button type="button" className="btn" onClick={() => void run(() => client.request("bank/step", { delta: 1 }))}>BANK +</button>
                    <button type="button" className="btn" onClick={() => void run(() => client.request("preset/step", { delta: -1 }))}>PRESET −</button>
                    <button type="button" className="btn" onClick={() => void run(() => client.request("preset/step", { delta: 1 }))}>PRESET +</button>
                    <button
                        type="button"
                        className={`btn ${bypassAll ? "btn-danger" : ""}`}
                        onClick={() => void run(() => client.request("chain/bypass", { bypassed: !bypassAll }))}
                    >
                        {bypassAll ? "BYPASSED" : "BYPASS"}
                    </button>
                    <button
                        type="button"
                        className={`btn ${snapshotMode ? "btn-active" : ""}`}
                        onClick={() => void run(() => client.request("snapshot/mode", { enabled: !snapshotMode }))}
                    >
                        SNAPS
                    </button>
                    <button type="button" className="btn btn-accent" onClick={() => void run(() => client.request("tap"))}>
                        TAP {num(obj(preset).tempo, 120).toFixed(1)}
                    </button>
                </div>
            </div>

            <div className={`performance-stage ${layoutMode}`}>
                {STATUS_WIDGET_IDS.filter((id) => widgets[id].visible).map((id) => {
                    const widget = widgets[id];
                    const text = widgetText(id, {
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
                    });
                    return (
                        <div key={id} className="status-widget" style={rectStyle(widget.rect)}>
                            {widget.showLabel && <div className="field-label">{STATUS_WIDGET_LABELS[id]}</div>}
                            <strong className="marquee">{text}</strong>
                        </div>
                    );
                })}

                {layoutMode === "grid"
                    ? (
                        <div
                            className="switch-grid"
                            style={{
                                gridTemplateColumns: `repeat(${snapshotMode ? Math.min(3, Math.max(1, snapshots.length || 1)) : columns}, minmax(0, 1fr))`,
                                gridTemplateRows: `repeat(${snapshotMode ? 2 : rows}, minmax(88px, 1fr))`
                            }}
                        >
                            {tiles.map((tile) => (
                                <PerformanceControl key={tile.id} tile={tile} switchStyle={switchStyle} bypassed={bypassAll} />
                            ))}
                        </div>
                    )
                    : tiles.map((tile) => (
                        <div key={tile.id} className="freeform-slot" style={tile.rect ? rectStyle(tile.rect) : undefined}>
                            <PerformanceControl tile={tile} switchStyle={switchStyle} bypassed={bypassAll} />
                        </div>
                    ))}
            </div>

            <div className="row">
                {snapshots.map((snapshot, index) => (
                    <button
                        key={str(snapshot.id)}
                        type="button"
                        className={`btn ${num(obj(preset).activeSnapshot, -1) === index ? "btn-active" : ""}`}
                        style={str(snapshot.color) ? { borderColor: str(snapshot.color) } : undefined}
                        onClick={() => void run(() => client.request("snapshot/select", { snapshotId: str(snapshot.id) }))}
                    >
                        {str(snapshot.name, `SNAP ${index + 1}`)}
                    </button>
                ))}
                <button type="button" className="btn" onClick={() => {
                    void askText("Snapshot name", `Snap ${snapshots.length + 1}`).then((name) => {
                        if (name?.trim()) {
                            void run(() => client.request("snapshot/capture", { name: name.trim() }));
                        }
                    });
                }}>CAPTURE</button>
                {onSnapshots && <button type="button" className="btn" onClick={onSnapshots}>MANAGE</button>}
            </div>

            <div className="panel">
                <div className="row">
                    {showLatency && (
                        <>
                            <Meter label="DSP" value={num(meters.dspLoad)} text={`${(num(meters.dspLoad) * 100).toFixed(0)}%`} />
                            <div>
                                <div className="field-label">ROUND TRIP</div>
                                <strong>{formatMs(num(meters.roundTripMs))}</strong>
                                <div className="muted">{num(meters.xruns)} xruns · {formatMs(num(meters.bufferMs))} buffer</div>
                            </div>
                        </>
                    )}
                    <Meter label="IN" value={num(meters.inputPeak)} text={peakDb(num(meters.inputPeak))} />
                    <Meter label="OUT" value={num(meters.outputPeak)} text={peakDb(num(meters.outputPeak))} />
                    {showTuner && (
                        <div>
                            <div className="field-label">TUNER</div>
                            <strong>{bool(tuner.valid) ? `${str(tuner.note)} ${num(tuner.cents) >= 0 ? "+" : ""}${num(tuner.cents).toFixed(0)}¢` : "—"}</strong>
                            <div className="muted">{bool(tuner.valid) ? `${num(tuner.frequency).toFixed(1)} Hz` : "waiting"}</div>
                        </div>
                    )}
                    <button type="button" className="btn" onClick={() => void run(() => client.request("meters/reset"))}>RESET</button>
                    <button
                        type="button"
                        className={`btn ${bool(tuner.enabled) ? "btn-active" : ""}`}
                        onClick={() => void run(() => client.request("tuner", { enabled: !bool(tuner.enabled) }))}
                    >
                        TUNER
                    </button>
                </div>
            </div>
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

function Meter({ label, value, text }: { label: string; value: number; text: string }) {
    const width = `${Math.max(0, Math.min(1, value)) * 100}%`;
    return (
        <div className="meter">
            <div className="field-label">{label}</div>
            <div className="meter-track"><div className="meter-fill" style={{ width }} /></div>
            <strong>{text}</strong>
        </div>
    );
}
