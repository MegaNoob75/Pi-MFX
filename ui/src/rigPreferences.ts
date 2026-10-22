import { useEffect, useRef } from "react";
import type { EngineClient, EngineSnapshot } from "./api";
import { obj, type JsonObject } from "./json";
import { isKioskDisplay } from "./keyboard/mode";
import { CUSTOM_KEYBOARD_THEMES_STORAGE_KEY, KEYBOARD_THEMES_CHANGED_EVENT } from "./keyboard/keyboardTheme";

const keys = ["pimfx-keyboard-mode", "pimfx-keyboard-appearance", "pimfx-ui-behavior", CUSTOM_KEYBOARD_THEMES_STORAGE_KEY];
const events = ["pimfx-keyboard-mode", "pimfx-keyboard-appearance", "pimfx-ui-behavior", KEYBOARD_THEMES_CHANGED_EVENT, "storage"];

function localPreferences(): JsonObject {
    const values: JsonObject = {};
    try {
        for (const key of keys) {
            const value = window.localStorage.getItem(key);
            if (value !== null) values[key] = value;
        }
    } catch { /* Browsers may disable local storage; Pi-owned settings remain intact. */ }
    return { version: 1, values };
}

/** Pi-owned preferences make a remote backup include the kiosk's saved setup. */
export function useRigPreferences(engine: EngineSnapshot & { client: EngineClient }): void {
    const saved = JSON.stringify(obj(obj(engine.state.ui).browserPreferences));
    const ready = useRef(false);
    const previous = useRef("");
    const applying = useRef(false);
    const client = engine.client;
    useEffect(() => {
        if (!engine.connected) return;
        const server = obj(obj(engine.state.ui).browserPreferences);
        if (server.version === 1) {
            // A newer local edit may be waiting behind an in-flight save. Do not
            // overwrite it with that older save's broadcast; the next tick saves it.
            if (ready.current && JSON.stringify(localPreferences()) !== previous.current) return;
            applying.current = true;
            try {
                for (const key of keys) {
                    const value = obj(server.values)[key];
                    if (typeof value === "string") window.localStorage.setItem(key, value);
                    else window.localStorage.removeItem(key);
                }
            } catch {
                applying.current = false;
                ready.current = false;
                return;
            }
            for (const event of events) window.dispatchEvent(new Event(event));
            applying.current = false;
            previous.current = JSON.stringify(localPreferences());
            ready.current = true;
        } else if (isKioskDisplay()) {
            const preferences = localPreferences();
            previous.current = JSON.stringify(preferences);
            ready.current = true;
            void client.request("ui/settings", { browserPreferences: preferences }).catch(() => { ready.current = false; });
        }
    }, [saved, engine.connected, client]);
    useEffect(() => {
        let pending = false;
        const save = () => {
            if (!ready.current || applying.current || pending || !client.snapshot.connected) return;
            const value = localPreferences();
            const serialized = JSON.stringify(value);
            if (serialized === previous.current) return;
            pending = true;
            void client.request("ui/settings", { browserPreferences: value }).then(() => {
                previous.current = serialized;
            }).catch(() => undefined).finally(() => { pending = false; });
        };
        for (const event of events) window.addEventListener(event, save);
        // Retry changes that arrived while an earlier preferences save was pending.
        const timer = window.setInterval(save, 1500);
        return () => {
            window.clearInterval(timer);
            for (const event of events) window.removeEventListener(event, save);
        };
    }, [client]);
}
