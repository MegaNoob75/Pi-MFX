import type { PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";
import { clampUnit, isAnalogKind } from "../api";
import { num, obj, str, objects, type JsonObject } from "../json";
import { loadUiBehavior } from "../uiBehavior";
import MultiFXFootswitchGraphic, { MultiFXArcadeButtonGraphic } from "../theme/FootswitchGraphic";

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
    const range = clampUnit(tile.value ?? (tile.active ? 1 : 0));

    const begin = (event: ReactPointerEvent<HTMLButtonElement>, keep: boolean) => {
        event.preventDefault();
        event.stopPropagation();
        if (!analog || !tile.onValue) {
            tile.onPress();
            return;
        }
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
        if (tile.kind === "slider" || tile.kind === "expression") {
            tile.onValue(clampUnit(1 - (event.clientY - bounds.top) / Math.max(1, bounds.height)));
        }
    };

    const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId || !tile.onValue) {
            return;
        }
        event.preventDefault();
        const kind = tile.kind ?? "pot";
        let next: number;
        if (kind === "slider" || kind === "expression") {
            next = 1 - (event.clientY - drag.current.bounds.top) / Math.max(1, drag.current.bounds.height);
        } else {
            const sensitivity = Math.max(90, drag.current.bounds.height * 0.9);
            next = drag.current.startValue + (drag.current.startY - event.clientY) / sensitivity;
        }
        tile.onValue(clampUnit(next));
    };

    const end = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) {
            return;
        }
        drag.current = null;
        const behavior = loadUiBehavior();
        window.setTimeout(() => setPopout(false), behavior.controlPopoutDurationMs);
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
