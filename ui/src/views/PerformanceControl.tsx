import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { clampUnit, isAnalogKind } from "../api";
import { num, obj, str, objects, type JsonObject } from "../json";
import { loadUiBehavior } from "../uiBehavior";
import MultiFXFootswitchGraphic, { MultiFXArcadeButtonGraphic } from "../theme/FootswitchGraphic";

const LONG_PRESS_MS = 600;
const CANCEL_MOVE_PX = 24;

export interface PerformanceTile {
    id: string;
    label: string;
    active: boolean;
    color?: string;
    kind?: string;
    rect?: { x: number; y: number; width: number; height: number };
    value?: number;
    feedback?: string;
    analog?: boolean;
    onPress: () => void;
    onValue?: (value: number) => void;
    onLongPress?: () => void;
}

export function PerformanceControl({
    tile,
    switchStyle,
    bypassed
}: {
    tile: PerformanceTile;
    switchStyle: string;
    bypassed: boolean;
}) {
    const analog = tile.analog || isAnalogKind(tile.kind ?? "");
    const [popout, setPopout] = useState(false);
    const drag = useRef<{
        pointerId: number;
        startY: number;
        startValue: number;
        bounds: DOMRect;
        keep: boolean;
    } | null>(null);
    const hold = useRef<{
        timer: number | null;
        pointerId: number;
        startX: number;
        startY: number;
        suppressed: boolean;
    }>({ timer: null, pointerId: -1, startX: 0, startY: 0, suppressed: false });
    const range = clampUnit(tile.value ?? (tile.active ? 1 : 0));

    const clearHold = () => {
        if (hold.current.timer !== null) {
            window.clearTimeout(hold.current.timer);
            hold.current.timer = null;
        }
    };

    useEffect(() => () => clearHold(), []);

    const openHoldMenu = () => {
        hold.current.timer = null;
        hold.current.suppressed = true;
        tile.onLongPress?.();
    };

    const begin = (event: ReactPointerEvent<HTMLButtonElement>, keep: boolean) => {
        event.preventDefault();
        event.stopPropagation();
        hold.current.suppressed = false;
        hold.current.pointerId = event.pointerId;
        hold.current.startX = event.clientX;
        hold.current.startY = event.clientY;
        if (analog && tile.onValue) {
            const behavior = loadUiBehavior();
            if (behavior.controlPopout || keep) {
                setPopout(true);
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            const bounds = event.currentTarget.getBoundingClientRect();
            drag.current = {
                pointerId: event.pointerId,
                startY: event.clientY,
                startValue: range,
                bounds,
                keep
            };
            if (tile.onLongPress) {
                hold.current.timer = window.setTimeout(openHoldMenu, LONG_PRESS_MS);
            }
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        if (tile.onLongPress) {
            hold.current.timer = window.setTimeout(openHoldMenu, LONG_PRESS_MS);
        }
    };

    const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const dx = event.clientX - hold.current.startX;
        const dy = event.clientY - hold.current.startY;
        const cancelPx = analog ? 8 : CANCEL_MOVE_PX;
        if (hold.current.timer !== null && (dx * dx + dy * dy) > cancelPx * cancelPx) {
            clearHold();
        }
        if (analog && hold.current.suppressed) {
            return;
        }
        if (!drag.current || drag.current.pointerId !== event.pointerId || !tile.onValue) {
            return;
        }
        event.preventDefault();
        const kind = tile.kind ?? "pot";
        let next: number;
        if (kind === "slider" || tile.kind === "expression") {
            next = 1 - (event.clientY - drag.current.bounds.top) / Math.max(1, drag.current.bounds.height);
        } else {
            const sensitivity = Math.max(90, drag.current.bounds.height * 0.9);
            next = drag.current.startValue + (drag.current.startY - event.clientY) / sensitivity;
        }
        tile.onValue(clampUnit(next));
    };

    const end = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const analogDrag = drag.current && drag.current.pointerId === event.pointerId;
        const suppressed = hold.current.suppressed;
        clearHold();
        drag.current = null;
        if (analogDrag) {
            const behavior = loadUiBehavior();
            window.setTimeout(() => setPopout(false), behavior.controlPopoutDurationMs);
            return;
        }
        if (!suppressed) {
            tile.onPress();
        }
    };

    const light = bypassed ? "bypass" : tile.active ? "active" : "inactive";
    return (
        <button
            type="button"
            className={`footswitch mfx-performance-switch mfx-performance-control is-${light}${popout ? " mfx-performance-control--popout" : ""}`}
            data-adjustable={analog ? "true" : "false"}
            onPointerDown={(event) => begin(event, false)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onContextMenu={(event) => {
                if (!tile.onLongPress) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                clearHold();
                hold.current.suppressed = true;
                tile.onLongPress();
            }}
            style={tile.color ? { borderColor: tile.color } : undefined}
        >
            {analog ? (
                <ControlGraphic kind={tile.kind ?? "pot"} range={range} active={tile.active} />
            ) : (
                <>
                    {switchStyle === "footswitch" && <MultiFXFootswitchGraphic color="currentColor" />}
                    {switchStyle === "arcade" && <MultiFXArcadeButtonGraphic color="currentColor" />}
                    <span className="led" />
                </>
            )}
            <span className="label marquee mfx-performance-control__function">{tile.label}</span>
            {tile.feedback && (
                <span className="muted mfx-performance-control__value">{tile.feedback}</span>
            )}
        </button>
    );
}

function ControlGraphic({ kind, range, active }: { kind: string; range: number; active: boolean }) {
    if (kind === "slider" || kind === "expression") {
        return (
            <div className="mfx-hardware-slider" aria-hidden="true">
                <div className="mfx-hardware-slider__fill" style={{ height: `${range * 100}%` }} />
                <div className="mfx-hardware-slider__thumb" style={{ bottom: `calc(${range * 100}% - 5px)` }} />
            </div>
        );
    }
    if (kind === "momentary") {
        return <div className="mfx-hardware-button" data-active={active ? "true" : "false"} aria-hidden="true" />;
    }
    const degrees = -135 + range * 270;
    return (
        <div className="mfx-hardware-knob" data-encoder={kind === "encoder" ? "true" : "false"} aria-hidden="true">
            <div className="mfx-hardware-knob__pointer" style={{ transform: `rotate(${degrees}deg)` }} />
            <div
                className="mfx-hardware-knob__arc"
                style={{
                    background: `conic-gradient(from 225deg, var(--mfx-surface-panel-accent) 0deg ${range * 270}deg, transparent ${range * 270}deg 360deg)`
                }}
            />
        </div>
    );
}

export function analogFeedback(control: JsonObject, chain: JsonObject[]): string {
    const binding = obj(control.binding);
    if (str(binding.action) !== "setParameter") {
        return "";
    }
    const slot = chain.find((item) => str(item.id) === str(binding.slotId));
    if (!slot) {
        return "";
    }
    const ports = objects(obj(slot.plugin).ports);
    const port = ports.find((item) => str(item.symbol) === str(binding.portSymbol));
    const controls = obj(obj(slot.state).controls);
    const value = num(controls[str(binding.portSymbol)]);
    const name = str(obj(port).name, str(binding.portSymbol));
    return name ? `${name} ${value.toFixed(2)}` : value.toFixed(2);
}
