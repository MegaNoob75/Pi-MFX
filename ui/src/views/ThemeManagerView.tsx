import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    applyMultiFXTheme,
    BUILT_IN_THEMES,
    CUSTOM_THEMES_STORAGE_KEY,
    deleteCustomMultiFXTheme,
    getMultiFXThemeStyleLabel,
    loadCustomMultiFXThemes,
    loadMultiFXTheme,
    MultiFXThemeDefinition,
    MultiFXThemeControlRole,
    MultiFXThemeControlState,
    MultiFXThemePaint,
    MultiFXThemeSurface,
    saveCustomMultiFXTheme,
    saveMultiFXTheme,
    themePaintToCss,
    validateMultiFXTheme,
    MULTIFX_FONT_OPTIONS,
    MFX_COLORS,
    MFX_SURFACES,
    multiFXFontFamilyToCss,
    multiFXSurfaceBackground
} from "../theme/theme";
import MultiFXFootswitchGraphic, {
    MultiFXArcadeButtonGraphic
} from "../theme/FootswitchGraphic";
import "../theme/performance.css";
import {
    CUSTOM_KEYBOARD_THEMES_STORAGE_KEY,
    deleteCustomMultiFXKeyboardTheme,
    keyboardThemeFromUITheme,
    loadCustomMultiFXKeyboardThemes,
    MultiFXKeyboardThemeDefinition,
    saveCustomMultiFXKeyboardTheme,
    validateMultiFXKeyboardTheme
} from "../keyboard/keyboardTheme";
import type { EngineSnapshot } from "../api";
import { obj, str, type JsonObject } from "../json";
import { updateUiSessionSection } from "../uiSession";
import { LibraryJsonPicker } from "./LibraryManager";
import { ConfirmDialog } from "./ConfirmDialog";

type ThemeBrowseMode = "STYLE" | "COLOR";

type ThemeCategory =
    | "COLORFUL"
    | "DARK"
    | "LIGHT"
    | "AMP / VINTAGE"
    | "STUDIO / NEUTRAL"
    | "TERMINAL / HIGH CONTRAST";

type ThemeEditorTab =
    | "COLORS"
    | "SURFACES"
    | "TILES"
    | "CONTROLS"
    | "MOTION"
    | "FONTS"
    | "KEYBOARD";

const STYLE_CATEGORY_ORDER = [
    "MODERN TILES",
    "STUDIO TILES",
    "METAL STOMPBOX",
    "GLASS PANELS",
    "ARCADE BUTTONS",
    "MINIMAL"
] as const;

const CATEGORY_ORDER: ThemeCategory[] = [
    "COLORFUL",
    "DARK",
    "LIGHT",
    "AMP / VINTAGE",
    "STUDIO / NEUTRAL",
    "TERMINAL / HIGH CONTRAST"
];

const AMP_VINTAGE_NAMES = new Set([
    "Boutique Blue",
    "British Stack",
    "Brownface",
    "Copper",
    "Goldtop",
    "Orange Crush",
    "Royal Gold",
    "Silverface",
    "Surf Green",
    "Tube Glow",
    "Vintage Cream"
]);

const STUDIO_NEUTRAL_NAMES = new Set([
    "Blue Steel",
    "Graphite",
    "Gunmetal",
    "Slate Purple",
    "Studio Dark",
    "Studio Warm"
]);

const TERMINAL_NAMES = new Set([
    "Blackout",
    "High Contrast",
    "Night Vision",
    "Terminal Amber",
    "Terminal Green"
]);

