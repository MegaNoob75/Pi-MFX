import { useMemo, useState } from "react";
import { useEngine } from "./api";
import { bool, obj } from "./json";
import { AboutView } from "./views/AboutView";
import { BanksView } from "./views/BanksView";
import { EditorView } from "./views/EditorView";
import { PerformanceView } from "./views/PerformanceView";
import { KeyboardProvider } from "./keyboard/KeyboardProvider";
import { SettingsHub, SettingsPage as SettingsDetail, type SettingsPage } from "./views/SettingsView";
import ThemeManagerView from "./views/ThemeManagerView";
import { LayoutEditorView } from "./views/LayoutEditorView";
import { SnapshotManagerView } from "./views/SnapshotManagerView";
import { SnapshotEditView } from "./views/SnapshotEditView";
import { BackupView } from "./views/BackupView";
import { ThemeRoot, persistThemeSettings } from "./theme/ThemeRoot";
import { loadCustomMultiFXThemes, themeLedColors } from "./theme/theme";

export type View =
    | "performance"
    | "banks"
    | "edit"
    | "snapshots"
    | "snapshotEdit"
    | "settings"
    | SettingsPage
    | "about";

const titles: Record<string, string> = {
    performance: "PERFORMANCE",
    banks: "BANKS / PRESETS",
    edit: "PRESET EDITOR",
    snapshots: "SNAPSHOTS",
    snapshotEdit: "EDIT SNAPSHOT",
    settings: "SETTINGS",
    audio: "AUDIO",
    controller: "CONTROLLER",
    layout: "LAYOUT",
    theme: "THEME",
    keyboard: "KEYBOARD",
    ui: "UI",
    library: "LIBRARY",
    backup: "BACKUP",
    system: "SYSTEM",
    about: "ABOUT"
};

export function App() {
    const engine = useEngine();
    const [view, setView] = useState<View>("performance");
    const [menuOpen, setMenuOpen] = useState(false);
    const [, setHistory] = useState<View[]>([]);
    const [toast, setToast] = useState("");
    const [snapshotEditId, setSnapshotEditId] = useState("");

    const settingsPages: SettingsPage[] = [
        "audio", "controller", "layout", "theme", "keyboard", "ui", "library", "backup", "system"
    ];
    const settingsActive = view === "settings" || settingsPages.includes(view as SettingsPage);

    const goTo = (next: View) => {
        setMenuOpen(false);
        if (next === view) {
            return;
        }
        setHistory((stack) => [...stack, view]);
        setView(next);
    };

    const goBack = () => {
        setMenuOpen(false);
        setHistory((stack) => {
            const previous = stack[stack.length - 1];
            setView(previous ?? "performance");
            return stack.slice(0, -1);
        });
    };

    const run = async (work: () => Promise<unknown>) => {
        try {
            await work();
            setToast("");
        } catch (error) {
            setToast(error instanceof Error ? error.message : String(error));
        }
    };

    const audioRunning = bool(engine.state.audioRunning);
    const title = useMemo(() => titles[view] ?? "PI-MFX", [view]);
    const ui = obj(engine.state.ui);

    return (
        <div className="app">
            <ThemeRoot ui={ui} />
            <header className="shell">
                <button type="button" className="btn-mfx" onClick={() => setMenuOpen((open) => !open)}>
                    PI-MFX
                </button>
                <div className="shell-title">{title}</div>
                <div className="shell-actions">
                    <span className={`status-dot${engine.connected && audioRunning ? " on" : ""}`} title={
                        engine.connected
                            ? audioRunning ? "engine connected, audio running" : "engine connected"
                            : "engine disconnected"
                    } />
                    {view !== "performance" ? (
                        <button type="button" className="btn-mfx btn-back" onClick={goBack}>←</button>
                    ) : (
                        <div style={{ width: 48 }} />
                    )}
                </div>
            </header>

            <main className="page">
                {view === "performance" && (
                    <PerformanceView engine={engine} run={run} onSnapshots={() => goTo("snapshots")} />
                )}
                {view === "banks" && <BanksView engine={engine} run={run} />}
                {view === "edit" && <EditorView engine={engine} run={run} />}
                {view === "snapshots" && (
                    <SnapshotManagerView
                        engine={engine}
                        run={run}
                        onEdit={(snapshotId) => {
                            setSnapshotEditId(snapshotId);
                            goTo("snapshotEdit");
                        }}
                    />
                )}
                {view === "snapshotEdit" && snapshotEditId && (
                    <SnapshotEditView
                        engine={engine}
                        run={run}
                        snapshotId={snapshotEditId}
                        onComplete={() => goTo("snapshots")}
                    />
                )}
                {view === "settings" && (
                    <SettingsHub onOpen={(page) => goTo(page)} />
                )}
                {view === "theme" && (
                    <ThemeManagerView persistTheme={async (theme) => {
                        await engine.client.request("ui/settings", persistThemeSettings(
                            obj(engine.state.ui),
                            theme.name,
                            loadCustomMultiFXThemes(),
                            themeLedColors(theme)
                        ));
                    }} />
                )}
                {view === "layout" && <LayoutEditorView engine={engine} run={run} />}
                {view === "backup" && <BackupView engine={engine} run={run} />}
                {(view === "audio" || view === "controller" || view === "ui" || view === "keyboard"
                    || view === "library" || view === "system") && (
                    <SettingsDetail page={view} engine={engine} run={run} />
                )}
                {view === "about" && <AboutView state={engine.state} />}
            </main>

            {menuOpen && (
                <>
                    <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                    <nav className="menu">
                        <div className="menu-brand">
                            <svg className="about-logo" viewBox="0 0 32 32" aria-hidden="true">
                                <path d="M6 22c0-7 4.2-13 10.4-15.4C14 10 13 14.2 13.6 18.2 16 16 19.6 15 23 16.2 20.8 20 16.8 23.2 12 24.2 9.6 24.6 7.6 23.8 6 22z" />
                            </svg>
                            <div>
                                <b>Pi-MFX</b>
                                <span>GUITAR MULTI-FX</span>
                            </div>
                        </div>
                        <MenuButton label="PERFORMANCE" subtitle="Presets, snapshots and footswitches"
                            active={view === "performance"} onClick={() => goTo("performance")} />
                        <MenuButton label="BANKS / PRESETS" subtitle="Organize banks and presets"
                            active={view === "banks"} onClick={() => goTo("banks")} />
                        <MenuButton label="PRESET EDITOR" subtitle="Plugins, controls and signal chain"
                            active={view === "edit"} onClick={() => goTo("edit")} />
                        <MenuButton label="SNAPSHOTS" subtitle="Capture, recall, rename and colour"
                            active={view === "snapshots"} onClick={() => goTo("snapshots")} />
                        <div className="menu-divider" />
                        <MenuButton label="SETTINGS" subtitle="Audio, theme, layout, controller and system"
                            active={settingsActive} onClick={() => goTo("settings")} />
                        <MenuButton label="ABOUT" subtitle="About Pi-MFX"
                            active={view === "about"} onClick={() => goTo("about")} />
                    </nav>
                </>
            )}

            {(toast || engine.lastError) && (
                <div className="toast">{toast || engine.lastError}</div>
            )}
            <KeyboardProvider />
        </div>
    );
}

function MenuButton({
    label,
    subtitle,
    active,
    onClick
}: {
    label: string;
    subtitle: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button type="button" className="menu-item" aria-current={active ? "page" : undefined} onClick={onClick}>
            {label}
            <small>{subtitle}</small>
        </button>
    );
}
