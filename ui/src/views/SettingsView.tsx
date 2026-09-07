import { useEffect, useState } from "react";
import { findPreset, formatMs, type EngineSnapshot } from "../api";
import { arr, bool, num, obj, str, objects, type JsonObject } from "../json";
import { DEFAULT_UI_BEHAVIOR, loadUiBehavior, saveUiBehavior, type UiBehavior } from "../uiBehavior";
import { Tone3000View } from "./Tone3000View";
import { KeyboardSettingsView } from "./KeyboardSettingsView";
import { BackupView } from "./BackupView";
import { PluginsView } from "./PluginsView";

export type SettingsPage =
    | "audio"
    | "controller"
    | "ui"
    | "library"
    | "system"
    | "theme"
    | "layout"
    | "keyboard"
    | "backup"
    | "plugins";

export function SettingsHub({ onOpen }: { onOpen: (page: SettingsPage) => void }) {
    return (
        <div className="mfx-screen">
            <div className="mfx-screen-intro">
                <div className="mfx-screen-intro-title">PI-MFX SETTINGS</div>
                <div className="mfx-screen-intro-sub">Configure Pi-MFX without editing files</div>
            </div>
            <div className="mfx-hub-grid">
                <HubCard title="CONTROLLER" subtitle="Switch layout, hardware inputs and actions" onClick={() => onOpen("controller")} />
                <HubCard title="THEME" subtitle="Built-in themes, custom colors, import and export" onClick={() => onOpen("theme")} />
                <HubCard title="KEYBOARD" subtitle="On-screen keyboard mode and overlay appearance" onClick={() => onOpen("keyboard")} />
                <HubCard title="PI-MFX UI" subtitle="Backup, restore and interface options" onClick={() => onOpen("ui")} />
                <HubCard title="PLUGINS" subtitle="Apt repos, install, remove and PatchStorage" onClick={() => onOpen("plugins")} />
                <HubCard title="SYSTEM" subtitle="Audio, library, realtime threads and diagnostics" onClick={() => onOpen("system")} />
            </div>
        </div>
    );
}

