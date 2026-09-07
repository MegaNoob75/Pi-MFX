export type MultiFXPaintKind = "solid" | "linear" | "radial" | "conic";

export interface MultiFXThemePaint {
    kind: MultiFXPaintKind;
    colors: string[];
    angle: number;
}

export interface MultiFXThemeSurface {
    background: MultiFXThemePaint;
    border: MultiFXThemePaint;
    text: string;
    label: string;
    accent: string;
    shadow: string;
}

export interface MultiFXThemeControlState {
    background: MultiFXThemePaint;
    border: MultiFXThemePaint;
    label: string;
    value: string;
    indicator: string;
    shadow: string;
}

export interface MultiFXThemeControlRole {
    normal: MultiFXThemeControlState;
    active: MultiFXThemeControlState;
}

export type MultiFXSwitchVisualStyle =
    | "tiles"
    | "footswitch"
    | "arcade"
    | "glass"
    | "minimal";
export type MultiFXSwitchShape =
    | "rounded"
    | "square"
    | "pill"
    | "bevel"
    | "hexagon";
export type MultiFXAnalogVisualStyle =
    | "modern"
    | "vintage"
    | "neon"
    | "minimal";
export type MultiFXIndicatorStyle =
    | "dot"
    | "ring"
    | "halo"
    | "bar"
    | "none";
export type MultiFXIndicatorAnimation =
    | "none"
    | "pulse"
    | "breathe"
    | "spin"
    | "chase";

/**
 * Stable font identifiers are stored in theme files instead of raw CSS.
 * This keeps imported themes safe and lets us improve a font's fallback
 * stack later without rewriting every saved theme.
 */
export type MultiFXFontFamilyId =
    | "system-ui"
    | "roboto"
    | "cooper-hewitt"
    | "questrial"
    | "comfortaa"
    | "inter"
    | "open-sans"
    | "lato"
    | "montserrat"
    | "oswald"
    | "source-sans-3"
    | "noto-sans"
    | "nunito"
    | "roboto-mono"
    | "orbitron"
    | "rajdhani"
    | "arial"
    | "verdana"
    | "trebuchet"
    | "tahoma"
    | "georgia"
    | "palatino"
    | "times"
    | "slab-serif"
    | "courier"
    | "console"
    | "condensed"
    | "heavy-display"
    | "rounded"
    | "lcd-7-classic"
    | "lcd-7-modern"
    | "lcd-14-classic"
    | "lcd-14-modern";

export interface MultiFXFontOption {
    id: MultiFXFontFamilyId;
    label: string;
    group: "BUILT IN" | "SYSTEM" | "DIGITAL / LCD";
    cssFamily: string;
}

