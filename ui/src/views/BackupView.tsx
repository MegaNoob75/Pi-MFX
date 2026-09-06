import type { EngineSnapshot } from "../api";
import { obj, type JsonObject } from "../json";
import { loadCustomMultiFXThemes, loadMultiFXTheme } from "../theme/theme";
import { loadCustomMultiFXKeyboardThemes } from "../keyboard/keyboardTheme";
import { loadKeyboardMode, saveKeyboardMode } from "../keyboard/mode";
import { loadKeyboardAppearance, saveKeyboardAppearance } from "../keyboard/settings";
import { loadUiBehavior, saveUiBehavior } from "../uiBehavior";

export function BackupView({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const download = () => {
        const payload = {
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
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "pimfx-backup.json";
        link.click();
        URL.revokeObjectURL(url);
    };

    const restore = (file: File) => {
        void file.text().then((text) => {
            const parsed = JSON.parse(text) as JsonObject;
            if (parsed.format !== "pimfx-ui-backup") {
                throw new Error("that is not a Pi-MFX backup");
            }
            void run(async () => {
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
            });
        }).catch((error: unknown) => {
            window.alert(error instanceof Error ? error.message : String(error));
        });
    };

    return (
        <div className="page-scroll stack">
            <div className="panel stack">
                <h2>BACKUP</h2>
                <div className="muted">
                    Download themes, layout, controller wiring and UI settings. Banks stay
                    in the Banks screen (export a bank there). Restoring does not touch
                    your audio device or your presets unless you imported a bank.
                </div>
                <div className="row">
                    <button type="button" className="btn btn-accent" onClick={download}>DOWNLOAD BACKUP</button>
                    <label className="btn">
                        RESTORE
                        <input type="file" accept="application/json" hidden onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) {
                                restore(file);
                            }
                            event.target.value = "";
                        }} />
                    </label>
                </div>
            </div>
        </div>
    );
}
