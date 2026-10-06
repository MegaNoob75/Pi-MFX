import { useEffect, useMemo, useRef, useState } from "react";
import { findPreset, type EngineSnapshot } from "../api";
import { bool, num, obj, objects, str, type JsonObject } from "../json";
import { askText } from "../keyboard/ask";
import { clampRect } from "../layout";
import {
    resolveVirtualControlDisplay,
    virtualBindingFor,
    virtualControlPageId,
    virtualControlPages,
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
    const pages = virtualControlPages(config);
    const controls: JsonObject[] = objects(config.controls).map((control): JsonObject => ({
        ...control, pageId: virtualControlPageId(control, pages)
    }));
    const preset = findPreset(state);
    const chain = objects(state.chain);
    const activeId = str(state.activeVirtualControlId);
    const revision = num(state.virtualControlRevision);
    const fine = bool(state.virtualControlFine);
    const previousRevision = useRef(revision);
    const previousActiveId = useRef(activeId);
    const popoutTimer = useRef<number | null>(null);
    const [proxyPopoutId, setProxyPopoutId] = useState("");
    const [confirmSave, setConfirmSave] = useState(false);
    const [confirmReload, setConfirmReload] = useState(false);
    const [saveStatus, setSaveStatus] = useState("");
    const [activePageId, setActivePageId] = useState(() => {
        const activeControl = controls.find((control) => str(control.id) === activeId);
        return activeControl ? virtualControlPageId(activeControl, pages) : str(pages[0]?.id, "page-1");
    });
    const pageTabDrag = useRef<{
        pointerId: number;
        startX: number;
        scrollLeft: number;
        dragged: boolean;
    } | null>(null);
    const suppressPageTabClick = useRef(false);
    const swipe = useRef<{ pointerId: number; x: number; y: number } | null>(null);
    const suppressSwipeClick = useRef(false);
    const activeSnapshot = num(obj(preset).activeSnapshot, -1);
    const presetName = str(obj(preset).name, "No preset loaded");
    const presetId = str(state.activePresetId);
    const dirty = bool(state.sessionPresetDirty);
    const pageIndex = Math.max(0, pages.findIndex((page) => str(page.id) === activePageId));
    const activePage = pages[pageIndex] ?? pages[0];
    const pageControls = controls.filter((control) => virtualControlPageId(control, pages) === str(activePage?.id));

    useEffect(() => {
        if (!pages.some((page) => str(page.id) === activePageId)) {
            setActivePageId(str(pages[0]?.id, "page-1"));
        }
    }, [config.pages, activePageId]);

    const showPage = (index: number) => {
        if (pages.length === 0) return;
        const wrapped = (index + pages.length) % pages.length;
        const page = pages[wrapped];
        const pageId = str(page.id);
        setActivePageId(pageId);
        const first = controls.find((control) => virtualControlPageId(control, pages) === pageId);
        void client.request("virtual-controls/select", { controlId: str(first?.id), presetId }).catch(() => undefined);
    };

    const saveLiveChanges = async () => {
        setConfirmSave(false);
        setSaveStatus("SAVING…");
        try {
            await client.request("preset/save", { presetId });
            setSaveStatus("CHANGES SAVED");
            window.setTimeout(() => setSaveStatus(""), 2200);
        } catch (error) {
            setSaveStatus(error instanceof Error ? error.message : "SAVE FAILED");
        }
    };

    const reloadSavedPreset = async () => {
        setConfirmReload(false);
        setSaveStatus("RELOADING…");
        try {
            await client.request("preset/restoreLive", { presetId });
            setSaveStatus("SAVED PRESET RESTORED");
            window.setTimeout(() => setSaveStatus(""), 2200);
        } catch (error) {
            setSaveStatus(error instanceof Error ? error.message : "RELOAD FAILED");
        }
    };

    const showProxyPopout = (id: string) => {
        setProxyPopoutId(id);
        if (popoutTimer.current !== null) window.clearTimeout(popoutTimer.current);
        popoutTimer.current = window.setTimeout(() => {
            popoutTimer.current = null;
            setProxyPopoutId("");
        }, 2200);
    };

    useEffect(() => {
        if (revision === previousRevision.current) return;
        previousRevision.current = revision;
        const selectionChanged = activeId !== previousActiveId.current;
        previousActiveId.current = activeId;
        if (selectionChanged) return;
        if (!activeId) return;
        showProxyPopout(activeId);
    }, [revision, activeId]);

    useEffect(() => () => {
        if (popoutTimer.current !== null) window.clearTimeout(popoutTimer.current);
    }, []);

    const tiles = useMemo(() => pageControls.map((control): PerformanceTile => {
        const id = str(control.id);
        const kind = str(control.kind, "pot");
        const binding = virtualBindingFor(preset, id);
        const display = resolveVirtualControlDisplay(control, binding, chain, state);
        const analog = kind === "pot" || kind === "slider" || kind === "encoder";
        const targetSlot = str(obj(binding).action) === "setParameter"
            ? chain.find((slot) => str(slot.id) === str(obj(binding).slotId))
            : undefined;
        const targetPort = objects(obj(obj(targetSlot).plugin).ports)
            .find((port) => str(port.symbol) === str(obj(binding).portSymbol));
        const manuallyEditable = analog && Boolean(targetSlot && targetPort)
            && !bool(obj(targetPort).trigger)
            && !bool(obj(targetPort).toggled)
            && !bool(obj(targetPort).enumerated);
        const minimum = virtualControlMinSize(kind, str(control.orientation, "vertical"));
        const select = () => {
            if (activeId !== id) void client.request("virtual-controls/select", { controlId: id, presetId }).catch(() => undefined);
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
                if (analog) return;
                void client.request("virtual-controls/press", { controlId: id, pressed: true, presetId })
                    .then(() => client.request("virtual-controls/press", { controlId: id, pressed: false, presetId }))
                    .catch(() => undefined);
            },
            onValue: analog && kind !== "encoder"
                ? (value) => {
                    showProxyPopout(id);
                    void client.request("virtual-controls/value", { controlId: id, value, presetId }).catch(() => undefined);
                }
                : undefined,
            onStep: kind === "encoder"
                ? (delta) => {
                    showProxyPopout(id);
                    void client.request("virtual-controls/turn", { controlId: id, delta, presetId }).catch(() => undefined);
                }
                : undefined,
            onDoublePress: manuallyEditable
                ? () => {
                    select();
                    const port = obj(targetPort);
                    const bindingValue = obj(binding);
                    const symbol = str(port.symbol);
                    const minimumValue = num(bindingValue.min, num(port.min, 0));
                    const maximumValue = num(bindingValue.max, num(port.max, 1));
                    const currentValue = num(obj(obj(obj(targetSlot).state).controls)[symbol], num(port.default, minimumValue));
                    const initialValue = bool(port.integer)
                        ? String(Math.round(currentValue))
                        : String(Number(currentValue.toFixed(4)));
                    void askText(display.label, initialValue, "numeric").then((typed) => {
                        if (typed === null) return;
                        const parsed = Number(typed.trim());
                        if (!Number.isFinite(parsed)) return;
                        const low = Math.min(minimumValue, maximumValue);
                        const high = Math.max(minimumValue, maximumValue);
                        const bounded = Math.min(high, Math.max(low, parsed));
                        const value = bool(port.integer) ? Math.round(bounded) : bounded;
                        showProxyPopout(id);
                        void client.request("chain/control", {
                            slotId: str(obj(targetSlot).id),
                            port: symbol,
                            value,
                            persist: true
                        }).catch(() => undefined);
                    });
                }
                : undefined,
            onPageSwipe: pages.length > 1
                ? (delta) => showPage(pageIndex + delta)
                : undefined
        };
    }), [pageControls, preset, chain, state, activeId, proxyPopoutId, client, presetId, pageIndex]);

    return (
        <div className="virtual-controls-view">
            <div className="virtual-controls-status">
                <span className="virtual-controls-layout">{str(config.layoutName, "default").toUpperCase()}</span>
                <div className="virtual-page-tabs" aria-label="Virtual Control pages"
                    onPointerDown={(event) => {
                        if (event.pointerType === "mouse" && event.button !== 0) return;
                        suppressPageTabClick.current = false;
                        pageTabDrag.current = {
                            pointerId: event.pointerId,
                            startX: event.clientX,
                            scrollLeft: event.currentTarget.scrollLeft,
                            dragged: false
                        };
                    }}
                    onPointerMove={(event) => {
                        const drag = pageTabDrag.current;
                        if (!drag || drag.pointerId !== event.pointerId) return;
                        const dx = event.clientX - drag.startX;
                        if (!drag.dragged && Math.abs(dx) >= 4) {
                            drag.dragged = true;
                            try {
                                event.currentTarget.setPointerCapture(event.pointerId);
                            } catch {
                                // Optional on older touch browsers.
                            }
                        }
                        if (!drag.dragged) return;
                        event.preventDefault();
                        event.currentTarget.scrollLeft = drag.scrollLeft - dx;
                    }}
                    onPointerUp={(event) => {
                        const drag = pageTabDrag.current;
                        if (!drag || drag.pointerId !== event.pointerId) return;
                        pageTabDrag.current = null;
                        suppressPageTabClick.current = drag.dragged;
                        try {
                            event.currentTarget.releasePointerCapture(event.pointerId);
                        } catch {
                            // Optional on older touch browsers.
                        }
                    }}
                    onPointerCancel={() => {
                        pageTabDrag.current = null;
                        suppressPageTabClick.current = false;
                    }}
                    onClickCapture={(event) => {
                        if (!suppressPageTabClick.current) return;
                        suppressPageTabClick.current = false;
                        event.preventDefault();
                        event.stopPropagation();
                    }}>
                    {pages.map((page, index) => <button key={str(page.id)} type="button"
                        className={index === pageIndex ? "active" : ""} onClick={() => showPage(index)}>
                        {str(page.name, `Page ${index + 1}`)}
                    </button>)}
                </div>
                <span className="virtual-controls-preset">
                    <small>CURRENT PRESET</small>
                    <strong>{presetName}</strong>
                    <small>{dirty ? "UNSAVED LIVE CHANGES" : tiles.find((tile) => tile.id === activeId) ? `ACTIVE · ${tiles.find((tile) => tile.id === activeId)?.switchLabel}` : "SAVED PRESET"}</small>
                </span>
                {fine && <strong>FINE</strong>}
                {saveStatus && <strong className="virtual-controls-save-status">{saveStatus}</strong>}
                <button
                    type="button"
                    className="btn"
                    disabled={!preset || !dirty || activeSnapshot >= 0 || saveStatus === "SAVING…"}
                    title={activeSnapshot >= 0 ? "Return to the base preset before saving" : "Save the current live sound to this preset"}
                    onClick={() => setConfirmSave(true)}
                >SAVE CHANGES TO PRESET</button>
                <button
                    type="button"
                    className="btn"
                    disabled={!preset || !dirty}
                    title="Discard temporary changes and restore the saved preset"
                    onClick={() => setConfirmReload(true)}
                >RELOAD SAVED</button>
                <button type="button" className="btn" onClick={onEdit}>EDIT LAYOUT</button>
            </div>
            <div className="virtual-controls-stage"
                onPointerDownCapture={(event) => {
                    if (event.target instanceof Element && event.target.closest(".virtual-control-slot")) return;
                    suppressSwipeClick.current = false;
                    swipe.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
                }}
                onPointerUpCapture={(event) => {
                    const start = swipe.current;
                    swipe.current = null;
                    if (!start || start.pointerId !== event.pointerId || pages.length < 2) return;
                    const dx = event.clientX - start.x;
                    const dy = event.clientY - start.y;
                    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.25) {
                        suppressSwipeClick.current = true;
                        showPage(pageIndex + (dx < 0 ? 1 : -1));
                    }
                }}
                onClickCapture={(event) => {
                    if (!suppressSwipeClick.current) return;
                    suppressSwipeClick.current = false;
                    event.preventDefault();
                    event.stopPropagation();
                }}
                onPointerCancelCapture={() => { swipe.current = null; }}>
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
                        <strong>NO CONTROLS ON {str(activePage?.name, `PAGE ${pageIndex + 1}`).toUpperCase()}</strong>
                        <span>Open the layout editor to add controls, or swipe to another page.</span>
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
            {confirmReload && (
                <ConfirmDialog
                    title="DISCARD LIVE CHANGES?"
                    body={`Discard all temporary changes to “${presetName}” and restore its saved version?`}
                    confirmLabel="DISCARD & RELOAD"
                    danger
                    onCancel={() => setConfirmReload(false)}
                    onConfirm={() => void reloadSavedPreset()}
                />
            )}
        </div>
    );
}
