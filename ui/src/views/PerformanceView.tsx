import type { CSSProperties } from "react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { findBank, findPreset, formatMs, isAnalogKind, peakDb, type EngineSnapshot } from "../api";
import { bool, num, obj, str, objects, type JsonObject } from "../json";
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

type PresetMenu = {
    kind: "preset";
    controlId: string;
    slotIndex: number;
    presetId: string;
    canAssign: boolean;
};

type AssignMenu = {
    kind: "assign";
    controlId: string;
    slotIndex: number;
};

type DeleteMenu = {
    kind: "delete";
    controlId: string;
    presetId: string;
    name: string;
};

type SnapshotMenu = {
    kind: "snapshot";
    snapshotId: string;
    index: number;
};

type TileMenu = PresetMenu | AssignMenu | DeleteMenu | SnapshotMenu;

export function PerformanceView({
    engine,
    run,
    onSnapshots,
    onEdit,
    onEditSnapshot
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    onSnapshots?: () => void;
    onEdit?: () => void;
    onEditSnapshot?: (snapshotId: string) => void;
}) {
    const { client, state, meters } = engine;
    const bank = findBank(state);
    const preset = findPreset(state);
    const banks = objects(state.banks);
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
    const activeSnapshot = num(obj(preset).activeSnapshot, -1);
    const snapshotWriteBlocked = snapshotMode || activeSnapshot >= 0;

    const positions = obj(state.controlPositions);
    const chain = objects(state.chain);
    const feedbackOn = loadUiBehavior().parameterFeedback;
    const [bankMenuOpen, setBankMenuOpen] = useState(false);
    const [presetMenuOpen, setPresetMenuOpen] = useState(false);
    const [menu, setMenu] = useState<TileMenu | null>(null);
    const [renameValue, setRenameValue] = useState("");

    const assigned = (controlId: string) => {
        const bankMap = obj(obj(controller.presetAssignments)[str(bank?.id)]);
        return str(bankMap[controlId]);
    };

    const bankMap = () => ({ ...obj(obj(controller.presetAssignments)[str(obj(bank).id)]) });

    const saveAssignments = (nextMap: JsonObject) => {
        const bankId = str(obj(bank).id);
        if (!bankId) {
            return Promise.resolve();
        }
        return client.request("controller/config", {
            ...controller,
            presetAssignments: {
                ...obj(controller.presetAssignments),
                [bankId]: nextMap
            }
        });
    };

    const pressControl = (id: string, pressed: boolean) => {
        void client.request("controller/press", { controlId: id, pressed }).catch(() => undefined);
    };

    const closeMenu = () => setMenu(null);

    const openPresetMenu = (controlId: string, slotIndex: number, presetId: string, canAssign: boolean) => {
        const item = presets.find((entry) => str(entry.id) === presetId);
        setRenameValue(str(obj(item).name));
        setMenu({ kind: "preset", controlId, slotIndex, presetId, canAssign });
    };

    const visibleControls = controls.filter((control) => !hidden.has(str(control.id)));
    const useConfigured = visibleControls.length > 0 && (mirror || controls.length > 0);

    const tiles: PerformanceTile[] = snapshotMode
        ? snapshots.map((snapshot, index) => ({
            id: str(snapshot.id),
            label: str(snapshot.name, `SNAP ${index + 1}`),
            active: activeSnapshot === index,
            color: str(snapshot.color),
            rect: gridCellRect(index, 3, 2),
            onPress: () => void run(() => client.request("snapshot/select", { snapshotId: str(snapshot.id) })),
            onLongPress: () => setMenu({ kind: "snapshot", snapshotId: str(snapshot.id), index })
        }))
        : useConfigured
            ? visibleControls.map((control, index) => {
                const binding = obj(control.binding);
                const controlId = str(control.id);
                const assignedPreset = assigned(controlId);
                const action = str(binding.action, "selectPreset");
                const kind = str(control.kind, "switch");
                const analog = isAnalogKind(kind);
                const canAssign = !analog && (action === "selectPreset" || action === "none" || action === "");
                const presetId = assignedPreset || str(binding.presetId);
                const presetItem = presets.find((entry) => str(entry.id) === presetId);
                const minSize = analogMinSize(kind);
                const active = presetId === str(state.activePresetId)
                    || (action === "bypassAll" && bypassAll)
                    || (action === "snapshotMode" && snapshotMode)
                    || (action === "toggleEffect" && bool(
                        obj(chain.find((slot) => str(slot.id) === str(binding.slotId))).enabled,
                        true
                    ));
                return {
                    id: controlId,
                    label: !analog && canAssign && presetItem ? str(presetItem.name) : str(control.label, controlId),
                    active,
                    color: "",
                    kind,
                    analog,
                    value: num(positions[controlId], analog ? 0 : (active ? 1 : 0)),
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
                        if (canAssign && presetId) {
                            void run(() => client.request("preset/select", {
                                bankId: str(obj(bank).id),
                                presetId
                            }));
                            return;
                        }
                        pressControl(controlId, true);
                        window.setTimeout(() => pressControl(controlId, false), 80);
                    },
                    onValue: analog
                        ? (value: number) => {
                            void client.request("controller/value", {
                                controlId,
                                value
                            }).catch(() => undefined);
                        }
                        : undefined,
                    onLongPress: canAssign || analog
                        ? () => openPresetMenu(controlId, index, presetId, true)
                        : undefined
                };
            })
            : Array.from({ length: Math.min(switchCount, rows * columns) }, (_, index) => {
                const item = presets[index];
                const presetId = item ? str(item.id) : "";
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
                    },
                    onLongPress: () => openPresetMenu(item ? str(item.id) : `empty-${index}`, index, presetId, false)
                };
            });

    const presetOptions = (current: PresetMenu) => {
        if (!current.presetId) {
            return current.canAssign
                ? ["Assign Preset to This Switch", "Create New Preset", "Cancel"]
                : ["Create New Preset", "Cancel"];
        }
        const options = ["Load Preset", "Edit Preset"];
        if (current.presetId === str(state.activePresetId) && !snapshotWriteBlocked) {
            options.push("Save Loaded Preset");
        }
        if (current.canAssign) {
            options.push("Assign Different Preset", "Remove From Switch");
        }
        options.push("Delete Preset", "Cancel");
        return options;
    };

    const warnSnapshotWrite = (action: string) => {
        if (!snapshotWriteBlocked) {
            return false;
        }
        window.alert(
            `${activeSnapshot >= 0 ? `Snapshot ${activeSnapshot + 1}` : "Snapshot Mode"} is active. ${action} is disabled until you return to the base preset.`
        );
        return true;
    };

    const runPresetOption = (option: string, current: PresetMenu) => {
        const item = presets.find((entry) => str(entry.id) === current.presetId);
        switch (option) {
            case "Load Preset":
                if (current.presetId) {
                    closeMenu();
                    void run(() => client.request("preset/select", {
                        bankId: str(obj(bank).id),
                        presetId: current.presetId
                    }));
                }
                break;
            case "Edit Preset":
                if (!current.presetId) {
                    break;
                }
                if (current.presetId === str(state.activePresetId) && warnSnapshotWrite("Editing the base preset")) {
                    return;
                }
                closeMenu();
                void run(async () => {
                    if (current.presetId !== str(state.activePresetId)) {
                        await client.request("preset/select", {
                            bankId: str(obj(bank).id),
                            presetId: current.presetId
                        });
                    }
                    onEdit?.();
                });
                break;
            case "Save Loaded Preset":
                if (warnSnapshotWrite("Saving the preset")) {
                    return;
                }
                closeMenu();
                void run(() => client.request("preset/save"));
                break;
            case "Assign Preset to This Switch":
            case "Assign Different Preset":
                setMenu({ kind: "assign", controlId: current.controlId, slotIndex: current.slotIndex });
                break;
            case "Remove From Switch": {
                closeMenu();
                const next = bankMap();
                delete next[current.controlId];
                void run(() => saveAssignments(next));
                break;
            }
            case "Create New Preset":
                if (warnSnapshotWrite("Creating a preset")) {
                    return;
                }
                void askText("New preset name", str(obj(preset).name, "Preset")).then((name) => {
                    if (!name?.trim()) {
                        return;
                    }
                    closeMenu();
                    void run(async () => {
                        const result = await client.request("preset/saveAs", { name: name.trim() });
                        const newId = str(result.presetId, str(client.snapshot.state.activePresetId));
                        if (current.canAssign && newId) {
                            await saveAssignments({ ...bankMap(), [current.controlId]: newId });
                        }
                    });
                });
                break;
            case "Delete Preset":
                if (item) {
                    setMenu({
                        kind: "delete",
                        controlId: current.controlId,
                        presetId: current.presetId,
                        name: str(item.name, "this preset")
                    });
                }
                break;
            default:
                closeMenu();
                break;
        }
    };

    const renameMenuPreset = () => {
        if (menu?.kind !== "preset" || !menu.presetId || !renameValue.trim()) {
            return;
        }
        void run(() => client.request("preset/rename", {
            presetId: menu.presetId,
            name: renameValue.trim()
        }));
    };

    const deleteMenuPreset = (current: DeleteMenu) => {
        closeMenu();
        void run(async () => {
            const next = bankMap();
            for (const key of Object.keys(next)) {
                if (str(next[key]) === current.presetId) {
                    delete next[key];
                }
            }
            await saveAssignments(next);
            await client.request("preset/delete", { presetId: current.presetId });
        });
    };

    const assignPreset = (presetId: string, controlId: string) => {
        closeMenu();
        void run(() => saveAssignments({ ...bankMap(), [controlId]: presetId }));
    };

    const selectedPreset = menu?.kind === "preset"
        ? presets.find((entry) => str(entry.id) === menu.presetId)
        : undefined;

    return (
        <div className="performance">
            <div className="panel identity">
                <div className="identity-select">
                    <div className="field-label">CURRENT BANK</div>
                    <button type="button" className="identity-value" onClick={() => {
                        setPresetMenuOpen(false);
                        setBankMenuOpen((open) => !open);
                    }}>
                        {`${str(obj(bank).name, "No Bank")} \u25BE`}
                    </button>
                    {bankMenuOpen && (
                        <div className="identity-menu">
                            {banks.map((item) => (
                                <button
                                    key={str(item.id)}
                                    type="button"
                                    className={`mfx-overlay-option${str(item.id) === str(obj(bank).id) ? " selected" : ""}`}
                                    onClick={() => {
                                        setBankMenuOpen(false);
                                        const first = objects(item.presets)[0];
                                        if (first) {
                                            void run(() => client.request("preset/select", {
                                                bankId: str(item.id),
                                                presetId: str(first.id)
                                            }));
                                        }
                                    }}
                                >
                                    {str(item.name)}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <div className="identity-select">
                    <div className="field-label">ACTIVE PRESET</div>
                    <button type="button" className="identity-value" onClick={() => {
                        setBankMenuOpen(false);
                        setPresetMenuOpen((open) => !open);
                    }}>
                        {`${str(obj(preset).name, "No Preset")} \u25BE`}
                    </button>
                    {presetMenuOpen && (
                        <div className="identity-menu">
                            {presets.map((item) => (
                                <button
                                    key={str(item.id)}
                                    type="button"
                                    className={`mfx-overlay-option${str(item.id) === str(state.activePresetId) ? " selected" : ""}`}
                                    onClick={() => {
                                        setPresetMenuOpen(false);
                                        void run(() => client.request("preset/select", {
                                            bankId: str(obj(bank).id),
                                            presetId: str(item.id)
                                        }));
                                    }}
                                >
                                    {str(item.name)}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <div className="row identity-actions">
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
                        className={`btn ${activeSnapshot === index ? "btn-active" : ""}`}
                        style={str(snapshot.color) ? { borderColor: str(snapshot.color) } : undefined}
                        onClick={() => void run(() => client.request("snapshot/select", { snapshotId: str(snapshot.id) }))}
                        onContextMenu={(event) => {
                            event.preventDefault();
                            setMenu({ kind: "snapshot", snapshotId: str(snapshot.id), index });
                        }}
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

            {menu?.kind === "preset" && createPortal(
                <div className="mfx-overlay" onClick={closeMenu}>
                    <div className="mfx-overlay-card" onClick={(event) => event.stopPropagation()}>
                        <div className="mfx-overlay-title">PRESET SWITCH {menu.slotIndex + 1}</div>
                        {selectedPreset && (
                            <div className="row" style={{ marginBottom: 10 }}>
                                <input
                                    className="input"
                                    value={renameValue}
                                    onChange={(event) => setRenameValue(event.target.value)}
                                />
                                <button type="button" className="btn" onClick={renameMenuPreset}>RENAME</button>
                            </div>
                        )}
                        {presetOptions(menu).map((option) => (
                            <button
                                key={option}
                                type="button"
                                className="mfx-overlay-option"
                                onClick={() => runPresetOption(option, menu)}
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                </div>,
                document.body
            )}

            {menu?.kind === "assign" && createPortal(
                <div className="mfx-overlay" onClick={closeMenu}>
                    <div className="mfx-overlay-card" onClick={(event) => event.stopPropagation()}>
                        <div className="mfx-overlay-title">ASSIGN PRESET TO SWITCH</div>
                        {presets.map((item) => (
                            <button
                                key={str(item.id)}
                                type="button"
                                className={`mfx-overlay-option${str(item.id) === str(state.activePresetId) ? " selected" : ""}`}
                                onClick={() => assignPreset(str(item.id), menu.controlId)}
                            >
                                {str(item.name)}
                            </button>
                        ))}
                        {presets.length === 0 && <div className="muted">This bank has no presets yet.</div>}
                        <button type="button" className="mfx-overlay-option" onClick={closeMenu}>CANCEL</button>
                    </div>
                </div>,
                document.body
            )}

            {menu?.kind === "delete" && createPortal(
                <div className="mfx-overlay">
                    <div className="mfx-overlay-card">
                        <div className="mfx-overlay-title danger">DELETE PRESET?</div>
                        <div style={{ margin: "12px 0", fontWeight: 900 }}>{menu.name}</div>
                        <div className="row">
                            <button type="button" className="btn" onClick={closeMenu}>CANCEL</button>
                            <button type="button" className="btn btn-danger" onClick={() => deleteMenuPreset(menu)}>
                                DELETE PRESET
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {menu?.kind === "snapshot" && createPortal(
                <div className="mfx-overlay" onClick={closeMenu}>
                    <div className="mfx-overlay-card" onClick={(event) => event.stopPropagation()}>
                        <div className="mfx-overlay-title">SNAPSHOT {menu.index + 1}</div>
                        <button
                            type="button"
                            className="mfx-overlay-option"
                            onClick={() => {
                                closeMenu();
                                void run(() => client.request("snapshot/select", { snapshotId: menu.snapshotId }));
                            }}
                        >
                            RECALL SNAPSHOT
                        </button>
                        <button
                            type="button"
                            className="mfx-overlay-option"
                            onClick={() => {
                                closeMenu();
                                onEditSnapshot?.(menu.snapshotId);
                            }}
                        >
                            EDIT SNAPSHOT
                        </button>
                        <button
                            type="button"
                            className="mfx-overlay-option"
                            onClick={() => {
                                const current = snapshots.find((item) => str(item.id) === menu.snapshotId);
                                void askText("Snapshot name", str(obj(current).name, `Snap ${menu.index + 1}`)).then((name) => {
                                    if (name?.trim()) {
                                        closeMenu();
                                        void run(() => client.request("snapshot/rename", {
                                            snapshotId: menu.snapshotId,
                                            name: name.trim()
                                        }));
                                    }
                                });
                            }}
                        >
                            RENAME
                        </button>
                        <button
                            type="button"
                            className="mfx-overlay-option danger"
                            onClick={() => {
                                if (window.confirm("Delete this snapshot?")) {
                                    closeMenu();
                                    void run(() => client.request("snapshot/delete", { snapshotId: menu.snapshotId }));
                                }
                            }}
                        >
                            DELETE SNAPSHOT
                        </button>
                        <button type="button" className="mfx-overlay-option" onClick={closeMenu}>CANCEL</button>
                    </div>
                </div>,
                document.body
            )}
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