function SystemHub({
    engine,
    run,
    onOpen
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    onOpen?: (page: SettingsPage) => void;
}) {
    const [realtime, setRealtime] = useState(false);
    if (realtime) {
        return (
            <div className="mfx-screen">
                <div className="mfx-screen-intro">
                    <button type="button" className="btn" onClick={() => setRealtime(false)}>← SYSTEM</button>
                </div>
                <div className="page-scroll" style={{ flex: 1, minHeight: 0 }}>
                    <SystemSettings engine={engine} run={run} />
                </div>
            </div>
        );
    }
    return (
        <div className="mfx-screen">
            <div className="mfx-screen-intro">
                <div className="mfx-screen-intro-title">SYSTEM</div>
                <div className="mfx-screen-intro-sub">Audio device, NAM/IR library and Pi realtime</div>
            </div>
            <div className="mfx-hub-grid">
                <HubCard title="AUDIO" subtitle="Card, sample rate, period size and measured latency" onClick={() => onOpen?.("audio")} />
                <HubCard title="LIBRARY" subtitle="NAM models, IRs and TONE3000 downloads" onClick={() => onOpen?.("library")} />
                <HubCard title="REALTIME" subtitle="Audio thread, memory lock and diagnostics" onClick={() => setRealtime(true)} />
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
    run,
    onOpen
}: {
    page: SettingsPage;
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    onOpen?: (page: SettingsPage) => void;
}) {
    if (page === "audio") {
        return <AudioSettings engine={engine} run={run} />;
    }
    if (page === "controller") {
        return <ControllerHub engine={engine} run={run} onOpenLayout={() => onOpen?.("layout")} />;
    }
    if (page === "keyboard") {
        return <KeyboardSettingsView />;
    }
    if (page === "ui" || page === "backup") {
        return <UiSettings engine={engine} run={run} />;
    }
    if (page === "library") {
        return <LibrarySettings engine={engine} run={run} />;
    }
    if (page === "plugins") {
        return <PluginsView engine={engine} run={run} />;
    }
    if (page === "system") {
        return <SystemHub engine={engine} run={run} onOpen={onOpen} />;
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
    const maxInputs = Math.max(1, num(obj(selected).maxInputChannels, num(draft.inputChannels, 2)));
    const guitarInput = Math.min(maxInputs, Math.max(1, num(draft.guitarInput, 2)));

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
                                {bool(device.isHdmi) ? " (HDMI)" : ""}
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
                <label className="field">
                    <span>Guitar input</span>
                    <select value={guitarInput} onChange={(event) => set("guitarInput", Number(event.target.value))}>
                        {Array.from({ length: maxInputs }, (_, index) => (
                            <option key={index + 1} value={index + 1}>
                                Input {index + 1}
                                {index === 0 ? " · often mic / line" : index === 1 ? " · often instrument" : ""}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="muted">
                    Guitar is mono and copied to both headphone channels. On a Scarlett Solo the instrument jack is Input 2.
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
                    <button type="button" className="btn btn-accent" onClick={() => void run(() => client.request("audio/settings", { ...draft, guitarInput }))}>
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

function ControllerHub({
    engine,
    run,
    onOpenLayout
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    onOpenLayout?: () => void;
}) {
    const [page, setPage] = useState<"hub" | "hardware" | "diagnostics">("hub");
    const { client } = engine;
    const controller = obj(engine.state.controller);
    const connected = bool(controller.connected);
    if (page === "hardware") {
        return (
            <div className="page-scroll stack">
                <div className="row">
                    <button type="button" className="btn" onClick={() => setPage("hub")}>← CONTROLLER</button>
                </div>
                <ControllerSettings engine={engine} run={run} />
            </div>
        );
    }
    if (page === "diagnostics") {
        return (
            <div className="page-scroll stack">
                <div className="row">
                    <button type="button" className="btn" onClick={() => setPage("hub")}>← CONTROLLER</button>
                </div>
                <div className="panel stack">
                    <h2>DIAGNOSTICS</h2>
                    <div className="list-item"><span>Connection</span><strong>{connected ? "CONNECTED" : "OFFLINE"}</strong></div>
                    <div className="list-item"><span>Name</span><strong>{str(controller.name, "—")}</strong></div>
                    <div className="list-item"><span>MIDI port</span><strong>{str(controller.activePort) || str(controller.midiPort) || "—"}</strong></div>
                    <div className="list-item"><span>Switches & pots</span><strong>{objects(controller.controls).length}</strong></div>
                    <div className="list-item"><span>LEDs</span><strong>{objects(controller.leds).length}</strong></div>
                    <div className="list-item"><span>Layout</span><strong>{str(controller.layoutMode, "grid").toUpperCase()}</strong></div>
                    {str(engine.state.controllerError) && <div className="danger">{str(engine.state.controllerError)}</div>}
                </div>
            </div>
        );
    }
    return (
        <div className="page-scroll stack">
            <div className="panel">
                <h2>CONTROLLER</h2>
                <div className="muted">Configure hardware, arrange Performance View, and inspect controller status.</div>
                <div className="row" style={{ marginTop: 8 }}>
                    <strong style={{ color: connected ? "var(--mfx-cyan)" : "var(--mfx-muted)" }}>
                        {connected ? "CONNECTED" : "OFFLINE"}
                    </strong>
                    <span className="muted">{str(controller.name, "NO CONTROLLER")}</span>
                </div>
            </div>
            <div className="mfx-hub-grid">
                <HubCard
                    title="HARDWARE SETUP"
                    subtitle={`Add switches, pots and encoders; assign MIDI Learn and actions. ${objects(controller.controls).length} controls · ${objects(controller.leds).length} LEDs`}
                    onClick={() => setPage("hardware")}
                />
                <HubCard
                    title="PERFORMANCE LAYOUT"
                    subtitle={`${str(controller.layoutMode, "grid").toUpperCase()} · arrange switches, pots and status panels on the touchscreen`}
                    onClick={() => onOpenLayout?.()}
                />
                <HubCard
                    title="DIAGNOSTICS"
                    subtitle={`${connected ? "Connected" : "Offline"} · check MIDI, protocol and reported inputs`}
                    onClick={() => setPage("diagnostics")}
                />
            </div>
            <div className="muted" style={{ padding: 16 }}>
                Hardware defines what is connected. Layout only changes where it appears.
                Assign presets by holding a Performance switch, the same way as MultiFX.
            </div>
            <div>
                <button
                    type="button"
                    className="btn"
                    onClick={() => {
                        if (!window.confirm("Restore the default Performance layout?")) {
                            return;
                        }
                        void run(() => client.request("controller/config", {
                            ...controller,
                            layoutMode: "grid",
                            gridRows: 2,
                            gridColumns: 4,
                            performanceLayout: {
                                ...obj(controller.performanceLayout),
                                unplacedControlIds: []
                            }
                        }));
                    }}
                >
                    RESTORE DEFAULT LAYOUT
                </button>
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
    const { client, state, connected } = engine;
    const controller = obj(state.controller);
    const controls = objects(controller.controls);
    const [ports, setPorts] = useState<JsonObject[]>([]);

    const refreshPorts = () => {
        void client.request("midi/ports").then((result) => {
            setPorts(objects(result.ports));
        }).catch(() => undefined);
    };

    useEffect(() => {
        refreshPorts();
    }, [client, controller.midiPort, controller.activePort]);

    const save = (next: JsonObject) => {
        const config = { ...next };
        delete config.connected;
        delete config.activePort;
        delete config.learning;
        delete config.learningControlId;
        void run(() => client.request("controller/config", {
            ...config,
            midiPort: str(config.midiPort) || str(controller.activePort) || str(controller.midiPort)
        }));
    };

    const selectPort = (portId: string) => {
        void run(async () => {
            const result = await client.request("controller/connect", { port: portId });
            setPorts(objects(result.ports));
        });
    };

    const selectedPort = str(controller.activePort) || str(controller.midiPort);
    const listedIds = new Set(ports.map((port) => str(port.id)));

    return (
        <div className="stack">
            <div className="panel stack">
                <h2>FLOORBOARD</h2>
                <div className="muted">
                    Flash the Pi-MFX sketch in firmware/esp32s3/PiMFX_Controller — not the MultiFX .ino.
                    Stock wiring uses switches CC 20–27 and pots CC 10–13. Learn still captures any CC.
                </div>
                {str(state.controllerError) && <div className="danger">{str(state.controllerError)}</div>}
                <label className="field">
                    <span>Name</span>
                    <input
                        key={str(controller.name)}
                        defaultValue={str(controller.name)}
                        onChange={(event) => save({ ...controller, name: event.target.value })}
                        onBlur={(event) => save({ ...controller, name: event.target.value })}
                    />
                </label>
                <div className="stack">
                    <div className="field-label">MIDI devices</div>
                    <div className="muted">
                        {bool(controller.connected)
                            ? `Listening on ${selectedPort || "the selected port"}`
                            : "Pick the floorboard or MIDI interface from the list. Hardware buttons stay dead until a device is selected."}
                    </div>
                    {ports.map((port) => {
                        const id = str(port.id);
                        const selected = id === selectedPort;
                        return (
                            <button
                                key={id}
                                type="button"
                                className={`list-item ${selected ? "selected" : ""}`}
                                onClick={() => selectPort(id)}
                            >
                                <div>
                                    <strong>{str(port.name, id)}</strong>
                                    <div className="muted">
                                        {id}
                                        {bool(port.input) ? " · in" : ""}
                                        {bool(port.output) ? " · out" : ""}
                                        {bool(port.looksLikeController) ? " · looks like an ESP32 board" : ""}
                                    </div>
                                </div>
                                <span className="muted">{selected ? "SELECTED" : "SELECT"}</span>
                            </button>
                        );
                    })}
                    {selectedPort && !listedIds.has(selectedPort) && (
                        <div className="list-item selected">
                            <div>
                                <strong>{selectedPort}</strong>
                                <div className="muted">Saved port is not plugged in right now</div>
                            </div>
                        </div>
                    )}
                    {ports.length === 0 && (
                        <div className="muted">
                            {connected
                                ? "No MIDI devices found. Plug the controller in and press Rescan."
                                : "The engine is offline. MIDI devices are listed by the Pi, not this browser."}
                        </div>
                    )}
                    <div className="row">
                        <button type="button" className="btn" onClick={refreshPorts}>RESCAN MIDI</button>
                    </div>
                </div>
                <div className="row">
                    <button type="button" className={`btn ${bool(controller.enabled) ? "btn-active" : ""}`}
                        onClick={() => save({ ...controller, enabled: !bool(controller.enabled) })}>
                        {bool(controller.enabled) ? "ENABLED" : "DISABLED"}
                    </button>
                    <button type="button" className="btn" onClick={() => void run(() => client.request("controller/disconnect"))}>
                        DISCONNECT
                    </button>
                    <button type="button" className={`btn ${bool(controller.mirrorLayoutOnScreen, true) ? "btn-active" : ""}`}
                        onClick={() => save({ ...controller, mirrorLayoutOnScreen: !bool(controller.mirrorLayoutOnScreen, true) })}>
                        MIRROR LAYOUT
                    </button>
                    <button type="button" className={`btn ${bool(controller.syncLedColours, true) ? "btn-active" : ""}`}
                        onClick={() => save({ ...controller, syncLedColours: !bool(controller.syncLedColours, true) })}>
                        RGB FOLLOWS THEME
                    </button>
                </div>
            </div>

            <div className="panel stack">
                <h2>CONTROLS</h2>
                <div className="row">
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
                                binding: { action: "selectPreset", min: 0, max: 1, inverted: false }
                            }
                        ]
                    });
                }}>ADD SWITCH</button>
                    <button type="button" className="btn" onClick={() => {
                        const nextId = `ctl-${Date.now().toString(36)}`;
                        save({
                            ...controller,
                            controls: [
                                ...controls,
                                {
                                    id: nextId,
                                    label: `POT ${controls.length + 1}`,
                                    kind: "pot",
                                    binding: { action: "setParameter", min: 0, max: 1, inverted: false }
                                }
                            ]
                        });
                    }}>ADD POT</button>
                    <button type="button" className="btn" onClick={() => {
                        const nextId = `ctl-${Date.now().toString(36)}`;
                        save({
                            ...controller,
                            controls: [
                                ...controls,
                                {
                                    id: nextId,
                                    label: `SL ${controls.length + 1}`,
                                    kind: "slider",
                                    binding: { action: "setParameter", min: 0, max: 1, inverted: false }
                                }
                            ]
                        });
                    }}>ADD SLIDER</button>
                    <button type="button" className="btn" onClick={() => {
                        const nextId = `ctl-${Date.now().toString(36)}`;
                        save({
                            ...controller,
                            controls: [
                                ...controls,
                                {
                                    id: nextId,
                                    label: `EXP ${controls.length + 1}`,
                                    kind: "expression",
                                    binding: { action: "setParameter", min: 0, max: 1, inverted: false }
                                }
                            ]
                        });
                    }}>ADD EXP</button>
                    <button type="button" className="btn" onClick={() => {
                        const nextId = `led-${Date.now().toString(36)}`;
                        save({
                            ...controller,
                            leds: [
                                ...objects(controller.leds),
                                { id: nextId, label: `LED ${objects(controller.leds).length + 1}`, rgb: true, role: "preset", brightness: 1 }
                            ]
                        });
                    }}>ADD LED</button>
                </div>
                {controls.map((control, index) => {
                    const chain = objects(state.chain);
                    const binding = obj(control.binding);
                    const patch = (nextControl: JsonObject) => {
                        const next = controls.slice();
                        next[index] = nextControl;
                        save({ ...controller, controls: next });
                    };
                    const patchBinding = (next: JsonObject) => patch({ ...control, binding: next });
                    const selectedSlot = chain.find((slot) => str(slot.id) === str(binding.slotId));
                    const ports = objects(obj(obj(selectedSlot).plugin).ports)
                        .filter((port) => str(port.kind) === "control");
                    return (
                    <div key={str(control.id)} className="list-item" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
                        <input
                            className="input"
                            style={{ maxWidth: 140 }}
                            defaultValue={str(control.label)}
                            onBlur={(event) => patch({ ...control, label: event.target.value })}
                        />
                        <select value={str(control.kind, "switch")} onChange={(event) => patch({ ...control, kind: event.target.value })}>
                            {["switch", "momentary", "pot", "slider", "encoder", "expression"].map((kind) => (
                                <option key={kind} value={kind}>{kind}</option>
                            ))}
                        </select>
                        <select
                            value={str(binding.action, "none")}
                            onChange={(event) => patchBinding({ ...binding, action: event.target.value })}
                        >
                            {["none", "selectPreset", "presetUp", "presetDown", "bankUp", "bankDown", "selectSnapshot", "snapshotMode", "toggleEffect", "setParameter", "bypassAll", "tapTempo", "tuner"].map((action) => (
                                <option key={action} value={action}>{action}</option>
                            ))}
                        </select>
                        <select
                            value={str(binding.holdAction)}
                            onChange={(event) => patchBinding({ ...binding, holdAction: event.target.value })}
                        >
                            <option value="">hold: none</option>
                            {["selectPreset", "presetUp", "presetDown", "bankUp", "bankDown", "snapshotMode", "bypassAll"].map((action) => (
                                <option key={action} value={action}>hold: {action}</option>
                            ))}
                        </select>
                        {str(binding.action) === "selectPreset" && (
                            <div className="muted">Hold this switch on Performance to assign a preset.</div>
                        )}
                        {str(binding.action) === "selectSnapshot" && (
                            <select
                                value={str(binding.snapshotId)}
                                onChange={(event) => patchBinding({ ...binding, snapshotId: event.target.value })}
                            >
                                <option value="">Assign snapshot</option>
                                {objects(obj(findPreset(state)).snapshots).map((snapshot) => (
                                    <option key={str(snapshot.id)} value={str(snapshot.id)}>{str(snapshot.name)}</option>
                                ))}
                            </select>
                        )}
                        {(str(binding.action) === "toggleEffect" || str(binding.action) === "setParameter") && (
                            <select
                                value={str(binding.slotId)}
                                onChange={(event) => patchBinding({ ...binding, slotId: event.target.value })}
                            >
                                <option value="">Effect</option>
                                {chain.map((slot) => (
                                    <option key={str(slot.id)} value={str(slot.id)}>
                                        {str(slot.name) || str(obj(slot.plugin).name, str(slot.id))}
                                    </option>
                                ))}
                            </select>
                        )}
                        {str(binding.action) === "setParameter" && (
                            <select
                                value={str(binding.portSymbol)}
                                onChange={(event) => patchBinding({ ...binding, portSymbol: event.target.value })}
                            >
                                <option value="">Parameter</option>
                                {ports.map((port) => (
                                    <option key={str(port.symbol)} value={str(port.symbol)}>{str(port.name, str(port.symbol))}</option>
                                ))}
                            </select>
                        )}
                        <label className="field" style={{ minWidth: 72 }}>
                            <span>Min</span>
                            <input type="number" step="0.01" value={num(binding.min, 0)}
                                onChange={(event) => patchBinding({ ...binding, min: Number(event.target.value) })} />
                        </label>
                        <label className="field" style={{ minWidth: 72 }}>
                            <span>Max</span>
                            <input type="number" step="0.01" value={num(binding.max, 1)}
                                onChange={(event) => patchBinding({ ...binding, max: Number(event.target.value) })} />
                        </label>
                        <button type="button" className={`btn ${bool(binding.inverted) ? "btn-active" : ""}`}
                            onClick={() => patchBinding({ ...binding, inverted: !bool(binding.inverted) })}>
                            {bool(binding.inverted) ? "REVERSE ON" : "REVERSE"}
                        </button>
                        <select
                            value={str(control.ledId)}
                            onChange={(event) => patch({ ...control, ledId: event.target.value })}
                        >
                            <option value="">LED</option>
                            {objects(controller.leds).map((led) => (
                                <option key={str(led.id)} value={str(led.id)}>{str(led.label, str(led.id))}</option>
                            ))}
                        </select>
                        <label className="field" style={{ minWidth: 72 }}>
                            <span>{bool(control.useNoteMessages) ? "Note" : "CC"}</span>
                            <input
                                type="number"
                                min={-1}
                                max={127}
                                value={num(control.channel, -1)}
                                onChange={(event) => patch({ ...control, channel: Number(event.target.value) })}
                            />
                        </label>
                        <span className="muted">
                            {num(control.channel, -1) >= 0
                                ? `ch ${num(control.midiChannel) || "any"} ${bool(control.useNoteMessages) ? "note" : "CC"} ${num(control.channel)}`
                                : "not learned — stock Pi-MFX firmware is CC 20–27"}
                        </span>
                        <button type="button" className="btn" onClick={() => void run(() => client.request("controller/learn", { controlId: str(control.id) }))}>
                            {bool(controller.learning) && str(controller.learningControlId) === str(control.id) ? "LISTENING…" : "LEARN"}
                        </button>
                        <button type="button" className="btn btn-danger" onClick={() => {
                            save({ ...controller, controls: controls.filter((item) => str(item.id) !== str(control.id)) });
                        }}>REMOVE</button>
                    </div>
                    );
                })}
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
    const save = (next: JsonObject) => {
        void run(() => engine.client.request("ui/settings", next));
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
                <label className="field">
                    <span>UI scale</span>
                    <input type="number" min={0.7} max={1.6} step={0.05} value={num(ui.scale, 1)}
                        onChange={(event) => save({ ...ui, scale: Number(event.target.value) })} />
                </label>
                <div className="row">
                    <button type="button" className={`btn ${bool(ui.showTuner, true) ? "btn-active" : ""}`}
                        onClick={() => save({ ...ui, showTuner: !bool(ui.showTuner, true) })}>TUNER</button>
                    <button type="button" className={`btn ${bool(ui.showLatencyMeter, true) ? "btn-active" : ""}`}
                        onClick={() => save({ ...ui, showLatencyMeter: !bool(ui.showLatencyMeter, true) })}>LATENCY</button>
                    <button type="button" className={`btn ${bool(ui.confirmPresetOverwrite, true) ? "btn-active" : ""}`}
                        onClick={() => save({ ...ui, confirmPresetOverwrite: !bool(ui.confirmPresetOverwrite, true) })}>CONFIRM SAVE</button>
                </div>
                <UiBehaviorEditor />
            </div>
            <BackupView engine={engine} run={run} embedded />
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
            <Tone3000View engine={engine} run={run} />
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
                <div className="muted">
                    The audio thread stays on SCHED_FIFO. Cores are not isolated and the audio
                    thread is not pinned, so NAM and convolution worker threads can use the whole
                    Pi. Isolating cores made those plugins fight the audio thread for one CPU.
                </div>
                <div className="row">
                    <button type="button" className={`btn ${bool(system.lockMemory, true) ? "btn-active" : ""}`}
                        onClick={() => save({ ...system, lockMemory: !bool(system.lockMemory, true) })}>
                        LOCK MEMORY
                    </button>
                    <button type="button" className={`btn ${bool(system.holdCpuLatency, true) ? "btn-active" : ""}`}
                        onClick={() => save({ ...system, holdCpuLatency: !bool(system.holdCpuLatency, true) })}>
                        HOLD CPU LATENCY
                    </button>
                </div>
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

function UiBehaviorEditor() {
    const [settings, setSettings] = useState(loadUiBehavior);
    const apply = (next: UiBehavior) => {
        saveUiBehavior(next);
        setSettings(next);
    };
    return (
        <div className="stack">
            <div className="muted">On-screen pots enlarge while you drag them, and show the bound parameter name.</div>
            <div className="row">
                <button type="button" className={`btn ${settings.controlPopout ? "btn-active" : ""}`}
                    onClick={() => apply({ ...settings, controlPopout: !settings.controlPopout })}>
                    CONTROL POP-OUT
                </button>
                <button type="button" className={`btn ${settings.parameterFeedback ? "btn-active" : ""}`}
                    onClick={() => apply({ ...settings, parameterFeedback: !settings.parameterFeedback })}>
                    PARAMETER FEEDBACK
                </button>
                <button type="button" className="btn" onClick={() => apply({ ...DEFAULT_UI_BEHAVIOR })}>
                    RESET
                </button>
            </div>
            <label className="field">
                <span>Pop-out duration (ms)</span>
                <input type="number" min={500} max={10000} value={settings.controlPopoutDurationMs}
                    onChange={(event) => apply({ ...settings, controlPopoutDurationMs: Number(event.target.value) })} />
            </label>
        </div>
    );
}
