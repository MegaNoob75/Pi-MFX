import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { controlValue, findBank, findPreset, type EngineSnapshot } from "../api";
import { arr, bool, isObj, num, obj, str, objects, type JsonObject } from "../json";
import { askText } from "../keyboard/ask";
import { PluginBrowser } from "./PluginBrowser";
import { MarqueeText } from "./MarqueeText";
import { NewPresetDialog } from "./NewPresetDialog";

type EditPage = "chain" | "controls" | "io";

type BindTarget =
    | { mode: "parameter"; slotId: string; portSymbol: string; name: string; min: number; max: number }
    | { mode: "bypass"; slotId: string; name: string };

export function EditorView({
    engine,
    run,
    lockChain = false,
    backRequest = 0,
    onPageChange
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    lockChain?: boolean;
    backRequest?: number;
    onPageChange?: (page: EditPage, title?: string) => void;
}) {
    const { client, state, catalog, library } = engine;
    const chain = objects(state.chain);
    const plugins = objects(catalog.plugins);
    const preset = findPreset(state);
    const bank = findBank(state);
    const banks = objects(state.banks);
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
    const ports = objects(plugin.ports).filter((port) => str(port.kind) === "control" && bool(port.input, true));
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
                        {!lockChain ? (
                            <button type="button" className="btn btn-accent" onClick={() => setNewPresetOpen(true)}>NEW</button>
                        ) : <div />}
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

export function EffectControls({
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
    onBindParameter
}: {
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
    onBindParameter?: (port: JsonObject) => void;
}) {
    const slotId = str(selected.id);
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
                    const value = controlValue(selected, symbol, num(port.default, min));
                    const stepped = bool(port.integer) || bool(port.toggled);
                    const apply = (next: number) => {
                        const clamped = clampPortValue(next, min, max, stepped);
                        void client.request("chain/control", {
                            slotId: str(selected.id),
                            port: symbol,
                            value: clamped
                        }).catch(() => undefined);
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
                        <div key={symbol} className={`control-card field${boundFor(symbol) ? " bound" : ""}`}>
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
                                {!bool(port.toggled) && arr(port.scalePoints).filter(isObj).length === 0 && (
                                    <button type="button" className="control-value" onClick={editNumber}>
                                        {formatControl(value, port)}
                                    </button>
                                )}
                                {(bool(port.toggled) || arr(port.scalePoints).filter(isObj).length > 0) && (
                                    <span className="muted">{formatControl(value, port)}</span>
                                )}
                            </div>
                            {boundFor(symbol) && (
                                <div className="control-bind-hint">
                                    {boundLabel(symbol)}
                                    {bool(obj(boundFor(symbol)).inverted) ? " · REV" : ""}
                                </div>
                            )}
                            {bool(port.toggled) ? (
                                <button
                                    type="button"
                                    className={`btn ${value >= 0.5 ? "btn-active" : ""}`}
                                    onClick={() => void run(() => client.request("chain/control", {
                                        slotId: str(selected.id),
                                        port: symbol,
                                        value: value >= 0.5 ? 0 : 1
                                    }))}
                                >
                                    {value >= 0.5 ? "ON" : "OFF"}
                                </button>
                            ) : arr(port.scalePoints).filter(isObj).length > 0 ? (
                                <select
                                    value={String(value)}
                                    onChange={(event) => void run(() => client.request("chain/control", {
                                        slotId: str(selected.id),
                                        port: symbol,
                                        value: Number(event.target.value)
                                    }))}
                                >
                                    {arr(port.scalePoints).filter(isObj).map((item) => (
                                        <option key={str(item.label, String(num(item.value)))} value={num(item.value)}>
                                            {str(item.label, String(num(item.value)))}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    type="range"
                                    min={min}
                                    max={max}
                                    step={stepped ? 1 : "any"}
                                    value={value}
                                    aria-label={name}
                                    onChange={(event) => apply(Number(event.target.value))}
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
                        <select
                            value={current}
                            onChange={(event) => void run(() => client.request("chain/property", {
                                slotId: str(selected.id),
                                property: str(property.uri),
                                path: event.target.value
                            }))}
                        >
                            <option value="">None</option>
                            {files.map((file) => (
                                <option key={str(file.path)} value={str(file.path)}>{str(file.name)}</option>
                            ))}
                        </select>
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
    const unit = str(port.unit);
    const digits = bool(port.integer) || bool(port.toggled) ? 0 : 2;
    return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

function formatEditableValue(value: number, port: JsonObject): string {
    if (bool(port.integer) || bool(port.toggled)) {
        return String(Math.round(value));
    }
    return String(Number(value.toFixed(4)));
}

function clampPortValue(value: number, min: number, max: number, integer: boolean): number {
    const next = integer ? Math.round(value) : value;
    return Math.min(max, Math.max(min, next));
}