/** Font selector catalog shared by the theme editor and CSS application. */
export const MULTIFX_FONT_OPTIONS: readonly MultiFXFontOption[] = [
    { id: "system-ui", label: "System UI", group: "SYSTEM", cssFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
    { id: "roboto", label: "Roboto", group: "BUILT IN", cssFamily: "Roboto, Arial, sans-serif" },
    { id: "cooper-hewitt", label: "Cooper Hewitt", group: "BUILT IN", cssFamily: "'MFX Cooper Hewitt', Roboto, sans-serif" },
    { id: "questrial", label: "Questrial", group: "BUILT IN", cssFamily: "'MFX Questrial', Roboto, sans-serif" },
    { id: "comfortaa", label: "Comfortaa Rounded", group: "BUILT IN", cssFamily: "'MFX Comfortaa', Roboto, sans-serif" },
    { id: "inter", label: "Inter", group: "BUILT IN", cssFamily: "Inter, Roboto, sans-serif" },
    { id: "open-sans", label: "Open Sans", group: "BUILT IN", cssFamily: "'Open Sans', Roboto, sans-serif" },
    { id: "lato", label: "Lato", group: "BUILT IN", cssFamily: "Lato, Roboto, sans-serif" },
    { id: "montserrat", label: "Montserrat", group: "BUILT IN", cssFamily: "Montserrat, Roboto, sans-serif" },
    { id: "oswald", label: "Oswald Condensed", group: "BUILT IN", cssFamily: "Oswald, Roboto, sans-serif" },
    { id: "source-sans-3", label: "Source Sans 3", group: "BUILT IN", cssFamily: "'Source Sans 3', Roboto, sans-serif" },
    { id: "noto-sans", label: "Noto Sans", group: "BUILT IN", cssFamily: "'Noto Sans', Roboto, sans-serif" },
    { id: "nunito", label: "Nunito Rounded", group: "BUILT IN", cssFamily: "Nunito, Roboto, sans-serif" },
    { id: "roboto-mono", label: "Roboto Mono", group: "BUILT IN", cssFamily: "'Roboto Mono', monospace" },
    { id: "orbitron", label: "Orbitron Tech", group: "BUILT IN", cssFamily: "Orbitron, Roboto, sans-serif" },
    { id: "rajdhani", label: "Rajdhani Display", group: "BUILT IN", cssFamily: "Rajdhani, Roboto, sans-serif" },
    { id: "arial", label: "Arial / Helvetica", group: "SYSTEM", cssFamily: "Arial, Helvetica, sans-serif" },
    { id: "verdana", label: "Verdana", group: "SYSTEM", cssFamily: "Verdana, Geneva, sans-serif" },
    { id: "trebuchet", label: "Trebuchet", group: "SYSTEM", cssFamily: "'Trebuchet MS', Arial, sans-serif" },
    { id: "tahoma", label: "Tahoma", group: "SYSTEM", cssFamily: "Tahoma, Verdana, sans-serif" },
    { id: "georgia", label: "Georgia", group: "SYSTEM", cssFamily: "Georgia, 'Times New Roman', serif" },
    { id: "palatino", label: "Palatino", group: "SYSTEM", cssFamily: "Palatino, 'Palatino Linotype', Georgia, serif" },
    { id: "times", label: "Times", group: "SYSTEM", cssFamily: "'Times New Roman', Times, serif" },
    { id: "slab-serif", label: "Slab Serif", group: "SYSTEM", cssFamily: "Rockwell, 'Roboto Slab', Georgia, serif" },
    { id: "courier", label: "Courier Typewriter", group: "SYSTEM", cssFamily: "'Courier New', Courier, monospace" },
    { id: "console", label: "Console Mono", group: "SYSTEM", cssFamily: "Consolas, 'Liberation Mono', monospace" },
    { id: "condensed", label: "Condensed", group: "SYSTEM", cssFamily: "Bahnschrift, 'Arial Narrow', Roboto, sans-serif" },
    { id: "heavy-display", label: "Heavy Display", group: "SYSTEM", cssFamily: "Impact, 'Arial Black', Roboto, sans-serif" },
    { id: "rounded", label: "Rounded", group: "SYSTEM", cssFamily: "'Arial Rounded MT Bold', 'MFX Comfortaa', Roboto, sans-serif" },
    { id: "lcd-7-classic", label: "LCD 7-Segment Classic", group: "DIGITAL / LCD", cssFamily: "'MFX DSEG7 Classic', monospace" },
    { id: "lcd-7-modern", label: "LCD 7-Segment Modern", group: "DIGITAL / LCD", cssFamily: "'MFX DSEG7 Modern', monospace" },
    { id: "lcd-14-classic", label: "LCD 14-Segment Classic", group: "DIGITAL / LCD", cssFamily: "'MFX DSEG14 Classic', monospace" },
    { id: "lcd-14-modern", label: "LCD 14-Segment Modern", group: "DIGITAL / LCD", cssFamily: "'MFX DSEG14 Modern', monospace" }
] as const;

const MULTIFX_FONT_IDS = new Set<MultiFXFontFamilyId>(
    MULTIFX_FONT_OPTIONS.map((option) => option.id)
);

export function multiFXFontFamilyToCss(id: MultiFXFontFamilyId): string {
    return MULTIFX_FONT_OPTIONS.find((option) => option.id === id)
        ?.cssFamily ?? MULTIFX_FONT_OPTIONS[0].cssFamily;
}

export interface MultiFXThemeTextStyle {
    family: MultiFXFontFamilyId;
    /** Percentage of the carefully chosen responsive base size. */
    sizePercent: number;
}

export interface MultiFXThemeFonts {
    interface: MultiFXThemeTextStyle;
    heading: MultiFXThemeTextStyle;
    label: MultiFXThemeTextStyle;
    value: MultiFXThemeTextStyle;
    switchLabel: MultiFXThemeTextStyle;
    switchValue: MultiFXThemeTextStyle;
    controlLabel: MultiFXThemeTextStyle;
    controlFunction: MultiFXThemeTextStyle;
    controlValue: MultiFXThemeTextStyle;
    feedback: MultiFXThemeTextStyle;
    /** Additional magnification used only by the enlarged hardware pop-out. */
    controlPopupSizePercent: number;
}

export interface MultiFXThemeAppearance {
    surfaces: {
        page: MultiFXThemeSurface;
        header: MultiFXThemeSurface;
        panel: MultiFXThemeSurface;
        popup: MultiFXThemeSurface;
        toast: MultiFXThemeSurface;
        menu: MultiFXThemeSurface;
    };
    roles: {
        preset: MultiFXThemeControlRole;
        navigation: MultiFXThemeControlRole;
        utility: MultiFXThemeControlRole;
        snapshot: MultiFXThemeControlRole;
        bypass: MultiFXThemeControlRole;
        danger: MultiFXThemeControlRole;
    };
    controls: {
        switchStyle: MultiFXSwitchVisualStyle;
        switchShape: MultiFXSwitchShape;
        analogStyle: MultiFXAnalogVisualStyle;
        indicatorStyle: MultiFXIndicatorStyle;
        indicatorAnimation: MultiFXIndicatorAnimation;
        indicatorInactive: string;
        indicatorActive: string;
        indicatorChanged: string;
        animationSeconds: number;
        borderWidth: number;
        cornerRadius: number;
        glowStrength: number;
        disabledOpacity: number;
        glassBlur: number;
        glassHighlight: number;
    };
    motion: {
        enabled: boolean;
        respectReducedMotion: boolean;
        feedbackDurationMs: number;
    };
    fonts: MultiFXThemeFonts;
}

export interface MultiFXThemeDefinition {
    name: string;
    author: string;
    version: 4;
    colors: {
        background: string;
        panel: string;
        panelAlt: string;
        navigation: string;
        navigationText: string;
        navigationSurface: string;
        selected: string;
        selectedSurface: string;
        selectedText: string;
        text: string;
        muted: string;
        border: string;
        danger: string;
    };
    appearance: MultiFXThemeAppearance;
}

interface MultiFXThemePaletteDefinition {
    name: string;
    author: string;
    version: number;
    colors: MultiFXThemeDefinition["colors"];
}

const BUILT_IN_THEME_PALETTES: MultiFXThemePaletteDefinition[] = [
    {
        name: "Pi-MFX Purple",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#0D0B12",
            panel: "#18151E",
            panelAlt: "#211D27",
            navigation: "#A770E4",
            navigationText: "#D8B4FE",
            navigationSurface: "#2B1E3B",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#F5F3F7",
            muted: "#B7AFBF",
            border: "#42384D",
            danger: "#F87171"
        }
    },
    {
        name: "Midnight Blue",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#081018",
            panel: "#101B28",
            panelAlt: "#172536",
            navigation: "#60A5FA",
            navigationText: "#DBEAFE",
            navigationSurface: "#172A46",
            selected: "#22D3EE",
            selectedSurface: "#073344",
            selectedText: "#ECFEFF",
            text: "#F1F5F9",
            muted: "#94A3B8",
            border: "#334155",
            danger: "#FB7185"
        }
    },
    {
        name: "Amber Stage",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#110D07",
            panel: "#1E1710",
            panelAlt: "#2A2117",
            navigation: "#F59E0B",
            navigationText: "#FEF3C7",
            navigationSurface: "#3A290D",
            selected: "#FDE047",
            selectedSurface: "#3B3205",
            selectedText: "#FFFCE8",
            text: "#FFF7ED",
            muted: "#C7B59F",
            border: "#5A4631",
            danger: "#FB7185"
        }
    },
    {
        name: "Crimson Stage",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#12090C",
            panel: "#211116",
            panelAlt: "#301820",
            navigation: "#FB7185",
            navigationText: "#FFE4E6",
            navigationSurface: "#461823",
            selected: "#FBBF24",
            selectedSurface: "#422A05",
            selectedText: "#FFFBEB",
            text: "#FFF1F2",
            muted: "#C8A8AF",
            border: "#5C303A",
            danger: "#F43F5E"
        }
    },
    {
        name: "High Contrast",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#000000",
            panel: "#101010",
            panelAlt: "#1B1B1B",
            navigation: "#FFFF00",
            navigationText: "#000000",
            navigationSurface: "#807600",
            selected: "#00FFFF",
            selectedSurface: "#005A5A",
            selectedText: "#FFFFFF",
            text: "#FFFFFF",
            muted: "#D0D0D0",
            border: "#FFFFFF",
            danger: "#FF4D4D"
        }
    },
    {
        name: "Emerald Stage",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#07110D",
            panel: "#0E1D16",
            panelAlt: "#15281E",
            navigation: "#34D399",
            navigationText: "#D1FAE5",
            navigationSurface: "#123729",
            selected: "#67E8F9",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#F0FDF4",
            muted: "#9DB8A9",
            border: "#2F5142",
            danger: "#FB7185"
        }
    },
    {
        name: "Neon Arcade",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#08070F",
            panel: "#141126",
            panelAlt: "#1D1835",
            navigation: "#E879F9",
            navigationText: "#FAE8FF",
            navigationSurface: "#3B1747",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#FDF4FF",
            muted: "#BFA9C8",
            border: "#51365B",
            danger: "#FF5C8A"
        }
    },
    {
        name: "Ocean Drive",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#061116",
            panel: "#0D2028",
            panelAlt: "#14303A",
            navigation: "#38BDF8",
            navigationText: "#E0F2FE",
            navigationSurface: "#123A50",
            selected: "#2DD4BF",
            selectedSurface: "#073F3B",
            selectedText: "#ECFEFF",
            text: "#F0FDFA",
            muted: "#9EBCC0",
            border: "#31515A",
            danger: "#FB7185"
        }
    },
    {
        name: "Cyber Lime",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#091006",
            panel: "#141D10",
            panelAlt: "#1E2A17",
            navigation: "#A3E635",
            navigationText: "#F7FEE7",
            navigationSurface: "#334A16",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#F7FEE7",
            muted: "#A9B99A",
            border: "#465A34",
            danger: "#FB7185"
        }
    },
    {
        name: "Sunset",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#140A0E",
            panel: "#24121A",
            panelAlt: "#321823",
            navigation: "#FB7185",
            navigationText: "#FFE4E6",
            navigationSurface: "#4A1828",
            selected: "#FB923C",
            selectedSurface: "#4A2410",
            selectedText: "#FFF7ED",
            text: "#FFF1F2",
            muted: "#C9A5AA",
            border: "#653443",
            danger: "#F43F5E"
        }
    },
    {
        name: "Violet Night",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#0B0814",
            panel: "#171123",
            panelAlt: "#21182F",
            navigation: "#8B5CF6",
            navigationText: "#EDE9FE",
            navigationSurface: "#30205A",
            selected: "#C084FC",
            selectedSurface: "#3B1261",
            selectedText: "#FAF5FF",
            text: "#F5F3FF",
            muted: "#B3A7C8",
            border: "#493A63",
            danger: "#FB7185"
        }
    },
    {
        name: "Deep Teal",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#061111",
            panel: "#0D1C1C",
            panelAlt: "#142727",
            navigation: "#2DD4BF",
            navigationText: "#CCFBF1",
            navigationSurface: "#123C38",
            selected: "#67E8F9",
            selectedSurface: "#0B3A43",
            selectedText: "#ECFEFF",
            text: "#F0FDFA",
            muted: "#9AB7B3",
            border: "#31504D",
            danger: "#FB7185"
        }
    },
    {
        name: "Ice Blue",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#071016",
            panel: "#101C26",
            panelAlt: "#192A37",
            navigation: "#7DD3FC",
            navigationText: "#E0F2FE",
            navigationSurface: "#19364A",
            selected: "#A5F3FC",
            selectedSurface: "#164E63",
            selectedText: "#ECFEFF",
            text: "#F0F9FF",
            muted: "#A4B5C2",
            border: "#3D5668",
            danger: "#FB7185"
        }
    },
    {
        name: "Royal Gold",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#100C08",
            panel: "#1C1710",
            panelAlt: "#292116",
            navigation: "#C084FC",
            navigationText: "#F3E8FF",
            navigationSurface: "#39204C",
            selected: "#FACC15",
            selectedSurface: "#4A3A05",
            selectedText: "#FEFCE8",
            text: "#FFF7ED",
            muted: "#BEB09A",
            border: "#51442E",
            danger: "#FB7185"
        }
    },
    {
        name: "Copper",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#120B07",
            panel: "#21150F",
            panelAlt: "#302017",
            navigation: "#D97706",
            navigationText: "#FFEDD5",
            navigationSurface: "#4A2B10",
            selected: "#FDBA74",
            selectedSurface: "#4A250E",
            selectedText: "#FFF7ED",
            text: "#FFF7ED",
            muted: "#C4AA96",
            border: "#5A3D2B",
            danger: "#FB7185"
        }
    },
    {
        name: "Graphite",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#090A0C",
            panel: "#15171B",
            panelAlt: "#202329",
            navigation: "#94A3B8",
            navigationText: "#F1F5F9",
            navigationSurface: "#30343B",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#F8FAFC",
            muted: "#A3AAB5",
            border: "#3D424C",
            danger: "#FB7185"
        }
    },
    {
        name: "Slate Purple",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#0C0D12",
            panel: "#181A23",
            panelAlt: "#232633",
            navigation: "#818CF8",
            navigationText: "#E0E7FF",
            navigationSurface: "#2F3260",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#F8FAFC",
            muted: "#A5AABE",
            border: "#3F4356",
            danger: "#FB7185"
        }
    },
    {
        name: "Hot Pink",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#130912",
            panel: "#221020",
            panelAlt: "#32172E",
            navigation: "#F472B6",
            navigationText: "#FCE7F3",
            navigationSurface: "#4A183A",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#FDF2F8",
            muted: "#C6A5BA",
            border: "#623650",
            danger: "#FB7185"
        }
    },
    {
        name: "Retro Green",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#050B06",
            panel: "#0C160D",
            panelAlt: "#132216",
            navigation: "#4ADE80",
            navigationText: "#DCFCE7",
            navigationSurface: "#174429",
            selected: "#FACC15",
            selectedSurface: "#493E06",
            selectedText: "#FEFCE8",
            text: "#F0FDF4",
            muted: "#9FB4A2",
            border: "#315038",
            danger: "#FB7185"
        }
    },
    {
        name: "Synthwave",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#0A0714",
            panel: "#171025",
            panelAlt: "#24153A",
            navigation: "#C026D3",
            navigationText: "#FAE8FF",
            navigationSurface: "#461456",
            selected: "#06B6D4",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#FAF5FF",
            muted: "#B8A7C8",
            border: "#4B3761",
            danger: "#FB7185"
        }
    },
    {
        name: "Solar",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#120F05",
            panel: "#211B0B",
            panelAlt: "#302715",
            navigation: "#EAB308",
            navigationText: "#FEF9C3",
            navigationSurface: "#493B06",
            selected: "#F97316",
            selectedSurface: "#4A2306",
            selectedText: "#FFF7ED",
            text: "#FEFCE8",
            muted: "#BEB28C",
            border: "#554A29",
            danger: "#EF4444"
        }
    },
    {
        name: "Arctic",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#071115",
            panel: "#0F1C22",
            panelAlt: "#172A33",
            navigation: "#38BDF8",
            navigationText: "#E0F2FE",
            navigationSurface: "#12384B",
            selected: "#E0F2FE",
            selectedSurface: "#164E63",
            selectedText: "#FFFFFF",
            text: "#F8FAFC",
            muted: "#AFC3CC",
            border: "#3B5662",
            danger: "#FB7185"
        }
    },
    {
        name: "Purple Rain",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#0E0912",
            panel: "#1B1022",
            panelAlt: "#291631",
            navigation: "#A855F7",
            navigationText: "#F3E8FF",
            navigationSurface: "#391451",
            selected: "#38BDF8",
            selectedSurface: "#123A52",
            selectedText: "#F0F9FF",
            text: "#FAF5FF",
            muted: "#B9A8C4",
            border: "#51365D",
            danger: "#FB7185"
        }
    },
    {
        name: "Orange Crush",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#130B05",
            panel: "#22140B",
            panelAlt: "#321F10",
            navigation: "#F97316",
            navigationText: "#FFEDD5",
            navigationSurface: "#4B250A",
            selected: "#FACC15",
            selectedSurface: "#4A3B05",
            selectedText: "#FEFCE8",
            text: "#FFF7ED",
            muted: "#C7AA8D",
            border: "#614126",
            danger: "#EF4444"
        }
    },
    {
        name: "Mono Light",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#E9E9EC",
            panel: "#FFFFFF",
            panelAlt: "#DADAE0",
            navigation: "#5B21B6",
            navigationText: "#2E1065",
            navigationSurface: "#DDD6FE",
            selected: "#0369A1",
            selectedSurface: "#CFFAFE",
            selectedText: "#083344",
            text: "#111827",
            muted: "#4B5563",
            border: "#A7A7B1",
            danger: "#B91C1C"
        }
    },
    {
        name: "Blackout",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#000000",
            panel: "#080808",
            panelAlt: "#111111",
            navigation: "#A78BFA",
            navigationText: "#EDE9FE",
            navigationSurface: "#24163D",
            selected: "#22D3EE",
            selectedSurface: "#052E35",
            selectedText: "#ECFEFF",
            text: "#FAFAFA",
            muted: "#A3A3A3",
            border: "#292929",
            danger: "#EF4444"
        }
    },
    {
        name: "Tube Glow",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#100805",
            panel: "#21110A",
            panelAlt: "#321A0D",
            navigation: "#F97316",
            navigationText: "#FFEDD5",
            navigationSurface: "#4A250A",
            selected: "#FBBF24",
            selectedSurface: "#4A3505",
            selectedText: "#FFFBEB",
            text: "#FFF7ED",
            muted: "#C7A58C",
            border: "#633A21",
            danger: "#EF4444"
        }
    },
    {
        name: "British Stack",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#090909",
            panel: "#171717",
            panelAlt: "#242424",
            navigation: "#DC2626",
            navigationText: "#FEE2E2",
            navigationSurface: "#451A1A",
            selected: "#F59E0B",
            selectedSurface: "#422006",
            selectedText: "#FFFBEB",
            text: "#F5F5F5",
            muted: "#A3A3A3",
            border: "#404040",
            danger: "#F87171"
        }
    },
    {
        name: "Boutique Blue",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#07101C",
            panel: "#0E1D31",
            panelAlt: "#162A43",
            navigation: "#3B82F6",
            navigationText: "#DBEAFE",
            navigationSurface: "#173B70",
            selected: "#F59E0B",
            selectedSurface: "#453105",
            selectedText: "#FFFBEB",
            text: "#EFF6FF",
            muted: "#9DB1C9",
            border: "#34506F",
            danger: "#FB7185"
        }
    },
    {
        name: "Vintage Cream",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#E9DFC7",
            panel: "#F5EBD6",
            panelAlt: "#D9C9A8",
            navigation: "#7C2D12",
            navigationText: "#FFF7ED",
            navigationSurface: "#CFAE87",
            selected: "#0F766E",
            selectedSurface: "#CCFBF1",
            selectedText: "#134E4A",
            text: "#2B2118",
            muted: "#685B49",
            border: "#A79478",
            danger: "#B91C1C"
        }
    },
    {
        name: "Brownface",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#160D08",
            panel: "#2A1A10",
            panelAlt: "#3B291A",
            navigation: "#C08457",
            navigationText: "#FFF1DC",
            navigationSurface: "#56361D",
            selected: "#EAB308",
            selectedSurface: "#473A05",
            selectedText: "#FEFCE8",
            text: "#FFF7ED",
            muted: "#BDA38C",
            border: "#634936",
            danger: "#FB7185"
        }
    },
    {
        name: "Seafoam",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#071211",
            panel: "#102421",
            panelAlt: "#17332F",
            navigation: "#2DD4BF",
            navigationText: "#CCFBF1",
            navigationSurface: "#14453F",
            selected: "#F472B6",
            selectedSurface: "#4A1936",
            selectedText: "#FDF2F8",
            text: "#F0FDFA",
            muted: "#9EBAB4",
            border: "#345A54",
            danger: "#FB7185"
        }
    },
    {
        name: "Surf Green",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#08130E",
            panel: "#10251A",
            panelAlt: "#173623",
            navigation: "#4ADE80",
            navigationText: "#DCFCE7",
            navigationSurface: "#17452A",
            selected: "#FDE047",
            selectedSurface: "#443B08",
            selectedText: "#FEFCE8",
            text: "#F0FDF4",
            muted: "#A4B9AA",
            border: "#375541",
            danger: "#FB7185"
        }
    },
    {
        name: "Lavender Fog",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#100D17",
            panel: "#1D1828",
            panelAlt: "#2A2338",
            navigation: "#C4B5FD",
            navigationText: "#F5F3FF",
            navigationSurface: "#3A3153",
            selected: "#67E8F9",
            selectedSurface: "#123B45",
            selectedText: "#ECFEFF",
            text: "#FAF5FF",
            muted: "#BDB3CC",
            border: "#514867",
            danger: "#FB7185"
        }
    },
    {
        name: "Magma",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#160704",
            panel: "#2A0D07",
            panelAlt: "#3C140B",
            navigation: "#F97316",
            navigationText: "#FFEDD5",
            navigationSurface: "#5A210B",
            selected: "#EF4444",
            selectedSurface: "#4C0D0D",
            selectedText: "#FEF2F2",
            text: "#FFF7ED",
            muted: "#C7A092",
            border: "#6A3024",
            danger: "#FACC15"
        }
    },
    {
        name: "Electric Blue",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#050B16",
            panel: "#0B1730",
            panelAlt: "#102247",
            navigation: "#2563EB",
            navigationText: "#DBEAFE",
            navigationSurface: "#163A78",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#EFF6FF",
            muted: "#93A9C9",
            border: "#2D4E78",
            danger: "#FB7185"
        }
    },
    {
        name: "Laser Green",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#030B07",
            panel: "#09170E",
            panelAlt: "#102617",
            navigation: "#22C55E",
            navigationText: "#DCFCE7",
            navigationSurface: "#0F4221",
            selected: "#A3E635",
            selectedSurface: "#2C450D",
            selectedText: "#F7FEE7",
            text: "#F0FDF4",
            muted: "#8FB69D",
            border: "#28553A",
            danger: "#FB7185"
        }
    },
    {
        name: "Acid Purple",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#0D0712",
            panel: "#1C0E27",
            panelAlt: "#2A123B",
            navigation: "#D946EF",
            navigationText: "#FAE8FF",
            navigationSurface: "#4B1455",
            selected: "#A3E635",
            selectedSurface: "#2F460D",
            selectedText: "#F7FEE7",
            text: "#FDF4FF",
            muted: "#BAA5C7",
            border: "#593369",
            danger: "#FB7185"
        }
    },
    {
        name: "Cherry Cola",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#12070A",
            panel: "#241015",
            panelAlt: "#341820",
            navigation: "#BE123C",
            navigationText: "#FFE4E6",
            navigationSurface: "#4B101F",
            selected: "#FB7185",
            selectedSurface: "#4B1320",
            selectedText: "#FFF1F2",
            text: "#FFF1F2",
            muted: "#C6A2AA",
            border: "#5C3038",
            danger: "#F59E0B"
        }
    },
    {
        name: "Tangerine",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#160C04",
            panel: "#281508",
            panelAlt: "#3B210D",
            navigation: "#FB923C",
            navigationText: "#FFEDD5",
            navigationSurface: "#572D0A",
            selected: "#FDE047",
            selectedSurface: "#443B08",
            selectedText: "#FEFCE8",
            text: "#FFF7ED",
            muted: "#C8A78D",
            border: "#654326",
            danger: "#EF4444"
        }
    },
    {
        name: "Mint Chocolate",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#0C110D",
            panel: "#172018",
            panelAlt: "#223026",
            navigation: "#34D399",
            navigationText: "#D1FAE5",
            navigationSurface: "#164632",
            selected: "#A78BFA",
            selectedSurface: "#30254E",
            selectedText: "#F5F3FF",
            text: "#F0FDF4",
            muted: "#A5B5A7",
            border: "#405343",
            danger: "#FB7185"
        }
    },
    {
        name: "Blue Steel",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#080B10",
            panel: "#121923",
            panelAlt: "#1C2734",
            navigation: "#64748B",
            navigationText: "#F1F5F9",
            navigationSurface: "#2C3848",
            selected: "#38BDF8",
            selectedSurface: "#12394C",
            selectedText: "#F0F9FF",
            text: "#F8FAFC",
            muted: "#AAB3BE",
            border: "#3B4655",
            danger: "#FB7185"
        }
    },
    {
        name: "Gunmetal",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#07090A",
            panel: "#101416",
            panelAlt: "#1A2023",
            navigation: "#71717A",
            navigationText: "#F4F4F5",
            navigationSurface: "#2D3338",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#FAFAFA",
            muted: "#A1A1AA",
            border: "#353B40",
            danger: "#F87171"
        }
    },
    {
        name: "Goldtop",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#120E05",
            panel: "#211A0B",
            panelAlt: "#302714",
            navigation: "#CA8A04",
            navigationText: "#FEF9C3",
            navigationSurface: "#493B06",
            selected: "#FDE047",
            selectedSurface: "#4A3C05",
            selectedText: "#FEFCE8",
            text: "#FFF7ED",
            muted: "#C1B08F",
            border: "#584B2D",
            danger: "#EF4444"
        }
    },
    {
        name: "Silverface",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#0B0D10",
            panel: "#171B21",
            panelAlt: "#222833",
            navigation: "#CBD5E1",
            navigationText: "#0F172A",
            navigationSurface: "#526273",
            selected: "#60A5FA",
            selectedSurface: "#172A46",
            selectedText: "#EFF6FF",
            text: "#F8FAFC",
            muted: "#B4BDC8",
            border: "#475569",
            danger: "#FB7185"
        }
    },
    {
        name: "Redline",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#110507",
            panel: "#230A0E",
            panelAlt: "#340E15",
            navigation: "#EF4444",
            navigationText: "#FEE2E2",
            navigationSurface: "#4D1519",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#FFF1F2",
            muted: "#C8A1A8",
            border: "#5D2932",
            danger: "#FACC15"
        }
    },
    {
        name: "Night Vision",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#020806",
            panel: "#07140E",
            panelAlt: "#0D2217",
            navigation: "#16A34A",
            navigationText: "#DCFCE7",
            navigationSurface: "#0F3D21",
            selected: "#86EFAC",
            selectedSurface: "#154A2B",
            selectedText: "#F0FDF4",
            text: "#DCFCE7",
            muted: "#7EA18B",
            border: "#254C34",
            danger: "#F87171"
        }
    },
    {
        name: "Ultraviolet",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#09040E",
            panel: "#160B20",
            panelAlt: "#241032",
            navigation: "#7C3AED",
            navigationText: "#EDE9FE",
            navigationSurface: "#35165A",
            selected: "#F472B6",
            selectedSurface: "#471632",
            selectedText: "#FDF2F8",
            text: "#FAF5FF",
            muted: "#B49DC5",
            border: "#4D2C63",
            danger: "#FB7185"
        }
    },
    {
        name: "Candy Apple",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#120507",
            panel: "#240A0C",
            panelAlt: "#371014",
            navigation: "#DC2626",
            navigationText: "#FEE2E2",
            navigationSurface: "#4E1215",
            selected: "#F472B6",
            selectedSurface: "#4B1836",
            selectedText: "#FDF2F8",
            text: "#FFF1F2",
            muted: "#C9A1A7",
            border: "#632B32",
            danger: "#FACC15"
        }
    },
    {
        name: "Desert Sand",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#19140D",
            panel: "#2A2319",
            panelAlt: "#3B3224",
            navigation: "#D6A85F",
            navigationText: "#FFF7ED",
            navigationSurface: "#5A4527",
            selected: "#60A5FA",
            selectedSurface: "#183454",
            selectedText: "#EFF6FF",
            text: "#FFF7ED",
            muted: "#C8BDAA",
            border: "#655944",
            danger: "#EF4444"
        }
    },
    {
        name: "Forest",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#061008",
            panel: "#0D1C11",
            panelAlt: "#142A1A",
            navigation: "#22C55E",
            navigationText: "#DCFCE7",
            navigationSurface: "#0E4022",
            selected: "#F59E0B",
            selectedSurface: "#463006",
            selectedText: "#FFFBEB",
            text: "#F0FDF4",
            muted: "#9DB3A2",
            border: "#31503A",
            danger: "#FB7185"
        }
    },
    {
        name: "Deep Space",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#03050B",
            panel: "#090D19",
            panelAlt: "#10162A",
            navigation: "#6366F1",
            navigationText: "#E0E7FF",
            navigationSurface: "#24265C",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#EEF2FF",
            muted: "#979FB8",
            border: "#2B3250",
            danger: "#FB7185"
        }
    },
    {
        name: "Aurora",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#071014",
            panel: "#0E1E23",
            panelAlt: "#153038",
            navigation: "#14B8A6",
            navigationText: "#CCFBF1",
            navigationSurface: "#12423C",
            selected: "#A78BFA",
            selectedSurface: "#30254E",
            selectedText: "#F5F3FF",
            text: "#F0FDFA",
            muted: "#9CB6B8",
            border: "#31525A",
            danger: "#FB7185"
        }
    },
    {
        name: "Plasma",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#100615",
            panel: "#210D2A",
            panelAlt: "#321440",
            navigation: "#E879F9",
            navigationText: "#FAE8FF",
            navigationSurface: "#4A175E",
            selected: "#FB923C",
            selectedSurface: "#4A250E",
            selectedText: "#FFF7ED",
            text: "#FDF4FF",
            muted: "#C0A3C9",
            border: "#5A326A",
            danger: "#F87171"
        }
    },
    {
        name: "Terminal Amber",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#080603",
            panel: "#151006",
            panelAlt: "#241A08",
            navigation: "#F59E0B",
            navigationText: "#FEF3C7",
            navigationSurface: "#432E06",
            selected: "#FDBA74",
            selectedSurface: "#4A260D",
            selectedText: "#FFF7ED",
            text: "#FEF3C7",
            muted: "#BFA36E",
            border: "#4D3A18",
            danger: "#EF4444"
        }
    },
    {
        name: "Terminal Green",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#020805",
            panel: "#07150B",
            panelAlt: "#0C2412",
            navigation: "#22C55E",
            navigationText: "#DCFCE7",
            navigationSurface: "#0D3D20",
            selected: "#86EFAC",
            selectedSurface: "#134B29",
            selectedText: "#F0FDF4",
            text: "#DCFCE7",
            muted: "#84AA91",
            border: "#245238",
            danger: "#F87171"
        }
    },
    {
        name: "Studio Dark",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#0B0B0D",
            panel: "#171719",
            panelAlt: "#232326",
            navigation: "#A3A3A3",
            navigationText: "#F5F5F5",
            navigationSurface: "#333338",
            selected: "#60A5FA",
            selectedSurface: "#172A46",
            selectedText: "#EFF6FF",
            text: "#FAFAFA",
            muted: "#A8A8AE",
            border: "#414147",
            danger: "#F87171"
        }
    },
    {
        name: "Studio Warm",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#120F0C",
            panel: "#211B17",
            panelAlt: "#302821",
            navigation: "#C08457",
            navigationText: "#FFF7ED",
            navigationSurface: "#4B3425",
            selected: "#60A5FA",
            selectedSurface: "#193553",
            selectedText: "#EFF6FF",
            text: "#FFF7ED",
            muted: "#BFAE9F",
            border: "#55483C",
            danger: "#FB7185"
        }
    },
    {
        name: "Stage White",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#D9DBDE",
            panel: "#F8FAFC",
            panelAlt: "#C8CDD2",
            navigation: "#6D28D9",
            navigationText: "#F5F3FF",
            navigationSurface: "#DDD6FE",
            selected: "#0891B2",
            selectedSurface: "#CFFAFE",
            selectedText: "#164E63",
            text: "#111827",
            muted: "#475569",
            border: "#94A3B8",
            danger: "#B91C1C"
        }
    },
    {
        name: "Creamsicle",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#FFF0DD",
            panel: "#FFF8ED",
            panelAlt: "#EFD7BD",
            navigation: "#EA580C",
            navigationText: "#FFF7ED",
            navigationSurface: "#FED7AA",
            selected: "#0891B2",
            selectedSurface: "#CFFAFE",
            selectedText: "#164E63",
            text: "#3A2416",
            muted: "#765B47",
            border: "#C7A98B",
            danger: "#B91C1C"
        }
    },
    {
        name: "Pastel Night",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#11101A",
            panel: "#1E1B2B",
            panelAlt: "#2A2639",
            navigation: "#C4B5FD",
            navigationText: "#F5F3FF",
            navigationSurface: "#3E365A",
            selected: "#F9A8D4",
            selectedSurface: "#4A1E38",
            selectedText: "#FDF2F8",
            text: "#FAF5FF",
            muted: "#BCB4C9",
            border: "#4A435B",
            danger: "#FB7185"
        }
    },
    {
        name: "Nordic",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#0A1014",
            panel: "#121C22",
            panelAlt: "#1B2931",
            navigation: "#88C0D0",
            navigationText: "#E5E9F0",
            navigationSurface: "#27434D",
            selected: "#A3BE8C",
            selectedSurface: "#33422B",
            selectedText: "#F0FDF4",
            text: "#ECEFF4",
            muted: "#AAB7C0",
            border: "#3B4C55",
            danger: "#BF616A"
        }
    },
    {
        name: "Dracula",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#0B0A11",
            panel: "#171522",
            panelAlt: "#242033",
            navigation: "#BD93F9",
            navigationText: "#F8F8F2",
            navigationSurface: "#3D285F",
            selected: "#8BE9FD",
            selectedSurface: "#164A55",
            selectedText: "#F8F8F2",
            text: "#F8F8F2",
            muted: "#AFA9BD",
            border: "#4B425F",
            danger: "#FF5555"
        }
    },
    {
        name: "Solarized Dark",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#002B36",
            panel: "#073642",
            panelAlt: "#0D4652",
            navigation: "#B58900",
            navigationText: "#FDF6E3",
            navigationSurface: "#4B3C08",
            selected: "#2AA198",
            selectedSurface: "#0B4B49",
            selectedText: "#E0F7F4",
            text: "#EEE8D5",
            muted: "#93A1A1",
            border: "#586E75",
            danger: "#DC322F"
        }
    },
    {
        name: "Solarized Light",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#FDF6E3",
            panel: "#EEE8D5",
            panelAlt: "#E4DCC8",
            navigation: "#6C71C4",
            navigationText: "#FDF6E3",
            navigationSurface: "#D8D3ED",
            selected: "#2AA198",
            selectedSurface: "#C8EEE9",
            selectedText: "#073642",
            text: "#073642",
            muted: "#657B83",
            border: "#93A1A1",
            danger: "#DC322F"
        }
    },
    {
        name: "Rose Gold",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#140D0F",
            panel: "#24181C",
            panelAlt: "#342328",
            navigation: "#E8A0A8",
            navigationText: "#FFF1F2",
            navigationSurface: "#53363C",
            selected: "#FBBF24",
            selectedSurface: "#4A3A06",
            selectedText: "#FFFBEB",
            text: "#FFF1F2",
            muted: "#C7A8AD",
            border: "#60444A",
            danger: "#F87171"
        }
    },
    {
        name: "Champagne",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#17130B",
            panel: "#272116",
            panelAlt: "#39301F",
            navigation: "#D6B875",
            navigationText: "#FFF7ED",
            navigationSurface: "#5A4728",
            selected: "#A78BFA",
            selectedSurface: "#31284E",
            selectedText: "#F5F3FF",
            text: "#FFF7ED",
            muted: "#C7B99D",
            border: "#65583A",
            danger: "#EF4444"
        }
    },
    {
        name: "Frosted Mint",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#E9F8F3",
            panel: "#FFFFFF",
            panelAlt: "#D9EEE7",
            navigation: "#0F766E",
            navigationText: "#F0FDFA",
            navigationSurface: "#A7F3D0",
            selected: "#2563EB",
            selectedSurface: "#DBEAFE",
            selectedText: "#1E3A8A",
            text: "#102A26",
            muted: "#4B6861",
            border: "#9FC1B7",
            danger: "#B91C1C"
        }
    },
    {
        name: "Cloud",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#E8EDF3",
            panel: "#FFFFFF",
            panelAlt: "#D9E1EA",
            navigation: "#475569",
            navigationText: "#F8FAFC",
            navigationSurface: "#CBD5E1",
            selected: "#0284C7",
            selectedSurface: "#E0F2FE",
            selectedText: "#0C4A6E",
            text: "#0F172A",
            muted: "#52606D",
            border: "#A8B4C1",
            danger: "#B91C1C"
        }
    },

    {
        name: "Ocean Glass",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#123B4A",
            panel: "#1B5668",
            panelAlt: "#246C7D",
            navigation: "#F0A85B",
            navigationText: "#5A3016",
            navigationSurface: "#D98546",
            selected: "#8BE0D0",
            selectedSurface: "#287A73",
            selectedText: "#173E3A",
            text: "#D7F4E8",
            muted: "#A8D7CF",
            border: "#63B6C7",
            danger: "#F08A78"
        }
    },
    {
        name: "Burgundy Velvet",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#4A1828",
            panel: "#6B2439",
            panelAlt: "#84334B",
            navigation: "#E7A65A",
            navigationText: "#5A2C12",
            navigationSurface: "#C77A3E",
            selected: "#8FD3C8",
            selectedSurface: "#2E726C",
            selectedText: "#173C38",
            text: "#F3C6B8",
            muted: "#D39A94",
            border: "#C96A7D",
            danger: "#F09A7E"
        }
    },
    {
        name: "Moss & Brass",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#32462C",
            panel: "#465E3A",
            panelAlt: "#587147",
            navigation: "#D6B35E",
            navigationText: "#4A3816",
            navigationSurface: "#B18E42",
            selected: "#7FC6B0",
            selectedSurface: "#326E5C",
            selectedText: "#173A31",
            text: "#F0D9A3",
            muted: "#C8BC8C",
            border: "#B89B55",
            danger: "#D9796E"
        }
    },
    {
        name: "Cobalt Copper",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#173D73",
            panel: "#24558E",
            panelAlt: "#2F68A3",
            navigation: "#D98A52",
            navigationText: "#5B2F17",
            navigationSurface: "#B96D3A",
            selected: "#83D3C5",
            selectedSurface: "#27756D",
            selectedText: "#173C38",
            text: "#F0C7A1",
            muted: "#C6B39D",
            border: "#C97B43",
            danger: "#E57973"
        }
    },
    {
        name: "Aubergine Sage",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#432854",
            panel: "#5B396C",
            panelAlt: "#704A80",
            navigation: "#B9C77B",
            navigationText: "#344022",
            navigationSurface: "#8FA159",
            selected: "#8CCFC2",
            selectedSurface: "#34766E",
            selectedText: "#193E39",
            text: "#CFE3C1",
            muted: "#AEC09F",
            border: "#8AAE79",
            danger: "#E27C83"
        }
    },
    {
        name: "Terracotta Sky",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#7A3E2F",
            panel: "#96513F",
            panelAlt: "#AE6650",
            navigation: "#79B4D2",
            navigationText: "#24495C",
            navigationSurface: "#5D98B6",
            selected: "#E7C66D",
            selectedSurface: "#9B7C2E",
            selectedText: "#4B3B13",
            text: "#CBE4F0",
            muted: "#ACCAD6",
            border: "#72A7C2",
            danger: "#E57373"
        }
    },
    {
        name: "Peacock Gold",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#075B63",
            panel: "#0B747B",
            panelAlt: "#118B8F",
            navigation: "#E1B74D",
            navigationText: "#513D11",
            navigationSurface: "#BE9335",
            selected: "#D989B6",
            selectedSurface: "#8C3E67",
            selectedText: "#4A2036",
            text: "#F0D27A",
            muted: "#C8B968",
            border: "#D1A83F",
            danger: "#E97A70"
        }
    },
    {
        name: "Denim Rose",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#334E68",
            panel: "#456783",
            panelAlt: "#587C98",
            navigation: "#D58CA5",
            navigationText: "#5B2D3C",
            navigationSurface: "#B86F88",
            selected: "#E8C56D",
            selectedSurface: "#9B7C2E",
            selectedText: "#493A13",
            text: "#E9C3CF",
            muted: "#C8A8B3",
            border: "#B37B91",
            danger: "#E27474"
        }
    },
    {
        name: "Plum & Apricot",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#59305E",
            panel: "#744078",
            panelAlt: "#8B518D",
            navigation: "#E9A66F",
            navigationText: "#60341D",
            navigationSurface: "#C78354",
            selected: "#8FD0C0",
            selectedSurface: "#377669",
            selectedText: "#193E36",
            text: "#F1C8A7",
            muted: "#D3AA92",
            border: "#D18D72",
            danger: "#E87B78"
        }
    },
    {
        name: "Lagoon Coral",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#17636A",
            panel: "#237B80",
            panelAlt: "#329297",
            navigation: "#ED8D73",
            navigationText: "#653126",
            navigationSurface: "#CA6953",
            selected: "#E5C45F",
            selectedSurface: "#987C25",
            selectedText: "#493A10",
            text: "#BFE7D5",
            muted: "#9CCDBD",
            border: "#69B7A6",
            danger: "#E66E72"
        }
    },
    {
        name: "Olive Clay",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#59613A",
            panel: "#70794B",
            panelAlt: "#858D5D",
            navigation: "#CF7E5F",
            navigationText: "#572D20",
            navigationSurface: "#AD6248",
            selected: "#78B9C7",
            selectedSurface: "#3B7784",
            selectedText: "#183D45",
            text: "#E6D39B",
            muted: "#C5B783",
            border: "#B59C5E",
            danger: "#D96E68"
        }
    },
    {
        name: "Indigo Mint",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#343A7A",
            panel: "#484F94",
            panelAlt: "#5C63A8",
            navigation: "#84CDB7",
            navigationText: "#285348",
            navigationSurface: "#63AB97",
            selected: "#E4B768",
            selectedSurface: "#9B7130",
            selectedText: "#4A3414",
            text: "#C8E8DA",
            muted: "#A9CBBE",
            border: "#79B7A6",
            danger: "#E77B84"
        }
    },
    {
        name: "Raspberry Cream",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#7B2E52",
            panel: "#984064",
            panelAlt: "#AF5578",
            navigation: "#E2B665",
            navigationText: "#593F16",
            navigationSurface: "#BD9149",
            selected: "#79C4B5",
            selectedSurface: "#36766B",
            selectedText: "#183D36",
            text: "#F0CFB0",
            muted: "#D1AF99",
            border: "#CE8B78",
            danger: "#E46F75"
        }
    },
    {
        name: "Blueberry Sand",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#414A79",
            panel: "#56618E",
            panelAlt: "#6975A2",
            navigation: "#D8A96A",
            navigationText: "#563D1D",
            navigationSurface: "#B8894F",
            selected: "#81C7B1",
            selectedSurface: "#3C7867",
            selectedText: "#193E35",
            text: "#E7D1AD",
            muted: "#C8B899",
            border: "#B99A6C",
            danger: "#E0787A"
        }
    },
    {
        name: "Sage Berry",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#496452",
            panel: "#5F7B65",
            panelAlt: "#739078",
            navigation: "#C77B9B",
            navigationText: "#542C3D",
            navigationSurface: "#A75D7A",
            selected: "#DDB65C",
            selectedSurface: "#957729",
            selectedText: "#473911",
            text: "#D9D3A8",
            muted: "#BEB993",
            border: "#9FAB72",
            danger: "#DC7470"
        }
    },
    {
        name: "Violet Copper",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#533B71",
            panel: "#6B4F88",
            panelAlt: "#80639D",
            navigation: "#D98B57",
            navigationText: "#5B3019",
            navigationSurface: "#B96B3D",
            selected: "#78C8BA",
            selectedSurface: "#34766B",
            selectedText: "#193D37",
            text: "#E7C3A3",
            muted: "#C7A98F",
            border: "#C47F5D",
            danger: "#E4777B"
        }
    },
    {
        name: "Petrol Amber",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#264D57",
            panel: "#34646E",
            panelAlt: "#447B84",
            navigation: "#DDA44B",
            navigationText: "#533B12",
            navigationSurface: "#B98234",
            selected: "#D585A5",
            selectedSurface: "#8A4260",
            selectedText: "#482131",
            text: "#E5C879",
            muted: "#C5AF68",
            border: "#B18F4E",
            danger: "#DE7771"
        }
    },
    {
        name: "Rust & Jade",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#6D3F30",
            panel: "#875442",
            panelAlt: "#9E6955",
            navigation: "#66B7A1",
            navigationText: "#244C42",
            navigationSurface: "#4C967F",
            selected: "#E0B95E",
            selectedSurface: "#92762B",
            selectedText: "#463810",
            text: "#CDE2B1",
            muted: "#AFBF98",
            border: "#8FB37D",
            danger: "#DD716D"
        }
    },

    {
        name: "Turquoise Sand",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#2D6F73",
            panel: "#3A8588",
            panelAlt: "#4A9B9D",
            navigation: "#E7C978",
            navigationText: "#5B4A18",
            navigationSurface: "#C6A956",
            selected: "#D77FA7",
            selectedSurface: "#8A4868",
            selectedText: "#452333",
            text: "#F0D9A8",
            muted: "#C8BE92",
            border: "#D0B15E",
            danger: "#E27072"
        }
    },
    {
        name: "Cherry Mint",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#773447",
            panel: "#91465B",
            panelAlt: "#A95B70",
            navigation: "#77C8AE",
            navigationText: "#245143",
            navigationSurface: "#56A990",
            selected: "#E8B95E",
            selectedSurface: "#98762A",
            selectedText: "#4A3910",
            text: "#CDE8D6",
            muted: "#AED0BC",
            border: "#8DBDA0",
            danger: "#E17474"
        }
    },
    {
        name: "Cyan Plum",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#245B69",
            panel: "#317384",
            panelAlt: "#408B9C",
            navigation: "#B88AD0",
            navigationText: "#492957",
            navigationSurface: "#986AB1",
            selected: "#E9C765",
            selectedSurface: "#9A7B2B",
            selectedText: "#4B3B10",
            text: "#D7C4E4",
            muted: "#B7A8C4",
            border: "#9D78B4",
            danger: "#E57D7D"
        }
    },
    {
        name: "Amber Teal",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#6D5426",
            panel: "#846A35",
            panelAlt: "#9C8145",
            navigation: "#5DB7AF",
            navigationText: "#234E49",
            navigationSurface: "#45968F",
            selected: "#D986B8",
            selectedSurface: "#8A4769",
            selectedText: "#482435",
            text: "#D6E5C5",
            muted: "#B7C3A7",
            border: "#89A47A",
            danger: "#E7786B"
        }
    },
    {
        name: "Magenta Brass",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#70315F",
            panel: "#8A4275",
            panelAlt: "#A1558A",
            navigation: "#D6B055",
            navigationText: "#533F13",
            navigationSurface: "#B58F3D",
            selected: "#72C2B0",
            selectedSurface: "#357468",
            selectedText: "#173D36",
            text: "#E9CC98",
            muted: "#C6B18A",
            border: "#C49A50",
            danger: "#E47078"
        }
    },
    {
        name: "Sky Clay",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#466D8A",
            panel: "#5A83A0",
            panelAlt: "#6E99B4",
            navigation: "#C97D61",
            navigationText: "#522E23",
            navigationSurface: "#AA624A",
            selected: "#E2BD63",
            selectedSurface: "#93752B",
            selectedText: "#47380F",
            text: "#F0D0B8",
            muted: "#CBB29F",
            border: "#B98973",
            danger: "#E27670"
        }
    },
    {
        name: "Jade Violet",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#3F6D5C",
            panel: "#527F6D",
            panelAlt: "#67937F",
            navigation: "#AA87C9",
            navigationText: "#432954",
            navigationSurface: "#8D6AAC",
            selected: "#E4BC62",
            selectedSurface: "#96752A",
            selectedText: "#48380F",
            text: "#DCCFE8",
            muted: "#BCB0C7",
            border: "#9D81B0",
            danger: "#E27C7C"
        }
    },
    {
        name: "Rose Teal",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#7B4658",
            panel: "#925A6C",
            panelAlt: "#AA6E80",
            navigation: "#6FC0B2",
            navigationText: "#255046",
            navigationSurface: "#53A292",
            selected: "#E7BE66",
            selectedSurface: "#97762C",
            selectedText: "#493910",
            text: "#D9E5D1",
            muted: "#B9C7B2",
            border: "#90B99E",
            danger: "#E47476"
        }
    },
    {
        name: "Azure Gold",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#305E9B",
            panel: "#4175B2",
            panelAlt: "#558BC8",
            navigation: "#E0B34F",
            navigationText: "#523E10",
            navigationSurface: "#BD9138",
            selected: "#C982B2",
            selectedSurface: "#814663",
            selectedText: "#432333",
            text: "#E8D79C",
            muted: "#C5B989",
            border: "#C8A04B",
            danger: "#E57679"
        }
    },
    {
        name: "Forest Rose",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#3C6647",
            panel: "#4E7A5A",
            panelAlt: "#628F6E",
            navigation: "#D2849C",
            navigationText: "#562E3C",
            navigationSurface: "#B1647C",
            selected: "#E6BF63",
            selectedSurface: "#96772B",
            selectedText: "#493910",
            text: "#E6D8A9",
            muted: "#C1B78F",
            border: "#A39D67",
            danger: "#E27471"
        }
    },
    {
        name: "Coral Navy",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#294E73",
            panel: "#386186",
            panelAlt: "#4B769B",
            navigation: "#E18A72",
            navigationText: "#5D3025",
            navigationSurface: "#BE6852",
            selected: "#E4C160",
            selectedSurface: "#96772A",
            selectedText: "#49390F",
            text: "#F0D1C1",
            muted: "#C9B3A8",
            border: "#B98B78",
            danger: "#E67470"
        }
    },
    {
        name: "Mint Bronze",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#4A756B",
            panel: "#5D897E",
            panelAlt: "#719D91",
            navigation: "#C68B5B",
            navigationText: "#4F301D",
            navigationSurface: "#A66C42",
            selected: "#D48FB0",
            selectedSurface: "#844B67",
            selectedText: "#432535",
            text: "#E8D3B0",
            muted: "#C5B69A",
            border: "#B68B69",
            danger: "#E07873"
        }
    },
    {
        name: "Purple Moss",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#5B476A",
            panel: "#6F5A7F",
            panelAlt: "#846E94",
            navigation: "#8EAA67",
            navigationText: "#35421F",
            navigationSurface: "#718C4D",
            selected: "#E0B55E",
            selectedSurface: "#93722A",
            selectedText: "#47370F",
            text: "#D9E1B3",
            muted: "#B9C09A",
            border: "#9DAA72",
            danger: "#E47A78"
        }
    },
    {
        name: "Burnt Orange Blue",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#8A4F2F",
            panel: "#A2633F",
            panelAlt: "#B97A52",
            navigation: "#70A7D0",
            navigationText: "#25475F",
            navigationSurface: "#5788AE",
            selected: "#7BC5B4",
            selectedSurface: "#397568",
            selectedText: "#193D36",
            text: "#D5E2EE",
            muted: "#B6C5D1",
            border: "#8FAFC4",
            danger: "#E46E6E"
        }
    },
    {
        name: "Royal Mint",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#4C4F8D",
            panel: "#6165A2",
            panelAlt: "#777AB7",
            navigation: "#83C8B0",
            navigationText: "#2B5046",
            navigationSurface: "#65A990",
            selected: "#E0B964",
            selectedSurface: "#94752C",
            selectedText: "#483910",
            text: "#D7E8DF",
            muted: "#B7C8C0",
            border: "#8FB5A3",
            danger: "#E47A80"
        }
    },
    {
        name: "Cinnamon Sea",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#76513C",
            panel: "#8D6650",
            panelAlt: "#A37B64",
            navigation: "#64B8B6",
            navigationText: "#224B4A",
            navigationSurface: "#499898",
            selected: "#D7A8C9",
            selectedSurface: "#844D76",
            selectedText: "#43263A",
            text: "#CFE5DC",
            muted: "#B0C6BD",
            border: "#87B5A9",
            danger: "#E2756F"
        }
    },
    {
        name: "Teal Lavender",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#3E6F78",
            panel: "#50848D",
            panelAlt: "#6399A2",
            navigation: "#B79AD6",
            navigationText: "#452D55",
            navigationSurface: "#977AB7",
            selected: "#E4BC62",
            selectedSurface: "#94752B",
            selectedText: "#48390F",
            text: "#DDD0E9",
            muted: "#BFB2CB",
            border: "#A68DBB",
            danger: "#E57D80"
        }
    },
    {
        name: "Brick Aqua",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#7D443E",
            panel: "#965851",
            panelAlt: "#AD6D66",
            navigation: "#65BFC0",
            navigationText: "#214D4D",
            navigationSurface: "#499FA1",
            selected: "#E6BE63",
            selectedSurface: "#96772B",
            selectedText: "#49390F",
            text: "#CFE7E1",
            muted: "#B0C7C1",
            border: "#88B8B2",
            danger: "#E3746D"
        }
    },
    {
        name: "Mustard Plum",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#77662D",
            panel: "#8F7D3D",
            panelAlt: "#A59550",
            navigation: "#A06FAF",
            navigationText: "#3F2847",
            navigationSurface: "#815690",
            selected: "#69BFB2",
            selectedSurface: "#34756A",
            selectedText: "#183D37",
            text: "#DDCFDF",
            muted: "#BEB0C0",
            border: "#9E85A6",
            danger: "#E77D71"
        }
    },
    {
        name: "Orchid Sea",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#5F4B7B",
            panel: "#745F91",
            panelAlt: "#8A74A6",
            navigation: "#61B5B2",
            navigationText: "#224A49",
            navigationSurface: "#489592",
            selected: "#E3B85D",
            selectedSurface: "#947329",
            selectedText: "#47370F",
            text: "#CFE4E2",
            muted: "#B0C5C3",
            border: "#86B0AE",
            danger: "#E37A80"
        }
    },
    {
        name: "Lime Denim",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#4E6682",
            panel: "#617A96",
            panelAlt: "#758FAA",
            navigation: "#A9C65A",
            navigationText: "#3A4518",
            navigationSurface: "#899F40",
            selected: "#D887AF",
            selectedSurface: "#864962",
            selectedText: "#452433",
            text: "#DDE8C0",
            muted: "#BBC89E",
            border: "#A3B572",
            danger: "#E37A76"
        }
    },
    {
        name: "Peach Teal",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#A7654F",
            panel: "#BC7A64",
            panelAlt: "#D09079",
            navigation: "#5BAEA6",
            navigationText: "#214743",
            navigationSurface: "#438E87",
            selected: "#D29BC3",
            selectedSurface: "#804C73",
            selectedText: "#41263A",
            text: "#DCE8D5",
            muted: "#BCC9B5",
            border: "#8CB8A6",
            danger: "#E36F6C"
        }
    },
    {
        name: "Blue Rose Gold",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#3B5B87",
            panel: "#4E6F9C",
            panelAlt: "#6384B1",
            navigation: "#D69A83",
            navigationText: "#563529",
            navigationSurface: "#B77B66",
            selected: "#DDB95F",
            selectedSurface: "#91732A",
            selectedText: "#46370F",
            text: "#ECD0C5",
            muted: "#C8B2AA",
            border: "#B89080",
            danger: "#E77776"
        }
    },
    {
        name: "Fern Coral",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#53704A",
            panel: "#67845D",
            panelAlt: "#7C9872",
            navigation: "#DA806C",
            navigationText: "#562E25",
            navigationSurface: "#B96250",
            selected: "#72BAB4",
            selectedSurface: "#36726F",
            selectedText: "#193B39",
            text: "#E7D9B3",
            muted: "#C3B994",
            border: "#A2A773",
            danger: "#E3746E"
        }
    },
    {
        name: "Graphite Gold",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#4A4F57",
            panel: "#5C626B",
            panelAlt: "#6F7680",
            navigation: "#D3A94F",
            navigationText: "#514012",
            navigationSurface: "#B08838",
            selected: "#78BFC3",
            selectedSurface: "#3A7377",
            selectedText: "#1B3A3C",
            text: "#E4D39B",
            muted: "#C3B78A",
            border: "#AE985C",
            danger: "#E37875"
        }
    },
    {
        name: "Berry Aqua",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#6C3E68",
            panel: "#82517E",
            panelAlt: "#996594",
            navigation: "#63BDBA",
            navigationText: "#214C4B",
            navigationSurface: "#499D9A",
            selected: "#E4B962",
            selectedSurface: "#95742A",
            selectedText: "#48380F",
            text: "#D0E5E2",
            muted: "#B1C6C3",
            border: "#88B5B2",
            danger: "#E47A7B"
        }
    },
    {
        name: "Olive Orchid",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#66643A",
            panel: "#7A784D",
            panelAlt: "#8F8D61",
            navigation: "#B080C3",
            navigationText: "#44294F",
            navigationSurface: "#9165A4",
            selected: "#68B9B3",
            selectedSurface: "#36716C",
            selectedText: "#193A37",
            text: "#DDD1E3",
            muted: "#BDB0C2",
            border: "#9C89A7",
            danger: "#E57B73"
        }
    },
    {
        name: "Aqua Bronze",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#43777B",
            panel: "#568C8F",
            panelAlt: "#6AA1A4",
            navigation: "#C78B5A",
            navigationText: "#4F301C",
            navigationSurface: "#A66D42",
            selected: "#D891B7",
            selectedSurface: "#854C6A",
            selectedText: "#432536",
            text: "#E7D2AF",
            muted: "#C4B599",
            border: "#B48B6A",
            danger: "#E17774"
        }
    },
    {
        name: "Sunflower Blue",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#5B6F91",
            panel: "#6F82A4",
            panelAlt: "#8497B8",
            navigation: "#DDB74F",
            navigationText: "#51410F",
            navigationSurface: "#BB9638",
            selected: "#D184A8",
            selectedSurface: "#81475F",
            selectedText: "#422330",
            text: "#E8D99F",
            muted: "#C5BA8B",
            border: "#C2A151",
            danger: "#E57B79"
        }
    },
    {
        name: "Paprika Mint",
        author: "Pi-MFX",
        version: 1,
        colors: {
            background: "#914C3D",
            panel: "#A96050",
            panelAlt: "#C17665",
            navigation: "#6CBCA9",
            navigationText: "#254C43",
            navigationSurface: "#509D8B",
            selected: "#D19ABD",
            selectedSurface: "#7E4C70",
            selectedText: "#402639",
            text: "#D9E7D7",
            muted: "#B9C8B8",
            border: "#8CB8A0",
            danger: "#E36D6A"
        }
    },
];

