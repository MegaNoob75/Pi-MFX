import { KEYBOARD_THEMES_CHANGED_EVENT } from "./keyboardTheme";
import { loadKeyboardMode, saveKeyboardMode, type KeyboardMode } from "./mode";

export type KeyboardKeyShape = "rounded" | "square";
export type KeyboardTextSize = "normal" | "large" | "extra-large";
export type KeyboardSize = "full" | "large" | "compact";
export type KeyboardPlacement = "top" | "center" | "bottom";

export interface KeyboardAppearance {
    version: 1;
    transparentBackground: boolean;
    themeId: string;
    keyShape: KeyboardKeyShape;
    textSize: KeyboardTextSize;
    hapticFeedback: boolean;
    size: KeyboardSize;
    placement: KeyboardPlacement;
}

export const KEYBOARD_APPEARANCE_KEY = "pimfx-keyboard-appearance";
export const KEYBOARD_APPEARANCE_EVENT = "pimfx-keyboard-appearance";

export const DEFAULT_KEYBOARD_APPEARANCE: KeyboardAppearance = {
    version: 1,
    transparentBackground: false,
    themeId: "current",
    keyShape: "rounded",
    textSize: "large",
    hapticFeedback: true,
    size: "full",
    placement: "center"
};

function isKeyShape(value: unknown): value is KeyboardKeyShape {
    return value === "rounded" || value === "square";
}

function isTextSize(value: unknown): value is KeyboardTextSize {
    return value === "normal" || value === "large" || value === "extra-large";
}

function isSize(value: unknown): value is KeyboardSize {
    return value === "full" || value === "large" || value === "compact";
}

function isPlacement(value: unknown): value is KeyboardPlacement {
    return value === "top" || value === "center" || value === "bottom";
}

export function loadKeyboardAppearance(): KeyboardAppearance {
    try {
        const raw = window.localStorage.getItem(KEYBOARD_APPEARANCE_KEY);
        if (raw) {
            const value = JSON.parse(raw) as Record<string, unknown>;
            return {
                ...DEFAULT_KEYBOARD_APPEARANCE,
                transparentBackground: typeof value.transparentBackground === "boolean"
                    ? value.transparentBackground
                    : false,
                themeId: typeof value.themeId === "string" ? value.themeId : "current",
                keyShape: isKeyShape(value.keyShape) ? value.keyShape : "rounded",
                textSize: isTextSize(value.textSize) ? value.textSize : "large",
                hapticFeedback: typeof value.hapticFeedback === "boolean" ? value.hapticFeedback : true,
                size: isSize(value.size) ? value.size : "full",
                placement: isPlacement(value.placement) ? value.placement : "center"
            };
        }
    } catch {
        // private mode
    }
    return { ...DEFAULT_KEYBOARD_APPEARANCE };
}

export function saveKeyboardAppearance(settings: KeyboardAppearance): void {
    window.localStorage.setItem(KEYBOARD_APPEARANCE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new Event(KEYBOARD_APPEARANCE_EVENT));
}

export function onKeyboardAppearanceChange(listener: () => void): () => void {
    window.addEventListener(KEYBOARD_APPEARANCE_EVENT, listener);
    window.addEventListener(KEYBOARD_THEMES_CHANGED_EVENT, listener);
    window.addEventListener("storage", listener);
    return () => {
        window.removeEventListener(KEYBOARD_APPEARANCE_EVENT, listener);
        window.removeEventListener(KEYBOARD_THEMES_CHANGED_EVENT, listener);
        window.removeEventListener("storage", listener);
    };
}

export interface KeyboardSettings extends KeyboardAppearance {
    mode: KeyboardMode;
}

export function normalizeKeyboardSettings(value: unknown): KeyboardSettings {
    const source = value && typeof value === "object" ? value as Partial<KeyboardSettings> : {};
    return {
        ...DEFAULT_KEYBOARD_APPEARANCE,
        mode: source.mode === "on" || source.mode === "off" ? source.mode : "auto",
        themeId: typeof source.themeId === "string" ? source.themeId.replace(/^custom:/, "ui-custom:") : "current",
        keyShape: isKeyShape(source.keyShape) ? source.keyShape : DEFAULT_KEYBOARD_APPEARANCE.keyShape,
        textSize: isTextSize(source.textSize) ? source.textSize : DEFAULT_KEYBOARD_APPEARANCE.textSize,
        size: isSize(source.size) ? source.size : DEFAULT_KEYBOARD_APPEARANCE.size,
        placement: isPlacement(source.placement) ? source.placement : DEFAULT_KEYBOARD_APPEARANCE.placement,
        hapticFeedback: typeof source.hapticFeedback === "boolean" ? source.hapticFeedback : DEFAULT_KEYBOARD_APPEARANCE.hapticFeedback,
        transparentBackground: typeof source.transparentBackground === "boolean" ? source.transparentBackground : false
    };
}

export function loadKeyboardSettings(): KeyboardSettings {
    return normalizeKeyboardSettings({ ...loadKeyboardAppearance(), mode: loadKeyboardMode() });
}

export function saveKeyboardSettings(settings: KeyboardSettings): void {
    saveKeyboardMode(settings.mode);
    const { mode: _mode, ...appearance } = settings;
    saveKeyboardAppearance(appearance);
}
