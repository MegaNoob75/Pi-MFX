import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let observer: MutationObserver | undefined;
let preference: MediaQueryList | undefined;
const notify = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (!observer) {
        preference = window.matchMedia("(prefers-reduced-motion: reduce)");
        preference.addEventListener("change", notify);
        observer = new MutationObserver(notify);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-mfx-motion-enabled", "data-mfx-respect-reduced-motion"]
        });
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            observer?.disconnect();
            observer = undefined;
            preference?.removeEventListener("change", notify);
            preference = undefined;
        }
    };
}

function motionEnabled(): boolean {
    const flags = document.documentElement.dataset;
    const reduced = (preference ?? window.matchMedia("(prefers-reduced-motion: reduce)")).matches;
    return flags.mfxMotionEnabled !== "false"
        && !(flags.mfxRespectReducedMotion !== "false" && reduced);
}

/** One shared observer keeps JavaScript animations aligned with theme CSS. */
export function useThemeMotion(): boolean {
    return useSyncExternalStore(subscribe, motionEnabled, () => false);
}
