import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { controlValue, findPreset, type EngineSnapshot } from "../api";
import { arr, bool, isObj, num, obj, str, objects, type JsonObject } from "../json";
import { askText } from "../keyboard/ask";
import { PluginBrowser } from "./PluginBrowser";

type EditPage = "chain" | "controls" | "bindings" | "io";

export function EditorView({
    engine,
    run,
    lockChain = false,
    editorSource = "preset",
    backRequest = 0,
    onPageChange
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    lockChain?: boolean;
    editorSource?: "preset" | "library";
    backRequest?: number;
    onPageChange?: (page: EditPage, title?: string) => void;
}) {
    const { client, state, catalog, library } = engine;
    const chain = objects(state.chain);
    const plugins = objects(catalog.plugins);
    const preset = findPreset(state);
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
    const dragRef = useRef<{ id: string; title: string; from: number; x: number; y: number; dragging: boolean } | null>(null);
    const chainPageRef = useRef<HTMLDivElement | null>(null);
    const [chainItemsPerRow, setChainItemsPerRow] = useState(5);
    const [chainCardWidth, setChainCardWidth] = useState(142);

    const selected = chain.find((slot) => str(slot.id) === selectedId) ?? chain[0];
    const plugin = obj(obj(selected).plugin);
    const ports = objects(plugin.ports).filter((port) => str(port.kind) === "control" && bool(port.input, true));
    const properties = objects(plugin.properties);
    const models = objects(library.models);
    const irs = objects(library.impulseResponses);
    const controller = obj(state.controller);
    const controls = objects(controller.controls);
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
        setPage((current) => (current === "bindings" ? "controls" : "chain"));
    }, [backRequest]);

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
            void run(() => client.request("chain/remove", { slotId: drag.id }));
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
        <div className={`mfx-screen editor-screen${editorSource === "library" ? " editor-with-library" : ""}`}>
            {editorSource === "library" && (
                <aside className="editor-library">
                    {banks.map((bank) => (
                        <div key={str(bank.id)}>
                            <div className="editor-library-bank">{str(bank.name, "Bank")}</div>
                            {objects(obj(bank).presets).map((item) => (
                                <button
                                    key={str(item.id)}
                                    type="button"
                                    className={`editor-library-row${str(item.id) === str(state.activePresetId) ? " selected" : ""}`}
                                    onClick={() => void run(() => client.request("preset/select", {
                                        bankId: str(bank.id),
                                        presetId: str(item.id)
                                    }))}
                                >
                                    {str(item.name, "Preset")}
                                </button>
                            ))}
                        </div>
                    ))}
                </aside>
            )}
            <div className="editor-main">
            {page === "chain" && (
                <>
                    <div className="editor-toolbar editor-chain-bar">
                        {!lockChain ? (
                            <button type="button" className="btn btn-accent" onClick={() => {
                                void askText("New preset name", "Untitled").then((name) => {
                                    if (name?.trim()) {
                                        void run(() => client.request("preset/create", { name: name.trim() }));
                                    }
                                });
                            }}>NEW</button>
                        ) : <div />}
                        <button
                            type="button"
                            className="editor-preset-name"
                            onClick={() => {
                                if (lockChain) {
                                    return;
                                }
                                void askText("Rename preset", str(obj(preset).name, "Preset")).then((name) => {
                                    if (name?.trim() && str(obj(preset).id)) {
                                        void run(() => client.request("preset/rename", {
                                            presetId: str(obj(preset).id),
                                            name: name.trim()
                                        }));
                                    }
                                });
                            }}
                        >
                            {str(obj(preset).name, "Preset")}
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
                                                            />
                                                        )
                                                        : (
                                                            <button
                                                                type="button"
                                                                className={`chain-slot endpoint${selectedId === node.kind ? " selected" : ""}`}
                                                                style={{ flex: `0 0 ${chainCardWidth}px`, width: chainCardWidth }}
                                                                onClick={() => {
                                                                    setIoKind(node.kind === "input" ? "input" : "output");
                                                                    setSelectedId(node.kind);
                                                                    setPage("io");
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
                                        void run(() => client.request("chain/remove", { slotId: str(selected.id) })).then(() => setPage("chain"));
                                    }
                                }}>REMOVE</button>
                            </>
                        )}
                        <button
                            type="button"
                            className={`btn ${page === "bindings" ? "btn-active" : ""}`}
                            onClick={() => setPage(page === "bindings" ? "controls" : "bindings")}
                        >
                            BINDINGS
                        </button>
                    </div>
                    <div className="page-scroll" style={{ flex: 1, minHeight: 0 }}>
                        {page === "controls" && (
                            <EffectControls
                                selected={selected}
                                ports={ports}
                                properties={properties}
                                plugin={plugin}
                                models={models}
                                irs={irs}
                                run={run}
                                client={client}
                            />
                        )}
                        {page === "bindings" && (
                            <BindingsPanel
                                selected={selected}
                                ports={ports}
                                controls={controls}
                                controller={controller}
                                run={run}
                                client={client}
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
                            await client.request("chain/remove", { slotId: str(selected.id) });
                            await client.request("chain/add", { uri, index: target.index });
                        } else {
                            await client.request("chain/add", { uri, index: target.index });
                        }
                    });
                }}
            />
            {plugins.length === 0 && page === "chain" && (
                <div className="muted" style={{ padding: 12 }}>No LV2 plugins in the catalog. Install them from Settings → Plugins.</div>
            )}
            </div>
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
    onToggle
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
}) {
    const info = obj(slot.plugin);
    const on = bool(slot.enabled, true);
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
                <strong>{str(slot.name) || str(info.name, str(slot.uri))}</strong>
                <span
                    className={`chain-led${on ? " on" : ""}`}
                    role="switch"
                    aria-checked={on}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggle();
                    }}
                />
            </div>
            <div className="muted">{on ? "ACTIVE" : "BYPASSED"}</div>
            <div className="muted" style={{ fontSize: "0.62rem" }}>TAP TO EDIT • LED = BYPASS</div>
        </button>
    );
}

