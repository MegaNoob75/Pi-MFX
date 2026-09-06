import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LETTER_ROWS, NUMERIC_ROWS, SYMBOL_ROWS, type KeyboardLayer, type KeyboardLayout } from "./layouts";
import { eraseSelection, overlayRoot, replaceSelection, type EditableElement } from "./utils";
import "./Keyboard.css";

export interface KeyboardSession {
    id: number;
    target: EditableElement | null;
    label: string;
    layout: KeyboardLayout;
    value: string;
    selectionStart: number;
    selectionEnd: number;
    resolve?: (value: string | null) => void;
}

export function Keyboard({
    session,
    onCancel,
    onDone
}: {
    session: KeyboardSession;
    onCancel: () => void;
    onDone: (value: string) => void;
}) {
    const [value, setValue] = useState(session.value);
    const [selection, setSelection] = useState({
        start: session.selectionStart,
        end: session.selectionEnd
    });
    const [layer, setLayer] = useState<KeyboardLayer>("letters");
    const [shift, setShift] = useState(false);
    const [caps, setCaps] = useState(false);

    const insert = (text: string) => {
        const result = replaceSelection(value, selection.start, selection.end, text);
        setValue(result.value);
        setSelection({ start: result.start, end: result.end });
        if (shift && !caps) {
            setShift(false);
        }
    };

    const erase = () => {
        const result = eraseSelection(value, selection.start, selection.end);
        setValue(result.value);
        setSelection({ start: result.start, end: result.end });
    };

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey) {
                return;
            }
            if (event.key === "Enter") {
                event.preventDefault();
                onDone(value);
            } else if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
            } else if (event.key === "Backspace") {
                event.preventDefault();
                erase();
            } else if (event.key.length === 1) {
                event.preventDefault();
                insert(event.key);
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    });

    const letterRows = LETTER_ROWS.map((row) => row.map((letter) => (
        shift !== caps ? letter.toUpperCase() : letter
    )));
    const rows = session.layout === "numeric"
        ? NUMERIC_ROWS
        : layer === "symbols" ? SYMBOL_ROWS : letterRows;

    const before = value.slice(0, selection.start);
    const selected = value.slice(selection.start, selection.end);
    const after = value.slice(selection.end);

    const key = (label: string, action: () => void, className = "") => (
        <button
            type="button"
            className={`pimfx-keyboard-key ${className}`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={action}
        >
            {label}
        </button>
    );

    return createPortal(
        <div className="pimfx-keyboard-backdrop" role="dialog" aria-modal="true" aria-label={`Keyboard for ${session.label}`}>
            <div className="pimfx-keyboard-panel">
                <div className="pimfx-keyboard-value">
                    <div className="pimfx-keyboard-label">{session.label}</div>
                    <div className="pimfx-keyboard-text">
                        {before}
                        {selected
                            ? <span className="pimfx-keyboard-selection">{selected}</span>
                            : <span className="pimfx-keyboard-caret" />}
                        {after || "\u00a0"}
                    </div>
                </div>
                <div className="pimfx-keyboard-rows">
                    {rows.map((row, rowIndex) => (
                        <div className="pimfx-keyboard-row" key={rowIndex}>
                            {row.map((character) => key(character, () => insert(character)))}
                        </div>
                    ))}
                    {session.layout === "text" && layer === "letters" && (
                        <div className="pimfx-keyboard-row">
                            {key("⇧", () => {
                                if (shift) {
                                    setCaps(true);
                                    setShift(false);
                                } else if (caps) {
                                    setCaps(false);
                                } else {
                                    setShift(true);
                                }
                            }, shift || caps ? "is-active is-wide" : "is-wide")}
                            {key("⌫", erase, "is-wide")}
                        </div>
                    )}
                </div>
                <div className="pimfx-keyboard-row">
                    {session.layout === "text" && key(
                        layer === "letters" ? "123" : "ABC",
                        () => setLayer(layer === "letters" ? "symbols" : "letters"),
                        "is-wide"
                    )}
                    {session.layout === "text" && key("SPACE", () => insert(" "), "is-space")}
                    {session.layout === "numeric" && key("⌫", erase, "is-wide")}
                    {key("CANCEL", onCancel, "is-wide is-cancel")}
                    {key("DONE", () => onDone(value), "is-wide is-done")}
                </div>
            </div>
        </div>,
        overlayRoot()
    );
}
