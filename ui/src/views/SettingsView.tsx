import { useEffect, useState } from "react";
import { formatMs, type EngineSnapshot } from "../api";
import { arr, bool, num, obj, str, objects, type JsonObject } from "../json";
import { loadKeyboardMode, saveKeyboardMode, type KeyboardMode } from "../keyboard/mode";

export type SettingsPage = "audio" | "controller" | "ui" | "library" | "system";

export function SettingsHub({ onOpen }: { onOpen: (page: SettingsPage) => void }) {
    return (
        <div className="page-scroll">
            <div className="grid-cards">
                <HubCard title="AUDIO" subtitle="Card, sample rate, period size and measured latency" onClick={() => onOpen("audio")} />
                <HubCard title="CONTROLLER" subtitle="MIDI floorboard layout and virtual switches" onClick={() => onOpen("controller")} />
                <HubCard title="UI" subtitle="Tuner, meters, on-screen keyboard and switch count" onClick={() => onOpen("ui")} />
                <HubCard title="LIBRARY" subtitle="NAM models and impulse responses" onClick={() => onOpen("library")} />
                <HubCard title="SYSTEM" subtitle="Realtime threads, diagnostics and rescan" onClick={() => onOpen("system")} />
            </div>
        </div>
    );
}

function HubCard({ title, subtitle, onClick }: { title: string; subtitle: string; onClick: () => void }) {
    return (
        <button type="button" className="hub-card" onClick={onClick}>
            <strong>{title}</strong>
            <span>{subtitle}</span>
        </button>
    );
}

