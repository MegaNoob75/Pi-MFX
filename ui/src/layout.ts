import { arr, bool, num, obj, str, type JsonObject } from "./json";

export const STATUS_WIDGET_IDS = [
    "currentBank",
    "activePreset",
    "cpuUsage",
    "xruns",
    "audioStatus",
    "chainBypassStatus",
    "snapshotModeStatus",
    "tuner"
] as const;

export type StatusWidgetId = (typeof STATUS_WIDGET_IDS)[number];

export const STATUS_WIDGET_LABELS: Record<StatusWidgetId, string> = {
    currentBank: "Current Bank",
    activePreset: "Active Preset",
    cpuUsage: "CPU",
    xruns: "XRuns",
    audioStatus: "Audio",
    chainBypassStatus: "Bypass",
    snapshotModeStatus: "Snapshots",
    tuner: "Tuner"
};

export interface LayoutRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface StatusWidget {
    id: StatusWidgetId;
    visible: boolean;
    rect: LayoutRect;
    showLabel: boolean;
}

export function clampRect(rect: LayoutRect): LayoutRect {
    const width = Math.min(1, Math.max(0.08, rect.width));
    const height = Math.min(1, Math.max(0.08, rect.height));
    return {
        x: Math.min(1 - width, Math.max(0, rect.x)),
        y: Math.min(1 - height, Math.max(0, rect.y)),
        width,
        height
    };
}

export function defaultStatusWidgets(): Record<string, StatusWidget> {
    const widgets: Record<string, StatusWidget> = {};
    STATUS_WIDGET_IDS.forEach((id, index) => {
        widgets[id] = {
            id,
            visible: index < 4,
            showLabel: true,
            rect: clampRect({
                x: 0.02 + (index % 4) * 0.24,
                y: 0.02,
                width: 0.22,
                height: 0.12
            })
        };
    });
    return widgets;
}

export function readStatusWidgets(layout: JsonObject): Record<string, StatusWidget> {
    const stored = obj(layout.elements);
    const widgets = defaultStatusWidgets();
    for (const id of STATUS_WIDGET_IDS) {
        const item = obj(stored[id]);
        if (!item.id && !item.visible && !item.rect) {
            continue;
        }
        widgets[id] = {
            id,
            visible: bool(item.visible, widgets[id].visible),
            showLabel: bool(item.showLabel, true),
            rect: clampRect({
                x: num(obj(item.rect).x, widgets[id].rect.x),
                y: num(obj(item.rect).y, widgets[id].rect.y),
                width: num(obj(item.rect).width, widgets[id].rect.width),
                height: num(obj(item.rect).height, widgets[id].rect.height)
            })
        };
    }
    return widgets;
}

export function statusWidgetsToJson(widgets: Record<string, StatusWidget>): JsonObject {
    const elements: JsonObject = {};
    for (const id of STATUS_WIDGET_IDS) {
        const widget = widgets[id];
        elements[id] = {
            id,
            visible: widget.visible,
            showLabel: widget.showLabel,
            rect: {
                x: widget.rect.x,
                y: widget.rect.y,
                width: widget.rect.width,
                height: widget.rect.height
            }
        };
    }
    return elements;
}

export function unplacedIds(layout: JsonObject): string[] {
    return arr(layout.unplacedControlIds).map((value) => str(value)).filter(Boolean);
}

export function snapRect(rect: LayoutRect, snap = 0.02): LayoutRect {
    if (snap <= 0) {
        return clampRect(rect);
    }
    const quantize = (value: number) => Math.round(value / snap) * snap;
    return clampRect({
        x: quantize(rect.x),
        y: quantize(rect.y),
        width: quantize(rect.width),
        height: quantize(rect.height)
    });
}

export function snapRectToPixels(
    rect: LayoutRect,
    canvasWidth: number,
    canvasHeight: number,
    snapPixels: number
): LayoutRect {
    if (snapPixels <= 0) {
        return clampRect(rect);
    }
    const stepX = snapPixels / Math.max(1, canvasWidth);
    const stepY = snapPixels / Math.max(1, canvasHeight);
    const quantizeX = (value: number) => Math.round(value / stepX) * stepX;
    const quantizeY = (value: number) => Math.round(value / stepY) * stepY;
    return clampRect({
        x: quantizeX(rect.x),
        y: quantizeY(rect.y),
        width: quantizeX(rect.width),
        height: quantizeY(rect.height)
    });
}

export function analogMinSize(kind: string): { width: number; height: number } {
    if (kind === "slider" || kind === "expression") {
        return { width: 0.1, height: 0.22 };
    }
    if (kind === "pot" || kind === "encoder") {
        return { width: 0.12, height: 0.16 };
    }
    return { width: 0.12, height: 0.18 };
}

export function gridCellRect(index: number, columns: number, rows: number): LayoutRect {
    const column = index % Math.max(1, columns);
    const row = Math.floor(index / Math.max(1, columns));
    return clampRect({
        x: column / Math.max(1, columns) + 0.01,
        y: 0.16 + row / Math.max(1, rows) * 0.82,
        width: 1 / Math.max(1, columns) - 0.02,
        height: 0.82 / Math.max(1, rows) - 0.02
    });
}
