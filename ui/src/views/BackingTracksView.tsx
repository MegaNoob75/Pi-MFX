import { useState } from "react";
import type { EngineSnapshot } from "../api";
import { askText } from "../keyboard/ask";
import { bool, num, obj, objects, str, type JsonObject } from "../json";
import { LibraryBrowser, LibraryConfirm } from "./LibraryManager";
import { MarqueeText } from "./MarqueeText";

type Props = {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
};

function formatTime(seconds: number): string {
    const whole = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(whole / 60);
    return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
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
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const canControlTrack = bool(track.loaded) || str(track.status) === "loading";

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
                                    <button type="button" className="btn btn-danger backing-icon-btn" aria-label="Remove track from set list" onClick={() => void command("setlist/remove", { index })}>×</button>
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
                            <label className="backing-field"><span>LOOP START</span><input className="text-input" type="number" min="0" max={duration} step="0.1" disabled={!bool(track.loaded)} value={num(track.loopStart)} onChange={(event) => void command("loop", { enabled: bool(track.loopEnabled), start: Number(event.target.value), end: num(track.loopEnd, duration) })} /></label>
                            <label className="backing-field"><span>LOOP END</span><input className="text-input" type="number" min="0" max={duration} step="0.1" disabled={!bool(track.loaded)} value={num(track.loopEnd, duration)} onChange={(event) => void command("loop", { enabled: bool(track.loopEnabled), start: num(track.loopStart), end: Number(event.target.value) })} /></label>
                            <label className="backing-loop-toggle"><input type="checkbox" disabled={!bool(track.loaded)} checked={bool(track.loopEnabled)} onChange={(event) => void command("loop", { enabled: event.target.checked, start: num(track.loopStart), end: num(track.loopEnd, duration) })} /> LOOP REGION</label>
                        </div>
                    </section>
                </aside>

                <main className={`backing-main ${filesOpen ? "files-expanded" : "files-hidden"}`}>
                    <section className="panel backing-player-panel">
                        <div className="backing-player-heading">
                            <div className="backing-track-identity">
                                <span className="muted">NOW PLAYING</span>
                                <strong>{str(track.title, str(track.name, "No track loaded"))}</strong>
                                {(str(track.artist) || str(track.album)) && <small className="muted">{str(track.artist)}{str(track.album) ? ` · ${str(track.album)}` : ""}</small>}
                            </div>
                            <label className="btn btn-accent backing-import-btn">
                                IMPORT
                                <input type="file" accept=".wav,.flac,.mp3,.ogg,audio/*" hidden multiple
                                    onChange={(event) => {
                                        const files = Array.from(event.target.files ?? []);
                                        void run(async () => {
                                            try {
                                                for (const file of files) {
                                                    setUploadProgress(0);
                                                    await engine.client.uploadBackingTrack(file, setUploadProgress);
                                                }
                                            } finally {
                                                setUploadProgress(null);
                                            }
                                        });
                                        event.target.value = "";
                                    }} />
                            </label>
                        </div>
                        {uploadProgress !== null && <div className="backing-import-progress muted">IMPORTING {Math.round(uploadProgress * 100)}%</div>}
                        <div className="backing-status-strip">
                            <div><span>TIME</span><strong>{formatTime(position)} / {formatTime(duration)}</strong></div>
                            <div><span>STATUS</span><strong>{str(track.status, "empty").toUpperCase()}</strong></div>
                            <div><span>BUFFER</span><strong className={num(track.underruns) ? "danger" : ""}>{num(track.underruns) ? `${Math.trunc(num(track.underruns))} UNDERRUNS` : "READY"}</strong></div>
                        </div>
                        {str(track.notes) && <div className="backing-track-notes muted">{str(track.notes)}</div>}
                        {str(track.error) && <div className="error-banner">{str(track.error)}</div>}
                        {waveform.length > 0 && (
                            <div className="backing-waveform" aria-label="Track waveform">
                                {waveform.map((peak, index) => <span key={index} style={{ height: `${Math.max(4, Math.min(100, num(peak) * 100))}%` }} />)}
                            </div>
                        )}
                        <div className="backing-seek-row">
                            <span>{formatTime(position)}</span>
                            <input className="range" aria-label="Track position" type="range" min="0" max={duration || 1} step="0.01" value={position}
                                onChange={(event) => void command("seek", { seconds: Number(event.target.value) })} />
                            <span>{formatTime(duration)}</span>
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
        </div>
    );
}
