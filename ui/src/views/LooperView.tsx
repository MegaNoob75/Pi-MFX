import { useState } from "react";
import type { EngineSnapshot } from "../api";
import { arr, bool, num, str, type JsonObject } from "../json";
import { ConfirmDialog } from "./ConfirmDialog";
import { LibraryBrowser, LibraryFileSavePicker } from "./LibraryManager";
import { WaveformTimeline } from "./WaveformTimeline";

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
    const [savePicker, setSavePicker] = useState(false);
    const [selectedLoop, setSelectedLoop] = useState("");
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
                    onClick={() => setPage("library")}>LIBRARY</button>
            </nav>

            {page === "loop" && <section className="panel looper-performance looper-tab-content">
                <WaveformTimeline peaks={waveform} position={position} duration={duration}
                    bpm={num(engine.transport.bpm)} beatsPerBar={num(engine.transport.beatsPerBar, 4)}
                    emptyText="Record a loop to create its waveform." />
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
                    <button type="button" className="btn" disabled={!hasLoop || busy} onClick={() => setSavePicker(true)}>
                        {status === "saving" ? "SAVING…" : "SAVE WAV"}
                    </button>
                    <span className="muted">Capacity: {Math.trunc(num(loop.maximumSeconds, 120))}s · {Math.trunc(num(loop.remainingSeconds, 120))}s remaining.</span>
                </section>
            </div>}

            {page === "library" && <section className="panel stack looper-library looper-tab-content">
                <div className="row"><strong>SAVED LOOPS</strong><span className="muted">Locked to loops/</span></div>
                <LibraryBrowser key={str(loop.savedPath)} engine={engine} run={run} kind="loop" dualDefault={false}
                    directory="" onDirectoryChange={() => undefined} allowCreateFolder={false}
                    allowMove={false} allowSplitView={false} openFoldersOnSecondClick={false}
                    onFileSelect={(item) => setSelectedLoop(str(item.relative, str(item.name)))}
                    onItemSelect={(item) => setSelectedLoop(item && str(item.type) === "file"
                        ? str(item.relative, str(item.name)) : "")} />
                <div className="row" style={{ justifyContent: "flex-end" }}>
                    <button type="button" className="btn" disabled={!selectedLoop || busy}
                        onClick={() => { window.location.href = `/api/looper/export?name=${encodeURIComponent(selectedLoop)}`; }}>EXPORT</button>
                    <button type="button" className="btn btn-accent" disabled={!selectedLoop || recording || overdubbing || busy}
                        onClick={() => void command("load", { name: selectedLoop })}>LOAD LOOP</button>
                </div>
            </section>}

            {savePicker && <LibraryFileSavePicker engine={engine} run={run} kind="loop" title="SAVE LOOP WAV"
                defaultName="loop" extension=".wav" onClose={() => setSavePicker(false)}
                onSave={(name, overwrite) => engine.client.request("looper/save", { name, overwrite })} />}

            {confirmClear && (
                <ConfirmDialog title="CLEAR LOOP?" body="This permanently clears the current in-memory loop. Save it first if you want to keep it."
                    confirmLabel="CLEAR" danger onCancel={() => setConfirmClear(false)} onConfirm={() => {
                        setConfirmClear(false);
                        void command("clear", { confirmed: true });
                    }} />
            )}
        </div>
    );
}
