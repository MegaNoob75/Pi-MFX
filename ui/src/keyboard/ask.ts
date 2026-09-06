import type { KeyboardLayout } from "./layouts";
import { shouldUseOnScreenKeyboard } from "./mode";

export const ASK_EVENT = "pimfx-keyboard-ask";

export interface AskRequest {
    label: string;
    value: string;
    layout: KeyboardLayout;
    resolve: (value: string | null) => void;
}

export function askText(
    label: string,
    value = "",
    layout: KeyboardLayout = "text"
): Promise<string | null> {
    if (!shouldUseOnScreenKeyboard()) {
        const result = window.prompt(label, value);
        return Promise.resolve(result);
    }
    return new Promise((resolve) => {
        window.dispatchEvent(new CustomEvent<AskRequest>(ASK_EVENT, {
            detail: { label, value, layout, resolve }
        }));
    });
}
