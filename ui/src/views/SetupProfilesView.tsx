import { useState } from "react";
import type { EngineSnapshot } from "../api";
import { bool, num, obj, str, type JsonObject } from "../json";
import { loadKeyboardMode, saveKeyboardMode } from "../keyboard/mode";
import { loadKeyboardAppearance, saveKeyboardAppearance } from "../keyboard/settings";
import { loadUiBehavior, saveUiBehavior } from "../uiBehavior";
import { LibraryJsonPicker } from "./LibraryManager";
import { ConfirmDialog } from "./ConfirmDialog";

export function SetupProfilesView({ engine, run }: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const [picker, setPicker] = useState<"load" | "save" | null>(null);
    const [pending, setPending] = useState<JsonObject | null>(null);
    const state = engine.state;

    const controllerSnapshot = () => {
        const controller = { ...obj(state.controller) };
        for (const key of ["connected", "activePort", "learning", "learningControlId", "firmwareVersion",
            "requiredFirmwareVersion", "firmwareUpdateRequired"]) delete controller[key];
        return controller;
    };

    const contents = () => JSON.stringify({
        format: "pimfx-setup-profile",
        version: 1,
        audio: obj(state.audio),
        ui: obj(state.ui),
        controller: controllerSnapshot(),
        system: obj(state.system),
        transport: obj(state.transportSettings),
        looper: {
            quantization: str(engine.looper.quantization, "free"),
            countIn: bool(engine.looper.countIn),
            level: num(engine.looper.level, 1),
            feedback: num(engine.looper.feedback, 1)
        },
        keyboardMode: loadKeyboardMode(),
        keyboardAppearance: loadKeyboardAppearance(),
        uiBehavior: loadUiBehavior()
    }, null, 2);

    const accept = (profile: JsonObject) => {
        if (str(profile.format) !== "pimfx-setup-profile" || num(profile.version) !== 1) {
            window.alert("That is not a Pi-MFX setup profile.");
            return;
        }
        setPending(profile);
    };

    const apply = () => {
        const profile = pending;
        setPending(null);
        if (!profile) return;
        void run(async () => {
            const before = {
                controller: controllerSnapshot(), ui: obj(state.ui), system: obj(state.system),
                transport: obj(state.transportSettings), audio: obj(state.audio),
                looper: {
                    quantization: str(engine.looper.quantization, "free"), countIn: bool(engine.looper.countIn),
                    level: num(engine.looper.level, 1), feedback: num(engine.looper.feedback, 1)
                },
                keyboardMode: loadKeyboardMode(), keyboardAppearance: loadKeyboardAppearance(), uiBehavior: loadUiBehavior()
            };
            try {
                await engine.client.request("controller/config", obj(profile.controller));
                await engine.client.request("ui/settings", obj(profile.ui));
                await engine.client.request("system/settings", obj(profile.system));
                if (profile.transport) await engine.client.request("transport/settings", obj(profile.transport));
                if (profile.looper) await engine.client.request("looper/settings", obj(profile.looper));
                if (typeof profile.keyboardMode === "string") saveKeyboardMode(profile.keyboardMode as "auto" | "on" | "off");
                if (profile.keyboardAppearance && typeof profile.keyboardAppearance === "object") {
                    saveKeyboardAppearance({ ...loadKeyboardAppearance(), ...(profile.keyboardAppearance as object) });
                }
                if (profile.uiBehavior && typeof profile.uiBehavior === "object") {
                    saveUiBehavior({ ...loadUiBehavior(), ...(profile.uiBehavior as object) });
                }
                // Audio is last because applying a different device can restart the stream.
                await engine.client.request("audio/settings", obj(profile.audio));
            } catch (caught) {
                // Restore the complete prior setup so a failed section never leaves a half-loaded rig.
                await engine.client.request("controller/config", before.controller).catch(() => undefined);
                await engine.client.request("ui/settings", before.ui).catch(() => undefined);
                await engine.client.request("system/settings", before.system).catch(() => undefined);
                await engine.client.request("transport/settings", before.transport).catch(() => undefined);
                await engine.client.request("looper/settings", before.looper).catch(() => undefined);
                await engine.client.request("audio/settings", before.audio).catch(() => undefined);
                saveKeyboardMode(before.keyboardMode);
                saveKeyboardAppearance(before.keyboardAppearance);
                saveUiBehavior(before.uiBehavior);
                throw caught;
            }
        });
    };

    return <div className="page-scroll stack" data-mfx-sync-scroll="settings-profiles">
        <section className="panel stack">
            <h2>SETUP PROFILES</h2>
            <div className="muted">Save or load the complete working setup: theme, layout, controller, audio, UI, transport, looper and keyboard preferences. Banks, presets, recordings, downloaded models and credentials are not included.</div>
            <div className="row" style={{ flexWrap: "wrap" }}>
                <button type="button" className="btn btn-accent" onClick={() => setPicker("load")}>LOAD PROFILE</button>
                <button type="button" className="btn" onClick={() => setPicker("save")}>SAVE PROFILE AS</button>
            </div>
        </section>
        {picker && <LibraryJsonPicker
            engine={engine}
            run={run}
            kind="setupprofile"
            mode={picker}
            title={picker === "load" ? "LOAD SETUP PROFILE" : "SAVE SETUP PROFILE AS"}
            defaultName="My Setup"
            contents={picker === "save" ? contents() : undefined}
            onClose={() => setPicker(null)}
            onLoad={(parsed) => accept(parsed)}
        />}
        {pending && <ConfirmDialog
            title="LOAD COMPLETE SETUP?"
            body="This changes the theme, Performance layout, controller, audio device and other setup settings. Audio may restart."
            confirmLabel="LOAD SETUP"
            onCancel={() => setPending(null)}
            onConfirm={apply}
        />}
    </div>;
}
