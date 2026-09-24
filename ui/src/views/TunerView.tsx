import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMeters, type EngineSnapshot } from "../api";
import { bool, num, obj, str, type JsonObject } from "../json";

type TunerStyle = "needle" | "strobe" | "bar" | "arc" | "minimal" | "stage";
type TunerMode = "chromatic" | "guitar" | "bass";

const STYLES: { id: TunerStyle; label: string }[] = [
    { id: "needle", label: "Needle" }, { id: "strobe", label: "Strobe" },
    { id: "bar", label: "Horizontal Bar" }, { id: "arc", label: "Arc" },
    { id: "minimal", label: "Minimal" }, { id: "stage", label: "Stage" }
];
const TUNINGS: Record<string, { label: string; notes: string[] }> = {
    standard: { label: "Standard", notes: ["E2", "A2", "D3", "G3", "B3", "E4"] },
    dropD: { label: "Drop D", notes: ["D2", "A2", "D3", "G3", "B3", "E4"] },
    eb: { label: "Eb Standard", notes: ["D#2", "G#2", "C#3", "F#3", "A#3", "D#4"] },
    dStandard: { label: "D Standard", notes: ["D2", "G2", "C3", "F3", "A3", "D4"] },
    openG: { label: "Open G", notes: ["D2", "G2", "D3", "G3", "B3", "D4"] },
    openD: { label: "Open D", notes: ["D2", "A2", "D3", "F#3", "A3", "D4"] }
};

const defaults: JsonObject = {
    style: "needle", mode: "chromatic", tuning: "standard", referencePitch: 440,
    threshold: 0.0025, muteOnOpen: true, smoothing: 0.68, tolerance: 2,
    showFrequency: true, showCents: true, showOctave: true, showString: true,
    showInputLevel: true, strobeSpeed: 1
};

function noteFromFrequency(frequency: number, reference: number) {
    if (!(frequency > 0)) return { note: "—", pitchClass: "—", octave: "", cents: 0, midi: -1 };
    const midiFloat = 69 + 12 * Math.log2(frequency / reference);
    const midi = Math.round(midiFloat);
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const pitchClass = names[((midi % 12) + 12) % 12];
    const octave = String(Math.floor(midi / 12) - 1);
    return { note: `${pitchClass}${octave}`, pitchClass, octave, midi, cents: (midiFloat - midi) * 100 };
}

