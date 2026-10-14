import { useEffect, useId, useRef } from "react";

export function ConfirmDialog({
    title,
    body,
    confirmLabel = "OK",
    danger = false,
    showCancel = true,
    onCancel,
    onConfirm
}: {
    title: string;
    body?: string;
    confirmLabel?: string;
    danger?: boolean;
    showCancel?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const titleId = useId();
    const bodyId = useId();
    const card = useRef<HTMLDivElement>(null);
    const cancelRef = useRef(onCancel);
    cancelRef.current = onCancel;
    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        card.current?.querySelector<HTMLButtonElement>("button")?.focus();
        const keydown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault(); event.stopPropagation(); cancelRef.current();
            } else if (event.key === "Tab") {
                const buttons = Array.from(card.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
                if (!buttons.length) return;
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index + 1) % buttons.length;
                event.preventDefault(); buttons[next].focus();
            }
        };
        const overlay = card.current?.closest(".mfx-overlay");
        // Nested dialogs own their own keyboard focus.
        const listener = (event: KeyboardEvent) => {
            const overlays = document.querySelectorAll(".mfx-overlay");
            if (overlays[overlays.length - 1] === overlay) keydown(event);
        };
        document.addEventListener("keydown", listener, true);
        return () => {
            document.removeEventListener("keydown", listener, true);
            if (previous?.isConnected) previous.focus();
        };
    }, []);
    return (
        <div className="mfx-overlay">
            <div ref={card} className="mfx-overlay-card" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={body ? bodyId : undefined}>
                <div id={titleId} className={`mfx-overlay-title${danger ? " danger" : ""}`}>{title}</div>
                {body && <p id={bodyId} className="muted" style={{ margin: 0 }}>{body}</p>}
                <div className="row" style={{ justifyContent: "flex-end" }}>
                    {showCancel && <button type="button" className="btn" onClick={onCancel}>CANCEL</button>}
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
