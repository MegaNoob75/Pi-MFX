import { useMemo, useState } from "react";
import { useEngine } from "./api";
import { bool } from "./json";
import { AboutView } from "./views/AboutView";
import { BanksView } from "./views/BanksView";
import { EditorView } from "./views/EditorView";
import { PerformanceView } from "./views/PerformanceView";
import { KeyboardProvider } from "./keyboard/KeyboardProvider";
import { SettingsHub, SettingsPage as SettingsDetail } from "./views/SettingsView";

export type View =
    | "performance"
    | "banks"
    | "edit"
    | "settings"
    | "audio"
    | "controller"
    | "ui"
    | "library"
    | "system"
    | "about";

const titles: Record<View, string> = {
    performance: "PERFORMANCE",
    banks: "BANKS / PRESETS",
    edit: "PRESET EDITOR",
    settings: "SETTINGS",
    audio: "AUDIO",
    controller: "CONTROLLER",
    ui: "UI",
    library: "LIBRARY",
    system: "SYSTEM",
    about: "ABOUT"
};

export function App() {
    const engine = useEngine();
    const [view, setView] = useState<View>("performance");
    const [menuOpen, setMenuOpen] = useState(false);
    const [, setHistory] = useState<View[]>([]);
    const [toast, setToast] = useState("");

    const settingsActive = ["settings", "audio", "controller", "ui", "library", "system"].includes(view);

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
    const title = useMemo(() => titles[view], [view]);

    return (
        <div className="app">
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
                {view === "performance" && <PerformanceView engine={engine} run={run} />}
                {view === "banks" && <BanksView engine={engine} run={run} />}
                {view === "edit" && <EditorView engine={engine} run={run} />}
                {view === "settings" && (
                    <SettingsHub onOpen={(page) => goTo(page)} />
                )}
                {(view === "audio" || view === "controller" || view === "ui" || view === "library" || view === "system") && (
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
                        <div className="menu-divider" />
                        <MenuButton label="SETTINGS" subtitle="Audio, controller, library and system"
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

