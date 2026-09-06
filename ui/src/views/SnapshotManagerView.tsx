import { askText } from "../keyboard/ask";
import type { EngineSnapshot } from "../api";
import { findPreset } from "../api";
import { num, obj, str, objects } from "../json";

export function SnapshotManagerView({
    engine,
    run,
    onEdit
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    onEdit?: (snapshotId: string) => void;
}) {
    const { client, state } = engine;
    const preset = findPreset(state);
    const snapshots = objects(obj(preset).snapshots);
    const active = num(obj(preset).activeSnapshot, -1);

    return (
        <div className="page-scroll stack">
            <div className="panel stack">
                <h2>SNAPSHOTS</h2>
                <div className="muted">
                    Six sound scenes on the current preset. Recalling a snapshot only moves
                    parameters — the chain stays put. Capture stores the live sound without
                    overwriting the saved preset.
                </div>
                <div className="row">
                    <button type="button" className="btn btn-accent" onClick={() => {
                        void askText("Snapshot name", `Snap ${snapshots.length + 1}`).then((name) => {
                            if (name?.trim()) {
                                void run(() => client.request("snapshot/capture", { name: name.trim() }));
                            }
                        });
                    }}>CAPTURE</button>
                    <button
                        type="button"
                        className={`btn ${engine.state.snapshotMode ? "btn-active" : ""}`}
                        onClick={() => void run(() => client.request("snapshot/mode", {
                            enabled: !engine.state.snapshotMode
                        }))}
                    >
                        SNAPSHOT MODE
                    </button>
                </div>
            </div>
            {snapshots.length === 0 && (
                <div className="panel muted">No snapshots yet. Capture the sound that is playing now.</div>
            )}
            {snapshots.map((snapshot, index) => (
                <div key={str(snapshot.id)} className={`list-item${index === active ? " selected" : ""}`} style={{ flexWrap: "wrap" }}>
                    <button type="button" className="btn" onClick={() => {
                        void askText("Snapshot colour (hex)", str(snapshot.color, "#22d3ee")).then((color) => {
                            if (color) {
                                void run(() => client.request("snapshot/color", {
                                    snapshotId: str(snapshot.id),
                                    color
                                }));
                            }
                        });
                    }}>●</button>
                    <strong style={{ flex: 1 }}>{str(snapshot.name, `SNAP ${index + 1}`)}</strong>
                    <button type="button" className="btn btn-accent" onClick={() => void run(() => client.request("snapshot/select", { snapshotId: str(snapshot.id) }))}>
                        RECALL
                    </button>
                    {onEdit && (
                        <button type="button" className="btn" onClick={() => onEdit(str(snapshot.id))}>EDIT</button>
                    )}
                    <button type="button" className="btn" onClick={() => void run(() => client.request("snapshot/update", { snapshotId: str(snapshot.id) }))}>
                        UPDATE
                    </button>
                    <button type="button" className="btn" onClick={() => {
                        void askText("Rename snapshot", str(snapshot.name)).then((name) => {
                            if (name) {
                                void run(() => client.request("snapshot/rename", {
                                    snapshotId: str(snapshot.id),
                                    name
                                }));
                            }
                        });
                    }}>RENAME</button>
                    <button type="button" className="btn btn-danger" onClick={() => {
                        if (window.confirm(`Delete snapshot “${str(snapshot.name)}”?`)) {
                            void run(() => client.request("snapshot/delete", { snapshotId: str(snapshot.id) }));
                        }
                    }}>DELETE</button>
                </div>
            ))}
        </div>
    );
}
