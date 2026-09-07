import { useEffect } from "react";
import { arr, str, type Json, type JsonObject } from "../json";
import { applyUserScale } from "../responsive";
import { applyMultiFXTheme, resolveTheme } from "./theme";
import "./performance.css";

export function ThemeRoot({ ui }: { ui: JsonObject }) {
    useEffect(() => {
        const theme = resolveTheme(str(ui.themeId, "Pi-MFX Purple"), arr(ui.customThemes));
        applyMultiFXTheme(theme);
        applyUserScale(Number(ui.scale) || 1);
    }, [ui.themeId, ui.customThemes, ui.scale]);
    return null;
}

export function persistThemeSettings(
    ui: JsonObject,
    themeName: string,
    customThemes: unknown[],
    ledColors: Record<string, string>
): JsonObject {
    return {
        ...ui,
        themeId: themeName,
        customThemes: customThemes as Json,
        ledColors: ledColors as unknown as Json
    };
}
