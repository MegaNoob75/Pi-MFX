import { useEffect, useRef, useState } from "react";
import { findBank, findPreset, type EngineSnapshot } from "../api";
import { askText } from "../keyboard/ask";
import { arr, obj, str, objects, type JsonObject } from "../json";
import { MarqueeText } from "./MarqueeText";
import { LibraryJsonPicker } from "./LibraryManager";
import { NewPresetDialog } from "./NewPresetDialog";

type PresetDrag = {
    presetId: string;
    name: string;
    x: number;
    y: number;
};

export function BanksView({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const { client, state } = engine;
    const banks = objects(state.banks);
    const activeBank = findBank(state);
    const activePreset = findPreset(state);
    const presets = objects(obj(activeBank).presets);
    const [focused, setFocused] = useState<"banks" | "presets">("presets");
    const [cursorPreset, setCursorPreset] = useState("");
    const [confirm, setConfirm] = useState<"bank" | "preset" | null>(null);
    const [busy, setBusy] = useState(false);
    const [picker, setPicker] = useState<"load" | "save" | null>(null);
    const [saveContents, setSaveContents] = useState("");
    const [emptyBank, setEmptyBank] = useState<JsonObject | null>(null);
    const [toast, setToast] = useState("");
    const [presetDrag, setPresetDrag] = useState<PresetDrag | null>(null);
    const [dropBankId, setDropBankId] = useState("");
    const suppressPresetClickRef = useRef(false);

    const bankId = str(obj(activeBank).id);
    const presetId = str(obj(activePreset).id);
    const selectedPresetId = cursorPreset || presetId;
    const bankIndex = banks.findIndex((bank) => str(bank.id) === bankId);
    const presetIndex = presets.findIndex((preset) => str(preset.id) === selectedPresetId);
    const dirtyPresetIds = new Set(arr(state.sessionPresetDirtyIds).map((value) => str(value)));
    const deletingDirtyCount = confirm === "bank"
        ? presets.filter((preset) => dirtyPresetIds.has(str(preset.id))).length
        : dirtyPresetIds.has(selectedPresetId) ? 1 : 0;
    const focusPane = (pane: "banks" | "presets") => {
        setFocused(pane);
        client.updateUiSession({ banksFocus: pane });
    };

    useEffect(() => {
        const sharedFocus = str(engine.uiSession.banksFocus);
        if ((sharedFocus === "banks" || sharedFocus === "presets") && sharedFocus !== focused) {
            setFocused(sharedFocus);
        }
    }, [engine.uiSession.banksFocus]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || confirm)) {
                return;
            }
            if (!["ArrowDown", "ArrowUp", "Enter", "Delete"].includes(event.key)) {
                return;
            }
            event.preventDefault();
            if (event.key === "Delete") {
                setConfirm(focused === "banks" ? "bank" : "preset");
                return;
            }
            if (event.key === "Enter") {
                if (focused === "presets" && selectedPresetId) {
                    mutate(() => client.request("preset/select", { bankId, presetId: selectedPresetId }));
                }
                return;
            }
            const direction = event.key === "ArrowDown" ? 1 : -1;
            if (focused === "banks") {
                const next = banks[bankIndex + direction];
                if (next) {
                    selectBank(str(next.id));
                }
                return;
            }
            const nextPreset = presets[presetIndex + direction];
            if (nextPreset) {
                setCursorPreset(str(nextPreset.id));
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [banks, bankIndex, presets, presetIndex, focused, selectedPresetId, bankId, confirm, busy]);

    const mutate = (work: () => Promise<unknown>) => {
        if (busy) {
            return;
        }
        setBusy(true);
        void run(work).finally(() => setBusy(false));
    };

    const selectBank = (id: string) => {
        const bank = banks.find((item) => str(item.id) === id);
        if (!objects(obj(bank).presets).length) {
            setEmptyBank(obj(bank));
            setToast(`“${str(obj(bank).name, "This bank")}” has no presets.`);
            window.setTimeout(() => setToast(""), 2800);
            return;
        }
        mutate(() => client.request("bank/select", { bankId: id }));
    };

    const saveBankToPi = () => {
        if (!activeBank) {
            return;
        }
        mutate(async () => {
            const result = await client.request("bank/export", { bankId });
            setSaveContents(JSON.stringify(obj(result.bank), null, 2));
            setPicker("save");
        });
    };

    const defaultCloneName = () => {
        const base = str(obj(activeBank).name, "Bank");
        const names = new Set(banks.map((bank) => str(bank.name)));
        let candidate = `${base} Copy`;
        let number = 2;
        while (names.has(candidate)) {
            candidate = `${base} Copy ${number++}`;
        }
        return candidate;
    };

    const renameBank = () => {
        if (!activeBank || busy) {
            return;
        }
        void askText("Rename Bank", str(obj(activeBank).name)).then((value) => {
            const name = value?.trim();
            if (name) {
                mutate(() => client.request("bank/rename", { bankId, name }));
            }
        });
    };

    const createBank = () => {
        void askText("New Bank").then((value) => {
            const name = value?.trim();
            if (name) {
                mutate(() => client.request("bank/create", { name }));
            }
        });
    };

    const renamePreset = () => {
        const preset = obj(presets.find((item) => str(item.id) === selectedPresetId) ?? activePreset);
        if (!selectedPresetId || busy) {
            return;
        }
        void askText("Rename Preset", str(preset.name)).then((value) => {
            const name = value?.trim();
            if (name) {
                mutate(() => client.request("preset/rename", { presetId: selectedPresetId, name }));
            }
        });
    };

    const cloneBank = () => {
        if (!activeBank || busy) {
            return;
        }
        void askText("Clone Bank", defaultCloneName()).then((value) => {
            const name = value?.trim();
            if (name) {
                mutate(async () => {
                    const exported = await client.request("bank/export", { bankId });
                    await client.request("bank/import", {
                        bank: { ...obj(exported.bank), name, format: "pimfx-bank", formatVersion: 1 }
                    });
                });
            }
        });
    };

    const beginPresetDrag = (event: React.PointerEvent<HTMLElement>, preset: JsonObject, from: number) => {
        if (busy || event.button !== 0) {
            return;
        }
        event.preventDefault();
        const pointerId = event.pointerId;
        const originX = event.clientX;
        const originY = event.clientY;
        const presetDragId = str(preset.id);
        const presetName = str(preset.name, "Preset");
        const capture = event.currentTarget;
        let dragging = false;
        let targetBankId = "";
        let targetPresetIndex = from;
        capture.setPointerCapture(pointerId);

        const move = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== pointerId) {
                return;
            }
            if (!dragging && Math.hypot(moveEvent.clientX - originX, moveEvent.clientY - originY) < 6) {
                return;
            }
            dragging = true;
            suppressPresetClickRef.current = true;
            const over = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null;
            const bankEl = over?.closest("[data-bank-id]") as HTMLElement | null;
            const presetEl = over?.closest("[data-preset-index]") as HTMLElement | null;
            targetBankId = bankEl?.dataset.bankId ?? (presetEl ? bankId : "");
            targetPresetIndex = Number(presetEl?.dataset.presetIndex ?? from);
            setDropBankId(targetBankId);
            setPresetDrag({ presetId: presetDragId, name: presetName, x: moveEvent.clientX, y: moveEvent.clientY });
        };
        const finish = (finishEvent: PointerEvent) => {
            if (finishEvent.pointerId !== pointerId) {
                return;
            }
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", finish);
            window.removeEventListener("pointercancel", finish);
            setPresetDrag(null);
            setDropBankId("");
            if (!dragging) {
                setCursorPreset(presetDragId);
                return;
            }
            window.setTimeout(() => { suppressPresetClickRef.current = false; }, 0);
            if (targetBankId && targetBankId !== bankId) {
                mutate(() => client.request("preset/move", {
                    presetId: presetDragId,
                    bankId: targetBankId,
                    index: 0
                }));
                return;
            }
            if (targetBankId === bankId && Number.isInteger(targetPresetIndex) && targetPresetIndex !== from) {
                mutate(() => client.request("preset/reorder", {
                    presetId: presetDragId,
                    index: targetPresetIndex
                }));
            }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
    };

    return (
        <div className="split-panes">
            <section className={`split-pane${focused === "banks" ? " is-nav-focused" : ""}`}
                onPointerDown={() => focusPane("banks")}>
                <div className="split-pane-title">BANKS</div>
                <div className="split-tools">
                    <button type="button" className="btn" disabled={!activeBank || busy} onClick={cloneBank}>CLONE</button>
                    <button type="button" className="btn" disabled={!activeBank || busy} onClick={saveBankToPi}>SAVE</button>
                    <button type="button" className="btn" disabled={busy} onClick={() => setPicker("load")}>LOAD</button>
                </div>
                <div className="split-toolbar">
                    <button type="button" className="btn" disabled={busy} onClick={createBank}>NEW</button>
                    <button type="button" className="btn" disabled={!activeBank || busy} onClick={renameBank}>RENAME</button>
                    <button type="button" className="btn" disabled={bankIndex <= 0 || busy} onClick={() => {
                        mutate(() => client.request("bank/reorder", { bankId, index: bankIndex - 1 }));
                    }}>↑</button>
                    <button type="button" className="btn" disabled={bankIndex < 0 || bankIndex >= banks.length - 1 || busy} onClick={() => {
                        mutate(() => client.request("bank/reorder", { bankId, index: bankIndex + 1 }));
                    }}>↓</button>
                    <button type="button" className="btn btn-danger" disabled={!activeBank || busy} onClick={() => setConfirm("bank")}>DELETE</button>
                    {busy && <span className="muted">Updating…</span>}
                </div>
                <div className="split-list" data-mfx-nav-list="banks">
                    {banks.map((bank) => (
                        <button
                            key={str(bank.id)}
                            type="button"
                            data-bank-id={str(bank.id)}
                            data-mfx-nav-key={`bank:${str(bank.id)}`}
                            className={`split-row${str(bank.id) === bankId || (focused === "banks" && str(bank.id) === bankId) ? " selected" : ""}${dropBankId === str(bank.id) ? " preset-drop-target" : ""}`}
                            onClick={() => selectBank(str(bank.id))}
                        >
                            <MarqueeText text={str(bank.name)} align="left" fontWeight={800} />
                        </button>
                    ))}
                </div>
            </section>

            <section className={`split-pane${focused === "presets" ? " is-nav-focused" : ""}`}
                onPointerDown={() => focusPane("presets")}>
                <div className="split-pane-title">PRESETS</div>
                <div className="split-toolbar">
                    <button type="button" className="btn" disabled={!activePreset || busy} onClick={renamePreset}>RENAME</button>
                    <button type="button" className="btn" disabled={presetIndex <= 0 || busy} onClick={() => {
                        mutate(() => client.request("preset/reorder", { presetId: selectedPresetId, index: presetIndex - 1 }));
                    }}>↑</button>
                    <button type="button" className="btn" disabled={presetIndex < 0 || presetIndex >= presets.length - 1 || busy} onClick={() => {
                        mutate(() => client.request("preset/reorder", { presetId: selectedPresetId, index: presetIndex + 1 }));
                    }}>↓</button>
                    <button type="button" className="btn btn-danger" disabled={!selectedPresetId || busy} onClick={() => setConfirm("preset")}>DELETE</button>
                </div>
                <div className="split-list" data-mfx-nav-list="presets">
                    {presets.map((preset, index) => (
                        <div
                            key={str(preset.id)}
                            className={`split-row split-row-drag${str(preset.id) === selectedPresetId ? " selected" : ""}`}
                            data-preset-index={index}
                            data-mfx-nav-key={`preset:${str(preset.id)}`}
                            data-preset-dragging={presetDrag?.presetId === str(preset.id) ? "true" : undefined}
                            onPointerDown={(event) => beginPresetDrag(event, preset, index)}
                            onClick={() => {
                                if (!suppressPresetClickRef.current) {
                                    setCursorPreset(str(preset.id));
                                }
                            }}
                            onDoubleClick={() => mutate(() => client.request("preset/select", {
                                bankId,
                                presetId: str(preset.id)
                            }))}
                        >
                            <span
                                className="split-row-handle"
                                aria-hidden="true"
                            >
                                ☰
                            </span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                                <MarqueeText text={str(preset.name)} align="left" fontWeight={800} />
                            </span>
                        </div>
                    ))}
                </div>
            </section>

            {presetDrag && (
                <div
                    className="preset-drag-ghost"
                    style={{ transform: `translate3d(${presetDrag.x + 14}px, ${presetDrag.y + 14}px, 0)` }}
                    aria-hidden="true"
                >
                    <span className="split-row-handle">☰</span>
                    <MarqueeText text={presetDrag.name} align="left" fontWeight={800} />
                </div>
            )}

            {confirm && (
                <div className="mfx-overlay">
                    <div className="mfx-overlay-card">
                        <div className="mfx-overlay-title danger">
                            {confirm === "bank"
                                ? `Delete bank “${str(obj(activeBank).name)}”?`
                                : `Delete preset “${str(obj(presets.find((item) => str(item.id) === selectedPresetId) ?? activePreset).name)}”?`}
                        </div>
                        {deletingDirtyCount > 0 && (
                            <div className="danger" style={{ marginBottom: 12 }}>
                                {deletingDirtyCount} preset{deletingDirtyCount === 1 ? " has" : "s have"} unsaved live changes that will be lost.
                            </div>
                        )}
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                            <button type="button" className="btn" onClick={() => setConfirm(null)}>CANCEL</button>
                            <button type="button" className="btn btn-danger" onClick={() => {
                                const kind = confirm;
                                setConfirm(null);
                                if (kind === "bank") {
                                    mutate(() => client.request("bank/delete", { bankId }));
                                } else {
                                    mutate(() => client.request("preset/delete", { presetId: selectedPresetId }));
                                }
                            }}>DELETE</button>
                        </div>
                    </div>
                </div>
            )}
            {emptyBank && (
                <NewPresetDialog
                    banks={[emptyBank, ...banks.filter((item) => str(item.id) !== str(emptyBank.id))]}
                    defaultBankId={str(emptyBank.id)}
                    onCancel={() => setEmptyBank(null)}
                    onCreate={(name, createBankId) => {
                        setEmptyBank(null);
                        mutate(() => client.request("preset/create", { name, bankId: createBankId }));
                    }}
                />
            )}
            {picker && (
                <LibraryJsonPicker
                    engine={engine}
                    run={run}
                    kind="bank"
                    mode={picker}
                    title={picker === "save" ? "SAVE BANK" : "LOAD BANK"}
                    defaultName={str(obj(activeBank).name, "bank")}
                    contents={picker === "save" ? saveContents : undefined}
                    onClose={() => setPicker(null)}
                    onLoad={(parsed) => {
                        mutate(() => client.request("bank/import", { bank: parsed }));
                    }}
                />
            )}
            {toast && <div className="toast toast-ok" role="status" onClick={() => setToast("")}>{toast}</div>}
        </div>
    );
}
