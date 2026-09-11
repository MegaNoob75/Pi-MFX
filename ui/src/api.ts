import { useEffect, useMemo, useState } from "react";
import { arr, bool, isObj, num, obj, objects, str, type Json, type JsonObject } from "./json";

export interface EngineSnapshot {
    connected: boolean;
    lastError: string;
    state: JsonObject;
    catalog: JsonObject;
    library: JsonObject;
    meters: JsonObject;
}

const emptySnapshot = (): EngineSnapshot => ({
    connected: false,
    lastError: "",
    state: {},
    catalog: {},
    library: {},
    meters: {}
});

function websocketUrl(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
}

export class EngineClient {
    private socket: WebSocket | undefined;
    private reconnectTimer: number | undefined;
    private closed = false;
    private listeners = new Set<(snapshot: EngineSnapshot) => void>();
    snapshot: EngineSnapshot = emptySnapshot();

    start(): void {
        this.closed = false;
        this.connect();
    }

    stop(): void {
        this.closed = true;
        if (this.reconnectTimer !== undefined) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        this.socket?.close();
        this.socket = undefined;
    }

    subscribe(listener: (snapshot: EngineSnapshot) => void): () => void {
        this.listeners.add(listener);
        listener(this.snapshot);
        return () => {
            this.listeners.delete(listener);
        };
    }

