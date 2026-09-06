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

function isPhoneOrTablet(): boolean {
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    return nav.userAgentData?.mobile === true
        || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function shouldUseOnScreenKeyboard(mode = loadKeyboardMode()): boolean {
    if (mode === "off") {
        return false;
    }
    if (mode === "on") {
        return true;
    }
    // Auto: Pi screen, PC browser, and --app= kiosk. Phones keep their own keyboard.
    return !isPhoneOrTablet();
}