function solid(color: string): MultiFXThemePaint {
    return { kind: "solid", colors: [color], angle: 0 };
}

function gradient(
    first: string,
    second: string,
    angle = 135,
    third?: string
): MultiFXThemePaint {
    return {
        kind: "linear",
        colors: third ? [first, second, third] : [first, second],
        angle
    };
}

function radial(
    first: string,
    second: string,
    third?: string
): MultiFXThemePaint {
    return {
        kind: "radial",
        colors: third ? [first, second, third] : [first, second],
        angle: 0
    };
}

function conic(
    first: string,
    second: string,
    third?: string,
    angle = 0
): MultiFXThemePaint {
    return {
        kind: "conic",
        colors: third ? [first, second, third] : [first, second],
        angle
    };
}

function surface(
    background: MultiFXThemePaint,
    border: MultiFXThemePaint,
    text: string,
    label: string,
    accent: string,
    shadow: string
): MultiFXThemeSurface {
    return { background, border, text, label, accent, shadow };
}

function controlState(
    background: MultiFXThemePaint,
    border: MultiFXThemePaint,
    label: string,
    value: string,
    indicator: string,
    shadow = "none"
): MultiFXThemeControlState {
    return { background, border, label, value, indicator, shadow };
}

type BuiltInThemeProfile =
    | "modern"
    | "stompbox"
    | "glass"
    | "arcade"
    | "studio"
    | "minimal";

