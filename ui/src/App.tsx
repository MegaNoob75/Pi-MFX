import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useEngine } from "./api";
import { arr, bool, num, obj, str, type JsonObject } from "./json";
import { applyHardwareNavFocus, handleHardwareNav, watchHardwareNavFocus } from "./hardwareNav";
import { AboutView } from "./views/AboutView";
import { BanksView } from "./views/BanksView";
import { EditorView } from "./views/EditorView";
import { PerformanceView } from "./views/PerformanceView";
import { KeyboardProvider } from "./keyboard/KeyboardProvider";
import { SettingsHub, SettingsPage as SettingsDetail, type SettingsPage } from "./views/SettingsView";
import { updateUiSessionSection } from "./uiSession";
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
import { TransportView } from "./views/TransportView";
import { BackingTracksView } from "./views/BackingTracksView";
import { LooperView } from "./views/LooperView";
import { RecorderView } from "./views/RecorderView";
import { DrumMachineView } from "./views/DrumMachineView";
import { installResponsiveSizing } from "./responsive";
import { MenuIcon, type MenuIconName } from "./theme/MenuIcon";

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
    | "transport"
    | "backingTracks"
    | "looper"
    | "recorder"
    | "drums"
    | "about";

type EditSubpage = "chain" | "controls" | "io";

type MenuId = "performance" | "transport" | "backingTracks" | "looper" | "recorder"
    | "drums" | "banks" | "edit" | "library" | "plugins" | "files" | "settings" | "about";

type MenuEntry = {
    id: MenuId;
    view: View;
    label: string;
    subtitle: string;
    icon: MenuIconName;
    feature?: "transport" | "backing" | "recorder" | "drums";
};

const MENU_ENTRIES: readonly MenuEntry[] = [
    { id: "performance", view: "performance", label: "PERFORMANCE", subtitle: "Preset and foot-controller view", icon: "performance" },
    { id: "transport", view: "transport", label: "TAP TEMPO", subtitle: "Set tempo, metronome and count-in", icon: "transport", feature: "transport" },
    { id: "backingTracks", view: "backingTracks", label: "BACKING TRACKS", subtitle: "Import and play independent tracks", icon: "backingTracks", feature: "backing" },
    { id: "looper", view: "looper", label: "LOOPER", subtitle: "Record and overdub one stereo loop", icon: "looper" },
    { id: "recorder", view: "recorder", label: "RECORDER", subtitle: "Capture and mix multitrack performances", icon: "recorder", feature: "recorder" },
    { id: "drums", view: "drums", label: "DRUM MACHINE", subtitle: "Kits, patterns, fills and song chains", icon: "drums", feature: "drums" },
    { id: "banks", view: "banks", label: "BANKS / PRESETS", subtitle: "Organize banks and presets", icon: "banks" },
    { id: "edit", view: "edit", label: "PRESET EDITOR", subtitle: "Plugins, controls and signal chain", icon: "edit" },
    { id: "library", view: "library", label: "MODEL LIBRARY", subtitle: "TONE3000 NAM, AIDA-X and IR downloads", icon: "library" },
    { id: "plugins", view: "plugins", label: "PLUGINS", subtitle: "Installed effects and Raspberry Pi OS / PatchStorage installs", icon: "plugins" },
    { id: "files", view: "files", label: "FILES", subtitle: "Browse NAM, AIDA-X and IR folders", icon: "files" },
    { id: "settings", view: "settings", label: "SETTINGS", subtitle: "Controller, theme, PI-MFX UI and system", icon: "settings" },
    { id: "about", view: "about", label: "ABOUT", subtitle: "About Pi-MFX", icon: "about" }
] as const;

const MENU_IDS = MENU_ENTRIES.map((entry) => entry.id);
const SHORTCUT_LIMIT = 4;

function sanitizedMenuOrder(value: unknown): MenuId[] {
    const seen = new Set<MenuId>();
    const result: MenuId[] = [];
    for (const item of Array.isArray(value) ? value : []) {
        if (typeof item === "string" && MENU_IDS.includes(item as MenuId) && !seen.has(item as MenuId)) {
            seen.add(item as MenuId);
            result.push(item as MenuId);
        }
    }
    for (const id of MENU_IDS) if (!seen.has(id)) result.push(id);
    return result;
}

