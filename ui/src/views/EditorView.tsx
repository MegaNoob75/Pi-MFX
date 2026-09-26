import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { controlValue, findBank, findPreset, useMeters, type EngineSnapshot } from "../api";
import { arr, bool, isObj, num, obj, str, objects, type JsonObject } from "../json";
import { askText } from "../keyboard/ask";
import { updateUiSessionSection } from "../uiSession";
import { LibraryBrowser } from "./LibraryManager";
import { PluginBrowser } from "./PluginBrowser";
import { MarqueeText } from "./MarqueeText";
import { NewPresetDialog } from "./NewPresetDialog";
import { GainMeter } from "./GainMeter";

type EditPage = "chain" | "controls" | "io";
type PathBrowserKind = "model" | "ir";
const PATH_BROWSER_DIR_KEYS: Record<PathBrowserKind, string> = {
    model: "pimfx-nam-browser-dir",
    ir: "pimfx-ir-browser-dir"
};

const NOTE_DIVISIONS = [
    { beats: 4, label: "1/1" },
    { beats: 3, label: "1/2 D" },
    { beats: 2, label: "1/2" },
    { beats: 1.5, label: "1/4 D" },
    { beats: 1, label: "1/4" },
    { beats: 0.75, label: "1/8 D" },
    { beats: 2 / 3, label: "1/4 T" },
    { beats: 0.5, label: "1/8" },
    { beats: 1 / 3, label: "1/8 T" },
    { beats: 0.375, label: "1/16 D" },
    { beats: 0.25, label: "1/16" },
    { beats: 1 / 6, label: "1/16 T" }
];

type BindTarget =
    | { mode: "parameter"; slotId: string; portSymbol: string; name: string; min: number; max: number }
    | { mode: "bypass"; slotId: string; name: string };

