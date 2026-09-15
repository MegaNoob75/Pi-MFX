import { useEffect, useMemo, useState } from "react";
import { arr, bool, isObj, num, obj, objects, str, type Json, type JsonObject } from "./json";

export interface EngineSnapshot {
    connected: boolean;
    lastError: string;
    state: JsonObject;
    catalog: JsonObject;
    library: JsonObject;
    meters: JsonObject;
    transport: JsonObject;
    backing: JsonObject;
    looper: JsonObject;
    recorder: JsonObject;
    uiSession: JsonObject;
}

const emptySnapshot = (): EngineSnapshot => ({
    connected: false,
    lastError: "",
    state: {},
    catalog: {},
    library: {},
    meters: {},
    transport: {},
    backing: {},
    looper: {},
    recorder: {},
    uiSession: {}
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
    private meterListeners = new Set<(meters: JsonObject) => void>();
    private navListeners = new Set<(message: JsonObject) => boolean | void>();
    private viewListeners = new Set<(message: JsonObject) => void>();
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

    subscribeMeters(listener: (meters: JsonObject) => void): () => void {
        this.meterListeners.add(listener);
        listener(this.snapshot.meters);
        return () => {
            this.meterListeners.delete(listener);
        };
    }

    subscribeUiNav(listener: (message: JsonObject) => boolean | void): () => void {
        this.navListeners.add(listener);
        return () => {
            this.navListeners.delete(listener);
        };
    }

    claimUiNavigation(): void {
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ command: "ui/focus" }));
        }
    }

    updateUiSession(patch: JsonObject): void {
        if (this.socket?.readyState !== WebSocket.OPEN) {
            return;
        }
        const next = { ...this.snapshot.uiSession, ...patch, type: "uiSession" };
        this.patch({ uiSession: next });
        const payload: JsonObject = { ...next };
        delete payload.type;
        delete payload.owner;
        this.socket.send(JSON.stringify({ command: "ui/session", payload }));
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

    subscribeUiView(listener: (message: JsonObject) => void): () => void {
        this.viewListeners.add(listener);
        return () => this.viewListeners.delete(listener);
    }

    async uploadBackingTrack(file: File, onProgress?: (fraction: number) => void): Promise<JsonObject> {
        if (file.size > 64 * 1024 * 1024) throw new Error("that track is larger than the 64 MB import limit");
        return new Promise((resolve, reject) => {
            const request = new XMLHttpRequest();
            request.open("POST", "/api/backing/import");
            request.setRequestHeader("Content-Type", "application/octet-stream");
            request.setRequestHeader("X-PiMFX-Filename", encodeURIComponent(file.name));
            request.upload.onprogress = (event) => {
                if (event.lengthComputable) onProgress?.(event.loaded / event.total);
            };
            request.onerror = () => reject(new Error("lost contact with the engine during import"));
            request.onload = () => {
                try {
                    const parsed: unknown = JSON.parse(request.responseText);
                    if (!isObj(parsed as Json)) throw new Error("backing-track import returned invalid JSON");
                    const body = parsed as JsonObject;
                    if (request.status < 200 || request.status >= 300 || !bool(body.ok, true)) {
                        throw new Error(str(body.error, "backing-track import failed"));
                    }
                    this.ingest(body);
                    onProgress?.(1);
                    resolve(body);
                } catch (error) {
                    reject(error);
                }
            };
            request.send(file);
        });
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
            this.patch({
                state: message,
                transport: isObj(message.transport as Json) ? message.transport as JsonObject : this.snapshot.transport,
                backing: isObj(message.backing as Json) ? message.backing as JsonObject : this.snapshot.backing,
                looper: isObj(message.looper as Json) ? message.looper as JsonObject : this.snapshot.looper,
                recorder: isObj(message.recorder as Json) ? message.recorder as JsonObject : this.snapshot.recorder,
                lastError: str(message.audioError)
            });
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
            this.snapshot = { ...this.snapshot, meters: message };
            for (const listener of this.meterListeners) {
                listener(message);
            }
            return;
        }
        if (type === "transport") {
            this.patch({ transport: message });
            return;
        }
        if (type === "backing") {
            this.patch({ backing: message });
            return;
        }
        if (type === "looper") {
            this.patch({ looper: message });
            return;
        }
        if (type === "recorder") {
            this.patch({ recorder: message });
            return;
        }
        if (type === "uiNav") {
            if (!bool(message.select)) {
                const raw = Math.trunc(num(message.delta));
                if (raw === 0) {
                    return;
                }
                message.delta = raw > 0 ? 1 : -1;
            }
            for (const listener of this.navListeners) {
                if (listener(message) === true) break;
            }
            return;
        }
        if (type === "uiView") {
            for (const listener of this.viewListeners) listener(message);
            return;
        }
        if (type === "uiSession") {
            this.patch({ uiSession: message });
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

export function useMeters(client: EngineClient): JsonObject {
    const [meters, setMeters] = useState(client.snapshot.meters);

    useEffect(() => client.subscribeMeters(setMeters), [client]);

    return meters;
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

export function isAnalogKind(kind: string): boolean {
    return kind === "pot" || kind === "slider" || kind === "expression";
}

export function isEncoderKind(kind: string): boolean {
    return normalizeControlKind(kind) === "encoder";
}

export function isEncoderPushKind(kind: string): boolean {
    return normalizeControlKind(kind) === "encoderPush";
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
