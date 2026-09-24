import { bool, num, type JsonObject } from "../json";
import type { EngineSnapshot } from "../api";

export function TransportView({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const transport = engine.transport;
    const bpm = num(transport.bpm, 120);
    const playing = bool(transport.playing);
    const countingIn = bool(transport.countingIn);

    const configure = (patch: JsonObject) => run(() => engine.client.request("transport/settings", {
        beatsPerBar: num(transport.beatsPerBar, 4),
        beatUnit: num(transport.beatUnit, 4),
        countInBars: num(transport.countInBars, 0),
        metronomeEnabled: bool(transport.metronomeEnabled),
        quantizationEnabled: bool(transport.quantizationEnabled),
        ...patch
    }));

    const commitBpm = (value: string) => {
        const next = Number(value);
        if (Number.isFinite(next)) void configure({ bpm: Math.max(30, Math.min(300, next)) });
    };

    return (
        <div className="page-scroll stack transport-view" data-mfx-nav-list="transport">
            <section className="panel transport-guide">
                <strong>SET YOUR TEMPO</strong>
                <span>Press TAP or your assigned hardware button 3–4 times in rhythm. Tempo Link and compatible effects follow the displayed BPM.</span>
                <span>PLAY runs the shared beat clock; it does not stop or mute your guitar audio.</span>
            </section>

            <section className="panel transport-readout">
                <div>
                    <span className="muted">TEMPO</span>
                    <strong>{bpm.toFixed(1)}</strong>
                    <span className="muted">BPM</span>
                </div>
                <div>
                    <span className="muted">BAR</span>
                    <strong>{Math.max(1, Math.trunc(num(transport.bar, 1)))}</strong>
                </div>
                <div>
                    <span className="muted">BEAT</span>
                    <strong>{num(transport.beat, 1).toFixed(2)}</strong>
                </div>
                <div>
                    <span className="muted">SAMPLE</span>
                    <strong>{Math.max(0, Math.trunc(num(transport.samplePosition)))}</strong>
                </div>
            </section>

            <section className="panel stack">
                <div className="row transport-actions">
                    <button type="button" className={`btn btn-accent${playing ? " btn-active" : ""}`}
                        onClick={() => void run(() => engine.client.request("transport/play", { restart: !playing }))}>
                        {playing ? countingIn ? "COUNTING IN" : "PLAYING" : "PLAY"}
                    </button>
                    <button type="button" className="btn" onClick={() => void run(() => engine.client.request("transport/stop"))}>STOP</button>
                    <button type="button" className="btn" onClick={() => void run(() => engine.client.request("transport/restart"))}>RESTART</button>
                    <button type="button" className="btn" onClick={() => void run(() => engine.client.request("tap"))}>TAP</button>
                </div>
                <label className="field">
                    <span>BPM</span>
                    <input key={bpm} type="number" min={30} max={300} step={0.1} defaultValue={bpm}
                        onBlur={(event) => commitBpm(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                        }} />
                    <small className="muted">Type a tempo or use TAP.</small>
                </label>
            </section>

            <section className="panel transport-settings-grid">
                <label className="field">
                    <span>Beats per bar</span>
                    <input type="number" min={1} max={32} value={num(transport.beatsPerBar, 4)}
                        onChange={(event) => void configure({ beatsPerBar: Number(event.target.value) })} />
                    <small className="muted">Top number: choose 4 for 4/4.</small>
                </label>
                <label className="field">
                    <span>Beat unit</span>
                    <select value={num(transport.beatUnit, 4)} onChange={(event) => void configure({ beatUnit: Number(event.target.value) })}>
                        {[1, 2, 4, 8, 16, 32].map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                    </select>
                    <small className="muted">Bottom number: 4 means quarter note.</small>
                </label>
                <label className="field">
                    <span>Count-in bars</span>
                    <input type="number" min={0} max={8} value={num(transport.countInBars, 0)}
                        onChange={(event) => void configure({ countInBars: Number(event.target.value) })} />
                    <small className="muted">Clicks before playback reaches bar 1.</small>
                </label>
                <div className="transport-setting">
                    <span>METRONOME</span>
                    <button type="button" className={`btn${bool(transport.metronomeEnabled) ? " btn-active" : ""}`}
                        onClick={() => void configure({ metronomeEnabled: !bool(transport.metronomeEnabled) })}>
                        {bool(transport.metronomeEnabled) ? "ON" : "OFF"}
                    </button>
                    <small className="muted">Audible click while PLAY is running.</small>
                </div>
                <div className="transport-setting">
                    <span>BEAT-SYNC CHANGES</span>
                    <button type="button" className={`btn${bool(transport.quantizationEnabled) ? " btn-active" : ""}`}
                        onClick={() => void configure({ quantizationEnabled: !bool(transport.quantizationEnabled) })}>
                        {bool(transport.quantizationEnabled) ? "ON" : "OFF"}
                    </button>
                    <small className="muted">Saved for future beat-aligned preset and snapshot changes.</small>
                </div>
            </section>
        </div>
    );
}
