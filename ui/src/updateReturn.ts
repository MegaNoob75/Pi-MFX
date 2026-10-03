const UPDATE_RETURN_KEY = "pimfx.return-to-updates-after-install";

export function markReturnToUpdatesAfterInstall() {
    try {
        window.sessionStorage.setItem(UPDATE_RETURN_KEY, "1");
    } catch {
        // The update still works when browser storage is unavailable.
    }
}

export function hasPendingUpdateReturn() {
    try {
        return window.sessionStorage.getItem(UPDATE_RETURN_KEY) === "1";
    } catch {
        return false;
    }
}

export function clearPendingUpdateReturn() {
    try {
        window.sessionStorage.removeItem(UPDATE_RETURN_KEY);
    } catch {
        // Nothing to clear when browser storage is unavailable.
    }
}
