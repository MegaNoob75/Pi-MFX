import { useMemo, type MouseEvent } from "react";
import { num, type Json } from "../json";

export function WaveformTimeline({
    peaks,
    position = 0,
    duration = 0,
    bpm = 0,
    beatsPerBar = 4,
    emptyText = "No waveform available.",
    onSeek
}: {
    peaks: Json[];
    position?: number;
    duration?: number;
    bpm?: number;
    beatsPerBar?: number;
    emptyText?: string;
    onSeek?: (seconds: number) => void;
}) {
    const values = useMemo(() => {
        const input = peaks.map((value) => Math.max(0, Math.min(1, num(value))));
        if (input.length <= 256) return input;
        return Array.from({ length: 256 }, (_, index) => {
            const start = Math.floor(index * input.length / 256);
            const end = Math.max(start + 1, Math.floor((index + 1) * input.length / 256));
            return Math.max(...input.slice(start, end));
        });
    }, [peaks]);
    const shape = useMemo(() => {
        if (!values.length) return "";
        const top = values.map((peak, index) => `${index / Math.max(1, values.length - 1) * 1000},${50 - peak * 46}`);
        const bottom = values.map((peak, index) => `${(values.length - 1 - index) / Math.max(1, values.length - 1) * 1000},${50 + peak * 46}`);
        return [...top, ...bottom].join(" ");
    }, [values]);
    const barSeconds = bpm > 0 ? 60 / bpm * Math.max(1, beatsPerBar) : 0;
    const barCount = barSeconds > 0 && duration > 0 ? Math.min(64, Math.floor(duration / barSeconds) + 1) : 0;
    const seek = (event: MouseEvent<SVGSVGElement>) => {
        if (!onSeek || duration <= 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek(Math.max(0, Math.min(duration, (event.clientX - rect.left) / rect.width * duration)));
    };

    if (!values.length) return <div className="waveform-timeline waveform-empty"><span className="muted">{emptyText}</span></div>;
    const progress = duration > 0 ? Math.max(0, Math.min(1000, position / duration * 1000)) : 0;
    return <div className={`waveform-timeline${onSeek ? " seekable" : ""}`}>
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label="Audio waveform timeline"
            onClick={seek}>
            <line className="waveform-center" x1="0" y1="50" x2="1000" y2="50" />
            {Array.from({ length: barCount }, (_, index) => {
                const x = index * barSeconds / duration * 1000;
                return <line className="waveform-bar" key={index} x1={x} y1="0" x2={x} y2="100" />;
            })}
            <polygon className="waveform-shape" points={shape} />
            <line className="waveform-playhead" x1={progress} y1="0" x2={progress} y2="100" />
        </svg>
    </div>;
}
