import { bool, isObj, num, str } from "./json";
import type { Json, JsonObject } from "./json";

const CURSOR_ATTR = "data-mfx-nav-cursor";
const ITEM_SELECTOR = 'button, a[href], [role="button"], input:not([type="hidden"]), select, textarea, [data-mfx-nav-item], .theme-pick, [data-theme-name], .hub-card, .split-row, .plugin-tile, .mfx-overlay-option, .menu-item, .pimfx-keyboard-key';
const LIST_SELECTOR = '[data-mfx-nav-list], .split-list, .mfx-hub-grid, .plugin-browser-grid, .explorer-tree, .explorer-list, .explorer-crumbs, .plugin-catalog-list, .snapshot-grid, .t3k-grid, .t3k-creator-list, .layout-group-list, .editor-picker-list, .chain-page, .control-grid';
const MODAL_SELECTOR = '.pimfx-keyboard-panel, nav.menu, [data-mfx-shell-menu], .mfx-overlay, .identity-menu, .plugin-browser-overlay, [role="dialog"], .dialog-backdrop, .explorer-menu';
const SECTION_SELECTOR = ".panel, .split-pane, .editor-toolbar, .hardware-setup-detail, .page-scroll, .mfx-screen";
const SCOPE_SELECTOR = `${MODAL_SELECTOR}, ${LIST_SELECTOR}, ${SECTION_SELECTOR}, .performance-stage, input, textarea, select`;
const SCOPE_KINDS = [
    ".pimfx-keyboard-panel", "nav.menu", "[data-mfx-shell-menu]", ".mfx-overlay", ".identity-menu",
    ".plugin-browser-overlay", "[role=\"dialog\"]", ".dialog-backdrop", ".explorer-menu",
    ".split-list", ".mfx-hub-grid", ".plugin-browser-grid", ".explorer-tree", ".explorer-list",
    ".explorer-crumbs", ".plugin-catalog-list", ".snapshot-grid", ".t3k-grid", ".t3k-creator-list",
    ".layout-group-list", ".editor-picker-list", ".chain-page", ".control-grid", ".panel", ".split-pane",
    ".editor-toolbar", ".hardware-setup-detail", ".page-scroll", ".mfx-screen", ".performance-stage",
    "input", "textarea", "select"
];

let cursorEl: HTMLElement | null = null;
let focusedScope: HTMLElement | null = null;
let publishFocus: ((location: JsonObject | null) => void) | undefined;

function isVisible(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return element.isConnected && style.display !== "none" && style.visibility !== "hidden"
        && rect.width > 2 && rect.height > 2;
}

function queryItems(selector: string, root: ParentNode = document): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(isVisible);
}

function clearCursor(): void {
    document.querySelectorAll(`[${CURSOR_ATTR}="true"]`).forEach((node) => node.removeAttribute(CURSOR_ATTR));
    document.querySelectorAll(".mfx-nav-cursor").forEach((node) => node.classList.remove("mfx-nav-cursor"));
    cursorEl = null;
}

/** Touch and keyboard focus choose one section; stale cursors cannot capture another list. */
export function watchHardwareNavFocus(
    claimNavigation?: () => void,
    publishNavigationFocus?: (location: JsonObject | null) => void
): () => void {
    publishFocus = publishNavigationFocus;
    const onFocus = (event: Event) => {
        if (!(event.target instanceof Element)) return;
        const directInteraction = event.type === "pointerdown";
        if (directInteraction) claimNavigation?.();
        const scope = event.target.closest<HTMLElement>(SCOPE_SELECTOR);
        if (scope !== focusedScope) clearCursor();
        focusedScope = scope;
        const item = event.target.closest<HTMLElement>(ITEM_SELECTOR);
        if (item && scope?.contains(item)) {
            clearCursor();
            cursorEl = item;
        } else {
            clearCursor();
        }
        if (directInteraction) {
            publishFocus?.(scope ? describeFocus(scope, cursorEl ?? undefined) : null);
        }
    };
    document.addEventListener("pointerdown", onFocus, true);
    document.addEventListener("focusin", onFocus, true);
    return () => {
        document.removeEventListener("pointerdown", onFocus, true);
        document.removeEventListener("focusin", onFocus, true);
        focusedScope = null;
        publishFocus = undefined;
        clearCursor();
    };
}

function modalScope(): HTMLElement | undefined {
    const keyboard = queryItems(".pimfx-keyboard-panel").at(-1);
    if (keyboard) return keyboard;
    const scopes = queryItems(MODAL_SELECTOR);
    // Prefer the innermost open surface, so a picker cannot share its parent dialog.
    const leaves = scopes.filter((scope) => !scopes.some((other) => other !== scope && scope.contains(other)));
    // Highest painted surface wins; focus left behind a new dialog cannot reclaim input.
    const zIndex = (scope: HTMLElement) => {
        let highest = 0;
        for (let node: HTMLElement | null = scope; node; node = node.parentElement) {
            highest = Math.max(highest, Number.parseInt(window.getComputedStyle(node).zIndex, 10) || 0);
        }
        return highest;
    };
    return leaves.reduce<HTMLElement | undefined>((top, scope) =>
        !top || zIndex(scope) >= zIndex(top) ? scope : top, undefined);
}

function navigationScope(): HTMLElement | undefined {
    const modal = modalScope();
    if (modal) return modal;
    if (focusedScope && isVisible(focusedScope)) return focusedScope;
    focusedScope = null;
    return queryItems(".performance-stage").at(0)
        ?? queryItems(LIST_SELECTOR).at(0)
        ?? queryItems(SECTION_SELECTOR).find((scope) => queryItems(ITEM_SELECTOR, scope).length > 0)
        ?? queryItems(ITEM_SELECTOR).at(0)?.parentElement ?? undefined;
}

