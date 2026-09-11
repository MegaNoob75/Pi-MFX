import { useEffect, useMemo, useRef, useState } from "react";
import { useEngine } from "./api";
import { bool, num, obj } from "./json";
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
import { UpdatesView } from "./views/UpdatesView";
import { PluginsView } from "./views/PluginsView";
import { Tone3000View } from "./views/Tone3000View";
import { FilesView } from "./views/LibraryManager";
import { ThemeRoot, persistThemeSettings } from "./theme/ThemeRoot";
import { saveCustomMultiFXTheme, themeLedColors } from "./theme/theme";
import { MarqueeText } from "./views/MarqueeText";
import { ConfirmDialog } from "./views/ConfirmDialog";
import { installResponsiveSizing } from "./responsive";

export type View =
    | "performance"
    | "banks"
    | "edit"
    | "snapshots"
    | "snapshotEdit"
    | "settings"
    | "library"
    | "plugins"
    | "files"
    | SettingsPage
    | "about";

type EditSubpage = "chain" | "controls" | "io";

const titles: Record<string, string> = {
    performance: "PERFORMANCE",
    banks: "BANKS / PRESETS",
    edit: "PRESET EDITOR",
    snapshots: "SNAPSHOTS",
    snapshotEdit: "SNAPSHOT EDITOR",
    settings: "SETTINGS",
    library: "MODEL LIBRARY",
    plugins: "PLUGINS",
    files: "FILES",
    audio: "AUDIO",
    controller: "CONTROLLER",
    layout: "LAYOUT",
    theme: "THEME",
    keyboard: "KEYBOARD",
    ui: "PI-MFX UI",
    tone3000: "MODEL LIBRARY",
    backup: "BACKUP",
    system: "SYSTEM",
    hotspot: "WIFI / HOTSPOT",
    updates: "UPDATES",
    about: "ABOUT"
};