export function EffectControls({
    selected,
    ports,
    properties,
    plugin,
    models,
    irs,
    run,
    client
}: {
    selected: JsonObject;
    ports: JsonObject[];
    properties: JsonObject[];
    plugin: JsonObject;
    models: JsonObject[];
    irs: JsonObject[];
    run: (work: () => Promise<unknown>) => Promise<void>;
    client: import("../api").EngineClient;
}) {
    return (
        <div className="stack">
            {ports.length === 0 && (
                <div className="muted">This plugin has no control ports, or LV2 is not available on this build.</div>
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
                        <div key={symbol} className="control-card field">
                            <div className="control-card-head">
                                <span>{name}</span>
                                {!bool(port.toggled) && arr(port.scalePoints).filter(isObj).length === 0 && (
                                    <button type="button" className="control-value" onClick={editNumber}>
                                        {formatControl(value, port)}
                                    </button>
                                )}
                                {(bool(port.toggled) || arr(port.scalePoints).filter(isObj).length > 0) && (
                                    <span className="muted">{formatControl(value, port)}</span>
                                )}
                            </div>
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
                const files = bool(plugin.takesImpulseResponse) ? irs : models;
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

function BindingsPanel({
    selected,
    ports,
    controls,
    controller,
    run,
    client
}: {
    selected: JsonObject;
    ports: JsonObject[];
    controls: JsonObject[];
    controller: JsonObject;
    run: (work: () => Promise<unknown>) => Promise<void>;
    client: import("../api").EngineClient;
}) {
    const slotId = str(selected.id);
    const learningId = str(controller.learningControlId);

    const boundControl = (symbol: string, action: string) =>
        controls.find((control) => {
            const binding = obj(control.binding);
            return str(binding.action) === action
                && str(binding.slotId) === slotId
                && (action !== "setParameter" || str(binding.portSymbol) === symbol);
        });

    const assign = (controlId: string, action: string, portSymbol = "", min = 0, max = 1) => {
        const next = controls.map((control) => {
            if (str(control.id) !== controlId) {
                const binding = obj(control.binding);
                if (str(binding.slotId) === slotId
                    && str(binding.action) === action
                    && (action !== "setParameter" || str(binding.portSymbol) === portSymbol)) {
                    return { ...control, binding: { ...binding, action: "none", slotId: "", portSymbol: "" } };
                }
                return control;
            }
            return {
                ...control,
                binding: {
                    ...obj(control.binding),
                    action,
                    slotId,
                    portSymbol,
                    min,
                    max
                }
            };
        });
        void run(() => client.request("controller/config", { ...controller, controls: next }));
    };

    return (
        <div className="stack">
            <div className="muted">
                Bind a floorboard or on-screen control to this effect. Learn listens for
                the next MIDI CC or note on that control.
            </div>
            <div className="list-item" style={{ flexWrap: "wrap" }}>
                <strong>Toggle this effect</strong>
                <select
                    value={str(obj(boundControl("", "toggleEffect")).id)}
                    onChange={(event) => assign(event.target.value, "toggleEffect")}
                >
                    <option value="">None</option>
                    {controls.map((control) => (
                        <option key={str(control.id)} value={str(control.id)}>{str(control.label, str(control.id))}</option>
                    ))}
                </select>
            </div>
            {ports.map((port) => {
                const symbol = str(port.symbol);
                const bound = boundControl(symbol, "setParameter");
                return (
                    <div key={symbol} className="list-item" style={{ flexWrap: "wrap" }}>
                        <div style={{ flex: 1 }}>
                            <strong>{str(port.name, symbol)}</strong>
                            <div className="muted">{str(obj(bound).label) || "No control"}</div>
                        </div>
                        <select
                            value={str(obj(bound).id)}
                            onChange={(event) => assign(
                                event.target.value,
                                "setParameter",
                                symbol,
                                num(port.min, 0),
                                num(port.max, 1)
                            )}
                        >
                            <option value="">None</option>
                            {controls.map((control) => (
                                <option key={str(control.id)} value={str(control.id)}>
                                    {str(control.label, str(control.id))} · {str(control.kind)}
                                </option>
                            ))}
                        </select>
                        {bound && (
                            <>
                                <button
                                    type="button"
                                    className={`btn ${bool(obj(bound.binding).inverted) ? "btn-active" : ""}`}
                                    onClick={() => {
                                        const next = controls.map((control) => str(control.id) === str(bound.id)
                                            ? {
                                                ...control,
                                                binding: {
                                                    ...obj(control.binding),
                                                    inverted: !bool(obj(control.binding).inverted)
                                                }
                                            }
                                            : control);
                                        void run(() => client.request("controller/config", { ...controller, controls: next }));
                                    }}
                                >
                                    {bool(obj(bound.binding).inverted) ? "REVERSE ON" : "REVERSE"}
                                </button>
                                <button
                                    type="button"
                                    className="btn"
                                    onClick={() => void run(() => client.request("controller/learn", { controlId: str(bound.id) }))}
                                >
                                    {learningId === str(bound.id) ? "LISTENING…" : "LEARN"}
                                </button>
                            </>
                        )}
                    </div>
                );
            })}
            {controls.length === 0 && (
                <div className="muted">Add switches and pots in Settings → Controller first.</div>
            )}
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
                <div className="muted">These are the same input controls as Settings → Audio. MultiFX opens them from the INPUT card.</div>
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
            <div className="muted">These are the same output controls as Settings → Audio. MultiFX opens them from the OUTPUT card.</div>
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
