import type { KeyboardLayout } from "./layouts";

export type EditableElement = HTMLInputElement | HTMLTextAreaElement;

const SUPPORTED_TYPES = new Set(["", "text", "search", "email", "url", "tel", "password", "number"]);

export function editableFromTarget(target: EventTarget | null): EditableElement | null {
    const element = target instanceof Element ? target.closest("input, textarea") : null;
    if (element instanceof HTMLTextAreaElement) {
        return element.disabled || element.readOnly ? null : element;
    }
    if (!(element instanceof HTMLInputElement)
        || element.disabled
        || element.readOnly
        || !SUPPORTED_TYPES.has(element.type.toLowerCase())) {
        return null;
    }
    return element;
}

export function inferLabel(element: EditableElement): string {
    const fromLabel = element.labels?.[0]?.textContent?.trim();
    if (fromLabel) {
        return fromLabel;
    }
    const aria = element.getAttribute("aria-label")?.trim();
    if (aria) {
        return aria;
    }
    if (element.placeholder.trim()) {
        return element.placeholder.trim();
    }
    return "Edit";
}

export function inferLayout(element: EditableElement): KeyboardLayout {
    if (element instanceof HTMLInputElement && element.type === "number") {
        return "numeric";
    }
    const mode = element.inputMode.toLowerCase();
    return mode === "numeric" || mode === "decimal" ? "numeric" : "text";
}

export function replaceSelection(
    value: string,
    start: number,
    end: number,
    insertion: string
): { value: string; start: number; end: number } {
    const next = value.slice(0, start) + insertion + value.slice(end);
    const cursor = start + insertion.length;
    return { value: next, start: cursor, end: cursor };
}

export function eraseSelection(
    value: string,
    start: number,
    end: number
): { value: string; start: number; end: number } {
    if (start !== end) {
        return replaceSelection(value, start, end, "");
    }
    if (start <= 0) {
        return { value, start: 0, end: 0 };
    }
    return replaceSelection(value, start - 1, start, "");
}

export function commitValue(element: EditableElement, value: string): void {
    const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
}
