import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { controlValue, findBank, findPreset, normalizeControlKind, useMeters, type EngineSnapshot } from "../api";
import { announceControlPopout, CONTROL_POPOUT_OPEN_EVENT } from "../controlPopout";
import { arr, bool, isObj, num, obj, str, objects, type JsonObject } from "../json";
import { askText } from "../keyboard/ask";
import { updateUiSessionSection } from "../uiSession";
import { LibraryBrowser } from "./LibraryManager";
import { PluginBrowser } from "./PluginBrowser";
import { MarqueeText } from "./MarqueeText";
import { NewPresetDialog } from "./NewPresetDialog";
import { GainMeter } from "./GainMeter";
import { ConfirmDialog } from "./ConfirmDialog";
import { PerformanceControl, type PerformanceTile } from "./PerformanceControl";
import { virtualControlPageId, virtualControlPages, virtualTargetCompatible } from "../virtualControls";
import { loadUiBehavior } from "../uiBehavior";

type EditPage = "chain" | "controls" | "parallel" | "io";
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
    | { mode: "parameter"; slotId: string; portSymbol: string; name: string; min: number; max: number; port: JsonObject }
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
    const liveChain = objects(state.chain);
    const hydrateLayoutItem = (item: JsonObject): JsonObject => {
        if (str(item.kind) === "parallel") {
            return {
                ...item,
                laneA: objects(item.laneA).map(hydrateLayoutItem),
                laneB: objects(item.laneB).map(hydrateLayoutItem)
            };
        }
        const live = liveChain.find((slot) => str(slot.id) === str(item.id));
        return live ? { ...item, ...live, name: str(item.name) || str(live.name) } : item;
    };
    const chain = Array.isArray(state.chainLayout)
        ? objects(state.chainLayout).map(hydrateLayoutItem)
        : liveChain;
    const plugins = objects(catalog.plugins);
    const preset = findPreset(state);
    const bank = findBank(state);
    const banks = objects(state.banks).filter((item) => !bool(item.communityHolding));
    const [selectedId, setSelectedId] = useState("");
    const [page, setPage] = useState<EditPage>("chain");
    const [ioKind, setIoKind] = useState<"input" | "output">("input");
    const [browser, setBrowser] = useState<{
        mode: "add" | "replace";
        index: number;
        parallelId?: string;
        lane?: "a" | "b";
        slotId?: string;
    } | null>(null);
    const [insertMenu, setInsertMenu] = useState<number | null>(null);
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
    const chainPageRef = useRef<HTMLDivElement | null>(null);
    const [chainItemsPerRow, setChainItemsPerRow] = useState(5);
    const [chainCardWidth, setChainCardWidth] = useState(142);
    const [sessionAction, setSessionAction] = useState<"save" | "reload" | "">("");
    const [sessionStatus, setSessionStatus] = useState("");
    const [structureBusy, setStructureBusy] = useState(false);
    const structureBusyRef = useRef(false);
    const sessionDirty = bool(state.sessionPresetDirty);
    const presetName = str(obj(preset).name, "current preset");
    const sessionPresetId = str(obj(preset).id, str(state.activePresetId));
    const activeSnapshot = num(obj(preset).activeSnapshot, -1);

    const waitForChainGeneration = (generation: number) => new Promise<void>((resolve) => {
        let finished = false;
        let unsubscribe: () => void = () => undefined;
        let timer = 0;
        const finish = () => {
            if (finished) return;
            finished = true;
            window.clearTimeout(timer);
            unsubscribe();
            resolve();
        };
        timer = window.setTimeout(finish, 30000);
        unsubscribe = client.subscribe((snapshot) => {
            if (num(snapshot.state.chainGeneration) > generation) finish();
        });
    });

    const runStructureChange = async (work: () => Promise<unknown>) => {
        if (structureBusyRef.current) return;
        structureBusyRef.current = true;
        setStructureBusy(true);
        setSessionStatus("PREPARING EFFECT CHAIN…");
        const generation = num(client.snapshot.state.chainGeneration);
        let accepted = false;
        try {
            await run(async () => {
                await work();
                accepted = true;
            });
            if (accepted) await waitForChainGeneration(generation);
        } finally {
            structureBusyRef.current = false;
            setStructureBusy(false);
            setSessionStatus("");
        }
    };

    const finishSessionAction = async (action: "save" | "reload") => {
        setSessionAction("");
        setSessionStatus(action === "save" ? "SAVING…" : "RELOADING…");
        try {
            await client.request(action === "save" ? "preset/save" : "preset/restoreLive", {
                presetId: sessionPresetId
            });
            setSessionStatus(action === "save" ? "CHANGES SAVED" : "SAVED PRESET RESTORED");
            window.setTimeout(() => setSessionStatus(""), 2200);
        } catch (error) {
            setSessionStatus(error instanceof Error ? error.message : "ACTION FAILED");
        }
    };

    useEffect(() => {
        const sharedPage = str(engine.uiSession.editorPage) as EditPage;
        if (["chain", "controls", "parallel", "io"].includes(sharedPage) && sharedPage !== page) {
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

    const pluginSlots = chain.flatMap((item) => str(item.kind) === "parallel"
        ? [...objects(item.laneA), ...objects(item.laneB)]
        : [item]);
    const selectedParallel = chain.find((item) => str(item.kind) === "parallel" && str(item.id) === selectedId);
    const selectedParallelParent = chain.find((item) => str(item.kind) === "parallel"
        && [...objects(item.laneA), ...objects(item.laneB)].some((slot) => str(slot.id) === selectedId));
    const selected = pluginSlots.find((slot) => str(slot.id) === selectedId) ?? pluginSlots[0];
    const plugin = obj(obj(selected).plugin);
    const ports = objects(plugin.ports).filter((port) => str(port.kind) === "control"
        && bool(port.input, true) && !bool(port.notOnGui));
    const properties = objects(plugin.properties);
    const models = objects(library.models);
    const aidax = objects(library.aidax);
    const irs = objects(library.impulseResponses);
    const controller = obj(state.controller);
    const controls = objects(controller.controls);
    const virtualConfig = obj(state.virtualControls);
    const virtualPages = virtualControlPages(virtualConfig);
    const virtualControls = objects(virtualConfig.controls);
    const parameterBindings = objects(obj(preset).parameterBindings);
    const bindingsForParameter = (slotId: string, symbol: string) =>
        parameterBindings.filter((binding) =>
            str(binding.action) === "setParameter"
            && str(binding.slotId) === slotId
            && str(binding.portSymbol) === symbol);
    const bindingsForBypass = (slotId: string) =>
        parameterBindings.filter((binding) =>
            str(binding.action) === "toggleEffect" && str(binding.slotId) === slotId);
    const bindForBypass = (slotId: string) =>
        parameterBindings.find((binding) =>
            str(binding.action) === "toggleEffect" && str(binding.slotId) === slotId);

    const applyBind = (payload: JsonObject, close = true) => {
        if (!str(payload.controlId)) {
            setBindTarget(null);
            return;
        }
        void run(() => client.request("preset/bind", {
            ...payload,
            ownerBankId: str(obj(bank).id),
            ownerPresetId: sessionPresetId
        })).then(() => {
            if (close) setBindTarget(null);
        });
    };
    const selectedIndex = chain.findIndex((slot) => str(slot.id) === str(obj(selected).id));
    const effectTitle = selectedParallel
        ? str(selectedParallel.name, "Parallel Section")
        : str(obj(selected).name) || str(plugin.name, "Effect");

    useEffect(() => {
        onPageChange?.(page, page === "chain" ? undefined : page === "io" ? (ioKind === "input" ? "INPUT" : "OUTPUT") : effectTitle);
    }, [page, effectTitle, ioKind]);

    const previousBackRequestRef = useRef(backRequest);

    useEffect(() => {
        if (backRequest === previousBackRequestRef.current) {
            return;
        }
        previousBackRequestRef.current = backRequest;
        if (page === "controls" && selectedParallelParent) {
            const parentId = str(selectedParallelParent.id);
            setSelectedId(parentId);
            setPage("parallel");
            client.updateUiSession({
                editorPage: "parallel",
                editorSelectedId: parentId,
                editSubpage: "parallel"
            });
        } else {
            setPage("chain");
            client.updateUiSession({ editorPage: "chain", editSubpage: "chain" });
        }
    }, [backRequest]);

    useEffect(() => {
        const ids = new Set([...chain, ...pluginSlots].map((slot) => str(slot.id)));
        if (selectedId && !ids.has(selectedId)) {
            setSelectedId("");
        }
    }, [str(state.activePresetId), [...chain, ...pluginSlots].map((slot) => str(slot.id)).join("|")]);

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
        if (lockChain || structureBusy || globalIndex < 0 || globalIndex >= chainNodes.length - 1) {
            return;
        }
        setInsertMenu(globalIndex);
    };

    const renamePreset = () => {
        void askText("Rename preset", str(obj(preset).name, "Preset")).then((name) => {
            if (name?.trim() && str(obj(preset).id)) {
                void run(() => client.request("preset/rename", {
                    presetId: str(obj(preset).id),
                    name: name.trim()
                }));
            }
        });
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

    const openParallel = (sectionId: string) => {
        setSelectedId(sectionId);
        setPage("parallel");
        client.updateUiSession({
            editorPage: "parallel",
            editorSelectedId: sectionId,
            editSubpage: "parallel"
        });
    };

    const onPointerDown = (slot: JsonObject, index: number, event: React.PointerEvent) => {
        if (lockChain || structureBusy) {
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
            if (str(slot.kind) === "parallel") openParallel(str(slot.id));
            else openControls(str(slot.id));
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
                void runStructureChange(() => client.request("chain/move", { slotId: drag.id, index }));
            }
        }
    };

    return (
        <div className="mfx-screen editor-screen">
            <div className="editor-main">
            <div className="editor-session-bar">
                <span>
                    <strong>{presetName}</strong>
                    <small>{sessionDirty ? "UNSAVED LIVE CHANGES" : "SAVED PRESET"}</small>
                </span>
                {sessionStatus && <strong className="editor-session-status">{sessionStatus}</strong>}
                <button type="button" className="btn" disabled={structureBusy || !sessionDirty || activeSnapshot >= 0}
                    onClick={() => setSessionAction("save")}>SAVE CHANGES</button>
                <button type="button" className="btn" disabled={structureBusy || !sessionDirty}
                    onClick={() => setSessionAction("reload")}>RELOAD SAVED</button>
            </div>
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
                            onClick={() => {
                                if (!lockChain) {
                                    setPickerOpen(true);
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
                            <div className="editor-primary-actions">
                                <button type="button" className="btn" onClick={renamePreset}>RENAME</button>
                                <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                                    DELETE
                                </button>
                            </div>
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
                                                        ? str(node.slot.kind) === "parallel" ? (
                                                            <ChainParallelCard
                                                                section={node.slot}
                                                                chainIndex={node.chainIndex ?? 0}
                                                                cardWidth={chainCardWidth}
                                                                selected={selectedId === str(node.slot.id)}
                                                                dragging={dragId === str(node.slot.id)}
                                                                lockChain={lockChain || structureBusy}
                                                                onPointerDown={(event) => onPointerDown(node.slot!, node.chainIndex ?? 0, event)}
                                                                onPointerMove={onPointerMove}
                                                                onPointerUp={(event) => onPointerUp(node.slot!, event)}
                                                                onPointerCancel={() => {
                                                                    dragRef.current = null;
                                                                    setDragId("");
                                                                    setDragOverTrash(false);
                                                                }}
                                                                 onToggle={() => {
                                                                     if (!structureBusy) void run(() => client.request("chain/parallel/settings", {
                                                                         sectionId: str(node.slot!.id),
                                                                         enabled: !bool(node.slot!.enabled, true)
                                                                     }));
                                                                 }}
                                                            />
                                                        ) : (
                                                            <ChainPluginCard
                                                                slot={node.slot}
                                                                chainIndex={node.chainIndex ?? 0}
                                                                cardWidth={chainCardWidth}
                                                                selected={str(obj(selected).id) === str(node.slot.id)}
                                                                dragging={dragId === str(node.slot.id)}
                                                                lockChain={lockChain || structureBusy}
                                                                onPointerDown={(event) => onPointerDown(node.slot!, node.chainIndex ?? 0, event)}
                                                                onPointerMove={onPointerMove}
                                                                onPointerUp={(event) => onPointerUp(node.slot!, event)}
                                                                onPointerCancel={() => {
                                                                    dragRef.current = null;
                                                                    setDragId("");
                                                                    setDragOverTrash(false);
                                                                }}
                                                                 onToggle={() => {
                                                                     if (!structureBusy) void run(() => client.request("chain/enable", {
                                                                         slotId: str(node.slot!.id),
                                                                         enabled: !bool(node.slot!.enabled, true)
                                                                     }));
                                                                 }}
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
                                                                 disabled={lockChain || structureBusy}
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
                                             {!lockChain && !structureBusy && (
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

            {page === "parallel" && selectedParallel && (
                <>
                    <div className="editor-toolbar">
                        <div className="editor-toolbar-copy">
                            <strong>{str(selectedParallel.name, "Parallel Section")}</strong>
                            <span>Two independent effect lanes blended into one output</span>
                        </div>
                        <button type="button" className={`btn ${bool(selectedParallel.enabled, true) ? "btn-active" : ""}`}
                            disabled={structureBusy}
                            onClick={() => void run(() => client.request("chain/parallel/settings", {
                                sectionId: str(selectedParallel.id),
                                enabled: !bool(selectedParallel.enabled, true)
                            }))}>
                            {bool(selectedParallel.enabled, true) ? "ON" : "BYPASS"}
                        </button>
                        {!lockChain && <button type="button" className="btn btn-danger" disabled={structureBusy}
                            onClick={() => setPendingTrashId(str(selectedParallel.id))}>REMOVE</button>}
                    </div>
                    <div className="page-scroll parallel-editor-scroll">
                        <ParallelSectionEditor
                            section={selectedParallel}
                            lockChain={lockChain || structureBusy}
                            settingsDisabled={structureBusy}
                            onEdit={openControls}
                            onAdd={(lane, index) => setBrowser({
                                mode: "add",
                                index,
                                parallelId: str(selectedParallel.id),
                                lane
                            })}
                            onRemove={(slotId) => setPendingTrashId(slotId)}
                            onMove={(slotId, index, lane) => void runStructureChange(() => client.request("chain/move", {
                                slotId,
                                index,
                                parallelId: str(selectedParallel.id),
                                lane
                            }))}
                            onToggle={(slotId, enabled) => {
                                if (!structureBusy) void run(() => client.request("chain/enable", { slotId, enabled }));
                            }}
                            onSetting={(values) => run(() => client.request("chain/parallel/settings", {
                                sectionId: str(selectedParallel.id),
                                ...values
                            }))}
                        />
                    </div>
                </>
            )}

            {page === "controls" && selected && (
                <>
                    <div className="editor-toolbar">
                        <div className="editor-toolbar-copy">
                            <strong>{effectTitle}</strong>
                            <span>{str(plugin.category) || str(plugin.brand) || "Effect settings"}</span>
                        </div>
                        <button
                            type="button"
                            className={`btn ${bool(selected.enabled, true) ? "btn-active" : ""}`}
                            disabled={structureBusy}
                            onClick={() => void run(() => client.request("chain/enable", {
                                slotId: str(selected.id),
                                enabled: !bool(selected.enabled, true)
                            }))}
                        >
                            {bool(selected.enabled, true) ? "ON" : "BYPASS"}
                        </button>
                        {!lockChain && (
                            <>
                                <button type="button" className="btn" disabled={structureBusy}
                                    onClick={() => setBrowser({
                                        mode: "replace",
                                        index: selectedIndex,
                                        slotId: str(selected.id)
                                    })}>
                                    REPLACE
                                </button>
                                <button type="button" className="btn btn-danger" disabled={structureBusy} onClick={() => {
                                    setPendingTrashId(str(selected.id));
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
                                    max: num(port.max, 1),
                                    port
                                })}
                            />
                        )}
                    </div>
                </>
            )}

            <PluginBrowser
                open={browser !== null}
                sessionKey={browser
                    ? `${browser.mode}:${browser.slotId ?? browser.parallelId ?? "serial"}:${browser.lane ?? ""}:${browser.index}`
                    : "closed"}
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
                    let replacementId = "";
                    void runStructureChange(async () => {
                        if (target.mode === "replace" && target.slotId) {
                            const result = obj(await client.request("chain/replace", {
                                slotId: target.slotId,
                                uri
                            }));
                            replacementId = str(result.slotId);
                        } else {
                            if (target.parallelId && target.lane) {
                                await client.request("chain/add", {
                                    uri,
                                    index: target.index,
                                    parallelId: target.parallelId,
                                    lane: target.lane
                                });
                            } else {
                                await client.request("chain/add", { uri, index: target.index });
                            }
                        }
                    }).then(() => {
                        // The replacement ID is absent from the old live chain.
                        // Open it only after the prepared chain has been swapped
                        // and published, or selection fallback can show another effect.
                        if (replacementId) openControls(replacementId);
                    });
                }}
            />
            {insertMenu !== null && createPortal(
                <div className="mfx-overlay" onClick={() => setInsertMenu(null)}>
                    <div className="mfx-overlay-card parallel-insert-menu" onClick={(event) => event.stopPropagation()}>
                        <div className="mfx-overlay-title">ADD TO SIGNAL CHAIN</div>
                        <div className="muted">Choose a normal serial effect or start two parallel lanes.</div>
                        <button type="button" className="mfx-overlay-option" onClick={() => {
                            const index = insertMenu;
                            setInsertMenu(null);
                            setBrowser({ mode: "add", index });
                        }}><strong>EFFECT</strong><span>Continue the normal serial chain</span></button>
                        <button type="button" className="mfx-overlay-option" onClick={() => {
                            const index = insertMenu;
                            setInsertMenu(null);
                            void runStructureChange(() => client.request("chain/parallel/add", { index }));
                        }}><strong>PARALLEL SECTION</strong><span>Two independent chains for NAMs, optional IRs, or any effects</span></button>
                        <button type="button" className="btn" onClick={() => setInsertMenu(null)}>CANCEL</button>
                    </div>
                </div>,
                document.body
            )}
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
            {pendingTrashId && <ConfirmDialog title="REMOVE EFFECT?"
                body={str(obj([...chain, ...pluginSlots].find((slot) => str(slot.id) === pendingTrashId)).name, "this effect")}
                confirmLabel="REMOVE" danger onCancel={() => setPendingTrashId("")} onConfirm={() => {
                    const slotId = pendingTrashId;
                    const parent = chain.find((item) => str(item.kind) === "parallel"
                        && [...objects(item.laneA), ...objects(item.laneB)].some((slot) => str(slot.id) === slotId));
                    setPendingTrashId("");
                    void runStructureChange(() => client.request("chain/remove", { slotId })).then(() => {
                        if (parent) {
                            openParallel(str(parent.id));
                        } else {
                            setPage("chain");
                            client.updateUiSession({ editorPage: "chain", editSubpage: "chain" });
                        }
                    });
                }} />}
            {confirmDelete && <ConfirmDialog title="DELETE PRESET?"
                body={`${presetName}${sessionDirty ? " has unsaved live changes that will be lost." : ""}`}
                confirmLabel="DELETE PRESET" danger onCancel={() => setConfirmDelete(false)} onConfirm={() => {
                    const presetId = str(obj(preset).id);
                    setConfirmDelete(false);
                    if (presetId) void run(() => client.request("preset/delete", { presetId }));
                }} />}
            {sessionAction === "save" && <ConfirmDialog title="SAVE LIVE CHANGES?"
                body={`Overwrite the saved version of “${presetName}” with the current live sound?`}
                confirmLabel="SAVE" onCancel={() => setSessionAction("")}
                onConfirm={() => void finishSessionAction("save")} />}
            {sessionAction === "reload" && <ConfirmDialog title="DISCARD LIVE CHANGES?"
                body={`Discard all temporary changes to “${presetName}” and restore its saved version?`}
                confirmLabel="DISCARD & RELOAD" danger onCancel={() => setSessionAction("")}
                onConfirm={() => void finishSessionAction("reload")} />}
            {bindTarget && createPortal(
                <ParameterBindPopup
                    target={bindTarget}
                    physicalControls={controls}
                    virtualControls={virtualControls}
                    virtualPages={virtualPages}
                    current={bindTarget.mode === "bypass"
                        ? bindingsForBypass(bindTarget.slotId)
                        : bindingsForParameter(bindTarget.slotId, bindTarget.portSymbol)}
                    onClose={() => setBindTarget(null)}
                    onNone={(controlId) => applyBind({
                        controlId,
                        action: "none"
                    }, false)}
                    onChoose={(controlId) => applyBind(bindTarget.mode === "bypass"
                        ? { controlId, action: "toggleEffect", slotId: bindTarget.slotId }
                        : {
                            controlId,
                            action: "setParameter",
                            slotId: bindTarget.slotId,
                            portSymbol: bindTarget.portSymbol,
                            min: bindTarget.min,
                            max: bindTarget.max
                        }, false)}
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

function ChainParallelCard({
    section,
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
    section: JsonObject;
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
    const on = bool(section.enabled, true);
    const panText = (value: number) => value <= -0.99 ? "L" : value >= 0.99 ? "R" : Math.abs(value) < 0.01 ? "C" : value < 0 ? `L${Math.round(-value * 100)}` : `R${Math.round(value * 100)}`;
    const laneSummary = (lane: JsonObject[], fallback: string) => lane.length
        ? lane.map((slot) => str(slot.name) || str(obj(slot.plugin).name, "Effect")).join(" → ")
        : fallback;
    return (
        <button type="button" data-chain-index={chainIndex}
            className={`chain-slot chain-parallel-card${selected ? " selected" : ""}${on ? "" : " off"}${dragging ? " dragging" : ""}`}
            style={{ flex: `0 0 ${cardWidth}px`, width: cardWidth }}
            onPointerDown={lockChain ? undefined : onPointerDown}
            onPointerMove={lockChain ? undefined : onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={lockChain ? undefined : onPointerCancel}>
            <div className="chain-slot-top">
                <span className="chain-handle">⋮⋮</span>
                <MarqueeText text={str(section.name, "Parallel Section")} align="left" fontWeight={900} />
                <span className={`chain-led${on ? " on" : ""}`} role="switch" aria-checked={on}
                    onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); }}
                    onPointerUp={(event) => { event.stopPropagation(); onToggle(); }}
                    onClick={(event) => { event.stopPropagation(); event.preventDefault(); }} />
            </div>
            <div className="parallel-card-lane"><strong>A</strong><span>{laneSummary(objects(section.laneA), "DRY")}</span></div>
            <div className="parallel-card-lane"><strong>B</strong><span>{laneSummary(objects(section.laneB), "DRY")}</span></div>
            <div className="muted parallel-card-mix">{bool(section.stereo)
                ? `STEREO · A ${panText(num(section.panA, -1))} · B ${panText(num(section.panB, 1))}`
                : "MONO BLEND"}</div>
        </button>
    );
}

function LiveRange({ label, value, min, max, step, format, disabled, onLive, onCommit }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    format: (value: number) => string;
    disabled?: boolean;
    onLive: (value: number) => void;
    onCommit: (value: number) => void;
}) {
    const [draft, setDraft] = useState(value);
    const [popout, setPopout] = useState(false);
    const draftRef = useRef(value);
    const popoutCloseTimer = useRef<number | null>(null);
    const popoutCard = useRef<HTMLDivElement | null>(null);
    const popoutOwner = useRef({});
    useEffect(() => {
        draftRef.current = value;
        setDraft(value);
    }, [value]);
    useEffect(() => () => {
        if (popoutCloseTimer.current !== null) window.clearTimeout(popoutCloseTimer.current);
    }, []);
    const revealPopout = () => {
        if (!loadUiBehavior().controlPopout || disabled) return;
        if (popoutCloseTimer.current !== null) {
            window.clearTimeout(popoutCloseTimer.current);
            popoutCloseTimer.current = null;
        }
        announceControlPopout(popoutOwner.current);
        setPopout(true);
    };
    const dismissPopout = () => {
        if (popoutCloseTimer.current !== null) {
            window.clearTimeout(popoutCloseTimer.current);
            popoutCloseTimer.current = null;
        }
        setPopout(false);
    };
    useEffect(() => {
        if (!popout) return;
        const dismissForOutsideInteraction = (event: Event) => {
            const target = event.target;
            if (target instanceof Node && popoutCard.current?.contains(target)) return;
            dismissPopout();
        };
        const dismissForReplacement = (event: Event) => {
            if ((event as CustomEvent<object>).detail === popoutOwner.current) return;
            dismissPopout();
        };
        window.addEventListener("pointerdown", dismissForOutsideInteraction, true);
        window.addEventListener("wheel", dismissForOutsideInteraction, true);
        window.addEventListener(CONTROL_POPOUT_OPEN_EVENT, dismissForReplacement);
        return () => {
            window.removeEventListener("pointerdown", dismissForOutsideInteraction, true);
            window.removeEventListener("wheel", dismissForOutsideInteraction, true);
            window.removeEventListener(CONTROL_POPOUT_OPEN_EVENT, dismissForReplacement);
        };
    }, [popout]);
    const schedulePopoutClose = () => {
        if (popoutCloseTimer.current !== null) window.clearTimeout(popoutCloseTimer.current);
        popoutCloseTimer.current = window.setTimeout(() => {
            popoutCloseTimer.current = null;
            setPopout(false);
        }, loadUiBehavior().controlPopoutDurationMs);
    };
    const update = (next: number) => {
        draftRef.current = next;
        setDraft(next);
        onLive(next);
        revealPopout();
    };
    const commit = () => {
        onCommit(draftRef.current);
        schedulePopoutClose();
    };
    const range = max === min ? 0 : Math.max(0, Math.min(1, (draft - min) / (max - min)));
    const zeroRange = max === min ? 0 : (0 - min) / (max - min);
    const slider = (inPopout = false) => (
        <div className="parallel-themed-slider">
            <div className="mfx-hardware-slider" data-orientation="horizontal" aria-hidden="true">
                <div className="mfx-hardware-slider__fill" style={{ width: `${range * 100}%` }} />
                {min < 0 && max > 0 && <span className="parallel-slider-center" style={{ left: `${zeroRange * 100}%` }} />}
                <div className="mfx-hardware-slider__thumb" style={{ left: `${range * 100}%` }} />
            </div>
            <input aria-label={inPopout ? `${label} enlarged` : label} type="range" min={min} max={max} step={step}
                value={draft} disabled={disabled}
                onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    revealPopout();
                }}
                onChange={(event) => update(Number(event.target.value))}
                onPointerUp={commit} onPointerCancel={commit} onKeyUp={commit} onBlur={commit} />
        </div>
    );
    const popoutScale = loadUiBehavior().controlPopoutScale;
    return (
        <>
            <label className="parallel-mix-control">
                <span>{label}</span>
                {slider()}
                <strong>{format(draft)}</strong>
            </label>
            {popout && createPortal(
                <div className="mfx-performance-control-popout" role="dialog"
                    aria-label={`${label} adjustment`}>
                    <div ref={popoutCard} className="parallel-slider-popout-card mfx-performance-control--popout" style={{
                        width: `min(calc(100vw - 32px), ${Math.round(300 * popoutScale)}px)`,
                        height: `min(calc(100vh - 32px), ${Math.round(140 * popoutScale)}px)`
                    }}>
                        <span>{label}</span>
                        {slider(true)}
                        <strong>{format(draft)}</strong>
                    </div>
                </div>
            , document.body)}
        </>
    );
}

function ParallelSectionEditor({ section, lockChain, settingsDisabled, onEdit, onAdd, onRemove, onMove, onToggle, onSetting }: {
    section: JsonObject;
    lockChain: boolean;
    settingsDisabled: boolean;
    onEdit: (slotId: string) => void;
    onAdd: (lane: "a" | "b", index: number) => void;
    onRemove: (slotId: string) => void;
    onMove: (slotId: string, index: number, lane: "a" | "b") => void;
    onToggle: (slotId: string, enabled: boolean) => void;
    onSetting: (values: JsonObject) => Promise<void>;
}) {
    const dragRef = useRef<{
        id: string;
        title: string;
        lane: "a" | "b";
        from: number;
        x: number;
        y: number;
        dragging: boolean;
    } | null>(null);
    const [dragId, setDragId] = useState("");
    const [dragOverTrash, setDragOverTrash] = useState(false);
    const [dropTarget, setDropTarget] = useState("");
    const [dragGhost, setDragGhost] = useState<{ title: string; x: number; y: number } | null>(null);
    const settingInFlight = useRef(false);
    const pendingSetting = useRef<{ values: JsonObject; persist: boolean } | null>(null);
    const settingFrame = useRef<number | null>(null);
    const pumpSetting = () => {
        if (settingInFlight.current || !pendingSetting.current) return;
        const next = pendingSetting.current;
        pendingSetting.current = null;
        settingInFlight.current = true;
        void onSetting({ ...next.values, persist: next.persist }).finally(() => {
            settingInFlight.current = false;
            if (pendingSetting.current) pumpSetting();
        });
    };
    const queueSetting = (values: JsonObject, persist: boolean) => {
        const pending = pendingSetting.current;
        pendingSetting.current = {
            values: { ...(pending?.values ?? {}), ...values },
            persist: persist || Boolean(pending?.persist)
        };
        if (persist) {
            if (settingFrame.current !== null) window.cancelAnimationFrame(settingFrame.current);
            settingFrame.current = null;
            pumpSetting();
            return;
        }
        if (settingFrame.current === null) {
            settingFrame.current = window.requestAnimationFrame(() => {
                settingFrame.current = null;
                pumpSetting();
            });
        }
    };
    useEffect(() => () => {
        if (settingFrame.current !== null) window.cancelAnimationFrame(settingFrame.current);
    }, []);
    const clearDrag = () => {
        dragRef.current = null;
        setDragId("");
        setDragOverTrash(false);
        setDropTarget("");
        setDragGhost(null);
    };
    const trashAt = (x: number, y: number) => {
        const trash = document.querySelector("[data-parallel-trash]") as HTMLElement | null;
        if (!trash) return false;
        const bounds = trash.getBoundingClientRect();
        return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    };
    const pointerDown = (slot: JsonObject, lane: "a" | "b", index: number, event: React.PointerEvent<HTMLButtonElement>) => {
        if (lockChain) return;
        dragRef.current = {
            id: str(slot.id),
            title: str(slot.name) || str(obj(slot.plugin).name, "Effect"),
            lane,
            from: index,
            x: event.clientX,
            y: event.clientY,
            dragging: false
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 10) {
            drag.dragging = true;
            setDragId(drag.id);
            setDragGhost({ title: drag.title, x: event.clientX, y: event.clientY });
        }
        setDragOverTrash(trashAt(event.clientX, event.clientY));
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-parallel-drop]") as HTMLElement | null;
        const lane = target?.dataset.parallelLane;
        const index = Number(target?.dataset.parallelIndex);
        setDropTarget((lane === "a" || lane === "b") && Number.isInteger(index) ? `${lane}:${index}` : "");
    };
    const pointerUp = (slot: JsonObject, event: React.PointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag || !drag.dragging) {
            clearDrag();
            onEdit(str(slot.id));
            return;
        }
        if (trashAt(event.clientX, event.clientY)) {
            const id = drag.id;
            clearDrag();
            onRemove(id);
            return;
        }
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-parallel-drop]") as HTMLElement | null;
        const lane = target?.dataset.parallelLane;
        const index = Number(target?.dataset.parallelIndex);
        clearDrag();
        if ((lane === "a" || lane === "b") && Number.isInteger(index)
            && (lane !== drag.lane || index !== drag.from)) {
            onMove(drag.id, index, lane);
        }
    };
    const renderConnector = (lane: "a" | "b", index: number) => (
        <div key={`gap-${lane}-${index}`}
            className={`parallel-chain-connector${dropTarget === `${lane}:${index}` ? " drop-active" : ""}`}
            data-parallel-drop data-parallel-lane={lane} data-parallel-index={index}>
            <button type="button" className="chain-insert" disabled={lockChain} onClick={() => onAdd(lane, index)}>+</button>
            <span className="chain-flow-line" />
            <span className="chain-flow-arrow">▶</span>
        </div>
    );
    const renderLane = (laneId: "a" | "b", slots: JsonObject[]) => (
        <section className="parallel-lane">
            <div className="parallel-lane-heading">
                <div><strong>RIG {laneId.toUpperCase()}</strong><span>Independent serial path · position it in the stereo mixer</span></div>
            </div>
            <div className="parallel-lane-chain">
                <button type="button" className="chain-slot endpoint parallel-endpoint"><strong>INPUT</strong><span className="muted">SPLIT</span></button>
                {renderConnector(laneId, 0)}
                {slots.map((slot, index) => <div className="parallel-lane-item" key={str(slot.id)}
                    data-parallel-drop data-parallel-lane={laneId} data-parallel-index={index}>
                    <ChainPluginCard
                        slot={slot}
                        chainIndex={index}
                        cardWidth={142}
                        selected={false}
                        dragging={dragId === str(slot.id)}
                        lockChain={lockChain}
                        onPointerDown={(event) => pointerDown(slot, laneId, index, event)}
                        onPointerMove={pointerMove}
                        onPointerUp={(event) => pointerUp(slot, event)}
                        onPointerCancel={clearDrag}
                        onToggle={() => onToggle(str(slot.id), !bool(slot.enabled, true))}
                    />
                    {renderConnector(laneId, index + 1)}
                </div>)}
                {slots.length === 0 && <span className="parallel-empty-lane">DRY PATH</span>}
                <button type="button" className="chain-slot endpoint parallel-endpoint"><strong>MIX</strong><span className="muted">OUTPUT</span></button>
            </div>
        </section>
    );
    const stereo = bool(section.stereo);
    const formatPan = (value: number) => value <= -0.99 ? "LEFT" : value >= 0.99 ? "RIGHT"
        : Math.abs(value) < 0.01 ? "CENTER" : value < 0 ? `L ${Math.round(-value * 100)}` : `R ${Math.round(value * 100)}`;
    return (
        <div className="parallel-editor">
            <div className="parallel-routing-note">
                Both lanes receive the same input. Cabinet IRs are optional—add one only when that NAM capture needs it.
            </div>
            {renderLane("a", objects(section.laneA))}
            {renderLane("b", objects(section.laneB))}
            {dragGhost && <>
                <div className={`chain-trash-icon${dragOverTrash ? " active" : ""}`} data-parallel-trash>🗑</div>
                {createPortal(<div className="chain-ghost" style={{ left: dragGhost.x + 16, top: dragGhost.y + 14 }}>
                    <div>{dragGhost.title}</div><div className="muted">MOVE EFFECT</div>
                </div>, document.body)}
            </>}
            <section className="parallel-mixer">
                <div className="parallel-lane-heading"><div><strong>BLEND & OUTPUT</strong><span>Combine the two finished paths</span></div></div>
                <div className="parallel-output-mode">
                    <span>OUTPUT MODE</span>
                    <div>
                        <button type="button" className={`btn ${!stereo ? "btn-active" : ""}`} disabled={settingsDisabled}
                            onClick={() => queueSetting({ stereo: false }, true)}>MONO</button>
                        <button type="button" className={`btn ${stereo ? "btn-active" : ""}`} disabled={settingsDisabled}
                            onClick={() => queueSetting({ stereo: true }, true)}>STEREO</button>
                    </div>
                    <small>{stereo ? "Each rig can be placed independently across left and right." : "Both rigs are blended equally to the left and right outputs."}</small>
                </div>
                <div className="parallel-mixer-grid">
                    <LiveRange label="RIG A LEVEL" value={num(section.levelADb)} min={-24} max={12} step={0.1} disabled={settingsDisabled}
                        format={(value) => `${value.toFixed(1)} dB`}
                        onLive={(levelADb) => queueSetting({ levelADb }, false)}
                        onCommit={(levelADb) => queueSetting({ levelADb }, true)} />
                    <LiveRange label="RIG B LEVEL" value={num(section.levelBDb)} min={-24} max={12} step={0.1} disabled={settingsDisabled}
                        format={(value) => `${value.toFixed(1)} dB`}
                        onLive={(levelBDb) => queueSetting({ levelBDb }, false)}
                        onCommit={(levelBDb) => queueSetting({ levelBDb }, true)} />
                    {stereo && <LiveRange label="RIG A PAN" value={num(section.panA, -1)} min={-1} max={1} step={0.01} disabled={settingsDisabled}
                        format={formatPan}
                        onLive={(panA) => queueSetting({ panA }, false)}
                        onCommit={(panA) => queueSetting({ panA }, true)} />}
                    {stereo && <LiveRange label="RIG B PAN" value={num(section.panB, 1)} min={-1} max={1} step={0.01} disabled={settingsDisabled}
                        format={formatPan}
                        onLive={(panB) => queueSetting({ panB }, false)}
                        onCommit={(panB) => queueSetting({ panB }, true)} />}
                    <LiveRange label="BALANCE" value={num(section.balance)} min={-1} max={1} step={0.01} disabled={settingsDisabled}
                        format={(value) => value < -0.01 ? `A ${Math.round(-value * 100)}` : value > 0.01 ? `B ${Math.round(value * 100)}` : "CENTER"}
                        onLive={(balance) => queueSetting({ balance }, false)}
                        onCommit={(balance) => queueSetting({ balance }, true)} />
                    <LiveRange label="OUTPUT" value={num(section.outputDb)} min={-24} max={12} step={0.1} disabled={settingsDisabled}
                        format={(value) => `${value.toFixed(1)} dB`}
                        onLive={(outputDb) => queueSetting({ outputDb }, false)}
                        onCommit={(outputDb) => queueSetting({ outputDb }, true)} />
                </div>
                {stereo && <div className="parallel-pan-presets">
                    <span>QUICK POSITION</span>
                    <button type="button" className="btn" disabled={settingsDisabled}
                        onClick={() => queueSetting({ panA: 0, panB: 0 }, true)}>CENTER BOTH</button>
                    <button type="button" className="btn" disabled={settingsDisabled}
                        onClick={() => queueSetting({ panA: -1, panB: -1 }, true)}>ALL LEFT</button>
                    <button type="button" className="btn" disabled={settingsDisabled}
                        onClick={() => queueSetting({ panA: 1, panB: 1 }, true)}>ALL RIGHT</button>
                    <button type="button" className="btn" disabled={settingsDisabled}
                        onClick={() => queueSetting({ panA: -1, panB: 1 }, true)}>SPLIT A-L / B-R</button>
                    <button type="button" className="btn" disabled={settingsDisabled}
                        onClick={() => queueSetting({ panA: 1, panB: -1 }, true)}>SWAP L/R</button>
                </div>}
            </section>
        </div>
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
    const gestureValues = useRef(new Map<string, number>());
    const [selectedControlSymbol, setSelectedControlSymbol] = useState("");
    const [hardwarePopoutSymbol, setHardwarePopoutSymbol] = useState("");
    const hardwarePopoutTimer = useRef<number | null>(null);

    useEffect(() => () => {
        if (previewFrame.current !== null) {
            window.cancelAnimationFrame(previewFrame.current);
        }
        if (hardwarePopoutTimer.current !== null) {
            window.clearTimeout(hardwarePopoutTimer.current);
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

    useEffect(() => {
        if (!ports.some((port) => str(port.symbol) === selectedControlSymbol)) {
            setSelectedControlSymbol(str(ports[0]?.symbol));
        }
    }, [slotId, ports, selectedControlSymbol]);

    const preview = (symbol: string, value: number) => {
        setPreviewValues((current) => ({ ...current, [symbol]: value }));
    };
    const previewLive = (symbol: string, value: number) => {
        preview(symbol, value);
        gestureValues.current.set(symbol, value);
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
        gestureValues.current.delete(symbol);
        if (pendingPreview.current?.symbol === symbol) {
            pendingPreview.current = null;
        }
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
    const commitControl = (port: JsonObject, next: number) => {
        const symbol = str(port.symbol);
        const min = num(port.min, 0);
        const max = num(port.max, 1);
        const clamped = clampPortValue(next, min, max, bool(port.integer) || bool(port.toggled));
        preview(symbol, clamped);
        pendingValues.current.set(symbol, clamped);
        void client.request("chain/control", {
            slotId,
            port: symbol,
            value: clamped,
            persist: true
        }).catch(() => clearPreview(symbol));
    };
    const commitGesture = (port: JsonObject) => {
        const symbol = str(port.symbol);
        const next = gestureValues.current.get(symbol);
        gestureValues.current.delete(symbol);
        if (pendingPreview.current?.symbol === symbol) {
            pendingPreview.current = null;
        }
        if (next !== undefined) {
            commitControl(port, next);
        }
    };
    const stepControl = (port: JsonObject, delta: number) => {
        const symbol = str(port.symbol);
        const min = num(port.min, 0);
        const max = num(port.max, 1);
        const current = previewValues[symbol] ?? controlValue(selected, symbol, num(port.default, min));
        const points = arr(port.scalePoints).filter(isObj).sort((left, right) => num(left.value) - num(right.value));
        if (bool(port.enumerated) && points.length > 0) {
            const nearest = points.reduce((best, point, index) =>
                Math.abs(num(point.value) - current) < Math.abs(num(points[best].value) - current) ? index : best, 0);
            const nextIndex = Math.max(0, Math.min(points.length - 1, nearest + (delta < 0 ? -1 : 1)));
            commitControl(port, num(points[nextIndex].value));
            return;
        }
        if (bool(port.toggled) || (bool(port.integer) && max > min && Math.abs(max - min) <= 1)) {
            commitControl(port, delta < 0 ? min : max);
            return;
        }
        const steps = Math.max(0, Math.trunc(num(port.rangeSteps)));
        const amount = bool(port.integer) ? 1 : steps > 1 ? (max - min) / (steps - 1) : (max - min) / 100;
        commitControl(port, current + (delta < 0 ? -1 : 1) * amount);
    };

    useEffect(() => {
        const turn = (event: Event) => {
            const detail = (event as CustomEvent<{ delta?: number }>).detail;
            const port = ports.find((item) => str(item.symbol) === selectedControlSymbol);
            if (!port || bool(port.trigger)) return;
            stepControl(port, detail?.delta ?? 1);
            setHardwarePopoutSymbol(selectedControlSymbol);
            if (hardwarePopoutTimer.current !== null) window.clearTimeout(hardwarePopoutTimer.current);
            hardwarePopoutTimer.current = window.setTimeout(() => {
                hardwarePopoutTimer.current = null;
                setHardwarePopoutSymbol("");
            }, 2200);
        };
        window.addEventListener("pimfx-editor-control-turn", turn);
        return () => window.removeEventListener("pimfx-editor-control-turn", turn);
    }, [ports, selectedControlSymbol, selected, previewValues]);
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
                    const trigger = bool(port.trigger);
                    const toggled = bool(port.toggled);
                    const orderedPoints = [...points].sort((left, right) => num(left.value) - num(right.value));
                    const twoOptionEnumeration = enumeration && orderedPoints.length === 2;
                    const binaryInteger = bool(port.integer) && max > min && Math.abs(max - min) <= 1;
                    const switchLike = toggled || twoOptionEnumeration || binaryInteger;
                    const switchOffValue = twoOptionEnumeration ? num(orderedPoints[0]?.value, min) : min;
                    const switchOnValue = twoOptionEnumeration ? num(orderedPoints[1]?.value, max) : max;
                    const switchOn = Math.abs(value - switchOnValue) <= Math.abs(value - switchOffValue);
                    const switchStateText = switchLike ? formatSwitchState(value, port) : "";
                    const apply = (next: number) => commitControl(port, next);
                    const editNumber = () => {
                        setSelectedControlSymbol(symbol);
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
                                {!switchLike && !trigger && !enumeration && (
                                    <button type="button" className="control-value"
                                        onClick={() => setSelectedControlSymbol(symbol)}
                                        onDoubleClick={editNumber}
                                        title="Tap to select · double tap the control to enter a value">
                                        {formatControl(value, port)}
                                    </button>
                                )}
                                {enumeration && !switchLike && (
                                    <select
                                        className="control-value-select"
                                        aria-label={`${name} value`}
                                        value={String(value)}
                                        onChange={(event) => {
                                            setSelectedControlSymbol(symbol);
                                            apply(Number(event.target.value));
                                        }}
                                    >
                                        {points.map((item) => (
                                            <option key={`${num(item.value)}:${str(item.label)}`} value={num(item.value)}>
                                                {str(item.label, String(num(item.value)))}
                                            </option>
                                        ))}
                                    </select>
                                )}
                                {switchLike && !trigger && switchStateText && (
                                    <button type="button" className="control-value" onClick={() => {
                                        setSelectedControlSymbol(symbol);
                                        apply(switchOn ? switchOffValue : switchOnValue);
                                    }}>
                                        {switchStateText}
                                    </button>
                                )}
                                {trigger && (
                                    <span className="muted">TRIGGER</span>
                                )}
                            </div>
                            {boundFor(symbol) && (
                                <div className="control-bind-hint">
                                    {boundLabel(symbol)}
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
                            {(() => {
                                const disabled = (tempoEnabled && linkedBeats > 0) || calibrationManaged;
                                const kind = trigger ? "momentary" : switchLike ? "toggle" : enumeration ? "encoder" : "pot";
                                const normalized = hasLogarithmicRange(port)
                                    ? sliderValue(port, value)
                                    : (value - min) / Math.max(1e-9, max - min);
                                const tile: PerformanceTile = {
                                    id: `${slotId}:${symbol}`,
                                    switchLabel: name,
                                    valueText: switchLike ? switchStateText : formatControl(value, port),
                                    role: "utility",
                                    lightState: switchLike && switchOn ? "active" : "inactive",
                                    active: switchLike ? switchOn : selectedControlSymbol === symbol,
                                    analog: !trigger && !switchLike,
                                    analogSource: name,
                                    analogFunction: str(plugin.name, "Effect"),
                                    analogValue: switchLike ? switchStateText : formatControl(value, port),
                                    assigned: !disabled,
                                    kind,
                                    detentCount: kind === "encoder" ? orderedPoints.length : 0,
                                    detentIndex: kind === "encoder" && orderedPoints.length > 0
                                        ? orderedPoints.reduce((best, item, index) => Math.abs(num(item.value) - value) < Math.abs(num(orderedPoints[best].value) - value) ? index : best, 0)
                                        : -1,
                                    value: Math.max(0, Math.min(1, normalized)),
                                    freeform: true,
                                    scrollFriendly: true,
                                    hardwarePopout: hardwarePopoutSymbol === symbol,
                                    onPopoutDismiss: () => {
                                        setHardwarePopoutSymbol((current) => {
                                            if (current !== symbol) return current;
                                            if (hardwarePopoutTimer.current !== null) {
                                                window.clearTimeout(hardwarePopoutTimer.current);
                                                hardwarePopoutTimer.current = null;
                                            }
                                            return "";
                                        });
                                    },
                                    encoderSelected: selectedControlSymbol === symbol,
                                    onEngage: () => setSelectedControlSymbol(symbol),
                                    onPress: () => {
                                        setSelectedControlSymbol(symbol);
                                        if (trigger) {
                                            apply(triggerValue(port));
                                        } else if (switchLike) {
                                            apply(switchOn ? switchOffValue : switchOnValue);
                                        }
                                    },
                                    onValue: !trigger && !switchLike && !enumeration && !disabled
                                        ? (next) => previewLive(symbol, portValue(port,
                                            hasLogarithmicRange(port) ? next : min + next * (max - min)))
                                        : undefined,
                                    onDoublePress: !trigger && !switchLike && !enumeration && !disabled
                                        ? editNumber
                                        : undefined,
                                    onRelease: !trigger && !switchLike && !enumeration && !disabled
                                        ? () => commitGesture(port)
                                        : undefined,
                                    onCancelPress: !trigger && !switchLike && !enumeration
                                        ? () => clearPreview(symbol)
                                        : undefined,
                                    onStep: !trigger && !disabled
                                        ? (delta) => stepControl(port, delta)
                                        : undefined
                                };
                                return (
                                    <div className="editor-parameter-control">
                                        <PerformanceControl
                                            tile={tile}
                                            switchStyle="theme"
                                            bypassed={false}
                                            renderMenu={false}
                                        />
                                    </div>
                                );
                            })()}
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
    physicalControls,
    virtualControls,
    virtualPages,
    current,
    onClose,
    onNone,
    onChoose
}: {
    target: BindTarget;
    physicalControls: JsonObject[];
    virtualControls: JsonObject[];
    virtualPages: JsonObject[];
    current: JsonObject[];
    onClose: () => void;
    onNone: (controlId: string) => void;
    onChoose: (controlId: string) => void;
}) {
    const boundIds = new Set(current.map((binding) => str(binding.controlId)));
    const compatible = (control: JsonObject, physical = false) => {
        const rawKind = normalizeControlKind(str(control.kind, "momentary"));
        const kind = physical && rawKind === "encoderPush" ? "momentary" : rawKind;
        return target.mode === "bypass"
            ? virtualTargetCompatible(kind, "toggleEffect")
            : virtualTargetCompatible(kind, "setParameter", target.port);
    };
    const physicalChoices = physicalControls.filter((control) => compatible(control, true));
    const virtualChoices = virtualControls.filter((control) => compatible(control));
    const renderChoices = (title: string, choices: JsonObject[], virtual: boolean) => (
        <section className="stack" style={{ gap: 5 }}>
            <strong>{title}</strong>
            {choices.map((control) => {
                const id = str(control.id);
                const assigned = boundIds.has(id);
                const pageId = virtual ? virtualControlPageId(control, virtualPages) : "";
                const page = virtualPages.find((item) => str(item.id) === pageId);
                return (
                    <div key={id} className="mfx-bind-choice-row">
                        <button type="button"
                            className={`mfx-overlay-option${assigned ? " selected" : ""}`}
                            onClick={() => assigned ? onNone(id) : onChoose(id)}>
                            {assigned ? "✓ " : ""}{str(control.label, id)} · {str(control.kind, "momentary")}
                            {virtual ? ` · ${str(obj(page).name, "Page")}` : ""}
                        </button>
                    </div>
                );
            })}
            {choices.length === 0 && <div className="muted">No compatible controls available.</div>}
        </section>
    );
    return (
        <div className="mfx-overlay" onClick={onClose}>
            <div className="mfx-overlay-card" onClick={(event) => event.stopPropagation()}>
                <div className="mfx-overlay-title">
                    {target.mode === "bypass" ? `BIND BYPASS — ${target.name}` : `BIND — ${target.name}`}
                </div>
                <div className="muted" style={{ marginBottom: 10 }}>
                    Bindings save immediately and stay with this preset. Select more than one control to assign both hardware and touchscreen controls.
                </div>
                {renderChoices("VIRTUAL CONTROLS", virtualChoices, true)}
                {renderChoices("PHYSICAL CONTROLS", physicalChoices, false)}
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

function formatSwitchState(value: number, port: JsonObject): string {
    const point = arr(port.scalePoints).filter(isObj).find((item) =>
        approximatelyEqual(num(item.value), value));
    if (!point) return "";
    const label = str(point.label).trim();
    if (!label) return "";
    const numericLabel = Number(label);
    if (Number.isFinite(numericLabel) && approximatelyEqual(numericLabel, num(point.value))) return "";
    return label;
}
