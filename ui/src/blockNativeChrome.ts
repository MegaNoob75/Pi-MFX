function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
        return false;
    }
    return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function blockNativeBrowserChrome(): void {
    const onContextMenu = (event: Event) => {
        event.preventDefault();
    };
    const onSelectStart = (event: Event) => {
        if (isEditableTarget(event.target)) {
            return;
        }
        event.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("selectstart", onSelectStart, true);
}
