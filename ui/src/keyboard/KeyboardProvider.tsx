import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, type KeyboardSession } from "./Keyboard";
import { onKeyboardModeChange, shouldUseOnScreenKeyboard } from "./mode";
import { commitValue, editableFromTarget, inferLabel, inferLayout, type EditableElement } from "./utils";

function hideSystemKeyboard(element: EditableElement): void {
    element.setAttribute("inputmode", "none");
    element.setAttribute("virtualkeyboardpolicy", "manual");
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
        if (sessionRef.current?.target === element) {
            return;
        }
        hideSystemKeyboard(element);
        let start = element.value.length;
        let end = start;
        try {
            start = element.selectionStart ?? start;
            end = element.selectionEnd ?? start;
        } catch {
            // number inputs hide selection
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
        // Drop focus so Wayland/Chromium do not open Squeekboard on the field.
        if (document.activeElement === element) {
            element.blur();
        }
    }, []);

    const close = useCallback((current: KeyboardSession) => {
        if (document.activeElement === current.target) {
            current.target.blur();
        }
        sessionRef.current = null;
        setSession(null);
    }, []);

    useEffect(() => {
        const intercept = (event: Event) => {
            if (!shouldUseOnScreenKeyboard()) {
                return;
            }
            const element = editableFromTarget(event.target);
            if (!element) {
                return;
            }
            event.preventDefault();
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
        document.addEventListener("pointerdown", intercept, true);
        document.addEventListener("focusin", focusIn, true);
        const stopWatchingMode = onKeyboardModeChange(() => {
            if (!shouldUseOnScreenKeyboard()) {
                sessionRef.current = null;
                setSession(null);
            }
        });
        return () => {
            document.removeEventListener("pointerdown", intercept, true);
            document.removeEventListener("focusin", focusIn, true);
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
