import { useEffect, useState } from "react";
import type { EngineSnapshot } from "../api";
import { askText } from "../keyboard/ask";
import { bool, num, obj, objects, str, type JsonObject } from "../json";
import { LibraryBrowser, LibraryConfirm } from "./LibraryManager";
import { MarqueeText } from "./MarqueeText";
import { WaveformTimeline } from "./WaveformTimeline";

type Props = {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
};

function formatTime(seconds: number): string {
    const whole = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(whole / 60);
    return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

function formatLoopTime(seconds: number): string {
    const tenths = Math.max(0, Math.floor(seconds * 10));
    const minutes = Math.floor(tenths / 600);
    const remainder = tenths % 600;
    return `${minutes}:${String(Math.floor(remainder / 10)).padStart(2, "0")}.${remainder % 10}`;
}

function LoopSecondsInput({ label, value, maximum, disabled, onCommit }: {
    label: string;
    value: number;
    maximum: number;
    disabled: boolean;
    onCommit: (seconds: number) => void;
}) {
    const formatValue = (seconds: number) => seconds.toFixed(1);
    const [draft, setDraft] = useState(() => formatValue(value));
    useEffect(() => setDraft(formatValue(value)), [value]);

    const commit = () => {
        const parsed = Number(draft);
        if (!Number.isFinite(parsed)) {
            setDraft(formatValue(value));
            return;
        }
        const bounded = Math.max(0, Math.min(maximum, parsed));
        setDraft(formatValue(bounded));
        onCommit(bounded);
    };

    return <label className="backing-loop-seconds" title={`${label} in seconds`}>
        <input className="text-input" type="number" inputMode="decimal" min="0" max={maximum} step="0.1"
            aria-label={label} disabled={disabled} value={draft} onChange={(event) => setDraft(event.target.value)}
            onBlur={commit} onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") { setDraft(formatValue(value)); event.currentTarget.blur(); }
            }} />
        <span>SEC</span>
    </label>;
}

