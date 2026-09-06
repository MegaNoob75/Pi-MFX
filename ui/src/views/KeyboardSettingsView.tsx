import { useEffect, useRef, useState } from "react";
import { loadKeyboardMode, saveKeyboardMode, type KeyboardMode } from "../keyboard/mode";
import {
    DEFAULT_KEYBOARD_APPEARANCE,
    loadKeyboardAppearance,
    saveKeyboardAppearance,
    type KeyboardAppearance,
    type KeyboardKeyShape,
    type KeyboardPlacement,
    type KeyboardSize,
    type KeyboardTextSize
} from "../keyboard/settings";
import {
    loadCustomMultiFXKeyboardThemes,
    resolveMultiFXKeyboardTheme
} from "../keyboard/keyboardTheme";
import {
    BUILT_IN_THEMES,
    loadCustomMultiFXThemes,
    MFX_COLORS,
    MFX_SURFACES,
    themePaintToCss
} from "../theme/theme";

export function KeyboardSettingsView() {
    const [mode, setMode] = useState<KeyboardMode>(loadKeyboardMode);
    const [appearance, setAppearance] = useState(loadKeyboardAppearance);
    const [message, setMessage] = useState("");
    const customUiThemes = loadCustomMultiFXThemes();
    const keyboardThemes = loadCustomMultiFXKeyboardThemes();
    const preview = resolveMultiFXKeyboardTheme(appearance.themeId);
    const themeListRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setAppearance(loadKeyboardAppearance());
        setMode(loadKeyboardMode());
    }, []);

    useEffect(() => {
        const node = themeListRef.current?.querySelector(".theme-pick.selected");
        node?.scrollIntoView({ block: "center", behavior: "auto" });
    }, [appearance.themeId]);

    const applyAppearance = (next: KeyboardAppearance) => {
        saveKeyboardAppearance(next);
        setAppearance(next);
        setMessage("Applied. The next keyboard opened will use these settings.");
    };

    const applyMode = (next: KeyboardMode) => {
        saveKeyboardMode(next);
        setMode(next);
        setMessage("Keyboard mode saved.");
    };

    return (
        <div className="page-scroll stack">
            <div className="panel stack">
                <h2>ON-SCREEN KEYBOARD</h2>
                <div className="muted">
                    Auto uses this keyboard on the Pi kiosk and on tablets. On uses it
                    everywhere. Off uses the system popup.
                </div>
                <div className="row">
                    {(["auto", "on", "off"] as KeyboardMode[]).map((item) => (
                        <button
                            key={item}
                            type="button"
                            className={`btn ${mode === item ? "btn-active" : ""}`}
                            onClick={() => applyMode(item)}
                        >
                            {item.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>

            <div className="panel stack" ref={themeListRef}>
                <h2>KEYBOARD THEMES</h2>
                <div className="muted">
                    Keyboard colours come from the selected theme. Custom keyboard
                    themes you save in Theme → Keyboard appear here.
                </div>
                <button
                    type="button"
                    className={`theme-pick${appearance.themeId === "current" ? " selected" : ""}`}
                    onClick={() => applyAppearance({ ...appearance, themeId: "current" })}
                >
                    <strong>Match current UI theme</strong>
                    <span className="muted">Follows SET THEME</span>
                </button>
                <div className="field-label">BUILT-IN THEMES</div>
                <div className="theme-pick-list">
                    {BUILT_IN_THEMES.map((theme) => {
                        const id = `builtin:${theme.name}`;
                        return (
                            <button
                                key={id}
                                type="button"
                                className={`theme-pick${appearance.themeId === id ? " selected" : ""}`}
                                onClick={() => applyAppearance({ ...appearance, themeId: id })}
                            >
                                <strong>{theme.name}</strong>
                            </button>
                        );
                    })}
                </div>
                {customUiThemes.length > 0 && (
                    <>
                        <div className="field-label">MY UI THEMES</div>
                        <div className="theme-pick-list">
                            {customUiThemes.map((theme) => {
                                const id = `ui-custom:${theme.name}`;
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        className={`theme-pick${appearance.themeId === id ? " selected" : ""}`}
                                        onClick={() => applyAppearance({ ...appearance, themeId: id })}
                                    >
                                        <strong>{theme.name}</strong>
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}
                {keyboardThemes.length > 0 && (
                    <>
                        <div className="field-label">CUSTOM KEYBOARD THEMES</div>
                        <div className="theme-pick-list">
                            {keyboardThemes.map((theme) => {
                                const id = `keyboard:${theme.name}`;
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        className={`theme-pick${appearance.themeId === id ? " selected" : ""}`}
                                        onClick={() => applyAppearance({ ...appearance, themeId: id })}
                                    >
                                        <strong>{theme.name}</strong>
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}
                <KeyboardPreview settings={appearance} />
            </div>

            <div className="panel stack">
                <h2>APPEARANCE</h2>
                <label className="field">
                    <span>Key shape</span>
                    <select
                        value={appearance.keyShape}
                        onChange={(event) => applyAppearance({
                            ...appearance,
                            keyShape: event.target.value as KeyboardKeyShape
                        })}
                    >
                        <option value="rounded">Rounded</option>
                        <option value="square">Square</option>
                    </select>
                </label>
                <label className="field">
                    <span>Key text size</span>
                    <select
                        value={appearance.textSize}
                        onChange={(event) => applyAppearance({
                            ...appearance,
                            textSize: event.target.value as KeyboardTextSize
                        })}
                    >
                        <option value="normal">Normal</option>
                        <option value="large">Large</option>
                        <option value="extra-large">Extra Large</option>
                    </select>
                </label>
                <label className="field">
                    <span>Keyboard size</span>
                    <select
                        value={appearance.size}
                        onChange={(event) => applyAppearance({
                            ...appearance,
                            size: event.target.value as KeyboardSize
                        })}
                    >
                        <option value="full">Full screen</option>
                        <option value="large">Large — 85%</option>
                        <option value="compact">Compact — 72%</option>
                    </select>
                </label>
                <label className="field">
                    <span>Placement</span>
                    <select
                        value={appearance.placement}
                        onChange={(event) => applyAppearance({
                            ...appearance,
                            placement: event.target.value as KeyboardPlacement
                        })}
                    >
                        <option value="top">Top</option>
                        <option value="center">Center</option>
                        <option value="bottom">Bottom</option>
                    </select>
                </label>
                <div className="row">
                    <button
                        type="button"
                        className={`btn ${appearance.hapticFeedback ? "btn-active" : ""}`}
                        onClick={() => applyAppearance({
                            ...appearance,
                            hapticFeedback: !appearance.hapticFeedback
                        })}
                    >
                        TOUCH VIBRATION
                    </button>
                    <button
                        type="button"
                        className={`btn ${appearance.transparentBackground ? "btn-active" : ""}`}
                        onClick={() => applyAppearance({
                            ...appearance,
                            transparentBackground: !appearance.transparentBackground
                        })}
                    >
                        TRANSPARENT BACKGROUND
                    </button>
                    <button
                        type="button"
                        className="btn"
                        onClick={() => {
                            saveKeyboardMode("on");
                            setMode("on");
                            applyAppearance({ ...DEFAULT_KEYBOARD_APPEARANCE });
                            setMessage("Keyboard defaults restored.");
                        }}
                    >
                        RESTORE DEFAULTS
                    </button>
                </div>
            </div>
            {message && <div className="muted">{message}</div>}
            <div className="muted">Live preview uses “{preview.name}”.</div>
        </div>
    );
}

function KeyboardPreview({ settings }: { settings: KeyboardAppearance }) {
    const theme = resolveMultiFXKeyboardTheme(settings.themeId);
    const radius = settings.keyShape === "square" ? 2 : 8;
    const key = (label: string, pressed = false, color?: string) => (
        <div style={{
            flex: 1,
            padding: "8px 4px",
            textAlign: "center",
            borderRadius: radius,
            border: `1px solid ${theme.border}`,
            background: themePaintToCss(pressed ? theme.pressedKey : theme.key),
            color: color ?? (pressed ? theme.pressedText : theme.text),
            fontWeight: 900
        }}>
            {label}
        </div>
    );
    return (
        <div style={{
            padding: 10,
            borderRadius: 10,
            border: `1px solid ${MFX_COLORS.border}`,
            background: settings.transparentBackground
                ? "transparent"
                : themePaintToCss(theme.backdrop)
        }}>
            <div style={{
                marginBottom: 8,
                color: MFX_SURFACES.panel.accent,
                fontWeight: 900,
                fontSize: "0.82rem"
            }}>
                LIVE KEYBOARD PREVIEW — {theme.name}
            </div>
            <div style={{
                padding: 10,
                borderRadius: settings.keyShape === "square" ? 2 : 10,
                border: settings.transparentBackground ? "none" : `2px solid ${theme.border}`,
                background: settings.transparentBackground
                    ? "transparent"
                    : themePaintToCss(theme.panel)
            }}>
                <div style={{ color: theme.accent, fontWeight: 900, marginBottom: 6 }}>PRESET NAME</div>
                <div style={{
                    padding: 8,
                    marginBottom: 8,
                    borderRadius: radius,
                    border: `2px solid ${theme.accent}`,
                    background: themePaintToCss(theme.valueBox),
                    color: theme.text
                }}>
                    My Preset
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                    {key("A")}
                    {key("B", true)}
                    {key("CANCEL", false, theme.cancel)}
                    {key("DONE", false, theme.accent)}
                </div>
            </div>
        </div>
    );
}
