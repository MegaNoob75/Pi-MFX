import { useEffect, useRef } from "react";
import type { EngineSnapshot } from "../api";
import { findPreset } from "../api";
import { num, obj, str, objects } from "../json";
import { EditorView } from "./EditorView";

export function SnapshotEditView({
    engine,
    run,
    snapshotId,
    onComplete
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    snapshotId: string;
    onComplete: () => void;
}) {
    const preset = findPreset(engine.state);
    const snapshots = objects(obj(preset).snapshots);
    const snapshot = snapshots.find((item) => str(item.id) === snapshotId);
    const originalIndex = useRef(num(obj(preset).activeSnapshot, -1));
    const originalId = useRef(str(objects(obj(preset).snapshots)[originalIndex.current]?.id));
    const started = useRef(false);

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

    return (
        <div className="page-scroll stack">
            <div className="panel stack">
                <h2>EDIT SNAPSHOT</h2>
                <div className="muted">
                    The chain stays put. Change the sound, then save it back into
                    “{str(obj(snapshot).name, "this snapshot")}”. Cancel restores what was
                    playing before you opened this screen.
                </div>
                <div className="row">
                    <button type="button" className="btn" onClick={cancel}>CANCEL</button>
                    <button
                        type="button"
                        className="btn btn-accent"
                        onClick={() => {
                            void run(() => engine.client.request("snapshot/update", { snapshotId })).then(onComplete);
                        }}
                    >
                        SAVE SNAPSHOT
                    </button>
                </div>
            </div>
            <EditorView engine={engine} run={run} lockChain />
        </div>
    );
}
