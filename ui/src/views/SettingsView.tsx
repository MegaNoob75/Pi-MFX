import { useEffect, useRef, useState } from "react";
import { formatMs, isAnalogKind, isLatchingKind, normalizeControlKind, type EngineSnapshot } from "../api";
import { arr, bool, num, obj, str, objects, type JsonObject } from "../json";
import { analogMinSize, defaultSnapshotWidgets, defaultStatusWidgets, gridCellRect, snapshotLayoutSlots, snapshotWidgetsToJson, statusWidgetsToJson } from "../layout";
import { DEFAULT_UI_BEHAVIOR, loadUiBehavior, saveUiBehavior, type UiBehavior } from "../uiBehavior";
import { Tone3000View } from "./Tone3000View";
import { KeyboardSettingsView } from "./KeyboardSettingsView";
import { BackupView } from "./BackupView";
import { HotspotView } from "./HotspotView";
import { MarqueeText } from "./MarqueeText";

export type SettingsPage =
    | "audio"
    | "controller"
    | "ui"
    | "tone3000"
    | "system"
    | "theme"
    | "layout"
    | "keyboard"
    | "backup"
    | "hotspot"
    | "updates";

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
                <HubCard title="MODEL LIBRARY" subtitle="TONE3000 API key and sign-in" onClick={() => onOpen("tone3000")} />
                <HubCard title="SYSTEM" subtitle="Audio, Wi-Fi / hotspot, realtime threads and diagnostics" onClick={() => onOpen("system")} />
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
                <div className="mfx-screen-intro-sub">Audio device, Wi-Fi / hotspot and Pi realtime</div>
            </div>
            <div className="mfx-hub-grid">
                <HubCard title="AUDIO" subtitle="Card, sample rate, period size and measured latency" onClick={() => onOpen?.("audio")} />
                <HubCard title="WIFI / HOTSPOT" subtitle="Join a home network or host a tablet access point" onClick={() => onOpen?.("hotspot")} />
                <HubCard title="UPDATES" subtitle="Check git and rebuild Pi-MFX on this Pi" onClick={() => onOpen?.("updates")} />
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

const CONTROL_KIND_ORDER = ["momentary", "latching", "pot", "slider", "encoder", "expression"] as const;
const CONTROL_LABEL_PREFIX: Record<string, string> = {
    momentary: "MOM",
    latching: "LAT",
    pot: "POT",
    slider: "SL",
    encoder: "ENC",
    expression: "EXP"
};
const HARDWARE_ACTIONS = [
    "none",
    "selectPreset",
    "selectSnapshot",
    "reloadPreset",
    "presetUp",
    "presetDown",
    "bankUp",
    "bankDown",
    "snapshotMode",
    "bypassAll",
    "tapTempo",
    "tuner"
] as const;

const HARDWARE_ACTION_LABELS: Record<string, string> = {
    none: "None",
    selectPreset: "Preset",
    selectSnapshot: "Snapshot",
    reloadPreset: "Reload preset",
    presetUp: "Preset up",
    presetDown: "Preset down",
    bankUp: "Bank up",
    bankDown: "Bank down",
    snapshotMode: "Snapshot mode",
    bypassAll: "Chain bypass",
    tapTempo: "Tap tempo",
    tuner: "Tuner"
};

function controlPrefix(kind: string): string {
    return CONTROL_LABEL_PREFIX[kind] ?? kind.toUpperCase();
}

function isDefaultControlLabel(kind: string, label: string): boolean {
    return new RegExp(`^${controlPrefix(kind)} \\d+$`).test(label.trim());
}

function nextControlLabel(kind: string, controls: JsonObject[]): string {
    const prefix = controlPrefix(kind);
    let highest = 0;
    for (const control of controls) {
        if (normalizeControlKind(str(control.kind, "momentary")) !== kind) {
            continue;
        }
        const match = str(control.label).trim().match(new RegExp(`^${prefix} (\\d+)$`));
        if (match) {
            highest = Math.max(highest, Number(match[1]));
        }
    }
    return `${prefix} ${highest + 1}`;
}

