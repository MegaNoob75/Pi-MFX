import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineSnapshot } from "../api";
import { arr, bool, num, objects, str, type JsonObject } from "../json";
import { askText } from "../keyboard/ask";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
};

const sourceLabels: Record<string, string> = {
    raw: "RAW INPUT", processed: "PROCESSED INPUT", backing: "BACKING TRACK",
    drum: "DRUMS", master: "MASTER"
};

type CommitRangeProps = {
    label: string;
    min: number;
    max: number;
    step: number;
    value: number;
    disabled?: boolean;
    onCommit: (value: number) => void;
};

function CommitRange({ label, min, max, step, value, disabled, onCommit }: CommitRangeProps) {
    const [draft, setDraft] = useState(value);
    const active = useRef(false);
    const sent = useRef(value);
    useEffect(() => {
        if (!active.current) setDraft(value);
        sent.current = value;
    }, [value]);
    const commit = () => {
        active.current = false;
        if (draft !== sent.current) {
            sent.current = draft;
            onCommit(draft);
        }
    };
    return <input aria-label={label} type="range" min={min} max={max} step={step} value={draft} disabled={disabled}
        onPointerDown={() => { active.current = true; }} onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={commit} onPointerCancel={commit} onBlur={commit} onKeyUp={commit} />;
}

