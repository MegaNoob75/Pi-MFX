import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useMeters, type EngineSnapshot } from "../api";
import { arr, bool, num, obj, str, type JsonObject } from "../json";
import { INSTRUMENTS, instrumentById, isNoteName, normalizeNote, noteMidi, presetFor,
    transposeNote, tuningSummary, type TuningPreset } from "../tunerCatalog";

type TunerStyle = "needle" | "strobe" | "bar" | "arc" | "minimal" | "stage";
type Target = { courseIndex: number; noteIndex: number; note: string; baseNote: string; frequency: number; midi: number };
const STYLES: { id: TunerStyle; label: string }[] = [
    { id: "needle", label: "Needle" }, { id: "strobe", label: "Strobe" }, { id: "bar", label: "Horizontal Bar" },
    { id: "arc", label: "Arc" }, { id: "minimal", label: "Minimal" }, { id: "stage", label: "Stage" }
];
const defaults: JsonObject = {
    style: "needle", instrument: "guitar6", tuning: "standard", referencePitch: 440,
    threshold: 0.0025, detectionBoostMode: "auto", detectionBoostDb: 0, muteOnOpen: true,
    smoothing: 0.52, tolerance: 2, capo: 0, showConcertPitch: true, showFrequency: true,
    showCents: true, showOctave: true, showString: true, showInputLevel: true, strobeSpeed: 1,
    customTunings: []
};

function noteFromFrequency(frequency: number, reference: number) {
    if (!(frequency > 0)) return { note: "—", pitchClass: "—", midi: -1 };
    const midi = Math.round(69 + 12 * Math.log2(frequency / reference));
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const pitchClass = names[((midi % 12) + 12) % 12];
    return { note: `${pitchClass}${Math.floor(midi / 12) - 1}`, pitchClass, midi };
}

function customPresets(settings: JsonObject, instrument: string): TuningPreset[] {
    return arr(settings.customTunings).flatMap((value) => {
        const item = obj(value);
        if (str(item.instrument) !== instrument || !str(item.id) || !str(item.label)) return [];
        const courses = arr(item.courses).map((course) => arr(course).map(String).filter(isNoteName));
        return courses.length && courses.every((course) => course.length) ? [{ id: str(item.id), label: str(item.label), courses }] : [];
    });
}