const STOMPBOX_THEME_NAMES = new Set([
    "Boutique Blue", "British Stack", "Brownface", "Copper", "Goldtop",
    "Orange Crush", "Royal Gold", "Silverface", "Surf Green", "Tube Glow",
    "Vintage Cream"
]);

const STUDIO_THEME_NAMES = new Set([
    "Blue Steel", "Graphite", "Gunmetal", "Slate Purple", "Studio Dark",
    "Studio Warm"
]);

const TERMINAL_THEME_NAMES = new Set([
    "Blackout", "High Contrast", "Night Vision", "Terminal Amber",
    "Terminal Green"
]);

function stableNameBucket(name: string): number {
    let hash = 0;
    for (const character of name) {
        hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
    }
    return hash;
}

function paletteLuminance(color: string): number {
    const values = [1, 3, 5].map((start) =>
        Number.parseInt(color.slice(start, start + 2), 16) / 255
    );
    const [r, g, b] = values.map((value) =>
        value <= 0.04045
            ? value / 12.92
            : Math.pow((value + 0.055) / 1.055, 2.4)
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function paletteContrastRatio(foreground: string, background: string): number {
    const light = Math.max(
        paletteLuminance(foreground),
        paletteLuminance(background)
    );
    const dark = Math.min(
        paletteLuminance(foreground),
        paletteLuminance(background)
    );
    return (light + 0.05) / (dark + 0.05);
}

/** Preserve a palette's intended foreground when it is readable, otherwise
 * choose its normal text, black or white—whichever has the best contrast. */
function readablePaletteText(
    foreground: string,
    background: string,
    normalText: string
): string {
    if (paletteContrastRatio(foreground, background) >= 4.5) {
        return foreground;
    }
    return [normalText, "#000000", "#FFFFFF"].reduce((best, candidate) =>
        paletteContrastRatio(candidate, background)
            > paletteContrastRatio(best, background)
            ? candidate
            : best
    );
}

/**
 * Assign every built-in palette to a coordinated visual family. Named amp,
 * studio and terminal themes stay deliberately grouped; the remaining large
 * color catalog is distributed deterministically so it contains real surface,
 * tile, indicator and analog-style combinations instead of palette swaps.
 */
function getBuiltInThemeProfile(
    palette: MultiFXThemePaletteDefinition
): BuiltInThemeProfile {
    if (STOMPBOX_THEME_NAMES.has(palette.name)) return "stompbox";
    if (STUDIO_THEME_NAMES.has(palette.name)) return "studio";
    if (TERMINAL_THEME_NAMES.has(palette.name)) return "minimal";
    if (paletteLuminance(palette.colors.background) >= 0.55) return "glass";

    const rotatingProfiles: BuiltInThemeProfile[] = [
        "modern", "stompbox", "glass", "arcade", "studio"
    ];
    return rotatingProfiles[
        stableNameBucket(palette.name) % rotatingProfiles.length
    ];
}

/** User-facing grouping used by the Theme Manager's style browser. */
export function getMultiFXThemeStyleLabel(
    theme: MultiFXThemeDefinition
): string {
    switch (theme.appearance.controls.switchStyle) {
        case "footswitch": return "METAL STOMPBOX";
        case "glass": return "GLASS PANELS";
        case "arcade": return "ARCADE BUTTONS";
        case "minimal": return "MINIMAL";
        case "tiles":
        default:
            return theme.appearance.controls.indicatorAnimation === "none"
                ? "STUDIO TILES"
                : "MODERN TILES";
    }
}

const fontStyle = (
    family: MultiFXFontFamilyId,
    sizePercent = 100
): MultiFXThemeTextStyle => ({ family, sizePercent });

/**
 * Give every built-in visual family an intentional typography pairing.
 * Digital faces are reserved for values so ordinary words remain readable.
 */
function makeThemeFonts(profile: BuiltInThemeProfile): MultiFXThemeFonts {
    const fonts: MultiFXThemeFonts = {
        interface: fontStyle("roboto"),
        heading: fontStyle("inter", 100),
        label: fontStyle("roboto", 100),
        value: fontStyle("roboto", 100),
        switchLabel: fontStyle("roboto", 100),
        switchValue: fontStyle("questrial", 100),
        controlLabel: fontStyle("roboto", 115),
        controlFunction: fontStyle("questrial", 120),
        controlValue: fontStyle("roboto", 120),
        feedback: fontStyle("roboto", 115),
        controlPopupSizePercent: 145
    };

    switch (profile) {
        case "stompbox":
            fonts.heading.family = "cooper-hewitt";
            fonts.switchLabel.family = "cooper-hewitt";
            fonts.switchValue.family = "cooper-hewitt";
            break;
        case "glass":
            fonts.interface.family = "questrial";
            fonts.heading.family = "comfortaa";
            fonts.switchLabel.family = "comfortaa";
            fonts.switchValue.family = "questrial";
            fonts.controlFunction.family = "questrial";
            break;
        case "arcade":
            fonts.heading.family = "montserrat";
            fonts.switchLabel.family = "comfortaa";
            fonts.switchValue.family = "montserrat";
            fonts.controlLabel.family = "comfortaa";
            break;
        case "studio":
            fonts.interface.family = "cooper-hewitt";
            fonts.heading.family = "cooper-hewitt";
            fonts.label.family = "cooper-hewitt";
            fonts.switchLabel.family = "cooper-hewitt";
            fonts.switchValue.family = "roboto";
            break;
        case "minimal":
            fonts.interface.family = "console";
            fonts.heading.family = "orbitron";
            fonts.label.family = "console";
            fonts.value.family = "console";
            fonts.switchLabel.family = "console";
            fonts.switchValue.family = "lcd-14-modern";
            fonts.controlLabel.family = "console";
            fonts.controlFunction.family = "lcd-14-classic";
            fonts.controlValue.family = "lcd-7-modern";
            fonts.feedback.family = "lcd-14-modern";
            fonts.switchValue.sizePercent = 112;
            fonts.controlValue.sizePercent = 135;
            break;
        case "modern":
        default:
            break;
    }
    return fonts;
}

/** Build a complete version-4 visual system from one curated color palette. */
function makeTheme(
    palette: MultiFXThemePaletteDefinition
): MultiFXThemeDefinition {
    const c = structuredClone(palette.colors);
    c.navigationText = readablePaletteText(
        c.navigationText,
        c.navigationSurface,
        c.text
    );
    c.selectedText = readablePaletteText(
        c.selectedText,
        c.selectedSurface,
        c.text
    );
    const profile = getBuiltInThemeProfile(palette);
    let normal = controlState(
        solid(c.panel),
        solid(c.border),
        c.muted,
        c.text,
        c.muted
    );
    let active = controlState(
        gradient(c.selectedSurface, c.panelAlt),
        gradient(c.selected, c.navigation),
        c.selected,
        c.selectedText,
        c.selected,
        `0 0 20px ${c.selected}`
    );
    let navigationNormal = controlState(
        gradient(c.navigationSurface, c.panel),
        solid(c.navigation),
        c.navigation,
        c.text,
        c.navigation
    );
    let utilityNormal = controlState(
        gradient(c.panelAlt, c.panel, 180),
        solid(c.border),
        c.muted,
        c.text,
        c.navigation
    );
    let snapshotNormal = controlState(
        gradient(c.selectedSurface, c.panel, 155),
        solid(c.selected),
        c.selected,
        c.text,
        c.selected
    );
    const dangerState = controlState(
        gradient(c.panelAlt, c.background),
        solid(c.danger),
        c.danger,
        c.text,
        c.danger
    );

    let page = surface(
        gradient(c.background, c.panel, 160),
        solid(c.border), c.text, c.muted, c.selected, "none"
    );
    let header = surface(
        gradient(c.panel, c.panelAlt, 90),
        solid(c.border), c.text, c.muted,
        c.navigation, "0 4px 20px rgba(0,0,0,.48)"
    );
    let panel = surface(
        gradient(c.panel, c.panelAlt),
        solid(c.border), c.text, c.muted, c.selected,
        "0 8px 24px rgba(0,0,0,.26)"
    );
    let popup = surface(
        gradient(c.panelAlt, c.panel),
        gradient(c.navigation, c.selected),
        c.text, c.muted, c.selected, "0 18px 48px rgba(0,0,0,.72)"
    );
    let toast = surface(
        gradient(c.selectedSurface, c.panelAlt),
        solid(c.selected), c.selectedText, c.selected,
        c.selected, "0 10px 30px rgba(0,0,0,.62)"
    );
    let menu = surface(
        gradient(c.panelAlt, c.panel, 90),
        solid(c.navigation), c.text, c.muted,
        c.navigation, "0 12px 34px rgba(0,0,0,.68)"
    );

    const controls: MultiFXThemeAppearance["controls"] = {
        switchStyle: "tiles",
        switchShape: "rounded",
        analogStyle: "modern",
        indicatorStyle: "dot",
        indicatorAnimation: "pulse",
        indicatorInactive: c.muted,
        indicatorActive: c.selected,
        indicatorChanged: c.navigation,
        animationSeconds: 1.4,
        borderWidth: 2,
        cornerRadius: 12,
        glowStrength: 0.65,
        disabledOpacity: 0.48,
        glassBlur: 10,
        glassHighlight: 0.28
    };

    switch (profile) {
        case "stompbox":
            page = surface(
                radial(c.panelAlt, c.background),
                solid(c.border), c.text, c.muted, c.navigation, "none"
            );
            header = surface(
                gradient(c.panelAlt, c.background, 180),
                gradient(c.border, c.navigation), c.text,
                c.muted, c.navigation,
                "0 5px 18px rgba(0,0,0,.58)"
            );
            panel = surface(
                solid(c.panel), gradient(c.border, c.navigation),
                c.text, c.muted, c.navigation,
                "0 9px 20px rgba(0,0,0,.4)"
            );
            normal = controlState(
                gradient(c.panelAlt, c.panel, 180),
                gradient(c.border, c.navigation),
                c.navigationText, c.text, c.navigation
            );
            navigationNormal = controlState(
                radial(c.navigationSurface, c.panel),
                solid(c.navigation), c.navigation, c.text, c.navigation
            );
            snapshotNormal = controlState(
                radial(c.selectedSurface, c.panel),
                solid(c.selected), c.selected, c.text, c.selected
            );
            Object.assign(controls, {
                switchStyle: "footswitch",
                switchShape: "bevel",
                analogStyle: "vintage",
                indicatorStyle: "ring",
                indicatorAnimation: "breathe",
                animationSeconds: 1.8,
                borderWidth: 3,
                cornerRadius: 10,
                glowStrength: 0.72
            });
            break;

        case "glass":
            page = surface(
                radial(c.panelAlt, c.background, c.navigationSurface),
                gradient(c.border, c.navigation), c.text, c.muted,
                c.selected, "none"
            );
            header = surface(
                gradient(c.panelAlt, c.navigationSurface, 105),
                gradient(c.navigation, c.selected), c.text,
                c.muted, c.selected,
                "0 8px 26px rgba(0,0,0,.38)"
            );
            panel = surface(
                gradient(c.panel, c.panelAlt, 145, c.navigationSurface),
                gradient(c.border, c.selected), c.text, c.muted,
                c.selected, "0 10px 30px rgba(0,0,0,.28)"
            );
            popup = surface(
                radial(c.panelAlt, c.panel, c.selectedSurface),
                gradient(c.navigation, c.selected), c.text, c.muted,
                c.selected, "0 22px 58px rgba(0,0,0,.65)"
            );
            active = controlState(
                radial(c.selectedSurface, c.panelAlt),
                gradient(c.selected, c.navigation), c.selected,
                c.selectedText, c.selected, `0 0 24px ${c.selected}`
            );
            Object.assign(controls, {
                switchStyle: "glass",
                switchShape: "rounded",
                analogStyle: "modern",
                indicatorStyle: "halo",
                indicatorAnimation: "breathe",
                animationSeconds: 2.2,
                borderWidth: 1,
                cornerRadius: 20,
                glowStrength: 0.78,
                glassBlur: 14,
                glassHighlight: 0.42
            });
            break;

        case "arcade":
            page = surface(
                radial(c.panel, c.background, c.selectedSurface),
                solid(c.border), c.text, c.muted, c.selected, "none"
            );
            panel = surface(
                conic(c.panel, c.panelAlt, c.navigationSurface, 25),
                gradient(c.navigation, c.selected), c.text, c.muted,
                c.selected, "0 8px 26px rgba(0,0,0,.42)"
            );
            normal = controlState(
                radial(c.navigationSurface, c.panel),
                gradient(c.navigation, c.border),
                c.navigationText, c.text, c.navigation,
                "inset 0 -8px 18px rgba(0,0,0,.28)"
            );
            active = controlState(
                radial(c.selected, c.selectedSurface),
                gradient(c.selectedText, c.selected),
                c.selectedText, c.selectedText, c.selected,
                `0 0 26px ${c.selected}`
            );
            utilityNormal = controlState(
                radial(c.panelAlt, c.panel), solid(c.border),
                c.muted, c.text, c.navigation
            );
            Object.assign(controls, {
                switchStyle: "arcade",
                switchShape: "rounded",
                analogStyle: "neon",
                indicatorStyle: "dot",
                indicatorAnimation: "pulse",
                animationSeconds: 0.9,
                borderWidth: 3,
                cornerRadius: 24,
                glowStrength: 0.9
            });
            break;

        case "studio":
            page = surface(
                solid(c.background), solid(c.border), c.text, c.muted,
                c.selected, "none"
            );
            header = surface(
                gradient(c.panel, c.panelAlt, 180), solid(c.border),
                c.text, c.muted, c.navigation,
                "0 3px 12px rgba(0,0,0,.32)"
            );
            panel = surface(
                solid(c.panel), solid(c.border), c.text, c.muted,
                c.selected, "0 5px 16px rgba(0,0,0,.24)"
            );
            popup = surface(
                solid(c.panelAlt), solid(c.navigation), c.text,
                c.muted, c.selected, "0 16px 40px rgba(0,0,0,.62)"
            );
            toast = surface(
                solid(c.selectedSurface), solid(c.selected),
                c.selectedText, c.selected, c.selected,
                "0 8px 22px rgba(0,0,0,.5)"
            );
            menu = surface(
                solid(c.panelAlt), solid(c.border), c.text, c.muted,
                c.navigation, "0 10px 28px rgba(0,0,0,.52)"
            );
            normal = controlState(
                solid(c.panel), solid(c.border), c.muted, c.text, c.muted
            );
            navigationNormal = controlState(
                solid(c.navigationSurface), solid(c.navigation),
                c.navigation, c.text, c.navigation
            );
            utilityNormal = controlState(
                solid(c.panelAlt), solid(c.border), c.muted, c.text, c.muted
            );
            snapshotNormal = controlState(
                solid(c.selectedSurface), solid(c.selected),
                c.selected, c.selectedText, c.selected
            );
            Object.assign(controls, {
                switchStyle: "tiles",
                switchShape: stableNameBucket(palette.name) % 2
                    ? "square" : "rounded",
                analogStyle: "modern",
                indicatorStyle: "dot",
                indicatorAnimation: "none",
                borderWidth: 1,
                cornerRadius: 6,
                glowStrength: 0.35
            });
            break;

        case "minimal":
            page = surface(
                solid(c.background), solid(c.border), c.text, c.muted,
                c.selected, "none"
            );
            header = surface(
                solid(c.background), solid(c.navigation), c.text,
                c.muted, c.navigation, "none"
            );
            panel = surface(
                solid(c.background), solid(c.border), c.text, c.muted,
                c.selected, "none"
            );
            popup = surface(
                solid(c.panel), solid(c.navigation), c.text, c.muted,
                c.selected, "none"
            );
            toast = surface(
                solid(c.background), solid(c.selected), c.selectedText,
                c.selected, c.selected, "none"
            );
            menu = surface(
                solid(c.background), solid(c.border), c.text, c.muted,
                c.navigation, "none"
            );
            normal = controlState(
                solid(c.background), solid(c.border), c.muted, c.text, c.muted
            );
            active = controlState(
                solid(c.background), solid(c.selected), c.selected,
                c.selectedText, c.selected, "none"
            );
            navigationNormal = controlState(
                solid(c.background), solid(c.navigation), c.navigation,
                c.text, c.navigation
            );
            utilityNormal = structuredClone(normal);
            snapshotNormal = controlState(
                solid(c.background), solid(c.selected), c.selected,
                c.text, c.selected
            );
            Object.assign(controls, {
                switchStyle: "minimal",
                switchShape: "square",
                analogStyle: "minimal",
                indicatorStyle: "bar",
                indicatorAnimation: "chase",
                animationSeconds: 1.6,
                borderWidth: 1,
                cornerRadius: 0,
                glowStrength: 0.25
            });
            break;

        case "modern":
        default:
            break;
    }

    const role = (
        roleNormal: MultiFXThemeControlState,
        roleActive: MultiFXThemeControlState
    ): MultiFXThemeControlRole => ({
        normal: structuredClone(roleNormal),
        active: structuredClone(roleActive)
    });

    return {
        name: palette.name,
        author: palette.author,
        version: 4,
        colors: structuredClone(c),
        appearance: {
            surfaces: {
                page, header, panel, popup, toast, menu
            },
            roles: {
                preset: role(normal, active),
                navigation: role(navigationNormal, active),
                utility: role(utilityNormal, active),
                snapshot: role(snapshotNormal, active),
                bypass: role(normal, dangerState),
                danger: role(dangerState, dangerState)
            },
            controls,
            motion: {
                enabled: true,
                respectReducedMotion: true,
                feedbackDurationMs: 2600
            },
            fonts: makeThemeFonts(profile)
        }
    };
}

export const BUILT_IN_THEMES: MultiFXThemeDefinition[] =
    BUILT_IN_THEME_PALETTES.map(makeTheme);

export const THEME_STORAGE_KEY = "pimfx-theme-v4";
export const CUSTOM_THEMES_STORAGE_KEY =
    "pimfx-custom-themes-v4";
const LEGACY_THEME_STORAGE_KEY = "pimfx-theme-v3";
const LEGACY_CUSTOM_THEMES_STORAGE_KEY =
    "pimfx-custom-themes-v3";
export const MULTIFX_THEME_CHANGED_EVENT = "pimfx-theme-changed";

export const MFX_COLORS = {
    background: "var(--mfx-bg)",
    panel: "var(--mfx-panel)",
    panelAlt: "var(--mfx-panel-alt)",
    purple: "var(--mfx-purple)",
    purpleLight: "var(--mfx-purple-light)",
    purpleSurface: "var(--mfx-purple-surface)",
    cyan: "var(--mfx-cyan)",
    cyanSurface: "var(--mfx-cyan-surface)",
    cyanText: "var(--mfx-cyan-text)",
    text: "var(--mfx-text)",
    muted: "var(--mfx-muted)",
    border: "var(--mfx-border)",
    danger: "var(--mfx-danger)"
} as const;

/** Semantic surfaces used by MultiFX screens, dialogs, menus and feedback. */
export const MFX_SURFACES = {
    page: {
        background: "var(--mfx-surface-page-bg)",
        border: "var(--mfx-surface-page-border)",
        text: "var(--mfx-surface-page-text)",
        label: "var(--mfx-surface-page-label)",
        accent: "var(--mfx-surface-page-accent)",
        shadow: "var(--mfx-surface-page-shadow)"
    },
    header: {
        background: "var(--mfx-surface-header-bg)",
        border: "var(--mfx-surface-header-border)",
        text: "var(--mfx-surface-header-text)",
        label: "var(--mfx-surface-header-label)",
        accent: "var(--mfx-surface-header-accent)",
        shadow: "var(--mfx-surface-header-shadow)"
    },
    panel: {
        background: "var(--mfx-surface-panel-bg)",
        border: "var(--mfx-surface-panel-border)",
        text: "var(--mfx-surface-panel-text)",
        label: "var(--mfx-surface-panel-label)",
        accent: "var(--mfx-surface-panel-accent)",
        shadow: "var(--mfx-surface-panel-shadow)"
    },
    popup: {
        background: "var(--mfx-surface-popup-bg)",
        border: "var(--mfx-surface-popup-border)",
        text: "var(--mfx-surface-popup-text)",
        label: "var(--mfx-surface-popup-label)",
        accent: "var(--mfx-surface-popup-accent)",
        shadow: "var(--mfx-surface-popup-shadow)"
    },
    toast: {
        background: "var(--mfx-surface-toast-bg)",
        border: "var(--mfx-surface-toast-border)",
        text: "var(--mfx-surface-toast-text)",
        label: "var(--mfx-surface-toast-label)",
        accent: "var(--mfx-surface-toast-accent)",
        shadow: "var(--mfx-surface-toast-shadow)"
    },
    menu: {
        background: "var(--mfx-surface-menu-bg)",
        border: "var(--mfx-surface-menu-border)",
        text: "var(--mfx-surface-menu-text)",
        label: "var(--mfx-surface-menu-label)",
        accent: "var(--mfx-surface-menu-accent)",
        shadow: "var(--mfx-surface-menu-shadow)"
    }
} as const;

/** CSS double-background recipe that supports gradient borders. */
export function multiFXSurfaceBackground(
    surface: keyof typeof MFX_SURFACES
): string {
    const value = MFX_SURFACES[surface];
    return `${value.background} padding-box, ${value.border} border-box`;
}

export const MFX_HEADER_HEIGHT = 56;

function isHexColor(value: unknown): value is string {
    return typeof value === "string"
        && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
    value: Record<string, unknown>,
    keys: readonly string[]
): boolean {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length
        && actual.every((key, index) => key === expected[index]);
}

function validShadow(value: unknown): value is string {
    return typeof value === "string"
        && value.length <= 160
        && !/[;{}]|url\s*\(/i.test(value);
}

function validPaint(value: unknown): value is MultiFXThemePaint {
    if (!isRecord(value)
        || !hasOnlyKeys(value, ["kind", "colors", "angle"])
        || !["solid", "linear", "radial", "conic"].includes(
            String(value.kind)
        )
        || !Array.isArray(value.colors)
        || value.colors.length < 1
        || value.colors.length > 3
        || !value.colors.every(isHexColor)
        || typeof value.angle !== "number"
        || !Number.isFinite(value.angle)
        || value.angle < 0
        || value.angle > 360) {
        return false;
    }
    return value.kind === "solid"
        ? value.colors.length === 1
        : value.colors.length >= 2;
}

function validSurface(value: unknown): value is MultiFXThemeSurface {
    return isRecord(value)
        && hasOnlyKeys(value, [
            "background", "border", "text", "label", "accent", "shadow"
        ])
        && validPaint(value.background)
        && validPaint(value.border)
        && isHexColor(value.text)
        && isHexColor(value.label)
        && isHexColor(value.accent)
        && validShadow(value.shadow);
}

function validControlState(value: unknown): value is MultiFXThemeControlState {
    return isRecord(value)
        && hasOnlyKeys(value, [
            "background", "border", "label", "value", "indicator", "shadow"
        ])
        && validPaint(value.background)
        && validPaint(value.border)
        && isHexColor(value.label)
        && isHexColor(value.value)
        && isHexColor(value.indicator)
        && validShadow(value.shadow);
}

function validControlRole(value: unknown): value is MultiFXThemeControlRole {
    return isRecord(value)
        && hasOnlyKeys(value, ["normal", "active"])
        && validControlState(value.normal)
        && validControlState(value.active);
}

function numberIn(value: unknown, min: number, max: number): boolean {
    return typeof value === "number"
        && Number.isFinite(value)
        && value >= min
        && value <= max;
}

function validTextStyle(value: unknown): value is MultiFXThemeTextStyle {
    return isRecord(value)
        && hasOnlyKeys(value, ["family", "sizePercent"])
        && MULTIFX_FONT_IDS.has(String(value.family) as MultiFXFontFamilyId)
        && numberIn(value.sizePercent, 60, 220);
}

function validFonts(value: unknown): value is MultiFXThemeFonts {
    if (!isRecord(value)
        || !hasOnlyKeys(value, [
            "interface", "heading", "label", "value", "switchLabel",
            "switchValue", "controlLabel", "controlFunction",
            "controlValue", "feedback", "controlPopupSizePercent"
        ])) {
        return false;
    }
    const textRoles = [
        "interface", "heading", "label", "value", "switchLabel",
        "switchValue", "controlLabel", "controlFunction",
        "controlValue", "feedback"
    ];
    return textRoles.every((role) => validTextStyle(value[role]))
        && numberIn(value.controlPopupSizePercent, 100, 250);
}

function validAppearance(value: unknown): value is MultiFXThemeAppearance {
    if (!isRecord(value)
        || !hasOnlyKeys(value, [
            "surfaces", "roles", "controls", "motion", "fonts"
        ])
        || !isRecord(value.surfaces)
        || !hasOnlyKeys(value.surfaces, [
            "page", "header", "panel", "popup", "toast", "menu"
        ])
        || !Object.values(value.surfaces).every(validSurface)
        || !isRecord(value.roles)
        || !hasOnlyKeys(value.roles, [
            "preset", "navigation", "utility", "snapshot", "bypass", "danger"
        ])
        || !Object.values(value.roles).every(validControlRole)
        || !isRecord(value.controls)
        || !hasOnlyKeys(value.controls, [
            "switchStyle", "switchShape", "analogStyle", "indicatorStyle",
            "indicatorAnimation", "indicatorInactive", "indicatorActive",
            "indicatorChanged", "animationSeconds", "borderWidth",
            "cornerRadius", "glowStrength", "disabledOpacity",
            "glassBlur", "glassHighlight"
        ])
        || !["tiles", "footswitch", "arcade", "glass", "minimal"]
            .includes(String(value.controls.switchStyle))
        || !["rounded", "square", "pill", "bevel", "hexagon"]
            .includes(String(value.controls.switchShape))
        || !["modern", "vintage", "neon", "minimal"]
            .includes(String(value.controls.analogStyle))
        || !["dot", "ring", "halo", "bar", "none"]
            .includes(String(value.controls.indicatorStyle))
        || !["none", "pulse", "breathe", "spin", "chase"]
            .includes(String(value.controls.indicatorAnimation))
        || !isHexColor(value.controls.indicatorInactive)
        || !isHexColor(value.controls.indicatorActive)
        || !isHexColor(value.controls.indicatorChanged)
        || !numberIn(value.controls.animationSeconds, 0.2, 10)
        || !numberIn(value.controls.borderWidth, 0, 8)
        || !numberIn(value.controls.cornerRadius, 0, 40)
        || !numberIn(value.controls.glowStrength, 0, 1)
        || !numberIn(value.controls.disabledOpacity, 0.1, 1)
        || !numberIn(value.controls.glassBlur, 0, 30)
        || !numberIn(value.controls.glassHighlight, 0, 1)
        || !isRecord(value.motion)
        || !hasOnlyKeys(value.motion, [
            "enabled", "respectReducedMotion", "feedbackDurationMs"
        ])
        || typeof value.motion.enabled !== "boolean"
        || typeof value.motion.respectReducedMotion !== "boolean"
        || !numberIn(value.motion.feedbackDurationMs, 500, 10000)
        || !validFonts(value.fonts)) {
        return false;
    }
    return true;
}

const LEGACY_FONT_REPLACEMENTS: Readonly<Record<string, MultiFXFontFamilyId>> = {
    "nexa": "montserrat",
    "pirulen": "orbitron",
    "epf": "rajdhani",
    "england-hand": "nunito"
};

/** Add typography defaults to version-3 themes and replace removed novelty
 * font IDs in early version-4 themes with readable, open-license equivalents. */
function upgradeLegacyTheme(value: unknown): unknown {
    if (!isRecord(value) || (value.version !== 3 && value.version !== 4)) {
        return value;
    }
    const next = structuredClone(value) as Record<string, unknown>;
    if (!isRecord(next.appearance)) return next;
    const appearance = next.appearance;
    if (isRecord(appearance.fonts)) {
        for (const role of [
            "interface", "heading", "label", "value", "switchLabel",
            "switchValue", "controlLabel", "controlFunction",
            "controlValue", "feedback"
        ]) {
            const font = appearance.fonts[role];
            if (!isRecord(font)) continue;
            const replacement = LEGACY_FONT_REPLACEMENTS[String(font.family)];
            if (replacement) font.family = replacement;
        }
        return next;
    }
    if (value.version !== 3) return next;

    let profile: BuiltInThemeProfile = "modern";
    if (isRecord(appearance.controls)) {
        const style = String(appearance.controls.switchStyle);
        if (style === "footswitch") profile = "stompbox";
        else if (style === "glass") profile = "glass";
        else if (style === "arcade") profile = "arcade";
        else if (style === "minimal") profile = "minimal";
        else if (appearance.controls.indicatorAnimation === "none") {
            profile = "studio";
        }
    }
    appearance.fonts = makeThemeFonts(profile);
    next.version = 4;
    return next;
}

export function validateMultiFXTheme(
    value: unknown
): MultiFXThemeDefinition | undefined {
    const upgraded = upgradeLegacyTheme(value);
    if (!isRecord(upgraded)
        || !hasOnlyKeys(upgraded, [
            "name", "author", "version", "colors", "appearance"
        ])) return undefined;

    const source = upgraded;
    const colors = source.colors;

    if (
        typeof source.name !== "string"
        || !source.name.trim()
        || source.name.length > 80
        || typeof source.author !== "string"
        || source.author.length > 80
        || source.version !== 4
        || !isRecord(colors)
        || !hasOnlyKeys(colors, [
            "background", "panel", "panelAlt", "navigation",
            "navigationText", "navigationSurface", "selected",
            "selectedSurface", "selectedText", "text", "muted",
            "border", "danger"
        ])
    ) {
        return undefined;
    }

    const required = [
        "background",
        "panel",
        "panelAlt",
        "navigation",
        "navigationText",
        "navigationSurface",
        "selected",
        "selectedSurface",
        "selectedText",
        "text",
        "muted",
        "border",
        "danger"
    ];

    for (const key of required) {
        if (!isHexColor(colors[key])) return undefined;
    }
    if (!validAppearance(source.appearance)) return undefined;

    return structuredClone(source) as unknown as MultiFXThemeDefinition;
}

/** Convert a validated paint token into one CSS background value. */
export function themePaintToCss(paint: MultiFXThemePaint): string {
    if (paint.kind === "solid") return paint.colors[0];
    const colors = paint.colors.join(", ");
    if (paint.kind === "radial") {
        return `radial-gradient(circle, ${colors})`;
    }
    if (paint.kind === "conic") {
        return `conic-gradient(from ${paint.angle}deg, ${colors})`;
    }
    return `linear-gradient(${paint.angle}deg, ${colors})`;
}

export function loadMultiFXTheme(): MultiFXThemeDefinition {
    try {
        for (const key of [THEME_STORAGE_KEY, LEGACY_THEME_STORAGE_KEY]) {
            const stored = window.localStorage.getItem(key);
            if (!stored) continue;
            const parsed = validateMultiFXTheme(JSON.parse(stored));
            if (parsed) {
                if (key !== THEME_STORAGE_KEY) {
                    window.localStorage.setItem(
                        THEME_STORAGE_KEY,
                        JSON.stringify(parsed, null, 2)
                    );
                }
                return parsed;
            }
        }
    } catch {
        // Fall through to default.
    }

    return BUILT_IN_THEMES[0];
}

export function saveMultiFXTheme(theme: MultiFXThemeDefinition): boolean {
    const valid = validateMultiFXTheme(theme);
    if (!valid) return false;

    window.localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify(valid, null, 2)
    );
    applyMultiFXTheme(valid);
    window.dispatchEvent(new Event(MULTIFX_THEME_CHANGED_EVENT));
    return true;
}


export function loadCustomMultiFXThemes(): MultiFXThemeDefinition[] {
    try {
        const stored = window.localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY)
            ?? window.localStorage.getItem(LEGACY_CUSTOM_THEMES_STORAGE_KEY);

        if (!stored) return [];

        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return [];

        const valid = parsed
            .map((item) => validateMultiFXTheme(item))
            .filter(
                (item): item is MultiFXThemeDefinition =>
                    item !== undefined
            );
        if (!window.localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY)) {
            window.localStorage.setItem(
                CUSTOM_THEMES_STORAGE_KEY,
                JSON.stringify(valid, null, 2)
            );
        }
        return valid;
    } catch {
        return [];
    }
}