function nextLedLabel(leds: JsonObject[]): string {
    let highest = 0;
    for (const led of leds) {
        const match = str(led.label).trim().match(/^LED (\d+)$/);
        if (match) {
            highest = Math.max(highest, Number(match[1]));
        }
    }
    return `LED ${highest + 1}`;
}

function groupedControls(controls: JsonObject[]): JsonObject[] {
    const grouped: JsonObject[] = [];
    for (const kind of CONTROL_KIND_ORDER) {
        grouped.push(...controls.filter((control) => normalizeControlKind(str(control.kind, "momentary")) === kind));
    }
    grouped.push(...controls.filter((control) => {
        const kind = normalizeControlKind(str(control.kind, "momentary"));
        return !CONTROL_KIND_ORDER.includes(kind as (typeof CONTROL_KIND_ORDER)[number]);
    }));
    return grouped;
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
    if (page === "tone3000") {
        return <LibrarySettings engine={engine} run={run} />;
    }
    if (page === "hotspot") {
        return <HotspotView engine={engine} run={run} />;
    }
    if (page === "system") {
        return <SystemHub engine={engine} run={run} onOpen={onOpen} />;
    }
    if (page === "updates") {
        return null;
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
            <div className="hardware-setup">
                <div className="split-toolbar">
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
                    <div className="list-item"><span>Layout</span><strong>FREEFORM</strong></div>
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
                    subtitle="Arrange widgets and controls on the touchscreen"
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
                            layoutMode: "freeform",
                            performanceLayout: {
                                elements: statusWidgetsToJson(defaultStatusWidgets()),
                                snapshotElements: snapshotWidgetsToJson(defaultSnapshotWidgets()),
                                unplacedControlIds: [],
                                groups: [],
                                snapshotGroups: [],
                                layoutName: str(obj(controller.performanceLayout).layoutName, "default")
                            },
                            controls: objects(controller.controls).map((control, index) => {
                                const rect = gridCellRect(index, 4, 2);
                                const min = analogMinSize(normalizeControlKind(str(control.kind, "momentary")));
                                return {
                                    ...control,
                                    x: rect.x,
                                    y: rect.y,
                                    width: Math.max(min.width, 0.18),
                                    height: Math.max(min.height, 0.2)
                                };
                            })
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
    const { client, state } = engine;
    const controller = obj(state.controller);
    const controls = objects(controller.controls);
    const grouped = groupedControls(controls);
    const controlsRef = useRef(controls);
    controlsRef.current = controls;
    const leds = objects(controller.leds);
    const ledsRef = useRef(leds);
    ledsRef.current = leds;
    const [ports, setPorts] = useState<JsonObject[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const selected = grouped.find((item) => str(item.id) === selectedId) ?? grouped[0];

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
    const snapshotSlots = snapshotLayoutSlots(obj(controller.performanceLayout));

    const addControl = (kind: string, binding: JsonObject) => {
        const current = controlsRef.current;
        const nextId = `ctl-${Date.now().toString(36)}-${current.length}`;
        const next = groupedControls([
            ...current,
            {
                id: nextId,
                label: nextControlLabel(kind, current),
                kind,
                binding
            }
        ]);
        controlsRef.current = next;
        setSelectedId(nextId);
        save({ ...controller, controls: next });
    };

    const patch = (nextControl: JsonObject) => {
        const next = groupedControls(controls.map((item) => (
            str(item.id) === str(nextControl.id) ? nextControl : item
        )));
        controlsRef.current = next;
        save({ ...controller, controls: next });
    };

    return (
        <>
            <div className="split-toolbar" style={{ flexWrap: "wrap" }}>
                <label className="field" style={{ minWidth: 140 }}>
                    <span>Name</span>
                    <input
                        key={str(controller.name)}
                        defaultValue={str(controller.name)}
                        onBlur={(event) => save({ ...controller, name: event.target.value })}
                    />
                </label>
                <label className="field" style={{ minWidth: 180 }}>
                    <span>MIDI</span>
                    <select value={selectedPort} onChange={(event) => selectPort(event.target.value)}>
                        {ports.length === 0 && <option value={selectedPort}>{selectedPort || "No devices"}</option>}
                        {ports.map((port) => (
                            <option key={str(port.id)} value={str(port.id)}>
                                {str(port.name, str(port.id))} · {str(port.id)}
                            </option>
                        ))}
                        {selectedPort && !listedIds.has(selectedPort) && (
                            <option value={selectedPort}>{selectedPort}</option>
                        )}
                    </select>
                </label>
                <button type="button" className="btn" onClick={refreshPorts}>RESCAN</button>
                <button type="button" className={`btn ${bool(controller.enabled) ? "btn-active" : ""}`}
                    onClick={() => save({ ...controller, enabled: !bool(controller.enabled) })}>
                    {bool(controller.enabled) ? "ENABLED" : "DISABLED"}
                </button>
                <button type="button" className={`btn ${bool(controller.mirrorLayoutOnScreen, true) ? "btn-active" : ""}`}
                    onClick={() => save({ ...controller, mirrorLayoutOnScreen: !bool(controller.mirrorLayoutOnScreen, true) })}>
                    MIRROR
                </button>
                <button type="button" className={`btn ${bool(controller.syncLedColours, true) ? "btn-active" : ""}`}
                    onClick={() => save({ ...controller, syncLedColours: !bool(controller.syncLedColours, true) })}>
                    RGB THEME
                </button>
            </div>
            {str(state.controllerError) && <div className="danger" style={{ padding: "0 10px" }}>{str(state.controllerError)}</div>}
            <div className="split-panes">
                <section className="split-pane">
                    <div className="split-pane-title">CONTROLS</div>
                    <div className="split-toolbar">
                        <button type="button" className="btn btn-accent" onClick={() => addControl("momentary", { action: "selectPreset", min: 0, max: 1, inverted: false })}>ADD MOMENTARY</button>
                        <button type="button" className="btn" onClick={() => addControl("latching", { action: "none", min: 0, max: 1, inverted: false })}>ADD LATCHING</button>
                        <button type="button" className="btn" onClick={() => addControl("pot", { action: "none", min: 0, max: 1, inverted: false })}>ADD POT</button>
                        <button type="button" className="btn" onClick={() => addControl("slider", { action: "none", min: 0, max: 1, inverted: false })}>ADD SLIDER</button>
                        <button type="button" className="btn" onClick={() => addControl("expression", { action: "none", min: 0, max: 1, inverted: false })}>ADD EXP</button>
                        <button type="button" className="btn" onClick={() => {
                            const current = ledsRef.current;
                            const next = [
                                ...current,
                                {
                                    id: `led-${Date.now().toString(36)}-${current.length}`,
                                    label: nextLedLabel(current),
                                    rgb: true,
                                    role: "preset",
                                    brightness: 1
                                }
                            ];
                            ledsRef.current = next;
                            save({ ...controller, leds: next });
                        }}>ADD LED</button>
                    </div>
                    <div className="split-list">
                        {grouped.map((control) => (
                            <button
                                key={str(control.id)}
                                type="button"
                                className={`split-row${str(control.id) === str(obj(selected).id) ? " selected" : ""}`}
                                onClick={() => setSelectedId(str(control.id))}
                            >
                                <MarqueeText
                                    text={`${str(control.label, str(control.id))} · ${normalizeControlKind(str(control.kind, "momentary")).toUpperCase()}`}
                                    align="left"
                                    fontWeight={800}
                                />
                            </button>
                        ))}
                        {grouped.length === 0 && <div className="muted">Add a switch or pot to edit it here.</div>}
                    </div>
                </section>
                <section className="split-pane">
                    <div className="split-pane-title">{selected ? str(selected.label, "CONTROL") : "DETAIL"}</div>
                    <div className="hardware-setup-detail">
                        {selected ? (
                            <HardwareControlDetail
                                control={selected}
                                controller={controller}
                                snapshotSlots={snapshotSlots}
                                onPatch={patch}
                                onRemove={() => {
                                    if (!window.confirm(`Remove ${str(selected.label, str(selected.id))}?`)) {
                                        return;
                                    }
                                    const next = groupedControls(controls.filter((item) => str(item.id) !== str(selected.id)));
                                    controlsRef.current = next;
                                    setSelectedId(str(next[0]?.id));
                                    save({ ...controller, controls: next });
                                }}
                                onLearn={() => void run(() => client.request("controller/learn", { controlId: str(selected.id) }))}
                            />
                        ) : (
                            <div className="muted">Select a control from the list.</div>
                        )}
                    </div>
                </section>
            </div>
        </>
    );
}

function HardwareControlDetail({
    control,
    controller,
    snapshotSlots,
    onPatch,
    onRemove,
    onLearn
}: {
    control: JsonObject;
    controller: JsonObject;
    snapshotSlots: number[];
    onPatch: (control: JsonObject) => void;
    onRemove: () => void;
    onLearn: () => void;
}) {
    const binding = obj(control.binding);
    const kind = normalizeControlKind(str(control.kind, "momentary"));
    const analog = isAnalogKind(kind);
    const latching = isLatchingKind(kind);
    const patchBinding = (next: JsonObject) => onPatch({ ...control, binding: next });
    const rawAction = str(binding.action, "none");
    const action = (HARDWARE_ACTIONS as readonly string[]).includes(rawAction) ? rawAction : "none";
    const holdAction = str(binding.holdAction) === "none" ? "" : str(binding.holdAction);
    const doubleAction = str(binding.doubleAction) === "none" ? "" : str(binding.doubleAction);
    const assignedSnapshot = num(binding.snapshotSlot, -1);
    const usesSnapshot = action === "selectSnapshot"
        || holdAction === "selectSnapshot"
        || doubleAction === "selectSnapshot";
    const actionOptions = (includeEmpty: boolean) => (
        <>
            {includeEmpty && <option value="">None</option>}
            {HARDWARE_ACTIONS.filter((item) => includeEmpty ? item !== "none" : true).map((item) => (
                <option key={item} value={item}>{HARDWARE_ACTION_LABELS[item] ?? item}</option>
            ))}
        </>
    );
    const snapshotOptions = assignedSnapshot >= 0 && !snapshotSlots.includes(assignedSnapshot)
        ? [...snapshotSlots, assignedSnapshot]
        : snapshotSlots;
    const withSnapshotSlot = (next: JsonObject, chosen: string) => {
        if (chosen !== "selectSnapshot" || num(next.snapshotSlot, -1) >= 0) {
            return next;
        }
        return { ...next, snapshotSlot: snapshotSlots[0] ?? 0 };
    };
    return (
        <div className="stack">
            <div className="hardware-field-grid">
                <label className="field">
                    <span>Name</span>
                    <input
                        className="input"
                        key={`${str(control.id)}-${str(control.label)}`}
                        defaultValue={str(control.label)}
                        onBlur={(event) => onPatch({ ...control, label: event.target.value })}
                    />
                </label>
                <label className="field">
                    <span>Type</span>
                    <select value={kind} onChange={(event) => {
                        const nextKind = event.target.value;
                        const others = objects(controller.controls).filter((item) => str(item.id) !== str(control.id));
                        const label = isDefaultControlLabel(kind, str(control.label))
                            ? nextControlLabel(nextKind, others)
                            : str(control.label);
                        const nextBinding = { ...binding };
                        if (isAnalogKind(nextKind) || nextBinding.action === "setParameter"
                            || nextBinding.action === "toggleEffect") {
                            nextBinding.action = "none";
                            nextBinding.slotId = "";
                            nextBinding.portSymbol = "";
                        }
                        if (isLatchingKind(nextKind)) {
                            nextBinding.holdAction = "";
                            nextBinding.doubleAction = "";
                        }
                        onPatch({ ...control, kind: nextKind, label, binding: nextBinding });
                    }}>
                        {CONTROL_KIND_ORDER.map((item) => (
                            <option key={item} value={item}>{item}</option>
                        ))}
                    </select>
                </label>
                {!analog && (
                    <label className="field">
                        <span>Main function</span>
                        <select
                            value={action}
                            onChange={(event) => {
                                const next = event.target.value;
                                patchBinding(withSnapshotSlot({
                                    ...binding,
                                    action: next,
                                    doubleAction: next === "selectPreset"
                                        && (!str(binding.doubleAction) || str(binding.doubleAction) === "none")
                                        ? "reloadPreset"
                                        : binding.doubleAction
                                }, next));
                            }}
                        >
                            {actionOptions(false)}
                        </select>
                    </label>
                )}
                {!analog && !latching && (
                    <label className="field">
                        <span>Hold</span>
                        <select
                            value={holdAction}
                            onChange={(event) => patchBinding(withSnapshotSlot({ ...binding, holdAction: event.target.value }, event.target.value))}
                        >
                            {actionOptions(true)}
                        </select>
                    </label>
                )}
                {!analog && !latching && (
                    <label className="field">
                        <span>Double tap</span>
                        <select
                            value={doubleAction}
                            onChange={(event) => patchBinding(withSnapshotSlot({ ...binding, doubleAction: event.target.value }, event.target.value))}
                        >
                            {actionOptions(true)}
                        </select>
                    </label>
                )}
                {!analog && usesSnapshot && (
                    <label className="field">
                        <span>Snapshot slot</span>
                        <select
                            value={assignedSnapshot}
                            onChange={(event) => patchBinding({ ...binding, snapshotSlot: Number(event.target.value) })}
                        >
                            <option value={-1}>Choose slot</option>
                            {snapshotOptions.map((slot) => (
                                <option key={slot} value={slot}>Snapshot {slot + 1}</option>
                            ))}
                        </select>
                    </label>
                )}
                <label className="field">
                    <span>LED</span>
                    <select
                        value={str(control.ledId)}
                        onChange={(event) => onPatch({ ...control, ledId: event.target.value })}
                    >
                        <option value="">None</option>
                        {objects(controller.leds).map((led) => (
                            <option key={str(led.id)} value={str(led.id)}>{str(led.label, str(led.id))}</option>
                        ))}
                    </select>
                </label>
                <label className="field">
                    <span>{bool(control.useNoteMessages) ? "Note" : "CC"}</span>
                    <input
                        type="number"
                        min={-1}
                        max={127}
                        value={num(control.channel, -1)}
                        onChange={(event) => onPatch({ ...control, channel: Number(event.target.value) })}
                    />
                </label>
            </div>
            <div className="muted">
                Bind pots and effect toggles from the editor: hold a parameter name, or hold an effect LED.
            </div>
            <div className="row">
                <button type="button" className="btn" onClick={onLearn}>
                    {bool(controller.learning) && str(controller.learningControlId) === str(control.id) ? "LISTENING…" : "LEARN"}
                </button>
                <button type="button" className="btn btn-danger" onClick={onRemove}>REMOVE</button>
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
    return (
        <div className="page-scroll stack">
            <Tone3000View engine={engine} run={run} pane="settings" />
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
                    {arr(diagnostics.brokenBanks).length > 0
                        ? `\nbroken banks ${arr(diagnostics.brokenBanks).map((item) => String(item)).join(", ")}`
                        : ""}
                    {arr(diagnostics.missingFiles).length > 0
                        ? `\nmissing files ${arr(diagnostics.missingFiles).map((item) => String(item)).join(", ")}`
                        : ""}
                </pre>
            </div>
        </div>
    );
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
