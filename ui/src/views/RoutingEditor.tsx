import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMeters, peakDb, type EngineClient } from "../api";
import { bool, num, obj, objects, str, type JsonObject } from "../json";
import { PluginBrowser } from "./PluginBrowser";
import { RoutingMixers } from "./RoutingMixers";
import { ConfirmDialog } from "./ConfirmDialog";
import { routeCables } from "./routingCables";
import { freeRoutingPoint, separateRoutingBlocks } from "./routingLayout";

type Point = { x: number; y: number };
type WireEnd = { id: string; direction: "in" | "out" };
function preference(key: string, fallback: string) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function savedCableHues(presetId: string): Record<string, number> {
    try {
        const saved = obj(JSON.parse(preference(`pimfx-cable-colors:${presetId}`, "{}")));
        const hues: Record<string, number> = {};
        for (const [key, value] of Object.entries(saved))
            if (typeof value === "number" && Number.isFinite(value)) hues[key] = value;
        return hues;
    } catch { return {}; }
}
export function RoutingEditor({ client, catalog, blocks, routing, presetId, locked, mix, onMixChange, onEdit, onIo, onRemove, run, runStructure, toolbarContent, presetActions, presetManagementActions, undoCount, redoCount }: {
    client: EngineClient; catalog: JsonObject; blocks: JsonObject[]; routing: JsonObject;
    presetId: string; locked: boolean; onEdit: (id: string) => void;
    mix: boolean; onMixChange: (mix: boolean) => void;
    onIo: (kind: "input" | "output") => void;
    onRemove: (id: string) => Promise<void>;
    run: (work: () => Promise<unknown>) => Promise<void>;
    runStructure: (work: () => Promise<unknown>) => Promise<void>;
    toolbarContent: ReactNode; presetActions: ReactNode; presetManagementActions: ReactNode;
    undoCount: number; redoCount: number;
}) {
    const meters = useMeters(client);
    const history = (redo: boolean) => { setMenu(""); void runStructure(() => client.request(redo ? "preset/redo" : "preset/undo")); };
    const [selected, setSelected] = useState("");
    const [source, setSource] = useState("");
    const [browser, setBrowser] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [menu, setMenu] = useState<"actions" | "connections" | "add" | "">("");
    const [contextPoint, setContextPoint] = useState<Point>({ x: 0, y: 0 });
    const additionPoint = useRef<Point | null>(null);
    const fingers = useRef(new Map<number, Point>());
    const hold = useRef<{ timer: number; origin: Point; scroll: Point } | null>(null);
    const pinch = useRef<{ distance: number; zoom: number; world: Point } | null>(null);
    const zoomScroll = useRef<{ world: Point; screen: Point } | null>(null);
    const actionsButton = useRef<HTMLButtonElement>(null);
    const connectionsButton = useRef<HTMLButtonElement>(null);
    const popup = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!menu) return;
        const dismiss = (event: PointerEvent) => {
            const target = event.target as Node;
            if (target instanceof Element && target.closest(".pimfx-keyboard-backdrop")) return;
            if (!popup.current?.contains(target) && !actionsButton.current?.contains(target) && !connectionsButton.current?.contains(target)) setMenu("");
        };
        const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(""); (menu === "actions" ? actionsButton : connectionsButton).current?.focus(); } };
        const close = () => setMenu("");
        document.addEventListener("pointerdown", dismiss, true);
        document.addEventListener("keydown", key);
        window.addEventListener("resize", close);
        return () => { document.removeEventListener("pointerdown", dismiss, true); document.removeEventListener("keydown", key); window.removeEventListener("resize", close); };
    }, [menu]);
    const [spacing, setSpacing] = useState(() => Math.max(20, Math.min(100, Number(preference("pimfx-routing-grid", "20")) || 20)));
    const [spacingText, setSpacingText] = useState(String(spacing));
    const [snap, setSnap] = useState(() => preference("pimfx-routing-snap", "on") !== "off");
    const [wireMode, setWireMode] = useState(() => preference("pimfx-routing-wire-mode", "tap") === "drag" ? "drag" : "tap");
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
    const [wire, setWire] = useState<{ start: WireEnd; point: Point; target: WireEnd | null } | null>(null);
    const [positions, setPositions] = useState<JsonObject>(obj(routing.positions));
    const [graph, setGraph] = useState(routing);
    const [message, setMessage] = useState("");
    const [deleteId, setDeleteId] = useState("");
    const [deleteEdge, setDeleteEdge] = useState<{ from: string; to: string } | null>(null);
    const [routingBusy, setRoutingBusy] = useState(false);
    const [newBlocks, setNewBlocks] = useState<Set<string>>(() => new Set());
    const [revealId, setRevealId] = useState("");
    const knownBlocks = useRef({ presetId, ids: new Set(blocks.map(b => str(b.id))) });
    const knownEdges = useRef(objects(routing.edges));
    const cablePalette = useRef({ presetId, hues: savedCableHues(presetId) });
    const graphRef = useRef(routing);
    const drag = useRef<{ id: string; x: number; y: number; start: Point } | null>(null);
    const pending = useRef<JsonObject | null>(null);
    const sending = useRef(false);
    const mounted = useRef(true);
    const viewport = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLDivElement>(null);
    const cancelHold = () => { if (hold.current) window.clearTimeout(hold.current.timer); hold.current = null; };
    useEffect(() => () => { if (hold.current) window.clearTimeout(hold.current.timer); }, []);
    useEffect(() => { cancelHold(); fingers.current.clear(); pinch.current = null; setMenu(""); additionPoint.current = null; }, [presetId, mix]);
    useLayoutEffect(() => {
        const pendingZoom = zoomScroll.current, area = viewport.current;
        if (!pendingZoom || !area) return;
        area.scrollLeft = pendingZoom.world.x * zoom - pendingZoom.screen.x;
        area.scrollTop = pendingZoom.world.y * zoom - pendingZoom.screen.y;
        zoomScroll.current = null;
    }, [zoom]);
    const emptyGrid = (target: EventTarget | null) => target instanceof Element
        && !target.closest(".routing-block, button, input, select, .routing-hint");
    const openAddMenu = (screen: Point) => {
        const area = viewport.current;
        if (!area) return;
        const bounds = area.getBoundingClientRect();
        additionPoint.current = { x: (screen.x - bounds.left + area.scrollLeft) / zoom,
            y: (screen.y - bounds.top + area.scrollTop) / zoom };
        setContextPoint(screen); setMenu("add");
    };
    const gridDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!emptyGrid(event.target) || (!event.isPrimary && !fingers.current.size) || event.pointerType === "mouse") return;
        const area = event.currentTarget, point = { x: event.clientX, y: event.clientY };
        event.preventDefault(); area.setPointerCapture(event.pointerId);
        fingers.current.set(event.pointerId, point);
        if (fingers.current.size === 1) {
            cancelHold();
            hold.current = { origin: point, scroll: { x: area.scrollLeft, y: area.scrollTop },
                timer: window.setTimeout(() => { if (hold.current && fingers.current.size === 1) { openAddMenu(point); cancelHold(); } }, 600) };
        } else if (fingers.current.size === 2) {
            cancelHold(); setMenu("");
            const [a, b] = [...fingers.current.values()], rect = area.getBoundingClientRect();
            const center = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
            pinch.current = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom,
                world: { x: (center.x + area.scrollLeft) / zoom, y: (center.y + area.scrollTop) / zoom } };
        }
    };
    const gridMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!fingers.current.has(event.pointerId)) return;
        event.preventDefault();
        fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const area = event.currentTarget, activePinch = pinch.current;
        if (activePinch && fingers.current.size === 2) {
            const [a, b] = [...fingers.current.values()], rect = area.getBoundingClientRect();
            zoomScroll.current = { world: activePinch.world,
                screen: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top } };
            const nextZoom = Math.max(.5, Math.min(1.5, activePinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / activePinch.distance));
            if (nextZoom === zoom) {
                area.scrollLeft = activePinch.world.x * zoom - zoomScroll.current.screen.x;
                area.scrollTop = activePinch.world.y * zoom - zoomScroll.current.screen.y;
                zoomScroll.current = null;
            } else setZoom(nextZoom);
        } else if (hold.current) {
            const h = hold.current, dx = event.clientX - h.origin.x, dy = event.clientY - h.origin.y;
            if (Math.hypot(dx, dy) > 10) window.clearTimeout(h.timer);
            area.scrollLeft = h.scroll.x - dx; area.scrollTop = h.scroll.y - dy;
        }
    };
    const gridEnd = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!fingers.current.delete(event.pointerId)) return;
        cancelHold(); pinch.current = null;
    };
    const wireRef = useRef<typeof wire>(null);
    const touchPort = useRef<{ pointerId: number; x: number; y: number; id: string; direction: "in" | "out" } | null>(null);
    const suppressPortClickUntil = useRef(0);
    const positionsRef = useRef(positions);
    positionsRef.current = positions;
    useEffect(() => {
        try {
            localStorage.setItem("pimfx-routing-grid", String(spacing));
            localStorage.setItem("pimfx-routing-snap", snap ? "on" : "off");
            localStorage.setItem("pimfx-routing-wire-mode", wireMode);
        } catch { /* Browser storage is optional. */ }
    }, [spacing, snap, wireMode]);
    useEffect(() => {
        const element = viewport.current;
        if (!element) return;
        const update = () => setViewportSize({ width: element.clientWidth, height: element.clientHeight });
        update();
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, [mix]);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => {
        if (!sending.current && !pending.current && !drag.current) {
            graphRef.current = routing;
            setGraph(routing);
            setPositions(obj(routing.positions));
        }
    }, [routing]);
    useEffect(() => {
        pending.current = null;
        graphRef.current = routing;
        setGraph(routing);
        setPositions(obj(routing.positions));
        setSelected(""); setSource(""); setDeleteId(""); setDeleteEdge(null);
    }, [presetId]);
    const nodes = [{ id: "input", name: "INPUT" }, ...blocks, { id: "output", name: "OUTPUT" }];
    useEffect(() => {
        const exists = (id: string) => id === "input" || id === "output" || blocks.some(b => str(b.id) === id);
        if (selected && !exists(selected)) setSelected("");
        if (source && !exists(source)) setSource("");
        if (deleteId && !exists(deleteId)) setDeleteId("");
    }, [blocks, selected, source, deleteId]);
    const rawPoint = (id: string): Point => {
        const index = nodes.findIndex(n => str(n.id) === id);
        // A newly published block must use its saved position on the first
        // render, before the routing synchronization effect updates state.
        const p = { ...obj(obj(routing.positions)[id]), ...obj(positions[id]) };
        const fallbackX = 30 + (index % 4) * 210, fallbackY = 30 + Math.floor(index / 4) * 180;
        return { x: num(p.x, snap ? Math.round(fallbackX / spacing) * spacing : fallbackX),
            y: num(p.y, snap ? Math.round(fallbackY / spacing) * spacing : fallbackY) };
    };
    const rawGeometry = JSON.stringify(nodes.map(n => ({ id: str(n.id), ...rawPoint(str(n.id)) })));
    const spacedNodes = useMemo(() => separateRoutingBlocks(JSON.parse(rawGeometry), snap ? spacing : 0), [rawGeometry, snap, spacing]);
    const point = (id: string): Point => spacedNodes.find(n => n.id === id) ?? rawPoint(id);
    const visiblePositions: JsonObject = Object.fromEntries(spacedNodes.map(({ id, x, y }) => [id, { x, y }]));
    positionsRef.current = visiblePositions;
    const edges = objects(graph.edges);
    const cableGeometry = JSON.stringify(nodes.map(n => ({ id: str(n.id), ...point(str(n.id)) })));
    const cableTopology = JSON.stringify(edges.map(e => ({ from: str(e.from), to: str(e.to) })));
    const cableRoutes = useMemo(() => routeCables(JSON.parse(cableGeometry), JSON.parse(cableTopology)), [cableGeometry, cableTopology]);
    const cablePoints = cableRoutes.flatMap(route => route.points);
    const width = Math.max(850, Math.ceil(viewportSize.width / zoom), ...nodes.map(n => point(str(n.id)).x + 200), ...cablePoints.map(p => p.x + 20), ...cableRoutes.map(r => r.label.x + 30));
    const height = Math.max(420, Math.ceil(viewportSize.height / zoom), ...nodes.map(n => point(str(n.id)).y + 155), ...cablePoints.map(p => p.y + 20), ...cableRoutes.map(r => r.label.y + 30));
    const align = (value: number, enabled = snap) => Math.max(0, Math.min(enabled ? Math.floor(10000 / spacing) * spacing : 10000,
        enabled ? Math.round(value / spacing) * spacing : value));
    if (cablePalette.current.presetId !== presetId) cablePalette.current = { presetId, hues: savedCableHues(presetId) };
    const cableColors = edges.map(edge => {
        const key = JSON.stringify([str(edge.from), str(edge.to)]);
        const hues = cablePalette.current.hues;
        if (!(key in hues)) hues[key] = (195 + Object.keys(hues).length * 137.508) % 360;
        return `hsl(${hues[key]} 85% 65%)`;
    });
    const savedPalette = JSON.stringify(cablePalette.current.hues);
    useEffect(() => {
        try { localStorage.setItem(`pimfx-cable-colors:${presetId}`, savedPalette); } catch { /* Optional browser storage. */ }
    }, [presetId, savedPalette]);
    const portColors = (id: string, direction: "in" | "out") => <span className="routing-port-cables" aria-hidden="true">
        {edges.map((edge, i) => str(direction === "in" ? edge.to : edge.from) === id
            ? <span key={`${str(edge.from)}:${str(edge.to)}`} style={{ backgroundColor: cableColors[i] }} /> : null)}
    </span>;
    const acknowledge = (id: string) => {
        setNewBlocks(previous => {
            if (!previous.has(id)) return previous;
            const next = new Set(previous); next.delete(id); return next;
        });
    };
    useEffect(() => {
        const ids = new Set(blocks.map(b => str(b.id)));
        if (knownBlocks.current.presetId !== presetId) {
            setNewBlocks(new Set()); setRevealId("");
        } else {
            const added = [...ids].filter(id => !knownBlocks.current.ids.has(id));
            if (added.length) {
                setNewBlocks(previous => new Set([...previous].filter(id => ids.has(id)).concat(added)));
                const id = added[added.length - 1];
                setSelected(id); setRevealId(id); onMixChange(false);
            }
        }
        knownBlocks.current = { presetId, ids };
    }, [blocks, presetId]);
    useEffect(() => {
        const added = edges.filter(e => !knownEdges.current.some(old => old.from === e.from && old.to === e.to));
        if (added.length) setNewBlocks(previous => {
            const next = new Set(previous);
            added.forEach(e => { next.delete(str(e.from)); next.delete(str(e.to)); });
            return next;
        });
        knownEdges.current = edges;
    }, [graph.edges]);
    useEffect(() => {
        if (!revealId || mix || !viewport.current || !nodes.some(n => str(n.id) === revealId)) return;
        const area = viewport.current, p = point(revealId);
        area.scrollTo({ left: Math.max(0, p.x * zoom - (area.clientWidth - 174 * zoom) / 2),
            top: Math.max(0, p.y * zoom - (area.clientHeight - 140 * zoom) / 2) });
        setRevealId("");
    }, [revealId, mix, positions, zoom]);
    const additionLayout = () => ({ spacing, snap,
        x: additionPoint.current?.x ?? (viewport.current?.scrollLeft ?? 0) / zoom + 16,
        y: additionPoint.current?.y ?? (viewport.current?.scrollTop ?? 0) / zoom + 16,
        width: (viewport.current?.clientWidth ?? window.innerWidth) / zoom,
        height: (viewport.current?.clientHeight ?? Math.max(160, window.innerHeight - 160)) / zoom });
    const commit = (next: JsonObject) => {
        graphRef.current = next;
        setGraph(next);
        pending.current = next;
        if (sending.current) return;
        sending.current = true;
        setRoutingBusy(true);
        void run(async () => {
            try {
                while (pending.current && mounted.current) {
                    const value = pending.current;
                    pending.current = null;
                    await client.request("routing/edit", { routing: value, presetId });
                }
            } catch (error) {
                pending.current = null;
                graphRef.current = obj(client.snapshot.state.routing);
                setGraph(graphRef.current);
                setPositions(obj(graphRef.current.positions));
                throw error;
            } finally { sending.current = false; if (mounted.current) setRoutingBusy(false); }
        });
    };
    const connect = (destination: string, from = source) => {
        if (!from || locked) return;
        if (from === destination) { setSource(""); return; }
        const current = objects(graphRef.current.edges);
        if (current.some(e => str(e.from) === from && str(e.to) === destination)) {
            setMessage("These blocks are already connected."); return;
        }
        setMessage("");
        commit({ ...graphRef.current, edges: [...current, { from, to: destination, levelDb: 0, pan: 0 }] });
        setSource("");
    };
    const portPoint = (end: WireEnd): Point => {
        const p = point(end.id);
        return { x: p.x + (end.direction === "out" ? 174 : 0), y: p.y + 111 };
    };
    const moveWire = (event: React.PointerEvent<HTMLButtonElement>) => {
        const active = wireRef.current, area = viewport.current;
        if (!active || !area || !canvas.current) return;
        const bounds = area.getBoundingClientRect();
        if (event.clientX < bounds.left + 32) area.scrollLeft -= 14;
        else if (event.clientX > bounds.right - 32) area.scrollLeft += 14;
        if (event.clientY < bounds.top + 32) area.scrollTop -= 14;
        else if (event.clientY > bounds.bottom - 32) area.scrollTop += 14;
        const rect = canvas.current.getBoundingClientRect();
        const port = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>("[data-routing-port]");
        const direction = port?.dataset.routingPort;
        const target: WireEnd | null = port && !port.disabled && direction !== active.start.direction
            && (direction === "in" || direction === "out") && port.dataset.blockId !== active.start.id
            ? { id: port.dataset.blockId!, direction } : null;
        const next = { ...active, point: { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom }, target };
        wireRef.current = next; setWire(next);
    };
    const tapPort = (id: string, direction: "in" | "out") => {
        if (locked || wireMode !== "tap") return;
        if (direction === "in") connect(id);
        else { setSource(source === id ? "" : id); setSelected(id); }
    };
    const wireEvents = (id: string, direction: "in" | "out") => ({
        onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
            if (locked || (event.pointerType === "mouse" && event.button !== 0) || !event.isPrimary) return;
            event.stopPropagation();
            if (event.pointerType !== "mouse") suppressPortClickUntil.current = performance.now() + 800;
            if (wireMode === "tap") {
                if (event.pointerType === "mouse") return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                touchPort.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, id, direction };
                return;
            }
            event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
            const start = { id, direction };
            const next = { start, point: portPoint(start), target: null };
            setSource(""); setSelected(id); wireRef.current = next; setWire(next);
        },
        onPointerMove: moveWire,
        onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            if (event.pointerType !== "mouse") suppressPortClickUntil.current = performance.now() + 800;
            const touch = touchPort.current;
            if (touch && touch.pointerId === event.pointerId) {
                touchPort.current = null;
                suppressPortClickUntil.current = performance.now() + 800;
                event.preventDefault();
                if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) <= 16) tapPort(touch.id, touch.direction);
                return;
            }
            if (!wireRef.current) return;
            moveWire(event);
            const active = wireRef.current;
            wireRef.current = null; setWire(null);
            if (active?.target) {
                const from = active.start.direction === "out" ? active.start.id : active.target.id;
                const to = active.start.direction === "in" ? active.start.id : active.target.id;
                connect(to, from);
            }
        },
        onPointerCancel: () => { touchPort.current = null; wireRef.current = null; setWire(null); },
        onLostPointerCapture: () => { touchPort.current = null; wireRef.current = null; setWire(null); },
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            if (event.detail !== 0 && performance.now() < suppressPortClickUntil.current) return;
            tapPort(id, direction);
        }
    });
    const alignAll = () => {
        const next: JsonObject = {};
        nodes.forEach(n => { const p = point(str(n.id)); next[str(n.id)] = { x: align(p.x, true), y: align(p.y, true) }; });
        const spaced = Object.fromEntries(separateRoutingBlocks(nodes.map(n => ({ id: str(n.id), x: num(obj(next[str(n.id)]).x), y: num(obj(next[str(n.id)]).y) })), spacing).map(({ id, x, y }) => [id, { x, y }]));
        setPositions(spaced); commit({ ...graphRef.current, positions: spaced });
    };
    const autoLayout = () => {
        const levels = new Map<string, number>(nodes.map(n => [str(n.id), 0]));
        for (let i = 0; i < nodes.length; i++) for (const e of edges)
            levels.set(str(e.to), Math.max(levels.get(str(e.to)) ?? 0, (levels.get(str(e.from)) ?? 0) + 1));
        const rows = new Map<number, number>();
        const next: JsonObject = {};
        nodes.forEach(n => {
            const level = levels.get(str(n.id)) ?? 0, row = rows.get(level) ?? 0;
            next[str(n.id)] = { x: align(spacing + level * Math.ceil(210 / spacing) * spacing, true),
                y: align(spacing + row * Math.ceil(180 / spacing) * spacing, true) };
            rows.set(level, row + 1);
        });
        setPositions(next); commit({ ...graphRef.current, positions: next });
    };
    const edit = (id: string) => {
        if (id === "input" || id === "output") onIo(id);
        else if (str(blocks.find(b => str(b.id) === id)?.kind) === "mixer") { setSelected(id); onMixChange(true); }
        else onEdit(id);
    };
    const anchor = (menu === "actions" ? actionsButton : connectionsButton).current?.getBoundingClientRect();
    const menuWidth = Math.min(menu === "connections" ? 480 : 400, window.innerWidth - 16);
    const menuTop = Math.max(8, Math.min(menu === "add" ? contextPoint.y : (anchor?.bottom ?? 0) + 6, window.innerHeight - (menu === "add" ? 132 : 64)));
    return <div className="routing-editor">
        <div className="routing-header">
            <button ref={connectionsButton} className="btn" aria-expanded={menu === "connections"} aria-controls="routing-menu" onClick={() => setMenu(menu === "connections" ? "" : "connections")}>CONNECTIONS ▾</button>
            <button ref={actionsButton} className="btn" aria-expanded={menu === "actions"} aria-controls="routing-menu" onClick={() => setMenu(menu === "actions" ? "" : "actions")}>OPTIONS ▾</button>
            {toolbarContent}
        </div>
        {menu && createPortal(<div ref={popup} id="routing-menu" className="routing-menu" role="dialog" aria-label={menu === "add" ? "Add a block" : menu === "actions" ? "Editor options" : "Audio connections"}
            style={{ top: menuTop, left: Math.max(8, Math.min(menu === "add" ? contextPoint.x : anchor?.left ?? 8, window.innerWidth - menuWidth - 8)), width: menuWidth, maxHeight: window.innerHeight - menuTop - 8 }}>
            <div className="routing-menu-title"><strong>{menu === "add" ? "" : menu === "actions" ? "EDITOR OPTIONS" : `CONNECTIONS (${edges.length})`}</strong>
                {(menu === "add" || menu === "actions") && <>
                    <button className="btn routing-menu-icon" title={`Undo (${undoCount})`} aria-label="Undo last preset edit" disabled={locked || routingBusy || !undoCount} onClick={() => history(false)}>↶</button>
                    <button className="btn routing-menu-icon" title={`Redo (${redoCount})`} aria-label="Redo preset edit" disabled={locked || routingBusy || !redoCount} onClick={() => history(true)}>↷</button>
                </>}
                <button className="btn routing-menu-icon" aria-label="Close editor menu" onClick={() => setMenu("")}>×</button></div>
            {menu === "add" ?
            <div className="routing-menu-actions">
                <button className="btn" disabled={locked || routingBusy} onClick={() => { setMenu(""); setBrowser(true); }}>ADD PLUGIN</button>
                <button className="btn" disabled={locked || routingBusy} onClick={() => { setMenu(""); void runStructure(() => client.request("routing/edit", { addMixer: true, presetId, layout: additionLayout() })); }}>ADD MIXER</button>
            </div>
            : menu === "actions" ? <>
            <div className="routing-menu-actions" onClick={() => setMenu("")}>{presetActions}</div>
            <div className="routing-menu-actions" onClick={() => setMenu("")}>{presetManagementActions}</div>
            <div className="routing-menu-actions">
                <button className="btn" onClick={() => { setMenu(""); onMixChange(!mix); }}>{mix ? "SHOW ROUTING" : "SHOW MIXERS"}</button>
                <button className="btn" onClick={() => { setMenu(""); autoLayout(); }} disabled={locked}>ARRANGE</button>
                <button className="btn btn-danger" disabled={locked || routingBusy || !selected || ["input", "output"].includes(selected)} onClick={() => { setMenu(""); setDeleteId(selected); }}>REMOVE SELECTED BLOCK</button>
            </div>
            <div className="routing-menu-zoom"><span>Zoom {Math.round(zoom * 100)}%</span><button className="btn" aria-label="Zoom out" onClick={() => setZoom(Math.max(.5, zoom - .1))}>−</button><button className="btn" aria-label="Zoom in" onClick={() => setZoom(Math.min(1.5, zoom + .1))}>+</button></div>
            <strong>GRID & WIRING</strong>
            <div className="routing-grid-settings">
            <button className={`btn ${snap ? "btn-active" : ""}`} aria-pressed={snap} onClick={() => setSnap(!snap)}>SNAP {snap ? "ON" : "OFF"}</button>
            <label>Grid spacing <input className="input" type="number" aria-label="Grid spacing" min="20" max="100" step="1" value={spacingText}
                onChange={event => { setSpacingText(event.target.value); const value = Number(event.target.value); if (Number.isFinite(value) && value >= 20 && value <= 100) setSpacing(Math.round(value)); }}
                onBlur={event => { const value = Math.max(20, Math.min(100, Math.round(Number(event.currentTarget.value) || spacing))); setSpacing(value); setSpacingText(String(value)); }} /> px</label>
            <button className="btn" disabled={locked} onClick={alignAll}>ALIGN TO GRID</button>
            <label>Connections <select className="input" aria-label="Connection gesture" value={wireMode} onChange={event => { setSource(""); setWire(null); wireRef.current = null; setWireMode(event.target.value); }}>
                <option value="tap">Tap OUT, then IN</option><option value="drag">Drag between connectors</option>
            </select></label>
            </div>
            <p className="muted">Drag headings to move blocks. Hold empty grid space to add a block; pinch to zoom. {wireMode === "drag" ? "Drag between OUT and IN to connect." : "Tap OUT, then IN to connect."}</p>
            </> : <div className="routing-menu-connections">
                {!edges.length && <p className="muted">No audio connections. Use the connectors on the canvas to add one.</p>}
                {edges.map((edge, i) => <div key={`${str(edge.from)}:${str(edge.to)}`} className="routing-menu-connection"><span><span className="routing-cable-swatch" style={{ backgroundColor: cableColors[i] }} aria-hidden="true" />{i + 1}: {str(nodes.find(n => n.id === edge.from)?.name)} → {str(nodes.find(n => n.id === edge.to)?.name)}</span>
                    <button className="btn btn-danger" disabled={locked} aria-label={`Remove connection ${i + 1}`} onClick={() => { setMenu(""); setDeleteEdge({ from: str(edge.from), to: str(edge.to) }); }}>×</button></div>)}
            </div>}
        </div>, document.body)}
        {message && <div role="status" className="muted">{message}</div>}
        {deleteId && <ConfirmDialog title="REMOVE BLOCK?" body={`Remove ${str(nodes.find(n => n.id === deleteId)?.name, "this block")} and its connections?`} confirmLabel="REMOVE" danger
            onCancel={() => setDeleteId("")} onConfirm={() => { if (locked || sending.current || pending.current) return; const id = deleteId; setDeleteId(""); void onRemove(id); }} />}
        {deleteEdge && <ConfirmDialog title="REMOVE CONNECTION?" body={`${str(nodes.find(n => n.id === deleteEdge.from)?.name, deleteEdge.from)} → ${str(nodes.find(n => n.id === deleteEdge.to)?.name, deleteEdge.to)}`} confirmLabel="REMOVE" danger
            onCancel={() => setDeleteEdge(null)} onConfirm={() => {
                if (locked || sending.current || pending.current) return;
                commit({ ...graphRef.current, edges: objects(graphRef.current.edges).filter(e => !(e.from === deleteEdge.from && e.to === deleteEdge.to)) });
                setDeleteEdge(null);
            }} />}
        {mix ? <RoutingMixers blocks={blocks} routing={graph} selected={selected} onSelected={setSelected}
            client={client} onEdit={onEdit} onRouting={commit} /> : <>
            {source && <div className="routing-hint">Tap an IN connector to finish. <button className="btn" onClick={() => setSource("")}>CANCEL CONNECTION</button></div>}
            <div className="routing-viewport" ref={viewport}
                onPointerDown={gridDown} onPointerMove={gridMove} onPointerUp={gridEnd} onPointerCancel={gridEnd} onLostPointerCapture={gridEnd}
                onContextMenu={event => { if (!emptyGrid(event.target)) return; event.preventDefault(); cancelHold(); openAddMenu({ x: event.clientX, y: event.clientY }); }}>
                <div className="routing-canvas-frame" style={{ width: width * zoom, height: height * zoom }}>
                    <div ref={canvas} className="routing-canvas" style={{ width, height, transform: `scale(${zoom})`, backgroundSize: `${spacing}px ${spacing}px` }}>
                        <svg className="routing-wires" width={width} height={height} aria-label="Audio connections">
                            {edges.map((e, i) => {
                                const route = cableRoutes[i];
                                return <g key={`${str(e.from)}:${str(e.to)}`}><path style={{ stroke: cableColors[i] }} d={route.path} />
                                    <line className="routing-label-leader" style={{ stroke: cableColors[i] }} x1={route.labelAnchor.x} y1={route.labelAnchor.y} x2={route.label.x} y2={route.label.y} /></g>;
                            })}
                            {wire && (() => {
                                const start = portPoint(wire.start), end = wire.target ? portPoint(wire.target) : wire.point;
                                const a = wire.start.direction === "out" ? start : end, b = wire.start.direction === "out" ? end : start;
                                return <path className={`routing-wire-preview ${wire.target ? "valid" : ""}`} d={`M ${a.x} ${a.y} C ${a.x + 40} ${a.y}, ${b.x - 40} ${b.y}, ${b.x} ${b.y}`} />;
                            })()}
                        </svg>
                        {edges.map((edge, i) => <button key={`label:${str(edge.from)}:${str(edge.to)}`} className="routing-connection-number"
                            style={{ left: cableRoutes[i].label.x, top: cableRoutes[i].label.y, color: cableColors[i] }}
                            disabled={locked || routingBusy} aria-label={`Remove connection ${i + 1}: ${str(nodes.find(n => n.id === edge.from)?.name)} to ${str(nodes.find(n => n.id === edge.to)?.name)}`}
                            onClick={() => setDeleteEdge({ from: str(edge.from), to: str(edge.to) })}>{i + 1}<span className="routing-connection-remove-hint" aria-hidden="true">−</span></button>)}
                        {nodes.map(node => {
                            const id = str(node.id), p = point(id), endpoint = id === "input" || id === "output";
                            const incoming = edges.some(e => str(e.to) === id), outgoing = edges.some(e => str(e.from) === id);
                            const hasInput = num(obj(node.plugin).audioInputs, 1) > 0;
                            const hasOutput = num(obj(node.plugin).audioOutputs, 1) > 0;
                            return <div key={id} className={`routing-block ${selected === id ? "selected" : ""} ${newBlocks.has(id) ? "new-block" : ""} ${!endpoint && !incoming && !outgoing ? "disconnected" : ""}`}
                                onPointerDownCapture={() => acknowledge(id)} onClickCapture={() => acknowledge(id)}
                                style={{ left: p.x, top: p.y }}>
                                <div className="routing-block-top">
                                <button className="routing-block-heading" title={str(node.name)} disabled={locked}
                                    onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id, x: e.clientX, y: e.clientY, start: p }; setSelected(id); }}
                                    onPointerMove={e => { const d = drag.current; if (!d || d.id !== id) return;
                                        const wanted = { x: align(d.start.x + (e.clientX - d.x) / zoom), y: align(d.start.y + (e.clientY - d.y) / zoom) };
                                        const safe = freeRoutingPoint(wanted, spacedNodes.filter(n => n.id !== id), snap ? spacing : 0);
                                        const next = { ...positionsRef.current, [id]: safe };
                                        positionsRef.current = next; setPositions(next); }}
                                    onPointerUp={() => { if (!drag.current) return; drag.current = null; commit({ ...graphRef.current, positions: positionsRef.current }); }}
                                    onPointerCancel={() => { drag.current = null; setPositions(obj(graphRef.current.positions)); }}>
                                    <span>⠿</span> <span className="routing-block-name">{str(node.name, "Effect")}</span>
                                    {endpoint && <SignalLight peak={num(meters[id === "input" ? "inputPeak" : "outputPeak"])} />}</button>
                                {!endpoint && <button className="routing-bypass" aria-label={`${bool(node.enabled, true) ? "Bypass" : "Enable"} ${str(node.name, "block")}`}
                                        title={bool(node.enabled, true) ? "Active — tap to bypass" : "Bypassed — tap to enable"}
                                        aria-pressed={bool(node.enabled, true)} disabled={locked || routingBusy}
                                        onClick={() => void (str(node.kind) === "mixer" ? runStructure : run)(() => client.request("chain/enable", { slotId: id, enabled: !bool(node.enabled, true) }))}>
                                        <span className={`routing-led${bool(node.enabled, true) ? " on" : " bypassed"}`} />
                                    </button>}
                                </div>
                                <button className="routing-block-body"
                                    onPointerDown={() => { suppressPortClickUntil.current = 0; }}
                                    onClick={event => {
                                        if (event.detail !== 0 && performance.now() < suppressPortClickUntil.current) return;
                                        edit(id);
                                    }}>
                                    <span>{endpoint ? "LEVEL & SETTINGS" : str(node.kind) === "mixer" ? "GRAPHICAL / SLIDERS" : str(obj(node.plugin).category, "PLUGIN CONTROLS")}</span>
                                    {!endpoint && <small>{bool(node.missing) ? "PLUGIN MISSING" : !incoming && hasInput ? "NO AUDIO INPUT" : !hasOutput ? "INPUT MONITOR" : !outgoing ? "NO AUDIO OUTPUT" : "CONNECTED"}</small>}
                                </button>
                                <div className="routing-ports">
                                    {id !== "input" && hasInput ? <button className={`btn ${wire?.target?.id === id && wire.target.direction === "in" ? "routing-port-target" : ""}`} data-routing-port="in" data-block-id={id}
                                        disabled={locked || (wireMode === "tap" && !source)} {...wireEvents(id, "in")}>IN{portColors(id, "in")}</button> : <span />}
                                    {!endpoint ? <button className="btn routing-block-remove" disabled={locked || routingBusy} aria-label={`Remove ${str(node.name, "block")}`} onClick={() => setDeleteId(id)}>−</button>
                                        : id === "output" ? <OutputLoad meters={meters} connected={client.snapshot.connected} /> : <span />}
                                    {id !== "output" && hasOutput && <button className={`btn ${source === id ? "btn-active" : ""} ${wire?.target?.id === id && wire.target.direction === "out" ? "routing-port-target" : ""}`} data-routing-port="out" data-block-id={id}
                                        disabled={locked} {...wireEvents(id, "out")}>OUT{portColors(id, "out")}</button>}
                                </div>
                            </div>;
                        })}
                    </div>
                </div>
            </div>
        </>}
        <PluginBrowser sessionKey={`routing:${presetId}`} open={browser} catalog={catalog} title="ADD PLUGIN" actionLabel="ADD BLOCK" warnMixerCompatibility onCancel={() => setBrowser(false)}
            onInstallToob={async () => {
                if (locked || sending.current || pending.current) throw new Error("Wait for the current preset operation to finish, then try again.");
                await client.request("plugins/github/install", { id: "toobamp" });
                await client.request("plugins/rescan");
            }}
            onChoose={uri => { setBrowser(false); if (locked || sending.current || pending.current) return; void runStructure(() => client.request("chain/add", { uri, layout: additionLayout() })); }} />
    </div>;
}