function navItems(scope: HTMLElement): HTMLElement[] {
    if (scope.matches("input, textarea, select, .performance-stage")) return [];
    // Modal ownership must not turn typing into selection of a dialog action.
    if (focusedScope && scope.contains(focusedScope)
        && focusedScope.matches("input, textarea, select")) return [];
    const sections = queryItems(LIST_SELECTOR, scope);
    const focusedSection = sections.find((list) => focusedScope && list.contains(focusedScope));
    // A clicked dialog button must stay reachable even when the dialog also contains a list.
    const outsideList = cursorEl && scope.contains(cursorEl)
        && !sections.some((list) => list.contains(cursorEl));
    const root = focusedSection ?? (outsideList ? scope : sections[0] ?? scope);
    return queryItems(ITEM_SELECTOR, root).filter((item) => {
        if (root === scope && sections.some((list) => list.contains(item))) return false;
        if (item.matches(":disabled") || item.getAttribute("aria-disabled") === "true"
            || item.closest('[inert], [aria-hidden="true"]')) return false;
        // Do not offer both a clickable card and its nested controls as duplicate targets.
        const parentItem = item.parentElement?.closest(ITEM_SELECTOR);
        return !parentItem || parentItem === root || !root.contains(parentItem);
    });
}

function describeFocus(scope: HTMLElement, item?: HTMLElement): JsonObject {
    const items = navItems(scope);
    const itemIndex = item ? items.indexOf(item) : -1;
    const namedScope = str(scope.getAttribute("data-mfx-nav-list") ?? undefined);
    const scopeKind = SCOPE_KINDS.find((selector) => scope.matches(selector)) ?? "";
    return {
        scopeName: namedScope,
        scopeKind,
        scopeOrdinal: scopeKind ? queryItems(scopeKind).indexOf(scope) : -1,
        scopeIndex: queryItems(SCOPE_SELECTOR).indexOf(scope),
        itemKey: item ? str(item.getAttribute("data-mfx-nav-key") ?? undefined) : "",
        itemIndex
    };
}

function publishCurrentFocus(): void {
    if (!publishFocus) return;
    const scope = navigationScope();
    publishFocus(scope
        ? describeFocus(scope, cursorEl && scope.contains(cursorEl) ? cursorEl : undefined)
        : null);
}

function setCursor(element: HTMLElement | undefined, publish = true): void {
    clearCursor();
    if (!element) {
        if (publish) publishFocus?.(null);
        return;
    }
    cursorEl = element;
    element.setAttribute(CURSOR_ATTR, "true");
    element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    if (publish) publishCurrentFocus();
}

/** Applies a remote cursor without firing or focusing the represented control. */
export function applyHardwareNavFocus(location: unknown): void {
    if (!isObj(location as Json)) {
        focusedScope = null;
        setCursor(undefined, false);
        return;
    }
    const data = location as JsonObject;
    const name = str(data.scopeName);
    const kind = str(data.scopeKind);
    const scopes = queryItems(SCOPE_SELECTOR);
    const scope = (name
        ? queryItems("[data-mfx-nav-list]").find((item) => item.getAttribute("data-mfx-nav-list") === name)
        : undefined)
        ?? (kind ? queryItems(kind)[Math.trunc(num(data.scopeOrdinal, -1))] : undefined)
        ?? scopes[Math.trunc(num(data.scopeIndex, -1))];
    if (!scope) return;
    const items = navItems(scope);
    const itemKey = str(data.itemKey);
    const item = (itemKey
        ? items.find((entry) => entry.getAttribute("data-mfx-nav-key") === itemKey)
        : undefined) ?? items[Math.trunc(num(data.itemIndex, -1))];
    focusedScope = scope;
    if (!item) {
        setCursor(undefined, false);
        return;
    }
    setCursor(item, false);
}

function currentIndex(items: HTMLElement[]): number {
    const held = cursorEl ? items.indexOf(cursorEl) : -1;
    if (held >= 0) return held;
    clearCursor();
    const focused = items.findIndex((item) => item === document.activeElement);
    if (focused >= 0) return focused;
    return items.findIndex((item) => item.classList.contains("selected")
        || item.getAttribute("aria-current") === "page");
}

/** Performance yields to any open menu or focused section. */
export function hardwareNavBlocksPerformance(): boolean {
    const scope = navigationScope();
    return Boolean(scope && !scope.matches(".performance-stage"));
}

/** Exactly one section consumes each encoder event, including empty open dialogs. */
export function handleHardwareNav(message: JsonObject): boolean {
    const scope = navigationScope();
    if (cursorEl && (!scope || !scope.contains(cursorEl) || !isVisible(cursorEl))) clearCursor();
    if (!scope || scope.matches(".performance-stage")) return false;
    const items = navItems(scope);
    if (items.length === 0) return true;
    const current = currentIndex(items);
    if (bool(message.select)) {
        const item = items[current >= 0 ? current : 0];
        setCursor(item);
        if (item?.matches("input, textarea, select")) item.focus();
        else item?.click();
        return true;
    }
    const delta = Math.sign(Math.trunc(num(message.delta)));
    if (delta !== 0) {
        const start = current >= 0 ? current : (delta > 0 ? -1 : items.length);
        setCursor(items[(start + delta + items.length) % items.length]);
    }
    return true;
}