export default function ThemeManagerView({
    persistTheme,
    engine,
    run
}: {
    persistTheme?: (theme: MultiFXThemeDefinition) => Promise<void>;
    engine?: EngineSnapshot & { client: import("../api").EngineClient };
    run?: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const originalRef = useRef<MultiFXThemeDefinition>(loadMultiFXTheme());

    const [theme, setTheme] = useState<MultiFXThemeDefinition>(
        () => cloneTheme(originalRef.current)
    );

    const [message, setMessage] = useState("");
    const [syncingTheme, setSyncingTheme] = useState(false);
    const [editorTab, setEditorTab] =
        useState<ThemeEditorTab>("COLORS");
    const [browseMode, setBrowseMode] =
        useState<ThemeBrowseMode>("STYLE");

    const [customThemes, setCustomThemes] = useState<MultiFXThemeDefinition[]>(
        () => loadCustomMultiFXThemes()
    );
    const [keyboardTheme, setKeyboardTheme] = useState<MultiFXKeyboardThemeDefinition>(
        () => keyboardThemeFromUITheme(originalRef.current)
    );
    const [customKeyboardThemes, setCustomKeyboardThemes] = useState(
        loadCustomMultiFXKeyboardThemes
    );
    const themeListRef = useRef<HTMLDivElement>(null);
    const [activeName, setActiveName] = useState(() => originalRef.current.name);
    const [picker, setPicker] = useState<"load" | "save" | "saveAll" | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<{ kind: "ui" | "keyboard"; name: string } | null>(null);
    const applyingSharedTheme = useRef(false);
    const applyingSharedKeyboardTheme = useRef(false);
    const themeReady = useRef(false);
    const keyboardThemeReady = useRef(false);
    const themeLibrariesReady = useRef(false);
    const lastSharedTheme = useRef("");
    const lastSharedKeyboardTheme = useRef("");

    useEffect(() => {
        if (!engine) {
            return;
        }
        const shared = obj(engine.uiSession.themeManager);
        const nextTab = str(shared.editorTab) as ThemeEditorTab;
        if (["COLORS", "SURFACES", "TILES", "CONTROLS", "MOTION", "FONTS", "KEYBOARD"].includes(nextTab)) {
            setEditorTab(nextTab);
        }
        const nextBrowse = str(shared.browseMode) as ThemeBrowseMode;
        if (nextBrowse === "STYLE" || nextBrowse === "COLOR") {
            setBrowseMode(nextBrowse);
        }
        if (typeof shared.activeName === "string") {
            setActiveName(shared.activeName);
        }
        const nextPicker = str(shared.picker);
        setPicker(nextPicker === "load" || nextPicker === "save" || nextPicker === "saveAll" ? nextPicker : null);
        const deleteKind = str(shared.deleteKind);
        const deleteName = str(shared.deleteName);
        setDeleteTarget((deleteKind === "ui" || deleteKind === "keyboard") && deleteName
            ? { kind: deleteKind, name: deleteName }
            : null);
        const nextTheme = validateMultiFXTheme(shared.theme);
        const nextThemeJson = nextTheme ? JSON.stringify(nextTheme) : "";
        if (nextTheme && nextThemeJson !== lastSharedTheme.current) {
            lastSharedTheme.current = nextThemeJson;
            applyingSharedTheme.current = true;
            setTheme(cloneTheme(nextTheme));
        }
        const nextKeyboardTheme = validateMultiFXKeyboardTheme(shared.keyboardTheme);
        const nextKeyboardThemeJson = nextKeyboardTheme ? JSON.stringify(nextKeyboardTheme) : "";
        if (nextKeyboardTheme && nextKeyboardThemeJson !== lastSharedKeyboardTheme.current) {
            lastSharedKeyboardTheme.current = nextKeyboardThemeJson;
            applyingSharedKeyboardTheme.current = true;
            setKeyboardTheme(structuredClone(nextKeyboardTheme));
        }
        if (Array.isArray(shared.customThemes)) {
            const nextCustomThemes = shared.customThemes
                .map(validateMultiFXTheme)
                .filter((item): item is MultiFXThemeDefinition => Boolean(item));
            setCustomThemes(nextCustomThemes);
            window.localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(nextCustomThemes, null, 2));
        }
        if (Array.isArray(shared.customKeyboardThemes)) {
            const nextKeyboardThemes = shared.customKeyboardThemes
                .map(validateMultiFXKeyboardTheme)
                .filter((item): item is MultiFXKeyboardThemeDefinition => Boolean(item));
            setCustomKeyboardThemes(nextKeyboardThemes);
            window.localStorage.setItem(CUSTOM_KEYBOARD_THEMES_STORAGE_KEY, JSON.stringify(nextKeyboardThemes, null, 2));
        }
        // The shared session is the trigger; including local drafts here would undo edits before publication.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine?.uiSession.themeManager]);

    useEffect(() => {
        if (!engine) {
            return;
        }
        if (!themeReady.current) {
            themeReady.current = true;
            if (applyingSharedTheme.current) {
                applyingSharedTheme.current = false;
                return;
            }
        }
        if (applyingSharedTheme.current) {
            applyingSharedTheme.current = false;
            return;
        }
        lastSharedTheme.current = JSON.stringify(theme);
        updateUiSessionSection(engine.client, "themeManager", {
            theme: theme as unknown as JsonObject
        });
    }, [theme, engine?.client]);

    useEffect(() => {
        if (!engine) {
            return;
        }
        if (!keyboardThemeReady.current) {
            keyboardThemeReady.current = true;
            if (applyingSharedKeyboardTheme.current) {
                applyingSharedKeyboardTheme.current = false;
                return;
            }
        }
        if (applyingSharedKeyboardTheme.current) {
            applyingSharedKeyboardTheme.current = false;
            return;
        }
        lastSharedKeyboardTheme.current = JSON.stringify(keyboardTheme);
        updateUiSessionSection(engine.client, "themeManager", {
            keyboardTheme: keyboardTheme as unknown as JsonObject
        });
    }, [keyboardTheme, engine?.client]);

    useEffect(() => {
        if (!engine || themeLibrariesReady.current) {
            return;
        }
        themeLibrariesReady.current = true;
        const shared = obj(engine.uiSession.themeManager);
        const patch: JsonObject = {};
        if (!Array.isArray(shared.customThemes)) {
            patch.customThemes = customThemes as unknown as JsonObject[];
        }
        if (!Array.isArray(shared.customKeyboardThemes)) {
            patch.customKeyboardThemes = customKeyboardThemes as unknown as JsonObject[];
        }
        if (Object.keys(patch).length > 0) {
            updateUiSessionSection(engine.client, "themeManager", patch);
        }
        // Seed the shared library once; later saves publish in their handlers.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine?.client]);

    const syncThemeUi = (patch: JsonObject) => {
        if (engine) {
            updateUiSessionSection(engine.client, "themeManager", patch);
        }
    };
    const showThemePicker = (next: "load" | "save" | "saveAll" | null) => {
        setPicker(next);
        syncThemeUi({ picker: next ?? "" });
    };
    const showDeleteTheme = (next: { kind: "ui" | "keyboard"; name: string } | null) => {
        setDeleteTarget(next);
        syncThemeUi({ deleteKind: next?.kind ?? "", deleteName: next?.name ?? "" });
    };

    useEffect(() => {
        const list = themeListRef.current;
        if (!list) {
            return;
        }
        const frame = window.requestAnimationFrame(() => {
            const node = Array.from(list.querySelectorAll("[data-theme-name]")).find(
                (item) => item.getAttribute("data-theme-name") === activeName
            );
            node?.scrollIntoView({ block: "center", behavior: "auto" });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeName, browseMode]);

    const groupedBuiltIns = useMemo(() => {
        const categoryOrder: readonly string[] = browseMode === "STYLE"
            ? STYLE_CATEGORY_ORDER
            : CATEGORY_ORDER;
        const groups = new Map<string, MultiFXThemeDefinition[]>();

        for (const category of categoryOrder) {
            groups.set(category, []);
        }

        for (const preset of BUILT_IN_THEMES) {
            const group = browseMode === "STYLE"
                ? getMultiFXThemeStyleLabel(preset)
                : getThemeCategory(preset);
            groups.get(group)?.push(preset);
        }

        for (const themes of groups.values()) {
            themes.sort((a, b) =>
                a.name.localeCompare(b.name, undefined, {
                    sensitivity: "base"
                })
            );
        }

        return { categoryOrder, groups };
    }, [browseMode]);

    const sortedCustomThemes = useMemo(
        () =>
            [...customThemes].sort((a, b) =>
                a.name.localeCompare(b.name, undefined, {
                    sensitivity: "base"
                })
            ),
        [customThemes]
    );

    useEffect(() => {
        applyMultiFXTheme(theme);
    }, [theme]);

    useEffect(() => {
        return () => {
            applyMultiFXTheme(originalRef.current);
        };
    }, []);

    useEffect(() => {
        if (!message) {
            return;
        }

        const timer = window.setTimeout(() => {
            setMessage("");
        }, 1800);

        return () => window.clearTimeout(timer);
    }, [message]);

    const updateColor = (
        key: keyof MultiFXThemeDefinition["colors"],
        value: string
    ) => {
        setTheme((current) => ({
            ...current,
            name: current.name.startsWith("Custom")
                ? current.name
                : `Custom - ${current.name}`,
            author: "User",
            colors: {
                ...current.colors,
                [key]: value
            }
        }));
    };

    const updateAppearance = (
        update: (next: MultiFXThemeDefinition) => void
    ) => {
        setTheme((current) => {
            const next = cloneTheme(current);
            next.name = current.name.startsWith("Custom")
                ? current.name
                : `Custom - ${current.name}`;
            next.author = "User";
            update(next);
            return next;
        });
    };

    const previewTheme = (preset: MultiFXThemeDefinition) => {
        setTheme(cloneTheme(preset));
        if (editorTab === "KEYBOARD") {
            setKeyboardTheme(keyboardThemeFromUITheme(preset));
        }
        setMessage(`Previewing "${preset.name}".`);
    };

    const setThemeActive = () => {
        void syncTheme();
    };

    /** Make the preview the floor theme on this Pi (screens and RGB LEDs). */
    const syncTheme = async () => {
        if (syncingTheme) return;
        if (!saveMultiFXTheme(theme)) {
            setMessage("Theme is invalid and could not be saved.");
            return;
        }

        originalRef.current = cloneTheme(theme);
        setActiveName(theme.name);
        syncThemeUi({ activeName: theme.name });
        const custom = saveCustomMultiFXTheme(theme);
        setCustomThemes(custom);
        if (!persistTheme) {
            setMessage(`"${theme.name}" is now the active theme.`);
            return;
        }
        setSyncingTheme(true);
        setMessage("Saving theme on the Pi...");
        try {
            await persistTheme(theme);
            setMessage(
                `"${theme.name}" is active on every screen and on the floorboard LEDs.`
            );
        } catch (error) {
            const detail = error instanceof Error
                ? error.message
                : String(error);
            setMessage(`Theme is active here, but the Pi did not save it: ${detail}`);
        } finally {
            setSyncingTheme(false);
        }
    };

    const saveCustom = () => {
        const customName = theme.name.trim();

        if (!customName) {
            setMessage("Enter a name before saving a custom theme.");
            return;
        }

        const customTheme: MultiFXThemeDefinition = {
            ...cloneTheme(theme),
            name: customName,
            author: "User",
            version: 4
        };

        const next = saveCustomMultiFXTheme(customTheme);
        setCustomThemes(next);
        syncThemeUi({ customThemes: next as unknown as JsonObject[] });
        setTheme(cloneTheme(customTheme));
        setMessage(`Saved custom theme "${customName}".`);
    };

    const deleteCustom = (name: string) => {
        showDeleteTheme({ kind: "ui", name });
    };

    const confirmDeleteTheme = () => {
        const target = deleteTarget;
        showDeleteTheme(null);
        if (!target) {
            return;
        }
        if (target.kind === "keyboard") {
            const next = deleteCustomMultiFXKeyboardTheme(target.name);
            setCustomKeyboardThemes(next);
            syncThemeUi({ customKeyboardThemes: next as unknown as JsonObject[] });
            setMessage(`Deleted keyboard theme "${target.name}".`);
            return;
        }
        const next = deleteCustomMultiFXTheme(target.name);
        setCustomThemes(next);
        syncThemeUi({ customThemes: next as unknown as JsonObject[] });
        setMessage(`Deleted custom theme "${target.name}".`);
    };

    const saveKeyboardCustom = () => {
        if (!keyboardTheme.name.trim()) {
            setMessage("Enter a keyboard theme name before saving.");
            return;
        }
        const saved = { ...keyboardTheme, author: "User" };
        const next = saveCustomMultiFXKeyboardTheme(saved);
        setCustomKeyboardThemes(next);
        syncThemeUi({ customKeyboardThemes: next as unknown as JsonObject[] });
        setKeyboardTheme(structuredClone(saved));
        setMessage(`Saved keyboard theme "${saved.name}".`);
    };

    const exportAllThemes = () => {
        showThemePicker("saveAll");
    };

    const exportTheme = () => {
        showThemePicker("save");
    };

    const applyImportedTheme = (raw: unknown) => {
        try {
            if (raw && typeof raw === "object"
                && (raw as { format?: unknown }).format === "pimfx-theme-backup") {
                const bundle = raw as {
                    version?: unknown;
                    activeUITheme?: unknown;
                    customUIThemes?: unknown;
                    customKeyboardThemes?: unknown;
                };
                const active = validateMultiFXTheme(bundle.activeUITheme);
                const uiThemes = Array.isArray(bundle.customUIThemes)
                    ? bundle.customUIThemes.map(validateMultiFXTheme) : [];
                const keyboardThemes = Array.isArray(bundle.customKeyboardThemes)
                    ? bundle.customKeyboardThemes.map(validateMultiFXKeyboardTheme) : [];
                if (bundle.version !== 1 || !active
                    || !Array.isArray(bundle.customUIThemes)
                    || uiThemes.some((item) => !item)
                    || !Array.isArray(bundle.customKeyboardThemes)
                    || keyboardThemes.some((item) => !item)) {
                    setMessage("That theme backup is invalid.");
                    return;
                }
                const restoredUI = uiThemes as MultiFXThemeDefinition[];
                const restoredKeyboard = keyboardThemes as MultiFXKeyboardThemeDefinition[];
                window.localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(restoredUI, null, 2));
                window.localStorage.setItem(CUSTOM_KEYBOARD_THEMES_STORAGE_KEY, JSON.stringify(restoredKeyboard, null, 2));
                saveMultiFXTheme(active);
                originalRef.current = cloneTheme(active);
                setTheme(cloneTheme(active));
                setCustomThemes(restoredUI);
                setCustomKeyboardThemes(restoredKeyboard);
                syncThemeUi({
                    customThemes: restoredUI as unknown as JsonObject[],
                    customKeyboardThemes: restoredKeyboard as unknown as JsonObject[]
                });
                setKeyboardTheme(keyboardThemeFromUITheme(active));
                setMessage("UI and keyboard themes restored from backup.");
                return;
            }
            const parsed = validateMultiFXTheme(raw);

            if (!parsed) {
                setMessage("That file is not a valid Pi-MFX theme.");
                return;
            }

            setTheme(cloneTheme(parsed));
            setMessage(
                `Imported "${parsed.name}". Use SAVE CUSTOM to keep it or SET THEME to make it active.`
            );
        } catch (error) {
            setMessage(`Could not import theme: ${String(error)}`);
        }
    };

    const importTheme = async (file: File) => {
        try {
            applyImportedTheme(JSON.parse(await file.text()));
        } catch (error) {
            setMessage(`Could not import theme: ${String(error)}`);
        }
    };

    return (
        <div style={screenStyle}>
            <div style={headerStyle}>
                <div>
                    <div className="mfx-font-heading" style={titleStyle}>
                        THEME MANAGER
                    </div>
                    <div style={subtitleStyle}>
                        Preview • set active • save custom • import/export
                    </div>
                </div>
            </div>

            {message && createPortal(
                <div
                    role="status"
                    aria-live="polite"
                    className="mfx-theme-feedback"
                    style={{
                        position: "fixed",
                        left: "50%",
                        top: "calc(8px * var(--mfx-ui-scale, 1))",
                        transform: "translateX(-50%)",
                        zIndex: 2147483647,
                        maxWidth: "min(72vw, 560px)",
                        padding:
                            "calc(8px * var(--mfx-ui-scale, 1)) calc(14px * var(--mfx-ui-scale, 1))",
                        borderRadius: 10,
                        border: "1px solid transparent",
                        background: multiFXSurfaceBackground("toast"),
                        color: MFX_SURFACES.toast.text,
                        fontWeight: 900,
                        textAlign: "center",
                        boxShadow: MFX_SURFACES.toast.shadow,
                        pointerEvents: "none"
                    }}
                >
                    {message}
                </div>,
                document.body
            )}

            <div
                style={{
                    flex: "1 1 auto",
                    minHeight: 0,
                    overflow: "hidden",
                    padding: "calc(12px * var(--mfx-ui-scale, 1))",
                    boxSizing: "border-box"
                }}
            >
                <div
                    style={{
                        height: "100%",
                        minHeight: 0,
                        display: "grid",
                        gridTemplateColumns: "29% minmax(0, 71%)",
                        gap: "calc(12px * var(--mfx-ui-scale, 1))",
                        overflow: "hidden"
                    }}
                >
                    <div
                        style={{
                            minWidth: 0,
                            minHeight: 0,
                            display: "flex",
                            flexDirection: "column",
                            overflow: "hidden",
                            borderRadius: 10,
                            border: "1px solid transparent",
                            background: multiFXSurfaceBackground("panel"),
                            color: MFX_SURFACES.panel.text,
                            boxShadow: MFX_SURFACES.panel.shadow
                        }}
                    >
                        <div
                            style={{
                                flex: "0 0 auto",
                                padding:
                                    "calc(9px * var(--mfx-ui-scale, 1))",
                                borderBottom:
                                    `1px solid ${MFX_COLORS.border}`,
                                background: MFX_COLORS.panelAlt
                            }}
                        >
                            <div
                                style={{
                                    ...sectionTitleStyle,
                                    marginBottom:
                                        "calc(7px * var(--mfx-ui-scale, 1))"
                                }}
                            >
                                THEMES
                            </div>

                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(3, 1fr)",
                                    gap:
                                        "calc(7px * var(--mfx-ui-scale, 1))"
                                }}
                            >
                                <button
                                    type="button"
                                    onClick={() => showThemePicker("load")}
                                    style={{
                                        ...buttonStyle,
                                        width: "100%",
                                        minWidth: 0
                                    }}
                                >
                                    IMPORT
                                </button>
                                <button
                                    type="button"
                                    onClick={exportTheme}
                                    style={{
                                        ...buttonStyle,
                                        width: "100%",
                                        minWidth: 0
                                    }}
                                >
                                    EXPORT
                                </button>
                                <button type="button" onClick={exportAllThemes}
                                    style={{ ...buttonStyle, width: "100%", minWidth: 0 }}>
                                    EXPORT ALL
                                </button>
                            </div>
                            <label
                                style={{
                                    ...buttonStyle,
                                    width: "100%",
                                    minWidth: 0,
                                    boxSizing: "border-box",
                                    marginTop: 7
                                }}
                            >
                                UPLOAD
                                <input
                                    type="file"
                                    accept="application/json,.json"
                                    style={{ display: "none" }}
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) {
                                            void importTheme(file);
                                        }
                                        event.currentTarget.value = "";
                                    }}
                                />
                            </label>

                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr 1fr",
                                    gap: 5,
                                    marginTop: 7
                                }}
                            >
                                {(["STYLE", "COLOR"] as const).map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        onClick={() => {
                                            setBrowseMode(mode);
                                            syncThemeUi({ browseMode: mode });
                                        }}
                                        style={browseMode === mode
                                            ? smallTabActiveStyle
                                            : smallTabStyle}
                                    >
                                        BY {mode}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div
                            ref={themeListRef}
                            data-mfx-nav-list="themes"
                            data-mfx-sync-scroll="settings-theme-list"
                            style={{
                                flex: "1 1 auto",
                                minHeight: 0,
                                overflowY: "auto",
                                overflowX: "hidden",
                                overscrollBehavior: "contain",
                                touchAction: "pan-y",
                                padding:
                                    "calc(8px * var(--mfx-ui-scale, 1))"
                            }}
                        >
                            <div
                                style={{
                                    display: "grid",
                                    gap:
                                        "calc(7px * var(--mfx-ui-scale, 1))"
                                }}
                            >
                                {groupedBuiltIns.categoryOrder.map((category) => {
                                    const presets =
                                        groupedBuiltIns.groups.get(category) ?? [];

                                    if (presets.length === 0) {
                                        return null;
                                    }

                                    return (
                                        <React.Fragment key={category}>
                                            <ThemeCategoryHeader
                                                title={category}
                                                count={presets.length}
                                            />

                                            {presets.map((preset) => (
                                                <ThemePresetButton
                                                    key={preset.name}
                                                    preset={preset}
                                                    selected={theme.name === preset.name}
                                                    active={activeName === preset.name}
                                                    onClick={() =>
                                                        previewTheme(preset)
                                                    }
                                                />
                                            ))}
                                        </React.Fragment>
                                    );
                                })}

                                {sortedCustomThemes.length > 0 && (
                                    <>
                                        <ThemeCategoryHeader
                                            title="MY THEMES"
                                            count={sortedCustomThemes.length}
                                        />

                                        {sortedCustomThemes.map((preset) => (
                                            <div
                                                key={`custom-${preset.name}`}
                                                style={{
                                                    display: "grid",
                                                    gridTemplateColumns:
                                                        "minmax(0, 1fr) auto",
                                                    gap:
                                                        "calc(5px * var(--mfx-ui-scale, 1))"
                                                }}
                                            >
                                                <ThemePresetButton
                                                    preset={preset}
                                                    selected={theme.name === preset.name}
                                                    active={activeName === preset.name}
                                                    onClick={() => {
                                                        setTheme(
                                                            cloneTheme(preset)
                                                        );
                                                        if (editorTab === "KEYBOARD") {
                                                            setKeyboardTheme(
                                                                keyboardThemeFromUITheme(preset)
                                                            );
                                                        }
                                                        setMessage(
                                                            `Previewing custom theme "${preset.name}".`
                                                        );
                                                    }}
                                                />

                                                <button
                                                    type="button"
                                                    title={`Delete ${preset.name}`}
                                                    aria-label={`Delete ${preset.name}`}
                                                    onClick={() =>
                                                        deleteCustom(
                                                            preset.name
                                                        )
                                                    }
                                                    style={{
                                                        width:
                                                            "calc(38px * var(--mfx-ui-scale, 1))",
                                                        minWidth:
                                                            "calc(38px * var(--mfx-ui-scale, 1))",
                                                        borderRadius: 8,
                                                        border:
                                                            `1px solid ${MFX_COLORS.danger}`,
                                                        background:
                                                            MFX_COLORS.background,
                                                        color:
                                                            MFX_COLORS.danger,
                                                        font: "inherit",
                                                        fontWeight: 900,
                                                        cursor: "pointer"
                                                    }}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        ))}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <div
                        style={{
                            minWidth: 0,
                            minHeight: 0,
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                            padding:
                                "calc(11px * var(--mfx-ui-scale, 1))",
                            boxSizing: "border-box",
                            borderRadius: 10,
                            border: "1px solid transparent",
                            background: multiFXSurfaceBackground("panel"),
                            color: MFX_SURFACES.panel.text,
                            boxShadow: MFX_SURFACES.panel.shadow
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                alignItems: "center",
                                gap: "var(--mfx-gap, 8px)",
                                marginBottom:
                                    "calc(9px * var(--mfx-ui-scale, 1))"
                            }}
                        >
                            <div
                                style={{
                                    ...sectionTitleStyle,
                                    marginBottom: 0,
                                    flex: "1 1 auto",
                                    fontSize: "1.02rem"
                                }}
                            >
                                CUSTOMIZE
                            </div>

                            {editorTab !== "KEYBOARD" ? <>
                            <button
                                type="button"
                                onClick={setThemeActive}
                                disabled={syncingTheme}
                                style={{
                                    ...primaryButtonStyle,
                                    minHeight:
                                        "calc(40px * var(--mfx-ui-scale, 1))",
                                    padding:
                                        "calc(6px * var(--mfx-ui-scale, 1)) calc(12px * var(--mfx-ui-scale, 1))",
                                    opacity: syncingTheme ? 0.62 : 1
                                }}
                            >
                                {syncingTheme ? "SAVING..." : "SET THEME"}
                            </button>

                            <button
                                type="button"
                                onClick={saveCustom}
                                style={{
                                    ...buttonStyle,
                                    minHeight:
                                        "calc(40px * var(--mfx-ui-scale, 1))",
                                    padding:
                                        "calc(6px * var(--mfx-ui-scale, 1)) calc(12px * var(--mfx-ui-scale, 1))",
                                    border:
                                        `1px solid ${MFX_COLORS.cyan}`,
                                    color:
                                        MFX_COLORS.cyanText,
                                    background:
                                        MFX_COLORS.cyanSurface
                                }}
                            >
                                SAVE CUSTOM
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    const original =
                                        cloneTheme(originalRef.current);

                                    setTheme(original);
                                    applyMultiFXTheme(original);
                                    setMessage("Reverted unsaved changes.");
                                }}
                                style={{
                                    ...buttonStyle,
                                    minHeight:
                                        "calc(40px * var(--mfx-ui-scale, 1))",
                                    padding:
                                        "calc(6px * var(--mfx-ui-scale, 1)) calc(12px * var(--mfx-ui-scale, 1))"
                                }}
                            >
                                REVERT
                            </button>
                            </> : <>
                            <button type="button" onClick={saveKeyboardCustom}
                                style={{ ...primaryButtonStyle, minHeight: "calc(40px * var(--mfx-ui-scale, 1))" }}>
                                SAVE KEYBOARD THEME
                            </button>
                            <button type="button" onClick={() => {
                                setKeyboardTheme(keyboardThemeFromUITheme(theme));
                                setMessage("Keyboard colors copied from the previewed UI theme.");
                            }} style={{ ...buttonStyle, minHeight: "calc(40px * var(--mfx-ui-scale, 1))" }}>
                                COPY UI THEME
                            </button>
                            </>}
                        </div>

                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns:
                                    "calc(94px * var(--mfx-ui-scale, 1)) minmax(0, 1fr)",
                                gap: "var(--mfx-gap, 8px)",
                                alignItems: "center",
                                marginBottom:
                                    "calc(9px * var(--mfx-ui-scale, 1))"
                            }}
                        >
                            <label
                                style={{
                                    ...fieldLabelStyle,
                                    margin: 0,
                                    fontSize: "0.8rem"
                                }}
                            >
                                {editorTab === "KEYBOARD" ? "Keyboard name" : "Theme name"}
                            </label>

                            <input
                                value={editorTab === "KEYBOARD" ? keyboardTheme.name : theme.name}
                                onChange={(event) => editorTab === "KEYBOARD"
                                    ? setKeyboardTheme((current) => ({ ...current, name: event.target.value }))
                                    : setTheme((current) => ({ ...current, name: event.target.value }))}
                                style={{
                                    ...textInputStyle,
                                    height:
                                        "calc(40px * var(--mfx-ui-scale, 1))",
                                    fontSize: "0.9rem"
                                }}
                            />
                        </div>

                        <ThemeEditorTabs
                            selected={editorTab}
                            onSelect={(tab) => {
                                if (tab === "KEYBOARD" && editorTab !== "KEYBOARD") {
                                    setKeyboardTheme(keyboardThemeFromUITheme(theme));
                                }
                                setEditorTab(tab);
                                syncThemeUi({ editorTab: tab });
                            }}
                        />

                        {editorTab === "COLORS" && <div
                            style={{
                                flex: "1 1 auto",
                                minHeight: 0,
                                display: "grid",
                                gridTemplateColumns:
                                    "repeat(3, minmax(0, 1fr))",
                                gridTemplateRows:
                                    "repeat(5, minmax(0, 1fr))",
                                gap:
                                    "calc(7px * var(--mfx-ui-scale, 1))"
                            }}
                        >
                            <ColorField
                                label="Background"
                                value={theme.colors.background}
                                onChange={(v) =>
                                    updateColor("background", v)
                                }
                            />
                            <ColorField
                                label="Panel"
                                value={theme.colors.panel}
                                onChange={(v) =>
                                    updateColor("panel", v)
                                }
                            />
                            <ColorField
                                label="Panel Alt"
                                value={theme.colors.panelAlt}
                                onChange={(v) =>
                                    updateColor("panelAlt", v)
                                }
                            />
                            <ColorField
                                label="Navigation"
                                value={theme.colors.navigation}
                                onChange={(v) =>
                                    updateColor("navigation", v)
                                }
                            />
                            <ColorField
                                label="Nav Text"
                                value={theme.colors.navigationText}
                                onChange={(v) =>
                                    updateColor("navigationText", v)
                                }
                            />
                            <ColorField
                                label="Nav Surface"
                                value={theme.colors.navigationSurface}
                                onChange={(v) =>
                                    updateColor("navigationSurface", v)
                                }
                            />
                            <ColorField
                                label="Selected"
                                value={theme.colors.selected}
                                onChange={(v) =>
                                    updateColor("selected", v)
                                }
                            />
                            <ColorField
                                label="Sel Surface"
                                value={theme.colors.selectedSurface}
                                onChange={(v) =>
                                    updateColor("selectedSurface", v)
                                }
                            />
                            <ColorField
                                label="Sel Text"
                                value={theme.colors.selectedText}
                                onChange={(v) =>
                                    updateColor("selectedText", v)
                                }
                            />
                            <ColorField
                                label="Text"
                                value={theme.colors.text}
                                onChange={(v) =>
                                    updateColor("text", v)
                                }
                            />
                            <ColorField
                                label="Muted"
                                value={theme.colors.muted}
                                onChange={(v) =>
                                    updateColor("muted", v)
                                }
                            />
                            <ColorField
                                label="Border"
                                value={theme.colors.border}
                                onChange={(v) =>
                                    updateColor("border", v)
                                }
                            />
                            <ColorField
                                label="Danger"
                                value={theme.colors.danger}
                                onChange={(v) =>
                                    updateColor("danger", v)
                                }
                            />
                        </div>}

                        {editorTab === "SURFACES" && (
                            <SurfaceEditor
                                theme={theme}
                                onChange={updateAppearance}
                            />
                        )}
                        {editorTab === "TILES" && (
                            <RoleEditor
                                theme={theme}
                                onChange={updateAppearance}
                            />
                        )}
                        {editorTab === "CONTROLS" && (
                            <ControlStyleEditor
                                theme={theme}
                                onChange={updateAppearance}
                            />
                        )}
                        {editorTab === "MOTION" && (
                            <MotionEditor
                                theme={theme}
                                onChange={updateAppearance}
                            />
                        )}
                        {editorTab === "FONTS" && (
                            <FontsEditor
                                theme={theme}
                                onChange={updateAppearance}
                            />
                        )}
                        {editorTab === "KEYBOARD" && (
                            <KeyboardThemeEditor
                                value={keyboardTheme}
                                onChange={setKeyboardTheme}
                                savedThemes={customKeyboardThemes}
                                onLoad={(selected) => setKeyboardTheme(structuredClone(selected))}
                                onDelete={(name) => showDeleteTheme({ kind: "keyboard", name })}
                            />
                        )}
                    </div>
                </div>
            </div>
            {picker && engine && run && (
                <LibraryJsonPicker
                    engine={engine}
                    run={run}
                    kind="theme"
                    mode={picker === "load" ? "load" : "save"}
                    title={picker === "load" ? "LOAD THEME" : picker === "saveAll" ? "SAVE ALL THEMES" : "SAVE THEME"}
                    defaultName={picker === "saveAll" ? "pimfx-themes" : safeName(theme.name)}
                    contents={picker === "save"
                        ? JSON.stringify(theme, null, 2)
                        : picker === "saveAll"
                            ? JSON.stringify({
                                format: "pimfx-theme-backup",
                                version: 1,
                                createdAt: new Date().toISOString(),
                                activeUITheme: originalRef.current,
                                customUIThemes: customThemes,
                                customKeyboardThemes
                            }, null, 2)
                            : undefined}
                    onClose={() => showThemePicker(null)}
                    onLoad={(parsed) => applyImportedTheme(parsed)}
                    onSaved={() => setMessage(picker === "saveAll"
                        ? "All UI and keyboard themes saved on the Pi."
                        : "Theme saved on the Pi.")}
                />
            )}
            {deleteTarget && (
                <ConfirmDialog
                    title={`DELETE ${deleteTarget.kind === "keyboard" ? "KEYBOARD THEME" : "THEME"}?`}
                    body={`Delete “${deleteTarget.name}”?`}
                    confirmLabel="DELETE"
                    danger
                    onCancel={() => showDeleteTheme(null)}
                    onConfirm={confirmDeleteTheme}
                />
            )}
        </div>
    );
}