function sanitizedShortcuts(value: unknown, excluded: ReadonlySet<MenuId> = new Set()): MenuId[] {
    const result: MenuId[] = [];
    for (const item of Array.isArray(value) ? value : []) {
        if (typeof item !== "string" || !MENU_IDS.includes(item as MenuId)) continue;
        const id = item as MenuId;
        if (!excluded.has(id) && !result.includes(id) && result.length < SHORTCUT_LIMIT) result.push(id);
    }
    return result;
}

type MenuDrag = { id: MenuId; source: "menu" | "left" | "right"; x: number; y: number; originalOrder: MenuId[] };

const titles: Record<string, string> = {
    performance: "PERFORMANCE",
    transport: "TAP TEMPO",
    backingTracks: "BACKING TRACKS",
    looper: "LOOPER",
    recorder: "RECORDER",
    drums: "DRUM MACHINE",
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

const viewNames = new Set<View>([
    "performance", "banks", "edit", "snapshots", "snapshotEdit", "settings", "library",
    "plugins", "files", "transport", "backingTracks", "looper", "recorder", "drums", "audio", "controller", "layout", "theme", "keyboard", "ui",
    "tone3000", "backup", "system", "hotspot", "updates", "about"
]);

function nestedSettingsBackPatch(view: View, settings: JsonObject): JsonObject | null {
    if (view === "controller") {
        if (settings.controllerResetLayout === true) return { controllerResetLayout: false };
        if (settings.controllerPage === "hardware" || settings.controllerPage === "diagnostics") {
            return { controllerPage: "hub" };
        }
    }
    if (view === "system") {
        if (typeof settings.systemConfirm === "string" && settings.systemConfirm) return { systemConfirm: "" };
        if (settings.systemPage === "realtime") return { systemPage: "hub" };
    }
    return null;
}

export function App() {
    const engine = useEngine();
    const [view, setView] = useState<View>("performance");
    const [menuOpen, setMenuOpen] = useState(false);
    const [history, setHistory] = useState<View[]>([]);
    const [toast, setToast] = useState("");
    const [snapshotEditId, setSnapshotEditId] = useState("");
    const [editSubpage, setEditSubpage] = useState<EditSubpage>("chain");
    const [editEffectTitle, setEditEffectTitle] = useState<string>();
    const [editBackRequest, setEditBackRequest] = useState(0);
    const [dismissedError, setDismissedError] = useState("");
    const [snapshotSaveRequest, setSnapshotSaveRequest] = useState(0);
    const [snapshotCancelRequest, setSnapshotCancelRequest] = useState(0);
    const [layoutDirty, setLayoutDirty] = useState(false);
    const [leaveLayout, setLeaveLayout] = useState<{ view: View; fromMenu: boolean } | "back" | null>(null);
    const menuRef = useRef<HTMLElement | null>(null);
    const engineWasConnected = useRef(false);
    const engineRestarted = useRef(false);
    const transportEnabled = bool(engine.state.transportFeatureEnabled);
    const backingEnabled = bool(engine.state.backingTrackFeatureEnabled);
    const recorderEnabled = bool(engine.state.recorderFeatureEnabled);
    const drumsEnabled = bool(engine.state.drumFeatureEnabled);
    const ui = obj(engine.state.ui);
    const [menuEditing, setMenuEditing] = useState(false);
    const [menuOrder, setMenuOrder] = useState<MenuId[]>(() => sanitizedMenuOrder(ui.menuOrder));
    const menuOrderRef = useRef<MenuId[]>(menuOrder);
    const [leftShortcuts, setLeftShortcuts] = useState<MenuId[]>(() => sanitizedShortcuts(obj(ui.shortcuts).left));
    const [rightShortcuts, setRightShortcuts] = useState<MenuId[]>(() => sanitizedShortcuts(
        obj(ui.shortcuts).right,
        new Set(sanitizedShortcuts(obj(ui.shortcuts).left))
    ));
    const [menuDrag, setMenuDrag] = useState<MenuDrag | null>(null);
    const menuDragRef = useRef<MenuDrag | null>(null);
    const navigationSaveRef = useRef(false);
    const menuButtonHoldRef = useRef<{
        timer: number;
        startX: number;
        startY: number;
        triggered: boolean;
    } | null>(null);

    useEffect(() => {
        if (menuDrag || navigationSaveRef.current) return;
        const left = sanitizedShortcuts(obj(ui.shortcuts).left);
        const order = sanitizedMenuOrder(ui.menuOrder);
        menuOrderRef.current = order;
        setMenuOrder(order);
        setLeftShortcuts(left);
        setRightShortcuts(sanitizedShortcuts(obj(ui.shortcuts).right, new Set(left)));
    }, [ui.menuOrder, ui.shortcuts, menuDrag]);

    const saveNavigation = (order: MenuId[], left: MenuId[], right: MenuId[]) => {
        menuOrderRef.current = order;
        setMenuOrder(order);
        setLeftShortcuts(left);
        setRightShortcuts(right);
        navigationSaveRef.current = true;
        void engine.client.request("ui/settings", {
            menuOrder: order,
            shortcuts: { left, right }
        }).catch((error: unknown) => {
            setToast(error instanceof Error ? error.message : String(error));
            const restoredLeft = sanitizedShortcuts(obj(ui.shortcuts).left);
            const restoredOrder = sanitizedMenuOrder(ui.menuOrder);
            menuOrderRef.current = restoredOrder;
            setMenuOrder(restoredOrder);
            setLeftShortcuts(restoredLeft);
            setRightShortcuts(sanitizedShortcuts(obj(ui.shortcuts).right, new Set(restoredLeft)));
        }).finally(() => {
            navigationSaveRef.current = false;
        });
    };

    useEffect(() => {
        if (!transportEnabled && view === "transport") {
            setView("performance");
            setHistory([]);
            engine.client.updateUiSession({ view: "performance", viewHistory: [] });
        }
    }, [transportEnabled, view, engine.client]);
    useEffect(() => { if (!backingEnabled && view === "backingTracks") { setView("performance"); setHistory([]); } }, [backingEnabled, view]);
    useEffect(() => { if (!recorderEnabled && view === "recorder") { setView("performance"); setHistory([]); } }, [recorderEnabled, view]);
    useEffect(() => { if (!drumsEnabled && view === "drums") { setView("performance"); setHistory([]); } }, [drumsEnabled, view]);

    useEffect(() => {
        if (!engine.connected) {
            if (engineWasConnected.current) {
                engineRestarted.current = true;
            }
            return;
        }
        engineWasConnected.current = true;
        if (!engineRestarted.current) {
            return;
        }
        const bundledCommit = import.meta.env.VITE_PIMFX_GIT_SHA || "";
        const runningCommit = str(engine.state.gitSha);
        if (!bundledCommit || !runningCommit || bundledCommit === runningCommit) {
            return;
        }
        const timer = window.setTimeout(() => window.location.reload(), 500);
        return () => window.clearTimeout(timer);
    }, [engine.connected, engine.state.gitSha]);

    useEffect(() => {
        const shared = engine.uiSession;
        const sharedView = str(shared.view) as View;
        if (viewNames.has(sharedView) && sharedView !== view) {
            setView(sharedView);
        }
        const sharedMenuOpen = bool(shared.menuOpen);
        if (sharedMenuOpen !== menuOpen) {
            setMenuOpen(sharedMenuOpen);
        }
        const sharedSnapshotId = str(shared.snapshotEditId);
        if (sharedSnapshotId !== snapshotEditId) {
            setSnapshotEditId(sharedSnapshotId);
        }
        const sharedSubpage = str(shared.editSubpage) as EditSubpage;
        if (["chain", "controls", "io"].includes(sharedSubpage) && sharedSubpage !== editSubpage) {
            setEditSubpage(sharedSubpage);
        }
        const sharedHistory = arr(shared.viewHistory)
            .filter((item): item is View => typeof item === "string" && viewNames.has(item as View));
        if (JSON.stringify(sharedHistory) !== JSON.stringify(history)) {
            setHistory(sharedHistory);
        }
    }, [engine.uiSession]);

    useEffect(() => installResponsiveSizing(), []);

    useEffect(() => watchHardwareNavFocus(
        () => engine.client.claimUiNavigation(),
        (navFocus) => engine.client.updateUiSession({ navFocus })
    ), [engine.client]);
    useEffect(() => engine.client.subscribeUiNav(handleHardwareNav), [engine.client]);
    useEffect(() => {
        const frame = window.requestAnimationFrame(() => applyHardwareNavFocus(engine.uiSession.navFocus));
        return () => window.cancelAnimationFrame(frame);
    }, [engine.uiSession.navFocus, engine.uiSession.performancePicker, view, menuOpen]);

    useEffect(() => {
        let publishFrame = 0;
        let pendingKey = "";
        let pendingRatio = 0;
        const onScroll = (event: Event) => {
            const element = event.target instanceof HTMLElement ? event.target : null;
            const key = element?.dataset.mfxSyncScroll;
            if (!element || !key || element.dataset.mfxApplyingScroll === "1") {
                return;
            }
            const range = element.scrollHeight - element.clientHeight;
            pendingKey = key;
            pendingRatio = range > 0 ? element.scrollTop / range : 0;
            if (publishFrame) {
                return;
            }
            publishFrame = window.requestAnimationFrame(() => {
                publishFrame = 0;
                updateUiSessionSection(engine.client, "scrolls", { [pendingKey]: pendingRatio });
            });
        };
        document.addEventListener("scroll", onScroll, true);
        return () => {
            document.removeEventListener("scroll", onScroll, true);
            if (publishFrame) {
                window.cancelAnimationFrame(publishFrame);
            }
        };
    }, [engine.client]);

    useEffect(() => {
        const shared = obj(engine.uiSession.scrolls);
        const frame = window.requestAnimationFrame(() => {
            document.querySelectorAll<HTMLElement>("[data-mfx-sync-scroll]").forEach((element) => {
                const key = element.dataset.mfxSyncScroll ?? "";
                const value = shared[key];
                if (typeof value !== "number" || !Number.isFinite(value)) {
                    return;
                }
                const range = element.scrollHeight - element.clientHeight;
                const next = Math.max(0, Math.min(range, value * range));
                if (Math.abs(element.scrollTop - next) < 1) {
                    return;
                }
                element.dataset.mfxApplyingScroll = "1";
                element.scrollTop = next;
                window.requestAnimationFrame(() => delete element.dataset.mfxApplyingScroll);
            });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [engine.uiSession.scrolls, view]);

    const settingsPages: SettingsPage[] = [
        "audio", "controller", "layout", "theme", "keyboard", "ui", "tone3000", "backup", "system", "hotspot", "updates"
    ];
    const settingsActive = view === "settings" || settingsPages.includes(view as SettingsPage);
    const snapshotMode = bool(engine.state.snapshotMode);
    const chainLocked = snapshotMode || num(engine.state.activeSnapshot, -1) >= 0;

    const navigateTo = (next: View, fromMenu = false) => {
        setMenuOpen(false);
        if (next === view) {
            engine.client.updateUiSession({ menuOpen: false });
            return;
        }
        const nextHistory = fromMenu
            ? (next === "performance" ? [] : ["performance" as View])
            : [...history, view];
        if (next === "edit") {
            setEditSubpage("chain");
            setEditEffectTitle(undefined);
        }
        setHistory(nextHistory);
        setView(next);
        engine.client.updateUiSession({
            view: next,
            menuOpen: false,
            viewHistory: nextHistory,
            ...(next === "edit" ? { editSubpage: "chain" } : {})
        });
    };

    const goTo = (next: View, fromMenu = false) => {
        setMenuOpen(false);
        if (next === view) {
            // Close the shared menu as well, otherwise the next focus update
            // republishes menuOpen:true and opens it again.
            const nextHistory = fromMenu
                ? (next === "performance" ? [] : ["performance" as View])
                : history;
            if (fromMenu) setHistory(nextHistory);
            engine.client.updateUiSession({ menuOpen: false, ...(fromMenu ? { viewHistory: nextHistory } : {}) });
            return;
        }
        if (view === "layout" && layoutDirty && next !== "layout") {
            setLeaveLayout({ view: next, fromMenu });
            return;
        }
        if (view === "edit" && next !== "edit") {
            void engine.client.request("preset/save").catch(() => undefined).finally(() => {
                navigateTo(next, fromMenu);
            });
            return;
        }
        navigateTo(next, fromMenu);
    };

    const openMenuView = (next: View) => goTo(next, true);

    useEffect(() => engine.client.subscribeUiView((message) => {
        if (str(message.view) === "backingTracks" && backingEnabled) goTo("backingTracks");
        if (str(message.view) === "looper") goTo("looper");
        if (str(message.view) === "recorder" && recorderEnabled) goTo("recorder");
        if (str(message.view) === "drums" && drumsEnabled) goTo("drums");
    }), [engine.client, backingEnabled, recorderEnabled, drumsEnabled, view]);

    const finishBack = () => {
        setHistory((stack) => {
            const previous = stack[stack.length - 1];
            const nextView = previous ?? "performance";
            const nextHistory = stack.slice(0, -1);
            setView(nextView);
            engine.client.updateUiSession({
                view: nextView,
                menuOpen: false,
                viewHistory: nextHistory
            });
            return nextHistory;
        });
    };

    const goBack = () => {
        setMenuOpen(false);
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
        const settingsSession = obj(engine.uiSession.settings);
        const nestedBackPatch = nestedSettingsBackPatch(view, settingsSession);
        if (nestedBackPatch) {
            updateUiSessionSection(engine.client, "settings", nestedBackPatch);
            return;
        }
        if (view === "controller") {
            updateUiSessionSection(engine.client, "settings", {
                controllerPage: "hub",
                controllerResetLayout: false
            });
        }
        finishBack();
    };

    const openPerformance = () => {
        setMenuOpen(false);
        if (snapshotMode) {
            void engine.client.request("snapshot/mode", { enabled: false }).catch(() => undefined);
        }
        if (view !== "performance") {
            goTo("performance", true);
        } else {
            setHistory([]);
            engine.client.updateUiSession({ menuOpen: false, viewHistory: [] });
        }
    };

    const clearMenuButtonHold = () => {
        const hold = menuButtonHoldRef.current;
        if (hold) window.clearTimeout(hold.timer);
    };

    const beginMenuButtonHold = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        clearMenuButtonHold();
        const hold = {
            timer: 0,
            startX: event.clientX,
            startY: event.clientY,
            triggered: false
        };
        hold.timer = window.setTimeout(() => {
            hold.triggered = true;
            openPerformance();
        }, 500);
        menuButtonHoldRef.current = hold;
    };

    const moveMenuButtonHold = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const hold = menuButtonHoldRef.current;
        if (!hold || hold.triggered) return;
        if (Math.hypot(event.clientX - hold.startX, event.clientY - hold.startY) > 10) {
            window.clearTimeout(hold.timer);
            menuButtonHoldRef.current = null;
        }
    };

    const endMenuButtonHold = () => {
        clearMenuButtonHold();
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

    const featureAvailable = (entry: MenuEntry) => !entry.feature
        || (entry.feature === "transport" && transportEnabled)
        || (entry.feature === "backing" && backingEnabled)
        || (entry.feature === "recorder" && recorderEnabled)
        || (entry.feature === "drums" && drumsEnabled);
    const entryById = (id: MenuId) => MENU_ENTRIES.find((entry) => entry.id === id)!;
    const orderedEntries = menuOrder.map(entryById).filter(featureAvailable);

    const openEntry = (entry: MenuEntry) => {
        if (menuEditing) return;
        if (entry.id === "performance") {
            openPerformance();
            return;
        }
        if (entry.id === "edit") {
            setEditSubpage("chain");
            setEditEffectTitle(undefined);
        }
        openMenuView(entry.view);
    };

    const finishMenuDrop = (drag: MenuDrag, target: Element | null) => {
        const menuTarget = target?.closest<HTMLElement>("[data-menu-id]")?.dataset.menuId as MenuId | undefined;
        const zone = target?.closest<HTMLElement>("[data-shortcut-zone]")?.dataset.shortcutZone as "left" | "right" | undefined;
        const shortcutTarget = target?.closest<HTMLElement>("[data-shortcut-id]")?.dataset.shortcutId as MenuId | undefined;
        let nextOrder = [...menuOrderRef.current];
        let nextLeft = leftShortcuts.filter((id) => id !== drag.id);
        let nextRight = rightShortcuts.filter((id) => id !== drag.id);

        if (menuTarget) {
            saveNavigation(nextOrder, nextLeft, nextRight);
            return;
        }
        if (!zone) {
            menuOrderRef.current = drag.originalOrder;
            setMenuOrder(drag.originalOrder);
            return;
        }
        const originalDestination = zone === "left" ? leftShortcuts : rightShortcuts;
        const destination = zone === "left" ? nextLeft : nextRight;
        if (destination.length >= SHORTCUT_LIMIT && !destination.includes(drag.id)) {
            setToast(`The ${zone} shortcut area already has four icons.`);
            return;
        }
        let index = shortcutTarget ? destination.indexOf(shortcutTarget) : destination.length;
        if (shortcutTarget === drag.id && drag.source === zone) {
            index = originalDestination.indexOf(drag.id);
        } else if (shortcutTarget && drag.source === zone) {
            const sourceIndex = originalDestination.indexOf(drag.id);
            const targetIndex = originalDestination.indexOf(shortcutTarget);
            if (sourceIndex >= 0 && targetIndex > sourceIndex) index += 1;
        }
        destination.splice(index < 0 ? destination.length : index, 0, drag.id);
        if (zone === "left") nextLeft = destination.slice(0, SHORTCUT_LIMIT);
        else nextRight = destination.slice(0, SHORTCUT_LIMIT);
        saveNavigation(nextOrder, nextLeft, nextRight);
    };

    const beginMenuDrag = (event: ReactPointerEvent, id: MenuId, source: MenuDrag["source"]) => {
        if (!menuEditing) return;
        event.preventDefault();
        event.stopPropagation();
        const drag: MenuDrag = { id, source, x: event.clientX, y: event.clientY, originalOrder: [...menuOrder] };
        menuDragRef.current = drag;
        setMenuDrag(drag);
        const move = (next: PointerEvent) => {
            if (!menuDragRef.current) return;
            const updated = { ...menuDragRef.current, x: next.clientX, y: next.clientY };
            menuDragRef.current = updated;
            setMenuDrag(updated);
            if (updated.source === "menu") {
                const menu = menuRef.current;
                const bounds = menu?.getBoundingClientRect();
                const insideMenu = Boolean(bounds
                    && next.clientX >= bounds.left && next.clientX <= bounds.right
                    && next.clientY >= bounds.top && next.clientY <= bounds.bottom);
                if (!insideMenu) {
                    if (JSON.stringify(menuOrderRef.current) !== JSON.stringify(updated.originalOrder)) {
                        menuOrderRef.current = [...updated.originalOrder];
                        setMenuOrder([...updated.originalOrder]);
                    }
                } else {
                    const rows = Array.from(menu?.querySelectorAll<HTMLElement>("[data-menu-id]") ?? [])
                    .filter((row) => row.dataset.menuId !== updated.id);
                    const over = rows.find((row) => {
                        const rect = row.getBoundingClientRect();
                        return next.clientY < rect.top + rect.height / 2;
                    });
                    const targetId = over?.dataset.menuId as MenuId | undefined;
                    const reordered = menuOrderRef.current.filter((item) => item !== updated.id);
                    const targetIndex = targetId ? reordered.indexOf(targetId) : reordered.length;
                    reordered.splice(targetIndex < 0 ? reordered.length : targetIndex, 0, updated.id);
                    if (JSON.stringify(reordered) !== JSON.stringify(menuOrderRef.current)) {
                        menuOrderRef.current = reordered;
                        setMenuOrder(reordered);
                    }
                }
            }
            const menu = menuRef.current;
            if (menu) {
                const bounds = menu.getBoundingClientRect();
                if (next.clientY < bounds.top + 48) menu.scrollTop -= 14;
                else if (next.clientY > bounds.bottom - 48) menu.scrollTop += 14;
            }
        };
        const up = (next: PointerEvent) => {
            const finished = menuDragRef.current;
            menuDragRef.current = null;
            setMenuDrag(null);
            window.removeEventListener("pointermove", move, true);
            window.removeEventListener("pointerup", up, true);
            window.removeEventListener("pointercancel", cancel, true);
            if (finished) finishMenuDrop(finished, document.elementFromPoint(next.clientX, next.clientY));
        };
        const cancel = () => {
            const cancelled = menuDragRef.current;
            menuDragRef.current = null;
            setMenuDrag(null);
            if (cancelled) {
                menuOrderRef.current = cancelled.originalOrder;
                setMenuOrder(cancelled.originalOrder);
            }
            window.removeEventListener("pointermove", move, true);
            window.removeEventListener("pointerup", up, true);
            window.removeEventListener("pointercancel", cancel, true);
        };
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", up, true);
        window.addEventListener("pointercancel", cancel, true);
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
                engine.client.updateUiSession({ menuOpen: false });
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
    }, [menuOpen, engine.client]);

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
    const shellBackVisible = view !== "performance" || snapshotMode;
    const controllerState = obj(engine.state.controller);
    const controllerFirmwareVersion = str(controllerState.firmwareVersion);
    const requiredControllerFirmware = str(controllerState.requiredFirmwareVersion);
    const showFirmwareWarning = bool(controllerState.connected) && bool(controllerState.firmwareUpdateRequired)
        && str(engine.uiSession.dismissedFirmwareWarning) !== controllerFirmwareVersion;

    return (
        <div className={`app mfx-app-root${menuEditing && menuOpen ? " menu-editing" : ""}`}>
            <ThemeRoot ui={ui} />
            <header className="shell">
                <button type="button" className="btn-mfx"
                    onPointerDown={beginMenuButtonHold}
                    onPointerMove={moveMenuButtonHold}
                    onPointerUp={endMenuButtonHold}
                    onPointerCancel={endMenuButtonHold}
                    onContextMenu={(event) => event.preventDefault()}
                    onClick={() => {
                    const hold = menuButtonHoldRef.current;
                    menuButtonHoldRef.current = null;
                    if (hold?.triggered) return;
                    if (view === "snapshotEdit") {
                        return;
                    }
                    setMenuOpen((open) => {
                        const next = !open;
                        engine.client.updateUiSession({ menuOpen: next });
                        return next;
                    });
                }}>
                    PI-MFX
                </button>
                <ShortcutTray side="left" ids={leftShortcuts.filter((id) => featureAvailable(entryById(id)))} entries={MENU_ENTRIES}
                    activeView={view} settingsActive={settingsActive} editing={menuEditing} draggingId={menuDrag?.id}
                    onOpen={openEntry} onDragStart={beginMenuDrag} />
                <div className="shell-mid">
                    <div />
                    <div className="shell-title-stack">
                        <span className={`status-bar${engine.connected && audioRunning ? " on" : ""}`} title={
                            engine.connected
                                ? audioRunning ? "engine connected, audio running" : "engine connected"
                                : "engine disconnected"
                        } />
                        <div className="shell-title"><MarqueeText text={title} align="center" fontWeight={900} /></div>
                    </div>
                    <div />
                </div>
                <ShortcutTray side="right" ids={rightShortcuts.filter((id) => featureAvailable(entryById(id)))} entries={MENU_ENTRIES}
                    activeView={view} settingsActive={settingsActive} editing={menuEditing} draggingId={menuDrag?.id}
                    onOpen={openEntry} onDragStart={beginMenuDrag} />
                <div className="shell-actions">
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
                        <button type="button" className="btn-mfx btn-back" onClick={goBack}>←</button>
                    ) : (
                        <div style={{ width: 48 }} />
                    )}
                </div>
            </header>

            {showFirmwareWarning && (
                <div className="controller-firmware-alert" role="alert">
                    <strong>CONTROLLER FIRMWARE {controllerFirmwareVersion} IS OUTDATED</strong>
                    <span>Flash version {requiredControllerFirmware} for the controller to function properly.</span>
                    <button type="button" className="btn" aria-label="Dismiss firmware warning" onClick={() => {
                        engine.client.updateUiSession({ dismissedFirmwareWarning: controllerFirmwareVersion });
                    }}>×</button>
                </div>
            )}

            <main className="page">
                {view === "performance" && (
                    <PerformanceView
                        engine={engine}
                        run={run}
                        onSnapshots={() => goTo("snapshots")}
                        onEdit={() => {
                            goTo("edit");
                        }}
                        onOpenView={(next) => goTo(next)}
                        onEditSnapshot={(snapshotId) => {
                            setSnapshotEditId(snapshotId);
                            engine.client.updateUiSession({ snapshotEditId: snapshotId });
                            goTo("snapshotEdit");
                        }}
                    />
                )}
                {view === "transport" && transportEnabled && <TransportView engine={engine} run={run} />}
                {view === "backingTracks" && backingEnabled && <BackingTracksView engine={engine} run={run} />}
                {view === "looper" && <LooperView engine={engine} run={run} />}
                {view === "recorder" && recorderEnabled && <RecorderView engine={engine} run={run} />}
                {view === "drums" && drumsEnabled && <DrumMachineView engine={engine} run={run} />}
                {view === "banks" && <BanksView engine={engine} run={run} />}
                {view === "edit" && (
                    <EditorView
                        engine={engine}
                        run={run}
                        lockChain={chainLocked}
                        backRequest={editBackRequest}
                        onSnapshots={() => goTo("snapshots")}
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
                            engine.client.updateUiSession({ snapshotEditId: snapshotId });
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
                            setSnapshotEditId("");
                            setHistory([]);
                            setView("performance");
                            engine.client.updateUiSession({
                                view: "performance",
                                snapshotEditId: "",
                                viewHistory: []
                            });
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
                    <div className="menu-backdrop" onClick={() => {
                        setMenuOpen(false);
                        engine.client.updateUiSession({ menuOpen: false });
                    }} />
                    <nav className="menu" ref={menuRef} data-mfx-shell-menu="true">
                        <div className="menu-brand">
                            <svg className="about-logo" viewBox="0 0 32 32" aria-hidden="true">
                                <path d="M6 22c0-7 4.2-13 10.4-15.4C14 10 13 14.2 13.6 18.2 16 16 19.6 15 23 16.2 20.8 20 16.8 23.2 12 24.2 9.6 24.6 7.6 23.8 6 22z" />
                            </svg>
                            <div>
                                <b>Pi-MFX</b>
                                <span>GUITAR MULTI-FX</span>
                            </div>
                            <button type="button" className={`menu-edit-toggle${menuEditing ? " active" : ""}`}
                                aria-label={menuEditing ? "Lock menu order" : "Unlock menu order"}
                                aria-pressed={menuEditing}
                                onClick={() => setMenuEditing((value) => !value)}>
                                <MenuIcon name="reorder" />
                            </button>
                        </div>
                        {menuEditing && <div className="menu-edit-hint">DRAG HANDLES TO REORDER OR DROP INTO A SHORTCUT AREA</div>}
                        {orderedEntries.map((entry) => (
                            <MenuButton key={entry.id} entry={entry}
                                active={entry.id === "settings" ? settingsActive : view === entry.view}
                                editing={menuEditing} dragging={menuDrag?.id === entry.id}
                                onClick={() => openEntry(entry)}
                                onDragStart={(event) => beginMenuDrag(event, entry.id, "menu")} />
                        ))}
                    </nav>
                </>
            )}

            {menuDrag && (
                <div className={`menu-drag-ghost${menuDrag.source === "menu" ? "" : " shortcut-drag-ghost"}`}
                    style={{ left: menuDrag.x + 12, top: menuDrag.y + 12 }}>
                    <MenuIcon name={entryById(menuDrag.id).icon} />
                    <span>{entryById(menuDrag.id).label}</span>
                </div>
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
                        navigateTo(pending.view, pending.fromMenu);
                    }}
                />
            )}
            <KeyboardProvider />
        </div>
    );
}

