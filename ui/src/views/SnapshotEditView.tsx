import { useEffect, useRef, useState } from "react";
import type { EngineSnapshot } from "../api";
import { findPreset } from "../api";
import { bool, num, obj, str, objects } from "../json";
import { EffectControls } from "./EditorView";

export function SnapshotEditView({
    engine,
    run,
    snapshotId,
    saveRequest = 0,
    cancelRequest = 0,
    onComplete
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    snapshotId: string;
    saveRequest?: number;
    cancelRequest?: number;
    onComplete: () => void;
}) {
    const { client, state, library } = engine;
    const preset = findPreset(state);
    const chain = objects(state.chain);
    const snapshots = objects(obj(preset).snapshots);
    const snapshot = snapshots.find((item) => str(item.id) === snapshotId);
    const snapshotIndex = Math.max(0, snapshots.findIndex((item) => str(item.id) === snapshotId));
    const originalIndex = useRef(num(obj(preset).activeSnapshot, -1));
    const originalId = useRef(str(objects(obj(preset).snapshots)[originalIndex.current]?.id));
    const started = useRef(false);
    const saveStarted = useRef(0);
    const cancelStarted = useRef(0);
    const [name, setName] = useState(str(obj(snapshot).name, `Snapshot ${snapshotIndex + 1}`));
    const [selectedId, setSelectedId] = useState(str(obj(chain[0]).id));

    const selected = chain.find((slot) => str(slot.id) === selectedId) ?? chain[0];
    const plugin = obj(obj(selected).plugin);
    const ports = objects(plugin.ports).filter((port) => str(port.kind) === "control" && bool(port.input, true));
    const properties = objects(plugin.properties);

    useEffect(() => {
        if (started.current || !snapshotId) {
            return;
        }
        started.current = true;
        void run(() => engine.client.request("snapshot/select", { snapshotId }));
    }, [engine.client, run, snapshotId]);

    const cancel = () => {
        void run(async () => {
            if (originalId.current) {
                await engine.client.request("snapshot/select", { snapshotId: originalId.current });
            } else {
                await engine.client.request("preset/restoreLive");
            }
        }).finally(onComplete);
    };

    const save = () => {
        void run(async () => {
            if (name.trim() && name.trim() !== str(obj(snapshot).name)) {
                await engine.client.request("snapshot/rename", { snapshotId, name: name.trim() });
            }
            await engine.client.request("snapshot/update", { snapshotId });
        }).then(onComplete);
    };

    useEffect(() => {
        if (saveRequest > 0 && saveRequest !== saveStarted.current) {
            saveStarted.current = saveRequest;
            save();
        }
    }, [saveRequest]);

    useEffect(() => {
        if (cancelRequest > 0 && cancelRequest !== cancelStarted.current) {
            cancelStarted.current = cancelRequest;
            cancel();
        }
    }, [cancelRequest]);

    return (
        <div className="snapshot-edit">
            <div className="snapshot-edit-header">
                <div>
                    <div className="snapshot-edit-kicker">SNAPSHOT {snapshotIndex + 1} • LOCKED PRESET CHAIN</div>
                    <input
                        className="input"
                        aria-label="Snapshot name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        style={{ marginTop: 5, fontWeight: 900 }}
                    />
                </div>
                <div className="muted" style={{ textAlign: "right", fontSize: "0.72rem" }}>
                    Structure stays put. Change the sound, then SAVE SNAPSHOT.
                </div>
            </div>
            <div className="snapshot-edit-body">
                <div className="snapshot-edit-chain">
                    <div className="field-label">PRESET CHAIN — STRUCTURE LOCKED</div>
                    {chain.map((slot) => {
                        const info = obj(slot.plugin);
                        const on = bool(slot.enabled, true);
                        const active = str(slot.id) === str(obj(selected).id);
                        return (
                            <div key={str(slot.id)} className="split-row-drag" style={{ marginBottom: 7 }}>
                                <button
                                    type="button"
                                    className={`split-row${active ? " selected" : ""}`}
                                    style={{ flex: 1 }}
                                    onClick={() => setSelectedId(str(slot.id))}
                                >
                                    {str(slot.name) || str(info.name, "Effect")}
                                </button>
                                <button
                                    type="button"
                                    className={`btn ${on ? "btn-active" : ""}`}
                                    onClick={() => void run(() => client.request("chain/enable", {
                                        slotId: str(slot.id),
                                        enabled: !on
                                    }))}
                                >
                                    {on ? "ON" : "BYPASS"}
                                </button>
                            </div>
                        );
                    })}
                </div>
                <div className="snapshot-edit-controls page-scroll">
                    {selected && (
                        <EffectControls
                            selected={selected}
                            ports={ports}
                            properties={properties}
                            plugin={plugin}
                            models={objects(library.models)}
                            irs={objects(library.impulseResponses)}
                            run={run}
                            client={client}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
