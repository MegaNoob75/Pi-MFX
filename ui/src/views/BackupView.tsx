import { useEffect, useState } from "react";
import type { EngineSnapshot } from "../api";
import { obj, str, type JsonObject } from "../json";
import { updateUiSessionSection } from "../uiSession";
import { CUSTOM_THEMES_STORAGE_KEY, loadCustomMultiFXThemes, loadMultiFXTheme, saveMultiFXTheme, validateMultiFXTheme } from "../theme/theme";
import { CUSTOM_KEYBOARD_THEMES_STORAGE_KEY, loadCustomMultiFXKeyboardThemes, validateMultiFXKeyboardTheme } from "../keyboard/keyboardTheme";
import { loadKeyboardMode, saveKeyboardMode } from "../keyboard/mode";
import { loadKeyboardAppearance, saveKeyboardAppearance } from "../keyboard/settings";
import { loadUiBehavior, saveUiBehavior } from "../uiBehavior";
import { LibraryJsonPicker } from "./LibraryManager";

export function BackupView({
    engine,
    run,
    embedded = false
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    embedded?: boolean;
}) {
    const [picker, setPicker] = useState<"load" | "save" | null>(null);
    const [pendingRestore, setPendingRestore] = useState<JsonObject | null>(null);

    useEffect(() => {
        const sharedPicker = str(obj(engine.uiSession.backup).picker);
        setPicker(sharedPicker === "load" || sharedPicker === "save" ? sharedPicker : null);
    }, [engine.uiSession.backup]);

    const showPicker = (next: "load" | "save" | null) => {
        setPicker(next);
        updateUiSessionSection(engine.client, "backup", { picker: next ?? "" });
    };

    const backupPayload = () => JSON.stringify({
        format: "pimfx-ui-backup",
        version: 1,
        ui: obj(engine.state.ui),
        controller: obj(engine.state.controller),
        system: obj(engine.state.system),
        keyboardMode: loadKeyboardMode(),
        keyboardAppearance: loadKeyboardAppearance(),
        uiBehavior: loadUiBehavior(),
        localTheme: loadMultiFXTheme(),
        customThemes: loadCustomMultiFXThemes(),
        keyboardThemes: loadCustomMultiFXKeyboardThemes()
    }, null, 2);

    const applyBackup = async (parsed: JsonObject, restoreThemes: boolean) => {
        if (parsed.format !== "pimfx-ui-backup") {
            throw new Error("that is not a Pi-MFX backup");
        }
        if (parsed.ui) {
            await engine.client.request("ui/settings", obj(parsed.ui));
        }
        if (parsed.controller) {
            await engine.client.request("controller/config", obj(parsed.controller));
        }
        if (parsed.system) {
            await engine.client.request("system/settings", obj(parsed.system));
        }
        if (typeof parsed.keyboardMode === "string") {
            saveKeyboardMode(parsed.keyboardMode as "auto" | "on" | "off");
        }
        if (parsed.keyboardAppearance && typeof parsed.keyboardAppearance === "object") {
            saveKeyboardAppearance({
                ...loadKeyboardAppearance(),
                ...(parsed.keyboardAppearance as object)
            } as ReturnType<typeof loadKeyboardAppearance>);
        }
        if (parsed.uiBehavior && typeof parsed.uiBehavior === "object") {
            saveUiBehavior({
                ...loadUiBehavior(),
                ...(parsed.uiBehavior as object)
            } as ReturnType<typeof loadUiBehavior>);
        }
        if (restoreThemes) {
            const active = validateMultiFXTheme(parsed.localTheme);
            if (active) {
                saveMultiFXTheme(active);
            }
            if (Array.isArray(parsed.customThemes)) {
                const restored = parsed.customThemes
                    .map((theme) => validateMultiFXTheme(theme))
                    .filter((theme): theme is NonNullable<typeof theme> => Boolean(theme));
                window.localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(restored, null, 2));
            }
            if (Array.isArray(parsed.keyboardThemes)) {
                const restored = parsed.keyboardThemes
                    .map((theme) => validateMultiFXKeyboardTheme(theme))
                    .filter((theme): theme is NonNullable<typeof theme> => Boolean(theme));
                window.localStorage.setItem(CUSTOM_KEYBOARD_THEMES_STORAGE_KEY, JSON.stringify(restored, null, 2));
            }
        }
    };

    return (
        <div className={embedded ? "stack" : "page-scroll stack"} {...(!embedded ? { "data-mfx-sync-scroll": "settings-backup" } : {})}>
            <div className="panel stack">
                <h2>BACKUP / RESTORE</h2>
                <div className="muted">
                    Save or restore Pi-MFX configuration, including Performance preset
                    assignments and controller layout. Banks stay on the Banks screen.
                    Restoring does not change your audio device unless you imported a bank.
                </div>
                <div className="row" style={{ flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-accent" onClick={() => showPicker("save")}>SAVE BACKUP</button>
                    <button type="button" className="btn" onClick={() => showPicker("load")}>LOAD</button>
                    <label className="btn">
                        UPLOAD
                        <input type="file" accept="application/json" hidden onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (!file) {
                                return;
                            }
                            void file.text().then((text) => {
                                const parsed = JSON.parse(text) as JsonObject;
                                setPendingRestore(parsed);
                            }).catch((error: unknown) => {
                                window.alert(error instanceof Error ? error.message : String(error));
                            });
                        }} />
                    </label>
                </div>
            </div>
            {picker && (
                <LibraryJsonPicker
                    engine={engine}
                    run={run}
                    kind="backup"
                    mode={picker}
                    title={picker === "save" ? "SAVE BACKUP" : "LOAD BACKUP"}
                    defaultName="pimfx-backup"
                    contents={picker === "save" ? backupPayload() : undefined}
                    onClose={() => showPicker(null)}
                    onLoad={(parsed) => setPendingRestore(parsed)}
                />
            )}
            {pendingRestore && (
                <div className="mfx-overlay">
                    <div className="mfx-overlay-card">
                        <div className="mfx-overlay-title danger">RESTORE BACKUP?</div>
                        <div className="muted">
                            This replaces UI, controller, and system settings on this Pi.
                            Restore saved themes as well?
                        </div>
                        <div className="row" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
                            <button type="button" className="btn" onClick={() => setPendingRestore(null)}>CANCEL</button>
                            <button type="button" className="btn" onClick={() => {
                                const parsed = pendingRestore;
                                setPendingRestore(null);
                                void run(() => applyBackup(parsed, false));
                            }}>SKIP THEMES</button>
                            <button type="button" className="btn btn-accent" onClick={() => {
                                const parsed = pendingRestore;
                                setPendingRestore(null);
                                void run(() => applyBackup(parsed, true));
                            }}>RESTORE ALL</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
