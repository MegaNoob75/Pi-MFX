import type { KeyboardLayout } from "./layouts";

export type EditableElement = HTMLInputElement | HTMLTextAreaElement;

export function overlayRoot(): HTMLElement {
    const id = "pimfx-overlays";
    let node = document.getElementById(id);
    if (!node) {
        node = document.createElement("div");
        node.id = id;
        document.documentElement.appendChild(node);
    }
    return node;
}

const SUPPORTED_TYPES = new Set(["", "text", "search", "email", "url", "tel", "password", "number"]);
const OSK_ATTR = "data-pimfx-osk";

export function isSupportedEditable(element: Element): element is EditableElement {
    if (element instanceof HTMLTextAreaElement) {
        return !element.disabled;
    }
    if (!(element instanceof HTMLInputElement) || element.disabled) {
        return false;
    }
    return SUPPORTED_TYPES.has(element.type.toLowerCase());
}

export function editableFromTarget(target: EventTarget | null): EditableElement | null {
    const element = target instanceof Element ? target.closest("input, textarea") : null;
    if (!element || !isSupportedEditable(element)) {
        return null;
    }
    const armed = element.getAttribute(OSK_ATTR) === "1";
    if (element.readOnly && !armed) {
        return null;
    }
    return element;
}

export function armForOnScreenKeyboard(element: EditableElement): void {
    element.setAttribute(OSK_ATTR, "1");
    element.setAttribute("inputmode", "none");
    element.setAttribute("virtualkeyboardpolicy", "manual");
    element.setAttribute("autocomplete", "off");
    element.setAttribute("autocorrect", "off");
    element.setAttribute("spellcheck", "false");
    element.readOnly = true;
}

export function disarmForOnScreenKeyboard(element: EditableElement): void {
    if (element.getAttribute(OSK_ATTR) !== "1") {
        return;
    }
    element.removeAttribute(OSK_ATTR);
    element.removeAttribute("inputmode");
    element.removeAttribute("virtualkeyboardpolicy");
    element.removeAttribute("autocorrect");
    element.readOnly = false;
}

export function forEachSupportedEditable(root: ParentNode, visit: (element: EditableElement) => void): void {
    root.querySelectorAll("input, textarea").forEach((node) => {
        if (isSupportedEditable(node)) {
            visit(node);
        }
    });
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
    if (mode === "none") {
        const armed = element.getAttribute("data-pimfx-keyboard-layout");
        if (armed === "numeric" || armed === "decimal") {
            return "numeric";
        }
    }
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

export function sanitizePaste(
    text: string,
    layout: KeyboardLayout,
    target: EditableElement | null
): string {
    let next = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (layout === "numeric") {
        return next.replace(/[^0-9.-]/g, "");
    }
    if (!(target instanceof HTMLTextAreaElement)) {
        next = next.replace(/\n/g, "");
    }
    return next;
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
    const wasReadOnly = element.readOnly;
    element.readOnly = false;
    const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertReplacementText",
        data: value
    }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.readOnly = wasReadOnly;
}
