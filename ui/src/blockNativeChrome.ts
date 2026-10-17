function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
        return false;
    }
    return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function blockNativeBrowserChrome(): void {
    const allowsSelection = (target: EventTarget | null) => {
        const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
        return Boolean(element?.closest("[data-mfx-selectable]"));
    };
    const onContextMenu = (event: Event) => {
        if (allowsSelection(event.target)) return;
        event.preventDefault();
    };
    const onSelectStart = (event: Event) => {
        if (isEditableTarget(event.target) || allowsSelection(event.target)) {
            return;
        }
        event.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("selectstart", onSelectStart, true);
}