function ThemeEditorTabs({
    selected,
    onSelect
}: {
    selected: ThemeEditorTab;
    onSelect: (tab: ThemeEditorTab) => void;
}) {
    const tabs: ThemeEditorTab[] = [
        "COLORS", "SURFACES", "TILES", "CONTROLS", "MOTION", "FONTS", "KEYBOARD"
    ];
    return (
        <div style={editorTabsStyle}>
            {tabs.map((tab) => (
                <button
                    key={tab}
                    type="button"
                    onClick={() => onSelect(tab)}
                    style={{
                        ...editorTabStyle,
                        border: `1px solid ${selected === tab
                            ? MFX_COLORS.cyan
                            : MFX_COLORS.border}`,
                        color: selected === tab
                            ? MFX_COLORS.cyanText
                            : MFX_COLORS.muted,
                        background: selected === tab
                            ? MFX_COLORS.cyanSurface
                            : MFX_COLORS.panelAlt
                    }}
                >
                    {tab}
                </button>
            ))}
        </div>
    );
}

const SURFACE_LABELS: Record<
    keyof MultiFXThemeDefinition["appearance"]["surfaces"],
    string
> = {
    page: "App Background",
    header: "Headers",
    panel: "Panels / Editors",
    popup: "Popups / Dialogs",
    toast: "Toasts / Parameter Feedback",
    menu: "Menus"
};

