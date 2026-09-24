import { useCallback, useEffect, useRef, useState } from "react";
import { ASK_EVENT, DISMISS_KEYBOARD_EVENT, type AskRequest } from "./ask";
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
    suppressSystemKeyboard,
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
    const [ask, setAsk] = useState<AskRequest | null>(null);
    const [askValue, setAskValue] = useState("");
    const sessionRef = useRef<KeyboardSession | null>(null);
    const nextId = useRef(0);
    sessionRef.current = session;

    const finishingRef = useRef(false);

    const finish = useCallback((current: KeyboardSession, value: string | null) => {
        if (sessionRef.current?.id !== current.id) {
            return;
        }
        sessionRef.current = null;
        finishingRef.current = true;
        const resolve = current.resolve;
        current.resolve = undefined;
        try {
            if (value !== null && current.target) {
                commitValue(current.target, value);
                if (ask) {
                    setAskValue(value);
                }
                current.target.blur();
            }
            setSession(null);
            resolve?.(value);
        } finally {
            finishingRef.current = false;
        }
    }, [ask]);

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

    const closeAsk = useCallback((value: string | null) => {
        const current = sessionRef.current;
        if (current) {
            finish(current, null);
        }
        setAsk((request) => {
            request?.resolve(value);
            return null;
        });
        setAskValue("");
    }, [finish]);

    const openPrompt = useCallback((request: AskRequest) => {
        const current = sessionRef.current;
        if (current) {
            finish(current, null);
        }
        setAsk((previous) => {
            previous?.resolve(null);
            return request;
        });
        setAskValue(request.value);
    }, [finish]);

    useEffect(() => {
        const armTree = (root: ParentNode = document) => {
            const usePiKeyboard = shouldUseOnScreenKeyboard();
            forEachSupportedEditable(root, usePiKeyboard ? hideSystemKeyboard : suppressSystemKeyboard);
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
            open(element);
        };

        const focusIn = (event: FocusEvent) => {
            if (finishingRef.current || !shouldUseOnScreenKeyboard()) {
                return;
            }
            const element = editableFromTarget(event.target);
            if (!element) {
                return;
            }
            open(element);
        };

        const onAsk = (event: Event) => {
            const request = (event as CustomEvent<AskRequest>).detail;
            if (request) {
                openPrompt(request);
            }
        };

        const onDismiss = () => {
            const current = sessionRef.current;
            if (current) {
                finish(current, null);
            }
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
        window.addEventListener(ASK_EVENT, onAsk);
        window.addEventListener(DISMISS_KEYBOARD_EVENT, onDismiss);

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
                forEachSupportedEditable(document, (element) => {
                    disarmForOnScreenKeyboard(element);
                    suppressSystemKeyboard(element);
                });
                const current = sessionRef.current;
                if (current) {
                    finish(current, null);
                }
            }
        });

        return () => {
            document.removeEventListener("pointerdown", intercept, true);
            document.removeEventListener("mousedown", intercept, true);
            document.removeEventListener("touchstart", intercept, true);
            document.removeEventListener("focusin", focusIn, true);
            window.removeEventListener(ASK_EVENT, onAsk);
            window.removeEventListener(DISMISS_KEYBOARD_EVENT, onDismiss);
            observer.disconnect();
            stopWatchingMode();
        };
    }, [finish, open, openPrompt]);

    return (
        <>
            {ask && (
                <div className="mfx-overlay" onClick={() => closeAsk(null)}>
                    <div className="mfx-overlay-card" onClick={(event) => event.stopPropagation()}>
                        <div className="mfx-overlay-title">{ask.label}</div>
                        <input
                            className="input"
                            value={askValue}
                            data-pimfx-keyboard-layout={ask.layout}
                            onChange={(event) => setAskValue(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    closeAsk(askValue);
                                }
                                if (event.key === "Escape") {
                                    closeAsk(null);
                                }
                            }}
                        />
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                            <button type="button" className="btn" onClick={() => closeAsk(null)}>CANCEL</button>
                            <button type="button" className="btn btn-accent" onClick={() => closeAsk(askValue)}>
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {session && (
                <Keyboard
                    key={session.id}
                    session={session}
                    onCancel={() => {
                        finish(session, null);
                        if (ask) {
                            closeAsk(null);
                        }
                    }}
                    onDone={(value) => finish(session, value)}
                />
            )}
        </>
    );
}
