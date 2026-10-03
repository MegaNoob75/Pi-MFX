import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineSnapshot } from "../api";
import { arr, bool, num, obj, str, type JsonObject } from "../json";
import { askText } from "../keyboard/ask";
import { ConfirmDialog } from "./ConfirmDialog";
import { DrumSampleBrowser } from "./DrumSampleBrowser";
import { LibraryItemPicker, LibraryJsonPicker } from "./LibraryManager";

type Page = "play" | "pattern" | "song" | "kit";

export function DrumMachineView({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const drums = engine.drums;
    const [page, setPage] = useState<Page>("play");
    const [variation, setVariation] = useState(0);
    const [editFill, setEditFill] = useState(false);
    const [stepPage, setStepPage] = useState(0);
    const [selected, setSelected] = useState({ voice: 0, step: 0 });
    const [browseVoice, setBrowseVoice] = useState<number | null>(null);
    const [deleteProject, setDeleteProject] = useState("");
    const [newKit, setNewKit] = useState(false);
    const [projectPicker, setProjectPicker] = useState(false);
    const [patternPicker, setPatternPicker] = useState<"load" | "save" | null>(null);
    const [songPicker, setSongPicker] = useState<"load" | "save" | null>(null);
    const [kitPicker, setKitPicker] = useState<"load" | "save" | null>(null);
    const [confirmAction, setConfirmAction] = useState<{
        title: string; body: string; label: string; run: () => void;
    } | null>(null);
    const patternAccepted = useRef(false);
    const voices = arr(drums.voices).map(obj);
    const variations = arr(drums.variations).map(obj);
    const pattern = editFill ? obj(drums.fill) : obj(variations[variation]);
    const length = Math.max(16, num(drums.length, 16));
    const visibleStart = Math.min(stepPage * 16, length - 16);
    const playing = bool(drums.playing);
    const song = arr(drums.song).map(obj);

    const rows = useMemo(() => voices.map((voice, voiceIndex) => {
        const row = obj(arr(pattern.voices)[voiceIndex]);
        const velocities = arr(row.velocities).map((value) => num(value));
        const accents = str(row.accents);
        return { voice, voiceIndex, velocities, accents };
    }).filter(({ voice }) => Boolean(str(voice.sample))), [voices, pattern]);
    useEffect(() => {
        if (rows.length && !rows.some((row) => row.voiceIndex === selected.voice)) {
            setSelected((item) => ({ ...item, voice: rows[0].voiceIndex }));
        }
    }, [rows, selected.voice]);

    const command = (name: string, payload: JsonObject = {}) =>
        run(() => engine.client.request(`drums/${name}`, payload));
    const configure = (patch: JsonObject) => command("settings", {
        length, level: num(drums.level, 0.8), swing: num(drums.swing),
        humanization: num(drums.humanization), ...patch
    });
    const updateStep = (voice: number, step: number, velocity: number, accent: boolean) =>
        command("step", { variation, fill: editFill, voice, step, velocity, accent });
    const selectVariation = (index: number) => {
        setVariation(index); setEditFill(false); void command("variation", { variation: index });
    };
    const setCountIn = (bars: number) => run(() => engine.client.request("transport/settings", {
        bpm: num(engine.transport.bpm, 120), beatsPerBar: num(engine.transport.beatsPerBar, 4),
        beatUnit: num(engine.transport.beatUnit, 4), countInBars: bars,
        metronomeEnabled: bool(engine.transport.metronomeEnabled),
        quantizationEnabled: bool(engine.transport.quantizationEnabled)
    }));
    const saveSong = (next: JsonObject[]) => command("song/set", { sections: next });
    const createProject = async () => {
        const name = await askText("Drum project name", "New Drum Project");
        if (name?.trim()) await command("project/new", { name: name.trim() });
    };
    const closePatternPicker = () => {
        if (patternPicker === "load" && !patternAccepted.current) void command("pattern/cancel-preview");
        patternAccepted.current = false;
        setPatternPicker(null);
    };

    return (
        <div className="page-scroll drums-view" data-mfx-nav-list="drums">
            <section className={`panel drums-status${playing ? " playing" : ""}`}>
                <div><span className="muted">PROJECT</span><strong>{str(drums.projectName, "DEFAULT")}</strong></div>
                <div><span className="muted">{str(drums.kitName, "CUSTOM KIT")}</span><strong>{playing ? "PLAYING" : "STOPPED"}</strong></div>
                <div><span className="muted">PATTERN</span><strong>{bool(drums.fillActive) ? "FILL" : `VAR ${num(drums.activeVariation) + 1}`}</strong></div>
                <div><span className="muted">STEPS</span><strong>{length}</strong></div>
                <div><span className="muted">MODE</span><strong>{bool(drums.songMode) ? "SONG" : "PATTERN"}</strong></div>
            </section>

            <nav className="drums-tabs" aria-label="Drum machine pages">
                {(["play", "pattern", "song", "kit"] as Page[]).map((name) => (
                    <button type="button" key={name} className={`btn${page === name ? " btn-active" : ""}`}
                        onClick={() => setPage(name)}>{name.toUpperCase()}</button>
                ))}
            </nav>

            {page === "play" && <section className="panel drums-play stack">
                <div className="row"><button type="button" className="btn" onClick={() => setProjectPicker(true)}>PROJECT FILES</button></div>
                <div className="drums-main-actions">
                    <button type="button" className={`btn btn-accent${playing ? " btn-active" : ""}`}
                        onClick={() => void command("toggle", { restart: !playing })}>{playing ? "STOP" : "START"}</button>
                    <button type="button" className={`btn drums-fill${bool(drums.fillActive) ? " btn-active" : ""}`}
                        onClick={() => void command("fill")}>FILL</button>
                    <button type="button" className={`btn${bool(drums.songMode) ? " btn-active" : ""}`}
                        onClick={() => void command("song/mode", { enabled: !bool(drums.songMode) })}>SONG {bool(drums.songMode) ? "ON" : "OFF"}</button>
                </div>
                <div className="drums-variations">
                    {[0, 1, 2, 3].map((index) => <button type="button" key={index}
                        className={`btn${num(drums.activeVariation) === index && !bool(drums.fillActive) ? " btn-active" : ""}`}
                        onClick={() => selectVariation(index)}>VARIATION {String.fromCharCode(65 + index)}</button>)}
                </div>
                <div className="drums-settings-grid">
                    <label className="field"><span>PATTERN LENGTH</span><select value={length}
                        onChange={(event) => {
                            const nextLength = Number(event.target.value);
                            setStepPage(0); setSelected((item) => ({ ...item, step: Math.min(item.step, nextLength - 1) }));
                            void configure({ length: nextLength });
                        }}>
                        <option value={16}>16 STEPS</option><option value={32}>32 STEPS</option><option value={64}>64 STEPS</option>
                    </select></label>
                    <label className="field"><span>COUNT-IN</span><select value={num(engine.transport.countInBars)}
                        onChange={(event) => void setCountIn(Number(event.target.value))}>
                        <option value={0}>OFF</option><option value={1}>1 BAR</option><option value={2}>2 BARS</option><option value={4}>4 BARS</option>
                    </select></label>
                    <label className="field"><span>LEVEL {Math.round(num(drums.level, .8) * 100)}%</span>
                        <input className="range" type="range" min="0" max="1.5" step="0.01" value={num(drums.level, .8)}
                            onChange={(event) => void configure({ level: Number(event.target.value) })} /></label>
                    <label className="field"><span>SWING {Math.round(num(drums.swing) * 100)}%</span>
                        <input className="range" type="range" min="0" max="1" step="0.01" value={num(drums.swing)}
                            onChange={(event) => void configure({ swing: Number(event.target.value) })} /></label>
                    <label className="field"><span>HUMANIZE {Math.round(num(drums.humanization) * 100)}%</span>
                        <input className="range" type="range" min="0" max="1" step="0.01" value={num(drums.humanization)}
                            onChange={(event) => void configure({ humanization: Number(event.target.value) })} /></label>
                </div>
                {(num(drums.droppedTriggers) > 0 || num(drums.droppedKitChanges) > 0) &&
                    <div className="error-banner">Drum event capacity was exceeded. Live guitar audio remained protected.</div>}
            </section>}

            {page === "pattern" && <section className="panel drums-pattern stack">
                {rows.length === 0 && <div className="muted">Add drums in the Kit page before building your pattern.</div>}
                <div className="drums-editor-toolbar">
                    {[0, 1, 2, 3].map((index) => <button type="button" key={index}
                        className={`btn${!editFill && variation === index ? " btn-active" : ""}`}
                        onClick={() => { setVariation(index); setEditFill(false); }}>VAR {String.fromCharCode(65 + index)}</button>)}
                    <button type="button" className={`btn${editFill ? " btn-active" : ""}`} onClick={() => setEditFill(true)}>FILL</button>
                    <button type="button" className="btn btn-danger" onClick={() => setConfirmAction({
                        title: "CLEAR PATTERN?",
                        body: `Clear every step in ${editFill ? "the fill" : `variation ${String.fromCharCode(65 + variation)}`}?`,
                        label: "CLEAR",
                        run: () => { void command("clear", { variation, fill: editFill }); }
                    })}>CLEAR</button>
                    <button type="button" className="btn" onClick={() => { patternAccepted.current = false; setPatternPicker("load"); }}>LOAD PATTERN</button>
                    <button type="button" className="btn btn-accent" onClick={() => setPatternPicker("save")}>SAVE PATTERN AS</button>
                </div>
                {length > 16 && <div className="drums-step-pages">
                    {Array.from({ length: length / 16 }, (_, index) => <button type="button" className={`btn${stepPage === index ? " btn-active" : ""}`}
                        key={index} onClick={() => setStepPage(index)}>STEPS {index * 16 + 1}–{index * 16 + 16}</button>)}
                </div>}
                <div className="drums-grid">
                    <div className="drums-grid-header"><span />{Array.from({ length: 16 }, (_, index) => {
                        const step = visibleStart + index;
                        return <b key={index} className={playing && num(drums.activeStep) === step ? "playing" : ""}>{step + 1}</b>;
                    })}</div>
                    {rows.map(({ voice, voiceIndex, velocities, accents }) => <div className="drums-grid-row" key={voiceIndex}>
                        <strong>{str(voice.name, `VOICE ${voiceIndex + 1}`)}</strong>
                        {Array.from({ length: 16 }, (_, index) => {
                            const step = visibleStart + index; const velocity = velocities[step] ?? 0;
                            const accent = accents[step] === "1"; const active = selected.voice === voiceIndex && selected.step === step;
                            return <button type="button" key={step} aria-label={`${str(voice.name)} step ${step + 1}`}
                                className={`drum-step${velocity ? " on" : ""}${accent ? " accent" : ""}${active ? " selected" : ""}`}
                                style={{ opacity: velocity ? Math.max(.35, velocity / 127) : 1 }} onClick={() => {
                                    setSelected({ voice: voiceIndex, step });
                                    void updateStep(voiceIndex, step, velocity === 0 ? 100 : accent ? 0 : 127, velocity > 0 && !accent);
                                }}>{accent ? "A" : velocity ? "●" : ""}</button>;
                        })}
                    </div>)}
                </div>
                <div className="drums-step-editor">
                    <strong>{str(voices[selected.voice]?.name)} · STEP {selected.step + 1}</strong>
                    <label className="field"><span>VELOCITY</span><input className="range" type="range" min="0" max="127" step="1"
                        value={num(arr(obj(arr(pattern.voices)[selected.voice]).velocities)[selected.step])}
                        onChange={(event) => void updateStep(selected.voice, selected.step, Number(event.target.value),
                            str(obj(arr(pattern.voices)[selected.voice]).accents)[selected.step] === "1")} /></label>
                    <button type="button" className={`btn${str(obj(arr(pattern.voices)[selected.voice]).accents)[selected.step] === "1" ? " btn-active" : ""}`}
                        onClick={() => void updateStep(selected.voice, selected.step,
                            Math.max(1, num(arr(obj(arr(pattern.voices)[selected.voice]).velocities)[selected.step], 100)),
                            str(obj(arr(pattern.voices)[selected.voice]).accents)[selected.step] !== "1")}>ACCENT</button>
                </div>
            </section>}

            {page === "song" && <section className="panel drums-song stack">
                <div className="drums-song-toolbar">
                    <button type="button" className="btn" onClick={() => setSongPicker("load")}>LOAD SONG</button>
                    <button type="button" className="btn btn-accent" onClick={() => setSongPicker("save")}>SAVE SONG AS</button>
                    <span className="muted">A song file includes all four patterns, the fill, section chain, kit and feel settings.</span>
                </div>
                <div className="row"><strong>SONG SECTIONS</strong><span className="muted">Chain variations into a repeating performance arrangement.</span></div>
                {song.map((section, index) => <div className={`drums-song-row${num(drums.activeSongSection) === index && bool(drums.songMode) ? " active" : ""}`} key={index}>
                    <strong>SECTION {index + 1}</strong>
                    <select value={num(section.variation)} onChange={(event) => {
                        const next = song.map((item) => ({ ...item })); next[index].variation = Number(event.target.value); void saveSong(next);
                    }}>{[0, 1, 2, 3].map((item) => <option value={item} key={item}>VARIATION {String.fromCharCode(65 + item)}</option>)}</select>
                    <select value={num(section.repeats, 1)} onChange={(event) => {
                        const next = song.map((item) => ({ ...item })); next[index].repeats = Number(event.target.value); void saveSong(next);
                    }}>{Array.from({ length: 16 }, (_, item) => <option value={item + 1} key={item + 1}>{item + 1}×</option>)}</select>
                    <button type="button" className="btn btn-danger" onClick={() => setConfirmAction({
                        title: "REMOVE SONG SECTION?",
                        body: `Remove section ${index + 1} from this song?`,
                        label: "REMOVE",
                        run: () => { void saveSong(song.filter((_, item) => item !== index)); }
                    })}>REMOVE</button>
                </div>)}
                <button type="button" className="btn" disabled={song.length >= 32}
                    onClick={() => void saveSong([...song, { variation: 0, repeats: 1 }])}>ADD SECTION</button>
            </section>}

            {page === "kit" && <section className="panel drums-kit">
                <div className="drums-kit-actions">
                    <button type="button" className="btn" onClick={() => setKitPicker("load")}>LOAD KIT</button>
                    <button type="button" className="btn btn-accent" onClick={() => setKitPicker("save")}>SAVE KIT AS</button>
                    <button type="button" className="btn" onClick={() => setNewKit(true)}>NEW KIT</button>
                    <button type="button" className="btn btn-accent" disabled={voices.every((voice) => Boolean(str(voice.sample)))}
                        onClick={() => setBrowseVoice(-1)}>ADD DRUM</button>
                </div>
                <div className="drums-kit-current"><span className="muted">CURRENT KIT</span><strong>{str(drums.kitName, "Custom")}</strong></div>
                <div className="drum-designer-frame">
                    <div className="drum-designer-list">{voices.map((voice, index) => str(voice.sample) && <div className="drums-kit-row" key={index}>
                        <strong>{str(voice.name)}</strong>
                        <span title={str(voice.sample)}>{str(voice.sample)}</span>
                        <button type="button" className="btn" onClick={() => setBrowseVoice(index)}>REPLACE</button>
                        <button type="button" className="btn btn-danger" onClick={() => setConfirmAction({
                            title: "REMOVE DRUM?",
                            body: `Remove ${str(voice.name, "this drum")} from the current kit? The WAV file will be kept.`,
                            label: "REMOVE",
                            run: () => { void command("sample/clear", { voice: index }); }
                        })}>REMOVE</button>
                    </div>)}
                    {rows.length === 0 && <div className="muted drums-kit-empty">Empty kit. Use ADD DRUM to choose sounds from the sample library.</div>}
                    </div>
                </div>
            </section>}
            {browseVoice !== null && <DrumSampleBrowser engine={engine} run={run} onClose={() => setBrowseVoice(null)}
                onPick={(relative) => { const voice = browseVoice; setBrowseVoice(null); void command("sample/load", { voice, relative }); }} />}
            {projectPicker && <LibraryItemPicker engine={engine} run={run} kind="drumproject" title="DRUM PROJECT FILES"
                itemType="dir" useLabel="OPEN PROJECT" onClose={() => setProjectPicker(false)}
                onNew={() => { setProjectPicker(false); void createProject(); }}
                onUse={(item) => { setProjectPicker(false); void command("project/open", { id: str(item.name) }); }}
                onDelete={(item) => { setProjectPicker(false); setDeleteProject(str(item.name)); }} />}
            {patternPicker && <LibraryJsonPicker engine={engine} run={run} kind="drumproject"
                baseDirectory={`${str(drums.projectId)}/patterns`} mode={patternPicker}
                title={patternPicker === "load" ? "LOAD DRUM PATTERN" : "SAVE DRUM PATTERN AS"}
                defaultName="New Pattern"
                contents={patternPicker === "save" ? JSON.stringify({ schemaVersion: 1, variations: arr(drums.variations), fill: obj(drums.fill) }, null, 2) : undefined}
                onPreview={(parsed) => void command("pattern/preview", { pattern: parsed })}
                onLoad={(parsed) => { patternAccepted.current = true; void command("pattern/apply", { pattern: parsed }); }}
                onClose={closePatternPicker} />}
            {songPicker && <LibraryJsonPicker engine={engine} run={run} kind="drumproject"
                baseDirectory={`${str(drums.projectId)}/songs`} mode={songPicker}
                title={songPicker === "load" ? "LOAD DRUM SONG" : "SAVE DRUM SONG AS"}
                defaultName="New Song"
                contents={songPicker === "save" ? (name) => JSON.stringify({
                    schemaVersion: 1,
                    name,
                    level: num(drums.level, 0.8),
                    swing: num(drums.swing),
                    humanization: num(drums.humanization),
                    kit: { name: str(drums.kitName, "Custom"), samples: voices.map((voice) => str(voice.sample)) },
                    variations: arr(drums.variations),
                    fill: obj(drums.fill),
                    song
                }, null, 2) : undefined}
                onLoad={(parsed) => void command("song/apply", { song: parsed })}
                onClose={() => setSongPicker(null)} />}
            {kitPicker && <LibraryJsonPicker engine={engine} run={run} kind="drumkit" mode={kitPicker}
                title={kitPicker === "load" ? "LOAD DRUM KIT" : "SAVE DRUM KIT AS"}
                defaultName={str(drums.kitName, "Custom")}
                contents={kitPicker === "save" ? (name) => JSON.stringify({ schemaVersion: 1, name, samples: voices.map((voice) => str(voice.sample)) }, null, 2) : undefined}
                onLoad={(parsed, path) => void command("kit/apply", { kit: parsed, name: path.split(/[\\/]/).pop()?.replace(/\.json$/i, "") || "Custom" })}
                onSaved={(path) => {
                    const name = path.split(/[\\/]/).pop()?.replace(/\.json$/i, "") || "Custom";
                    void command("kit/apply", { name, kit: { schemaVersion: 1, name, samples: voices.map((voice) => str(voice.sample)) } });
                }}
                onClose={() => setKitPicker(null)} />}
            {deleteProject && <ConfirmDialog title="DELETE DRUM PROJECT?" body={`Delete “${deleteProject}” and its saved patterns and songs? Shared WAV samples are kept.`}
                confirmLabel="DELETE" danger onCancel={() => setDeleteProject("")} onConfirm={() => {
                    const id = deleteProject; setDeleteProject(""); void command("project/delete", { id, confirmed: true });
                }} />}
            {newKit && <ConfirmDialog title="START AN EMPTY KIT?" body="Current drum assignments will be cleared. Save your kit first if you want to recall it. Saved kits and WAV files are kept."
                confirmLabel="NEW KIT" onCancel={() => setNewKit(false)} onConfirm={() => { setNewKit(false); void command("kit/new"); }} />}
            {confirmAction && <ConfirmDialog title={confirmAction.title} body={confirmAction.body}
                confirmLabel={confirmAction.label} danger onCancel={() => setConfirmAction(null)} onConfirm={() => {
                    const action = confirmAction;
                    setConfirmAction(null);
                    action.run();
                }} />}
        </div>
    );
}
