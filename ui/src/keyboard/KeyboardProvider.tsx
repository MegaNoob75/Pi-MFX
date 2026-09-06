import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, type KeyboardSession } from "./Keyboard";
import { shouldUseOnScreenKeyboard } from "./mode";
import { commitValue, editableFromTarget, inferLabel, inferLayout, type EditableElement } from "./utils";

export function KeyboardProvider() {
    const [session, setSession] = useState<KeyboardSession | null>(null);
    const nextId = useRef(0);
    const savedMode = useRef(new WeakMap<EditableElement, string | null>());

    const suppressOsKeyboard = useCallback((element: EditableElement) => {
        if (savedMode.current.has(element)) {
            return;
        }
        savedMode.current.set(element, element.getAttribute("inputmode"));
        element.setAttribute("inputmode", "none");
    }, []);

    const open = useCallback((element: EditableElement) => {
        if (!shouldUseOnScreenKeyboard()) {
            return;
        }
        suppressOsKeyboard(element);
        let start = element.value.length;
        let end = start;
        try {
            start = element.selectionStart ?? start;
            end = element.selectionEnd ?? start;
        } catch {
            // number inputs hide selection
        }
        setSession({
            id: ++nextId.current,
            target: element,
            label: inferLabel(element),
            layout: inferLayout(element),
            value: element.value,
            selectionStart: start,
            selectionEnd: end
        });
    }, [suppressOsKeyboard]);

    const close = useCallback((current: KeyboardSession) => {
        const previous = savedMode.current.get(current.target);
        if (previous === undefined) {
            // already restored
        } else if (previous === null) {
            current.target.removeAttribute("inputmode");
        } else {
            current.target.setAttribute("inputmode", previous);
        }
        savedMode.current.delete(current.target);
        current.target.blur();
        setSession(null);
    }, []);

    useEffect(() => {
        const pointerDown = (event: PointerEvent) => {
            if (!shouldUseOnScreenKeyboard()) {
                return;
            }
            const element = editableFromTarget(event.target);
            if (element) {
                suppressOsKeyboard(element);
            }
        };
        const focusIn = (event: FocusEvent) => {
            const element = editableFromTarget(event.target);
            if (element) {
                open(element);
            }
        };
        document.addEventListener("pointerdown", pointerDown, true);
        document.addEventListener("focusin", focusIn, true);
        return () => {
            document.removeEventListener("pointerdown", pointerDown, true);
            document.removeEventListener("focusin", focusIn, true);
        };
    }, [open, suppressOsKeyboard]);

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
