import {
    BUILT_IN_THEMES,
    loadCustomMultiFXThemes,
    loadMultiFXTheme,
    MultiFXThemeDefinition,
    MultiFXThemePaint
} from "../theme/theme";

export interface MultiFXKeyboardThemeDefinition {
    version: 1;
    name: string;
    author: string;
    backdrop: MultiFXThemePaint;
    panel: MultiFXThemePaint;
    valueBox: MultiFXThemePaint;
    key: MultiFXThemePaint;
    pressedKey: MultiFXThemePaint;
    border: string;
    text: string;
    secondaryText: string;
    accent: string;
    pressedText: string;
    cancel: string;
}

export const CUSTOM_KEYBOARD_THEMES_STORAGE_KEY =
    "pimfx-custom-keyboard-themes-v1";

export function keyboardThemeFromUITheme(
    theme: MultiFXThemeDefinition
): MultiFXKeyboardThemeDefinition {
    return {
        version: 1,
        name: theme.name,
        author: theme.author,
        backdrop: structuredClone(theme.appearance.surfaces.page.background),
        panel: structuredClone(theme.appearance.surfaces.popup.background),
        valueBox: structuredClone(theme.appearance.surfaces.page.background),
        key: structuredClone(theme.appearance.roles.utility.normal.background),
        pressedKey: structuredClone(theme.appearance.roles.utility.active.background),
        border: theme.appearance.surfaces.popup.border.colors[0]
            ?? theme.colors.border,
        text: theme.appearance.surfaces.popup.text,
        secondaryText: theme.appearance.surfaces.popup.label,
        accent: theme.appearance.surfaces.popup.accent,
        pressedText: theme.appearance.roles.utility.active.label,
        cancel: theme.colors.danger
    };
}

function isColor(value: unknown): value is string {
    return typeof value === "string"
        && (/^#[0-9a-f]{6}$/i.test(value) || /^#[0-9a-f]{8}$/i.test(value));
}

function isPaint(value: unknown): value is MultiFXThemePaint {
    if (!value || typeof value !== "object") return false;
    const paint = value as Partial<MultiFXThemePaint>;
    return (paint.kind === "solid" || paint.kind === "linear"
        || paint.kind === "radial" || paint.kind === "conic")
        && Array.isArray(paint.colors)
        && paint.colors.length > 0
        && paint.colors.every(isColor)
        && typeof paint.angle === "number"
        && Number.isFinite(paint.angle);
}

export function validateMultiFXKeyboardTheme(
    value: unknown
): MultiFXKeyboardThemeDefinition | undefined {
    if (!value || typeof value !== "object") return undefined;
    const theme = value as Partial<MultiFXKeyboardThemeDefinition>;
    if (theme.version !== 1 || typeof theme.name !== "string"
        || !theme.name.trim() || typeof theme.author !== "string"
        || !isPaint(theme.backdrop) || !isPaint(theme.panel)
        || !isPaint(theme.valueBox) || !isPaint(theme.key)
        || !isPaint(theme.pressedKey) || !isColor(theme.border)
        || !isColor(theme.text) || !isColor(theme.secondaryText)
        || !isColor(theme.accent) || !isColor(theme.pressedText)
        || !isColor(theme.cancel)) return undefined;
    return structuredClone(theme as MultiFXKeyboardThemeDefinition);
}

export function loadCustomMultiFXKeyboardThemes(): MultiFXKeyboardThemeDefinition[] {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(
            CUSTOM_KEYBOARD_THEMES_STORAGE_KEY
        ) ?? "[]") as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.map(validateMultiFXKeyboardTheme)
            .filter((theme): theme is MultiFXKeyboardThemeDefinition => !!theme);
    } catch {
        return [];
    }
}

export function saveCustomMultiFXKeyboardTheme(
    theme: MultiFXKeyboardThemeDefinition
): MultiFXKeyboardThemeDefinition[] {
    const valid = validateMultiFXKeyboardTheme(theme);
    if (!valid) return loadCustomMultiFXKeyboardThemes();
    const next = loadCustomMultiFXKeyboardThemes()
        .filter((item) => item.name.toLowerCase() !== valid.name.toLowerCase());
    next.push(valid);
    next.sort((a, b) => a.name.localeCompare(b.name));
    window.localStorage.setItem(CUSTOM_KEYBOARD_THEMES_STORAGE_KEY, JSON.stringify(next, null, 2));
    return next;
}

export function deleteCustomMultiFXKeyboardTheme(
    name: string
): MultiFXKeyboardThemeDefinition[] {
    const next = loadCustomMultiFXKeyboardThemes()
        .filter((item) => item.name.toLowerCase() !== name.toLowerCase());
    window.localStorage.setItem(CUSTOM_KEYBOARD_THEMES_STORAGE_KEY, JSON.stringify(next, null, 2));
    return next;
}

/** Resolve every keyboard selector source through one shared code path. */
export function resolveMultiFXKeyboardTheme(
    themeId: string
): MultiFXKeyboardThemeDefinition {
    if (themeId.startsWith("keyboard:")) {
        const name = themeId.slice("keyboard:".length);
        const saved = loadCustomMultiFXKeyboardThemes()
            .find((theme) => theme.name === name);
        if (saved) return saved;
    }
    if (themeId.startsWith("builtin:")) {
        const name = themeId.slice("builtin:".length);
        return keyboardThemeFromUITheme(BUILT_IN_THEMES.find(
            (theme) => theme.name === name
        ) ?? loadMultiFXTheme());
    }
    if (themeId.startsWith("ui-custom:") || themeId.startsWith("custom:")) {
        const prefix = themeId.startsWith("ui-custom:") ? "ui-custom:" : "custom:";
        const name = themeId.slice(prefix.length);
        return keyboardThemeFromUITheme(loadCustomMultiFXThemes().find(
            (theme) => theme.name === name
        ) ?? loadMultiFXTheme());
    }
    return keyboardThemeFromUITheme(loadMultiFXTheme());
}
