export function ConfirmDialog({
    title,
    body,
    confirmLabel = "OK",
    danger = false,
    onCancel,
    onConfirm
}: {
    title: string;
    body?: string;
    confirmLabel?: string;
    danger?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <div className="mfx-overlay">
            <div className="mfx-overlay-card">
                <div className={`mfx-overlay-title${danger ? " danger" : ""}`}>{title}</div>
                {body && <p className="muted" style={{ margin: 0 }}>{body}</p>}
                <div className="row" style={{ justifyContent: "flex-end" }}>
                    <button type="button" className="btn" onClick={onCancel}>CANCEL</button>
                    <button
                        type="button"
                        className={`btn ${danger ? "btn-danger" : "btn-accent"}`}
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