export function saveCustomMultiFXTheme(
    theme: MultiFXThemeDefinition
): MultiFXThemeDefinition[] {
    const valid = validateMultiFXTheme(theme);
    if (!valid) {
        return loadCustomMultiFXThemes();
    }

    const current = loadCustomMultiFXThemes();

    // Custom theme names are unique, case-insensitively. Saving the same
    // name updates that custom theme rather than creating duplicates.
    const filtered = current.filter(
        (item) =>
            item.name.trim().toLowerCase()
            !== valid.name.trim().toLowerCase()
    );

    const next = [
        ...filtered,
        JSON.parse(JSON.stringify(valid)) as MultiFXThemeDefinition
    ].sort((a, b) => a.name.localeCompare(b.name));

    window.localStorage.setItem(
        CUSTOM_THEMES_STORAGE_KEY,
        JSON.stringify(next, null, 2)
    );

    return next;
}

export function deleteCustomMultiFXTheme(
    name: string
): MultiFXThemeDefinition[] {
    const next = loadCustomMultiFXThemes().filter(
        (item) =>
            item.name.trim().toLowerCase()
            !== name.trim().toLowerCase()
    );

    window.localStorage.setItem(
        CUSTOM_THEMES_STORAGE_KEY,
        JSON.stringify(next, null, 2)
    );

    return next;
}