export function EditorView({
    engine,
    run,
    lockChain = false,
    backRequest = 0,
    onSnapshots,
    onPageChange
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    lockChain?: boolean;
    backRequest?: number;
    onSnapshots?: () => void;
    onPageChange?: (page: EditPage, title?: string) => void;
}) {
    const { client, state, catalog, library } = engine;
    const chain = objects(state.chain);
    const plugins = objects(catalog.plugins);
    const preset = findPreset(state);
    const bank = findBank(state);
    const banks = objects(state.banks).filter((item) => !bool(item.communityHolding));
    const [selectedId, setSelectedId] = useState("");
    const [page, setPage] = useState<EditPage>("chain");
    const [ioKind, setIoKind] = useState<"input" | "output">("input");
    const [browser, setBrowser] = useState<{ mode: "add" | "replace"; index: number } | null>(null);
    const [dragId, setDragId] = useState("");
    const [dragOverTrash, setDragOverTrash] = useState(false);
    const [dropGap, setDropGap] = useState<number | null>(null);
    const [dragGhost, setDragGhost] = useState<{ title: string; x: number; y: number } | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [pendingTrashId, setPendingTrashId] = useState("");
    const [newPresetOpen, setNewPresetOpen] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [bindTarget, setBindTarget] = useState<BindTarget | null>(null);
    const [dropBankId, setDropBankId] = useState("");
    const dragRef = useRef<{ id: string; title: string; from: number; x: number; y: number; dragging: boolean } | null>(null);
    const pickerHoldRef = useRef<number | null>(null);
    const pickerHoldFiredRef = useRef(false);
    const chainPageRef = useRef<HTMLDivElement | null>(null);
    const [chainItemsPerRow, setChainItemsPerRow] = useState(5);
    const [chainCardWidth, setChainCardWidth] = useState(142);

    useEffect(() => {
        const sharedPage = str(engine.uiSession.editorPage) as EditPage;
        if (["chain", "controls", "io"].includes(sharedPage) && sharedPage !== page) {
            setPage(sharedPage);
        }
        const sharedSelectedId = str(engine.uiSession.editorSelectedId);
        if (sharedSelectedId && sharedSelectedId !== selectedId) {
            setSelectedId(sharedSelectedId);
        }
        const sharedIoKind = str(engine.uiSession.editorIoKind);
        if ((sharedIoKind === "input" || sharedIoKind === "output") && sharedIoKind !== ioKind) {
            setIoKind(sharedIoKind);
        }
    }, [engine.uiSession.editorPage, engine.uiSession.editorSelectedId, engine.uiSession.editorIoKind]);

    const selected = chain.find((slot) => str(slot.id) === selectedId) ?? chain[0];
    const plugin = obj(obj(selected).plugin);
    const ports = objects(plugin.ports).filter((port) => str(port.kind) === "control"
        && bool(port.input, true) && !bool(port.notOnGui));
    const properties = objects(plugin.properties);
    const models = objects(library.models);
    const aidax = objects(library.aidax);
    const irs = objects(library.impulseResponses);
    const controller = obj(state.controller);
    const controls = objects(controller.controls);
    const parameterBindings = objects(obj(preset).parameterBindings);
    const bindForParameter = (slotId: string, symbol: string) =>
        parameterBindings.find((binding) =>
            str(binding.action) === "setParameter"
            && str(binding.slotId) === slotId
            && str(binding.portSymbol) === symbol);
    const bindForBypass = (slotId: string) =>
        parameterBindings.find((binding) =>
            str(binding.action) === "toggleEffect" && str(binding.slotId) === slotId);

    const applyBind = (payload: JsonObject) => {
        if (!str(payload.controlId)) {
            setBindTarget(null);
            return;
        }
        void run(() => client.request("preset/bind", payload)).then(() => setBindTarget(null));
    };
    const selectedIndex = chain.findIndex((slot) => str(slot.id) === str(obj(selected).id));
    const effectTitle = str(obj(selected).name) || str(plugin.name, "Effect");

    useEffect(() => {
        onPageChange?.(page, page === "chain" ? undefined : page === "io" ? (ioKind === "input" ? "INPUT" : "OUTPUT") : effectTitle);
    }, [page, effectTitle, ioKind]);

    const previousBackRequestRef = useRef(backRequest);

    useEffect(() => {
        if (backRequest === previousBackRequestRef.current) {
            return;
        }
        previousBackRequestRef.current = backRequest;
        setPage("chain");
        client.updateUiSession({ editorPage: "chain", editSubpage: "chain" });
    }, [backRequest]);

    useEffect(() => {
        const ids = new Set(chain.map((slot) => str(slot.id)));
        if (selectedId && !ids.has(selectedId)) {
            setSelectedId("");
        }
    }, [str(state.activePresetId), chain.map((slot) => str(slot.id)).join("|")]);

    useEffect(() => {
        if (page !== "chain") {
            return;
        }
        const element = chainPageRef.current;
        if (!element) {
            return;
        }
        const updateLayout = () => {
            const style = getComputedStyle(element);
            const availableWidth = Math.max(
                1,
                element.clientWidth
                    - (parseFloat(style.paddingLeft) || 0)
                    - (parseFloat(style.paddingRight) || 0)
            );
            const uiScale = Math.max(0.5, parseFloat(
                getComputedStyle(document.documentElement).getPropertyValue("--mfx-ui-scale")
            ) || 1);
            const targetCardWidth = 142 * uiScale;
            const connectorWidth = 70 * uiScale;
            const itemsPerRow = Math.max(2, Math.floor(
                (availableWidth + connectorWidth) / (targetCardWidth + connectorWidth)
            ));
            const widthForCards = (availableWidth - Math.max(0, itemsPerRow - 1) * connectorWidth) / itemsPerRow;
            setChainItemsPerRow(itemsPerRow);
            setChainCardWidth(Math.max(118 * uiScale, Math.min(210 * uiScale, widthForCards)));
        };
        updateLayout();
        const observer = new ResizeObserver(updateLayout);
        observer.observe(element);
        return () => observer.disconnect();
    }, [page]);

    const chainNodes = useMemo(() => {
        const nodes: {
            key: string;
            kind: "input" | "plugin" | "output";
            globalIndex: number;
            slot?: JsonObject;
            chainIndex?: number;
        }[] = [{ key: "input", kind: "input", globalIndex: 0 }];
        chain.forEach((slot, index) => {
            nodes.push({
                key: str(slot.id),
                kind: "plugin",
                globalIndex: index + 1,
                slot,
                chainIndex: index
            });
        });
        nodes.push({ key: "output", kind: "output", globalIndex: chain.length + 1 });
        return nodes;
    }, [chain]);

    const chainRows = useMemo(() => {
        const rows: typeof chainNodes[] = [];
        for (let i = 0; i < chainNodes.length; i += chainItemsPerRow) {
            rows.push(chainNodes.slice(i, i + chainItemsPerRow));
        }
        return rows;
    }, [chainNodes, chainItemsPerRow]);

    const addAfter = (globalIndex: number) => {
        if (lockChain || globalIndex < 0 || globalIndex >= chainNodes.length - 1) {
            return;
        }
        setBrowser({ mode: "add", index: globalIndex });
    };

    const openControls = (slotId: string) => {
        setSelectedId(slotId);
        setPage("controls");
        client.updateUiSession({
            editorPage: "controls",
            editorSelectedId: slotId,
            editSubpage: "controls"
        });
    };

    const onPointerDown = (slot: JsonObject, index: number, event: React.PointerEvent) => {
        if (lockChain) {
            return;
        }
        dragRef.current = {
            id: str(slot.id),
            title: str(slot.name) || str(obj(slot.plugin).name, "Effect"),
            from: index,
            x: event.clientX,
            y: event.clientY,
            dragging: false
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const isTrashAtPoint = (x: number, y: number) => {
        const trash = document.querySelector("[data-chain-trash]") as HTMLElement | null;
        if (!trash) {
            return false;
        }
        const rect = trash.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    const onPointerMove = (event: React.PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) {
            return;
        }
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 10) {
            drag.dragging = true;
            setDragId(drag.id);
            setDragGhost({ title: drag.title, x: event.clientX, y: event.clientY });
        }
        setDragOverTrash(isTrashAtPoint(event.clientX, event.clientY));
        const gap = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-chain-index]") as HTMLElement | null;
        const gapIndex = Number(gap?.dataset.chainIndex);
        setDropGap(Number.isInteger(gapIndex) ? gapIndex : null);
    };

    const onPointerUp = (slot: JsonObject, event: React.PointerEvent) => {
        const drag = dragRef.current;
        dragRef.current = null;
        const wasDragging = Boolean(drag?.dragging);
        setDragId("");
        setDragOverTrash(false);
        setDragGhost(null);
        setDropGap(null);
        if (!drag || !wasDragging) {
            openControls(str(slot.id));
            return;
        }
        if (isTrashAtPoint(event.clientX, event.clientY)) {
            setPendingTrashId(drag.id);
            return;
        }
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-chain-index]") as HTMLElement | null;
        if (target) {
            const index = Number(target.dataset.chainIndex);
            if (Number.isInteger(index) && index !== drag.from) {
                void run(() => client.request("chain/move", { slotId: drag.id, index }));
            }
        }
    };

    return (
        <div className="mfx-screen editor-screen">
            <div className="editor-main">
            {page === "chain" && (
                <>
                    <div className="editor-toolbar editor-chain-bar">
                        <div className="editor-primary-actions">
                            {!lockChain && (
                                <button type="button" className="btn btn-accent" onClick={() => setNewPresetOpen(true)}>NEW</button>
                            )}
                            <button type="button" className="btn" onClick={onSnapshots}>SNAPSHOTS</button>
                        </div>
                        <button
                            type="button"
                            className="editor-preset-name"
                            onPointerDown={() => {
                                if (lockChain) {
                                    return;
                                }
                                pickerHoldFiredRef.current = false;
                                if (pickerHoldRef.current) {
                                    window.clearTimeout(pickerHoldRef.current);
                                }
                                pickerHoldRef.current = window.setTimeout(() => {
                                    pickerHoldRef.current = null;
                                    pickerHoldFiredRef.current = true;
                                    void askText("Rename preset", str(obj(preset).name, "Preset")).then((name) => {
                                        if (name?.trim() && str(obj(preset).id)) {
                                            void run(() => client.request("preset/rename", {
                                                presetId: str(obj(preset).id),
                                                name: name.trim()
                                            }));
                                        }
                                    });
                                }, 550);
                            }}
                            onPointerUp={() => {
                                if (pickerHoldRef.current) {
                                    window.clearTimeout(pickerHoldRef.current);
                                    pickerHoldRef.current = null;
                                }
                                if (!lockChain && !pickerHoldFiredRef.current) {
                                    setPickerOpen(true);
                                }
                            }}
                            onPointerCancel={() => {
                                if (pickerHoldRef.current) {
                                    window.clearTimeout(pickerHoldRef.current);
                                    pickerHoldRef.current = null;
                                }
                            }}
                        >
                            <MarqueeText
                                text={`${str(obj(bank).name, "Bank")} / ${str(obj(preset).name, "Preset")}`}
                                align="center"
                                fontWeight={900}
                            />
                            <span className="editor-preset-chevron">▾</span>
                        </button>
                        {!lockChain ? (
                            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                                DELETE
                            </button>
                        ) : <div />}
                        {lockChain && (
                            <div className="editor-toolbar-copy">
                                <span>Snapshot editing cannot add, remove or reorder effects.</span>
                            </div>
                        )}
                    </div>
                    <div className="chain-page" ref={chainPageRef}>
                        {chainRows.map((logicalRow, rowIndex) => {
                            const flowsLeft = rowIndex % 2 === 1;
                            const visualRow = flowsLeft ? [...logicalRow].reverse() : logicalRow;
                            return (
                                <div key={`row-${rowIndex}`}>
                                    <div className={`chain-row${flowsLeft ? " rtl" : ""}`}>
                                        {visualRow.map((node, visualIndex) => {
                                            const nextVisual = visualRow[visualIndex + 1];
                                            const sourceIndex = nextVisual
                                                ? Math.min(node.globalIndex, nextVisual.globalIndex)
                                                : -1;
                                            return (
                                                <div key={node.key} className="chain-node">
                                                    {node.kind === "plugin" && node.slot
                                                        ? (
                                                            <ChainPluginCard
                                                                slot={node.slot}
                                                                chainIndex={node.chainIndex ?? 0}
                                                                cardWidth={chainCardWidth}
                                                                selected={str(obj(selected).id) === str(node.slot.id)}
                                                                dragging={dragId === str(node.slot.id)}
                                                                lockChain={lockChain}
                                                                onPointerDown={(event) => onPointerDown(node.slot!, node.chainIndex ?? 0, event)}
                                                                onPointerMove={onPointerMove}
                                                                onPointerUp={(event) => onPointerUp(node.slot!, event)}
                                                                onPointerCancel={() => {
                                                                    dragRef.current = null;
                                                                    setDragId("");
                                                                    setDragOverTrash(false);
                                                                }}
                                                                onToggle={() => void run(() => client.request("chain/enable", {
                                                                    slotId: str(node.slot!.id),
                                                                    enabled: !bool(node.slot!.enabled, true)
                                                                }))}
                                                                bypassBound={Boolean(bindForBypass(str(node.slot.id)))}
                                                                onBypassLongPress={() => setBindTarget({
                                                                    mode: "bypass",
                                                                    slotId: str(node.slot!.id),
                                                                    name: str(node.slot!.name) || str(obj(obj(node.slot).plugin).name, "Effect")
                                                                })}
                                                            />
                                                        )
                                                        : (
                                                            <button
                                                                type="button"
                                                                className={`chain-slot endpoint${selectedId === node.kind ? " selected" : ""}`}
                                                                style={{ flex: `0 0 ${chainCardWidth}px`, width: chainCardWidth }}
                                                                onClick={() => {
                                                                    const kind = node.kind === "input" ? "input" : "output";
                                                                    setIoKind(kind);
                                                                    setSelectedId(node.kind);
                                                                    setPage("io");
                                                                    client.updateUiSession({
                                                                        editorPage: "io",
                                                                        editorSelectedId: node.kind,
                                                                        editorIoKind: kind,
                                                                        editSubpage: "io"
                                                                    });
                                                                }}
                                                            >
                                                                <strong>{node.kind === "input" ? "INPUT" : "OUTPUT"}</strong>
                                                                <div className="muted">{node.kind === "input" ? "SIGNAL IN" : "SIGNAL OUT"}</div>
                                                            </button>
                                                        )}
                                                    {nextVisual && sourceIndex >= 0 && (
                                                        <div
                                                            className={`chain-connector${flowsLeft ? " left" : " right"}${dropGap === sourceIndex ? " drop-active" : ""}`}
                                                            data-chain-index={sourceIndex}
                                                        >
                                                            <button
                                                                type="button"
                                                                className="chain-insert"
                                                                disabled={lockChain}
                                                                onClick={() => addAfter(sourceIndex)}
                                                            >
                                                                +
                                                            </button>
                                                            <span className="chain-flow-line" />
                                                            <span className="chain-flow-arrow">{flowsLeft ? "◀" : "▶"}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {rowIndex < chainRows.length - 1 && (
                                        <div
                                            className={`chain-turn ${flowsLeft ? "left" : "right"}${dropGap === logicalRow[logicalRow.length - 1].globalIndex ? " drop-active" : ""}`}
                                            data-chain-index={logicalRow[logicalRow.length - 1].globalIndex}
                                        >
                                            {!lockChain && (
                                                <button
                                                    type="button"
                                                    className="chain-insert"
                                                    onClick={() => addAfter(logicalRow[logicalRow.length - 1].globalIndex)}
                                                >
                                                    +
                                                </button>
                                            )}
                                            <span className="chain-turn-line" />
                                            <span className="chain-flow-arrow">▼</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {dragGhost && (
                            <>
                                <div className={`chain-trash-icon${dragOverTrash ? " active" : ""}`} data-chain-trash="true">🗑</div>
                                {createPortal(
                                    <div className="chain-ghost" style={{ left: dragGhost.x + 16, top: dragGhost.y + 14 }}>
                                        <div>{dragGhost.title}</div>
                                        <div className="muted">MOVE EFFECT</div>
                                    </div>,
                                    document.body
                                )}
                            </>
                        )}
                    </div>
                </>
            )}

            {page === "io" && (
                <>
                    <div className="editor-toolbar">
                        <div className="editor-toolbar-copy">
                            <strong>{ioKind === "input" ? "INPUT" : "OUTPUT"}</strong>
                            <span>{ioKind === "input" ? "Guitar input gain and channel" : "Output level"}</span>
                        </div>
                    </div>
                    <div className="page-scroll" style={{ flex: 1, minHeight: 0 }}>
                        <ChainIoPanel kind={ioKind} engine={engine} run={run} />
                    </div>
                </>
            )}

            {page !== "chain" && page !== "io" && selected && (
                <>
                    <div className="editor-toolbar">
                        <div className="editor-toolbar-copy">
                            <strong>{effectTitle}</strong>
                            <span>{str(plugin.category) || str(plugin.brand) || "Effect settings"}</span>
                        </div>
                        <button
                            type="button"
                            className={`btn ${bool(selected.enabled, true) ? "btn-active" : ""}`}
                            onClick={() => void run(() => client.request("chain/enable", {
                                slotId: str(selected.id),
                                enabled: !bool(selected.enabled, true)
                            }))}
                        >
                            {bool(selected.enabled, true) ? "ON" : "BYPASS"}
                        </button>
                        {!lockChain && (
                            <>
                                <button type="button" className="btn" onClick={() => {
                                    void askText("Effect name", effectTitle).then((name) => {
                                        if (name) {
                                            void run(() => client.request("chain/name", {
                                                slotId: str(selected.id),
                                                name
                                            }));
                                        }
                                    });
                                }}>RENAME</button>
                                <button type="button" className="btn" disabled={selectedIndex <= 0} onClick={() => {
                                    void run(() => client.request("chain/move", { slotId: str(selected.id), index: selectedIndex - 1 }));
                                }}>←</button>
                                <button type="button" className="btn" disabled={selectedIndex >= chain.length - 1} onClick={() => {
                                    void run(() => client.request("chain/move", { slotId: str(selected.id), index: selectedIndex + 1 }));
                                }}>→</button>
                                <button type="button" className="btn" onClick={() => setBrowser({ mode: "replace", index: selectedIndex })}>
                                    REPLACE
                                </button>
                                <button type="button" className="btn btn-danger" onClick={() => {
                                    if (window.confirm(`Remove ${effectTitle}?`)) {
                                        void run(() => client.request("chain/remove", { slotId: str(selected.id) })).then(() => {
                                            setPage("chain");
                                            client.updateUiSession({ editorPage: "chain", editSubpage: "chain" });
                                        });
                                    }
                                }}>REMOVE</button>
                            </>
                        )}
                    </div>
                    <div className="page-scroll" style={{ flex: 1, minHeight: 0 }}>
                        {page === "controls" && (
                            <EffectControls
                                engine={engine}
                                selected={selected}
                                ports={ports}
                                properties={properties}
                                plugin={plugin}
                                models={models}
                                aidax={aidax}
                                irs={irs}
                                run={run}
                                client={client}
                                controls={controls}
                                bindings={parameterBindings}
                                bpm={num(obj(state.transport).bpm, num(obj(preset).tempo, 120))}
                                tempoEnabled={bool(state.transportFeatureEnabled)}
                                onBindParameter={(port) => setBindTarget({
                                    mode: "parameter",
                                    slotId: str(selected.id),
                                    portSymbol: str(port.symbol),
                                    name: str(port.name, str(port.symbol)),
                                    min: num(port.min, 0),
                                    max: num(port.max, 1)
                                })}
                            />
                        )}
                    </div>
                </>
            )}

            <PluginBrowser
                open={browser !== null}
                catalog={catalog}
                title={browser?.mode === "replace" ? "SELECT PLUGIN" : "ADD EFFECT"}
                actionLabel={browser?.mode === "replace" ? "USE PLUGIN" : "ADD HERE"}
                onCancel={() => setBrowser(null)}
                onChoose={(uri) => {
                    const target = browser;
                    setBrowser(null);
                    if (!target) {
                        return;
                    }
                    void run(async () => {
                        if (target.mode === "replace" && selected) {
                            await client.request("chain/replace", {
                                slotId: str(selected.id),
                                uri
                            });
                        } else {
                            await client.request("chain/add", { uri, index: target.index });
                        }
                    });
                }}
            />
            {plugins.length === 0 && page === "chain" && (
                <div className="muted" style={{ padding: 12 }}>No LV2 plugins in the catalog. Install them from Plugins.</div>
            )}
            </div>
            {pickerOpen && !lockChain && createPortal(
                <div className="mfx-overlay" onClick={() => setPickerOpen(false)}>
                    <div className="mfx-overlay-card editor-picker-card" onClick={(event) => event.stopPropagation()}>
                        <div className="mfx-overlay-title">PRESETS</div>
                        <div className="muted" style={{ marginBottom: 10 }}>Tap to load. Drag a preset onto another bank to move it.</div>
                        <div className="editor-picker-list">
                            {banks.map((item) => (
                                <div
                                    key={str(item.id)}
                                    className={`editor-picker-bank${dropBankId === str(item.id) ? " drop" : ""}`}
                                    data-bank-id={str(item.id)}
                                >
                                    <div className="editor-picker-bank-name">
                                        <MarqueeText text={str(item.name, "Bank")} align="left" fontWeight={900} letterSpacing="0.1em" />
                                    </div>
                                    {objects(obj(item).presets).map((row) => (
                                        <div
                                            key={str(row.id)}
                                            className={`editor-picker-row${str(row.id) === str(state.activePresetId) ? " selected" : ""}`}
                                        >
                                            <span
                                                className="split-row-handle"
                                                onPointerDown={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    const pointerId = event.pointerId;
                                                    const handle = event.currentTarget as HTMLElement;
                                                    handle.setPointerCapture(pointerId);
                                                    handle.dataset.dropBank = "";
                                                    const move = (moveEvent: PointerEvent) => {
                                                        if (moveEvent.pointerId !== pointerId) {
                                                            return;
                                                        }
                                                        const over = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null;
                                                        const bankEl = over?.closest("[data-bank-id]") as HTMLElement | null;
                                                        handle.dataset.dropBank = bankEl?.dataset.bankId ?? "";
                                                        setDropBankId(handle.dataset.dropBank);
                                                    };
                                                    const up = (upEvent: PointerEvent) => {
                                                        if (upEvent.pointerId !== pointerId) {
                                                            return;
                                                        }
                                                        window.removeEventListener("pointermove", move);
                                                        window.removeEventListener("pointerup", up);
                                                        const targetBank = handle.dataset.dropBank ?? "";
                                                        setDropBankId("");
                                                        if (targetBank && targetBank !== str(item.id)) {
                                                            void run(() => client.request("preset/move", {
                                                                presetId: str(row.id),
                                                                bankId: targetBank,
                                                                index: 0
                                                            }));
                                                        }
                                                    };
                                                    window.addEventListener("pointermove", move);
                                                    window.addEventListener("pointerup", up);
                                                }}
                                            >
                                                ☰
                                            </span>
                                            <button
                                                type="button"
                                                className="editor-picker-select"
                                                onClick={() => {
                                                    void run(() => client.request("preset/select", {
                                                        bankId: str(item.id),
                                                        presetId: str(row.id)
                                                    })).then(() => setPickerOpen(false));
                                                }}
                                            >
                                                <MarqueeText text={str(row.name, "Preset")} align="left" fontWeight={800} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
                            <button type="button" className="btn" onClick={() => setPickerOpen(false)}>CLOSE</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            {newPresetOpen && (
                <NewPresetDialog
                    banks={banks}
                    defaultBankId={str(obj(bank).id)}
                    onCancel={() => setNewPresetOpen(false)}
                    onCreate={(name, bankId) => {
                        setNewPresetOpen(false);
                        void run(() => client.request("preset/create", { name, bankId }));
                    }}
                />
            )}
            {pendingTrashId && createPortal(
                <div className="mfx-overlay">
                    <div className="mfx-overlay-card">
                        <div className="mfx-overlay-title danger">REMOVE EFFECT?</div>
                        <div style={{ margin: "12px 0", fontWeight: 900 }}>
                            {str(obj(chain.find((slot) => str(slot.id) === pendingTrashId)).name, "this effect")}
                        </div>
                        <div className="row">
                            <button type="button" className="btn" onClick={() => setPendingTrashId("")}>CANCEL</button>
                            <button type="button" className="btn btn-danger" onClick={() => {
                                const slotId = pendingTrashId;
                                setPendingTrashId("");
                                void run(() => client.request("chain/remove", { slotId }));
                            }}>
                                REMOVE
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            {confirmDelete && createPortal(
                <div className="mfx-overlay">
                    <div className="mfx-overlay-card">
                        <div className="mfx-overlay-title danger">DELETE PRESET?</div>
                        <div style={{ margin: "12px 0", fontWeight: 900 }}>{str(obj(preset).name, "this preset")}</div>
                        <div className="row">
                            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>CANCEL</button>
                            <button type="button" className="btn btn-danger" onClick={() => {
                                const presetId = str(obj(preset).id);
                                setConfirmDelete(false);
                                if (presetId) {
                                    void run(() => client.request("preset/delete", { presetId }));
                                }
                            }}>
                                DELETE PRESET
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            {bindTarget && createPortal(
                <ParameterBindPopup
                    target={bindTarget}
                    controls={controls}
                    current={bindTarget.mode === "bypass"
                        ? bindForBypass(bindTarget.slotId)
                        : bindForParameter(bindTarget.slotId, bindTarget.portSymbol)}
                    onClose={() => setBindTarget(null)}
                    onNone={() => applyBind({
                        controlId: str(obj(
                            bindTarget.mode === "bypass"
                                ? bindForBypass(bindTarget.slotId)
                                : bindForParameter(bindTarget.slotId, bindTarget.portSymbol)
                        ).controlId),
                        action: "none"
                    })}
                    onChoose={(controlId) => applyBind(bindTarget.mode === "bypass"
                        ? { controlId, action: "toggleEffect", slotId: bindTarget.slotId }
                        : {
                            controlId,
                            action: "setParameter",
                            slotId: bindTarget.slotId,
                            portSymbol: bindTarget.portSymbol,
                            min: bindTarget.min,
                            max: bindTarget.max
                        })}
                    onReverse={() => {
                        const current = bindTarget.mode === "bypass"
                            ? bindForBypass(bindTarget.slotId)
                            : bindForParameter(bindTarget.slotId, bindTarget.portSymbol);
                        if (!current) {
                            return;
                        }
                        applyBind({
                            ...current,
                            inverted: !bool(current.inverted)
                        });
                    }}
                />,
                document.body
            )}
        </div>
    );
}

function ChainPluginCard({
    slot,
    chainIndex,
    cardWidth,
    selected,
    dragging,
    lockChain,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onToggle,
    bypassBound = false,
    onBypassLongPress
}: {
    slot: JsonObject;
    chainIndex: number;
    cardWidth: number;
    selected: boolean;
    dragging: boolean;
    lockChain: boolean;
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: () => void;
    onToggle: () => void;
    bypassBound?: boolean;
    onBypassLongPress?: () => void;
}) {
    const info = obj(slot.plugin);
    const on = bool(slot.enabled, true);
    const holdRef = useRef<number | null>(null);
    const holdFiredRef = useRef(false);
    const clearHold = () => {
        if (holdRef.current !== null) {
            window.clearTimeout(holdRef.current);
            holdRef.current = null;
        }
    };
    return (
        <button
            type="button"
            data-chain-index={chainIndex}
            className={`chain-slot${selected ? " selected" : ""}${on ? "" : " off"}${dragging ? " dragging" : ""}`}
            style={{ flex: `0 0 ${cardWidth}px`, width: cardWidth }}
            onPointerDown={lockChain ? undefined : onPointerDown}
            onPointerMove={lockChain ? undefined : onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={lockChain ? undefined : onPointerCancel}
        >
            <div className="chain-slot-top">
                <span className="chain-handle">⋮⋮</span>
                <MarqueeText
                    text={str(slot.name) || str(info.name, str(slot.uri))}
                    align="left"
                    fontWeight={900}
                />
                <span
                    className={`chain-led${on ? " on" : ""}${bypassBound ? " bound" : ""}`}
                    role="switch"
                    aria-checked={on}
                    onPointerDown={(event) => {
                        event.stopPropagation();
                        event.preventDefault();
                        holdFiredRef.current = false;
                        clearHold();
                        try {
                            event.currentTarget.setPointerCapture(event.pointerId);
                        } catch {
                            // optional
                        }
                        if (!onBypassLongPress) {
                            return;
                        }
                        holdRef.current = window.setTimeout(() => {
                            holdRef.current = null;
                            holdFiredRef.current = true;
                            onBypassLongPress();
                        }, 550);
                    }}
                    onPointerUp={(event) => {
                        event.stopPropagation();
                        clearHold();
                        if (!holdFiredRef.current) {
                            onToggle();
                        }
                    }}
                    onPointerCancel={() => clearHold()}
                    onClick={(event) => {
                        event.stopPropagation();
                        event.preventDefault();
                    }}
                />
            </div>
            <div className="muted">{on ? "ACTIVE" : "BYPASSED"}</div>
            <div className="muted" style={{ fontSize: "0.62rem" }}>
                TAP TO EDIT • LED = BYPASS{bypassBound ? " • BOUND" : ""}
            </div>
        </button>
    );
}

function filesForPathProperty(
    property: JsonObject,
    plugin: JsonObject,
    models: JsonObject[],
    aidax: JsonObject[],
    irs: JsonObject[]
): JsonObject[] {
    const types = arr(property.fileTypes).map((item) => String(item).toLowerCase());
    const typeText = types.join(",");
    const hay = `${str(property.uri)} ${str(property.label)} ${typeText}`.toLowerCase();
    const wantsIr = /\.(wav|flac|aiff|aif)\b|\bir\b|impulse|cabsim|convolution/.test(`${typeText} ${hay}`);
    const wantsAidax = /aidax|aida/.test(`${typeText} ${hay}`);
    const wantsNam = /\.nam\b|nammodel|\bnam\b|neural|modelfile|capture|profile/.test(`${typeText} ${hay}`)
        || bool(plugin.takesNamModel);
    const namProperty = /\.nam\b|nammodel|\bnam\b|modelfile|neural/.test(`${typeText} ${hay}`);
    if (wantsIr && !namProperty) {
        return irs;
    }
    const files: JsonObject[] = [];
    if (wantsNam || namProperty || (bool(plugin.takesNamModel) && !wantsIr)) {
        files.push(...models);
    }
    if (wantsAidax || types.some((type) => type.includes("aidax"))) {
        files.push(...aidax);
    }
    if (files.length > 0) {
        return files;
    }
    if (wantsIr || bool(plugin.takesImpulseResponse)) {
        return irs;
    }
    return models;
}

function PathPropertyPicker({
    slotId,
    propertyUri,
    current,
    files,
    engine,
    fileBrowserKind,
    client,
    run
}: {
    slotId: string;
    propertyUri: string;
    current: string;
    files: JsonObject[];
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    fileBrowserKind?: PathBrowserKind;
    client: import("../api").EngineClient;
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const [directory, setDirectory] = useState("");
    const [highlighted, setHighlighted] = useState(current);
    const highlightedRef = useRef(current);
    const lastSent = useRef(current);
    const original = useRef(current);
    const listRef = useRef<HTMLDivElement | null>(null);
    const wheelDelta = useRef(0);
    const lastWheelStepAt = useRef(Number.NEGATIVE_INFINITY);
    const allowedFilePathSignature = files.map((file) => str(file.path)).filter(Boolean).join("\n");
    const allowedFilePaths = useMemo(() => allowedFilePathSignature
        ? allowedFilePathSignature.split("\n")
        : [], [allowedFilePathSignature]);

    useEffect(() => {
        lastSent.current = current;
        if (!open) {
            highlightedRef.current = current;
            setHighlighted(current);
        }
    }, [current, open]);

    useEffect(() => {
        if (!fileBrowserKind) return;
        const shared = obj(engine.uiSession.pathBrowser);
        const matches = bool(shared.open)
            && str(shared.slotId) === slotId
            && str(shared.propertyUri) === propertyUri
            && str(shared.kind) === fileBrowserKind;
        if (!matches) {
            if (open) setOpen(false);
            return;
        }
        const sharedOriginal = str(shared.originalPath, current);
        const sharedHighlight = str(shared.highlightedPath, sharedOriginal);
        if (!open) original.current = sharedOriginal;
        lastSent.current = sharedHighlight;
        highlightedRef.current = sharedHighlight;
        setHighlighted(sharedHighlight);
        setDirectory(str(shared.directory));
        setOpen(true);
    }, [engine.uiSession.pathBrowser, fileBrowserKind, slotId, propertyUri]);

    const syncPathBrowser = (patch: JsonObject) => {
        if (!fileBrowserKind) return;
        updateUiSessionSection(client, "pathBrowser", {
            slotId,
            propertyUri,
            kind: fileBrowserKind,
            ...patch
        });
    };

    const previewPath = (path: string) => {
        highlightedRef.current = path;
        setHighlighted(path);
        if (path === lastSent.current) {
            return;
        }
        lastSent.current = path;
        syncPathBrowser({
            open: true,
            directory,
            originalPath: original.current,
            highlightedPath: path
        });
        void run(() => client.request("chain/property", {
            slotId,
            property: propertyUri,
            path,
            persist: false
        }));
    };

    const entries = [{ path: "", name: "None" }, ...files.map((file) => ({
        path: str(file.path),
        name: str(file.name)
    }))];
    const step = (direction: number) => {
        const index = Math.max(0, entries.findIndex((entry) => entry.path === highlightedRef.current));
        const next = Math.max(0, Math.min(entries.length - 1, index + direction));
        if (next !== index) {
            previewPath(entries[next].path);
        }
    };

    const wheelStep = (deltaY: number, deltaMode: number) => {
        if (deltaY === 0) return;
        const direction = Math.sign(deltaY);
        const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 120 : 1);
        if (Math.sign(wheelDelta.current) !== direction) {
            wheelDelta.current = 0;
        }
        wheelDelta.current += pixels;
        if (Math.abs(wheelDelta.current) < 32) return;
        wheelDelta.current = 0;

        // Precision wheels and trackpads report a burst of events for one gesture.
        // Rate-limit model loads so that burst cannot skip over several profiles.
        const now = performance.now();
        if (now - lastWheelStepAt.current < 50) return;
        lastWheelStepAt.current = now;
        step(direction);
    };

    const commit = (path: string) => {
        highlightedRef.current = path;
        setHighlighted(path);
        lastSent.current = path;
        void run(() => client.request("chain/property", {
            slotId,
            property: propertyUri,
            path,
            persist: true
        })).then(() => {
            setOpen(false);
            syncPathBrowser({ open: false, highlightedPath: path });
        });
    };

    const cancel = () => {
        const path = original.current;
        lastSent.current = path;
        void run(() => client.request("chain/property", {
            slotId,
            property: propertyUri,
            path,
            persist: false
        })).then(() => {
            setOpen(false);
            syncPathBrowser({ open: false, highlightedPath: path });
        });
    };

    useEffect(() => {
        if (!open || !listRef.current) {
            return;
        }
        const list = listRef.current;
        const syncEncoderHighlight = () => {
            const item = list.querySelector<HTMLElement>('[data-mfx-nav-cursor="true"]');
            if (item?.getAttribute("data-mfx-nav-remote") === "true") return;
            const path = item?.getAttribute("data-path");
            if (path !== null && path !== undefined) {
                previewPath(path);
            }
        };
        const observer = new MutationObserver(syncEncoderHighlight);
        observer.observe(list, { attributes: true, subtree: true, attributeFilter: ["data-mfx-nav-cursor"] });
        const frame = window.requestAnimationFrame(() => {
            const item = list.querySelector<HTMLElement>(`[data-path="${CSS.escape(highlighted)}"]`);
            item?.focus({ preventScroll: true });
            item?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        });
        return () => {
            window.cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [open, highlighted]);

    const highlightedName = entries.find((entry) => entry.path === highlighted)?.name ?? "None";
    const isIrBrowser = fileBrowserKind === "ir";
    const assetLabel = isIrBrowser ? "CAB IR" : "NAM MODEL";
    const currentEntry = files.find((file) => str(file.path) === current);
    const currentName = currentEntry
        ? str(currentEntry.name)
        : current.split(/[\\/]/).pop() || `No ${assetLabel.toLowerCase()} selected`;
    const openPicker = () => {
        original.current = current;
        lastSent.current = current;
        highlightedRef.current = current;
        wheelDelta.current = 0;
        lastWheelStepAt.current = Number.NEGATIVE_INFINITY;
        setHighlighted(current);
        if (fileBrowserKind) {
            const currentDirectory = str(currentEntry?.category).replace(/\\/g, "/");
            const remembered = window.localStorage.getItem(PATH_BROWSER_DIR_KEYS[fileBrowserKind]) ?? "";
            const nextDirectory = currentDirectory || remembered;
            setDirectory(nextDirectory);
            syncPathBrowser({
                open: true,
                directory: nextDirectory,
                originalPath: current,
                highlightedPath: current
            });
        }
        setOpen(true);
    };

    if (fileBrowserKind) {
        return (
            <>
                <div className="file-property-picker-trigger">
                    <div className="muted file-property-picker-current" title={current || undefined}>{currentName}</div>
                    <div className="row">
                        <button type="button" className="btn file-property-picker-button" onClick={openPicker}>
                            BROWSE {isIrBrowser ? "CAB IRS" : "NAM MODELS"}
                        </button>
                        <button type="button" className="btn" disabled={!current} onClick={() => commit("")}>
                            CLEAR {assetLabel}
                        </button>
                    </div>
                </div>
                {open && createPortal(
                    <div
                        className="mfx-overlay"
                        onClick={cancel}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") {
                                event.preventDefault();
                                cancel();
                            }
                        }}
                    >
                        <div className="mfx-overlay-card file-property-picker asset-file-browser" onClick={(event) => event.stopPropagation()}>
                            <div className="mfx-overlay-title">{assetLabel} BROWSER</div>
                            <div className="muted">
                                Browse folders and highlight a {isIrBrowser ? "cab IR" : "model"} to audition it. Press the encoder on a folder to open it, then press Use {assetLabel} to commit.
                            </div>
                            <LibraryBrowser
                                engine={engine}
                                run={run}
                                kind={fileBrowserKind}
                                filePicker
                                dualDefault={false}
                                directory={directory}
                                onDirectoryChange={(next) => {
                                    setDirectory(next);
                                    window.localStorage.setItem(PATH_BROWSER_DIR_KEYS[fileBrowserKind], next);
                                    syncPathBrowser({
                                        open: true,
                                        directory: next,
                                        originalPath: original.current,
                                        highlightedPath: highlightedRef.current
                                    });
                                }}
                                selectedPath={highlighted}
                                allowedFilePaths={allowedFilePaths}
                                onFileSelect={(item) => previewPath(str(item.path))}
                            />
                            <div className="row asset-file-browser-actions">
                                <button type="button" className="btn" onClick={cancel}>CANCEL</button>
                                <button type="button" className="btn btn-accent" disabled={!highlighted} onClick={() => commit(highlighted)}>
                                    USE {assetLabel}
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
            </>
        );
    }

    return (
        <>
            <button type="button" className="btn file-property-picker-button" onClick={openPicker}>
                {highlightedName} ▾
            </button>
            {open && createPortal(
                <div
                    className="mfx-overlay"
                    onClick={cancel}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            event.preventDefault();
                            cancel();
                        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                            event.preventDefault();
                            step(event.key === "ArrowDown" ? 1 : -1);
                        }
                    }}
                >
                    <div className="mfx-overlay-card file-property-picker" onClick={(event) => event.stopPropagation()}>
                        <div className="mfx-overlay-title">CHOOSE MODEL</div>
                        <div className="muted">Move through the list to audition. Click, press Enter, or press the encoder to use.</div>
                        <div
                            ref={listRef}
                            className="file-property-picker-list"
                            data-mfx-nav-list="file-property"
                            onWheel={(event) => {
                                if (event.deltaY === 0) return;
                                event.preventDefault();
                                wheelStep(event.deltaY, event.deltaMode);
                            }}
                        >
                            {entries.map((entry) => (
                                <button
                                    key={entry.path || "none"}
                                    type="button"
                                    className={`mfx-overlay-option${highlighted === entry.path ? " selected" : ""}`}
                                    data-path={entry.path}
                                    data-mfx-nav-key={`file:${entry.path}`}
                                    onPointerMove={() => previewPath(entry.path)}
                                    onFocus={() => previewPath(entry.path)}
                                    onClick={() => commit(entry.path)}
                                >
                                    {entry.name}
                                </button>
                            ))}
                        </div>
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                            <button type="button" className="btn" onClick={cancel}>CANCEL</button>
                            <button type="button" className="btn btn-accent" onClick={() => commit(highlighted)}>USE MODEL</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}

export function EffectControls({
    engine,
    selected,
    ports,
    properties,
    plugin,
    models,
    aidax = [],
    irs,
    run,
    client,
    controls = [],
    bindings = [],
    bpm = 120,
    tempoEnabled = false,
    onBindParameter
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    selected: JsonObject;
    ports: JsonObject[];
    properties: JsonObject[];
    plugin: JsonObject;
    models: JsonObject[];
    aidax?: JsonObject[];
    irs: JsonObject[];
    run: (work: () => Promise<unknown>) => Promise<void>;
    client: import("../api").EngineClient;
    controls?: JsonObject[];
    bindings?: JsonObject[];
    bpm?: number;
    tempoEnabled?: boolean;
    onBindParameter?: (port: JsonObject) => void;
}) {
    const slotId = str(selected.id);
    const meters = useMeters(client);
    const slotMeters = objects(meters.effects).find((meter) => str(meter.slotId) === slotId);
    const hasAudioPorts = objects(plugin.ports).some((port) => str(port.kind) === "audio");
    const audioSettings = obj(engine.state.audio);
    const managedNamCalibration = bool(audioSettings.namCalibrationManaged, true)
        && str(plugin.uri) === "http://two-play.com/plugins/toob-nam";
    const tempoLinks = obj(selected.tempoLinks);
    const [previewValues, setPreviewValues] = useState<Record<string, number>>({});
    const pendingValues = useRef(new Map<string, number>());
    const previewFrame = useRef<number | null>(null);
    const pendingPreview = useRef<{ symbol: string; value: number } | null>(null);

    useEffect(() => () => {
        if (previewFrame.current !== null) {
            window.cancelAnimationFrame(previewFrame.current);
        }
    }, []);

    useEffect(() => {
        setPreviewValues((current) => {
            let changed = false;
            const next = { ...current };
            for (const [symbol, pending] of pendingValues.current) {
                const port = ports.find((item) => str(item.symbol) === symbol);
                if (!port) {
                    pendingValues.current.delete(symbol);
                    delete next[symbol];
                    changed = true;
                    continue;
                }
                const actual = controlValue(selected, symbol, num(port.default, num(port.min)));
                if (approximatelyEqual(actual, pending)) {
                    pendingValues.current.delete(symbol);
                    delete next[symbol];
                    changed = true;
                }
            }
            return changed ? next : current;
        });
    }, [selected, ports]);

    const preview = (symbol: string, value: number) => {
        setPreviewValues((current) => ({ ...current, [symbol]: value }));
    };
    const previewLive = (symbol: string, value: number) => {
        preview(symbol, value);
        pendingPreview.current = { symbol, value };
        if (previewFrame.current !== null) {
            return;
        }
        previewFrame.current = window.requestAnimationFrame(() => {
            previewFrame.current = null;
            const next = pendingPreview.current;
            pendingPreview.current = null;
            if (!next) {
                return;
            }
            void client.request("chain/control", {
                slotId,
                port: next.symbol,
                value: next.value,
                persist: false
            }).catch(() => undefined);
        });
    };
    const clearPreview = (symbol: string) => {
        pendingValues.current.delete(symbol);
        setPreviewValues((current) => {
            if (!(symbol in current)) {
                return current;
            }
            const next = { ...current };
            delete next[symbol];
            return next;
        });
    };
    const boundFor = (symbol: string) => bindings.find((binding) =>
        str(binding.action) === "setParameter"
        && str(binding.slotId) === slotId
        && str(binding.portSymbol) === symbol);
    const boundLabel = (symbol: string) => {
        const binding = boundFor(symbol);
        if (!binding) {
            return "";
        }
        const control = controls.find((item) => str(item.id) === str(binding.controlId));
        return str(obj(control).label, str(binding.controlId));
    };
    return (
        <div className="stack">
            {hasAudioPorts && (
                <section className="panel lv2-signal-panel" aria-label={`${str(plugin.name, "Effect")} signal levels`}>
                    <div className="lv2-signal-heading">
                        <strong>LIVE SIGNAL</strong>
                        <span>PRE / POST EFFECT</span>
                    </div>
                    <div className="lv2-signal-meters">
                        <GainMeter label="In" peak={num(obj(slotMeters).inputPeak)} orientation="horizontal" />
                        <GainMeter label="Out" peak={num(obj(slotMeters).outputPeak)} orientation="horizontal" />
                    </div>
                </section>
            )}
            {ports.length === 0 && (
                <div className="muted">This plugin has no control ports, or LV2 is not available on this build.</div>
            )}
            {onBindParameter && (
                <div className="muted">Hold a parameter name to bind a floorboard control. Hold an effect LED to bind bypass.</div>
            )}
            <div className="control-grid">
                {ports.map((port) => {
                    const symbol = str(port.symbol);
                    const name = str(port.name, symbol);
                    const min = num(port.min, 0);
                    const max = num(port.max, 1);
                    const actualValue = controlValue(selected, symbol, num(port.default, min));
                    const value = previewValues[symbol] ?? actualValue;
                    const linkedBeats = num(tempoLinks[symbol], 0);
                    const tempoLinkCandidate = bool(port.tempoLinkCandidate);
                    const calibrationManaged = managedNamCalibration && str(port.symbol) === "calibration";
                    const stepped = bool(port.integer) || bool(port.toggled);
                    const points = arr(port.scalePoints).filter(isObj);
                    const enumeration = bool(port.enumerated) && points.length > 0;
                    const apply = (next: number) => {
                        const clamped = clampPortValue(next, min, max, stepped);
                        if (previewFrame.current !== null) {
                            window.cancelAnimationFrame(previewFrame.current);
                            previewFrame.current = null;
                        }
                        pendingPreview.current = null;
                        preview(symbol, clamped);
                        pendingValues.current.set(symbol, clamped);
                        void client.request("chain/control", {
                            slotId: str(selected.id),
                            port: symbol,
                            value: clamped,
                            persist: true
                        }).catch(() => clearPreview(symbol));
                    };
                    const editNumber = () => {
                        void (async () => {
                            const typed = await askText(name, formatEditableValue(value, port), "numeric");
                            if (typed === null) {
                                return;
                            }
                            const parsed = Number(typed.trim());
                            if (!Number.isFinite(parsed)) {
                                return;
                            }
                            await run(() => client.request("chain/control", {
                                slotId: str(selected.id),
                                port: symbol,
                                value: clampPortValue(parsed, min, max, stepped)
                            }));
                        })();
                    };
                    return (
                        <div key={symbol} title={str(port.comment) || undefined}
                            className={`control-card field${boundFor(symbol) ? " bound" : ""}${tempoEnabled && linkedBeats > 0 ? " tempo-linked" : ""}`}>
                            <div className="control-card-head">
                                <span
                                    onPointerDown={(event) => {
                                        if (!onBindParameter) {
                                            return;
                                        }
                                        const originX = event.clientX;
                                        const originY = event.clientY;
                                        const target = event.currentTarget;
                                        try {
                                            target.setPointerCapture(event.pointerId);
                                        } catch {
                                            // optional
                                        }
                                        const hold = window.setTimeout(() => {
                                            target.removeEventListener("pointerup", cancel);
                                            target.removeEventListener("pointercancel", cancel);
                                            target.removeEventListener("pointermove", move);
                                            onBindParameter(port);
                                        }, 550);
                                        const cancel = () => {
                                            window.clearTimeout(hold);
                                            target.removeEventListener("pointerup", cancel);
                                            target.removeEventListener("pointercancel", cancel);
                                            target.removeEventListener("pointermove", move);
                                        };
                                        const move = (moveEvent: PointerEvent) => {
                                            if (Math.hypot(moveEvent.clientX - originX, moveEvent.clientY - originY) > 8) {
                                                cancel();
                                            }
                                        };
                                        target.addEventListener("pointerup", cancel);
                                        target.addEventListener("pointercancel", cancel);
                                        target.addEventListener("pointermove", move);
                                    }}
                                >{name}</span>
                                {!bool(port.toggled) && !bool(port.trigger) && !enumeration && (
                                    <button type="button" className="control-value" onClick={editNumber}>
                                        {formatControl(value, port)}
                                    </button>
                                )}
                                {(bool(port.toggled) || bool(port.trigger) || enumeration) && (
                                    <span className="muted">{formatControl(value, port)}</span>
                                )}
                            </div>
                            {boundFor(symbol) && (
                                <div className="control-bind-hint">
                                    {boundLabel(symbol)}
                                    {bool(obj(boundFor(symbol)).inverted) ? " · REV" : ""}
                                </div>
                            )}
                            {calibrationManaged && (
                                <div className="control-bind-hint">
                                    MANAGED BY AUDIO PROFILE · {str(audioSettings.instrumentProfileName, "Guitar 1")} · {num(audioSettings.instrumentLevelDbU, -6).toFixed(1)} dBu
                                </div>
                            )}
                            {tempoLinkCandidate && (
                                <label className="tempo-link-row">
                                    <span>TEMPO LINK</span>
                                    <select
                                        value={linkedBeats > 0 ? String(linkedBeats) : "0"}
                                        disabled={!tempoEnabled}
                                        title={tempoEnabled ? "Follow Tap Tempo" : "Enable Tap Tempo Clock in System settings"}
                                        onChange={(event) => void run(() => client.request("chain/tempo-link", {
                                            slotId,
                                            port: symbol,
                                            beats: Number(event.target.value)
                                        }))}
                                    >
                                        <option value="0">MANUAL {str(port.unit, "TIME").toUpperCase()}</option>
                                        {NOTE_DIVISIONS.map((division) => (
                                            <option key={division.label} value={division.beats}>
                                                {division.label} · {formatTempoLinkedValue(division.beats, bpm, port)}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                            {bool(port.trigger) ? (
                                <button
                                    type="button"
                                    className="btn"
                                    onClick={() => void run(() => client.request("chain/control", {
                                        slotId: str(selected.id),
                                        port: symbol,
                                        value: triggerValue(port)
                                    }))}
                                >
                                    TRIGGER
                                </button>
                            ) : bool(port.toggled) ? (
                                <button
                                    type="button"
                                    className={`btn ${value > 0 ? "btn-active" : ""}`}
                                    onClick={() => apply(value > 0
                                        ? toggleValue(port, false)
                                        : toggleValue(port, true))}
                                >
                                    {value > 0 ? "ON" : "OFF"}
                                </button>
                            ) : enumeration ? (
                                <select
                                    value={String(closestScalePointValue(points, value))}
                                    onChange={(event) => void run(() => client.request("chain/control", {
                                        slotId: str(selected.id),
                                        port: symbol,
                                        value: Number(event.target.value)
                                    }))}
                                >
                                    {points.map((item) => (
                                        <option key={`${num(item.value)}:${str(item.label)}`} value={num(item.value)}>
                                            {str(item.label, String(num(item.value)))}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <Lv2RangeControl
                                    port={port}
                                    value={value}
                                    name={name}
                                    markerValue={isToobInputCalibration(plugin, port) ? -6 : undefined}
                                    disabled={(tempoEnabled && linkedBeats > 0) || calibrationManaged}
                                    onPreview={(next) => previewLive(symbol, next)}
                                    onCancel={() => clearPreview(symbol)}
                                    onCommit={apply}
                                />
                            )}
                        </div>
                    );
                })}
            </div>

            {properties.filter((property) => bool(property.isPath)).map((property) => {
                const files = filesForPathProperty(property, plugin, models, aidax, irs);
                const current = str(obj(obj(selected.state).properties)[str(property.uri)]);
                return (
                    <label key={str(property.uri)} className="field">
                        <span>{str(property.label, "File")}</span>
                        <PathPropertyPicker
                            slotId={str(selected.id)}
                            propertyUri={str(property.uri)}
                            current={current}
                            files={files}
                            engine={engine}
                            fileBrowserKind={str(plugin.uri) === "http://two-play.com/plugins/toob-nam"
                                ? "model"
                                : str(plugin.uri) === "http://two-play.com/plugins/toob-cab-ir"
                                ? "ir"
                                : undefined}
                            client={client}
                            run={run}
                        />
                    </label>
                );
            })}
        </div>
    );
}

function ParameterBindPopup({
    target,
    controls,
    current,
    onClose,
    onNone,
    onChoose,
    onReverse
}: {
    target: BindTarget;
    controls: JsonObject[];
    current?: JsonObject;
    onClose: () => void;
    onNone: () => void;
    onChoose: (controlId: string) => void;
    onReverse: () => void;
}) {
    const boundId = str(obj(current).controlId);
    return (
        <div className="mfx-overlay" onClick={onClose}>
            <div className="mfx-overlay-card" onClick={(event) => event.stopPropagation()}>
                <div className="mfx-overlay-title">
                    {target.mode === "bypass" ? `BIND BYPASS — ${target.name}` : `BIND — ${target.name}`}
                </div>
                <div className="muted" style={{ marginBottom: 10 }}>
                    This assignment stays with the preset. Hardware Setup still handles bank, preset, bypass-all, tap and tuner.
                </div>
                <button
                    type="button"
                    className={`mfx-overlay-option${!boundId ? " selected" : ""}`}
                    onClick={() => {
                        if (boundId) {
                            onNone();
                        } else {
                            onClose();
                        }
                    }}
                >
                    None
                </button>
                {controls.map((control) => {
                    const id = str(control.id);
                    return (
                        <button
                            key={id}
                            type="button"
                            className={`mfx-overlay-option${boundId === id ? " selected" : ""}`}
                            onClick={() => onChoose(id)}
                        >
                            {str(control.label, id)} · {str(control.kind, "momentary")}
                        </button>
                    );
                })}
                {controls.length === 0 && (
                    <div className="muted">Add controls in Settings → Hardware Setup first.</div>
                )}
                {current && (
                    <button
                        type="button"
                        className={`mfx-overlay-option${bool(current.inverted) ? " selected" : ""}`}
                        onClick={onReverse}
                    >
                        {bool(current.inverted) ? "Reverse on" : "Reverse"}
                    </button>
                )}
                <div className="row" style={{ marginTop: 12 }}>
                    <button type="button" className="btn" onClick={onClose}>CLOSE</button>
                </div>
            </div>
        </div>
    );
}

function ChainIoPanel({
    kind,
    engine,
    run
}: {
    kind: "input" | "output";
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const audio = obj(engine.state.audio);
    const save = (patch: JsonObject) => {
        void run(() => engine.client.request("audio/settings", { ...audio, ...patch }));
    };
    if (kind === "input") {
        return (
            <div className="panel stack">
                <div className="muted">These are the same input controls as Settings → Audio.</div>
                <label className="field">
                    <span>Input gain (dB)</span>
                    <input
                        type="number"
                        value={num(audio.inputGainDb)}
                        onChange={(event) => save({ inputGainDb: Number(event.target.value) })}
                    />
                </label>
                <label className="field">
                    <span>Guitar input channel</span>
                    <input
                        type="number"
                        min={1}
                        value={num(audio.guitarInput, 2)}
                        onChange={(event) => save({ guitarInput: Number(event.target.value) })}
                    />
                </label>
            </div>
        );
    }
    return (
        <div className="panel stack">
            <div className="muted">These are the same output controls as Settings → Audio.</div>
            <label className="field">
                <span>Output gain (dB)</span>
                <input
                    type="number"
                    value={num(audio.outputGainDb)}
                    onChange={(event) => save({ outputGainDb: Number(event.target.value) })}
                />
            </label>
        </div>
    );
}

function formatControl(value: number, port: JsonObject): string {
    const point = arr(port.scalePoints).filter(isObj).find((item) =>
        approximatelyEqual(num(item.value), value));
    if (point) {
        return str(point.label, String(value));
    }
    const digits = bool(port.integer) || bool(port.toggled) ? 0 : 2;
    const render = str(port.unitRender);
    const placeholder = /%[-+ 0#]*(?:\.(\d+))?f/;
    if (render && placeholder.test(render)) {
        const match = render.match(placeholder);
        const precision = match?.[1] === undefined ? digits : Math.min(8, Number(match[1]));
        return render.replace(placeholder, value.toFixed(precision)).replaceAll("%%", "%");
    }
    const unit = str(port.unit);
    return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

function formatEditableValue(value: number, port: JsonObject): string {
    if (bool(port.integer) || bool(port.toggled)) {
        return String(Math.round(value));
    }
    return String(Number(value.toFixed(4)));
}

function formatTempoLinkedValue(beats: number, bpm: number, port: JsonObject): string {
    const safeBpm = Math.max(30, Math.min(300, bpm));
    const seconds = 60 * beats / safeBpm;
    const converted = str(port.unitUri).endsWith("#ms") ? seconds * 1000 : seconds;
    const value = Math.max(num(port.min, converted), Math.min(num(port.max, converted), converted));
    return formatControl(value, port);
}

function clampPortValue(value: number, min: number, max: number, integer: boolean): number {
    const next = integer ? Math.round(value) : value;
    return Math.min(max, Math.max(min, next));
}

function approximatelyEqual(left: number, right: number): boolean {
    return Math.abs(left - right) <= Math.max(1e-6, Math.abs(left) * 1e-6, Math.abs(right) * 1e-6);
}

function closestScalePointValue(points: JsonObject[], value: number): number {
    return points.reduce((closest, point) => {
        const candidate = num(point.value);
        return Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest;
    }, num(points[0]?.value, value));
}

function toggleValue(port: JsonObject, on: boolean): number {
    const min = num(port.min, 0);
    const max = num(port.max, 1);
    return Math.min(max, Math.max(min, on ? 1 : 0));
}

function triggerValue(port: JsonObject): number {
    const min = num(port.min, 0);
    const max = num(port.max, 1);
    const candidate = max > 0 ? max : 1;
    return Math.min(max, Math.max(min, candidate));
}

function hasLogarithmicRange(port: JsonObject): boolean {
    const min = num(port.min, 0);
    const max = num(port.max, 1);
    return bool(port.logarithmic) && min !== 0 && max !== 0 && (min > 0) === (max > 0);
}

function isToobInputCalibration(plugin: JsonObject, port: JsonObject): boolean {
    return str(plugin.uri) === "http://two-play.com/plugins/toob-nam"
        && str(port.symbol) === "calibration";
}

function sliderValue(port: JsonObject, value: number): number {
    if (!hasLogarithmicRange(port)) {
        return value;
    }
    const min = num(port.min);
    const max = num(port.max, 1);
    const clamped = Math.min(max, Math.max(min, value));
    return Math.log(clamped / min) / Math.log(max / min);
}

function portValue(port: JsonObject, value: number): number {
    if (!hasLogarithmicRange(port)) {
        return value;
    }
    const min = num(port.min);
    const max = num(port.max, 1);
    return min * Math.pow(max / min, value);
}

function Lv2RangeControl({
    port,
    value,
    name,
    markerValue,
    disabled,
    onPreview,
    onCancel,
    onCommit
}: {
    port: JsonObject;
    value: number;
    name: string;
    markerValue?: number;
    disabled: boolean;
    onPreview: (value: number) => void;
    onCancel: () => void;
    onCommit: (value: number) => void;
}) {
    const logarithmic = hasLogarithmicRange(port);
    const min = num(port.min, 0);
    const max = num(port.max, 1);
    const steps = Math.max(0, Math.trunc(num(port.rangeSteps)));
    const rangeMin = logarithmic ? 0 : min;
    const rangeMax = logarithmic ? 1 : max;
    const step = logarithmic
        ? steps > 1 ? 1 / (steps - 1) : "any"
        : bool(port.integer)
            ? 1
            : steps > 1
            ? (rangeMax - rangeMin) / (steps - 1)
            : "any";
    const external = sliderValue(port, value);
    const markerPosition = markerValue === undefined
        ? undefined
        : 100 * (sliderValue(port, clampPortValue(markerValue, min, max, false)) - rangeMin)
            / Math.max(Number.EPSILON, rangeMax - rangeMin);
    const markerLabel = markerValue === undefined ? "" : formatControl(markerValue, port);
    const [draft, setDraft] = useState(external);
    const dragging = useRef(false);
    const lastCommitted = useRef<number | null>(null);

    useEffect(() => {
        if (!dragging.current) {
            setDraft(external);
        }
    }, [external]);

    const commit = (raw: number) => {
        dragging.current = false;
        lastCommitted.current = raw;
        onCommit(portValue(port, raw));
    };

    const change = (raw: number) => {
        lastCommitted.current = null;
        setDraft(raw);
        onPreview(portValue(port, raw));
    };

    return (
        <div className="lv2-range-control">
            {markerPosition !== undefined && (
                <span
                    className="lv2-range-marker"
                    style={{ left: `${markerPosition}%` }}
                    title={`Default: ${markerLabel}`}
                    aria-hidden="true"
                />
            )}
            <input
                type="range"
                min={rangeMin}
                max={rangeMax}
                step={step}
                value={draft}
                aria-label={name}
                disabled={disabled}
                onPointerDown={() => { dragging.current = true; lastCommitted.current = null; }}
                onChange={(event) => change(Number(event.target.value))}
                onPointerUp={(event) => commit(Number(event.currentTarget.value))}
                onPointerCancel={() => {
                    dragging.current = false;
                    lastCommitted.current = null;
                    setDraft(external);
                    onCancel();
                }}
                onKeyUp={(event) => commit(Number(event.currentTarget.value))}
                onBlur={(event) => {
                    const raw = Number(event.currentTarget.value);
                    if (lastCommitted.current === null || !approximatelyEqual(lastCommitted.current, raw)) {
                        commit(raw);
                    }
                }}
            />
        </div>
    );
}
