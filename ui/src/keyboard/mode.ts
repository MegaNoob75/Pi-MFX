export type KeyboardMode = "auto" | "on" | "off";

const STORAGE_KEY = "pimfx-keyboard-mode";
const CHANGE_EVENT = "pimfx-keyboard-mode";

export function loadKeyboardMode(): KeyboardMode {
    try {
        const value = window.localStorage.getItem(STORAGE_KEY);
        if (value === "auto" || value === "on" || value === "off") {
            return value;
        }
    } catch {
        // private mode
    }
    return "on";
}

export function saveKeyboardMode(mode: KeyboardMode): void {
    window.localStorage.setItem(STORAGE_KEY, mode);
    window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onKeyboardModeChange(listener: () => void): () => void {
    window.addEventListener(CHANGE_EVENT, listener);
    window.addEventListener("storage", listener);
    return () => {
        window.removeEventListener(CHANGE_EVENT, listener);
        window.removeEventListener("storage", listener);
    };
}

export function isKioskDisplay(): boolean {
    try {
        if (new URLSearchParams(window.location.search).get("kiosk") === "1") {
            return true;
        }
    } catch {
        // ignore
    }
    const host = window.location.hostname;
    const local = host === "localhost" || host === "127.0.0.1"
        || host === "[::1]" || host === "::1";
    const touch = (navigator.maxTouchPoints ?? 0) > 0
        || window.matchMedia?.("(pointer: coarse)").matches === true;
    return local && touch;
}

function isPhone(): boolean {
    const ua = navigator.userAgent;
    if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) {
        return false;
    }
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    return nav.userAgentData?.mobile === true
        || /iPhone|iPod|Android.*Mobile/i.test(ua);
}

export function shouldUseOnScreenKeyboard(mode = loadKeyboardMode()): boolean {
    if (mode === "off") {
        return false;
    }
    if (mode === "on" || isKioskDisplay()) {
        return true;
    }
    // Auto: Pi kiosk and tablet controllers. Phones keep their own keyboard.
    if (isPhone()) {
        return false;
    }
    return (navigator.maxTouchPoints ?? 0) > 0
        || window.matchMedia?.("(pointer: coarse)").matches === true;
}