function SurfaceEditor({
    theme,
    onChange
}: {
    theme: MultiFXThemeDefinition;
    onChange: (update: (next: MultiFXThemeDefinition) => void) => void;
}) {
    const keys = Object.keys(SURFACE_LABELS) as Array<
        keyof typeof SURFACE_LABELS
    >;
    return (
        <div style={editorScrollStyle} data-mfx-sync-scroll="settings-theme-editor">
            <div style={editorCardGridStyle}>
                {keys.map((key) => (
                    <SurfaceCard
                        key={key}
                        label={SURFACE_LABELS[key]}
                        value={theme.appearance.surfaces[key]}
                        onChange={(value) => onChange((next) => {
                            next.appearance.surfaces[key] = value;
                        })}
                    />
                ))}
            </div>
        </div>
    );
}

function SurfaceCard({
    label,
    value,
    onChange
}: {
    label: string;
    value: MultiFXThemeSurface;
    onChange: (value: MultiFXThemeSurface) => void;
}) {
    const update = (patch: Partial<MultiFXThemeSurface>) =>
        onChange({ ...value, ...patch });
    return (
        <section style={editorCardStyle}>
            <div style={editorCardHeadingStyle}>{label}</div>
            <div style={twoColumnEditorStyle}>
                <PaintField
                    label="Background"
                    value={value.background}
                    onChange={(background) => update({ background })}
                />
                <PaintField
                    label="Border"
                    value={value.border}
                    onChange={(border) => update({ border })}
                />
                <CompactColorField label="Text" value={value.text}
                    onChange={(text) => update({ text })} />
                <CompactColorField label="Labels" value={value.label}
                    onChange={(labelValue) => update({ label: labelValue })} />
                <CompactColorField label="Accent" value={value.accent}
                    onChange={(accent) => update({ accent })} />
                <TextEditorField label="Shadow" value={value.shadow}
                    onChange={(shadow) => update({ shadow })} />
            </div>
        </section>
    );
}

const ROLE_LABELS: Record<
    keyof MultiFXThemeDefinition["appearance"]["roles"],
    string
> = {
    preset: "Preset Tiles",
    navigation: "Bank Up / Down",
    utility: "Utility Actions",
    snapshot: "Snapshots",
    bypass: "Bypass",
    danger: "Danger / Delete"
};

function RoleEditor({
    theme,
    onChange
}: {
    theme: MultiFXThemeDefinition;
    onChange: (update: (next: MultiFXThemeDefinition) => void) => void;
}) {
    const keys = Object.keys(ROLE_LABELS) as Array<keyof typeof ROLE_LABELS>;
    return (
        <div style={editorScrollStyle} data-mfx-sync-scroll="settings-theme-editor">
            <section style={editorCardStyle}>
                <div style={editorCardHeadingStyle}>LIGHTING BY FUNCTION</div>
                <div style={{
                    color: "var(--mfx-surface-panel-label)",
                    fontSize: ".82rem",
                    fontWeight: 700,
                    lineHeight: 1.35
                }}>
                    Each ACTIVE Light / LED color drives that function&apos;s
                    tile indicator, metal-switch light ring, and arcade-button
                    illumination. The modified-preset light is set under
                    Controls.
                </div>
            </section>
            <div style={editorCardGridStyle}>
                {keys.map((key) => (
                    <RoleCard
                        key={key}
                        label={ROLE_LABELS[key]}
                        value={theme.appearance.roles[key]}
                        onChange={(value) => onChange((next) => {
                            next.appearance.roles[key] = value;
                        })}
                    />
                ))}
            </div>
        </div>
    );
}

function RoleCard({
    label,
    value,
    onChange
}: {
    label: string;
    value: MultiFXThemeControlRole;
    onChange: (value: MultiFXThemeControlRole) => void;
}) {
    const update = (
        state: "normal" | "active",
        nextState: MultiFXThemeControlState
    ) => onChange({ ...value, [state]: nextState });
    return (
        <section style={editorCardStyle}>
            <div style={editorCardHeadingStyle}>{label}</div>
            {(["normal", "active"] as const).map((state) => (
                <ControlStateEditor
                    key={state}
                    label={state.toUpperCase()}
                    value={value[state]}
                    onChange={(nextState) => update(state, nextState)}
                />
            ))}
        </section>
    );
}

function ControlStateEditor({
    label,
    value,
    onChange
}: {
    label: string;
    value: MultiFXThemeControlState;
    onChange: (value: MultiFXThemeControlState) => void;
}) {
    const update = (patch: Partial<MultiFXThemeControlState>) =>
        onChange({ ...value, ...patch });
    return (
        <div style={controlStateStyle}>
            <div style={controlStateHeadingStyle}>{label}</div>
            <div style={twoColumnEditorStyle}>
                <PaintField label="Background" value={value.background}
                    onChange={(background) => update({ background })} />
                <PaintField label="Border" value={value.border}
                    onChange={(border) => update({ border })} />
                <CompactColorField label="Label" value={value.label}
                    onChange={(labelValue) => update({ label: labelValue })} />
                <CompactColorField label="Value" value={value.value}
                    onChange={(valueColor) => update({ value: valueColor })} />
                <CompactColorField label="Light / LED" value={value.indicator}
                    onChange={(indicator) => update({ indicator })} />
                <TextEditorField label="Shadow" value={value.shadow}
                    onChange={(shadow) => update({ shadow })} />
            </div>
        </div>
    );
}