export function SettingsPage({
    page,
    engine,
    run
}: {
    page: SettingsPage;
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    if (page === "audio") {
        return <AudioSettings engine={engine} run={run} />;
    }
    if (page === "controller") {
        return <ControllerSettings engine={engine} run={run} />;
    }
    if (page === "ui") {
        return <UiSettings engine={engine} run={run} />;
    }
    if (page === "library") {
        return <LibrarySettings engine={engine} run={run} />;
    }
    return <SystemSettings engine={engine} run={run} />;
}

function AudioSettings({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const { client, state, meters, connected } = engine;
    const audio = obj(state.audio);
    const [devices, setDevices] = useState<JsonObject[]>([]);
    const [draft, setDraft] = useState(audio);
    const [deviceError, setDeviceError] = useState("");

    useEffect(() => {
        setDraft(obj(state.audio));
    }, [state.audio]);

    const refreshDevices = () => {
        void client.request("audio/devices").then((result) => {
            setDevices(objects(result.devices));
            setDeviceError(objects(result.devices).length === 0
                ? "No cards reported. On the Pi run arecord -l, then check journalctl -u pimfx."
                : "");
        }).catch((error: unknown) => {
            setDeviceError(error instanceof Error ? error.message : String(error));
        });
    };

    useEffect(() => {
        refreshDevices();
    }, [client, connected]);

    const selected = devices.find((device) => str(device.id) === str(draft.device)) ?? devices[0];
    const rates = arr(obj(selected).sampleRates).filter((value): value is number => typeof value === "number");
    const periods = arr(obj(selected).periodSizes).filter((value): value is number => typeof value === "number");

    const set = (key: string, value: string | number | boolean) => {
        setDraft((current) => ({ ...current, [key]: value }));
    };

    return (
        <div className="page-scroll stack">
            <div className="panel stack">
                <h2>AUDIO DEVICE</h2>
                {str(state.audioError) && <div className="danger">{str(state.audioError)}</div>}
                {deviceError && <div className="danger">{deviceError}</div>}
                <label className="field">
                    <span>Playback / duplex card</span>
                    <select value={str(draft.device)} onChange={(event) => set("device", event.target.value)}>
                        {devices.length === 0 && <option value={str(draft.device)}>{str(draft.device) || "No devices yet"}</option>}
                        {devices.map((device) => (
                            <option key={str(device.id)} value={str(device.id)}>
                                {str(device.name)}
                                {bool(device.isHat) ? " (HAT)" : ""}
                                {bool(device.duplex) ? " · duplex" : bool(device.maxInputChannels) ? " (in)" : " (out)"}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="row">
                    <label className="field">
                        <span>Sample rate</span>
                        <select value={num(draft.sampleRate, 48000)} onChange={(event) => set("sampleRate", Number(event.target.value))}>
                            {(rates.length ? rates : [44100, 48000, 96000]).map((rate) => (
                                <option key={rate} value={rate}>{rate}</option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span>Period frames</span>
                        <select value={num(draft.periodFrames, 64)} onChange={(event) => set("periodFrames", Number(event.target.value))}>
                            {(periods.length ? periods : [32, 64, 128, 256]).map((size) => (
                                <option key={size} value={size}>{size}</option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span>Period count</span>
                        <select value={num(draft.periodCount, 3)} onChange={(event) => set("periodCount", Number(event.target.value))}>
                            {[2, 3, 4, 6, 8].map((count) => (
                                <option key={count} value={count}>{count}</option>
                            ))}
                        </select>
                    </label>
                </div>
                <div className="row">
                    <label className="field">
                        <span>Input gain (dB)</span>
                        <input type="number" value={num(draft.inputGainDb)} onChange={(event) => set("inputGainDb", Number(event.target.value))} />
                    </label>
                    <label className="field">
                        <span>Output gain (dB)</span>
                        <input type="number" value={num(draft.outputGainDb)} onChange={(event) => set("outputGainDb", Number(event.target.value))} />
                    </label>
                </div>
                <div className="muted">
                    Requested buffer {formatMs(num(draft.bufferMs))} · measured {formatMs(num(meters.roundTripMs))} · {num(meters.xruns)} xruns
                </div>
                <div className="row">
                    <button type="button" className="btn btn-accent" onClick={() => void run(() => client.request("audio/settings", draft))}>
                        APPLY
                    </button>
                    <button type="button" className="btn" onClick={() => refreshDevices()}>
                        RESCAN CARDS
                    </button>
                    <button type="button" className="btn" onClick={() => void run(() => client.request("meters/reset"))}>
                        RESET XRUNS
                    </button>
                </div>
            </div>
        </div>
    );
}

function ControllerSettings({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const { client, state } = engine;
    const controller = obj(state.controller);
    const controls = objects(controller.controls);
    const [ports, setPorts] = useState<JsonObject[]>([]);

    useEffect(() => {
        void client.request("midi/ports").then((result) => {
            setPorts(objects(result.ports));
        }).catch(() => undefined);
    }, [client, controller.midiPort]);

    const save = (next: JsonObject) => {
        void run(() => client.request("controller/config", next));
    };

    return (
        <div className="page-scroll stack">
            <div className="panel stack">
                <h2>FLOORBOARD</h2>
                {str(state.controllerError) && <div className="danger">{str(state.controllerError)}</div>}
                <label className="field">
                    <span>Name</span>
                    <input
                        key={str(controller.name)}
                        defaultValue={str(controller.name)}
                        onBlur={(event) => save({ ...controller, name: event.target.value })}
                    />
                </label>
                <label className="field">
                    <span>MIDI port</span>
                    <select
                        value={str(controller.midiPort)}
                        onChange={(event) => {
                            const port = event.target.value;
                            save({ ...controller, midiPort: port, enabled: true });
                            void run(() => client.request("controller/connect", { port }));
                        }}
                    >
                        <option value="">First controller that identifies itself</option>
                        {ports.map((port) => (
                            <option key={str(port.id)} value={str(port.id)}>
                                {str(port.name)}{bool(port.looksLikeController) ? " · controller" : ""}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="row">
                    <label className="field">
                        <span>Grid rows</span>
                        <input type="number" min={1} max={8} value={num(controller.gridRows, 2)}
                            onChange={(event) => save({ ...controller, gridRows: Number(event.target.value) })} />
                    </label>
                    <label className="field">
                        <span>Grid columns</span>
                        <input type="number" min={1} max={12} value={num(controller.gridColumns, 4)}
                            onChange={(event) => save({ ...controller, gridColumns: Number(event.target.value) })} />
                    </label>
                </div>
                <div className="row">
                    <button type="button" className={`btn ${bool(controller.enabled) ? "btn-active" : ""}`}
                        onClick={() => save({ ...controller, enabled: !bool(controller.enabled) })}>
                        {bool(controller.enabled) ? "ENABLED" : "DISABLED"}
                    </button>
                    <button type="button" className="btn" onClick={() => void run(() => client.request("controller/disconnect"))}>
                        DISCONNECT
                    </button>
                </div>
            </div>

            <div className="panel stack">
                <h2>CONTROLS</h2>
                <button type="button" className="btn btn-accent" onClick={() => {
                    const nextId = `ctl-${Date.now().toString(36)}`;
                    save({
                        ...controller,
                        controls: [
                            ...controls,
                            {
                                id: nextId,
                                label: `SW ${controls.length + 1}`,
                                kind: "switch",
                                row: Math.floor(controls.length / num(controller.gridColumns, 4)),
                                column: controls.length % num(controller.gridColumns, 4),
                                binding: { action: "presetUp", min: 0, max: 1, inverted: false }
                            }
                        ]
                    });
                }}>ADD SWITCH</button>
                {controls.map((control, index) => (
                    <div key={str(control.id)} className="list-item" style={{ flexWrap: "wrap" }}>
                        <input
                            className="input"
                            style={{ maxWidth: 160 }}
                            defaultValue={str(control.label)}
                            onBlur={(event) => {
                                const next = controls.slice();
                                next[index] = { ...control, label: event.target.value };
                                save({ ...controller, controls: next });
                            }}
                        />
                        <select
                            value={str(obj(control.binding).action, "none")}
                            onChange={(event) => {
                                const next = controls.slice();
                                next[index] = { ...control, binding: { ...obj(control.binding), action: event.target.value } };
                                save({ ...controller, controls: next });
                            }}
                        >
                            {["none", "presetUp", "presetDown", "bankUp", "bankDown", "selectPreset", "selectSnapshot", "toggleEffect", "bypassAll", "tapTempo", "tuner"].map((action) => (
                                <option key={action} value={action}>{action}</option>
                            ))}
                        </select>
                        <button type="button" className="btn" onClick={() => void run(() => client.request("controller/learn", { controlId: str(control.id) }))}>
                            {bool(controller.learning) && str(controller.learningControlId) === str(control.id) ? "LISTENING…" : "LEARN"}
                        </button>
                        <button type="button" className="btn btn-danger" onClick={() => {
                            save({ ...controller, controls: controls.filter((item) => str(item.id) !== str(control.id)) });
                        }}>REMOVE</button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function UiSettings({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const ui = obj(engine.state.ui);
    const [keyboardMode, setKeyboardMode] = useState<KeyboardMode>(loadKeyboardMode);
    const save = (next: JsonObject) => {
        void run(() => engine.client.request("ui/settings", next));
    };
    const setMode = (mode: KeyboardMode) => {
        saveKeyboardMode(mode);
        setKeyboardMode(mode);
    };
    return (
        <div className="page-scroll stack">
            <div className="panel stack">
                <h2>ON-SCREEN SURFACE</h2>
                <label className="field">
                    <span>Virtual switches (when no floorboard is connected)</span>
                    <input type="number" min={1} max={64} value={num(ui.virtualSwitchCount, 8)}
                        onChange={(event) => save({ ...ui, virtualSwitchCount: Number(event.target.value) })} />
                </label>
                <div className="row">
                    <button type="button" className={`btn ${bool(ui.showTuner, true) ? "btn-active" : ""}`}
                        onClick={() => save({ ...ui, showTuner: !bool(ui.showTuner, true) })}>TUNER</button>
                    <button type="button" className={`btn ${bool(ui.showLatencyMeter, true) ? "btn-active" : ""}`}
                        onClick={() => save({ ...ui, showLatencyMeter: !bool(ui.showLatencyMeter, true) })}>LATENCY</button>
                </div>
            </div>
            <div className="panel stack">
                <h2>ON-SCREEN KEYBOARD</h2>
                <div className="muted">Auto shows it on the Pi touchscreen and stays out of the way on phones.</div>
                <div className="row">
                    {(["auto", "on", "off"] as KeyboardMode[]).map((mode) => (
                        <button
                            key={mode}
                            type="button"
                            className={`btn ${keyboardMode === mode ? "btn-active" : ""}`}
                            onClick={() => setMode(mode)}
                        >
                            {mode.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

function LibrarySettings({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const models = objects(engine.library.models);
    const irs = objects(engine.library.impulseResponses);

    const upload = (kind: "model" | "ir", file: File) => {
        void run(async () => {
            const data = await readBase64(file);
            await engine.client.request("library/upload", { kind: kind === "ir" ? "ir" : "model", name: file.name, data });
            await engine.client.request("library");
        });
    };

    return (
        <div className="page-scroll stack">
            <LibraryList title="NAM MODELS" kind="model" files={models} onUpload={upload} onDelete={(path) => {
                void run(() => engine.client.request("library/delete", { path }));
            }} />
            <LibraryList title="IMPULSE RESPONSES" kind="ir" files={irs} onUpload={upload} onDelete={(path) => {
                void run(() => engine.client.request("library/delete", { path }));
            }} />
        </div>
    );
}

function LibraryList({
    title,
    kind,
    files,
    onUpload,
    onDelete
}: {
    title: string;
    kind: "model" | "ir";
    files: JsonObject[];
    onUpload: (kind: "model" | "ir", file: File) => void;
    onDelete: (path: string) => void;
}) {
    return (
        <div className="panel stack">
            <h2>{title}</h2>
            <input type="file" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                    onUpload(kind, file);
                }
            }} />
            {files.map((file) => (
                <div key={str(file.path)} className="list-item">
                    <div>
                        <strong>{str(file.name)}</strong>
                        <div className="muted">{str(file.source)} · {Math.round(num(file.bytes) / 1024)} KB</div>
                    </div>
                    <button type="button" className="btn btn-danger" onClick={() => onDelete(str(file.path))}>DELETE</button>
                </div>
            ))}
            {files.length === 0 && <div className="muted">Nothing stored yet.</div>}
        </div>
    );
}

function SystemSettings({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const system = obj(engine.state.system);
    const [diagnostics, setDiagnostics] = useState<JsonObject>({});

    useEffect(() => {
        void engine.client.request("diagnostics").then(setDiagnostics).catch(() => undefined);
    }, [engine.client, engine.state.system]);

    const save = (next: JsonObject) => {
        void run(() => engine.client.request("system/settings", next));
    };

    return (
        <div className="page-scroll stack">
            <div className="panel stack">
                <h2>REALTIME</h2>
                <div className="row">
                    <button type="button" className={`btn ${bool(system.pinAudioThread, true) ? "btn-active" : ""}`}
                        onClick={() => save({ ...system, pinAudioThread: !bool(system.pinAudioThread, true) })}>
                        PIN AUDIO THREAD
                    </button>
                    <button type="button" className={`btn ${bool(system.lockMemory, true) ? "btn-active" : ""}`}
                        onClick={() => save({ ...system, lockMemory: !bool(system.lockMemory, true) })}>
                        LOCK MEMORY
                    </button>
                    <button type="button" className={`btn ${bool(system.holdCpuLatency, true) ? "btn-active" : ""}`}
                        onClick={() => save({ ...system, holdCpuLatency: !bool(system.holdCpuLatency, true) })}>
                        HOLD CPU LATENCY
                    </button>
                </div>
                <label className="field">
                    <span>Audio CPU (0-based)</span>
                    <input type="number" min={0} max={7} value={num(system.audioCpu, 3)}
                        onChange={(event) => save({ ...system, audioCpu: Number(event.target.value) })} />
                </label>
            </div>
            <div className="panel stack">
                <h2>PLUGINS</h2>
                <div className="muted">{num(engine.state.pluginCount)} plugins · LV2 {bool(engine.state.lv2Available, true) ? "available" : "not available"}</div>
                <button type="button" className="btn" onClick={() => void run(() => engine.client.request("plugins/rescan"))}>
                    RESCAN LV2
                </button>
            </div>
            <div className="panel">
                <h2>DIAGNOSTICS</h2>
                <pre className="muted" style={{ whiteSpace: "pre-wrap" }}>
                    {str(diagnostics.tuning, "waiting…")}
                    {"\n"}backend {str(diagnostics.audioBackend)} · {str(diagnostics.cpuLatency)}
                    {"\n"}data {str(diagnostics.dataRoot)}
                </pre>
            </div>
        </div>
    );
}

function readBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("could not read that file"));
        reader.onload = () => {
            const text = String(reader.result);
            const comma = text.indexOf(",");
            resolve(comma >= 0 ? text.slice(comma + 1) : text);
        };
        reader.readAsDataURL(file);
    });
}
