import { useRef, type PointerEvent } from "react";
import { bool, num, str, type JsonObject } from "../json";

type Input = JsonObject & { index: number };
const MIN = -60, MAX = 12;
const gain = (db: number) => 10 ** (db / 20);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// Blend controls write the existing connection gains in one routing update.
// No extra mix state is required in presets or snapshots.
export function RigMixControls({ inputs, graphical, label, onChange }: {
    inputs: Input[]; graphical: boolean; label: (id: string) => string;
    onChange: (patches: { index: number; patch: JsonObject }[]) => void;
}) {
    const intent = useRef<{ key: string; levels: string; weights: number[]; total: number } | null>(null);
    const key = JSON.stringify(inputs.map(e => [e.from, e.to]));
    const levels = inputs.map(e => num(e.levelDb));
    const saved = intent.current;
    const current = saved?.key === key && saved.levels === JSON.stringify(levels) ? saved : null;
    if (!current) intent.current = null;
    const amplitudes = levels.map(gain);
    const total = current?.total ?? amplitudes.reduce((a, b) => a + b, 0);
    const weights = current?.weights ?? amplitudes.map(a => a / total);
    const maximum = weights.length ? Math.min(...weights.map(w => w > 0 ? MAX - 20 * Math.log10(w) : Infinity)) : MAX;
    const mixDb = clamp(20 * Math.log10(total), MIN, maximum);
    const writeBlend = (nextWeights: number[], requested = total) => {
        // Use the latest gesture even before React has rendered its routing update.
        const ceiling = Math.min(...nextWeights.map(w => w > 0 ? gain(MAX) / w : Infinity));
        const nextTotal = Math.min(requested, ceiling);
        const nextLevels = nextWeights.map(w => clamp(w > 0 ? 20 * Math.log10(nextTotal * w) : MIN, MIN, MAX));
        intent.current = { key, levels: JSON.stringify(nextLevels), weights: nextWeights, total: nextTotal };
        onChange(inputs.map((e, i) => ({ index: e.index, patch: { levelDb: nextLevels[i] } })));
    };
    const latest = () => intent.current?.key === key ? intent.current : null;
    const setWeights = (next: number[]) => writeBlend(next, latest()?.total ?? total);
    const setLevel = (db: number) => writeBlend(latest()?.weights ?? weights, gain(db));
    const change = (e: Input, patch: JsonObject) => { intent.current = null; onChange([{ index: e.index, patch }]); };
    const name = (i: number) => `${i + 1} · ${label(str(inputs[i].from))}`;
    const triangle = (event: PointerEvent<HTMLDivElement>) => {
        const r = event.currentTarget.getBoundingClientRect();
        const a = clamp(1 - (event.clientY - r.top) / r.height, 0, 1);
        const b = clamp((1 - a) / 2 - ((event.clientX - r.left) / r.width - .5), 0, 1 - a);
        setWeights([a, b, 1 - a - b]);
    };
    if (!inputs.length) return <p className="muted">Connect branches to this mixer to adjust their blend.</p>;
    return <div className="rig-mix-controls">
        {graphical && inputs.length === 2 && <div className="rig-blend-line">
            <div className="rig-blend-names"><strong title={name(0)}>{name(0)}</strong><strong title={name(1)}>{name(1)}</strong></div>
            <input type="range" min="0" max="100" step="0.1" value={weights[1] * 100}
                aria-label="Blend between mixer inputs 1 and 2" aria-valuetext={`${Math.round(weights[0] * 100)}% input 1, ${Math.round(weights[1] * 100)}% input 2`}
                onChange={e => { const b = Number(e.target.value) / 100; setWeights([1 - b, b]); }} />
            <div className="rig-blend-percent"><span>{Math.round(weights[0] * 100)}%</span><button className="btn" onClick={() => setWeights([.5, .5])}>50 / 50</button><span>{Math.round(weights[1] * 100)}%</span></div>
        </div>}
        {graphical && inputs.length === 3 && <>
            <div className="routing-cab-triangle rig-blend-triangle" role="group" aria-label="Three path blend; use the channel blend sliders below for keyboard adjustment"
                onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); triangle(e); }}
                onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) triangle(e); }}>
                <div className="routing-triangle-fill" /><span className="routing-cab-point" style={{ left: `${(weights[0] * .5 + weights[2]) * 100}%`, top: `${(1 - weights[0]) * 100}%` }} />
                <span className="routing-cab-number cab-top" title={name(0)}>{name(0)}</span>
                <span className="routing-cab-number cab-left" title={name(1)}>{name(1)}</span>
                <span className="routing-cab-number cab-right" title={name(2)}>{name(2)}</span>
            </div>
            <button className="btn rig-equal-blend" onClick={() => setWeights([1 / 3, 1 / 3, 1 / 3])}>EQUAL BLEND</button>
        </>}
        {inputs.length > 1 && <label className="routing-level rig-mix-level"><span>Mix level <span>{mixDb.toFixed(1)} dB</span></span>
            <input type="range" aria-label="Combined mix level" min={MIN} max={maximum} step="0.1" value={mixDb} onChange={e => setLevel(Number(e.target.value))} />
        </label>}
        <div className={`rig-channels ${graphical && (inputs.length === 1 || inputs.length > 3) ? "rig-faders" : ""}`}>
            {inputs.map((e, i) => <div key={`${str(e.from)}:${str(e.to)}`} className={`routing-mix-channel mix-color-${i % 3}`}>
                <strong title={name(i)}>{name(i)}</strong>
                <label className="routing-level rig-channel-level"><span>Volume <span>{levels[i].toFixed(1)} dB</span></span>
                    <input type="range" aria-label={`${name(i)} volume`} min={MIN} max={MAX} step="0.1" value={levels[i]}
                        onChange={event => change(e, { levelDb: Number(event.target.value) })} />
                </label>
                {graphical && inputs.length === 3 && <label className="routing-level"><span>Blend <span>{Math.round(weights[i] * 100)}%</span></span>
                    <input type="range" aria-label={`${name(i)} blend percentage`} min="0" max="100" step="1" value={weights[i] * 100}
                        onChange={event => {
                            const latestWeights = latest()?.weights ?? weights;
                            const w = Number(event.target.value) / 100;
                            const others = latestWeights.reduce((sum, value, j) => sum + (j === i ? 0 : value), 0);
                            setWeights(latestWeights.map((value, j) => j === i ? w : others > 0 ? value / others * (1 - w) : (1 - w) / 2));
                        }} />
                </label>}
                <label className="routing-level rig-channel-pan"><span>Pan <span>{num(e.pan) === 0 ? "Center" : `${num(e.pan) < 0 ? "L" : "R"} ${Math.round(Math.abs(num(e.pan)) * 100)}%`}</span></span>
                    <input type="range" aria-label={`${name(i)} pan`} min="-1" max="1" step="0.01" value={num(e.pan)} onChange={event => change(e, { pan: Number(event.target.value) })} />
                </label>
                <div className="rig-channel-buttons">
                    <button className={`btn ${bool(e.mute) ? "btn-active" : ""}`} aria-label={`Mute ${name(i)}`} aria-pressed={bool(e.mute)} onClick={() => change(e, { mute: !bool(e.mute) })}>MUTE</button>
                    {inputs.length > 1 && <button className={`btn ${bool(e.solo) ? "btn-active" : ""}`} aria-label={`Solo ${name(i)}`} aria-pressed={bool(e.solo)} onClick={() => change(e, { solo: !bool(e.solo) })}>SOLO</button>}
                    <button className="btn" aria-label={`Reset ${name(i)} volume and pan`} onClick={() => change(e, { levelDb: 0, pan: 0 })}>RESET</button>
                </div>
            </div>)}
        </div>
    </div>;
}