function ControlStyleEditor({
    theme,
    onChange
}: {
    theme: MultiFXThemeDefinition;
    onChange: (update: (next: MultiFXThemeDefinition) => void) => void;
}) {
    const controls = theme.appearance.controls;
    const animationOptions = compatibleIndicatorAnimations(
        controls.switchStyle,
        controls.indicatorStyle
    );
    const patch = (value: Partial<typeof controls>) => onChange((next) => {
        next.appearance.controls = {
            ...next.appearance.controls,
            ...value
        };
    });
    const patchRoleLight = (
        role: keyof MultiFXThemeDefinition["appearance"]["roles"],
        indicator: string
    ) => onChange((next) => {
        const active = next.appearance.roles[role].active;
        active.indicator = indicator;
        active.label = indicator;
        active.border = { kind: "solid", colors: [indicator], angle: 0 };
        active.shadow = `0 0 20px ${indicator}`;
        if (active.background.colors.length > 0) {
            active.background = {
                ...active.background,
                colors: [indicator, ...active.background.colors.slice(1)]
            };
        }
        if (role === "preset") {
            next.appearance.controls.indicatorActive = indicator;
        }
    });
    return (
        <div style={editorScrollStyle} data-mfx-sync-scroll="settings-theme-editor">
            <ControlStylePreview theme={theme} />
            <section style={editorCardStyle}>
                <div style={editorCardHeadingStyle}>GRAPHICAL STYLE</div>
                <div style={twoColumnEditorStyle}>
                    <SelectEditorField label="Switches" value={controls.switchStyle}
                        options={[["tiles", "Tiles"], ["footswitch", "Metal footswitches"], ["arcade", "Arcade buttons"], ["glass", "Glass panels"], ["minimal", "Minimal"]]}
                        onChange={(switchStyleValue) => {
                            const switchStyle = switchStyleValue as typeof controls.switchStyle;
                            const validAnimations = compatibleIndicatorAnimations(
                                switchStyle,
                                controls.indicatorStyle
                            ).map(([value]) => value);
                            patch({
                                switchStyle,
                                indicatorAnimation: validAnimations.includes(
                                    controls.indicatorAnimation
                                ) ? controls.indicatorAnimation : "none"
                            });
                        }} />
                    <SelectEditorField label="Panel shape" value={controls.switchShape}
                        options={[["rounded", "Rounded"], ["square", "Square"], ["pill", "Pill"], ["bevel", "Beveled"], ["hexagon", "Hexagonal"]]}
                        onChange={(switchShape) => patch({ switchShape: switchShape as typeof controls.switchShape })} />
                    <SelectEditorField label="Analog controls" value={controls.analogStyle}
                        options={[["modern", "Modern"], ["vintage", "Vintage"], ["neon", "Neon"], ["minimal", "Minimal"]]}
                        onChange={(analogStyle) => patch({ analogStyle: analogStyle as typeof controls.analogStyle })} />
                    <SelectEditorField label="Indicator" value={controls.indicatorStyle}
                        options={[["dot", "LED dot"], ["ring", "Light ring"], ["halo", "Halo"], ["bar", "LED bar"], ["none", "None"]]}
                        onChange={(indicatorStyleValue) => {
                            const indicatorStyle = indicatorStyleValue as typeof controls.indicatorStyle;
                            const validAnimations = compatibleIndicatorAnimations(
                                controls.switchStyle,
                                indicatorStyle
                            ).map(([value]) => value);
                            patch({
                                indicatorStyle,
                                indicatorAnimation: validAnimations.includes(
                                    controls.indicatorAnimation
                                ) ? controls.indicatorAnimation : "none"
                            });
                        }} />
                    <SelectEditorField label="Animation" value={controls.indicatorAnimation}
                        options={animationOptions}
                        onChange={(indicatorAnimation) => patch({ indicatorAnimation: indicatorAnimation as typeof controls.indicatorAnimation })} />
                </div>
            </section>
            <section style={editorCardStyle}>
                <div style={editorCardHeadingStyle}>STATE LIGHT COLORS</div>
                <div style={threeColumnEditorStyle}>
                    <CompactColorField label="Inactive light" value={controls.indicatorInactive}
                        onChange={(indicatorInactive) => patch({ indicatorInactive })} />
                    <CompactColorField label="Active preset" value={theme.appearance.roles.preset.active.indicator}
                        onChange={(indicator) => patchRoleLight("preset", indicator)} />
                    <CompactColorField label="Preset modified" value={controls.indicatorChanged}
                        onChange={(indicatorChanged) => patch({ indicatorChanged })} />
                    <CompactColorField label="Bypass enabled" value={theme.appearance.roles.bypass.active.indicator}
                        onChange={(indicator) => patchRoleLight("bypass", indicator)} />
                    <CompactColorField label="Bank pressed" value={theme.appearance.roles.navigation.active.indicator}
                        onChange={(indicator) => patchRoleLight("navigation", indicator)} />
                    <CompactColorField label="Snapshot active" value={theme.appearance.roles.snapshot.active.indicator}
                        onChange={(indicator) => patchRoleLight("snapshot", indicator)} />
                </div>
            </section>
            <section style={editorCardStyle}>
                <div style={editorCardHeadingStyle}>GEOMETRY & MOTION</div>
                <div style={threeColumnEditorStyle}>
                    <NumberEditorField label="Border width" value={controls.borderWidth} min={0} max={8} step={1}
                        onChange={(borderWidth) => patch({ borderWidth })} />
                    <NumberEditorField label="Corner radius" value={controls.cornerRadius} min={0} max={40} step={1}
                        onChange={(cornerRadius) => patch({ cornerRadius })} />
                    <NumberEditorField label="Glow strength" value={controls.glowStrength} min={0} max={1} step={0.05}
                        onChange={(glowStrength) => patch({ glowStrength })} />
                    <NumberEditorField label="Disabled opacity" value={controls.disabledOpacity} min={0.1} max={1} step={0.05}
                        onChange={(disabledOpacity) => patch({ disabledOpacity })} />
                    <NumberEditorField label="Animation seconds" value={controls.animationSeconds} min={0.2} max={10} step={0.1}
                        onChange={(animationSeconds) => patch({ animationSeconds })} />
                </div>
            </section>
            {controls.switchStyle === "glass" && (
                <section style={editorCardStyle}>
                    <div style={editorCardHeadingStyle}>GLASS PANEL</div>
                    <div style={twoColumnEditorStyle}>
                        <NumberEditorField label="Background blur" value={controls.glassBlur} min={0} max={30} step={1}
                            onChange={(glassBlur) => patch({ glassBlur })} />
                        <NumberEditorField label="Highlight strength" value={controls.glassHighlight} min={0} max={1} step={0.05}
                            onChange={(glassHighlight) => patch({ glassHighlight })} />
                    </div>
                </section>
            )}
        </div>
    );
}

function KeyboardThemeEditor({
    value,
    onChange,
    savedThemes,
    onLoad,
    onDelete
}: {
    value: MultiFXKeyboardThemeDefinition;
    onChange: (value: MultiFXKeyboardThemeDefinition) => void;
    savedThemes: MultiFXKeyboardThemeDefinition[];
    onLoad: (value: MultiFXKeyboardThemeDefinition) => void;
    onDelete: (name: string) => void;
}) {
    const patch = (next: Partial<MultiFXKeyboardThemeDefinition>) =>
        onChange({ ...value, ...next });
    const previewKey = (text: string, background: MultiFXThemePaint, color: string) => (
        <div style={{ padding: "10px 8px", minWidth: 54, flex: "1 1 0", textAlign: "center", borderRadius: 8, border: `1px solid ${value.border}`, background: themePaintToCss(background), color, fontWeight: 900 }}>
            {text}
        </div>
    );
    return (
        <div style={editorScrollStyle} data-mfx-sync-scroll="settings-theme-editor">
            <section style={editorCardStyle}>
                <div style={editorCardHeadingStyle}>KEYBOARD THEME LIBRARY</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <select defaultValue="" style={{ ...textInputStyle, flex: "1 1 220px" }}
                        onChange={(event) => {
                            const selected = savedThemes.find((theme) => theme.name === event.target.value);
                            if (selected) onLoad(selected);
                            event.currentTarget.value = "";
                        }}>
                        <option value="">Load a saved keyboard theme…</option>
                        {savedThemes.map((theme) => <option key={theme.name} value={theme.name}>{theme.name}</option>)}
                    </select>
                    <button type="button" style={buttonStyle}
                        disabled={!savedThemes.some((theme) => theme.name === value.name)}
                        onClick={() => onDelete(value.name)}>DELETE SAVED</button>
                </div>
            </section>
            <section style={editorCardStyle}>
                <div style={editorCardHeadingStyle}>LIVE KEYBOARD PREVIEW</div>
                <div style={{ padding: 12, borderRadius: 10, background: themePaintToCss(value.backdrop) }}>
                    <div style={{ padding: 12, borderRadius: 10, border: `2px solid ${value.border}`, background: themePaintToCss(value.panel) }}>
                        <div style={{ color: value.accent, fontWeight: 900, marginBottom: 8 }}>PRESET NAME</div>
                        <div style={{ padding: 8, marginBottom: 9, borderRadius: 7, border: `2px solid ${value.accent}`, background: themePaintToCss(value.valueBox), color: value.text }}>My Preset</div>
                        <div style={{ display: "flex", gap: 7 }}>
                            {previewKey("A", value.key, value.text)}
                            {previewKey("PRESSED", value.pressedKey, value.pressedText)}
                            {previewKey("CANCEL", value.key, value.cancel)}
                            {previewKey("DONE", value.key, value.accent)}
                        </div>
                        <div style={{ color: value.secondaryText, marginTop: 7, fontSize: ".8rem" }}>Secondary label text</div>
                    </div>
                </div>
            </section>
            <div style={editorCardGridStyle}>
                <section style={editorCardStyle}>
                    <div style={editorCardHeadingStyle}>SURFACES</div>
                    <div style={twoColumnEditorStyle}>
                        <PaintField label="Backdrop" value={value.backdrop} onChange={(backdrop) => patch({ backdrop })} />
                        <PaintField label="Panel" value={value.panel} onChange={(panel) => patch({ panel })} />
                        <PaintField label="Value box" value={value.valueBox} onChange={(valueBox) => patch({ valueBox })} />
                        <PaintField label="Keys" value={value.key} onChange={(key) => patch({ key })} />
                        <PaintField label="Pressed key" value={value.pressedKey} onChange={(pressedKey) => patch({ pressedKey })} />
                    </div>
                </section>
                <section style={editorCardStyle}>
                    <div style={editorCardHeadingStyle}>COLORS</div>
                    <div style={twoColumnEditorStyle}>
                        <CompactColorField label="Border" value={value.border} onChange={(border) => patch({ border })} />
                        <CompactColorField label="Text" value={value.text} onChange={(text) => patch({ text })} />
                        <CompactColorField label="Secondary text" value={value.secondaryText} onChange={(secondaryText) => patch({ secondaryText })} />
                        <CompactColorField label="Accent / Done" value={value.accent} onChange={(accent) => patch({ accent })} />
                        <CompactColorField label="Pressed text" value={value.pressedText} onChange={(pressedText) => patch({ pressedText })} />
                        <CompactColorField label="Cancel" value={value.cancel} onChange={(cancel) => patch({ cancel })} />
                    </div>
                </section>
            </div>
        </div>
    );
}