export function App() {
    const engine = useEngine();
    const [view, setView] = useState<View>("performance");
    const [menuOpen, setMenuOpen] = useState(false);
    const [, setHistory] = useState<View[]>([]);
    const [toast, setToast] = useState("");
    const [snapshotEditId, setSnapshotEditId] = useState("");
    const [editSubpage, setEditSubpage] = useState<EditSubpage>("chain");
    const [editEffectTitle, setEditEffectTitle] = useState<string>();
    const [editBackRequest, setEditBackRequest] = useState(0);
    const [dismissedError, setDismissedError] = useState("");
    const [snapshotSaveRequest, setSnapshotSaveRequest] = useState(0);
    const [snapshotCancelRequest, setSnapshotCancelRequest] = useState(0);
    const [layoutDirty, setLayoutDirty] = useState(false);
    const [leaveLayout, setLeaveLayout] = useState<View | "back" | null>(null);
    const menuRef = useRef<HTMLElement | null>(null);

    useEffect(() => installResponsiveSizing(), []);

    const settingsPages: SettingsPage[] = [
        "audio", "controller", "layout", "theme", "keyboard", "ui", "tone3000", "backup", "system", "hotspot", "updates"
    ];
    const settingsActive = view === "settings" || settingsPages.includes(view as SettingsPage);
    const snapshotMode = bool(engine.state.snapshotMode);
    const chainLocked = snapshotMode || num(engine.state.activeSnapshot, -1) >= 0;

    const navigateTo = (next: View) => {
        setMenuOpen(false);
        if (next === view) {
            return;
        }
        // #region agent log
        fetch("http://127.0.0.1:7671/ingest/50e56e7c-9d0c-4ac2-8675-d5943d42b03b", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4847b9" }, body: JSON.stringify({ sessionId: "4847b9", location: "App.tsx:navigateTo", message: "navigate", data: { from: view, to: next, snapshotEditId, snapshotMode, cancelRequest: snapshotCancelRequest }, timestamp: Date.now(), hypothesisId: "H4" }) }).catch(() => undefined);
        // #endregion
        if (next === "edit") {
            setEditSubpage("chain");
            setEditEffectTitle(undefined);
        }
        setHistory((stack) => [...stack, view]);
        setView(next);
    };

    const goTo = (next: View) => {
        setMenuOpen(false);
        if (next === view) {
            return;
        }
        if (view === "layout" && layoutDirty && next !== "layout") {
            setLeaveLayout(next);
            return;
        }
        if (view === "edit" && next !== "edit") {
            void engine.client.request("preset/save").catch(() => undefined).finally(() => {
                navigateTo(next);
            });
            return;
        }
        navigateTo(next);
    };

    const finishBack = () => {
        setHistory((stack) => {
            const previous = stack[stack.length - 1];
            setView(previous ?? "performance");
            return stack.slice(0, -1);
        });
    };

    const goBack = () => {
        setMenuOpen(false);
        // #region agent log
        fetch("http://127.0.0.1:7671/ingest/50e56e7c-9d0c-4ac2-8675-d5943d42b03b", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4847b9" }, body: JSON.stringify({ sessionId: "4847b9", location: "App.tsx:goBack", message: "goBack", data: { view, snapshotEditId, snapshotMode, cancelRequest: snapshotCancelRequest }, timestamp: Date.now(), hypothesisId: "H4" }) }).catch(() => undefined);
        // #endregion
        if (view === "performance" && snapshotMode) {
            void engine.client.request("snapshot/mode", { enabled: false }).catch(() => undefined);
            return;
        }
        if (view === "snapshotEdit") {
            setSnapshotCancelRequest((value) => value + 1);
            return;
        }
        if (view === "edit" && editSubpage !== "chain") {
            setEditBackRequest((value) => value + 1);
            return;
        }
        if (view === "edit") {
            void engine.client.request("preset/save").catch(() => undefined).finally(() => {
                finishBack();
            });
            return;
        }
        if (view === "layout" && layoutDirty) {
            setLeaveLayout("back");
            return;
        }
        finishBack();
    };

    const openPerformance = () => {
        setMenuOpen(false);
        if (snapshotMode) {
            void engine.client.request("snapshot/mode", { enabled: false }).catch(() => undefined);
        }
        if (view !== "performance") {
            goTo("performance");
        }
    };

    const run = async (work: () => Promise<unknown>) => {
        try {
            await work();
            setToast("");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setDismissedError("");
            setToast(message);
        }
    };

    const errorText = toast || engine.lastError;
    const visibleToast = errorText && errorText !== dismissedError ? errorText : "";

    useEffect(() => {
        if (!visibleToast) {
            return;
        }
        const timer = window.setTimeout(() => {
            setDismissedError(errorText);
            setToast("");
        }, 4500);
        return () => window.clearTimeout(timer);
    }, [visibleToast, errorText]);

    useEffect(() => {
        if (!menuOpen) {
            return;
        }
        const getButtons = (): HTMLButtonElement[] => {
            const menu = menuRef.current;
            if (!menu) {
                return [];
            }
            return Array.from(menu.querySelectorAll("button:not(:disabled)"));
        };
        const frame = window.requestAnimationFrame(() => {
            const buttons = getButtons();
            const active = buttons.findIndex((button) => button.getAttribute("aria-current") === "page");
            buttons[active >= 0 ? active : 0]?.focus({ preventScroll: true });
        });
        const onKey = (event: KeyboardEvent) => {
            if (!["ArrowDown", "ArrowUp", "Enter", " ", "Escape"].includes(event.key)) {
                return;
            }
            const buttons = getButtons();
            if (buttons.length === 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape") {
                setMenuOpen(false);
                return;
            }
            const focused = buttons.findIndex((button) => button === document.activeElement);
            const current = focused >= 0 ? focused : 0;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                const next = (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next]?.focus({ preventScroll: true });
                buttons[next]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                return;
            }
            buttons[current]?.click();
        };
        window.addEventListener("keydown", onKey, true);
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener("keydown", onKey, true);
        };
    }, [menuOpen]);

    const audioRunning = bool(engine.state.audioRunning);
    const title = useMemo(() => {
        if (view === "performance" && snapshotMode) {
            return "SNAPSHOTS";
        }
        if (view === "edit") {
            if (editSubpage === "controls") {
                return `EFFECT — ${editEffectTitle ?? "SETTINGS"}`;
            }
            if (editSubpage === "io") {
                return editEffectTitle ?? "INPUT / OUTPUT";
            }
        }
        return titles[view] ?? "PI-MFX";
    }, [view, snapshotMode, editSubpage, editEffectTitle]);
    const ui = obj(engine.state.ui);
    const shellBackVisible = view !== "performance" || snapshotMode;

    return (
        <div className="app mfx-app-root">
            <ThemeRoot ui={ui} />
            <header className="shell">
                <button type="button" className="btn-mfx" onClick={() => {
                    if (view === "snapshotEdit") {
                        return;
                    }
                    setMenuOpen((open) => !open);
                }}>
                    PI-MFX
                </button>
                <div className="shell-mid">
                    {view === "edit" && editSubpage === "chain" ? (
                        <div className="shell-hint">Tap to edit • drag to reorder • + inserts an effect</div>
                    ) : (
                        <div />
                    )}
                    <div className="shell-title"><MarqueeText text={title} align="center" fontWeight={900} /></div>
                    <div />
                </div>
                <div className="shell-actions">
                    <span className={`status-dot${engine.connected && audioRunning ? " on" : ""}`} title={
                        engine.connected
                            ? audioRunning ? "engine connected, audio running" : "engine connected"
                            : "engine disconnected"
                    } />
                    {view === "edit" && editSubpage === "chain" && (
                        <button type="button" className="btn-mfx btn-accent" onClick={() => goTo("snapshots")}>
                            SNAPSHOTS
                        </button>
                    )}
                    {view === "snapshotEdit" && snapshotEditId && (
                        <button
                            type="button"
                            className="btn-mfx btn-accent"
                            onClick={() => setSnapshotSaveRequest((value) => value + 1)}
                        >
                            SAVE SNAPSHOT
                        </button>
                    )}
                    {shellBackVisible ? (
                        <button type="button" className="btn-mfx btn-back" onPointerUp={() => {
                            // #region agent log
                            fetch("http://127.0.0.1:7671/ingest/50e56e7c-9d0c-4ac2-8675-d5943d42b03b", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4847b9" }, body: JSON.stringify({ sessionId: "4847b9", location: "App.tsx:backPointerUp", message: "back pointerup", data: { view, snapshotEditId }, timestamp: Date.now(), hypothesisId: "H4" }) }).catch(() => undefined);
                            // #endregion
                        }} onClick={goBack}>←</button>
                    ) : (
                        <div style={{ width: 48 }} />
                    )}
                </div>
            </header>

            <main className="page">
                {view === "performance" && (
                    <PerformanceView
                        engine={engine}
                        run={run}
                        onSnapshots={() => goTo("snapshots")}
                        onEdit={() => {
                            goTo("edit");
                        }}
                        onEditSnapshot={(snapshotId) => {
                            setSnapshotEditId(snapshotId);
                            goTo("snapshotEdit");
                        }}
                    />
                )}
                {view === "banks" && <BanksView engine={engine} run={run} />}
                {view === "edit" && (
                    <EditorView
                        engine={engine}
                        run={run}
                        lockChain={chainLocked}
                        backRequest={editBackRequest}
                        onPageChange={(page, effectTitle) => {
                            setEditSubpage(page);
                            setEditEffectTitle(effectTitle);
                        }}
                    />
                )}
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
                        saveRequest={snapshotSaveRequest}
                        cancelRequest={snapshotCancelRequest}
                        onComplete={() => {
                            // #region agent log
                            fetch("http://127.0.0.1:7671/ingest/50e56e7c-9d0c-4ac2-8675-d5943d42b03b", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4847b9" }, body: JSON.stringify({ sessionId: "4847b9", location: "App.tsx:snapshotEditComplete", message: "snapshot editor complete", data: { snapshotEditId }, timestamp: Date.now(), hypothesisId: "H5" }) }).catch(() => undefined);
                            // #endregion
                            setSnapshotEditId("");
                            setHistory([]);
                            setView("performance");
                        }}
                    />
                )}
                {view === "library" && (
                    <Tone3000View
                        engine={engine}
                        run={run}
                        pane="catalog"
                        onOpenSettings={() => goTo("tone3000")}
                    />
                )}
                {view === "plugins" && <PluginsView engine={engine} run={run} />}
                {view === "files" && <FilesView engine={engine} run={run} />}
                {view === "settings" && (
                    <SettingsHub onOpen={(page) => goTo(page)} />
                )}
                {view === "theme" && (
                    <ThemeManagerView
                        engine={engine}
                        run={run}
                        persistTheme={async (theme) => {
                            const customThemes = saveCustomMultiFXTheme(theme);
                            await engine.client.request("ui/settings", persistThemeSettings(
                                obj(engine.state.ui),
                                theme.name,
                                customThemes,
                                themeLedColors(theme)
                            ));
                        }}
                    />
                )}
                {view === "layout" && (
                    <LayoutEditorView engine={engine} run={run} onDirtyChange={setLayoutDirty} />
                )}
                {view === "updates" && <UpdatesView engine={engine} run={run} />}
                {(view === "audio" || view === "controller" || view === "ui" || view === "keyboard"
                    || view === "tone3000" || view === "system" || view === "backup"
                    || view === "hotspot") && (
                    <SettingsDetail page={view} engine={engine} run={run} onOpen={(page) => goTo(page)} />
                )}
                {view === "about" && <AboutView state={engine.state} />}
            </main>

            {menuOpen && (
                <>
                    <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                    <nav className="menu" ref={menuRef} data-mfx-shell-menu="true">
                        <div className="menu-brand">
                            <svg className="about-logo" viewBox="0 0 32 32" aria-hidden="true">
                                <path d="M6 22c0-7 4.2-13 10.4-15.4C14 10 13 14.2 13.6 18.2 16 16 19.6 15 23 16.2 20.8 20 16.8 23.2 12 24.2 9.6 24.6 7.6 23.8 6 22z" />
                            </svg>
                            <div>
                                <b>Pi-MFX</b>
                                <span>GUITAR MULTI-FX</span>
                            </div>
                        </div>
                        <MenuButton label="PERFORMANCE" subtitle="Preset and foot-controller view"
                            active={view === "performance"} onClick={openPerformance} />
                        <MenuButton label="BANKS / PRESETS" subtitle="Organize banks and presets"
                            active={view === "banks"} onClick={() => goTo("banks")} />
                        <MenuButton label="PRESET EDITOR" subtitle="Plugins, controls and signal chain"
                            active={view === "edit"} onClick={() => {
                                setEditSubpage("chain");
                                setEditEffectTitle(undefined);
                                goTo("edit");
                            }} />
                        <div className="menu-divider" />
                        <MenuButton label="MODEL LIBRARY" subtitle="TONE3000 NAM, AIDA-X and IR downloads"
                            active={view === "library"} onClick={() => goTo("library")} />
                        <MenuButton label="PLUGINS" subtitle="Installed effects and Raspberry Pi OS / PatchStorage installs"
                            active={view === "plugins"} onClick={() => goTo("plugins")} />
                        <MenuButton label="FILES" subtitle="Browse NAM, AIDA-X and IR folders"
                            active={view === "files"} onClick={() => goTo("files")} />
                        <div className="menu-divider" />
                        <MenuButton label="SETTINGS" subtitle="Controller, theme, PI-MFX UI and system"
                            active={settingsActive} onClick={() => goTo("settings")} />
                        <MenuButton label="ABOUT" subtitle="About Pi-MFX"
                            active={view === "about"} onClick={() => goTo("about")} />
                    </nav>
                </>
            )}

            {visibleToast && (
                <div
                    className="toast"
                    role="status"
                    onClick={() => {
                        setDismissedError(errorText);
                        setToast("");
                    }}
                >
                    {visibleToast}
                </div>
            )}
            {leaveLayout && (
                <ConfirmDialog
                    title="LEAVE LAYOUT?"
                    body="Unsaved arrangement will be lost."
                    confirmLabel="LEAVE"
                    danger
                    onCancel={() => setLeaveLayout(null)}
                    onConfirm={() => {
                        const pending = leaveLayout;
                        setLeaveLayout(null);
                        setLayoutDirty(false);
                        if (pending === "back") {
                            finishBack();
                            return;
                        }
                        navigateTo(pending);
                    }}
                />
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
