import { useEffect, useMemo, useState } from "react";
import { arr, bool, isObj, num, obj, str, type Json, type JsonObject } from "./json";

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
            this.patch({
                state: {
                    ...this.snapshot.state,
                    activeBankId: message.activeBankId ?? this.snapshot.state.activeBankId,
                    activePresetId: message.activePresetId ?? this.snapshot.state.activePresetId,
                    bypassAll: message.bypassAll ?? this.snapshot.state.bypassAll
                }
            });
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
