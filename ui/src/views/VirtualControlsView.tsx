import { useEffect, useMemo, useRef, useState } from "react";
import { findPreset, type EngineSnapshot } from "../api";
import { bool, num, obj, objects, str } from "../json";
import { clampRect } from "../layout";
import {
    resolveVirtualControlDisplay,
    virtualBindingFor,
    virtualControlMinSize
} from "../virtualControls";
import { ConfirmDialog } from "./ConfirmDialog";
import { PerformanceControl, type PerformanceTile } from "./PerformanceControl";

export function VirtualControlsView({
    engine,
    onEdit
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    onEdit: () => void;
}) {
    const { state, client } = engine;
    const config = obj(state.virtualControls);
    const controls = objects(config.controls);
    const preset = findPreset(state);
    const chain = objects(state.chain);
    const activeId = str(state.activeVirtualControlId);
    const revision = num(state.virtualControlRevision);
    const fine = bool(state.virtualControlFine);
    const previousRevision = useRef(revision);
    const popoutTimer = useRef<number | null>(null);
    const [proxyPopoutId, setProxyPopoutId] = useState("");
    const [confirmSave, setConfirmSave] = useState(false);
    const [saveStatus, setSaveStatus] = useState("");
    const activeSnapshot = num(obj(preset).activeSnapshot, -1);
    const presetName = str(obj(preset).name, "No preset loaded");

    const saveLiveChanges = async () => {
        setConfirmSave(false);
        setSaveStatus("SAVING…");
        try {
            await client.request("preset/save");
            setSaveStatus("CHANGES SAVED");
            window.setTimeout(() => setSaveStatus(""), 2200);
        } catch (error) {
            setSaveStatus(error instanceof Error ? error.message : "SAVE FAILED");
        }
    };

    useEffect(() => {
        if (revision === previousRevision.current) return;
        previousRevision.current = revision;
        if (!activeId) return;
        setProxyPopoutId(activeId);
        if (popoutTimer.current !== null) window.clearTimeout(popoutTimer.current);
        popoutTimer.current = window.setTimeout(() => {
            popoutTimer.current = null;
            setProxyPopoutId("");
        }, 2200);
    }, [revision, activeId]);

    useEffect(() => () => {
        if (popoutTimer.current !== null) window.clearTimeout(popoutTimer.current);
    }, []);

    const tiles = useMemo(() => controls.map((control): PerformanceTile => {
        const id = str(control.id);
        const kind = str(control.kind, "pot");
        const binding = virtualBindingFor(preset, id);
        const display = resolveVirtualControlDisplay(control, binding, chain, state);
        const analog = kind === "pot" || kind === "slider" || kind === "encoder";
        const minimum = virtualControlMinSize(kind, str(control.orientation, "vertical"));
        const select = () => {
            if (activeId !== id) void client.request("virtual-controls/select", { controlId: id }).catch(() => undefined);
        };
        return {
            id,
            switchLabel: display.label,
            valueText: display.valueText || display.context,
            role: "utility",
            lightState: display.missing ? "modified" : display.active ? "active" : "inactive",
            active: display.active || activeId === id,
            analog,
            analogSource: display.label,
            analogFunction: display.missing ? "MISSING TARGET" : display.context,
            analogValue: display.valueText,
            assigned: display.assigned,
            kind,
            orientation: str(control.orientation) === "horizontal" ? "horizontal" : "vertical",
            value: display.range,
            freeform: true,
            hardwarePopout: proxyPopoutId === id,
            rect: clampRect({
                x: num(control.x, 0.08),
                y: num(control.y, 0.12),
                width: num(control.width, 0.18),
                height: num(control.height, 0.28)
            }, minimum),
            onEngage: select,
            onPress: () => {
                select();
                void client.request("virtual-controls/press", { controlId: id, pressed: true })
                    .then(() => client.request("virtual-controls/press", { controlId: id, pressed: false }))
                    .catch(() => undefined);
            },
            onValue: analog && kind !== "encoder"
                ? (value) => void client.request("virtual-controls/value", { controlId: id, value }).catch(() => undefined)
                : undefined,
            onStep: kind === "encoder"
                ? (delta) => void client.request("virtual-controls/turn", { controlId: id, delta }).catch(() => undefined)
                : undefined
        };
    }), [controls, preset, chain, state, activeId, proxyPopoutId, client]);

    return (
        <div className="virtual-controls-view">
            <div className="virtual-controls-status">
                <span className="virtual-controls-layout">{str(config.layoutName, "default").toUpperCase()}</span>
                <span className="virtual-controls-preset">
                    <small>CURRENT PRESET</small>
                    <strong>{presetName}</strong>
                    <small>{activeId ? `ACTIVE · ${tiles.find((tile) => tile.id === activeId)?.switchLabel ?? activeId}` : "LIVE CHANGES ARE TEMPORARY"}</small>
                </span>
                {fine && <strong>FINE</strong>}
                {saveStatus && <strong className="virtual-controls-save-status">{saveStatus}</strong>}
                <button
                    type="button"
                    className="btn"
                    disabled={!preset || activeSnapshot >= 0 || saveStatus === "SAVING…"}
                    title={activeSnapshot >= 0 ? "Return to the base preset before saving" : "Save the current live sound to this preset"}
                    onClick={() => setConfirmSave(true)}
                >SAVE CHANGES TO PRESET</button>
                <button type="button" className="btn" onClick={onEdit}>EDIT LAYOUT</button>
            </div>
            <div className="virtual-controls-stage">
                {tiles.map((tile) => (
                    <div
                        key={tile.id}
                        className={`virtual-control-slot${activeId === tile.id ? " is-active" : ""}`}
                        style={{
                            left: `${(tile.rect?.x ?? 0) * 100}%`,
                            top: `${(tile.rect?.y ?? 0) * 100}%`,
                            width: `${(tile.rect?.width ?? 0.2) * 100}%`,
                            height: `${(tile.rect?.height ?? 0.25) * 100}%`
                        }}
                    >
                        <PerformanceControl tile={tile} switchStyle="tiles" bypassed={false} renderMenu={false} />
                    </div>
                ))}
                {tiles.length === 0 && (
                    <button type="button" className="virtual-controls-empty" onClick={onEdit}>
                        <strong>NO VIRTUAL CONTROLS YET</strong>
                        <span>Open the layout editor to add pots, sliders, encoders, buttons and toggles.</span>
                    </button>
                )}
            </div>
            {confirmSave && (
                <ConfirmDialog
                    title="SAVE LIVE CHANGES?"
                    body={`Overwrite “${presetName}” with the current virtual-control settings?`}
                    confirmLabel="SAVE"
                    onCancel={() => setConfirmSave(false)}
                    onConfirm={() => void saveLiveChanges()}
                />
            )}
        </div>
    );
}
