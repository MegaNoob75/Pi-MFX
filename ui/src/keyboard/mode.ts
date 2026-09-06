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

function isPiTouchscreen(): boolean {
    const local = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    const coarse = navigator.maxTouchPoints > 0
        || window.matchMedia?.("(pointer: coarse)").matches === true;
    return local && coarse && !isPhoneOrTablet();
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
    return isPiTouchscreen();
}
