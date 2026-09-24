import { useEffect, useRef, useState } from "react";

const CLIP_HOLD_MS = 1500;

function peakToDb(peak: number): number {
    if (!Number.isFinite(peak) || peak <= 0.00001) {
        return -60;
    }
    return Math.max(-60, 20 * Math.log10(peak));
}

function dbToFill(db: number): number {
    return Math.min(1, Math.max(0, (db + 60) / 60));
}

function meterTone(db: number): "ok" | "hot" | "clip" {
    if (db >= -3) {
        return "clip";
    }
    if (db >= -12) {
        return "hot";
    }
    return "ok";
}

function formatDb(db: number): string {
    if (db <= -59.5) {
        return "−∞";
    }
    const rounded = Math.round(db);
    return `${rounded > 0 ? "+" : ""}${rounded} dB`;
}

export function GainMeter({
    label,
    peak,
    orientation = "vertical",
    preview = false
}: {
    label: string;
    peak: number;
    orientation?: "vertical" | "horizontal";
    preview?: boolean;
}) {
    const displayedPeak = preview ? 0.32 : peak;
    const db = peakToDb(displayedPeak);
    const fill = dbToFill(db);
    const unfilledPercent = 100 - Math.round(fill * 100);
    const [clipLatched, setClipLatched] = useState(false);
    const clipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (preview || displayedPeak < 1) {
            return;
        }
        setClipLatched(true);
        if (clipTimer.current !== null) {
            clearTimeout(clipTimer.current);
        }
        clipTimer.current = setTimeout(() => {
            setClipLatched(false);
            clipTimer.current = null;
        }, CLIP_HOLD_MS);
    }, [displayedPeak, preview]);

    useEffect(() => () => {
        if (clipTimer.current !== null) {
            clearTimeout(clipTimer.current);
        }
    }, []);

    const clipIndicator = (
        <div className={`gain-meter-clip${clipLatched ? " is-active" : ""}`} aria-label={clipLatched ? `${label} clipping` : undefined}>
            CLIP
        </div>
    );
    const value = <strong className="gain-meter-value">{formatDb(db)}</strong>;

    return (
        <div className={`gain-meter is-${orientation}${preview ? " is-preview" : ""}`} data-tone={meterTone(db)}>
            <div className="gain-meter-label">{label}</div>
            <div className="gain-meter-body">
                <div className="gain-meter-track" aria-hidden="true">
                    <span
                        className="gain-meter-cover"
                        style={orientation === "horizontal"
                            ? { width: `${unfilledPercent}%` }
                            : { height: `${unfilledPercent}%` }}
                    />
                </div>
                {orientation === "horizontal" ? value : clipIndicator}
            </div>
            {orientation === "horizontal" ? clipIndicator : value}
        </div>
    );
}
