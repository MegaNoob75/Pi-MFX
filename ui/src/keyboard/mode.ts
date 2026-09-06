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
    return "auto";
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

function isPhoneOrTablet(): boolean {
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    return nav.userAgentData?.mobile === true
        || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function isLocalHost(): boolean {
    const host = window.location.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isStandaloneApp(): boolean {
    return window.matchMedia?.("(display-mode: standalone)").matches === true
        || window.matchMedia?.("(display-mode: minimal-ui)").matches === true;
}

function isTouchCapable(): boolean {
    return navigator.maxTouchPoints > 0
        || window.matchMedia?.("(pointer: coarse)").matches === true
        || window.matchMedia?.("(hover: none)").matches === true;
}

function isKioskQuery(): boolean {
    try {
        return new URLSearchParams(window.location.search).get("kiosk") === "1";
    } catch {
        return false;
    }
}

function isPiKioskSession(): boolean {
    if (!isLocalHost() || isPhoneOrTablet()) {
        return false;
    }
    // The touchscreen Chromium --app= URL includes ?kiosk=1. Standalone and
    // coarse-pointer checks catch the same session if the query is stripped.
    return isKioskQuery() || isStandaloneApp() || isTouchCapable();
}

export function shouldUseOnScreenKeyboard(mode = loadKeyboardMode()): boolean {
    if (mode === "on") {
        return true;
    }
    if (mode === "off") {
        return false;
    }
    if (isPhoneOrTablet()) {
        return false;
    }
    return isPiKioskSession();
}