    async request(command: string, payload: JsonObject = {}): Promise<JsonObject> {
        const response = await fetch(`/api/${command}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const json: unknown = await response.json();
        if (!isObj(json as Json)) {
            throw new Error(`${command}: the engine did not return JSON`);
        }
        const body = json as JsonObject;
        if (!bool(body.ok, response.ok)) {
            throw new Error(str(body.error, `${command} failed`));
        }
        this.ingest(body);
        // #region agent log
        if (command === "preset/select" || command === "snapshot/select" || command === "snapshot/capture"
            || command === "preset/restoreLive" || command === "controller/value") {
            const interesting = command !== "controller/value" || num(payload.value) >= 0.95 || num(payload.value) <= 0.05;
            if (interesting) {
                fetch("http://127.0.0.1:7671/ingest/50e56e7c-9d0c-4ac2-8675-d5943d42b03b", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4847b9" }, body: JSON.stringify({ sessionId: "4847b9", location: "api.ts:request", message: "engine request", data: { command, payload, bound: boundParamDebug(this.snapshot.state) }, timestamp: Date.now(), hypothesisId: command === "controller/value" ? "H1" : "H2" }) }).catch(() => undefined);
            }
        }
        // #endregion
        return body;
    }

    private connect(): void {
        if (this.closed) {
            return;
        }
        const socket = new WebSocket(websocketUrl());
        this.socket = socket;
        socket.onopen = () => {
            this.patch({ connected: true, lastError: "" });
        };
        socket.onmessage = (event) => {
            try {
                const parsed: unknown = JSON.parse(String(event.data));
                if (isObj(parsed as Json)) {
                    this.ingest(parsed as JsonObject);
                }
            } catch {
                // ignore a single bad frame
            }
        };
        socket.onerror = () => {
            this.patch({ lastError: "lost contact with the engine" });
        };
        socket.onclose = () => {
            this.patch({ connected: false });
            if (!this.closed) {
                this.reconnectTimer = window.setTimeout(() => this.connect(), 750);
            }
        };
    }

    private ingest(message: JsonObject): void {
        const type = str(message.type);
        if (type === "state") {
            this.patch({ state: message, lastError: str(message.audioError) });
            return;
        }
        if (type === "catalog") {
            this.patch({ catalog: message });
            return;
        }
        if (type === "library") {
            this.patch({ library: message });
            return;
        }
        if (type === "meters") {
            this.patch({ meters: message });
            return;
        }
        if (type === "performance") {
            const nextState: JsonObject = {
                ...this.snapshot.state,
                activeBankId: message.activeBankId ?? this.snapshot.state.activeBankId,
                activePresetId: message.activePresetId ?? this.snapshot.state.activePresetId,
                bypassAll: message.bypassAll ?? this.snapshot.state.bypassAll,
                snapshotMode: message.snapshotMode ?? this.snapshot.state.snapshotMode,
                presetReloadCount: message.presetReloadCount ?? this.snapshot.state.presetReloadCount,
                tempo: message.tempo ?? this.snapshot.state.tempo,
                controlPositions: message.controlPositions ?? this.snapshot.state.controlPositions
            };
            if (typeof message.activeSnapshot === "number") {
                const banks = arr(nextState.banks).map((bank) => {
                    if (!isObj(bank) || str(bank.id) !== str(nextState.activeBankId)) {
                        return bank;
                    }
                    return {
                        ...bank,
                        presets: arr(bank.presets).map((preset) => {
                            if (!isObj(preset) || str(preset.id) !== str(nextState.activePresetId)) {
                                return preset;
                            }
                            return { ...preset, activeSnapshot: message.activeSnapshot };
                        })
                    };
                });
                nextState.banks = banks;
            }
            const liveSlots = objects(message.slots);
            if (liveSlots.length > 0) {
                nextState.chain = arr(this.snapshot.state.chain).map((slot) => {
                    if (!isObj(slot)) {
                        return slot;
                    }
                    const live = liveSlots.find((item) => str(item.id) === str(slot.id));
                    return live
                        ? { ...slot, enabled: live.enabled ?? slot.enabled, state: live.state ?? slot.state }
                        : slot;
                });
            }
            this.patch({ state: nextState });
            // #region agent log
            logBoundIfChanged(nextState, "api.ts:performance");
            // #endregion
        }
    }

    private patch(partial: Partial<EngineSnapshot>): void {
        this.snapshot = { ...this.snapshot, ...partial };
        for (const listener of this.listeners) {
            listener(this.snapshot);
        }
    }
}

export function useEngine(): EngineSnapshot & { client: EngineClient } {
    const client = useMemo(() => new EngineClient(), []);
    const [snapshot, setSnapshot] = useState(client.snapshot);

    useEffect(() => {
        client.start();
        const unsubscribe = client.subscribe(setSnapshot);
        return () => {
            unsubscribe();
            client.stop();
        };
    }, [client]);

    return { client, ...snapshot };
}

export function findBank(state: JsonObject, bankId = str(state.activeBankId)): JsonObject | undefined {
    return arr(state.banks).find((bank) => isObj(bank) && str(bank.id) === bankId) as JsonObject | undefined;
}

// #region agent log
function boundParamDebug(state: JsonObject) {
    const preset = findPreset(state);
    const bindings = objects(obj(preset).parameterBindings).filter((item) => str(item.action) === "setParameter");
    const positions = obj(state.controlPositions);
    const liveChain = objects(state.chain);
    const storedChain = objects(obj(preset).chain);
    return {
        activeSnapshot: num(obj(preset).activeSnapshot, -1),
        rememberedSlot: num(obj(preset).rememberedSnapshotSlot, -1),
        rememberedOn: bool(obj(preset).rememberedSnapshotEnabled),
        snapshotMode: bool(state.snapshotMode),
        binds: bindings.map((bind) => {
            const symbol = str(bind.portSymbol);
            const live = liveChain.find((slot) => str(slot.id) === str(bind.slotId));
            const stored = storedChain.find((slot) => str(slot.id) === str(bind.slotId));
            return {
                controlId: str(bind.controlId),
                symbol,
                live: live ? controlValue(live, symbol, Number.NaN) : Number.NaN,
                stored: stored ? controlValue(stored, symbol, Number.NaN) : Number.NaN,
                pot: num(positions[str(bind.controlId)], Number.NaN)
            };
        })
    };
}

let lastBoundSig = "";
function logBoundIfChanged(state: JsonObject, location: string) {
    const bound = boundParamDebug(state);
    if (bound.binds.length === 0) {
        return;
    }
    const sig = JSON.stringify(bound);
    if (sig === lastBoundSig) {
        return;
    }
    lastBoundSig = sig;
    fetch("http://127.0.0.1:7671/ingest/50e56e7c-9d0c-4ac2-8675-d5943d42b03b", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4847b9" }, body: JSON.stringify({ sessionId: "4847b9", location, message: "bound live vs stored", data: bound, timestamp: Date.now(), hypothesisId: "H3" }) }).catch(() => undefined);
}
// #endregion

export function findPreset(state: JsonObject): JsonObject | undefined {
    const bank = findBank(state);
    if (!bank) {
        return undefined;
    }
    const presetId = str(state.activePresetId);
    return arr(bank.presets).find((preset) => isObj(preset) && str(preset.id) === presetId) as
        | JsonObject
        | undefined;
}

export function peakDb(linear: number): string {
    if (linear <= 0.00001) {
        return "-inf";
    }
    return `${(20 * Math.log10(linear)).toFixed(1)} dB`;
}

export function formatMs(value: number): string {
    if (!Number.isFinite(value)) {
        return "—";
    }
    return `${value.toFixed(value >= 10 ? 1 : 2)} ms`;
}

export function controlValue(slot: JsonObject, symbol: string, fallback: number): number {
    const controls = obj(obj(slot.state).controls);
    return num(controls[symbol], fallback);
}

export function isAnalogKind(kind: string): boolean {
    return kind === "pot" || kind === "slider" || kind === "expression";
}

export function normalizeControlKind(kind: string): string {
    return !kind || kind === "switch" ? "momentary" : kind;
}

export function isLatchingKind(kind: string): boolean {
    return normalizeControlKind(kind) === "latching";
}

export function clampUnit(value: number): number {
    return Math.min(1, Math.max(0, value));
}