function bytes(value: number): string {
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)} MB`;
    return `${Math.max(0, value / 1024).toFixed(0)} KB`;
}

export function RecorderView({ engine, run }: Props) {
    const recorder = engine.recorder;
    const [page, setPage] = useState<"record" | "mix" | "edit" | "files">("record");
    const [deleteTrack, setDeleteTrack] = useState("");
    const [deleteProject, setDeleteProject] = useState("");
    const [deleteClip, setDeleteClip] = useState("");
    const [selectedClip, setSelectedClip] = useState("");
    const tracks = objects(recorder.tracks);
    const sources = objects(recorder.sources);
    const projects = arr(recorder.projects).map(String).filter(Boolean);
    const sampleRate = Math.max(1, num(recorder.sampleRate, 48000));
    const recording = str(recorder.status) === "recording";
    const busy = recording || str(recorder.status) === "finalizing";
    const playbackStatus = str(recorder.playbackStatus, "stopped");
    const backingLoaded = bool(recorder.backingLoaded);
    const duration = num(recorder.duration);
    const position = Math.min(duration, num(recorder.position));
    const selected = useMemo(() => {
        for (const track of tracks) for (const clip of objects(track.clips)) {
            if (str(clip.id) === selectedClip) return { track, clip };
        }
        return undefined;
    }, [tracks, selectedClip]);
    const totalFrames = Math.max(1, ...tracks.flatMap((track) => objects(track.clips)
        .map((clip) => num(clip.start) + num(clip.length))));

    const command = (name: string, payload: JsonObject = {}) =>
        run(() => engine.client.request(`recorder/${name}`, payload));
    const createProject = async () => {
        const name = await askText("Recording project name", "New Recording");
        if (name?.trim()) await command("project/new", { name: name.trim() });
    };
    const addTrack = async (source: string) => {
        const label = sourceLabels[source] ?? source;
        const name = await askText("Track name", label);
        if (name?.trim()) await command("track/add", { source, name: name.trim() });
    };
    const renameTrack = async (track: JsonObject) => {
        const name = await askText("Rename track", str(track.name));
        if (name?.trim()) await command("track/update", { id: str(track.id), name: name.trim() });
    };
    const updateTrack = (track: JsonObject, patch: JsonObject) =>
        command("track/update", { id: str(track.id), ...patch });
    const edit = (name: string, payload: JsonObject) => command(`clip/${name}`, payload);
    const toggleMetronome = () => run(() => engine.client.request("transport/settings", {
        bpm: num(engine.transport.bpm, 120),
        beatsPerBar: num(engine.transport.beatsPerBar, 4),
        beatUnit: num(engine.transport.beatUnit, 4),
        countInBars: num(engine.transport.countInBars, 0),
        metronomeEnabled: !bool(engine.transport.metronomeEnabled),
        quantizationEnabled: bool(engine.transport.quantizationEnabled)
    }));

    return (
        <div className="page-scroll recorder-view" data-mfx-nav-list="recorder">
            <section className={`panel recorder-status ${recording ? "recording" : ""}`}>
                <div><span className="muted">MULTITRACK</span><strong>{str(recorder.status, "stopped").toUpperCase()}</strong></div>
                <div><span className="muted">PROJECT</span><strong>{str(recorder.projectName, "NONE")}</strong></div>
                <div><span className="muted">PLAYHEAD</span><strong>{position.toFixed(1)} / {duration.toFixed(1)}s</strong></div>
                <div><span className="muted">FREE</span><strong>{bytes(num(recorder.freeBytes))}</strong></div>
                <div><span className="muted">REMAINING</span><strong>{num(recorder.remainingSeconds) > 0 ? `${Math.floor(num(recorder.remainingSeconds) / 60)}m` : "—"}</strong></div>
                <div><span className="muted">WRITE</span><strong>{Math.trunc(num(recorder.writeKbps))} KB/s</strong></div>
            </section>

            {(str(recorder.error) || str(recorder.warning) || num(recorder.droppedBlocks) > 0) && (
                <div className="error-banner">{str(recorder.error) || str(recorder.warning)
                    || `${Math.trunc(num(recorder.droppedBlocks))} recorder blocks were dropped. Live input audio was protected.`}</div>
            )}
            {arr(recorder.recoveredFiles).length > 0 && (
                <div className="error-banner">Recovered interrupted WAV data: {arr(recorder.recoveredFiles).map(String).join(", ")}</div>
            )}

            <nav className="recorder-tabs" aria-label="Recorder pages">
                {(["record", "mix", "edit", "files"] as const).map((tab) => (
                    <button type="button" key={tab} className={`btn${page === tab ? " btn-active" : ""}`}
                        onClick={() => setPage(tab)}>{tab.toUpperCase()}</button>
                ))}
            </nav>

            <section className="recorder-playback">
                <button type="button" className={`btn btn-accent${playbackStatus === "playing" ? " btn-active" : ""}`}
                    disabled={duration <= 0 || str(recorder.status) === "finalizing"}
                    onClick={() => void command(playbackStatus === "playing" ? "playback/pause" : "playback/play")}>
                    {playbackStatus === "playing" ? "PAUSE" : playbackStatus === "paused" ? "RESUME" : "PLAY"}
                </button>
                <button type="button" className="btn" disabled={duration <= 0}
                    onClick={() => void command("playback/stop")}>STOP</button>
                <CommitRange label="Recorder playhead" min={0} max={Math.max(.01, duration)} step={0.01} value={position}
                    disabled={duration <= 0} onCommit={(seconds) => void command("playback/seek", { seconds })} />
                <span>{position.toFixed(1)}s</span>
                <button type="button" className={`btn${bool(engine.transport.metronomeEnabled) ? " btn-active" : ""}`}
                    onClick={() => void toggleMetronome()}>CLICK {bool(engine.transport.metronomeEnabled) ? "ON" : "OFF"}</button>
            </section>

            {page === "record" && <section className="recorder-tab panel stack">
                {!str(recorder.projectId) ? (
                    <div className="recorder-empty">
                        <strong>CREATE OR OPEN A PROJECT</strong>
                        <span className="muted">A project holds your tracks, takes and non-destructive edits.</span>
                        <button type="button" className="btn btn-accent" onClick={() => void createProject()}>NEW PROJECT</button>
                    </div>
                ) : <>
                    <div className="recorder-main-actions">
                        {recording ? <button type="button" className="btn btn-danger btn-active"
                            onClick={() => void command("record/stop")}>STOP + SAVE</button> : <>
                            <button type="button" className="btn btn-danger" disabled={busy}
                                onClick={() => void command("record/start")}>RECORD ARMED TRACKS</button>
                            <button type="button" className="btn btn-accent" disabled={busy || !backingLoaded}
                                onClick={() => void command("record/start", { playBacking: true })}>RECORD WITH BACKING</button>
                        </>}
                        <span className="muted">{backingLoaded
                            ? `Backing ready: ${str(recorder.backingName, "loaded track")}. This starts it from the beginning and saves guitar plus backing as separate stems.`
                            : "Load a song in BACKING TRACKS to enable synchronized recording. Processed Input records an instrument or microphone after the effects chain."}</span>
                    </div>
                    <div className="recorder-add-row">
                        {sources.map((source) => <button type="button" className="btn" key={str(source.id)} disabled={busy || !bool(source.available)}
                            onClick={() => void addTrack(str(source.id))}>+ {sourceLabels[str(source.id)] ?? str(source.id).toUpperCase()}</button>)}
                    </div>
                    <div className="recorder-track-list">
                        {tracks.length === 0 && <span className="muted">Add a source track, then arm it to record.</span>}
                        {tracks.map((track) => <div className="recorder-track" key={str(track.id)}>
                            <button type="button" className={`btn recorder-arm${bool(track.armed) ? " btn-danger btn-active" : ""}`} disabled={busy}
                                onClick={() => void updateTrack(track, { armed: !bool(track.armed) })}>{bool(track.armed) ? "ARMED" : "ARM"}</button>
                            <div><strong>{str(track.name)}</strong><small className="muted">{sourceLabels[str(track.source)] ?? str(track.source)}</small></div>
                            <span className="muted">{objects(track.clips).length} TAKE{objects(track.clips).length === 1 ? "" : "S"}</span>
                            <button type="button" className="btn" disabled={busy} onClick={() => void renameTrack(track)}>RENAME</button>
                            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setDeleteTrack(str(track.id))}>DELETE</button>
                        </div>)}
                    </div>
                </>}
            </section>}

            {page === "mix" && <section className="recorder-tab panel recorder-mixer">
                {tracks.length === 0 && <span className="muted">Add tracks on the RECORD page first.</span>}
                {tracks.map((track) => <div className="recorder-strip" key={str(track.id)}>
                    <strong>{str(track.name)}</strong><small className="muted">{sourceLabels[str(track.source)]}</small>
                    <div className="recorder-strip-buttons">
                        <button type="button" className={`btn${bool(track.muted) ? " btn-active" : ""}`} disabled={str(recorder.status) === "finalizing"}
                            onClick={() => void updateTrack(track, { muted: !bool(track.muted) })}>MUTE</button>
                        <button type="button" className={`btn${bool(track.solo) ? " btn-active" : ""}`} disabled={str(recorder.status) === "finalizing"}
                            onClick={() => void updateTrack(track, { solo: !bool(track.solo) })}>SOLO</button>
                    </div>
                    <label className="field"><span>LEVEL</span><CommitRange label={`${str(track.name)} level`} min={0} max={1.5} step={0.01}
                        value={num(track.level, 1)} disabled={str(recorder.status) === "finalizing"}
                        onCommit={(level) => void updateTrack(track, { level })} /></label>
                    <label className="field"><span>PAN</span><CommitRange label={`${str(track.name)} pan`} min={-1} max={1} step={0.01}
                        value={num(track.pan)} disabled={str(recorder.status) === "finalizing"}
                        onCommit={(pan) => void updateTrack(track, { pan })} /></label>
                    <button type="button" className="btn" disabled={busy || objects(track.clips).length === 0}
                        onClick={() => { window.location.href = `/api/recorder/export?kind=stem&track=${encodeURIComponent(str(track.id))}`; }}>EXPORT STEM</button>
                </div>)}
            </section>}

            {page === "edit" && <section className="recorder-tab panel recorder-editor">
                <div className="recorder-timeline">
                    {tracks.map((track) => <div className="recorder-lane" key={str(track.id)}>
                        <strong>{str(track.name)}</strong>
                        <div className="recorder-lane-clips">
                            {objects(track.clips).map((clip) => <button type="button" key={str(clip.id)}
                                className={`recorder-clip${selectedClip === str(clip.id) ? " selected" : ""}`}
                                style={{ left: `${num(clip.start) / totalFrames * 100}%`, width: `${Math.max(3, num(clip.length) / totalFrames * 100)}%` }}
                                onClick={() => setSelectedClip(str(clip.id))}>{(num(clip.length) / sampleRate).toFixed(1)}s</button>)}
                        </div>
                    </div>)}
                </div>
                {selected ? <div className="recorder-edit-controls">
                    <strong>{str(selected.track.name)} · {(num(selected.clip.length) / sampleRate).toFixed(2)}s</strong>
                    <label className="field"><span>START</span><input type="number" min="0" step="0.01" defaultValue={(num(selected.clip.start) / sampleRate).toFixed(2)}
                        onBlur={(event) => void edit("set", { id: selectedClip, start: Number(event.target.value) * sampleRate })} /></label>
                    <label className="field"><span>IN</span><input type="number" min="0" step="0.01" defaultValue={(num(selected.clip.offset) / sampleRate).toFixed(2)}
                        onBlur={(event) => void edit("set", { id: selectedClip, offset: Number(event.target.value) * sampleRate })} /></label>
                    <label className="field"><span>LENGTH</span><input type="number" min="0.01" step="0.01" defaultValue={(num(selected.clip.length) / sampleRate).toFixed(2)}
                        onBlur={(event) => void edit("set", { id: selectedClip, length: Number(event.target.value) * sampleRate })} /></label>
                    <label className="field"><span>FADE IN</span><input type="number" min="0" step="0.01" defaultValue={(num(selected.clip.fadeIn) / sampleRate).toFixed(2)}
                        onBlur={(event) => void edit("set", { id: selectedClip, fadeIn: Number(event.target.value) * sampleRate })} /></label>
                    <label className="field"><span>FADE OUT</span><input type="number" min="0" step="0.01" defaultValue={(num(selected.clip.fadeOut) / sampleRate).toFixed(2)}
                        onBlur={(event) => void edit("set", { id: selectedClip, fadeOut: Number(event.target.value) * sampleRate })} /></label>
                    <button type="button" className="btn" disabled={busy || num(recorder.playbackFrame) <= num(selected.clip.start)
                        || num(recorder.playbackFrame) >= num(selected.clip.start) + num(selected.clip.length)}
                        onClick={() => void edit("split", { id: selectedClip, position: num(recorder.playbackFrame) })}>SPLIT AT PLAYHEAD</button>
                    <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setDeleteClip(selectedClip)}>DELETE CLIP</button>
                </div> : <span className="muted">Select a clip to trim, split, move or fade it.</span>}
            </section>}

            {page === "files" && <section className="recorder-tab panel stack">
                <div className="row recorder-file-actions">
                    <button type="button" className="btn btn-accent" disabled={busy} onClick={() => void createProject()}>NEW PROJECT</button>
                    <button type="button" className="btn" disabled={busy || tracks.every((track) => objects(track.clips).length === 0)}
                        onClick={() => { window.location.href = "/api/recorder/export?kind=mix"; }}>EXPORT STEREO MIX</button>
                </div>
                {projects.map((id) => <div className="recorder-project-row" key={id}>
                    <strong>{id}</strong>
                    <button type="button" className="btn" disabled={busy || id === str(recorder.projectId)}
                        onClick={() => void command("project/open", { id })}>{id === str(recorder.projectId) ? "OPEN" : "OPEN PROJECT"}</button>
                    <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setDeleteProject(id)}>DELETE</button>
                </div>)}
            </section>}

            {deleteTrack && <ConfirmDialog title="DELETE TRACK?" body="The track is removed from this project. Recorded take files remain recoverable on disk."
                confirmLabel="DELETE" danger onCancel={() => setDeleteTrack("")} onConfirm={() => {
                    const id = deleteTrack; setDeleteTrack(""); void command("track/delete", { id, confirmed: true });
                }} />}
            {deleteProject && <ConfirmDialog title="DELETE RECORDING PROJECT?" body={`Delete “${deleteProject}” and all of its recorded audio from this Pi?`}
                confirmLabel="DELETE" danger onCancel={() => setDeleteProject("")} onConfirm={() => {
                    const id = deleteProject; setDeleteProject(""); void command("project/delete", { id, confirmed: true });
                }} />}
            {deleteClip && <ConfirmDialog title="DELETE CLIP?" body="Remove this clip from the timeline? Its source take remains on disk."
                confirmLabel="DELETE" danger onCancel={() => setDeleteClip("")} onConfirm={() => {
                    const id = deleteClip; setDeleteClip(""); setSelectedClip(""); void edit("delete", { id, confirmed: true });
                }} />}
        </div>
    );
}
