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
    preview = false
}: {
    label: string;
    peak: number;
    preview?: boolean;
}) {
    const db = peakToDb(preview ? 0.32 : peak);
    const fill = dbToFill(db);
    return (
        <div className={`gain-meter${preview ? " is-preview" : ""}`} data-tone={meterTone(db)}>
            <div className="gain-meter-label">{label}</div>
            <div className="gain-meter-track" aria-hidden="true">
                <span className="gain-meter-fill" style={{ height: `${Math.round(fill * 100)}%` }} />
            </div>
            <strong className="gain-meter-value">{formatDb(db)}</strong>
        </div>
    );
}
