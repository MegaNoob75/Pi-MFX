import { arr, bool, num, obj, str, type JsonObject } from "./json";

export const STATUS_WIDGET_IDS = [
    "currentBank",
    "activePreset",
    "cpuUsage",
    "xruns",
    "audioStatus",
    "chainBypassStatus",
    "snapshotModeStatus",
    "tuner",
    "inputMeter",
    "outputMeter"
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
    tuner: "Tuner",
    inputMeter: "Input Gain",
    outputMeter: "Output Gain"
};

export function isMeterWidget(id: string): boolean {
    return id === "inputMeter" || id === "outputMeter";
}

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

export function clampRect(rect: LayoutRect, minSize?: { width: number; height: number }): LayoutRect {
    const minW = Math.min(1, Math.max(0.04, minSize?.width ?? 0.08));
    const minH = Math.min(1, Math.max(0.04, minSize?.height ?? 0.08));
    const width = Math.min(1, Math.max(minW, rect.width));
    const height = Math.min(1, Math.max(minH, rect.height));
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
            rect: clampRect(isMeterWidget(id)
                ? {
                    x: id === "inputMeter" ? 0.02 : 0.86,
                    y: 0.20,
                    width: 0.12,
                    height: 0.58
                }
                : {
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
    snapPixels: number,
    minSize?: { width: number; height: number }
): LayoutRect {
    if (snapPixels <= 0) {
        return clampRect(rect, minSize);
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
    }, minSize);
}

export function analogMinSize(kind: string): { width: number; height: number } {
    if (kind === "slider" || kind === "expression") {
        return { width: 0.08, height: 0.22 };
    }
    if (kind === "pot" || kind === "encoder") {
        return { width: 0.08, height: 0.14 };
    }
    if (kind === "encoderPush") {
        return { width: 0.08, height: 0.12 };
    }
    return { width: 0.10, height: 0.16 };
}

export const DEFAULT_SNAPSHOT_SLOT_COUNT = 6;

export interface SnapshotWidget {
    id: string;
    slot: number;
    rect: LayoutRect;
}

export function snapshotWidgetId(slot: number): string {
    return `snap-slot-${slot}`;
}

export function defaultSnapshotWidgets(count = DEFAULT_SNAPSHOT_SLOT_COUNT): SnapshotWidget[] {
    const columns = 3;
    const rows = Math.max(1, Math.ceil(count / columns));
    return Array.from({ length: count }, (_, slot) => ({
        id: snapshotWidgetId(slot),
        slot,
        rect: gridCellRect(slot, columns, rows)
    }));
}

export function readSnapshotWidgets(layout: JsonObject): SnapshotWidget[] {
    const stored = arr(layout.snapshotElements);
    if (stored.length === 0) {
        return defaultSnapshotWidgets();
    }
    return stored.map((value, index) => {
        const item = obj(value);
        const slot = Math.max(0, num(item.slot, index));
        return {
            id: str(item.id, snapshotWidgetId(slot)),
            slot,
            rect: clampRect({
                x: num(obj(item.rect).x, gridCellRect(slot, 3, 2).x),
                y: num(obj(item.rect).y, gridCellRect(slot, 3, 2).y),
                width: num(obj(item.rect).width, gridCellRect(slot, 3, 2).width),
                height: num(obj(item.rect).height, gridCellRect(slot, 3, 2).height)
            })
        };
    }).sort((a, b) => a.slot - b.slot);
}

export function snapshotWidgetsToJson(widgets: SnapshotWidget[]): JsonObject[] {
    return widgets.map((widget) => ({
        id: widget.id,
        slot: widget.slot,
        rect: {
            x: widget.rect.x,
            y: widget.rect.y,
            width: widget.rect.width,
            height: widget.rect.height
        }
    }));
}

export function snapshotLayoutSlots(layout: JsonObject): number[] {
    return readSnapshotWidgets(layout).map((widget) => widget.slot);
}

export function snapshotSlotCount(layout: JsonObject): number {
    return Math.max(1, readSnapshotWidgets(layout).length);
}

export function snapshotAtSlot(snapshots: JsonObject[], slot: number): JsonObject | undefined {
    return snapshots.find((item) => num(item.slot, -1) === slot)
        ?? snapshots.find((item, index) => num(item.slot, index) === slot);
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

export interface LayoutGroup {
    id: string;
    name: string;
    memberIds: string[];
}

export function readLayoutGroups(layout: JsonObject): LayoutGroup[] {
    return arr(layout.groups).map((value, index) => {
        const item = obj(value);
        const memberIds = arr(item.memberIds).map((id) => str(id)).filter(Boolean);
        return {
            id: str(item.id, `group-${index + 1}`),
            name: str(item.name, `Group ${index + 1}`),
            memberIds
        };
    }).filter((group) => group.id);
}

export function layoutGroupsToJson(groups: LayoutGroup[]): JsonObject[] {
    return groups.map((group) => ({
        id: group.id,
        name: group.name,
        memberIds: [...group.memberIds]
    }));
}

export function newLayoutGroupId(groups: LayoutGroup[]): string {
    let index = groups.length + 1;
    const used = new Set(groups.map((group) => group.id));
    while (used.has(`group-${index}`)) {
        index += 1;
    }
    return `group-${index}`;
}

export function rectsOverlap(a: LayoutRect, b: LayoutRect, gap = 0.004): boolean {
    return a.x < b.x + b.width - gap
        && a.x + a.width > b.x + gap
        && a.y < b.y + b.height - gap
        && a.y + a.height > b.y + gap;
}

export function fitRectInEmptySpace(
    desired: LayoutRect,
    occupied: LayoutRect[],
    minSize = { width: 0.08, height: 0.08 }
): LayoutRect | null {
    const floor = { width: 0.06, height: 0.08 };
    const minW = Math.max(floor.width, Math.min(desired.width, minSize.width));
    const minH = Math.max(floor.height, Math.min(desired.height, minSize.height));
    const sizes: Array<{ width: number; height: number }> = [];
    for (const scale of [1, 0.85, 0.7, 0.55, 0.4, 0.3]) {
        const width = Math.max(minW, desired.width * scale);
        const height = Math.max(minH, desired.height * scale);
        if (!sizes.some((size) => Math.abs(size.width - width) < 0.002 && Math.abs(size.height - height) < 0.002)) {
            sizes.push({ width, height });
        }
    }
    for (const extra of [ { width: minW, height: minH }, floor ]) {
        if (!sizes.some((size) => Math.abs(size.width - extra.width) < 0.002 && Math.abs(size.height - extra.height) < 0.002)) {
            sizes.push(extra);
        }
    }

    const fits = (rect: LayoutRect) => !occupied.some((other) => rectsOverlap(rect, other, 0.008));
    const preferred = clampRect(desired, minSize);
    if (fits(preferred)) {
        return preferred;
    }

    const step = 0.02;
    for (const size of sizes) {
        const first = clampRect({ ...desired, width: size.width, height: size.height }, size);
        if (fits(first)) {
            return first;
        }
        for (let y = 0; y <= 1 - size.height + 1e-6; y += step) {
            for (let x = 0; x <= 1 - size.width + 1e-6; x += step) {
                const candidate = clampRect({ x, y, width: size.width, height: size.height }, size);
                if (fits(candidate)) {
                    return candidate;
                }
            }
        }
    }
    return null;
}

export function rectContainsPoint(rect: LayoutRect, x: number, y: number): boolean {
    return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function resizeRect(
    base: LayoutRect,
    dx: number,
    dy: number,
    corner: "se" | "nw",
    min: { width: number; height: number } = { width: 0.08, height: 0.08 }
): LayoutRect {
    if (corner === "se") {
        return clampRect({
            ...base,
            width: Math.max(min.width, base.width + dx),
            height: Math.max(min.height, base.height + dy)
        });
    }
    const width = Math.max(min.width, base.width - dx);
    const height = Math.max(min.height, base.height - dy);
    return clampRect({
        x: base.x + base.width - width,
        y: base.y + base.height - height,
        width,
        height
    });
}

export function spaceRectsEvenly(rects: LayoutRect[]): LayoutRect[] {
    if (rects.length === 0) {
        return [];
    }
    if (rects.length === 1) {
        return [clampRect(rects[0])];
    }
    const minX = Math.min(...rects.map((rect) => rect.x));
    const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
    const minY = Math.min(...rects.map((rect) => rect.y));
    const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const vertical = spanY > spanX;
    const ordered = rects.map((rect, index) => ({ rect, index }))
        .sort((a, b) => vertical ? a.rect.y - b.rect.y : a.rect.x - b.rect.x);
    const totalSize = ordered.reduce((sum, item) => sum + (vertical ? item.rect.height : item.rect.width), 0);
    const box = vertical ? Math.max(spanY, totalSize) : Math.max(spanX, totalSize);
    const gap = ordered.length > 1 ? Math.max(0, (box - totalSize) / (ordered.length - 1)) : 0;
    let cursor = vertical ? minY : minX;
    const next = rects.map((rect) => ({ ...rect }));
    for (const item of ordered) {
        const current = next[item.index];
        if (vertical) {
            current.y = cursor;
            current.x = minX + (spanX - current.width) / 2;
            cursor += current.height + gap;
        } else {
            current.x = cursor;
            current.y = minY + (spanY - current.height) / 2;
            cursor += current.width + gap;
        }
        next[item.index] = clampRect(current);
    }
    return next;
}
