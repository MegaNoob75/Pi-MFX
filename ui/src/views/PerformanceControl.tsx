import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clampUnit, isAnalogKind } from "../api";
import { num, obj, str, objects, type JsonObject } from "../json";
import { loadUiBehavior } from "../uiBehavior";
import MultiFXFootswitchGraphic, { MultiFXArcadeButtonGraphic } from "../theme/FootswitchGraphic";
import { MarqueeText } from "./MarqueeText";

const LONG_PRESS_MS = 600;
const CANCEL_MOVE_PX = 24;

export type SwitchRole = "preset" | "navigation" | "snapshot" | "bypass" | "utility";
export type LightState = "active" | "inactive" | "bypass" | "snapshot" | "modified";

export interface AnalogFeedback {
    source: string;
    effect: string;
    parameter: string;
    value: string;
    range: number;
}

export interface PerformanceTile {
    id: string;
    switchLabel: string;
    valueText: string;
    holdLabel?: string;
    empty?: boolean;
    role: SwitchRole;
    lightState: LightState;
    active: boolean;
    analog?: boolean;
    analogSource?: string;
    analogFunction?: string;
    analogValue?: string;
    assigned?: boolean;
    kind?: string;
    rect?: { x: number; y: number; width: number; height: number };
    value?: number;
    presetSlotIndex?: number;
    dropTarget?: boolean;
    dragging?: boolean;
    pressed?: boolean;
    encoderSelected?: boolean;
    freeform?: boolean;
    onPress: () => void;
    onValue?: (value: number) => void;
    onLongPress?: () => void;
    onFeedback?: (feedback: AnalogFeedback | null) => void;
    onPresetPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPresetPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPresetPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

function visualVars(role: SwitchRole, active: boolean) {
    const state = active ? "active" : "normal";
    const prefix = `--mfx-role-${role}-${state}`;
    return {
        background: `var(${prefix}-bg)`,
        border: `var(${prefix}-border)`,
        label: `var(${prefix}-label)`,
        value: `var(${prefix}-value)`,
        indicator: `var(${prefix}-indicator)`,
        shadow: `var(${prefix}-shadow)`
    };
}

function indicatorColor(tile: PerformanceTile, active: boolean, vars: ReturnType<typeof visualVars>) {
    if (tile.lightState === "bypass") {
        return "var(--mfx-role-bypass-active-indicator)";
    }
    if (tile.lightState === "snapshot") {
        return "var(--mfx-role-snapshot-active-indicator)";
    }
    if (tile.lightState === "modified") {
        return "var(--mfx-control-indicator-changed)";
    }
    return active ? vars.indicator : "var(--mfx-control-indicator-inactive)";
}

export function PerformanceControl({
    tile,
    switchStyle: _switchStyle,
    bypassed
}: {
    tile: PerformanceTile;
    switchStyle: string;
    bypassed: boolean;
}) {
    void _switchStyle;
    const analog = tile.analog || isAnalogKind(tile.kind ?? "");
    const assigned = tile.assigned ?? Boolean(tile.analogFunction && tile.analogFunction !== "UNASSIGNED");
    const popoutScale = loadUiBehavior().controlPopoutScale;
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
    const visualActive = analog ? tile.active : (tile.pressed || tile.active);
    const vars = visualVars(tile.role, visualActive);
    const led = indicatorColor(tile, visualActive, vars);

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

    const publishFeedback = () => {
        if (!tile.onFeedback) {
            return;
        }
        tile.onFeedback({
            source: tile.analogSource || tile.switchLabel,
            effect: tile.analogFunction?.split(" · ")[0] || "",
            parameter: tile.analogFunction?.split(" · ")[1] || tile.analogFunction || "",
            value: tile.analogValue || range.toFixed(2),
            range
        });
    };

    const begin = (event: ReactPointerEvent<HTMLButtonElement | HTMLDivElement>, keep: boolean) => {
        if (event.pointerType === "mouse" && event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        hold.current.suppressed = false;
        hold.current.pointerId = event.pointerId;
        hold.current.startX = event.clientX;
        hold.current.startY = event.clientY;
        if (tile.onPresetPointerDown) {
            tile.onPresetPointerDown(event as ReactPointerEvent<HTMLButtonElement>);
            return;
        }
        if (analog && tile.onValue) {
            const behavior = loadUiBehavior();
            if (behavior.controlPopout || keep) {
                setPopout(true);
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
                pointerId: event.pointerId,
                startY: event.clientY,
                startValue: range,
                bounds: event.currentTarget.getBoundingClientRect(),
                keep
            };
            publishFeedback();
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

    const move = (event: ReactPointerEvent<HTMLButtonElement | HTMLDivElement>) => {
        if (tile.onPresetPointerMove) {
            tile.onPresetPointerMove(event as ReactPointerEvent<HTMLButtonElement>);
            return;
        }
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
        if (kind === "slider" || kind === "expression") {
            next = 1 - (event.clientY - drag.current.bounds.top) / Math.max(1, drag.current.bounds.height);
        } else {
            const sensitivity = Math.max(90, drag.current.bounds.height * 0.9);
            next = drag.current.startValue + (drag.current.startY - event.clientY) / sensitivity;
        }
        const value = clampUnit(next);
        tile.onValue(value);
        tile.onFeedback?.({
            source: tile.analogSource || tile.switchLabel,
            effect: tile.analogFunction?.split(" · ")[0] || "",
            parameter: tile.analogFunction?.split(" · ")[1] || tile.analogFunction || "",
            value: value.toFixed(2),
            range: value
        });
    };

    const end = (event: ReactPointerEvent<HTMLButtonElement | HTMLDivElement>) => {
        if (tile.onPresetPointerUp) {
            tile.onPresetPointerUp(event as ReactPointerEvent<HTMLButtonElement>);
            return;
        }
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

    const analogCard = (className: string, style?: CSSProperties) => (
        <div
            className={`mfx-performance-control${className}`}
            data-control-kind={tile.kind ?? "pot"}
            data-assigned={assigned ? "true" : "false"}
            data-adjustable="true"
            style={{ touchAction: "none", WebkitTouchCallout: "none", userSelect: "none", ...style }}
            onPointerDown={(event) => begin(event, className.includes("popout"))}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!tile.onLongPress) {
                    return;
                }
                clearHold();
                hold.current.suppressed = true;
                tile.onLongPress();
            }}
        >
            <MarqueeText className="mfx-performance-control__source" text={tile.analogSource || tile.switchLabel} />
            <ControlGraphic kind={tile.kind ?? "pot"} range={range} active={tile.active} />
            <MarqueeText className="mfx-performance-control__function" text={tile.analogFunction || "UNASSIGNED"} />
            <MarqueeText className="mfx-performance-control__value" text={tile.analogValue || range.toFixed(2)} />
        </div>
    );

    if (analog) {
        return (
            <>
                {analogCard(popout ? " mfx-performance-control--source-hidden" : "")}
                {popout && createPortal(
                    <div
                        className="mfx-performance-control-popout"
                        role="dialog"
                        aria-modal="true"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                    >
                        {analogCard(" mfx-performance-control--popout", {
                            position: "relative",
                            width: `min(calc(100vw - 32px), ${Math.round(190 * popoutScale)}px)`,
                            height: `min(calc(100vh - 32px), ${Math.round(230 * popoutScale)}px)`
                        })}
                    </div>,
                    document.body
                )}
            </>
        );
    }

    const empty = Boolean(tile.empty);
    const holdText = tile.holdLabel;
    return (
        <button
            type="button"
            className="mfx-performance-switch"
            data-mfx-role={tile.role}
            data-mfx-active={visualActive ? "true" : "false"}
            data-mfx-modified={tile.lightState === "modified" ? "true" : "false"}
            data-mfx-light-state={bypassed && tile.role === "preset" && tile.active ? "bypass" : tile.lightState}
            data-mfx-performance-preset-index={tile.presetSlotIndex ?? undefined}
            onPointerDown={(event) => begin(event, false)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!tile.onLongPress) {
                    return;
                }
                clearHold();
                hold.current.suppressed = true;
                tile.onLongPress();
            }}
            style={{
                width: "100%",
                height: "100%",
                minHeight: 0,
                boxSizing: "border-box",
                pointerEvents: "auto",
                background: `${vars.background} padding-box, ${vars.border} border-box`,
                border: "var(--mfx-control-border-width) solid transparent",
                outline: tile.encoderSelected ? "4px solid var(--mfx-surface-header-border, var(--mfx-cyan))" : "none",
                outlineOffset: tile.encoderSelected ? "-6px" : "0",
                borderRadius: "var(--mfx-control-radius)",
                padding: tile.freeform ? 2 : undefined,
                containerType: tile.freeform ? "size" : undefined,
                display: "flex",
                flexDirection: "column",
                justifyContent: empty ? "center" : "space-between",
                alignItems: empty ? "center" : "stretch",
                boxShadow: tile.dropTarget
                    ? `${vars.shadow}, inset 0 0 0 4px var(--mfx-role-preset-active-border)`
                    : vars.shadow,
                overflow: "hidden",
                opacity: tile.dragging ? 0.38 : 1,
                color: "inherit",
                textAlign: "left",
                font: "inherit",
                userSelect: "none",
                WebkitUserSelect: "none",
                touchAction: "none"
            }}
        >
            <MultiFXFootswitchGraphic color={led} />
            <MultiFXArcadeButtonGraphic color={led} />
            <span
                aria-hidden="true"
                className="mfx-performance-indicator"
                style={{
                    position: "absolute",
                    top: tile.freeform ? "clamp(1px, 3cqh, 6px)" : 6,
                    right: tile.freeform ? "clamp(1px, 3cqw, 7px)" : 7,
                    width: tile.freeform ? "clamp(5px, min(11cqw, 20cqh), 16px)" : 16,
                    height: tile.freeform ? "clamp(5px, min(11cqw, 20cqh), 16px)" : 16,
                    borderRadius: "50%",
                    color: led,
                    border: "2px solid currentColor",
                    background: led,
                    boxShadow: visualActive ? "0 0 calc(14px * var(--mfx-control-glow-strength, 1)) currentColor" : "none",
                    boxSizing: "border-box"
                }}
            />
            {empty ? (
                <MarqueeText
                    text="+"
                    color={vars.value}
                    fontSize="clamp(24px, min(34px, 60cqh), 34px)"
                    fontWeight={900}
                    enabled={false}
                />
            ) : tile.freeform ? (
                <div
                    className="mfx-performance-switch__content"
                    style={{
                        width: "100%",
                        height: "100%",
                        minWidth: 0,
                        minHeight: 0,
                        display: "grid",
                        gridTemplateRows: holdText
                            ? "minmax(0,.78fr) minmax(0,1.55fr) minmax(0,.67fr)"
                            : "minmax(0,.82fr) minmax(0,1.78fr)",
                        gap: 1
                    }}
                >
                    <div
                        className="mfx-performance-switch__label-row"
                        style={{
                            minWidth: 0,
                            minHeight: 0,
                            paddingRight: tile.presetSlotIndex != null
                                ? "clamp(8px, min(17cqw, 28cqh), 26px)"
                                : 0
                        }}
                    >
                        <MarqueeText
                            className="mfx-performance-switch__label"
                            text={tile.switchLabel.toUpperCase()}
                            color={vars.label}
                            fontSize="var(--mfx-font-switch-label-size, clamp(10px, min(14px, 23cqh), 14px))"
                            fontWeight={800}
                            textTransform="uppercase"
                        />
                    </div>
                    <div className="mfx-performance-switch__value-row" style={{ minWidth: 0, minHeight: 0 }}>
                        <MarqueeText
                            className="mfx-performance-switch__value"
                            text={tile.valueText}
                            color={vars.value}
                            fontSize="var(--mfx-font-switch-value-size, clamp(18px, min(28px, 50cqh), 28px))"
                            fontWeight={900}
                        />
                    </div>
                    {holdText && (
                        <div className="mfx-performance-switch__hold-row" style={{ minWidth: 0, minHeight: 0 }}>
                            <MarqueeText
                                className="mfx-performance-switch__hold"
                                text={`HOLD: ${holdText}`.toUpperCase()}
                                color={vars.label}
                                fontSize="var(--mfx-font-switch-secondary-size, clamp(8px, min(11px, 18cqh), 11px))"
                                fontWeight={800}
                                textTransform="uppercase"
                                opacity={0.82}
                            />
                        </div>
                    )}
                </div>
            ) : (
                <>
                    <span
                        className="mfx-performance-switch__label"
                        style={{
                            width: "100%",
                            textAlign: "center",
                            fontWeight: 800,
                            color: vars.label,
                            textTransform: "uppercase",
                            fontSize: "var(--mfx-font-switch-label-size, 0.72rem)"
                        }}
                    >
                        {tile.switchLabel}
                    </span>
                    <MarqueeText
                        className="mfx-performance-switch__value"
                        text={tile.valueText}
                        color={vars.value}
                        fontSize="var(--mfx-font-switch-value-size, 1.05rem)"
                        fontWeight={900}
                    />
                    {holdText && (
                        <span
                            className="mfx-performance-switch__hold"
                            style={{
                                width: "100%",
                                color: vars.label,
                                fontSize: "clamp(.48rem, 1.05vw, .62rem)",
                                fontWeight: 800,
                                textAlign: "center",
                                textTransform: "uppercase",
                                opacity: 0.82
                            }}
                        >
                            HOLD: {holdText}
                        </span>
                    )}
                </>
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

export function analogFeedback(control: JsonObject, chain: JsonObject[]): AnalogFeedback {
    const binding = obj(control.binding);
    const source = str(control.label, str(control.id));
    if (str(binding.action) !== "setParameter") {
        return { source, effect: "", parameter: "UNASSIGNED", value: "", range: 0 };
    }
    const slot = chain.find((item) => str(item.id) === str(binding.slotId));
    if (!slot) {
        return { source, effect: "", parameter: "UNASSIGNED", value: "", range: 0 };
    }
    const plugin = obj(slot.plugin);
    const ports = objects(plugin.ports);
    const port = ports.find((item) => str(item.symbol) === str(binding.portSymbol));
    const controls = obj(obj(slot.state).controls);
    const value = num(controls[str(binding.portSymbol)]);
    const parameter = str(obj(port).name, str(binding.portSymbol));
    const effect = str(obj(slot).name) || str(plugin.name, "Effect");
    return {
        source,
        effect,
        parameter,
        value: Number.isFinite(value) ? value.toFixed(2) : "—",
        range: Number.isFinite(value) ? clampUnit(value) : 0
    };
}
