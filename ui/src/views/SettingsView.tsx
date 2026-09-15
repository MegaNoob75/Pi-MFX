import { useEffect, useRef, useState } from "react";
import { formatMs, isAnalogKind, isEncoderKind, isEncoderPushKind, isLatchingKind, normalizeControlKind, useMeters, type EngineSnapshot } from "../api";
import { arr, bool, num, obj, str, objects, type JsonObject } from "../json";
import { analogMinSize, defaultSnapshotWidgets, defaultStatusWidgets, gridCellRect, snapshotLayoutSlots, snapshotWidgetsToJson, statusWidgetsToJson } from "../layout";
import { DEFAULT_UI_BEHAVIOR, loadUiBehavior, saveUiBehavior, type UiBehavior } from "../uiBehavior";
import { listenForKeyboardCommit } from "../keyboard/utils";
import { updateUiSessionSection } from "../uiSession";
import { Tone3000View } from "./Tone3000View";
import { KeyboardSettingsView } from "./KeyboardSettingsView";
import { BackupView } from "./BackupView";
import { HotspotView } from "./HotspotView";
import { MarqueeText } from "./MarqueeText";
import { ConfirmDialog } from "./ConfirmDialog";

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
            <div className="mfx-hub-grid" data-mfx-nav-list="settings">
                <HubCard title="CONTROLLER" subtitle="Switch layout, hardware inputs and actions" onClick={() => onOpen("controller")} />
                <HubCard title="THEME" subtitle="Built-in themes, custom colors, import and export" onClick={() => onOpen("theme")} />
                <HubCard title="KEYBOARD" subtitle="On-screen keyboard mode and overlay appearance" onClick={() => onOpen("keyboard")} />
                <HubCard title="PI-MFX UI" subtitle="Encoder, floorboard feel, backup and interface options" onClick={() => onOpen("ui")} />
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
    const [confirm, setConfirm] = useState<"reboot" | "shutdown" | null>(null);
    const [busy, setBusy] = useState<"reboot" | "shutdown" | null>(null);
    const [message, setMessage] = useState("");
    const sharedSettings = obj(engine.uiSession.settings);

    useEffect(() => {
        setRealtime(str(sharedSettings.systemPage) === "realtime");
        const nextConfirm = str(sharedSettings.systemConfirm);
        setConfirm(nextConfirm === "reboot" || nextConfirm === "shutdown" ? nextConfirm : null);
    }, [engine.uiSession.settings]);

    const openRealtime = (open: boolean) => {
        setRealtime(open);
        updateUiSessionSection(engine.client, "settings", { systemPage: open ? "realtime" : "hub" });
    };

    const setPowerConfirm = (next: "reboot" | "shutdown" | null) => {
        setConfirm(next);
        updateUiSessionSection(engine.client, "settings", { systemConfirm: next ?? "" });
    };

    const power = (action: "reboot" | "shutdown") => {
        setPowerConfirm(null);
        setBusy(action);
        setMessage(action === "reboot" ? "Rebooting…" : "Shutting down…");
        void run(async () => {
            try {
                const next = obj(await engine.client.request(
                    action === "reboot" ? "system/reboot" : "system/shutdown"
                ));
                setMessage(str(next.message) || (action === "reboot" ? "Rebooting…" : "Shutting down…"));
            } catch (error) {
                setBusy(null);
                setMessage(error instanceof Error ? error.message : String(error));
                throw error;
            }
        });
    };

    if (realtime) {
        return (
            <div className="mfx-screen">
                <div className="mfx-screen-intro">
                    <button type="button" className="btn" onClick={() => openRealtime(false)}>← SYSTEM</button>
                </div>
                <div className="page-scroll" data-mfx-sync-scroll="settings-system-realtime" style={{ flex: 1, minHeight: 0 }}>
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
            <div className="mfx-hub-grid" data-mfx-nav-list="settings">
                <HubCard title="AUDIO" subtitle="Card, sample rate, period size and measured latency" onClick={() => onOpen?.("audio")} />
                <HubCard title="WIFI / HOTSPOT" subtitle="Join a home network or host a tablet access point" onClick={() => onOpen?.("hotspot")} />
                <HubCard title="UPDATES" subtitle="Check git and rebuild Pi-MFX on this Pi" onClick={() => onOpen?.("updates")} />
                <HubCard title="REALTIME" subtitle="Audio thread, memory lock and diagnostics" onClick={() => openRealtime(true)} />
                <div className="system-power">
                    <button
                        type="button"
                        className="btn system-power-btn"
                        disabled={busy !== null}
                        onClick={() => setPowerConfirm("reboot")}
                    >
                        {busy === "reboot" ? "REBOOTING..." : "REBOOT"}
                    </button>
                    <button
                        type="button"
                        className="btn btn-danger system-power-btn"
                        disabled={busy !== null}
                        onClick={() => setPowerConfirm("shutdown")}
                    >
                        {busy === "shutdown" ? "SHUTTING DOWN..." : "SHUT DOWN"}
                    </button>
                    {message ? <div className="muted" style={{ gridColumn: "1 / -1" }}>{message}</div> : null}
                </div>
            </div>
            {confirm === "reboot" && (
                <ConfirmDialog
                    title="REBOOT THIS PI?"
                    body="Audio stops. The touchscreen comes back after boot."
                    confirmLabel="REBOOT"
                    onCancel={() => setPowerConfirm(null)}
                    onConfirm={() => power("reboot")}
                />
            )}
            {confirm === "shutdown" && (
                <ConfirmDialog
                    title="SHUT DOWN THIS PI?"
                    body="Audio stops. Power the Pi back on to use it again."
                    confirmLabel="SHUT DOWN"
                    danger
                    onCancel={() => setPowerConfirm(null)}
                    onConfirm={() => power("shutdown")}
                />
            )}
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

const CONTROL_KIND_ORDER = ["momentary", "latching", "pot", "slider", "encoder", "encoderPush", "expression"] as const;
const CONTROL_LABEL_PREFIX: Record<string, string> = {
    momentary: "MOM",
    latching: "LAT",
    pot: "POT",
    slider: "SL",
    encoder: "ENC",
    encoderPush: "ENC BTN",
    expression: "EXP"
};
const HARDWARE_ACTIONS = [
    "none",
    "navigate",
    "select",
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
    "tuner",
    "backingPlayPause",
    "backingStop",
    "backingPrevious",
    "backingNext",
    "backingView",
    "looperRecord",
    "looperToggle",
    "looperPlay",
    "looperPlayStop",
    "looperOverdub",
    "looperStop",
    "looperRestart",
    "looperMute",
    "looperUndo",
    "looperRedo",
    "looperView"
] as const;
const ENCODER_ACTIONS = ["none", "navigate", "presetUp", "bankUp", "selectSnapshot", "backingNext"] as const;
const ENCODER_PUSH_ACTIONS = [
    "none",
    "select",
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
    "tuner",
    "backingPlayPause",
    "backingStop",
    "backingPrevious",
    "backingNext",
    "backingView",
    "looperRecord",
    "looperToggle",
    "looperPlay",
    "looperPlayStop",
    "looperOverdub",
    "looperStop",
    "looperRestart",
    "looperMute",
    "looperUndo",
    "looperRedo",
    "looperView"
] as const;
const HOLD_ACTIONS = [...HARDWARE_ACTIONS, "looperClear"] as const;

const HARDWARE_ACTION_LABELS: Record<string, string> = {
    none: "None",
    navigate: "Navigate menus",
    select: "Select",
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
    tuner: "Tuner",
    backingPlayPause: "Backing play / pause",
    backingStop: "Backing stop",
    backingPrevious: "Backing previous",
    backingNext: "Backing next",
    backingView: "Open backing tracks",
    looperRecord: "Looper record",
    looperToggle: "Looper record / play / overdub",
    looperPlay: "Looper play",
    looperPlayStop: "Looper play / stop",
    looperOverdub: "Looper overdub",
    looperStop: "Looper stop",
    looperRestart: "Looper restart",
    looperMute: "Looper mute",
    looperUndo: "Looper undo",
    looperRedo: "Looper redo",
    looperClear: "Looper clear (hold)",
    looperView: "Open looper"
};

function kindListLabel(kind: string): string {
    if (kind === "encoderPush") {
        return "PUSH";
    }
    return kind.toUpperCase();
}

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
    const used = new Set<string>();
    const byId = new Map(controls.map((control) => [str(control.id), control]));
    for (const kind of CONTROL_KIND_ORDER) {
        if (kind === "encoderPush") {
            continue;
        }
        for (const control of controls) {
            if (normalizeControlKind(str(control.kind, "momentary")) !== kind) {
                continue;
            }
            grouped.push(control);
            used.add(str(control.id));
            if (kind === "encoder") {
                const pair = byId.get(str(control.pairId));
                if (pair && isEncoderPushKind(normalizeControlKind(str(pair.kind)))) {
                    grouped.push(pair);
                    used.add(str(pair.id));
                }
            }
        }
    }
    grouped.push(...controls.filter((control) => !used.has(str(control.id))));
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
        return <KeyboardSettingsView engine={engine} />;
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
    const { client, state, connected } = engine;
    const meters = useMeters(client);
    const audio = obj(state.audio);
    const [devices, setDevices] = useState<JsonObject[]>([]);
    const [draft, setDraft] = useState(audio);
    const [deviceError, setDeviceError] = useState("");

    useEffect(() => {
        const sharedDraft = obj(obj(engine.uiSession.settings).audioDraft);
        setDraft(Object.keys(sharedDraft).length > 0 ? sharedDraft : obj(state.audio));
    }, [state.audio, engine.uiSession.settings]);

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
        setDraft((current) => {
            const next = { ...current, [key]: value };
            updateUiSessionSection(client, "settings", { audioDraft: next });
            return next;
        });
    };

    return (
        <div className="page-scroll stack" data-mfx-sync-scroll="settings-audio">
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
    const [confirmResetLayout, setConfirmResetLayout] = useState(false);
    const { client } = engine;
    const controller = obj(engine.state.controller);
    const connected = bool(controller.connected);
    useEffect(() => {
        const sharedPage = str(obj(engine.uiSession.settings).controllerPage);
        if (sharedPage === "hub" || sharedPage === "hardware" || sharedPage === "diagnostics") {
            setPage(sharedPage);
        }
        setConfirmResetLayout(bool(obj(engine.uiSession.settings).controllerResetLayout));
    }, [engine.uiSession.settings]);
    const openPage = (next: "hub" | "hardware" | "diagnostics") => {
        setPage(next);
        updateUiSessionSection(client, "settings", { controllerPage: next });
    };
    const showResetLayoutConfirmation = (show: boolean) => {
        setConfirmResetLayout(show);
        updateUiSessionSection(client, "settings", { controllerResetLayout: show });
    };
    const restoreDefaultLayout = () => {
        showResetLayoutConfirmation(false);
        void run(() => client.request("controller/config", {
            ...controller,
            layoutMode: "freeform",
            performanceLayout: {
                elements: statusWidgetsToJson(defaultStatusWidgets()),
                snapshotElements: snapshotWidgetsToJson(defaultSnapshotWidgets()),
                unplacedControlIds: objects(controller.controls)
                    .filter((control) => isEncoderPushKind(normalizeControlKind(str(control.kind, "momentary"))))
                    .map((control) => str(control.id))
                    .filter(Boolean),
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
    };
    if (page === "hardware") {
        return (
            <div className="hardware-setup">
                <div className="split-toolbar">
                    <button type="button" className="btn" onClick={() => openPage("hub")}>← CONTROLLER</button>
                </div>
                <ControllerSettings engine={engine} run={run} />
            </div>
        );
    }
    if (page === "diagnostics") {
        return (
            <div className="page-scroll stack" data-mfx-sync-scroll="settings-controller-diagnostics">
                <div className="row">
                    <button type="button" className="btn" onClick={() => openPage("hub")}>← CONTROLLER</button>
                </div>
                <div className="panel stack">
                    <h2>DIAGNOSTICS</h2>
                    <div className="list-item"><span>Connection</span><strong>{connected ? "CONNECTED" : "OFFLINE"}</strong></div>
                    <div className="list-item"><span>Name</span><strong>{str(controller.name, "—")}</strong></div>
                    <div className="list-item"><span>MIDI port</span><strong>{str(controller.activePort) || str(controller.midiPort) || "—"}</strong></div>
                    <div className="list-item"><span>Firmware</span><strong>{str(controller.firmwareVersion, "UNKNOWN")}</strong></div>
                    {connected && bool(controller.firmwareUpdateRequired) && (
                        <div className="danger">
                            New controller firmware {str(controller.requiredFirmwareVersion)} is available. Flash it manually for the controller to function properly.
                        </div>
                    )}
                    <div className="list-item"><span>Switches & pots</span><strong>{objects(controller.controls).length}</strong></div>
                    <div className="list-item"><span>LEDs</span><strong>{objects(controller.leds).length}</strong></div>
                    <div className="list-item"><span>Layout</span><strong>FREEFORM</strong></div>
                    {str(engine.state.controllerError) && <div className="danger">{str(engine.state.controllerError)}</div>}
                </div>
            </div>
        );
    }
    return (
        <div className="page-scroll stack" data-mfx-sync-scroll="settings-controller-hub">
            <div className="panel">
                <h2>CONTROLLER</h2>
                <div className="muted">Configure hardware, arrange Performance View, and inspect controller status.</div>
                <div className="row" style={{ marginTop: 8 }}>
                    <strong style={{ color: connected ? "var(--mfx-cyan)" : "var(--mfx-muted)" }}>
                        {connected ? "CONNECTED" : "OFFLINE"}
                    </strong>
                    <span className="muted">{str(controller.name, "NO CONTROLLER")}</span>
                </div>
                {connected && bool(controller.firmwareUpdateRequired) && (
                    <div className="danger" style={{ marginTop: 10 }}>
                        Controller firmware {str(controller.firmwareVersion)} is outdated. Flash version {str(controller.requiredFirmwareVersion)} manually for the controller to function properly.
                    </div>
                )}
            </div>
            <div className="mfx-hub-grid" data-mfx-nav-list="settings">
                <HubCard
                    title="HARDWARE SETUP"
                    subtitle={`Add switches, pots and encoders; assign MIDI Learn and actions. ${objects(controller.controls).length} controls · ${objects(controller.leds).length} LEDs`}
                    onClick={() => openPage("hardware")}
                />
                <HubCard
                    title="PERFORMANCE LAYOUT"
                    subtitle="Arrange widgets and controls on the touchscreen"
                    onClick={() => onOpenLayout?.()}
                />
                <HubCard
                    title="DIAGNOSTICS"
                    subtitle={`${connected ? "Connected" : "Offline"} · check MIDI, protocol and reported inputs`}
                    onClick={() => openPage("diagnostics")}
                />
            </div>
            <div className="muted" style={{ padding: 16 }}>
                Hardware defines what is connected. Layout only changes where it appears.
            </div>
            <div>
                <button
                    type="button"
                    className="btn"
                    onClick={() => showResetLayoutConfirmation(true)}
                >
                    RESTORE DEFAULT LAYOUT
                </button>
            </div>
            {confirmResetLayout && (
                <ConfirmDialog
                    title="RESTORE DEFAULT LAYOUT?"
                    body="This replaces the current Performance layout with the default arrangement."
                    confirmLabel="RESTORE"
                    danger
                    onCancel={() => showResetLayoutConfirmation(false)}
                    onConfirm={restoreDefaultLayout}
                />
            )}
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
    const controllerRef = useRef(controller);
    controllerRef.current = controller;
    const controls = objects(controller.controls);
    const pairedPushIds = new Set(controls
        .filter((control) => isEncoderKind(normalizeControlKind(str(control.kind))))
        .map((control) => str(control.pairId)).filter(Boolean));
    const grouped = groupedControls(controls).filter((control) =>
        !isEncoderPushKind(normalizeControlKind(str(control.kind)))
        || !pairedPushIds.has(str(control.id)));
    const controlsRef = useRef(controls);
    controlsRef.current = controls;
    const leds = objects(controller.leds);
    const ledsRef = useRef(leds);
    ledsRef.current = leds;
    const [ports, setPorts] = useState<JsonObject[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [removeControlId, setRemoveControlId] = useState("");
    const selected = grouped.find((item) => str(item.id) === selectedId) ?? grouped[0];

    useEffect(() => {
        const sharedId = str(obj(engine.uiSession.settings).controllerSelectedId);
        if (sharedId && grouped.some((item) => str(item.id) === sharedId)) {
            setSelectedId(sharedId);
        }
        setRemoveControlId(str(obj(engine.uiSession.settings).removeControlId));
    }, [engine.uiSession.settings, grouped]);

    const selectControl = (id: string) => {
        setSelectedId(id);
        updateUiSessionSection(client, "settings", { controllerSelectedId: id });
    };
    const showRemoveControl = (id: string) => {
        setRemoveControlId(id);
        updateUiSessionSection(client, "settings", { removeControlId: id });
    };
    const removeControl = () => {
        const target = controlsRef.current.find((item) => str(item.id) === removeControlId);
        showRemoveControl("");
        if (!target) {
            return;
        }
        const id = str(target.id);
        const pairId = str(target.pairId);
        const next = groupedControls(controlsRef.current.filter((item) => {
            const itemId = str(item.id);
            if (itemId === id) {
                return false;
            }
            return !(isEncoderKind(normalizeControlKind(str(target.kind))) && itemId === pairId);
        }).map((item) => str(item.pairId) === id ? { ...item, pairId: "" } : item));
        controlsRef.current = next;
        selectControl(str(next[0]?.id));
        save({ ...controllerRef.current, controls: next });
    };

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
        selectControl(nextId);
        save({ ...controller, controls: next });
    };

    const patch = (nextControl: JsonObject) => {
        const previous = controlsRef.current.find((item) => str(item.id) === str(nextControl.id));
        const wasEncoder = previous && isEncoderKind(normalizeControlKind(str(previous.kind)));
        const stillEncoder = isEncoderKind(normalizeControlKind(str(nextControl.kind)));
        let next = controlsRef.current.map((item) => (
            str(item.id) === str(nextControl.id) ? nextControl : item
        ));
        if (wasEncoder && !stillEncoder) {
            const pairId = str(previous?.pairId);
            next = next
                .filter((item) => str(item.id) !== pairId)
                .map((item) => str(item.id) === str(nextControl.id) ? { ...item, pairId: "" } : item);
        }
        next = groupedControls(next);
        controlsRef.current = next;
        save({ ...controller, controls: next });
    };

    return (
        <>
            <div className="split-toolbar" style={{ flexWrap: "wrap" }}>
                <label className="field" style={{ minWidth: 140 }}>
                    <span>Name</span>
                    <KeyboardCommitInput
                        className="input"
                        defaultValue={str(controller.name)}
                        onCommit={(name) => save({ ...controllerRef.current, name })}
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
                            const current = controlsRef.current;
                            const encId = `ctl-${Date.now().toString(36)}-${current.length}`;
                            const btnId = `${encId}-btn`;
                            const label = nextControlLabel("encoder", current);
                            const next = groupedControls([
                                ...current,
                                {
                                    id: encId,
                                    label,
                                    kind: "encoder",
                                    pairId: btnId,
                                    binding: { action: "navigate", min: 0, max: 1, inverted: false }
                                },
                                {
                                    id: btnId,
                                    label: `${label} BTN`,
                                    kind: "encoderPush",
                                    pairId: encId,
                                    binding: { action: "select", min: 0, max: 1, inverted: false }
                                }
                            ]);
                            controlsRef.current = next;
                            selectControl(encId);
                            save({ ...controller, controls: next });
                        }}>ADD ENCODER</button>
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
                    <div className="split-list" data-mfx-sync-scroll="settings-controller-controls">
                        {grouped.map((control) => (
                            <button
                                key={str(control.id)}
                                type="button"
                                className={`split-row${str(control.id) === str(obj(selected).id) ? " selected" : ""}`}
                                onClick={() => selectControl(str(control.id))}
                            >
                                <MarqueeText
                                    text={`${str(control.label).trim() || str(control.id)} · ${kindListLabel(normalizeControlKind(str(control.kind, "momentary")))}`}
                                    align="left"
                                    fontWeight={800}
                                />
                            </button>
                        ))}
                        {grouped.length === 0 && <div className="muted">Add a switch, pot or encoder to edit it here.</div>}
                    </div>
                </section>
                <section className="split-pane">
                    <div className="split-pane-title">{selected ? (str(selected.label).trim() || "CONTROL") : "DETAIL"}</div>
                    <div className="hardware-setup-detail" data-mfx-sync-scroll="settings-controller-detail">
                        {selected ? (
                            <HardwareControlDetail
                                control={selected}
                                controller={controller}
                                backingEnabled={bool(engine.state.backingTrackFeatureEnabled)}
                                snapshotSlots={snapshotSlots}
                                onPatch={patch}
                                onRemove={() => showRemoveControl(str(selected.id))}
                                onLearn={() => void run(() => client.request("controller/learn", { controlId: str(selected.id) }))}
                                onLearnPair={() => {
                                    const pairId = str(selected.pairId);
                                    if (!pairId) {
                                        return;
                                    }
                                    void run(() => client.request("controller/learn", { controlId: pairId }));
                                }}
                                onTogglePushButton={(enabled) => {
                                    const current = controlsRef.current;
                                    const encoderId = str(selected.id);
                                    if (enabled) {
                                        if (current.some((item) => str(item.id) === str(selected.pairId)
                                            && isEncoderPushKind(normalizeControlKind(str(item.kind))))) {
                                            return;
                                        }
                                        const btnId = `${encoderId}-btn`;
                                        const next = groupedControls([
                                            ...current.map((item) => str(item.id) === encoderId
                                                ? { ...item, pairId: btnId }
                                                : item),
                                            {
                                                id: btnId,
                                                label: `${str(selected.label, "ENC")} BTN`,
                                                kind: "encoderPush",
                                                pairId: encoderId,
                                                binding: { action: "select", min: 0, max: 1, inverted: false }
                                            }
                                        ]);
                                        controlsRef.current = next;
                                        save({ ...controller, controls: next });
                                        return;
                                    }
                                    const pairId = str(selected.pairId);
                                    const next = groupedControls(current
                                        .filter((item) => str(item.id) !== pairId)
                                        .map((item) => str(item.id) === encoderId ? { ...item, pairId: "" } : item));
                                    controlsRef.current = next;
                                    save({ ...controller, controls: next });
                                }}
                            />
                        ) : (
                            <div className="muted">Select a control from the list.</div>
                        )}
                    </div>
                </section>
            </div>
            {removeControlId && (
                <ConfirmDialog
                    title="REMOVE CONTROL?"
                    body={`Remove ${str(controls.find((item) => str(item.id) === removeControlId)?.label, removeControlId)}?`}
                    confirmLabel="REMOVE"
                    danger
                    onCancel={() => showRemoveControl("")}
                    onConfirm={removeControl}
                />
            )}
        </>
    );
}

function HardwareControlDetail({
    control,
    controller,
    backingEnabled,
    snapshotSlots,
    onPatch,
    onRemove,
    onLearn,
    onLearnPair,
    onTogglePushButton,
    embeddedPush = false
}: {
    control: JsonObject;
    controller: JsonObject;
    backingEnabled: boolean;
    snapshotSlots: number[];
    onPatch: (control: JsonObject) => void;
    onRemove: () => void;
    onLearn: () => void;
    onLearnPair: () => void;
    onTogglePushButton: (enabled: boolean) => void;
    embeddedPush?: boolean;
}) {
    const controlRef = useRef(control);
    controlRef.current = control;
    const binding = obj(control.binding);
    const kind = normalizeControlKind(str(control.kind, "momentary"));
    const analog = isAnalogKind(kind);
    const encoder = isEncoderKind(kind);
    const encoderPush = isEncoderPushKind(kind);
    const latching = isLatchingKind(kind);
    const pair = objects(controller.controls).find((item) => str(item.id) === str(control.pairId));
    const hasPushButton = Boolean(pair && isEncoderPushKind(normalizeControlKind(str(pair.kind))));
    const patchBinding = (next: JsonObject) => onPatch({ ...control, binding: next });
    const allFunctionActions = encoder
        ? ENCODER_ACTIONS
        : encoderPush
            ? ENCODER_PUSH_ACTIONS
            : HARDWARE_ACTIONS;
    const functionActions = allFunctionActions.filter((item) => backingEnabled || !item.startsWith("backing"));
    const holdActions = HOLD_ACTIONS.filter((item) => backingEnabled || !item.startsWith("backing"));
    const rawAction = str(binding.action, "none");
    const action = (functionActions as readonly string[]).includes(rawAction) ? rawAction : "none";
    const holdAction = str(binding.holdAction) === "none" ? "" : str(binding.holdAction);
    const doubleAction = str(binding.doubleAction) === "none" ? "" : str(binding.doubleAction);
    const assignedSnapshot = num(binding.snapshotSlot, -1);
    const usesSnapshot = (!encoder && action === "selectSnapshot")
        || holdAction === "selectSnapshot"
        || doubleAction === "selectSnapshot";
    const actionOptions = (includeEmpty: boolean, actions: readonly string[] = functionActions) => (
        <>
            {includeEmpty && <option value="">None</option>}
            {actions.filter((item) => includeEmpty ? item !== "none" : true).map((item) => (
                <option key={item} value={item}>{HARDWARE_ACTION_LABELS[item] ?? item}</option>
            ))}
        </>
    );
    const snapshotOptions = assignedSnapshot >= 0 && !snapshotSlots.includes(assignedSnapshot)
        ? [...snapshotSlots, assignedSnapshot]
        : snapshotSlots;
    const withSnapshotSlot = (next: JsonObject, chosen: string) => {
        if (chosen !== "selectSnapshot" || num(next.snapshotSlot, -1) >= 0 || encoder) {
            return next;
        }
        return { ...next, snapshotSlot: snapshotSlots[0] ?? 0 };
    };
    const learningThis = bool(controller.learning) && str(controller.learningControlId) === str(control.id);
    const showSwitchTiming = !analog && !encoder && !latching;
    return (
        <div className="stack">
            <div className="hardware-field-grid">
                {!embeddedPush && <>
                <label className="field">
                    <span>Name</span>
                    <KeyboardCommitInput
                        key={str(control.id)}
                        className="input"
                        defaultValue={str(control.label)}
                        onCommit={(label) => onPatch({ ...controlRef.current, label })}
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
                        if (isEncoderKind(nextKind) && (!nextBinding.action || nextBinding.action === "none")) {
                            nextBinding.action = "navigate";
                        }
                        if (isEncoderPushKind(nextKind) && (!nextBinding.action || nextBinding.action === "none")) {
                            nextBinding.action = "select";
                        }
                        if (isLatchingKind(nextKind) || isEncoderKind(nextKind)) {
                            nextBinding.holdAction = "";
                            nextBinding.doubleAction = "";
                        }
                        onPatch({ ...control, kind: nextKind, label, binding: nextBinding });
                    }}>
                        {CONTROL_KIND_ORDER.filter((item) => item !== "encoderPush" || encoderPush).map((item) => (
                            <option key={item} value={item}>{item === "encoderPush" ? "encoder push" : item}</option>
                        ))}
                    </select>
                </label>
                </>}
                {!analog && (
                    <label className="field">
                        <span>{encoder ? "Turn function" : "Main function"}</span>
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
                {showSwitchTiming && (
                    <label className="field">
                        <span>Hold</span>
                        <select
                            value={holdAction}
                            onChange={(event) => patchBinding(withSnapshotSlot({ ...binding, holdAction: event.target.value }, event.target.value))}
                        >
                            {actionOptions(true, holdActions)}
                        </select>
                    </label>
                )}
                {showSwitchTiming && (
                    <label className="field">
                        <span>Double tap</span>
                        <select
                            value={doubleAction}
                            onChange={(event) => patchBinding(withSnapshotSlot({ ...binding, doubleAction: event.target.value }, event.target.value))}
                        >
                            {actionOptions(true, functionActions)}
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
                {(analog || encoder) && (
                    <label className="field">
                        <span>Reverse</span>
                        <button
                            type="button"
                            className={`btn ${bool(binding.inverted) ? "btn-active" : ""}`}
                            onClick={() => patchBinding({ ...binding, inverted: !bool(binding.inverted) })}
                        >
                            {bool(binding.inverted) ? "REVERSED" : "NORMAL"}
                        </button>
                    </label>
                )}
                {encoder && (
                    <label className="field">
                        <span>Push button</span>
                        <button
                            type="button"
                            className={`btn ${hasPushButton ? "btn-active" : ""}`}
                            onClick={() => onTogglePushButton(!hasPushButton)}
                        >
                            {hasPushButton ? "HAS BUTTON" : "NO BUTTON"}
                        </button>
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
                {encoder
                    ? "Learn rotation by turning the encoder. If it has a click, Learn button captures that separately. Reverse if clockwise is backwards."
                    : analog
                        ? "Bind pots from the editor: hold a parameter name. Reverse if the pot is wired backwards."
                        : encoderPush
                            ? "This is the click on the paired encoder. Assign Select to confirm a highlighted menu item."
                            : "Bind pots and effect toggles from the editor: hold a parameter name, or hold an effect LED."}
            </div>
            <div className="row">
                <button type="button" className="btn" onClick={onLearn}>
                    {learningThis
                        ? "LISTENING…"
                        : encoder ? "LEARN ROTATION" : encoderPush ? "LEARN BUTTON" : "LEARN"}
                </button>
                {!embeddedPush && <button type="button" className="btn btn-danger" onClick={onRemove}>REMOVE</button>}
            </div>
            {encoder && hasPushButton && pair && (
                <section className="stack">
                    <h3>Push button</h3>
                    <HardwareControlDetail
                        control={pair}
                        controller={controller}
                        backingEnabled={backingEnabled}
                        snapshotSlots={snapshotSlots}
                        onPatch={onPatch}
                        onRemove={() => onTogglePushButton(false)}
                        onLearn={onLearnPair}
                        onLearnPair={() => undefined}
                        onTogglePushButton={() => undefined}
                        embeddedPush
                    />
                </section>
            )}
        </div>
    );
}

function EncoderPulsesInput({ value, onCommit }: {
    value: number;
    onCommit: (value: number) => void;
}) {
    const [draft, setDraft] = useState(String(value));
    const ref = useRef<HTMLInputElement>(null);
    const lastCommitted = useRef(value);
    useEffect(() => {
        lastCommitted.current = value;
        setDraft(String(value));
    }, [value]);
    const commit = (text: string) => {
        const parsed = Number(text);
        if (text.trim() === "" || !Number.isFinite(parsed)) {
            setDraft(String(lastCommitted.current));
            return;
        }
        const next = Math.max(1, Math.min(8, Math.trunc(parsed)));
        setDraft(String(next));
        if (next !== lastCommitted.current) {
            lastCommitted.current = next;
            onCommit(next);
        }
    };
    const commitRef = useRef(commit);
    commitRef.current = commit;
    useEffect(() => listenForKeyboardCommit(ref.current, (text) => commitRef.current(text)), []);
    return (
        <input ref={ref} type="number" min={1} max={8} step={1} value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                }
            }} />
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
    const encoderMode = str(ui.performanceEncoder, "browse");
    return (
        <div className="page-scroll stack" data-mfx-sync-scroll="settings-ui">
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
                <UiBehaviorEditor engine={engine} />
            </div>
            <div className="panel stack">
                <h2>PERFORMANCE ENCODER</h2>
                <div className="muted">
                    Turn clockwise for the next preset and counterclockwise for the previous. Browse every preset in bank-list order, then continue to the next bank and wrap around. Switch assignments do not change this order. Use Hardware Reverse only to correct reversed wiring.
                </div>
                <div className="row">
                    <button type="button" className={`btn ${encoderMode === "browse" ? "btn-active" : ""}`}
                        onClick={() => save({ ...ui, performanceEncoder: "browse" })}>
                        BROWSE
                    </button>
                    <button type="button" className={`btn ${encoderMode === "live" ? "btn-active" : ""}`}
                        onClick={() => save({ ...ui, performanceEncoder: "live" })}>
                        LIVE
                    </button>
                    <button type="button" className={`btn ${encoderMode === "session" ? "btn-active" : ""}`}
                        onClick={() => save({ ...ui, performanceEncoder: "session" })}>
                        SESSION TILES
                    </button>
                </div>
                <div className="muted">
                    {encoderMode === "live"
                        ? "Loads each preset as you turn so you can hear it. Encoder click is not required."
                        : encoderMode === "session"
                            ? "Turns the switch names for this session only. A reboot restores the saved assignments. Press a switch or the encoder to load."
                            : "Highlights the next preset. Press the encoder to load that bank and preset."}
                </div>
            </div>
            <div className="panel stack">
                <h2>FLOORBOARD FEEL</h2>
                <div className="muted">
                    Hold time, double-tap, and reverse stay on each control in Hardware Setup. These are extra filters for noisy hardware.
                </div>
                <label className="field">
                    <span>Encoder pulses per click</span>
                    <EncoderPulsesInput value={num(ui.encoderStepsPerDetent, 1)}
                        onCommit={(value) => save({ ...ui, encoderStepsPerDetent: value })} />
                </label>
                <div className="muted">The floorboard already sends one MIDI message per tactile click. Leave this at 1. Raise it only if one click still jumps several items.</div>
                <label className="field">
                    <span>Extra pot deadband (MIDI steps)</span>
                    <input type="number" min={0} max={16} value={num(ui.analogDeadband, 0)}
                        onChange={(event) => save({ ...ui, analogDeadband: Number(event.target.value) })} />
                </label>
                <div className="muted">Ignore wobble smaller than this. Use when cheap pots or interference make values jump.</div>
                <label className="field">
                    <span>Extra switch debounce (ms)</span>
                    <input type="number" min={0} max={80} value={num(ui.switchDebounceMs, 0)}
                        onChange={(event) => save({ ...ui, switchDebounceMs: Number(event.target.value) })} />
                </label>
                <div className="muted">Added on top of the firmware debounce. Leave at 0 unless a switch or encoder click double-fires.</div>
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
        <div className="page-scroll stack" data-mfx-sync-scroll="settings-library">
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
        <div className="page-scroll stack" data-mfx-sync-scroll="settings-realtime">
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

function UiBehaviorEditor({
    engine
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
}) {
    const [settings, setSettings] = useState(loadUiBehavior);
    useEffect(() => {
        const shared = obj(obj(engine.uiSession.settings).uiBehavior);
        if (Object.keys(shared).length === 0) {
            updateUiSessionSection(engine.client, "settings", {
                uiBehavior: settings as unknown as JsonObject
            });
            return;
        }
        const next = { ...DEFAULT_UI_BEHAVIOR, ...shared, version: 1 } as UiBehavior;
        saveUiBehavior(next);
        setSettings(next);
        // Local changes publish explicitly in apply().
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine.uiSession.settings, engine.client]);
    const apply = (next: UiBehavior) => {
        saveUiBehavior(next);
        setSettings(next);
        updateUiSessionSection(engine.client, "settings", {
            uiBehavior: next as unknown as JsonObject
        });
    };
    return (
        <div className="stack">
            <div className="muted">Pots enlarge while you drag them on screen or turn them on the floorboard, using the current theme so the background does not show through.</div>
            <div className="row">
                <button type="button" className={`btn ${settings.controlPopout ? "btn-active" : ""}`}
                    onClick={() => apply({ ...settings, controlPopout: !settings.controlPopout })}>
                    TOUCH POP-OUT
                </button>
                <button type="button" className={`btn ${settings.physicalControlPopout ? "btn-active" : ""}`}
                    onClick={() => apply({ ...settings, physicalControlPopout: !settings.physicalControlPopout })}>
                    PHYSICAL POP-OUT
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

function KeyboardCommitInput({
    className,
    defaultValue,
    onCommit
}: {
    className?: string;
    defaultValue: string;
    onCommit: (value: string) => void;
}) {
    const ref = useRef<HTMLInputElement>(null);
    const onCommitRef = useRef(onCommit);
    onCommitRef.current = onCommit;
    useEffect(() => listenForKeyboardCommit(ref.current, (value) => onCommitRef.current(value)), []);
    return (
        <input
            ref={ref}
            className={className}
            defaultValue={defaultValue}
            onChange={(event) => onCommitRef.current(event.target.value)}
            onBlur={(event) => onCommitRef.current(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.currentTarget.blur();
                }
            }}
        />
    );
}
