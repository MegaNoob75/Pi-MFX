import { findBank, findPreset, formatMs, peakDb, type EngineSnapshot } from "../api";
import { bool, num, obj, str, objects } from "../json";
import { askText } from "../keyboard/ask";

export function PerformanceView({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const { client, state, meters } = engine;
    const bank = findBank(state);
    const preset = findPreset(state);
    const ui = obj(state.ui);
    const controller = obj(state.controller);
    const controls = objects(controller.controls);
    const presets = objects(obj(bank).presets);
    const snapshots = objects(obj(preset).snapshots);
    const switchCount = Math.max(1, num(ui.virtualSwitchCount, 8));
    const rows = Math.max(1, num(controller.gridRows, 2));
    const columns = Math.max(1, num(controller.gridColumns, 4));
    const bypassAll = bool(state.bypassAll);
    const tuner = obj(meters.tuner);
    const showTuner = bool(ui.showTuner, true);
    const showLatency = bool(ui.showLatencyMeter, true);

    const pressControl = (id: string, pressed: boolean) => {
        void run(() => client.request("controller/press", { controlId: id, pressed }));
    };

    return (
        <div className="performance">
            <div className="panel identity">
                <div>
                    <div className="field-label">BANK</div>
                    <h1>{str(obj(bank).name, "No bank")}</h1>
                    <div className="muted">{str(obj(preset).name, "No preset")}</div>
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
                    <button type="button" className="btn btn-accent" onClick={() => void run(() => client.request("tap"))}>
                        TAP {num(obj(preset).tempo, 120).toFixed(1)}
                    </button>
                </div>
            </div>

            <div
                className="switch-grid"
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(88px, 1fr))` }}
            >
                {controls.length > 0
                    ? controls.map((control) => {
                        const binding = obj(control.binding);
                        const active = str(binding.presetId) === str(state.activePresetId)
                            || (str(binding.action) === "bypassAll" && bypassAll);
                        return (
                            <button
                                key={str(control.id)}
                                type="button"
                                className={`footswitch${active ? " active" : ""}`}
                                onPointerDown={() => pressControl(str(control.id), true)}
                                onPointerUp={() => pressControl(str(control.id), false)}
                                onPointerLeave={() => pressControl(str(control.id), false)}
                            >
                                <span className="led" />
                                <span className="label">{str(control.label, str(control.id))}</span>
                            </button>
                        );
                    })
                    : Array.from({ length: Math.min(switchCount, rows * columns) }, (_, index) => {
                        const item = presets[index];
                        const active = item && str(item.id) === str(state.activePresetId);
                        return (
                            <button
                                key={item ? str(item.id) : `empty-${index}`}
                                type="button"
                                className={`footswitch${active ? " active" : ""}`}
                                disabled={!item}
                                onClick={() => {
                                    if (item) {
                                        void run(() => client.request("preset/select", {
                                            bankId: str(obj(bank).id),
                                            presetId: str(item.id)
                                        }));
                                    }
                                }}
                            >
                                <span className="led" />
                                <span className="label">{item ? str(item.name) : "—"}</span>
                            </button>
                        );
                    })}
            </div>

            {snapshots.length > 0 && (
                <div className="row">
                    {snapshots.map((snapshot, index) => (
                        <button
                            key={str(snapshot.id)}
                            type="button"
                            className={`btn ${num(obj(preset).activeSnapshot, -1) === index ? "btn-active" : ""}`}
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
                </div>
            )}

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

function Meter({ label, value, text }: { label: string; value: number; text: string }) {
    const width = Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
    return (
        <div style={{ minWidth: 120, flex: 1 }}>
            <div className="field-label">{label} {text}</div>
            <div className="meter-bar"><span style={{ width: `${width}%` }} /></div>
        </div>
    );
}
