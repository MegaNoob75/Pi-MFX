import type { EngineClient } from "./api";
import { obj, type JsonObject } from "./json";

export function updateUiSessionSection(
    client: EngineClient,
    section: string,
    patch: JsonObject
): void {
    client.updateUiSession({
        [section]: {
            ...obj(client.snapshot.uiSession[section]),
            ...patch
        }
    });
}