function SignalLight({ peak }: { peak: number }) {
    const level = Number.isFinite(peak) ? Math.max(0, peak) : 0;
    const tone = level <= 0.00001 ? "" : level >= 1 ? " clip" : level >= 0.25 ? " hot" : " on";
    return <span className="routing-signal" aria-label={`Signal level ${peakDb(level)}`}>
        <span className={`routing-led${tone}`} aria-hidden="true" /><small>{peakDb(level)}</small>
    </span>;
}

function OutputLoad({ meters, connected }: { meters: JsonObject; connected: boolean }) {
    const audio = connected && bool(meters.running) && typeof meters.dspLoad === "number" && Number.isFinite(meters.dspLoad)
        ? Math.max(0, meters.dspLoad) : null;
    const cpu = connected && bool(meters.engineCpuLoadAvailable) && typeof meters.engineCpuLoad === "number" && Number.isFinite(meters.engineCpuLoad)
        ? Math.max(0, meters.engineCpuLoad) : null;
    const percentage = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)}%`;
    const tone = audio === null ? "" : audio >= .9 ? " critical" : audio >= .7 ? " warning" : " normal";
    return <div className={`routing-output-load${tone}`}
        title="AUDIO: share of the audio buffer deadline used. CPU: Pi-MFX engine usage across all cores, not total Pi usage. High AUDIO can cause dropouts even with low CPU."
        aria-label={`Audio deadline load ${percentage(audio)}; engine CPU ${percentage(cpu)}`}>
        <span className="routing-output-audio">AUDIO <strong>{percentage(audio)}</strong></span>
        <span className="routing-output-cpu">CPU <strong>{percentage(cpu)}</strong></span>
        <span className="routing-output-load-track" aria-hidden="true"><span style={{ width: `${audio === null ? 0 : Math.min(100, audio * 100)}%` }} /></span>
    </div>;
}
