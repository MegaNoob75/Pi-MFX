import { useState } from "react";
import type { EngineSnapshot } from "../api";
import { arr, bool, num, str, type JsonObject } from "../json";
import { askText } from "../keyboard/ask";
import { ConfirmDialog } from "./ConfirmDialog";

export function LooperView({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const [page, setPage] = useState<"loop" | "options" | "library">("loop");
    const loop = engine.looper;
    const status = str(loop.status, "empty");
    const hasLoop = bool(loop.hasLoop);
    const busy = status === "saving" || status === "loading";
    const [confirmClear, setConfirmClear] = useState(false);
    const [deleteName, setDeleteName] = useState("");
    const savedLoops = arr(loop.savedLoops).map((item) => String(item)).filter(Boolean);
    const recording = status === "recording" || status === "armed";
    const overdubbing = status === "overdubbing";

    const command = (name: string, payload: JsonObject = {}) =>
        run(() => engine.client.request(`looper/${name}`, payload));
    const configure = (patch: JsonObject) => command("settings", {
        quantization: str(loop.quantization, "free"),
        countIn: bool(loop.countIn),
        level: num(loop.level, 1),
        feedback: num(loop.feedback, 1),
        ...patch
    });
    const setCountInBars = (bars: number) => run(async () => {
        const transport = engine.transport;
        await engine.client.request("transport/settings", {
            bpm: num(transport.bpm, 120),
            beatsPerBar: num(transport.beatsPerBar, 4),
            beatUnit: num(transport.beatUnit, 4),
            countInBars: bars,
            metronomeEnabled: bool(transport.metronomeEnabled),
            quantizationEnabled: bool(transport.quantizationEnabled)
        });
        await engine.client.request("looper/settings", {
            quantization: str(loop.quantization, "free"),
            countIn: bars > 0,
            level: num(loop.level, 1),
            feedback: num(loop.feedback, 1)
        });
    });
    const save = async () => {
        const name = await askText("Loop file name", "loop");
        if (name?.trim()) await command("save", { name: name.trim() });
    };
    const renameSaved = async (name: string) => {
        const nextName = await askText("Rename saved loop", name.replace(/\.wav$/i, ""));
        if (nextName?.trim()) await command("rename", { name, nextName: nextName.trim() });
    };

    const duration = num(loop.duration);
    const position = Math.min(duration, num(loop.position));
    const waveform = arr(loop.waveform);
    const statusClass = status === "recording" || status === "armed"
        ? "recording" : status === "overdubbing" ? "overdubbing" : status;

    return (
        <div className="page-scroll looper-view" data-mfx-nav-list="looper">
            <section className={`panel looper-state ${statusClass}`}>
                <div>
                    <span className="muted">STEREO LOOP</span>
                    <strong>{status.toUpperCase()}{bool(loop.muted) ? " · MUTED" : ""}</strong>
                </div>
                <div><span className="muted">POSITION</span><strong>{position.toFixed(1)}s</strong></div>
                <div><span className="muted">LENGTH</span><strong>{duration.toFixed(1)}s</strong></div>
                <div><span className="muted">BEATS</span><strong>{num(loop.beats).toFixed(1)}</strong></div>
                <div><span className="muted">BARS</span><strong>{num(loop.bars).toFixed(1)}</strong></div>
            </section>

            <nav className="looper-tabs" aria-label="Looper pages">
                <button type="button" className={`btn${page === "loop" ? " btn-active" : ""}`}
                    onClick={() => setPage("loop")}>LOOP</button>
                <button type="button" className={`btn${page === "options" ? " btn-active" : ""}`}
                    onClick={() => setPage("options")}>OPTIONS</button>
                <button type="button" className={`btn${page === "library" ? " btn-active" : ""}`}
                    onClick={() => setPage("library")}>LIBRARY ({savedLoops.length})</button>
            </nav>

            {page === "loop" && <section className="panel looper-performance looper-tab-content">
                <div className="looper-waveform" aria-label="Loop waveform">
                    {waveform.length === 0
                        ? <span className="muted">Record a loop to create its waveform.</span>
                        : waveform.map((peak, index) => (
                            <i key={index} style={{ height: `${Math.max(4, Math.min(100, num(peak) * 100))}%` }} />
                        ))}
                </div>
                {str(loop.saveError) && <div className="error-banner">{str(loop.saveError)}</div>}
                <div className="looper-actions">
                    <button type="button" className="btn btn-danger" disabled={(hasLoop && !recording) || busy}
                        onClick={() => void command(recording ? "finish" : "record")}>
                        {recording ? "FINISH + PLAY" : "RECORD"}
                    </button>
                    <button type="button" className="btn btn-accent" disabled={!hasLoop || busy}
                        onClick={() => void command("play")}>PLAY</button>
                    <button type="button" className={`btn looper-overdub${overdubbing ? " btn-active" : ""}`} disabled={!hasLoop || busy}
                        onClick={() => void command("overdub")}>{overdubbing ? "END OVERDUB" : "OVERDUB"}</button>
                    <button type="button" className="btn" disabled={status === "empty"}
                        onClick={() => void command("stop")}>STOP</button>
                    <button type="button" className="btn" disabled={!hasLoop || busy}
                        onClick={() => void command("restart")}>RESTART</button>
                    <button type="button" className={`btn${bool(loop.muted) ? " btn-active" : ""}`} disabled={!hasLoop}
                        onClick={() => void command("mute")}>{bool(loop.muted) ? "UNMUTE" : "MUTE"}</button>
                    <button type="button" className="btn" disabled={!bool(loop.canUndo) || busy}
                        onClick={() => void command("undo")}>UNDO</button>
                    <button type="button" className="btn" disabled={!bool(loop.canRedo) || busy}
                        onClick={() => void command("redo")}>REDO</button>
                    <button type="button" className="btn btn-danger" disabled={!hasLoop || busy}
                        onClick={() => setConfirmClear(true)}>CLEAR</button>
                </div>
                <div className="muted">OVERDUB keeps recording layers until pressed again or stopped. UNDO restores the loop from before the current overdub session.</div>
            </section>}

            {page === "options" && <div className="looper-tab-content looper-options stack">
                <section className="panel looper-settings">
                    <label className="field"><span>QUANTIZE</span>
                        <select value={str(loop.quantization, "free")} onChange={(event) => void configure({ quantization: event.target.value })}>
                            <option value="free">FREE</option>
                            <option value="beat">NEXT BEAT</option>
                            <option value="bar">NEXT BAR</option>
                        </select>
                    </label>
                    <label className="field"><span>COUNT-IN</span>
                        <select value={bool(loop.countIn) ? num(engine.transport.countInBars, 1) : 0}
                            onChange={(event) => void setCountInBars(Number(event.target.value))}>
                            <option value={0}>OFF</option>
                            <option value={1}>1 BAR</option>
                            <option value={2}>2 BARS</option>
                            <option value={4}>4 BARS</option>
                        </select>
                        <small className="muted">Uses the shared transport.</small>
                    </label>
                    <label className="field"><span>LOOP LEVEL</span>
                        <input className="range" type="range" min="0" max="1.5" step="0.01" value={num(loop.level, 1)}
                            onChange={(event) => void configure({ level: Number(event.target.value) })} />
                    </label>
                    <label className="field"><span>OVERDUB FEEDBACK</span>
                        <input className="range" type="range" min="0" max="1" step="0.01" value={num(loop.feedback, 1)}
                            onChange={(event) => void configure({ feedback: Number(event.target.value) })} />
                    </label>
                </section>
                <section className="panel row looper-save-actions">
                    <button type="button" className="btn" disabled={!hasLoop || busy} onClick={() => void save()}>
                        {status === "saving" ? "SAVING…" : "SAVE WAV"}
                    </button>
                    <button type="button" className="btn" disabled={!str(loop.savedPath) || busy}
                        onClick={() => { window.location.href = `/api/looper/export?t=${Date.now()}`; }}>
                        EXPORT LAST SAVE
                    </button>
                    <span className="muted">Capacity: {Math.trunc(num(loop.maximumSeconds, 120))}s · {Math.trunc(num(loop.remainingSeconds, 120))}s remaining.</span>
                </section>
            </div>}

            {page === "library" && <section className="panel stack looper-library looper-tab-content">
                <div className="row"><strong>SAVED LOOPS</strong><span className="muted">{savedLoops.length} WAV FILE{savedLoops.length === 1 ? "" : "S"}</span></div>
                {savedLoops.length === 0 && <span className="muted">Saved loops will appear here.</span>}
                {savedLoops.map((name) => (
                    <div className="looper-library-row" key={name}>
                        <strong>{name}</strong>
                        <button type="button" className="btn" disabled={recording || overdubbing || busy}
                            onClick={() => void command("load", { name })}>LOAD</button>
                        <button type="button" className="btn" disabled={busy}
                            onClick={() => { window.location.href = `/api/looper/export?name=${encodeURIComponent(name)}`; }}>EXPORT</button>
                        <button type="button" className="btn" disabled={busy}
                            onClick={() => void renameSaved(name)}>RENAME</button>
                        <button type="button" className="btn btn-danger" disabled={busy}
                            onClick={() => setDeleteName(name)}>DELETE</button>
                    </div>
                ))}
            </section>}

            {confirmClear && (
                <ConfirmDialog title="CLEAR LOOP?" body="This permanently clears the current in-memory loop. Save it first if you want to keep it."
                    confirmLabel="CLEAR" danger onCancel={() => setConfirmClear(false)} onConfirm={() => {
                        setConfirmClear(false);
                        void command("clear", { confirmed: true });
                    }} />
            )}
            {deleteName && (
                <ConfirmDialog title="DELETE SAVED LOOP?" body={`Delete “${deleteName}” from this Pi?`}
                    confirmLabel="DELETE" danger onCancel={() => setDeleteName("")} onConfirm={() => {
                        const name = deleteName;
                        setDeleteName("");
                        void command("delete", { name, confirmed: true });
                    }} />
            )}
        </div>
    );
}
