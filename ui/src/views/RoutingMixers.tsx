import { useEffect, useRef, useState } from "react";
import { controlValue, type EngineClient } from "../api";
import { bool, num, obj, objects, str, type JsonObject } from "../json";
import { blendLevels, blendRange } from "./cabinetBlend";

const CAB_URI = "http://two-play.com/plugins/toob-cab-ir";
const symbols = ["reverb_mix", "reverb_mix2", "reverb_mix3"];
function fileName(path: string) { return (path.split(/[\\/]/).pop() || path).replace(/\.(nam|wav|aiff?|flac)$/i, ""); }
const files = ["impulseFile", "impulseFile2", "impulseFile3"];
function preference(key: string) { try { return localStorage.getItem(key) !== "sliders"; } catch { return true; } }
function ViewChoice({ graph, set, storage }: { graph: boolean; set: (value: boolean) => void; storage: string }) {
    return <div className="routing-view-choice">{[true, false].map(value => <button key={String(value)} type="button"
        className={`btn ${graph === value ? "btn-active" : ""}`} aria-pressed={graph === value}
        onClick={() => { set(value); try { localStorage.setItem(storage, value ? "graphical" : "sliders"); } catch { /* Browser storage optional. */ } }}>
        {value ? "GRAPHICAL" : "SLIDERS"}</button>)}</div>;
}
function Level({ label, displayLabel, value, min = -60, max = 12, onChange, slider = true }: {
    label: string; displayLabel?: string; value: number; min?: number; max?: number; slider?: boolean; onChange: (value: number) => void;
}) {
    const [editing, setEditing] = useState(false);
    return <label className="routing-level"><span><span className="routing-level-name" title={label}>{displayLabel ?? label}</span> <button type="button" className="btn" aria-label={`${label}: ${value.toFixed(1)} dB`} onClick={e => { e.preventDefault(); setEditing(!editing); }}>{value.toFixed(1)} dB</button></span>
        {editing ? <input className="input" type="number" step="0.1" min={min} max={max} value={value}
            onChange={e => { if (e.target.value !== "") onChange(Math.max(min, Math.min(max, Number(e.target.value)))); }} />
            : slider ? <input type="range" aria-label={label} min={min} max={max} step="0.1" value={value} onChange={e => onChange(Number(e.target.value))} /> : null}
    </label>;
}
export function RoutingMixers({ blocks, routing, selected, onSelected, client, onEdit, onRouting }: {
    blocks: JsonObject[]; routing: JsonObject; selected: string; onSelected: (id: string) => void;
    client: EngineClient; onEdit: (id: string) => void; onRouting: (routing: JsonObject) => void;
}) {
    const [rigGraphic, setRigGraphic] = useState(() => preference("pimfx-routing-mix-view"));
    const [cabGraphic, setCabGraphic] = useState(() => preference("pimfx-cab-mix-view"));
    const [cabId, setCabId] = useState("");
    const [message, setMessage] = useState("");
    type CabDraft = { id: string; values: number[] };
    type BlendIntent = { id: string; weights: number[]; amplitude: number };
    const [cabDraft, setCabDraft] = useState<CabDraft | null>(null);
    const draftRef = useRef<CabDraft | null>(null);
    const blendRef = useRef<BlendIntent | null>(null);
    const observed = useRef("");
    const pending = useRef<{ id: string; values: number[] } | null>(null);
    const sending = useRef(false);
    const edges = objects(routing.edges);
    const mixes = [...blocks.filter(b => str(b.kind) === "mixer" || edges.filter(e => str(e.to) === str(b.id)).length > 1), { id: "output", name: "Output mix" }];
    const mixerId = mixes.some(m => str(m.id) === selected) ? selected : str(mixes[0].id);
    const inputs = edges.map((e, index): JsonObject & { index: number } => ({ ...e, index })).filter(e => str(e.to) === mixerId);
    const cabinets = blocks.filter(b => str(b.uri) === CAB_URI);
    const cab = cabinets.find(b => str(b.id) === cabId) ?? cabinets[0];
    const actualCabId = str(cab?.id);

    const loaded = files.map((file, index) => {
        const path = str(obj(obj(cab?.state).properties)[`${CAB_URI}#${file}`]);
        const port = objects(obj(cab?.plugin).ports).find(p => str(p.symbol) === symbols[index]);
        return { index, path, min: num(port?.minimum, -40), max: num(port?.maximum, 20),
            name: fileName(path) || `Cabinet ${index + 1}` };
    }).filter(c => c.path !== "");
    const backendValues = symbols.map(symbol => controlValue(cab ?? {}, symbol, 0));
    const backendKey = `${actualCabId}:${backendValues.join(":")}:${loaded.map(c => c.path).join(":")}`;
    useEffect(() => {
        const draft = draftRef.current;
        if (draft && draft.id !== actualCabId) { draftRef.current = null; blendRef.current = null; setCabDraft(null); }
        else if (draft) {
            // Intermediate/late acknowledgements must not undo the latest gesture.
            if (!sending.current && backendValues.every((v, i) => Math.abs(v - draft.values[i]) < .01)) {
                draftRef.current = null; setCabDraft(null);
            }
        } else if (observed.current !== backendKey) blendRef.current = null;
        observed.current = backendKey;
    }, [backendKey, cabDraft]);
    const values = cabDraft?.id === actualCabId ? cabDraft.values : backendValues;
    const amplitudes = loaded.map(c => values[c.index] <= c.min ? 0 : 10 ** (values[c.index] / 20));
    const actualTotal = amplitudes.reduce((a, b) => a + b, 0);
    const intent = (cabDraft || observed.current === backendKey) && blendRef.current?.id === actualCabId && blendRef.current.weights.length === loaded.length ? blendRef.current : null;
    const total = intent?.amplitude ?? actualTotal;
    const weights = intent?.weights ?? amplitudes.map(a => actualTotal ? a / actualTotal : 1 / Math.max(1, loaded.length));
    // The lowest endpoint is where the last audible cabinet reaches its mute
    // floor. The highest is where the first cabinet reaches its maximum.
    const { min: blendMinimum, max: blendMaximum } = blendRange(loaded, weights);
    const cabWrite = (next: number[], blend: BlendIntent | null = null) => {
        blendRef.current = blend;
        const draft = { id: actualCabId, values: next };
        draftRef.current = draft; setCabDraft(draft); pending.current = draft;
        if (sending.current) return;
        sending.current = true;
        void (async () => {
            try {
                while (pending.current) {
                    const item = pending.current; pending.current = null;
                    await client.request("chain/controls", { slotId: item.id,
                        controls: symbols.map((port, i) => ({ port, value: item.values[i] })) });
                }
            } catch (error) { pending.current = null; draftRef.current = null; blendRef.current = null; setCabDraft(null); setMessage(error instanceof Error ? error.message : "Could not update cabinets"); }
            finally {
                sending.current = false;
                // Reconcile only after the complete queue has finished, even
                // when the final server state arrived before the HTTP reply.
                if (draftRef.current) setCabDraft({ ...draftRef.current });
            }
        })();
    };
    const setBlend = (proportions: number[], amplitude?: number) => {
        if (!loaded.length) return;
        // Read the latest intent synchronously, even if React hasn't rendered
        // between pointer events. Moving the dot keeps a fixed blend level.
        const latest = blendRef.current?.id === actualCabId ? blendRef.current : null;
        const requested = amplitude ?? latest?.amplitude ?? total;
        const next = blendLevels(loaded, proportions, requested, draftRef.current?.id === actualCabId ? draftRef.current.values : values);
        cabWrite(next.values, { id: actualCabId, weights: proportions, amplitude: next.amplitude });
    };
    const localRouting = useRef(routing);
    useEffect(() => { localRouting.current = routing; }, [routing]);
    const changeEdge = (index: number, patch: JsonObject) => {
        const next = { ...localRouting.current, edges: objects(localRouting.current.edges).map((e, i) => i === index ? { ...e, ...patch } : e) };
        localRouting.current = next; onRouting(next);
    };
    const modelNames = (id: string, visited = new Set<string>()): string[] => {
        if (visited.has(id)) return [];
        visited.add(id);
        const block = blocks.find(b => str(b.id) === id);
        const paths = Object.values(obj(obj(block?.state).properties)).map(v => str(v));
        const models = paths.filter(path => /\.nam$/i.test(path)).map(fileName);
        if (models.length) return models;
        return edges.filter(e => str(e.to) === id).flatMap(e => modelNames(str(e.from), visited));
    };
    const label = (id: string) => {
        const models = [...new Set(modelNames(id))];
        if (models.length) return models.join(" + ");
        const block = blocks.find(b => str(b.id) === id);
        const impulses = Object.values(obj(obj(block?.state).properties)).map(v => str(v)).filter(v => /\.(wav|aiff?|flac)$/i.test(v));
        return impulses.length ? impulses.map(fileName).join(" / ") : str(block?.name, id === "input" ? "Input" : "Branch");
    };
    const touchPan = (event: React.PointerEvent<HTMLDivElement>, index: number) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const pan = Math.round((Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * 2 - 1) * 100) / 100;
        changeEdge(index, { pan });
    };
    return <div className="routing-mix-panels">
        <section className={`panel routing-mix-panel ${rigGraphic ? "is-graphical" : "is-sliders"}`}><div className="routing-mix-heading"><h2>RIG MIX</h2><ViewChoice graph={rigGraphic} set={setRigGraphic} storage="pimfx-routing-mix-view" /></div>
            <select className="input" aria-label="Routing mixer" value={mixerId} onChange={e => onSelected(e.target.value)}>
                {mixes.map(m => <option key={str(m.id)} value={str(m.id)}>{str(m.name)}</option>)}</select>
            {!inputs.length && <p className="muted">Connect branches to this mixer to adjust their blend.</p>}
            {inputs.map((e, i) => <div key={e.index} className={`routing-mix-channel mix-color-${i % 3}`}>
                <strong title={label(str(e.from))}>{i + 1} · {label(str(e.from))}</strong>
                <div className="routing-pan-caption"><span>Pan · {num(e.pan) === 0 ? "Center" : `${num(e.pan) < 0 ? "Left" : "Right"} ${Math.round(Math.abs(num(e.pan)) * 100)}%`}</span><span>Left · Center · Right</span></div>
                {rigGraphic ? <div className="routing-pan-graphic">
                    <div className="routing-pan-track" role="slider" tabIndex={0} aria-label={`Pan ${label(str(e.from))}`}
                        aria-valuemin={-1} aria-valuemax={1} aria-valuenow={num(e.pan)} aria-valuetext={num(e.pan) === 0 ? "Center" : `${num(e.pan) < 0 ? "Left" : "Right"} ${Math.round(Math.abs(num(e.pan)) * 100)}%`}
                        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); touchPan(event, e.index); }}
                        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) touchPan(event, e.index); }}
                        onKeyDown={event => {
                            const current = num(objects(localRouting.current.edges)[e.index]?.pan);
                            const pan = event.key === "Home" ? -1 : event.key === "End" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? Math.max(-1, current - .01) : event.key === "ArrowRight" || event.key === "ArrowUp" ? Math.min(1, current + .01) : null;
                            if (pan !== null) { event.preventDefault(); changeEdge(e.index, { pan: Math.round(pan * 100) / 100 }); }
                        }}>
                        <span className="routing-pan-center" /><span className="routing-pan-dot" style={{ left: `${(num(e.pan) + 1) * 50}%` }}>{i + 1}</span>
                    </div>
                </div> : <label className="routing-pan"><input type="range" aria-label={`Pan ${label(str(e.from))}`} min="-1" max="1" step="0.01" value={num(e.pan)} onChange={event => changeEdge(e.index, { pan: Number(event.target.value) })} /></label>}
                <div className="routing-channel-controls">
                    <Level displayLabel="Volume" label={`${label(str(e.from))} volume`} value={num(e.levelDb)} onChange={levelDb => changeEdge(e.index, { levelDb })} />
                    <button className={`btn ${bool(e.mute) ? "btn-active" : ""}`} aria-pressed={bool(e.mute)} onClick={() => changeEdge(e.index, { mute: !bool(e.mute) })} aria-label={`Mute ${label(str(e.from))}`}>MUTE</button>
                    <button className={`btn ${bool(e.solo) ? "btn-active" : ""}`} aria-pressed={bool(e.solo)} onClick={() => changeEdge(e.index, { solo: !bool(e.solo) })} aria-label={`Solo ${label(str(e.from))}`}>SOLO</button>
                </div>
            </div>)}
        </section>
        <section className={`panel routing-mix-panel ${cabGraphic ? "is-graphical" : "is-sliders"}`}><div className="routing-mix-heading"><h2>CABINET MIX</h2><ViewChoice graph={cabGraphic} set={setCabGraphic} storage="pimfx-cab-mix-view" /></div>
            {!cab ? <p className="muted">Add a TooB Cab IR block to blend its cabinets here.</p> : <>
                <div className="routing-cab-selector"><select className="input" aria-label="Cab IR instance" value={actualCabId} onChange={e => setCabId(e.target.value)}>
                    {cabinets.map((c, i) => <option key={str(c.id)} value={str(c.id)}>{i + 1} · {str(c.name, "Cab IR")}</option>)}</select><button className="btn" aria-label="Cabinet files and plugin controls" title="Files & plugin controls" onClick={() => onEdit(actualCabId)}>FILES</button></div>
                {!loaded.length && <p className="muted">Load cabinets in this plugin’s controls to begin.</p>}
                {cabGraphic && loaded.length === 3 && <div className="routing-cab-triangle" role="group" aria-label="Three cabinet blend"
                    onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); const a = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)); const b = Math.max(0, Math.min(1 - a, (1 - a) / 2 - ((e.clientX - r.left) / r.width - .5))); setBlend([a, b, 1 - a - b]); }}
                    onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const r = e.currentTarget.getBoundingClientRect(); const a = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)); const b = Math.max(0, Math.min(1 - a, (1 - a) / 2 - ((e.clientX - r.left) / r.width - .5))); setBlend([a, b, 1 - a - b]); }}>
                    <div className="routing-triangle-fill" /><span className="routing-cab-point" style={{ left: `${(weights[0] * .5 + weights[2]) * 100}%`, top: `${(1 - weights[0]) * 100}%` }} />
                    <span className="routing-cab-number cab-top" title={loaded[0].name}>{loaded[0].name}</span><span className="routing-cab-number cab-left" title={loaded[1].name}>{loaded[1].name}</span><span className="routing-cab-number cab-right" title={loaded[2].name}>{loaded[2].name}</span>
                </div>}
                {loaded.length === 1 && <p className="routing-single-note muted">One cabinet loaded · adjust its volume below. Load another cabinet to blend.</p>}
                {cabGraphic && loaded.length === 2 && <div className="routing-two-cabs" role="group" aria-label="Two cabinet blend"
                    onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); setBlend([1 - x, x]); }}
                    onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const r = e.currentTarget.getBoundingClientRect(); const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); setBlend([1 - x, x]); }}>
                    <span className="routing-axis-name axis-y" title={loaded[0].name}>{loaded[0].name}</span><span className="routing-axis-name axis-x" title={loaded[1].name}>{loaded[1].name}</span>
                    <span className="routing-cab-point" style={{ left: `${weights[1] * 100}%`, top: "50%" }} />
                </div>}
                {cabGraphic && loaded.length > 1 && <Level label={total ? "Blend level" : "Blend level · muted"}
                    value={total ? Math.max(blendMinimum, 20 * Math.log10(total)) : blendMinimum} min={blendMinimum} max={blendMaximum}
                    onChange={level => setBlend(blendRef.current?.id === actualCabId ? blendRef.current.weights : weights,
                        level <= blendMinimum + .001 ? 0 : 10 ** (level / 20))} />}
                {loaded.length > 0 && <div className="routing-pan-caption">Cabinet volumes</div>}
                <div className={`routing-cab-levels ${loaded.length > 1 && cabGraphic ? "has-blend" : ""}`} style={cabGraphic && loaded.length > 1 ? { gridTemplateColumns: `repeat(${loaded.length}, minmax(0, 1fr))` } : undefined}>{loaded.map((c, i) => <div key={c.index} className={`routing-cab-level mix-color-${i}`} title={c.name}><Level label={`${c.name} volume${values[c.index] <= c.min ? " · muted" : ""}`}
                    value={values[c.index]} min={c.min} max={c.max} onChange={value => { const next = [...values]; next[c.index] = value; cabWrite(next); }} /></div>)}
                </div>
            </>}
            {message && <div className="muted" role="status">{message}</div>}
        </section>
    </div>;
}
