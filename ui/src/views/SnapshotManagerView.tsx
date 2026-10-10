import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "./ConfirmDialog";
import type { EngineSnapshot } from "../api";
import { findPreset } from "../api";
import { num, obj, str, objects } from "../json";
import { snapshotAtSlot, snapshotLayoutSlots } from "../layout";
import { askText } from "../keyboard/ask";
import { MarqueeText } from "./MarqueeText";

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
    const slots = snapshotLayoutSlots(obj(obj(state.controller).performanceLayout));
    const [message, setMessage] = useState("");
    const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; slot: number } | null>(null);

    useEffect(() => {
        if (!message) {
            return;
        }
        const timer = window.setTimeout(() => setMessage(""), 1800);
        return () => window.clearTimeout(timer);
    }, [message]);

    const show = (text: string) => setMessage(text);

    const renameSnapshot = (snapshotId: string, currentName: string) => {
        void askText("Rename Snapshot", currentName).then((value) => {
            const name = value?.trim();
            if (name) {
                void run(() => client.request("snapshot/rename", { snapshotId, name }))
                    .then(() => show("SNAPSHOT RENAMED"));
            }
        });
    };

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
                <div className="snapshot-manager-preset">
                    <div className="field-label">SNAPSHOT MANAGER</div>
                    <div className="snapshot-preset-name">
                        <MarqueeText text={str(obj(preset).name, "Current Preset")} align="left" fontWeight={900} />
                    </div>
                </div>
                <div className="muted snapshot-help">
                    Capture stores the live sound without overwriting the saved preset.
                    Recalling a snapshot only moves parameters — the chain stays put.
                </div>
            </div>
            <div className="snapshot-notice">
                Create or update captures the current live sound. Recall a captured slot to apply it,
                or recall the active slot again to return to the saved preset and clear snapshot memory.
            </div>
            <div className="snapshot-grid">
                {slots.map((slot) => {
                    const snapshot = snapshotAtSlot(snapshots, slot);
                    const selected = Boolean(snapshot) && active === slot;
                    const color = str(obj(snapshot).color, DEFAULT_SNAPSHOT_COLORS[slot % DEFAULT_SNAPSHOT_COLORS.length] ?? "#22d3ee");
                    return (
                        <div key={snapshot ? str(snapshot.id) : `empty-${slot}`} className={`snapshot-card${selected ? " selected" : ""}`}>
                            <div className="snapshot-card-top">
                                <span>SNAPSHOT {slot + 1}</span>
                                <span className={`snapshot-led${selected ? " on" : ""}`} />
                            </div>
                            {snapshot ? (
                                <>
                                    <div className="snapshot-card-name">
                                        <MarqueeText text={str(snapshot.name, `Snapshot ${slot + 1}`)} align="left" fontWeight={900} />
                                    </div>
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
                                            void run(() => client.request("snapshot/select", { snapshotId: str(snapshot.id) }))
                                                .then(() => show(selected
                                                    ? "SNAPSHOT INACTIVE"
                                                    : `${str(snapshot.name, `SNAPSHOT ${slot + 1}`)} ACTIVE`));
                                        }}>RECALL</button>
                                        <button type="button" className="btn" onClick={() => {
                                            void run(() => client.request("snapshot/update", { snapshotId: str(snapshot.id) }))
                                                .then(() => show(`${str(snapshot.name, `SNAPSHOT ${slot + 1}`)} UPDATED`));
                                        }}>UPDATE</button>
                                        <button type="button" className="btn" onClick={() => renameSnapshot(
                                            str(snapshot.id), str(snapshot.name, `Snapshot ${slot + 1}`)
                                        )}>RENAME</button>
                                        <button type="button" className="btn btn-danger" onClick={() => {
                                            setPendingDelete({
                                                id: str(snapshot.id),
                                                name: str(snapshot.name, `Snapshot ${slot + 1}`),
                                                slot
                                            });
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
                                                    name: `Snapshot ${slot + 1}`,
                                                    slot
                                                });
                                                const snapshotId = str(result.snapshotId);
                                                const fallback = DEFAULT_SNAPSHOT_COLORS[slot % DEFAULT_SNAPSHOT_COLORS.length];
                                                if (snapshotId && fallback) {
                                                    await client.request("snapshot/color", {
                                                        snapshotId,
                                                        color: fallback
                                                    });
                                                }
                                            }).then(() => show(`SNAPSHOT ${slot + 1} CREATED`));
                                        }}>CREATE SNAPSHOT</button>
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>
            {pendingDelete && <ConfirmDialog title="DELETE SNAPSHOT?" body={pendingDelete.name}
                confirmLabel="DELETE" danger onCancel={() => setPendingDelete(null)} onConfirm={() => {
                    const pending = pendingDelete;
                    setPendingDelete(null);
                    void run(() => client.request("snapshot/delete", { snapshotId: pending.id }))
                        .then(() => show(`SNAPSHOT ${pending.slot + 1} DELETED`));
                }} />}
        </div>
    );
}
