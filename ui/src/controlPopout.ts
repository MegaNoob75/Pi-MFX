export const CONTROL_POPOUT_OPEN_EVENT = "pimfx-control-popout-open";

export function announceControlPopout(owner: object) {
    window.dispatchEvent(new CustomEvent(CONTROL_POPOUT_OPEN_EVENT, { detail: owner }));
}
