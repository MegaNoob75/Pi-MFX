import { useEffect, useRef, useState } from "react";
import type { EngineSnapshot } from "../api";
import { str, type JsonObject } from "../json";
import { LibraryBrowser } from "./LibraryManager";

export function DrumSampleBrowser({ engine, run, onPick, onClose }: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    onPick: (relative: string) => void;
    onClose: () => void;
}) {
    const [selected, setSelected] = useState<JsonObject | null>(null);
    const [preview, setPreview] = useState(true);
    const [error, setError] = useState("");
    const audio = useRef<HTMLAudioElement | null>(null);
    const timer = useRef<number>();
    const stop = () => { window.clearTimeout(timer.current); audio.current?.pause(); audio.current = null; };
    const play = (item: JsonObject) => {
        stop(); setError("");
        const sound = new Audio(`/api/drums/library/audio?relative=${encodeURIComponent(str(item.relative))}`);
        sound.loop = true; audio.current = sound;
        void sound.play().catch(() => setError("Preview could not play. Check browser audio permission."));
        timer.current = window.setTimeout(stop, 5000);
    };
    useEffect(() => () => stop(), []);
    return <div className="dialog-backdrop"><div className="dialog drum-sample-dialog">
        <div className="row"><strong>DRUM SAMPLES</strong>
            <button type="button" className={`btn${preview ? " btn-active" : ""}`} onClick={() => { setPreview(!preview); stop(); }}>AUTO PREVIEW {preview ? "ON" : "OFF"}</button>
            <button type="button" className="btn" onClick={() => { stop(); onClose(); }}>CLOSE</button></div>
        <LibraryBrowser engine={engine} run={run} kind="drumsample" dualDefault={false}
            onFileSelect={(item) => { setSelected(item); if (preview) play(item); else stop(); }} />
        {error && <div className="error-banner">{error}</div>}
        <div className="row"><span className="muted">{selected ? str(selected.relative) : "Select a WAV. Preview loops for five seconds."}</span>
            <button type="button" className="btn" disabled={!selected} onClick={() => selected && play(selected)}>PREVIEW</button>
            <button type="button" className="btn btn-accent" disabled={!selected} onClick={() => { if (selected) { stop(); onPick(str(selected.relative)); } }}>USE SAMPLE</button></div>
    </div></div>;
}