export function clearSavedMultiFXTheme(): void {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    applyMultiFXTheme(BUILT_IN_THEMES[0]);
    window.dispatchEvent(new Event(MULTIFX_THEME_CHANGED_EVENT));
}

const scaledPx = (value: number, percent: number): string =>
    `${Number((value * percent / 100).toFixed(2))}px`;

const responsiveFontSize = (
    minimumPx: number,
    preferredCqh: number,
    maximumPx: number,
    percent: number
): string => `clamp(${scaledPx(minimumPx, percent)}, ${Number(
    (preferredCqh * percent / 100).toFixed(2)
)}cqh, ${scaledPx(maximumPx, percent)})`;

export function applyMultiFXTheme(theme: MultiFXThemeDefinition): void {
    const c = theme.colors;
    const appearance = theme.appearance;
    const targets = [document.documentElement, document.body];

    for (const target of targets) {
        target.style.setProperty("--mfx-bg", c.background);
        target.style.setProperty("--mfx-panel", c.panel);
        target.style.setProperty("--mfx-panel-alt", c.panelAlt);
        target.style.setProperty("--mfx-purple", c.navigation);
        target.style.setProperty("--mfx-purple-light", c.navigationText);
        target.style.setProperty("--mfx-purple-surface", c.navigationSurface);
        target.style.setProperty("--mfx-cyan", c.selected);
        target.style.setProperty("--mfx-cyan-surface", c.selectedSurface);
        target.style.setProperty("--mfx-cyan-text", c.selectedText);
        target.style.setProperty("--mfx-text", c.text);
        target.style.setProperty("--mfx-muted", c.muted);
        target.style.setProperty("--mfx-border", c.border);
        target.style.setProperty("--mfx-danger", c.danger);

        for (const [name, surfaceValue] of Object.entries(
            appearance.surfaces
        )) {
            const prefix = `--mfx-surface-${name}`;
            target.style.setProperty(
                `${prefix}-bg`,
                themePaintToCss(surfaceValue.background)
            );
            target.style.setProperty(
                `${prefix}-border`,
                themePaintToCss(surfaceValue.border)
            );
            target.style.setProperty(`${prefix}-text`, surfaceValue.text);
            target.style.setProperty(`${prefix}-label`, surfaceValue.label);
            target.style.setProperty(`${prefix}-accent`, surfaceValue.accent);
            target.style.setProperty(`${prefix}-shadow`, surfaceValue.shadow);
        }

        for (const [roleName, role] of Object.entries(appearance.roles)) {
            for (const stateName of ["normal", "active"] as const) {
                const state = role[stateName];
                const prefix = `--mfx-role-${roleName}-${stateName}`;
                target.style.setProperty(
                    `${prefix}-bg`, themePaintToCss(state.background)
                );
                target.style.setProperty(
                    `${prefix}-border`, themePaintToCss(state.border)
                );
                target.style.setProperty(`${prefix}-label`, state.label);
                target.style.setProperty(`${prefix}-value`, state.value);
                target.style.setProperty(
                    `${prefix}-indicator`, state.indicator
                );
                target.style.setProperty(`${prefix}-shadow`, state.shadow);
            }
        }

        const controls = appearance.controls;
        target.style.setProperty(
            "--mfx-control-indicator-inactive", controls.indicatorInactive
        );
        target.style.setProperty(
            "--mfx-control-indicator-active", controls.indicatorActive
        );
        target.style.setProperty(
            "--mfx-control-indicator-changed", controls.indicatorChanged
        );
        target.style.setProperty(
            "--mfx-control-animation-seconds", `${controls.animationSeconds}s`
        );
        target.style.setProperty(
            "--mfx-control-border-width", `${controls.borderWidth}px`
        );
        target.style.setProperty(
            "--mfx-control-radius", `${controls.cornerRadius}px`
        );
        target.style.setProperty(
            "--mfx-control-glow-strength", String(controls.glowStrength)
        );
        target.style.setProperty(
            "--mfx-control-disabled-opacity", String(controls.disabledOpacity)
        );
        target.style.setProperty(
            "--mfx-control-glass-blur", `${controls.glassBlur}px`
        );
        target.style.setProperty(
            "--mfx-control-glass-highlight", String(controls.glassHighlight)
        );
        target.style.setProperty(
            "--mfx-feedback-duration-ms",
            String(appearance.motion.feedbackDurationMs)
        );

        const fonts = appearance.fonts;
        const fontRoles: readonly [string, MultiFXThemeTextStyle][] = [
            ["interface", fonts.interface],
            ["heading", fonts.heading],
            ["label", fonts.label],
            ["value", fonts.value],
            ["switch-label", fonts.switchLabel],
            ["switch-value", fonts.switchValue],
            ["control-label", fonts.controlLabel],
            ["control-function", fonts.controlFunction],
            ["control-value", fonts.controlValue],
            ["feedback", fonts.feedback]
        ];
        for (const [role, font] of fontRoles) {
            target.style.setProperty(
                `--mfx-font-${role}-family`,
                multiFXFontFamilyToCss(font.family)
            );
            target.style.setProperty(
                `--mfx-font-${role}-scale`,
                String(font.sizePercent / 100)
            );
        }

        target.style.setProperty(
            "--mfx-font-interface-size",
            scaledPx(16, fonts.interface.sizePercent)
        );
        target.style.setProperty(
            "--mfx-font-heading-size",
            scaledPx(16, fonts.heading.sizePercent)
        );
        target.style.setProperty(
            "--mfx-font-label-size",
            scaledPx(12, fonts.label.sizePercent)
        );
        target.style.setProperty(
            "--mfx-font-value-size",
            scaledPx(16, fonts.value.sizePercent)
        );
        target.style.setProperty(
            "--mfx-font-switch-label-size",
            responsiveFontSize(10, 14, 14, fonts.switchLabel.sizePercent)
        );
        target.style.setProperty(
            "--mfx-font-switch-value-size",
            responsiveFontSize(18, 28, 28, fonts.switchValue.sizePercent)
        );
        target.style.setProperty(
            "--mfx-font-switch-secondary-size",
            responsiveFontSize(8, 18, 11, fonts.switchLabel.sizePercent)
        );
        target.style.setProperty(
            "--mfx-font-system-label-size",
            responsiveFontSize(8, 16, 10, fonts.label.sizePercent)
        );
        target.style.setProperty(
            "--mfx-font-system-value-size",
            responsiveFontSize(9, 20, 12, fonts.value.sizePercent)
        );
        target.style.setProperty(
            "--mfx-font-control-label-size",
            responsiveFontSize(7, 8, 13, fonts.controlLabel.sizePercent)
        );
        target.style.setProperty(
            "--mfx-font-control-function-size",
            responsiveFontSize(7, 7, 12, fonts.controlFunction.sizePercent)
        );
        target.style.setProperty(
            "--mfx-font-control-value-size",
            responsiveFontSize(8, 10, 16, fonts.controlValue.sizePercent)
        );

        const popupScale = fonts.controlPopupSizePercent / 100;
        target.style.setProperty(
            "--mfx-font-control-label-popout-size",
            scaledPx(
                13 * popupScale,
                fonts.controlLabel.sizePercent
            )
        );
        target.style.setProperty(
            "--mfx-font-control-function-popout-size",
            scaledPx(
                12 * popupScale,
                fonts.controlFunction.sizePercent
            )
        );
        target.style.setProperty(
            "--mfx-font-control-value-popout-size",
            scaledPx(
                16 * popupScale,
                fonts.controlValue.sizePercent
            )
        );
        target.style.setProperty(
            "--mfx-font-feedback-source-size",
            scaledPx(10.72, fonts.feedback.sizePercent)
        );
        target.style.setProperty(
            "--mfx-font-feedback-text-size",
            scaledPx(16, fonts.feedback.sizePercent)
        );
        target.style.setProperty(
            "--mfx-font-feedback-value-size",
            scaledPx(19.2, fonts.feedback.sizePercent)
        );
    }

    const root = document.documentElement;
    root.dataset.mfxSwitchStyle = appearance.controls.switchStyle;
    root.dataset.mfxSwitchShape = appearance.controls.switchShape;
    root.dataset.mfxAnalogStyle = appearance.controls.analogStyle;
    root.dataset.mfxIndicatorStyle = appearance.controls.indicatorStyle;
    root.dataset.mfxIndicatorAnimation =
        appearance.motion.enabled
            ? appearance.controls.indicatorAnimation
            : "none";
    root.dataset.mfxRespectReducedMotion =
        appearance.motion.respectReducedMotion ? "true" : "false";
    root.dataset.mfxColorScheme = paletteLuminance(c.background) >= 0.4
        ? "light"
        : "dark";
}