function MenuButton({
    entry,
    active,
    editing,
    dragging,
    onClick,
    onDragStart
}: {
    entry: MenuEntry;
    active: boolean;
    editing: boolean;
    dragging: boolean;
    onClick: () => void;
    onDragStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
    return (
        <div className={`menu-item-wrap${dragging ? " dragging" : ""}`} data-menu-id={entry.id}>
            <button type="button" className="menu-item" aria-current={active ? "page" : undefined}
                aria-disabled={editing || undefined} onClick={onClick}>
                <MenuIcon name={entry.icon} className="menu-item-icon" />
                <span className="menu-item-copy">{entry.label}<small>{entry.subtitle}</small></span>
            </button>
            {editing && (
                <button type="button" className="menu-drag-handle" aria-label={`Move ${entry.label}`}
                    onPointerDown={onDragStart}>
                    <MenuIcon name="drag" />
                </button>
            )}
        </div>
    );
}

function ShortcutTray({
    side,
    ids,
    entries,
    activeView,
    settingsActive,
    editing,
    draggingId,
    onOpen,
    onDragStart
}: {
    side: "left" | "right";
    ids: MenuId[];
    entries: readonly MenuEntry[];
    activeView: View;
    settingsActive: boolean;
    editing: boolean;
    draggingId?: MenuId;
    onOpen: (entry: MenuEntry) => void;
    onDragStart: (event: ReactPointerEvent, id: MenuId, source: "left" | "right") => void;
}) {
    return (
        <div className={`shortcut-tray shortcut-tray-${side}${editing ? " editing" : ""}`}
            data-shortcut-zone={side} aria-label={`${side} shortcuts`}>
            {ids.map((id) => {
                const entry = entries.find((candidate) => candidate.id === id);
                if (!entry) return null;
                const active = activeView === entry.view || (entry.id === "settings" && settingsActive);
                return (
                    <button key={id} type="button"
                        className={`shortcut-button${active ? " active" : ""}${draggingId === id ? " dragging" : ""}`}
                        data-shortcut-id={id} aria-label={entry.label} title={entry.label}
                        aria-current={active ? "page" : undefined}
                        onPointerDown={editing ? (event) => onDragStart(event, id, side) : undefined}
                        onClick={() => onOpen(entry)}>
                        <MenuIcon name={entry.icon} />
                    </button>
                );
            })}
            {editing && ids.length < SHORTCUT_LIMIT && (
                <span className="shortcut-empty">{ids.length === 0 ? "DROP SHORTCUTS" : "+"}</span>
            )}
        </div>
    );
}
