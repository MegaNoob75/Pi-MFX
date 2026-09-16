import { useMemo, useRef, useState } from "react";
import type { EngineSnapshot } from "../api";
import { arr, bool, num, obj, str, type JsonObject } from "../json";
import { askText } from "../keyboard/ask";
import { ConfirmDialog } from "./ConfirmDialog";

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
    const [importVoice, setImportVoice] = useState(0);
    const [progress, setProgress] = useState(0);
    const [deleteKit, setDeleteKit] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);
    const voices = arr(drums.voices).map(obj);
    const variations = arr(drums.variations).map(obj);
    const pattern = editFill ? obj(drums.fill) : obj(variations[variation]);
    const length = Math.max(16, num(drums.length, 16));
    const visibleStart = Math.min(stepPage * 16, length - 16);
    const playing = bool(drums.playing);
    const song = arr(drums.song).map(obj);
    const savedKits = arr(drums.savedKits).map(String).filter(Boolean);

    const rows = useMemo(() => voices.map((voice, voiceIndex) => {
        const row = obj(arr(pattern.voices)[voiceIndex]);
        const velocities = arr(row.velocities).map((value) => num(value));
        const accents = str(row.accents);
        return { voice, voiceIndex, velocities, accents };
    }), [voices, pattern]);

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
    const importFile = (file: File) => run(async () => {
        setProgress(0.01);
        await engine.client.uploadDrumSample(importVoice, file, setProgress);
        setProgress(0);
    });
    const saveKit = async () => {
        const name = await askText("Drum kit name", str(drums.kitName, "Custom"));
        if (name?.trim()) await command("kit/save", { name: name.trim() });
    };

    return (
        <div className="page-scroll drums-view" data-mfx-nav-list="drums">
            <section className={`panel drums-status${playing ? " playing" : ""}`}>
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
                <div className="drums-editor-toolbar">
                    {[0, 1, 2, 3].map((index) => <button type="button" key={index}
                        className={`btn${!editFill && variation === index ? " btn-active" : ""}`}
                        onClick={() => { setVariation(index); setEditFill(false); }}>VAR {String.fromCharCode(65 + index)}</button>)}
                    <button type="button" className={`btn${editFill ? " btn-active" : ""}`} onClick={() => setEditFill(true)}>FILL</button>
                    <button type="button" className="btn btn-danger" onClick={() => void command("clear", { variation, fill: editFill })}>CLEAR</button>
                </div>
                {length > 16 && <div className="drums-step-pages">
                    {Array.from({ length: length / 16 }, (_, index) => <button type="button" className={`btn${stepPage === index ? " btn-active" : ""}`}
                        key={index} onClick={() => setStepPage(index)}>STEPS {index * 16 + 1}–{index * 16 + 16}</button>)}
                </div>}
                <div className="drums-grid">
                    <div className="drums-grid-header"><span />{Array.from({ length: 16 }, (_, index) => <b key={index}>{visibleStart + index + 1}</b>)}</div>
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
                <div className="row"><strong>SONG-SECTIONS</strong><span className="muted">Chain variations into a repeating performance arrangement.</span></div>
                {song.map((section, index) => <div className={`drums-song-row${num(drums.activeSongSection) === index && bool(drums.songMode) ? " active" : ""}`} key={index}>
                    <strong>SECTION {index + 1}</strong>
                    <select value={num(section.variation)} onChange={(event) => {
                        const next = song.map((item) => ({ ...item })); next[index].variation = Number(event.target.value); void saveSong(next);
                    }}>{[0, 1, 2, 3].map((item) => <option value={item} key={item}>VARIATION {String.fromCharCode(65 + item)}</option>)}</select>
                    <select value={num(section.repeats, 1)} onChange={(event) => {
                        const next = song.map((item) => ({ ...item })); next[index].repeats = Number(event.target.value); void saveSong(next);
                    }}>{Array.from({ length: 16 }, (_, item) => <option value={item + 1} key={item + 1}>{item + 1}×</option>)}</select>
                    <button type="button" className="btn btn-danger" onClick={() => void saveSong(song.filter((_, item) => item !== index))}>REMOVE</button>
                </div>)}
                <button type="button" className="btn" disabled={song.length >= 32}
                    onClick={() => void saveSong([...song, { variation: 0, repeats: 1 }])}>ADD SECTION</button>
            </section>}

            {page === "kit" && <section className="panel drums-kit stack">
                <input ref={fileRef} type="file" accept=".wav,audio/wav" hidden onChange={(event) => {
                    const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void importFile(file);
                }} />
                <div className="muted">Load mono or stereo WAV samples. Files are decoded and resampled before they reach the audio thread.</div>
                {progress > 0 && <div className="drums-import-progress"><span style={{ width: `${progress * 100}%` }} /></div>}
                <div className="row drums-kit-actions">
                    <button type="button" className="btn btn-accent" onClick={() => void saveKit()}>SAVE KIT</button>
                    <strong>{str(drums.kitName, "Custom")}</strong>
                </div>
                {voices.map((voice, index) => <div className="drums-kit-row" key={index}>
                    <strong>{str(voice.name)}</strong><span>{str(voice.sample, "NO SAMPLE")}</span>
                    <button type="button" className="btn" onClick={() => { setImportVoice(index); window.setTimeout(() => fileRef.current?.click(), 0); }}>
                        {bool(voice.loaded) ? "REPLACE WAV" : "LOAD WAV"}</button>
                    <button type="button" className="btn btn-danger" disabled={!bool(voice.loaded)}
                        onClick={() => void command("sample/clear", { voice: index })}>CLEAR</button>
                </div>)}
                <div className="field-label">SAVED KITS</div>
                {savedKits.length === 0 && <span className="muted">Saved kits will appear here.</span>}
                {savedKits.map((name) => <div className="drums-saved-kit" key={name}>
                    <strong>{name}</strong>
                    <button type="button" className="btn" onClick={() => void command("kit/load", { name })}>LOAD</button>
                    <button type="button" className="btn btn-danger" onClick={() => setDeleteKit(name)}>DELETE</button>
                </div>)}
            </section>}
            {deleteKit && <ConfirmDialog title="DELETE DRUM KIT?" body={`Delete the saved “${deleteKit}” kit? Imported WAV files remain available.`}
                confirmLabel="DELETE" danger onCancel={() => setDeleteKit("")} onConfirm={() => {
                    const name = deleteKit; setDeleteKit(""); void command("kit/delete", { name, confirmed: true });
                }} />}
        </div>
    );
}