export function clearAppliedMultiFXTheme(): void {
    const keys = [
        "--mfx-bg",
        "--mfx-panel",
        "--mfx-panel-alt",
        "--mfx-purple",
        "--mfx-purple-light",
        "--mfx-purple-surface",
        "--mfx-cyan",
        "--mfx-cyan-surface",
        "--mfx-cyan-text",
        "--mfx-text",
        "--mfx-muted",
        "--mfx-border",
        "--mfx-danger"
    ];

    const surfaceKeys = [
        "page", "header", "panel", "popup", "toast", "menu"
    ].flatMap((name) => [
        `--mfx-surface-${name}-bg`,
        `--mfx-surface-${name}-border`,
        `--mfx-surface-${name}-text`,
        `--mfx-surface-${name}-label`,
        `--mfx-surface-${name}-accent`,
        `--mfx-surface-${name}-shadow`
    ]);
    const roleKeys = [
        "preset", "navigation", "utility", "snapshot", "bypass", "danger"
    ].flatMap((role) => ["normal", "active"].flatMap((state) => [
        `--mfx-role-${role}-${state}-bg`,
        `--mfx-role-${role}-${state}-border`,
        `--mfx-role-${role}-${state}-label`,
        `--mfx-role-${role}-${state}-value`,
        `--mfx-role-${role}-${state}-indicator`,
        `--mfx-role-${role}-${state}-shadow`
    ]));
    keys.push(
        ...surfaceKeys,
        ...roleKeys,
        "--mfx-control-indicator-inactive",
        "--mfx-control-indicator-active",
        "--mfx-control-indicator-changed",
        "--mfx-control-animation-seconds",
        "--mfx-control-border-width",
        "--mfx-control-radius",
        "--mfx-control-glow-strength",
        "--mfx-control-disabled-opacity",
        "--mfx-control-glass-blur",
        "--mfx-control-glass-highlight",
        "--mfx-feedback-duration-ms",
        "--mfx-font-interface-size",
        "--mfx-font-heading-size",
        "--mfx-font-label-size",
        "--mfx-font-value-size",
        "--mfx-font-switch-label-size",
        "--mfx-font-switch-value-size",
        "--mfx-font-switch-secondary-size",
        "--mfx-font-system-label-size",
        "--mfx-font-system-value-size",
        "--mfx-font-control-label-size",
        "--mfx-font-control-function-size",
        "--mfx-font-control-value-size",
        "--mfx-font-control-label-popout-size",
        "--mfx-font-control-function-popout-size",
        "--mfx-font-control-value-popout-size",
        "--mfx-font-feedback-source-size",
        "--mfx-font-feedback-text-size",
        "--mfx-font-feedback-value-size"
    );

    for (const role of [
        "interface", "heading", "label", "value", "switch-label",
        "switch-value", "control-label", "control-function",
        "control-value", "feedback"
    ]) {
        keys.push(`--mfx-font-${role}-family`, `--mfx-font-${role}-scale`);
    }

    for (const target of [document.documentElement, document.body]) {
        for (const key of keys) {
            target.style.removeProperty(key);
        }
    }
    delete document.documentElement.dataset.mfxSwitchStyle;
    delete document.documentElement.dataset.mfxSwitchShape;
    delete document.documentElement.dataset.mfxAnalogStyle;
    delete document.documentElement.dataset.mfxIndicatorStyle;
    delete document.documentElement.dataset.mfxIndicatorAnimation;
    delete document.documentElement.dataset.mfxRespectReducedMotion;
    delete document.documentElement.dataset.mfxColorScheme;
}

export function resolveTheme(themeId: string, custom: unknown[] = []): MultiFXThemeDefinition {
    const resolvedId = themeId === "MultiFX Purple" ? "Pi-MFX Purple" : themeId;
    const customs = custom
        .map((value) => validateMultiFXTheme(value))
        .filter((theme): theme is MultiFXThemeDefinition => !!theme);
    return customs.find((theme) => theme.name === resolvedId)
        || BUILT_IN_THEMES.find((theme) => theme.name === resolvedId)
        || BUILT_IN_THEMES.find((theme) => theme.name === "Pi-MFX Purple")
        || loadMultiFXTheme()
        || BUILT_IN_THEMES[0];
}

export function themeLedColors(theme: MultiFXThemeDefinition): Record<string, string> {
    const roles = theme.appearance.roles;
    return {
        preset: roles.preset.active.indicator,
        navigation: roles.navigation.active.indicator,
        utility: roles.utility.active.indicator,
        snapshot: roles.snapshot.active.indicator,
        bypass: roles.bypass.active.indicator,
        danger: roles.danger.active.indicator,
        inactive: theme.appearance.controls.indicatorInactive,
        modified: theme.appearance.controls.indicatorChanged
    };
}
