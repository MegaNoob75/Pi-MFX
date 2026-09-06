import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, type KeyboardSession } from "./Keyboard";
import { onKeyboardModeChange, shouldUseOnScreenKeyboard } from "./mode";
import {
    armForOnScreenKeyboard,
    commitValue,
    disarmForOnScreenKeyboard,
    editableFromTarget,
    forEachSupportedEditable,
    inferLabel,
    inferLayout,
    type EditableElement
} from "./utils";

function hideSystemKeyboard(element: EditableElement): void {
    armForOnScreenKeyboard(element);
    const nav = navigator as Navigator & {
        virtualKeyboard?: { overlaysContent: boolean; hide?: () => void };
    };
    if (nav.virtualKeyboard) {
        nav.virtualKeyboard.overlaysContent = true;
        nav.virtualKeyboard.hide?.();
    }
}

export function KeyboardProvider() {
    const [session, setSession] = useState<KeyboardSession | null>(null);
    const sessionRef = useRef<KeyboardSession | null>(null);
    const nextId = useRef(0);
    sessionRef.current = session;

    const open = useCallback((element: EditableElement) => {
        if (!shouldUseOnScreenKeyboard()) {
            return;
        }
        hideSystemKeyboard(element);
        if (sessionRef.current?.target === element) {
            return;
        }
        let start = element.value.length;
        let end = start;
        try {
            start = element.selectionStart ?? start;
            end = element.selectionEnd ?? start;
        } catch {
            // number inputs hide selection
        }
        if (element instanceof HTMLInputElement && element.type === "number") {
            element.setAttribute("data-pimfx-keyboard-layout", "numeric");
        }
        const next: KeyboardSession = {
            id: ++nextId.current,
            target: element,
            label: inferLabel(element),
            layout: inferLayout(element),
            value: element.value,
            selectionStart: start,
            selectionEnd: end
        };
        sessionRef.current = next;
        setSession(next);
    }, []);

    const close = useCallback((current: KeyboardSession) => {
        if (document.activeElement === current.target) {
            current.target.blur();
        }
        sessionRef.current = null;
        setSession(null);
    }, []);

    useEffect(() => {
        const armTree = (root: ParentNode = document) => {
            if (!shouldUseOnScreenKeyboard()) {
                return;
            }
            forEachSupportedEditable(root, hideSystemKeyboard);
        };

        const intercept = (event: Event) => {
            if (!shouldUseOnScreenKeyboard()) {
                return;
            }
            const element = editableFromTarget(event.target);
            if (!element) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            open(element);
        };

        const focusIn = (event: FocusEvent) => {
            if (!shouldUseOnScreenKeyboard()) {
                return;
            }
            const element = editableFromTarget(event.target);
            if (!element) {
                return;
            }
            open(element);
        };

        armTree();
        const active = editableFromTarget(document.activeElement);
        if (active) {
            open(active);
        }

        document.addEventListener("pointerdown", intercept, true);
        document.addEventListener("mousedown", intercept, true);
        document.addEventListener("touchstart", intercept, { capture: true, passive: false });
        document.addEventListener("focusin", focusIn, true);

        const observer = new MutationObserver((records) => {
            for (const record of records) {
                record.addedNodes.forEach((node) => {
                    if (node instanceof Element) {
                        if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
                            armTree(node.parentNode ?? document);
                        } else {
                            armTree(node);
                        }
                    }
                });
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        const stopWatchingMode = onKeyboardModeChange(() => {
            if (shouldUseOnScreenKeyboard()) {
                armTree();
            } else {
                forEachSupportedEditable(document, disarmForOnScreenKeyboard);
                sessionRef.current = null;
                setSession(null);
            }
        });

        return () => {
            document.removeEventListener("pointerdown", intercept, true);
            document.removeEventListener("mousedown", intercept, true);
            document.removeEventListener("touchstart", intercept, true);
            document.removeEventListener("focusin", focusIn, true);
            observer.disconnect();
            stopWatchingMode();
        };
    }, [open]);

    if (!session) {
        return null;
    }

    return (
        <Keyboard
            key={session.id}
            session={session}
            onCancel={() => close(session)}
            onDone={(value) => {
                commitValue(session.target, value);
                close(session);
            }}
        />
    );
}