/** Offer only effects that read naturally on the selected physical graphic. */
function compatibleIndicatorAnimations(
    switchStyle: MultiFXThemeDefinition["appearance"]["controls"]["switchStyle"],
    indicatorStyle: MultiFXThemeDefinition["appearance"]["controls"]["indicatorStyle"]
): readonly (readonly [string, string])[] {
    const quiet = [["none", "Off"]] as const;
    const light = [
        ...quiet,
        ["pulse", "Pulse"],
        ["breathe", "Breathe"]
    ] as const;
    if (switchStyle === "footswitch") {
        return [...light, ["spin", "Spin around ring"]] as const;
    }
    if (switchStyle === "arcade") return light;
    if (indicatorStyle === "ring") {
        return [...light, ["spin", "Spin around ring"]] as const;
    }
    if (indicatorStyle === "bar") {
        return [...light, ["chase", "Chase across bar"]] as const;
    }
    if (indicatorStyle === "none") return quiet;
    return light;
}

/** Live examples use the same classes and CSS variables as Performance View. */
function ControlStylePreview({
    theme
}: {
    theme: MultiFXThemeDefinition;
}) {
    const tile = (
        roleName: keyof MultiFXThemeDefinition["appearance"]["roles"],
        active: boolean,
        label: string,
        value: string
    ) => {
        const state = theme.appearance.roles[roleName][
            active ? "active" : "normal"
        ];
        const indicatorColor = active
            ? state.indicator
            : theme.appearance.controls.indicatorInactive;
        return (
            <button
                type="button"
                className="mfx-performance-switch"
                data-mfx-role={roleName}
                data-mfx-active={active ? "true" : "false"}
                style={{
                    position: "relative",
                    minWidth: 0,
                    minHeight: 92,
                    overflow: "hidden",
                    containerType: "size",
                    padding: 8,
                    border: "var(--mfx-control-border-width) solid transparent",
                    borderRadius: "var(--mfx-control-radius)",
                    background: `${themePaintToCss(state.background)} padding-box, ${themePaintToCss(state.border)} border-box`,
                    color: state.value,
                    boxShadow: state.shadow,
                    font: "inherit"
                }}
            >
                <MultiFXFootswitchGraphic color={indicatorColor} />
                <MultiFXArcadeButtonGraphic color={indicatorColor} />
                <span
                    aria-hidden="true"
                    className="mfx-performance-indicator"
                    style={{
                        position: "absolute",
                        right: 7,
                        top: 7,
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        color: indicatorColor,
                        background: indicatorColor,
                        border: "2px solid currentColor",
                        boxShadow: active
                            ? "0 0 calc(14px * var(--mfx-control-glow-strength)) currentColor"
                            : "none"
                    }}
                />
                <span className="mfx-performance-switch__content" style={{
                    position: "relative",
                    zIndex: 1,
                    display: "grid",
                    height: "100%",
                    gridTemplateRows: "auto minmax(0,1fr) auto",
                    textAlign: "center"
                }}>
                    <span className="mfx-performance-switch__label-row mfx-performance-switch__label" style={{ color: state.label, fontSize: 10, fontWeight: 900 }}>
                        {label}
                    </span>
                    <span className="mfx-performance-switch__value-row mfx-performance-switch__value" style={{ gridRow: 3, alignSelf: "end", color: state.value, fontSize: 13, fontWeight: 900 }}>
                        {value}
                    </span>
                </span>
            </button>
        );
    };

    return (
        <section style={editorCardStyle}>
            <div style={editorCardHeadingStyle}>LIVE PERFORMANCE PREVIEW</div>
            <div style={{
                padding: 9,
                borderRadius: 8,
                border: "1px solid transparent",
                background: multiFXSurfaceBackground("page")
            }}>
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))",
                    gap: 8
                }}>
                    {tile("preset", true, "SW 1", "ACTIVE PRESET")}
                    {tile("navigation", true, "SW 7", "BANK PRESSED")}
                    {tile("bypass", true, "SW 5", "BYPASS ON")}
                    {tile("snapshot", true, "SW 6", "SNAPSHOT")}
                </div>
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3,minmax(0,1fr))",
                    gap: 8,
                    marginTop: 8
                }}>
                    <GraphicPreviewCell label="POT">
                        <div className="mfx-hardware-knob" aria-hidden="true">
                            <div className="mfx-hardware-knob__pointer"
                                style={{ transform: "rotate(35deg)" }} />
                            <div className="mfx-hardware-knob__arc"
                                style={{ background: "conic-gradient(from 225deg, var(--mfx-surface-panel-accent) 0deg 170deg, transparent 170deg 360deg)" }} />
                        </div>
                    </GraphicPreviewCell>
                    <GraphicPreviewCell label="SLIDER">
                        <div className="mfx-hardware-slider" aria-hidden="true">
                            <div className="mfx-hardware-slider__fill" style={{ height: "62%" }} />
                            <div className="mfx-hardware-slider__thumb" style={{ bottom: "calc(62% - 5px)" }} />
                        </div>
                    </GraphicPreviewCell>
                    <GraphicPreviewCell label="BUTTON">
                        <div className="mfx-hardware-button" data-active="true" aria-hidden="true" />
                    </GraphicPreviewCell>
                </div>
            </div>
        </section>
    );
}

function GraphicPreviewCell({
    label,
    children
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div style={{
            minHeight: 82,
            minWidth: 0,
            containerType: "size",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            borderRadius: 7,
            border: `1px solid ${MFX_COLORS.border}`,
            background: MFX_SURFACES.panel.background,
            color: MFX_SURFACES.panel.text
        }}>
            {children}
            <span style={{
                color: MFX_SURFACES.panel.label,
                fontSize: 9,
                fontWeight: 900
            }}>
                {label}
            </span>
        </div>
    );
}

function MotionEditor({
    theme,
    onChange
}: {
    theme: MultiFXThemeDefinition;
    onChange: (update: (next: MultiFXThemeDefinition) => void) => void;
}) {
    const motion = theme.appearance.motion;
    const patch = (value: Partial<typeof motion>) => onChange((next) => {
        next.appearance.motion = { ...next.appearance.motion, ...value };
    });
    return (
        <div style={editorScrollStyle} data-mfx-sync-scroll="settings-theme-editor">
            <section style={editorCardStyle}>
                <div style={editorCardHeadingStyle}>MOTION & FEEDBACK</div>
                <div style={twoColumnEditorStyle}>
                    <CheckboxEditorField label="Enable animations" value={motion.enabled}
                        onChange={(enabled) => patch({ enabled })} />
                    <CheckboxEditorField label="Respect reduced motion" value={motion.respectReducedMotion}
                        onChange={(respectReducedMotion) => patch({ respectReducedMotion })} />
                    <NumberEditorField label="Feedback duration (ms)" value={motion.feedbackDurationMs} min={500} max={10000} step={100}
                        onChange={(feedbackDurationMs) => patch({ feedbackDurationMs })} />
                </div>
            </section>
        </div>
    );
}

type ThemeFontRole = Exclude<
    keyof MultiFXThemeDefinition["appearance"]["fonts"],
    "controlPopupSizePercent"
>;

const FONT_GROUP_ORDER = [
    "BUILT IN", "DIGITAL / LCD", "SYSTEM"
] as const;

const FONT_SECTIONS: readonly {
    heading: string;
    roles: readonly (readonly [ThemeFontRole, string, string])[];
}[] = [
    {
        heading: "GENERAL UI",
        roles: [
            ["interface", "Interface / menus", "Banks, presets and settings"],
            ["heading", "Page headings", "PERFORMANCE"],
            ["label", "General labels", "CURRENT BANK"],
            ["value", "General values", "Oxford Clean"]
        ]
    },
    {
        heading: "PERFORMANCE SWITCHES",
        roles: [
            ["switchLabel", "Switch labels", "SW 1"],
            ["switchValue", "Preset / action names", "ACTIVE PRESET"]
        ]
    },
    {
        heading: "POTS, SLIDERS & ENCODERS",
        roles: [
            ["controlLabel", "Physical control labels", "POT 1"],
            ["controlFunction", "Assigned functions", "Delay · Feedback"],
            ["controlValue", "Control values", "72.5%"]
        ]
    },
    {
        heading: "POPUPS & TOASTS",
        roles: [
            ["feedback", "Feedback text", "POT 1 · Feedback 72.5%"]
        ]
    }
] as const;

/** Typography editor keeps family and scale independent for each UI role. */
function FontsEditor({
    theme,
    onChange
}: {
    theme: MultiFXThemeDefinition;
    onChange: (update: (next: MultiFXThemeDefinition) => void) => void;
}) {
    const fonts = theme.appearance.fonts;
    const patchRole = (
        role: ThemeFontRole,
        value: Partial<(typeof fonts)[ThemeFontRole]>
    ) => onChange((next) => {
        next.appearance.fonts[role] = {
            ...next.appearance.fonts[role],
            ...value
        };
    });

    return (
        <div style={editorScrollStyle} data-mfx-sync-scroll="settings-theme-editor">
            <section style={editorCardStyle}>
                <div style={editorCardHeadingStyle}>LIVE FONT PREVIEW</div>
                <div style={fontPreviewStyle}>
                    <div style={{
                        fontFamily: "var(--mfx-font-heading-family)",
                        fontSize: "var(--mfx-font-heading-size)",
                        fontWeight: 900,
                        color: MFX_SURFACES.panel.accent
                    }}>
                        PERFORMANCE
                    </div>
                    <div style={fontPreviewGridStyle}>
                        <div style={fontPreviewPanelStyle}>
                            <div style={{
                                fontFamily: "var(--mfx-font-switch-label-family)",
                                fontSize: "var(--mfx-font-switch-label-size)",
                                color: "var(--mfx-role-preset-active-label)",
                                fontWeight: 900
                            }}>
                                SW 1
                            </div>
                            <div style={{
                                fontFamily: "var(--mfx-font-switch-value-family)",
                                fontSize: "var(--mfx-font-switch-value-size)",
                                color: "var(--mfx-role-preset-active-value)",
                                fontWeight: 900
                            }}>
                                Oxford Clean
                            </div>
                        </div>
                        <div style={fontPreviewPanelStyle}>
                            <div style={{
                                fontFamily: "var(--mfx-font-control-label-family)",
                                fontSize: "var(--mfx-font-control-label-size)",
                                color: MFX_SURFACES.panel.label,
                                fontWeight: 900
                            }}>
                                POT 1
                            </div>
                            <div style={{
                                fontFamily: "var(--mfx-font-control-function-family)",
                                fontSize: "var(--mfx-font-control-function-size)",
                                fontWeight: 900
                            }}>
                                Delay · Feedback
                            </div>
                            <div style={{
                                fontFamily: "var(--mfx-font-control-value-family)",
                                fontSize: "var(--mfx-font-control-value-size)",
                                color: MFX_SURFACES.panel.accent,
                                fontWeight: 900
                            }}>
                                72.5%
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {FONT_SECTIONS.map((section) => (
                <section key={section.heading} style={editorCardStyle}>
                    <div style={editorCardHeadingStyle}>{section.heading}</div>
                    <div style={fontRoleGridStyle}>
                        {section.roles.map(([role, label, sample]) => (
                            <FontRoleField
                                key={role}
                                label={label}
                                sample={sample}
                                value={fonts[role]}
                                onFamily={(family) => patchRole(role, {
                                    family: family as (typeof fonts)[ThemeFontRole]["family"]
                                })}
                                onSize={(sizePercent) => patchRole(role, {
                                    sizePercent
                                })}
                            />
                        ))}
                    </div>
                    {section.heading === "POTS, SLIDERS & ENCODERS" && (
                        <div style={{ marginTop: 8 }}>
                            <NumberEditorField
                                label="Enlarged pop-out size (%)"
                                value={fonts.controlPopupSizePercent}
                                min={100}
                                max={250}
                                step={5}
                                onChange={(controlPopupSizePercent) =>
                                    onChange((next) => {
                                        next.appearance.fonts.controlPopupSizePercent =
                                            controlPopupSizePercent;
                                    })}
                            />
                        </div>
                    )}
                </section>
            ))}
        </div>
    );
}

