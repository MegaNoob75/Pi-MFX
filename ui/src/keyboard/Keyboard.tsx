import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LETTER_ROWS, NUMERIC_ROWS, SYMBOL_ROWS, type KeyboardLayer, type KeyboardLayout } from "./layouts";
import { loadKeyboardAppearance, onKeyboardAppearanceChange } from "./settings";
import { resolveMultiFXKeyboardTheme } from "./keyboardTheme";
import { themePaintToCss } from "../theme/theme";
import {
    caretIndexAtClientX,
    eraseSelection,
    overlayRoot,
    replaceSelection,
    sanitizePaste,
    type EditableElement
} from "./utils";
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
    const [appearance, setAppearance] = useState(loadKeyboardAppearance);
    const keyboardTheme = resolveMultiFXKeyboardTheme(appearance.themeId);
    const textRef = useRef<HTMLDivElement>(null);
    const draggingCaret = useRef(false);

    useEffect(() => onKeyboardAppearanceChange(() => setAppearance(loadKeyboardAppearance())), []);

    const insert = (text: string) => {
        if (appearance.hapticFeedback) {
            navigator.vibrate?.(8);
        }
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

    const moveCursor = (amount: number, extend: boolean) => {
        const cursor = Math.max(0, Math.min(value.length, selection.end + amount));
        setSelection(extend
            ? { start: Math.min(selection.start, cursor), end: Math.max(selection.start, cursor) }
            : { start: cursor, end: cursor });
    };

    const placeCaret = (clientX: number, extend: boolean) => {
        const root = textRef.current;
        if (!root) {
            return;
        }
        const cursor = caretIndexAtClientX(root, clientX, value.length);
        setSelection((current) => extend
            ? { start: Math.min(current.start, cursor), end: Math.max(current.start, cursor) }
            : { start: cursor, end: cursor });
    };

    const pasteText = (raw: string) => {
        const text = sanitizePaste(raw, session.layout, session.target);
        if (text) {
            insert(text);
        }
    };

    useEffect(() => {
        let pasteHandled = false;
        const onKey = (event: KeyboardEvent) => {
            if (event.altKey) {
                return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
                pasteHandled = false;
                window.setTimeout(() => {
                    if (pasteHandled) {
                        return;
                    }
                    void navigator.clipboard?.readText?.().then(pasteText).catch(() => undefined);
                }, 0);
                return;
            }
            if (event.ctrlKey || event.metaKey) {
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
            } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                moveCursor(-1, event.shiftKey);
            } else if (event.key === "ArrowRight") {
                event.preventDefault();
                moveCursor(1, event.shiftKey);
            } else if (event.key.length === 1) {
                event.preventDefault();
                insert(event.key);
            }
        };
        const onPaste = (event: ClipboardEvent) => {
            const text = event.clipboardData?.getData("text/plain")
                || event.clipboardData?.getData("text")
                || "";
            if (!text) {
                return;
            }
            event.preventDefault();
            pasteHandled = true;
            pasteText(text);
        };
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("paste", onPaste, true);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            window.removeEventListener("paste", onPaste, true);
        };
    });

    const letterRows = LETTER_ROWS.map((row) => row.map((letter) => (
        shift !== caps ? letter.toUpperCase() : letter
    )));
    const rows = session.layout === "numeric"
        ? NUMERIC_ROWS
        : layer === "symbols" ? SYMBOL_ROWS : letterRows;

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
        <div
            className={[
                "pimfx-keyboard-backdrop",
                appearance.transparentBackground ? "is-transparent" : "",
                `is-${appearance.placement}`,
                `is-${appearance.size}`,
                `is-text-${appearance.textSize}`,
                `is-keys-${appearance.keyShape}`
            ].filter(Boolean).join(" ")}
            role="dialog"
            aria-modal="true"
            aria-label={`Keyboard for ${session.label}`}
            style={{
                ["--mfx-text" as string]: keyboardTheme.text,
                ["--mfx-border" as string]: keyboardTheme.border,
                ["--mfx-panel" as string]: themePaintToCss(keyboardTheme.panel),
                ["--mfx-bg" as string]: themePaintToCss(keyboardTheme.valueBox),
                ["--mfx-cyan" as string]: keyboardTheme.accent,
                ["--mfx-cyan-text" as string]: keyboardTheme.pressedText,
                ["--mfx-cyan-surface" as string]: themePaintToCss(keyboardTheme.pressedKey),
                ["--mfx-danger" as string]: keyboardTheme.cancel,
                background: appearance.transparentBackground
                    ? "transparent"
                    : themePaintToCss(keyboardTheme.backdrop)
            }}
        >
            <div className="pimfx-keyboard-panel">
                <div
                    className="pimfx-keyboard-value"
                    onPointerDown={(event) => {
                        if ((event.target as HTMLElement).closest(".pimfx-keyboard-label")) {
                            return;
                        }
                        event.preventDefault();
                        try {
                            event.currentTarget.setPointerCapture(event.pointerId);
                        } catch {
                            // Capture can fail on synthetic events; still place the caret.
                        }
                        draggingCaret.current = true;
                        placeCaret(event.clientX, event.shiftKey);
                    }}
                    onPointerMove={(event) => {
                        if (!draggingCaret.current) {
                            return;
                        }
                        placeCaret(event.clientX, event.shiftKey);
                    }}
                    onPointerUp={() => {
                        draggingCaret.current = false;
                    }}
                    onPointerCancel={() => {
                        draggingCaret.current = false;
                    }}
                >
                    <div className="pimfx-keyboard-label">{session.label}</div>
                    <div
                        ref={textRef}
                        className="pimfx-keyboard-text"
                        role="textbox"
                        aria-readonly="true"
                        aria-label={`${session.label} text`}
                    >
                        {Array.from(value).map((character, index) => (
                            <span key={index}>
                                {selection.start === selection.end && selection.start === index && (
                                    <span className="pimfx-keyboard-caret" />
                                )}
                                <span
                                    data-k-i={index}
                                    className={index >= selection.start && index < selection.end
                                        ? "pimfx-keyboard-selection"
                                        : undefined}
                                >
                                    {character}
                                </span>
                            </span>
                        ))}
                        {selection.start === selection.end && selection.start === value.length && (
                            <span className="pimfx-keyboard-caret" />
                        )}
                        <span data-k-i={value.length} className="pimfx-keyboard-text-end">{"\u00a0"}</span>
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
