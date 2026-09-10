import type { KeyboardLayout } from "./layouts";

export const ASK_EVENT = "pimfx-keyboard-ask";
export const DISMISS_KEYBOARD_EVENT = "pimfx-keyboard-dismiss";

export interface AskRequest {
    label: string;
    value: string;
    layout: KeyboardLayout;
    resolve: (value: string | null) => void;
}

export function dismissOnScreenKeyboard() {
    window.dispatchEvent(new Event(DISMISS_KEYBOARD_EVENT));
}

export function askText(
    label: string,
    value = "",
    layout: KeyboardLayout = "text"
): Promise<string | null> {
    return new Promise((resolve) => {
        window.dispatchEvent(new CustomEvent<AskRequest>(ASK_EVENT, {
            detail: { label, value, layout, resolve }
        }));
    });
}