function FontRoleField({
    label,
    sample,
    value,
    onFamily,
    onSize
}: {
    label: string;
    sample: string;
    value: MultiFXThemeDefinition["appearance"]["fonts"][ThemeFontRole];
    onFamily: (family: string) => void;
    onSize: (size: number) => void;
}) {
    return (
        <div style={fontRoleFieldStyle}>
            <div style={{ minWidth: 0 }}>
                <div style={compactFieldLabelStyle}>{label}</div>
                <div style={{
                    minWidth: 0,
                    marginTop: 3,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    fontFamily: multiFXFontFamilyToCss(value.family),
                    fontSize: `${Math.max(11, 14 * value.sizePercent / 100)}px`,
                    color: MFX_SURFACES.panel.text
                }}>
                    {sample}
                </div>
            </div>
            <select
                value={value.family}
                onChange={(event) => onFamily(event.target.value)}
                style={{
                    ...compactSelectStyle,
                    fontFamily: multiFXFontFamilyToCss(value.family)
                }}
                aria-label={`${label} font`}
            >
                {FONT_GROUP_ORDER.map((group) => (
                    <optgroup key={group} label={group}>
                        {MULTIFX_FONT_OPTIONS
                            .filter((option) => option.group === group)
                            .map((option) => (
                                <option key={option.id} value={option.id}>
                                    {option.label}
                                </option>
                            ))}
                    </optgroup>
                ))}
            </select>
            <label style={{ ...compactFieldStyle, minWidth: 86 }}>
                <span style={compactFieldLabelStyle}>Size %</span>
                <input
                    type="number"
                    min={60}
                    max={220}
                    step={5}
                    value={value.sizePercent}
                    onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next)) {
                            onSize(Math.min(220, Math.max(60, next)));
                        }
                    }}
                    style={{
                        ...compactTextInputStyle,
                        minWidth: 62,
                        fontVariantNumeric: "tabular-nums"
                    }}
                />
            </label>
        </div>
    );
}

function PaintField({
    label,
    value,
    onChange
}: {
    label: string;
    value: MultiFXThemePaint;
    onChange: (value: MultiFXThemePaint) => void;
}) {
    const updateKind = (kind: string) => {
        const colors = kind === "solid"
            ? [value.colors[0]]
            : value.colors.length >= 2
                ? value.colors
                : [value.colors[0], "#000000"];
        onChange({ ...value, kind: kind as MultiFXThemePaint["kind"], colors });
    };
    const updateColorAt = (index: number, color: string) => {
        const colors = [...value.colors];
        colors[index] = color;
        onChange({ ...value, colors });
    };
    return (
        <div style={paintFieldStyle}>
            <div style={compactFieldLabelStyle}>{label}</div>
            <div style={{ ...paintPreviewStyle, background: themePaintToCss(value) }} />
            <select value={value.kind} onChange={(event) => updateKind(event.target.value)} style={compactSelectStyle}>
                <option value="solid">Solid</option>
                <option value="linear">Linear</option>
                <option value="radial">Radial</option>
                <option value="conic">Conic</option>
            </select>
            <div style={paintColorRowStyle}>
                {value.colors.map((color, index) => (
                    <input key={index} type="color" value={color}
                        aria-label={`${label} color ${index + 1}`}
                        onChange={(event) => updateColorAt(index, event.target.value)}
                        style={compactColorInputStyle} />
                ))}
                {value.kind !== "solid" && value.colors.length < 3 && (
                    <button type="button" style={addColorButtonStyle}
                        onClick={() => onChange({ ...value, colors: [...value.colors, value.colors[value.colors.length - 1]] })}>+</button>
                )}
                {value.kind !== "solid" && value.colors.length > 2 && (
                    <button type="button" style={addColorButtonStyle}
                        onClick={() => onChange({ ...value, colors: value.colors.slice(0, -1) })}>−</button>
                )}
            </div>
            {value.kind === "linear" || value.kind === "conic" ? (
                <NumberEditorField label="Angle" value={value.angle} min={0} max={360} step={5}
                    onChange={(angle) => onChange({ ...value, angle })} />
            ) : null}
        </div>
    );
}

function CompactColorField({ label, value, onChange }: {
    label: string; value: string; onChange: (value: string) => void;
}) {
    const [textValue, setTextValue] = useState(value);
    useEffect(() => setTextValue(value), [value]);
    const commitText = () => {
        if (/^#[0-9a-fA-F]{6}$/.test(textValue)) {
            onChange(textValue.toUpperCase());
        } else {
            setTextValue(value);
        }
    };
    return (
        <label style={compactFieldStyle}>
            <span style={compactFieldLabelStyle}>{label}</span>
            <span style={compactColorRowStyle}>
                <input type="color" value={value} onChange={(event) => onChange(event.target.value)} style={compactColorInputStyle} />
                <input value={textValue} maxLength={7}
                    onChange={(event) => setTextValue(event.target.value)}
                    onBlur={commitText}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            commitText();
                            event.currentTarget.blur();
                        }
                    }}
                    style={compactTextInputStyle} />
            </span>
        </label>
    );
}

function TextEditorField({ label, value, onChange }: {
    label: string; value: string; onChange: (value: string) => void;
}) {
    return <label style={compactFieldStyle}><span style={compactFieldLabelStyle}>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} style={compactTextInputStyle} /></label>;
}

function SelectEditorField({ label, value, options, onChange }: {
    label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void;
}) {
    return <label style={compactFieldStyle}><span style={compactFieldLabelStyle}>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} style={compactSelectStyle}>{options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select></label>;
}

function NumberEditorField({ label, value, min, max, step, onChange }: {
    label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void;
}) {
    return <label style={compactFieldStyle}><span style={compactFieldLabelStyle}>{label}</span><input type="number" value={value} min={min} max={max} step={step} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next))); }} style={compactTextInputStyle} /></label>;
}