export function TunerView({ engine, run }: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const meters = useMeters(engine.client);
    const live = obj(meters.tuner);
    const stored = obj(obj(engine.state.ui).tuner);
    const settings = { ...defaults, ...stored } as JsonObject;
    const [tab, setTab] = useState<"tuner" | "settings">("tuner");
    const [smoothFrequency, setSmoothFrequency] = useState(0);
    const lastValid = useRef(0);
    const valid = bool(live.valid);
    const frequency = num(live.frequency);
    const smoothing = Math.max(0, Math.min(0.92, num(settings.smoothing, 0.68)));
    useEffect(() => {
        if (!valid || frequency <= 0) return;
        lastValid.current = Date.now();
        setSmoothFrequency((previous) => {
            if (previous <= 0 || Math.abs(1200 * Math.log2(frequency / previous)) > 80) return frequency;
            return previous * smoothing + frequency * (1 - smoothing);
        });
    }, [valid, frequency, smoothing]);
    const shown = valid || Date.now() - lastValid.current < 350;
    const referencePitch = num(settings.referencePitch, 440);
    const detected = noteFromFrequency(shown ? smoothFrequency : 0, referencePitch);
    const mode = str(settings.mode, "chromatic") as TunerMode;
    const selectedTuning = TUNINGS[str(settings.tuning, "standard")] ?? TUNINGS.standard;
    const tuning = mode === "bass"
        ? { label: "Bass Standard", notes: ["E1", "A1", "D2", "G2"] }
        : selectedTuning;
    let correctedFrequency = smoothFrequency;
    let stringIndex = -1;
    if (mode !== "chromatic" && shown) {
        let bestError = Number.POSITIVE_INFINITY;
        for (let index = 0; index < tuning.notes.length; ++index) {
            const stringMidi = noteFromName(tuning.notes[index]);
            const stringFrequency = referencePitch * Math.pow(2, (stringMidi - 69) / 12);
            // Guitar pickups can emphasize an octave or higher harmonic more
            // strongly than the fundamental. Fold those candidates back to
            // the configured open string before choosing the string target.
            for (const harmonic of [0.5, 1, 2, 3, 4]) {
                const error = Math.abs(1200 * Math.log2(smoothFrequency / (stringFrequency * harmonic)));
                if (error < bestError) {
                    bestError = error;
                    stringIndex = index;
                    correctedFrequency = smoothFrequency / harmonic;
                }
            }
        }
    }
    const targetMidi = stringIndex >= 0 ? noteFromName(tuning.notes[stringIndex]) : detected.midi;
    const targetFrequency = referencePitch * Math.pow(2, (targetMidi - 69) / 12);
    const cents = shown && targetFrequency > 0 ? 1200 * Math.log2(correctedFrequency / targetFrequency) : 0;
    const target = stringIndex >= 0 ? noteFromFrequency(targetFrequency, referencePitch) : detected;
    const tolerance = num(settings.tolerance, 2);
    const inTune = shown && Math.abs(cents) <= tolerance;
    const direction = !shown ? "PLAY A NOTE" : inTune ? "IN TUNE" : cents < 0 ? "FLAT" : "SHARP";
    const save = (patch: JsonObject) => void run(() => engine.client.request("ui/settings", { tuner: { ...settings, ...patch } }));
    const style = str(settings.style, "needle") as TunerStyle;
    const meterPosition = Math.max(0, Math.min(100, 50 + cents));
    const level = Math.max(0, Math.min(1, num(meters.inputPeak)));

    return <div className={`tuner-view tuner-style-${style}${inTune ? " is-in-tune" : ""}`}>
        <div className="tuner-tabs" role="tablist">
            <button className={tab === "tuner" ? "active" : ""} onClick={() => setTab("tuner")}>TUNER</button>
            <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>SETTINGS</button>
        </div>
        {tab === "tuner" ? <div className="tuner-stage">
            <div className="tuner-status-row"><span>{mode.toUpperCase()} · {tuning.label.toUpperCase()}</span><strong className={bool(live.outputMuted) ? "muted-output" : ""}>{bool(live.outputMuted) ? "OUTPUT MUTED" : bool(live.dryPassthrough) ? "DRY PASSTHROUGH" : "OUTPUT LIVE"}</strong></div>
            <div className="tuner-note">{shown ? (bool(settings.showOctave, true) ? target.note : target.pitchClass) : "—"}</div>
            <div className="tuner-direction">{direction}</div>
            <div className="tuner-display" aria-label={`${cents.toFixed(1)} cents`}>
                <div className="tuner-scale"><i style={{ left: `${meterPosition}%` }} /><b>0</b></div>
                {style === "strobe" && <div className="tuner-strobe" style={{ "--strobe-offset": `${cents * num(settings.strobeSpeed, 1)}px` } as CSSProperties} />}
            </div>
            <div className="tuner-readouts">
                {bool(settings.showCents, true) && <div><span>CENTS</span><strong>{shown ? `${cents >= 0 ? "+" : ""}${cents.toFixed(1)}¢` : "—"}</strong></div>}
                {bool(settings.showFrequency, true) && <div><span>FREQUENCY</span><strong>{shown ? `${correctedFrequency.toFixed(1)} Hz` : "—"}</strong></div>}
                {bool(settings.showString, true) && mode !== "chromatic" && <div><span>STRING</span><strong>{stringIndex >= 0 ? `${tuning.notes.length - stringIndex} · ${tuning.notes[stringIndex]}` : "—"}</strong></div>}
            </div>
            {bool(settings.showInputLevel, true) && <div className="tuner-input"><span>INPUT</span><div><i style={{ width: `${level * 100}%` }} /></div></div>}
        </div> : <div className="tuner-settings page-scroll" data-mfx-sync-scroll="tuner-settings">
            <section className="panel stack"><h2>APPEARANCE</h2><div className="tuner-style-grid">{STYLES.map((item) => <button key={item.id} className={style === item.id ? "active" : ""} onClick={() => save({ style: item.id })}><i className={`preview-${item.id}`}><b /></i><span>{item.label}</span></button>)}</div>
                {style === "strobe" && <Range label="Strobe speed" value={num(settings.strobeSpeed, 1)} min={0.5} max={2} step={0.1} onChange={(value) => save({ strobeSpeed: value })} />}</section>
            <section className="panel stack"><h2>TUNING</h2><Choice label="Mode" value={mode} choices={[['chromatic','Chromatic'],['guitar','Guitar'],['bass','Bass']]} onChange={(value) => save({ mode: value })} />
                <label className="field"><span>Tuning preset</span><select value={str(settings.tuning)} onChange={(event) => save({ tuning: event.target.value })}>{Object.entries(TUNINGS).map(([id, item]) => <option key={id} value={id}>{item.label} · {item.notes.join(" ")}</option>)}</select></label></section>
            <section className="panel stack"><h2>CALIBRATION</h2><Range label="Reference pitch (A4 Hz)" value={num(settings.referencePitch, 440)} min={420} max={460} step={1} onChange={(value) => save({ referencePitch: value })} /></section>
            <section className="panel stack"><h2>AUDIO</h2><div className="muted">Source: guitar input {num(obj(engine.state.audio).guitarInput, 1)} · Audible mode bypasses the entire processed mix.</div><Choice label="When tuner opens" value={bool(settings.muteOnOpen, true) ? "mute" : "live"} choices={[['mute','Mute output'],['live','Dry passthrough']]} onChange={(value) => save({ muteOnOpen: value === "mute" })} />
                <Range label="Sensitivity / input threshold" value={num(settings.threshold, .0025)} min={.0005} max={.02} step={.0005} onChange={(value) => save({ threshold: value })} /></section>
            <section className="panel stack"><h2>DETECTION / DISPLAY</h2><Range label="Smoothing" value={smoothing} min={0} max={.9} step={.05} onChange={(value) => save({ smoothing: value })} />
                <Choice label="In-tune tolerance" value={String(tolerance)} choices={[['1','±1¢'],['2','±2¢'],['3','±3¢'],['5','±5¢']]} onChange={(value) => save({ tolerance: Number(value) })} />
                <div className="tuner-option-grid">{[['showFrequency','Frequency'],['showCents','Cents'],['showOctave','Octave'],['showString','String number'],['showInputLevel','Input level']].map(([key,label]) => <button key={key} className={`btn ${bool(settings[key], true) ? "btn-active" : ""}`} onClick={() => save({ [key]: !bool(settings[key], true) })}>{label.toUpperCase()}</button>)}</div></section>
        </div>}
    </div>;
}

function noteFromName(note: string): number {
    const match = /^([A-G])(#?)(-?\d)$/.exec(note);
    if (!match) return 69;
    const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    return (Number(match[3]) + 1) * 12 + base[match[1]] + (match[2] ? 1 : 0);
}
function Range({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
    return <label className="field tuner-range"><span>{label}</span><input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /><strong>{value}</strong></label>;
}
function Choice({ label, value, choices, onChange }: { label: string; value: string; choices: string[][]; onChange: (value: string) => void }) {
    return <div className="field"><span>{label}</span><div className="row">{choices.map(([id, text]) => <button key={id} className={`btn ${value === id ? "btn-active" : ""}`} onClick={() => onChange(id)}>{text.toUpperCase()}</button>)}</div></div>;
}
