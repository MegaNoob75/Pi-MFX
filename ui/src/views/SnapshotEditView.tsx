import { useEffect, useRef } from "react";
import type { EngineSnapshot } from "../api";
import { findPreset } from "../api";
import { num, obj, str, objects } from "../json";
import { EditorView } from "./EditorView";

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
    const preset = findPreset(engine.state);
    const snapshots = objects(obj(preset).snapshots);
    const snapshot = snapshots.find((item) => str(item.id) === snapshotId);
    const originalIndex = useRef(num(obj(preset).activeSnapshot, -1));
    const originalId = useRef(str(objects(obj(preset).snapshots)[originalIndex.current]?.id));
    const started = useRef(false);
    const saveStarted = useRef(0);
    const cancelStarted = useRef(0);

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
        void run(() => engine.client.request("snapshot/update", { snapshotId })).then(onComplete);
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
        <div className="mfx-screen">
            <div className="mfx-screen-intro">
                <div>
                    <div className="mfx-screen-intro-title">{str(obj(snapshot).name, "SNAPSHOT")}</div>
                    <div className="mfx-screen-intro-sub">
                        The chain stays put. Change the sound, then save it back into this snapshot.
                        Cancel restores what was playing before you opened this screen.
                    </div>
                </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                <EditorView engine={engine} run={run} lockChain />
            </div>
        </div>
    );
}
