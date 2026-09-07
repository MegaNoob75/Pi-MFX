import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { EngineSnapshot } from "../api";
import { findPreset } from "../api";
import { num, obj, str, objects } from "../json";

const SNAPSHOT_SLOTS = 6;
const DEFAULT_SNAPSHOT_COLORS = [
    "#22C55E",
    "#06B6D4",
    "#8B5CF6",
    "#F59E0B",
    "#EC4899",
    "#EF4444"
];

export function SnapshotManagerView({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    onEdit?: (snapshotId: string) => void;
}) {
    const { client, state } = engine;
    const preset = findPreset(state);
    const snapshots = objects(obj(preset).snapshots);
    const active = num(obj(preset).activeSnapshot, -1);
    const [renameIndex, setRenameIndex] = useState<number | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (!message) {
            return;
        }
        const timer = window.setTimeout(() => setMessage(""), 1800);
        return () => window.clearTimeout(timer);
    }, [message]);

    const show = (text: string) => setMessage(text);

    return (
        <div className="mfx-screen snapshot-manager">
            {message && createPortal(
                <div
                    className="toast toast-ok"
                    role="status"
                    aria-live="polite"
                    onClick={() => setMessage("")}
                >
                    {message}
                </div>,
                document.body
            )}
            <div className="snapshot-manager-header">
                <div>
                    <div className="field-label">SNAPSHOT MANAGER</div>
                    <div className="snapshot-preset-name">{str(obj(preset).name, "Current Preset")}</div>
                </div>
                <div className="muted snapshot-help">
                    Capture stores the live sound without overwriting the saved preset.
                    Recalling a snapshot only moves parameters — the chain stays put.
                </div>
            </div>
            <div className="snapshot-notice">
                Create/update captures the current live sound. Recall, rename, colour
                and delete follow the same lifecycle as MultiFX.
            </div>
            <div className="snapshot-grid" style={{ gridTemplateRows: "repeat(2, minmax(0, 1fr))" }}>
                {Array.from({ length: SNAPSHOT_SLOTS }, (_, index) => {
                    const snapshot = snapshots[index];
                    const selected = snapshot && index === active;
                    const color = str(obj(snapshot).color, DEFAULT_SNAPSHOT_COLORS[index] ?? "#22d3ee");
                    return (
                        <div key={snapshot ? str(snapshot.id) : `empty-${index}`} className={`snapshot-card${selected ? " selected" : ""}`}>
                            <div className="snapshot-card-top">
                                <span>SNAPSHOT {index + 1}</span>
                                <span className={`snapshot-led${selected ? " on" : ""}`} />
                            </div>
                            {snapshot ? (
                                <>
                                    {renameIndex === index ? (
                                        <div className="row" style={{ marginTop: 10 }}>
                                            <input
                                                className="input"
                                                autoFocus
                                                value={renameValue}
                                                onChange={(event) => setRenameValue(event.target.value)}
                                                onKeyDown={(event) => {
                                                    if (event.key === "Enter" && renameValue.trim()) {
                                                        void run(() => client.request("snapshot/rename", {
                                                            snapshotId: str(snapshot.id),
                                                            name: renameValue.trim()
                                                        })).then(() => {
                                                            setRenameIndex(null);
                                                            show("SNAPSHOT RENAMED");
                                                        });
                                                    }
                                                    if (event.key === "Escape") {
                                                        setRenameIndex(null);
                                                    }
                                                }}
                                            />
                                            <button type="button" className="btn" onClick={() => {
                                                if (!renameValue.trim()) {
                                                    return;
                                                }
                                                void run(() => client.request("snapshot/rename", {
                                                    snapshotId: str(snapshot.id),
                                                    name: renameValue.trim()
                                                })).then(() => {
                                                    setRenameIndex(null);
                                                    show("SNAPSHOT RENAMED");
                                                });
                                            }}>SAVE</button>
                                        </div>
                                    ) : (
                                        <div className="snapshot-card-name">{str(snapshot.name, `Snapshot ${index + 1}`)}</div>
                                    )}
                                    <div className="snapshot-card-state">
                                        <label className="snapshot-color">
                                            <input
                                                type="color"
                                                value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#22C55E"}
                                                onChange={(event) => {
                                                    void run(() => client.request("snapshot/color", {
                                                        snapshotId: str(snapshot.id),
                                                        color: event.target.value
                                                    })).then(() => show("SNAPSHOT COLOR SAVED"));
                                                }}
                                            />
                                            <span style={{ background: color }} />
                                        </label>
                                        {selected ? "ACTIVE" : "READY"}
                                    </div>
                                    <div className="snapshot-card-actions">
                                        <button type="button" className="btn btn-accent" onClick={() => {
                                            if (selected) {
                                                void run(() => client.request("preset/restoreLive"))
                                                    .then(() => show("CLEARED • BASE PRESET"));
                                                return;
                                            }
                                            void run(() => client.request("snapshot/select", { snapshotId: str(snapshot.id) }))
                                                .then(() => show(`${str(snapshot.name, `SNAPSHOT ${index + 1}`)} ACTIVE`));
                                        }}>RECALL</button>
                                        <button type="button" className="btn" onClick={() => {
                                            void run(() => client.request("snapshot/update", { snapshotId: str(snapshot.id) }))
                                                .then(() => show(`${str(snapshot.name, `SNAPSHOT ${index + 1}`)} UPDATED`));
                                        }}>UPDATE</button>
                                        <button type="button" className="btn" onClick={() => {
                                            setRenameIndex(index);
                                            setRenameValue(str(snapshot.name, `Snapshot ${index + 1}`));
                                        }}>RENAME</button>
                                        <button type="button" className="btn btn-danger" onClick={() => {
                                            void run(() => client.request("snapshot/delete", { snapshotId: str(snapshot.id) }))
                                                .then(() => show(`SNAPSHOT ${index + 1} DELETED`));
                                        }}>DELETE</button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="snapshot-empty-name">EMPTY</div>
                                    <div className="muted snapshot-empty-help">Capture the current effect state into this slot.</div>
                                    <div style={{ marginTop: "auto" }}>
                                        <button type="button" className="btn btn-accent" style={{ width: "100%" }} onClick={() => {
                                            void run(async () => {
                                                const result = await client.request("snapshot/capture", {
                                                    name: `Snapshot ${index + 1}`
                                                });
                                                const snapshotId = str(result.snapshotId);
                                                if (snapshotId && DEFAULT_SNAPSHOT_COLORS[index]) {
                                                    await client.request("snapshot/color", {
                                                        snapshotId,
                                                        color: DEFAULT_SNAPSHOT_COLORS[index]
                                                    });
                                                }
                                            }).then(() => show(`SNAPSHOT ${index + 1} CREATED`));
                                        }}>CREATE SNAPSHOT</button>
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