export function BackingTracksView({ engine, run }: Props) {
    const track = engine.backing;
    const command = (name: string, payload: JsonObject = {}) =>
        run(() => engine.client.request(`backing/${name}`, payload));
    const duration = num(track.duration, 0);
    const position = Math.min(duration, num(track.position, 0));
    const waveform = Array.isArray(track.waveform) ? track.waveform : [];
    const setLists = objects(track.setLists);
    const activeSetListId = str(track.activeSetListId);
    const activeSetList = obj(setLists.find((item) => str(item.id) === activeSetListId));
    const entries = objects(activeSetList.entries);
    const [filesOpen, setFilesOpen] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [removeEntry, setRemoveEntry] = useState<number | null>(null);
    const canControlTrack = bool(track.loaded) || str(track.status) === "loading";
    const canSetLoop = bool(track.loaded) && duration > 0;
    const loopStart = Math.max(0, Math.min(duration, num(track.loopStart)));
    const loopEnd = Math.max(loopStart, Math.min(duration, num(track.loopEnd, duration)));
    const trackDetails = [str(track.artist), str(track.album), str(track.notes)].filter(Boolean).join(" · ");

    const setLoopStart = () => {
        if (!canSetLoop) return;
        const start = Math.min(position, Math.max(0, duration - 0.1));
        const end = loopEnd > start ? loopEnd : duration;
        void command("loop", { enabled: bool(track.loopEnabled), start, end });
    };
    const setLoopEnd = () => {
        if (!canSetLoop) return;
        const end = Math.max(0.1, position);
        const start = loopStart < end ? loopStart : 0;
        void command("loop", { enabled: bool(track.loopEnabled), start, end });
    };

    const createSetList = async () => {
        const name = await askText("New set-list name", "");
        if (name?.trim()) await command("setlist/create", { name: name.trim() });
    };
    const renameSetList = async () => {
        if (!activeSetListId) return;
        const name = await askText("Rename set list", str(activeSetList.name));
        if (name?.trim()) await command("setlist/rename", { id: activeSetListId, name: name.trim() });
    };
    const editMetadata = async () => {
        if (!bool(track.loaded)) return;
        const title = await askText("Track title", str(track.title, str(track.name)));
        if (title === null) return;
        const artist = await askText("Artist", str(track.artist));
        if (artist === null) return;
        const album = await askText("Album", str(track.album));
        if (album === null) return;
        const notes = await askText("Track notes", str(track.notes));
        if (notes === null) return;
        await command("metadata", { title, artist, album, notes });
    };

    return (
        <div className="page-scroll backing-tracks-view" data-mfx-nav-list="backingTracks">
            <div className="backing-workspace">
                <aside className="backing-sidebar">
                    <section className="panel backing-setlist-panel">
                        <div className="backing-panel-heading">
                            <strong>SET LIST</strong>
                            <span className="muted">{entries.length} TRACK{entries.length === 1 ? "" : "S"}</span>
                        </div>
                        <select className="backing-setlist-select" value={activeSetListId}
                            onChange={(event) => void command("setlist/select", { id: event.target.value })}>
                            <option value="">NO SET LIST</option>
                            {setLists.map((list) => <option key={str(list.id)} value={str(list.id)}>{str(list.name)}</option>)}
                        </select>
                        <div className="backing-setlist-actions">
                            <button type="button" className="btn" onClick={() => void createSetList()}>NEW</button>
                            <button type="button" className="btn" disabled={!activeSetListId} onClick={() => void renameSetList()}>RENAME</button>
                            <button type="button" className="btn btn-danger" disabled={!activeSetListId} onClick={() => setConfirmDelete(true)}>DELETE</button>
                        </div>
                        <div className="backing-setlist-hint muted">Previous and Next follow this order.</div>
                        <div className="backing-setlist-scroll" data-mfx-sync-scroll="backing-setlist">
                            {entries.length === 0 && <span className="muted">Add tracks from Track Files.</span>}
                            {entries.map((entry, index) => (
                                <div className={`backing-setlist-row ${index === Math.trunc(num(track.setListIndex, -1)) ? "active" : ""}`} key={`${index}-${str(entry.path)}`}>
                                    <button type="button" className="list-row" onClick={() => void command("setlist/load", { index })}>
                                        <MarqueeText text={`${index + 1}. ${str(entry.name)}`} align="left" fontWeight={500} delaySeconds={1.5} pixelsPerSecond={35} />
                                    </button>
                                    <button type="button" className="btn backing-icon-btn" aria-label="Move track up" disabled={index === 0} onClick={() => void command("setlist/move", { from: index, to: index - 1 })}>↑</button>
                                    <button type="button" className="btn backing-icon-btn" aria-label="Move track down" disabled={index === entries.length - 1} onClick={() => void command("setlist/move", { from: index, to: index + 1 })}>↓</button>
                                    <button type="button" className="btn btn-danger backing-icon-btn" aria-label="Remove track from set list" onClick={() => setRemoveEntry(index)}>×</button>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="panel backing-settings-panel">
                        <div className="backing-panel-heading">
                            <strong>TRACK SETTINGS</strong>
                            <button type="button" className="btn" disabled={!bool(track.loaded)} onClick={() => void editMetadata()}>EDIT INFO</button>
                        </div>
                        <div className="backing-settings-grid">
                            <label className="backing-field backing-level-field"><span>LEVEL</span><input className="range" type="range" min="0" max="1.5" step="0.01" disabled={!bool(track.loaded)} value={num(track.level, 1)} onChange={(event) => void command("level", { level: Number(event.target.value) })} /></label>
                            <label className="backing-field"><span>MANUAL BPM</span><input className="text-input" type="number" min="0" max="300" disabled={!bool(track.loaded)} value={num(track.manualBpm, 0) || ""} onChange={(event) => void command("bpm", { bpm: Number(event.target.value) || 0 })} /></label>
                            <div className="backing-loop-editor">
                                <label className="backing-loop-toggle"><input type="checkbox" disabled={!canSetLoop} checked={bool(track.loopEnabled)} onChange={(event) => void command("loop", { enabled: event.target.checked, start: loopStart, end: loopEnd })} /> LOOP REGION</label>
                                <div className="backing-loop-points">
                                    <div className="backing-loop-point">
                                        <button type="button" className="btn" disabled={!canSetLoop} onClick={setLoopStart} title="Set loop start to the current track position">
                                            <span>SET START</span><strong>{formatLoopTime(loopStart)}</strong>
                                        </button>
                                        <LoopSecondsInput key={`${str(track.path)}-loop-start`} label="Loop start seconds" value={loopStart} maximum={duration}
                                            disabled={!canSetLoop} onCommit={(start) => void command("loop", { enabled: bool(track.loopEnabled), start, end: loopEnd > start ? loopEnd : duration })} />
                                    </div>
                                    <div className="backing-loop-point">
                                        <button type="button" className="btn" disabled={!canSetLoop} onClick={setLoopEnd} title="Set loop end to the current track position">
                                            <span>SET END</span><strong>{formatLoopTime(loopEnd)}</strong>
                                        </button>
                                        <LoopSecondsInput key={`${str(track.path)}-loop-end`} label="Loop end seconds" value={loopEnd} maximum={duration}
                                            disabled={!canSetLoop} onCommit={(end) => void command("loop", { enabled: bool(track.loopEnabled), start: loopStart < end ? loopStart : 0, end })} />
                                    </div>
                                </div>
                                <small className="muted">Seek and press SET, or enter an exact time in seconds.</small>
                            </div>
                        </div>
                    </section>
                </aside>

                <main className={`backing-main ${filesOpen ? "files-expanded" : "files-hidden"}`}>
                    <section className="panel backing-player-panel">
                        <div className="backing-player-heading">
                            <div className="backing-track-identity">
                                <span className="muted">NOW PLAYING</span>
                                <strong>{str(track.title, str(track.name, "No track loaded"))}</strong>
                                {trackDetails && <small className="muted">{trackDetails}</small>}
                            </div>
                            <div className="backing-player-summary">
                                <div><span>STATUS</span><strong>{str(track.status, "empty").toUpperCase()}</strong></div>
                                <div><span>BUFFER</span><strong className={num(track.underruns) ? "danger" : ""}>{num(track.underruns) ? `${Math.trunc(num(track.underruns))} UNDERRUNS` : "READY"}</strong></div>
                            </div>
                        </div>
                        {str(track.error) && <div className="error-banner">{str(track.error)}</div>}
                        <div className="backing-waveform-stack">
                            <WaveformTimeline peaks={waveform} position={position} duration={duration}
                                bpm={num(track.manualBpm) || num(engine.transport.bpm)} beatsPerBar={num(engine.transport.beatsPerBar, 4)}
                                loopEnabled={bool(track.loopEnabled)} loopStart={loopStart} loopEnd={loopEnd}
                                emptyText="Load a track to see its waveform." onSeek={bool(track.loaded)
                                    ? (seconds) => void command("seek", { seconds }) : undefined} />
                            <div className="backing-seek-row">
                                <span>{formatTime(position)}</span>
                                <input className="range" aria-label="Track position" type="range" min="0" max={duration || 1} step="0.01" value={position}
                                    onChange={(event) => void command("seek", { seconds: Number(event.target.value) })} />
                                <span>{formatTime(duration)}</span>
                            </div>
                        </div>
                        <div className="backing-transport-actions">
                            <button className="btn" onClick={() => void command("previous")}>PREV</button>
                            <button className="btn" disabled={!canControlTrack} onClick={() => void command("restart")}>RESTART</button>
                            <button className="btn btn-accent" disabled={!canControlTrack} onClick={() => void command(bool(track.playing) ? "pause" : "play")}>{bool(track.playing) ? "PAUSE" : "PLAY"}</button>
                            <button className="btn" disabled={!canControlTrack} onClick={() => void command("stop")}>STOP</button>
                            <button className="btn" onClick={() => void command("next")}>NEXT</button>
                        </div>
                    </section>

                    <section className="panel backing-files-panel">
                        <div className="backing-panel-heading">
                            <strong>TRACK FILES</strong>
                            <button type="button" className={`btn ${filesOpen ? "btn-active" : ""}`} onClick={() => setFilesOpen((value) => !value)}>
                                {filesOpen ? "HIDE" : "SHOW"}
                            </button>
                        </div>
                        {filesOpen && <div className="backing-file-browser"><LibraryBrowser engine={engine} run={run} kind="backing" dualDefault={false} /></div>}
                    </section>
                </main>
            </div>

            {confirmDelete && (
                <LibraryConfirm title="DELETE SET LIST" body={`Delete “${str(activeSetList.name)}”? Track files will not be deleted.`} danger
                    onCancel={() => setConfirmDelete(false)}
                    onConfirm={() => { setConfirmDelete(false); void command("setlist/delete", { id: activeSetListId }); }} />
            )}
            {removeEntry !== null && <LibraryConfirm title="REMOVE FROM SET LIST?"
                body={`Remove “${str(entries[removeEntry]?.name, "this track")}” from this set list? The track file will be kept.`}
                danger confirmLabel="REMOVE" onCancel={() => setRemoveEntry(null)} onConfirm={() => {
                    const index = removeEntry;
                    setRemoveEntry(null);
                    void command("setlist/remove", { index });
                }} />}
        </div>
    );
}
