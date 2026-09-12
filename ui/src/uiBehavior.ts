export interface UiBehavior {
    version: 1;
    controlPopout: boolean;
    physicalControlPopout: boolean;
    controlPopoutDurationMs: number;
    controlPopoutScale: number;
    parameterFeedback: boolean;
}

export const UI_BEHAVIOR_KEY = "pimfx-ui-behavior";
export const UI_BEHAVIOR_EVENT = "pimfx-ui-behavior";

export const DEFAULT_UI_BEHAVIOR: UiBehavior = {
    version: 1,
    controlPopout: true,
    physicalControlPopout: true,
    controlPopoutDurationMs: 2200,
    controlPopoutScale: 1.65,
    parameterFeedback: true
};

export function loadUiBehavior(): UiBehavior {
    try {
        const raw = window.localStorage.getItem(UI_BEHAVIOR_KEY);
        if (raw) {
            const value = JSON.parse(raw) as Partial<UiBehavior>;
            return {
                version: 1,
                controlPopout: value.controlPopout !== false,
                physicalControlPopout: value.physicalControlPopout !== false,
                controlPopoutDurationMs: clamp(value.controlPopoutDurationMs ?? 2200, 500, 10000),
                controlPopoutScale: clamp(value.controlPopoutScale ?? 1.65, 1.2, 2.5),
                parameterFeedback: value.parameterFeedback !== false
            };
        }
    } catch {
        // private mode
    }
    return { ...DEFAULT_UI_BEHAVIOR };
}

export function saveUiBehavior(settings: UiBehavior): void {
    window.localStorage.setItem(UI_BEHAVIOR_KEY, JSON.stringify(settings));
    window.dispatchEvent(new Event(UI_BEHAVIOR_EVENT));
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