function CheckboxEditorField({ label, value, onChange }: {
    label: string; value: boolean; onChange: (value: boolean) => void;
}) {
    return <label style={{ ...compactFieldStyle, display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 46 }}><span style={compactFieldLabelStyle}>{label}</span><input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function ThemeCategoryHeader({
    title,
    count
}: {
    title: string;
    count: number;
}) {
    return (
        <div
            style={{
                marginTop:
                    "calc(8px * var(--mfx-ui-scale, 1))",
                padding:
                    "calc(7px * var(--mfx-ui-scale, 1)) calc(5px * var(--mfx-ui-scale, 1)) calc(3px * var(--mfx-ui-scale, 1))",
                borderBottom:
                    `1px solid ${MFX_COLORS.border}`,
                color: MFX_SURFACES.panel.accent,
                fontWeight: 900,
                fontSize: "0.76rem",
                letterSpacing: "0.055em"
            }}
        >
            {title}
            <span
                style={{
                    marginLeft: 6,
                    color: MFX_COLORS.muted,
                    fontWeight: 700,
                    letterSpacing: 0
                }}
            >
                ({count})
            </span>
        </div>
    );
}

function ThemePresetButton({
    preset,
    selected,
    active = false,
    onClick
}: {
    preset: MultiFXThemeDefinition;
    selected: boolean;
    active?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            data-theme-name={preset.name}
            data-mfx-nav-item="true"
            className={selected ? "selected" : undefined}
            aria-current={selected ? "page" : undefined}
            onClick={onClick}
            style={{
                minHeight:
                    "calc(58px * var(--mfx-ui-scale, 1))",
                padding:
                    "calc(7px * var(--mfx-ui-scale, 1)) calc(10px * var(--mfx-ui-scale, 1))",
                borderRadius: 9,
                border:
                    selected || active
                        ? `2px solid ${MFX_COLORS.cyan}`
                        : `1px solid ${MFX_COLORS.border}`,
                background:
                    selected
                        ? MFX_COLORS.cyanSurface
                        : MFX_COLORS.background,
                boxShadow: active && !selected
                    ? `inset 0 0 0 1px ${MFX_COLORS.cyan}`
                    : undefined,
                color:
                    selected
                        ? MFX_COLORS.cyanText
                        : MFX_COLORS.text,
                textAlign: "left",
                font: "inherit",
                cursor: "pointer",
                minWidth: 0
            }}
        >
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div
                    style={{
                        flex: "1 1 auto",
                        minWidth: 0,
                        fontWeight: 900,
                        fontSize: "0.88rem",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                    }}
                >
                    {preset.name}
                </div>
                {active && (
                    <span
                        style={{
                            flex: "0 0 auto",
                            padding: "2px 5px",
                            borderRadius: 99,
                            border: `1px solid ${MFX_COLORS.cyan}`,
                            background: MFX_COLORS.cyanSurface,
                            color: MFX_COLORS.cyanText,
                            fontSize: "0.5rem",
                            fontWeight: 900,
                            letterSpacing: ".035em"
                        }}
                    >
                        ACTIVE
                    </span>
                )}
                <span
                    style={{
                        flex: "0 0 auto",
                        padding: "2px 5px",
                        borderRadius: 99,
                        border: `1px solid ${preset.colors.border}`,
                        background: preset.colors.panelAlt,
                        color: preset.colors.text,
                        fontSize: "0.5rem",
                        fontWeight: 900,
                        letterSpacing: ".035em"
                    }}
                >
                    {getMultiFXThemeStyleLabel(preset)}
                </span>
            </div>

            <ThemeSwatches theme={preset} />
        </button>
    );
}

function ThemeSwatches({
    theme
}: {
    theme: MultiFXThemeDefinition;
}) {
    const values = [
        theme.colors.background,
        theme.colors.panel,
        theme.colors.navigation,
        theme.colors.selected,
        theme.colors.text
    ];

    return (
        <div
            style={{
                display: "flex",
                gap: 4,
                marginTop: 7
            }}
        >
            {values.map((value, index) => (
                <span
                    key={`${value}-${index}`}
                    style={{
                        width: 25,
                        height: 10,
                        borderRadius: 3,
                        background: value,
                        border:
                            "1px solid rgba(255,255,255,0.18)"
                    }}
                />
            ))}
        </div>
    );
}

function ColorField({
    label,
    value,
    onChange
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label
            style={{
                display: "grid",
                gridTemplateColumns:
                    "calc(36px * var(--mfx-ui-scale, 1)) minmax(0, 1fr)",
                gap:
                    "calc(7px * var(--mfx-ui-scale, 1))",
                alignItems: "center",
                width: "100%",
                height: "100%",
                minHeight:
                    "calc(48px * var(--mfx-ui-scale, 1))",
                padding:
                    "calc(6px * var(--mfx-ui-scale, 1)) calc(8px * var(--mfx-ui-scale, 1))",
                boxSizing: "border-box",
                borderRadius: 8,
                border: `1px solid ${MFX_COLORS.border}`,
                background: MFX_COLORS.panel
            }}
        >
            <input
                type="color"
                value={value}
                onChange={(event) =>
                    onChange(event.target.value.toUpperCase())
                }
                style={{
                    width:
                        "calc(34px * var(--mfx-ui-scale, 1))",
                    height:
                        "calc(34px * var(--mfx-ui-scale, 1))",
                    padding: 0,
                    border: 0,
                    background: "transparent"
                }}
            />

            <span style={{ minWidth: 0 }}>
                <span
                    style={{
                        display: "block",
                        color: MFX_COLORS.text,
                        fontWeight: 800,
                        fontSize: "0.78rem",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                    }}
                >
                    {label}
                </span>

                <span
                    style={{
                        display: "block",
                        color: MFX_COLORS.muted,
                        fontSize: "0.68rem",
                        whiteSpace: "nowrap"
                    }}
                >
                    {value}
                </span>
            </span>
        </label>
    );
}

function getThemeCategory(
    theme: MultiFXThemeDefinition
): ThemeCategory {
    if (AMP_VINTAGE_NAMES.has(theme.name)) {
        return "AMP / VINTAGE";
    }

    if (STUDIO_NEUTRAL_NAMES.has(theme.name)) {
        return "STUDIO / NEUTRAL";
    }

    if (TERMINAL_NAMES.has(theme.name)) {
        return "TERMINAL / HIGH CONTRAST";
    }

    const backgroundLuminance =
        relativeLuminance(theme.colors.background);

    if (backgroundLuminance >= 0.55) {
        return "LIGHT";
    }

    if (backgroundLuminance <= 0.10) {
        return "DARK";
    }

    return "COLORFUL";
}

function relativeLuminance(hex: string): number {
    const [r, g, b] = hexToRgb(hex);

    const linearize = (component: number) => {
        const value = component / 255;

        return value <= 0.04045
            ? value / 12.92
            : Math.pow((value + 0.055) / 1.055, 2.4);
    };

    return (
        0.2126 * linearize(r)
        + 0.7152 * linearize(g)
        + 0.0722 * linearize(b)
    );
}

function hexToRgb(hex: string): [number, number, number] {
    const value = hex.replace("#", "");

    return [
        Number.parseInt(value.slice(0, 2), 16),
        Number.parseInt(value.slice(2, 4), 16),
        Number.parseInt(value.slice(4, 6), 16)
    ];
}

function cloneTheme(
    theme: MultiFXThemeDefinition
): MultiFXThemeDefinition {
    return JSON.parse(
        JSON.stringify(theme)
    ) as MultiFXThemeDefinition;
}

function safeName(value: string): string {
    return (
        value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
        || "pimfx-theme"
    );
}

const editorTabsStyle: React.CSSProperties = {
    flex: "0 0 auto",
    display: "grid",
    gridTemplateColumns: "repeat(6,minmax(0,1fr))",
    gap: "clamp(2px, .55vw, 6px)",
    width: "100%",
    minWidth: 0,
    overflowX: "hidden",
    marginBottom: 8
};

const editorTabStyle: React.CSSProperties = {
    minWidth: 0,
    minHeight: 36,
    padding: "4px clamp(1px, .5vw, 6px)",
    border: "1px solid",
    borderRadius: 7,
    font: "inherit",
    fontSize: "clamp(0.5rem, 1.15vw, 0.68rem)",
    fontWeight: 900,
    letterSpacing: "-0.015em",
    overflow: "hidden",
    textOverflow: "clip",
    whiteSpace: "nowrap",
    cursor: "pointer"
};

const smallTabStyle: React.CSSProperties = {
    minHeight: 28,
    padding: "3px 6px",
    borderRadius: 6,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.background,
    color: MFX_COLORS.muted,
    font: "inherit",
    fontSize: "0.62rem",
    fontWeight: 900,
    cursor: "pointer"
};

const smallTabActiveStyle: React.CSSProperties = {
    ...smallTabStyle,
    border: `1px solid ${MFX_COLORS.cyan}`,
    background: MFX_COLORS.cyanSurface,
    color: MFX_COLORS.cyanText
};

const editorScrollStyle: React.CSSProperties = {
    flex: "1 1 auto",
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    paddingRight: 3
};

const editorCardGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
    alignItems: "start",
    gap: 8
};

const editorCardStyle: React.CSSProperties = {
    minWidth: 0,
    marginBottom: 8,
    padding: 9,
    borderRadius: 9,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panelAlt
};

const editorCardHeadingStyle: React.CSSProperties = {
    marginBottom: 7,
    color: MFX_SURFACES.panel.accent,
    fontSize: "0.74rem",
    fontWeight: 950,
    letterSpacing: "0.055em"
};

const fontPreviewStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0
};

const fontPreviewGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
    gap: 8,
    minWidth: 0
};

const fontPreviewPanelStyle: React.CSSProperties = {
    minWidth: 0,
    minHeight: 78,
    padding: 8,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    overflow: "hidden",
    textAlign: "center",
    border: `1px solid ${MFX_COLORS.border}`,
    borderRadius: 8,
    background: MFX_SURFACES.panel.background
};

const fontRoleGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns:
        "repeat(auto-fit,minmax(min(100%,360px),1fr))",
    gap: 8,
    minWidth: 0
};

const fontRoleFieldStyle: React.CSSProperties = {
    minWidth: 0,
    padding: 8,
    display: "grid",
    gridTemplateColumns: "minmax(0,1fr) minmax(92px,1.1fr) 86px",
    alignItems: "end",
    gap: 7,
    border: `1px solid ${MFX_COLORS.border}`,
    borderRadius: 8,
    background: MFX_COLORS.background
};

const twoColumnEditorStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
    gap: 6
};

const threeColumnEditorStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(3,minmax(0,1fr))",
    gap: 6
};

const controlStateStyle: React.CSSProperties = {
    marginTop: 6,
    paddingTop: 6,
    borderTop: `1px solid ${MFX_COLORS.border}`
};

const controlStateHeadingStyle: React.CSSProperties = {
    marginBottom: 5,
    color: MFX_COLORS.cyan,
    fontSize: "0.62rem",
    fontWeight: 950
};

const compactFieldStyle: React.CSSProperties = {
    minWidth: 0,
    display: "grid",
    gap: 4,
    padding: 6,
    borderRadius: 7,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panel
};

const compactFieldLabelStyle: React.CSSProperties = {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    color: MFX_COLORS.muted,
    fontSize: "0.62rem",
    fontWeight: 850
};

const compactColorRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 5,
    minWidth: 0
};

const compactColorInputStyle: React.CSSProperties = {
    flex: "0 0 34px",
    width: 34,
    height: 30,
    padding: 0,
    border: 0,
    background: "transparent"
};

const compactTextInputStyle: React.CSSProperties = {
    width: "100%",
    minWidth: 0,
    minHeight: 30,
    padding: "3px 6px",
    boxSizing: "border-box",
    borderRadius: 5,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.background,
    color: MFX_COLORS.text,
    font: "inherit",
    fontSize: "0.68rem"
};

const compactSelectStyle: React.CSSProperties = {
    ...compactTextInputStyle,
    cursor: "pointer"
};

const paintFieldStyle: React.CSSProperties = {
    ...compactFieldStyle,
    alignContent: "start"
};

const paintPreviewStyle: React.CSSProperties = {
    height: 24,
    borderRadius: 5,
    border: "1px solid rgba(255,255,255,.18)"
};

const paintColorRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 4
};

const addColorButtonStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    padding: 0,
    borderRadius: 5,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.background,
    color: MFX_COLORS.cyan,
    font: "inherit",
    fontWeight: 950,
    cursor: "pointer"
};

const screenStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: MFX_SURFACES.page.background,
    color: MFX_SURFACES.page.text
};

const headerStyle: React.CSSProperties = {
    minHeight: "var(--mfx-header-height, 56px)",
    display: "flex",
    alignItems: "center",
    padding:
        "calc(6px * var(--mfx-ui-scale, 1)) calc(70px * var(--mfx-ui-scale, 1)) calc(6px * var(--mfx-ui-scale, 1)) calc(78px * var(--mfx-ui-scale, 1))",
    boxSizing: "border-box",
    borderBottom: `1px solid ${MFX_COLORS.border}`,
    background: MFX_SURFACES.header.background,
    color: MFX_SURFACES.header.text,
    boxShadow: MFX_SURFACES.header.shadow
};

const titleStyle: React.CSSProperties = {
    color: MFX_SURFACES.header.accent,
    fontWeight: 900,
    letterSpacing: "0.05em"
};

const subtitleStyle: React.CSSProperties = {
    marginTop: 2,
    color: MFX_SURFACES.header.label,
    fontSize: "0.72rem"
};

const sectionTitleStyle: React.CSSProperties = {
    color: MFX_SURFACES.panel.accent,
    fontWeight: 900,
    marginBottom: 8
};

const fieldLabelStyle: React.CSSProperties = {
    display: "block",
    color: MFX_COLORS.muted,
    fontSize: "0.76rem",
    fontWeight: 800,
    marginBottom: 5
};

const textInputStyle: React.CSSProperties = {
    width: "100%",
    height: 42,
    padding: "0 10px",
    boxSizing: "border-box",
    borderRadius: 8,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.background,
    color: MFX_COLORS.text,
    font: "inherit"
};

const buttonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    padding: "6px 12px",
    borderRadius: 8,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panelAlt,
    color: MFX_COLORS.text,
    font: "inherit",
    fontWeight: 850,
    cursor: "pointer"
};

const primaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    border: `2px solid ${MFX_COLORS.purple}`,
    background: MFX_COLORS.purpleSurface,
    color: MFX_COLORS.purpleLight
};