export function TunerView({ engine, run }: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const meters = useMeters(engine.client);
    const live = obj(meters.tuner);
    const stored = obj(obj(engine.state.ui).tuner);
    const settings = { ...defaults, ...stored } as JsonObject;
    const legacyMode = str(settings.mode);
    const instrumentId = str(stored.instrument, legacyMode === "bass" ? "bass4" : legacyMode === "chromatic" ? "chromatic" : "guitar6");
    const profile = instrumentById(instrumentId);
    const custom = customPresets(settings, profile.id);
    const selectedPreset = presetFor(profile, str(settings.tuning), custom);
    const capo = profile.family === "guitar" ? Math.max(0, Math.min(12, num(settings.capo))) : 0;
    const effectiveCourses = selectedPreset?.courses.map((course) => course.map((note) => transposeNote(note, capo))) ?? [];
    const [tab, setTab] = useState<"tuner" | "settings">("tuner");
    const [lockedTarget, setLockedTarget] = useState("");
    const [smoothFrequency, setSmoothFrequency] = useState(0);
    const [customName, setCustomName] = useState("");
    const [customNotes, setCustomNotes] = useState("");
    const [customError, setCustomError] = useState("");
    const lastValid = useRef(0);
    const valid = bool(live.valid);
    const frequency = num(live.frequency);
    const smoothing = Math.max(0, Math.min(0.9, num(settings.smoothing, 0.52)));

    useEffect(() => setLockedTarget(""), [profile.id, selectedPreset?.id, capo]);
    useEffect(() => {
        if (!valid || frequency <= 0) return;
        lastValid.current = Date.now();
        setSmoothFrequency((previous) => previous <= 0 || Math.abs(1200 * Math.log2(frequency / previous)) > 80
            ? frequency : previous * smoothing + frequency * (1 - smoothing));
    }, [valid, frequency, smoothing]);

    const shown = valid || Date.now() - lastValid.current < 350;
    const referencePitch = num(settings.referencePitch, 440);
    const targets = useMemo<Target[]>(() => effectiveCourses.flatMap((course, courseIndex) => course.map((note, noteIndex) => {
        const midi = noteMidi(note);
        return { courseIndex, noteIndex, note, baseNote: selectedPreset?.courses[courseIndex]?.[noteIndex] ?? note,
            midi, frequency: referencePitch * Math.pow(2, (midi - 69) / 12) };
    })), [JSON.stringify(effectiveCourses), selectedPreset?.id, referencePitch]);
    let selectedTarget: Target | undefined;
    let correctedFrequency = smoothFrequency;
    if (profile.family !== "chromatic" && shown) {
        let bestScore = Number.POSITIVE_INFINITY;
        const candidates = lockedTarget ? targets.filter((item) => `${item.courseIndex}:${item.noteIndex}` === lockedTarget) : targets;
        for (const target of candidates) for (const harmonic of [0.5, 1, 2, 3, 4]) {
            const error = Math.abs(1200 * Math.log2(smoothFrequency / (target.frequency * harmonic)));
            const score = error + (harmonic === 1 ? 0 : Math.abs(Math.log2(harmonic)) * 8);
            if (score < bestScore) { bestScore = score; selectedTarget = target; correctedFrequency = smoothFrequency / harmonic; }
        }
    }
    const detected = noteFromFrequency(shown ? correctedFrequency : 0, referencePitch);
    const targetMidi = selectedTarget?.midi ?? detected.midi;
    const targetFrequency = referencePitch * Math.pow(2, (targetMidi - 69) / 12);
    const cents = shown && targetFrequency > 0 ? 1200 * Math.log2(correctedFrequency / targetFrequency) : 0;
    const targetNote = selectedTarget?.note ?? detected.note;
    const tolerance = num(settings.tolerance, 2);
    const confidence = Math.max(0, Math.min(1, num(live.confidence)));
    const inTune = shown && Math.abs(cents) <= tolerance;
    const threshold = num(settings.threshold, 0.0025);
    const signalLevel = Math.max(0, num(live.inputLevel));
    const signalLow = !shown && signalLevel < threshold;
    const clipping = signalLevel >= 0.98;
    const direction = signalLow ? "SIGNAL TOO LOW" : !shown ? "PLAY A NOTE" : inTune ? "IN TUNE" : cents < 0 ? "FLAT · TUNE UP ↑" : "SHARP · TUNE DOWN ↓";
    const save = (patch: JsonObject) => void run(() => engine.client.request("ui/settings", { tuner: { ...settings, ...patch } }));
    const style = str(settings.style, "needle") as TunerStyle;
    const meterPosition = Math.max(0, Math.min(100, 50 + cents));
    const courseNumber = selectedTarget ? effectiveCourses.length - selectedTarget.courseIndex : -1;
    const summary = selectedPreset ? tuningSummary({ ...selectedPreset, courses: effectiveCourses }) : "ALL NOTES";

    const saveCustom = () => {
        const expected = selectedPreset?.courses.length ?? 0;
        const courses = customNotes.trim().split(/[\s,]+/).filter(Boolean).map((token) => token.split("/").map(normalizeNote));
        if (!customName.trim()) return setCustomError("Enter a name.");
        if (!expected || courses.length !== expected) return setCustomError(`Enter ${expected} strings/courses.`);
        if (!courses.every((course) => course.length && course.every(isNoteName))) return setCustomError("Use notes like E2 or E2/E3 for paired courses.");
        const id = `custom-${Date.now()}`;
        save({ customTunings: [...arr(settings.customTunings), { id, label: customName.trim(), instrument: profile.id, courses }], tuning: id });
        setCustomName(""); setCustomNotes(""); setCustomError("");
    };
    const removeCustom = () => {
        if (!selectedPreset || !custom.some((item) => item.id === selectedPreset.id)) return;
        save({ customTunings: arr(settings.customTunings).filter((value) => str(obj(value).id) !== selectedPreset.id), tuning: profile.presets[0]?.id ?? "" });
    };

    return <div className={`tuner-view tuner-style-${style}${inTune ? " is-in-tune" : ""}`}>
        <div className="tuner-tabs" role="tablist"><button className={tab === "tuner" ? "active" : ""} onClick={() => setTab("tuner")}>TUNER</button><button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>SETTINGS</button></div>
        {tab === "tuner" ? <div className="tuner-stage">
            <div className="tuner-status-row"><span>{profile.label.toUpperCase()} · {selectedPreset?.label.toUpperCase() ?? "CHROMATIC"}</span><strong className={bool(live.outputMuted) ? "muted-output" : ""}>{bool(live.outputMuted) ? "OUTPUT MUTED" : bool(live.dryPassthrough) ? "DRY PASSTHROUGH" : "OUTPUT LIVE"}</strong></div>
            {profile.family !== "chromatic" && selectedPreset && <TuningDiagram profileLabel={profile.label} stringLabel={profile.stringLabel} courses={effectiveCourses} baseCourses={selectedPreset.courses} showConcert={bool(settings.showConcertPitch, true)} selected={selectedTarget} locked={lockedTarget} onLock={setLockedTarget} compact={style === "minimal"} stage={style === "stage"} />}
            <div className="tuner-target-summary">{summary}{capo > 0 ? ` · CAPO ${capo}` : ""}</div>
            <div className="tuner-note">{shown ? (bool(settings.showOctave, true) ? targetNote : targetNote.replace(/-?\d$/, "")) : "—"}</div>
            <div className="tuner-direction">{direction}</div>
            <div className="tuner-display" aria-label={`${cents.toFixed(1)} cents`}><div className="tuner-scale"><i style={{ left: `${meterPosition}%` }} /><b>0</b></div>{style === "strobe" && <div className="tuner-strobe" style={{ "--strobe-offset": `${cents * num(settings.strobeSpeed, 1)}px` } as CSSProperties} />}</div>
            <div className="tuner-readouts">{bool(settings.showCents, true) && <div><span>CENTS</span><strong>{shown ? `${cents >= 0 ? "+" : ""}${cents.toFixed(1)}¢` : "—"}</strong></div>}{bool(settings.showFrequency, true) && <div><span>FREQUENCY</span><strong>{shown ? `${correctedFrequency.toFixed(1)} Hz` : "—"}</strong></div>}{bool(settings.showString, true) && profile.family !== "chromatic" && <div><span>{profile.stringLabel.toUpperCase()}</span><strong>{courseNumber > 0 ? `${courseNumber} · ${targetNote}` : "AUTO"}</strong></div>}</div>
            {bool(settings.showInputLevel, true) && <div className={`tuner-input${clipping ? " clipping" : ""}`}><span>{clipping ? "CLIP" : "INPUT"}</span><div><i style={{ width: `${Math.min(100, signalLevel * 100)}%` }} /></div><small>CONF {Math.round(confidence * 100)}%</small></div>}
        </div> : <div className="tuner-settings page-scroll" data-mfx-sync-scroll="tuner-settings">
            <section className="panel stack tuner-appearance"><h2>APPEARANCE</h2><div className="tuner-style-grid">{STYLES.map((item) => <button key={item.id} className={style === item.id ? "active" : ""} onClick={() => save({ style: item.id })}><i className={`preview-${item.id}`}><b /></i><span>{item.label}</span></button>)}</div>{style === "strobe" && <Range label="Strobe speed" value={num(settings.strobeSpeed, 1)} min={0.5} max={2} step={0.1} onChange={(value) => save({ strobeSpeed: value })} />}</section>
            <section className="panel stack"><h2>INSTRUMENT & TUNING</h2><label className="field"><span>Instrument</span><select value={profile.id} onChange={(event) => { const next = instrumentById(event.target.value); save({ instrument: next.id, tuning: next.presets[0]?.id ?? "" }); }}><option value="chromatic">Chromatic</option><optgroup label="Guitar">{INSTRUMENTS.filter((item) => item.family === "guitar").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup><optgroup label="Bass">{INSTRUMENTS.filter((item) => item.family === "bass").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup></select></label>
                {profile.family !== "chromatic" && <label className="field"><span>Tuning preset</span><select value={selectedPreset?.id ?? ""} onChange={(event) => save({ tuning: event.target.value })}>{profile.presets.map((item) => <option key={item.id} value={item.id}>{item.label} · {tuningSummary(item)}</option>)}{custom.length > 0 && <optgroup label="Custom">{custom.map((item) => <option key={item.id} value={item.id}>{item.label} · {tuningSummary(item)}</option>)}</optgroup>}</select></label>}
                {profile.family === "guitar" && <><Range label="Capo" value={capo} min={0} max={12} step={1} onChange={(value) => save({ capo: value })} /><Choice label="Note labels" value={bool(settings.showConcertPitch, true) ? "concert" : "fingered"} choices={[["concert", "Concert pitch"], ["fingered", "Fingered notes"]]} onChange={(value) => save({ showConcertPitch: value === "concert" })} /></>}</section>
            {profile.family !== "chromatic" && <section className="panel stack"><h2>CUSTOM TUNING</h2><div className="muted">One token per string/course, low to high. Use E2/E3 for paired strings.</div><label className="field"><span>Name</span><input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="My tuning" /></label><label className="field"><span>Notes</span><input value={customNotes} onChange={(event) => setCustomNotes(event.target.value)} placeholder={selectedPreset ? tuningSummary(selectedPreset) : ""} /></label><div className="row"><button className="btn" onClick={saveCustom}>SAVE CUSTOM</button>{selectedPreset && custom.some((item) => item.id === selectedPreset.id) && <button className="btn btn-danger" onClick={removeCustom}>DELETE SELECTED</button>}</div>{customError && <div className="tuner-setting-error">{customError}</div>}</section>}
            <section className="panel stack"><h2>CALIBRATION</h2><Range label="Reference pitch (A4 Hz)" value={referencePitch} min={420} max={460} step={1} onChange={(value) => save({ referencePitch: value })} /></section>
            <section className="panel stack"><h2>AUDIO</h2><div className="muted">Source: guitar input {num(obj(engine.state.audio).guitarInput, 1)} · Audible mode bypasses the entire processed mix.</div><Choice label="When tuner opens" value={bool(settings.muteOnOpen, true) ? "mute" : "live"} choices={[["mute", "Mute output"], ["live", "Dry passthrough"]]} onChange={(value) => save({ muteOnOpen: value === "mute" })} /><Choice label="Detection boost" value={str(settings.detectionBoostMode, "auto")} choices={[["auto", "Auto"], ["manual", "Manual"]]} onChange={(value) => save({ detectionBoostMode: value })} />{str(settings.detectionBoostMode, "auto") === "manual" && <Range label="Detection boost (dB)" value={num(settings.detectionBoostDb)} min={0} max={24} step={6} onChange={(value) => save({ detectionBoostDb: value })} />}<Range label="Low-level cutoff" value={threshold} min={0.0005} max={0.02} step={0.0005} onChange={(value) => save({ threshold: value })} /><div className="muted">Detection boost affects pitch analysis only, never passthrough, recording or preset gain.</div></section>
            <section className="panel stack"><h2>DETECTION / DISPLAY</h2><Range label="Smoothing" value={smoothing} min={0} max={0.9} step={0.05} onChange={(value) => save({ smoothing: value })} /><Choice label="In-tune tolerance" value={String(tolerance)} choices={[["1", "±1¢"], ["2", "±2¢"], ["3", "±3¢"], ["5", "±5¢"]]} onChange={(value) => save({ tolerance: Number(value) })} /><div className="tuner-option-grid">{[["showFrequency", "Frequency"], ["showCents", "Cents"], ["showOctave", "Octave"], ["showString", "String number"], ["showInputLevel", "Input level"]].map(([key, label]) => <button key={key} className={`btn ${bool(settings[key], true) ? "btn-active" : ""}`} onClick={() => save({ [key]: !bool(settings[key], true) })}>{label.toUpperCase()}</button>)}</div></section>
        </div>}
    </div>;
}

function TuningDiagram({ profileLabel, stringLabel, courses, baseCourses, showConcert, selected, locked, onLock, compact, stage }: { profileLabel: string; stringLabel: string; courses: string[][]; baseCourses: string[][]; showConcert: boolean; selected?: Target; locked: string; onLock: (value: string) => void; compact: boolean; stage: boolean }) {
    const visible = stage && selected ? [selected.courseIndex] : courses.map((_, index) => index);
    return <aside className={`tuner-instrument${compact ? " compact" : ""}${stage ? " stage" : ""}`}><div className="tuner-instrument-head"><strong>{profileLabel.toUpperCase()}</strong><button className={!locked ? "active" : ""} onClick={() => onLock("")}>AUTO</button></div><div className="tuner-strings" data-mfx-nav-list="tuner-strings">{visible.map((courseIndex) => <div className={`tuner-course${selected?.courseIndex === courseIndex ? " detected" : ""}`} key={courseIndex}><span>{stringLabel} {courses.length - courseIndex}</span><div className="tuner-course-lines">{courses[courseIndex].map((note, noteIndex) => { const id = `${courseIndex}:${noteIndex}`; const label = showConcert ? note : baseCourses[courseIndex]?.[noteIndex] ?? note; return <button key={id} className={`${locked === id ? "locked" : ""}${selected?.courseIndex === courseIndex && selected.noteIndex === noteIndex ? " active" : ""}`} onClick={() => onLock(locked === id ? "" : id)} title={`Lock to ${note}`}><i style={{ height: `${Math.max(2, 7 - courseIndex * 0.65)}px` }} /><b>{label}</b>{!showConcert && label !== note && <small>sounds {note}</small>}</button>; })}</div></div>)}</div></aside>;
}

function Range({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) { return <label className="field tuner-range"><span>{label}</span><input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /><strong>{value}</strong></label>; }
function Choice({ label, value, choices, onChange }: { label: string; value: string; choices: string[][]; onChange: (value: string) => void }) { return <div className="field"><span>{label}</span><div className="row">{choices.map(([id, text]) => <button key={id} className={`btn ${value === id ? "btn-active" : ""}`} onClick={() => onChange(id)}>{text.toUpperCase()}</button>)}</div></div>; }
