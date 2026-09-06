import { useState } from "react";
import { findBank, findPreset, type EngineSnapshot } from "../api";
import { obj, str, objects, type JsonObject } from "../json";
import { askText } from "../keyboard/ask";

type EditState = {
    mode: "newBank" | "renameBank" | "renamePreset" | "cloneBank";
    title: string;
    value: string;
} | null;

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
    const [edit, setEdit] = useState<EditState>(null);
    const [confirm, setConfirm] = useState<"bank" | "preset" | null>(null);
    const [busy, setBusy] = useState(false);

    const bankId = str(obj(activeBank).id);
    const presetId = str(obj(activePreset).id);
    const bankIndex = banks.findIndex((bank) => str(bank.id) === bankId);
    const presetIndex = presets.findIndex((preset) => str(preset.id) === presetId);

    const mutate = (work: () => Promise<unknown>) => {
        if (busy) {
            return;
        }
        setBusy(true);
        void run(work).finally(() => setBusy(false));
    };

    const selectBank = (id: string) => {
        const bank = banks.find((item) => str(item.id) === id);
        const first = objects(obj(bank).presets)[0];
        if (first) {
            mutate(() => client.request("preset/select", {
                bankId: id,
                presetId: str(first.id)
            }));
        }
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

    const submitEdit = () => {
        if (!edit) {
            return;
        }
        const name = edit.value.trim();
        if (!name) {
            return;
        }
        if (edit.mode === "newBank") {
            mutate(() => client.request("bank/create", { name }));
        } else if (edit.mode === "renameBank" && activeBank) {
            mutate(() => client.request("bank/rename", { bankId, name }));
        } else if (edit.mode === "renamePreset" && activePreset) {
            mutate(() => client.request("preset/rename", { presetId, name }));
        } else if (edit.mode === "cloneBank" && activeBank) {
            mutate(async () => {
                const exported = await client.request("bank/export", { bankId });
                await client.request("bank/import", {
                    bank: { ...obj(exported.bank), name, format: "pimfx-bank", formatVersion: 1 }
                });
            });
        }
        setEdit(null);
    };

    const downloadBank = () => {
        if (!activeBank) {
            return;
        }
        mutate(async () => {
            const result = await client.request("bank/export", { bankId });
            const blob = new Blob([JSON.stringify(result.bank, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${str(activeBank.name, "bank")}.pimfx-bank.json`;
            link.click();
            URL.revokeObjectURL(url);
        });
    };

    return (
        <div className="split-panes">
            <section className="split-pane" onPointerDown={() => setFocused("banks")}>
                <div className="split-tools">
                    <button type="button" className="btn" disabled={!activeBank || busy} onClick={() => {
                        setEdit({ mode: "cloneBank", title: "Clone Bank", value: defaultCloneName() });
                    }}>CLONE</button>
                    <button type="button" className="btn" disabled={!activeBank || busy} onClick={downloadBank}>DOWNLOAD</button>
                    <label className="btn btn-accent">
                        UPLOAD
                        <input type="file" accept="application/json,.json,.pimfx-bank.json" hidden disabled={busy} onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file) {
                                return;
                            }
                            void file.text().then((text) => {
                                const bank = JSON.parse(text) as JsonObject;
                                mutate(() => client.request("bank/import", { bank }));
                            });
                            event.target.value = "";
                        }} />
                    </label>
                </div>
                <div className="split-toolbar">
                    <button type="button" className="btn" disabled={busy} onClick={() => setEdit({ mode: "newBank", title: "New Bank", value: "" })}>NEW</button>
                    <button type="button" className="btn" disabled={!activeBank || busy} onClick={() => {
                        setEdit({ mode: "renameBank", title: "Rename Bank", value: str(obj(activeBank).name) });
                    }}>RENAME</button>
                    <button type="button" className="btn" disabled={bankIndex <= 0 || busy} onClick={() => {
                        mutate(() => client.request("bank/reorder", { bankId, index: bankIndex - 1 }));
                    }}>↑</button>
                    <button type="button" className="btn" disabled={bankIndex < 0 || bankIndex >= banks.length - 1 || busy} onClick={() => {
                        mutate(() => client.request("bank/reorder", { bankId, index: bankIndex + 1 }));
                    }}>↓</button>
                    <button type="button" className="btn btn-danger" disabled={banks.length < 2 || busy} onClick={() => setConfirm("bank")}>DELETE</button>
                    {busy && <span className="muted">Updating…</span>}
                </div>
                <div className="split-list">
                    {banks.map((bank) => (
                        <button
                            key={str(bank.id)}
                            type="button"
                            className={`split-row${str(bank.id) === bankId || (focused === "banks" && str(bank.id) === bankId) ? " selected" : ""}`}
                            onClick={() => selectBank(str(bank.id))}
                        >
                            {str(bank.name)}
                        </button>
                    ))}
                </div>
            </section>

            <section className="split-pane" onPointerDown={() => setFocused("presets")}>
                <div className="split-toolbar">
                    <button type="button" className="btn btn-accent" disabled={busy} onClick={() => {
                        void askText("New preset name", "Untitled").then((name) => {
                            if (name?.trim()) {
                                mutate(() => client.request("preset/saveAs", { name: name.trim() }));
                            }
                        });
                    }}>SAVE AS</button>
                    <button type="button" className="btn" disabled={!activePreset || busy} onClick={() => {
                        setEdit({ mode: "renamePreset", title: "Rename Preset", value: str(obj(activePreset).name) });
                    }}>RENAME</button>
                    <button type="button" className="btn" disabled={presetIndex <= 0 || busy} onClick={() => {
                        mutate(() => client.request("preset/reorder", { presetId, index: presetIndex - 1 }));
                    }}>↑</button>
                    <button type="button" className="btn" disabled={presetIndex < 0 || presetIndex >= presets.length - 1 || busy} onClick={() => {
                        mutate(() => client.request("preset/reorder", { presetId, index: presetIndex + 1 }));
                    }}>↓</button>
                    <button type="button" className="btn btn-danger" disabled={presets.length < 2 || busy} onClick={() => setConfirm("preset")}>DELETE</button>
                </div>
                <div className="split-list">
                    {presets.map((preset) => (
                        <button
                            key={str(preset.id)}
                            type="button"
                            className={`split-row${str(preset.id) === presetId ? " selected" : ""}`}
                            onClick={() => mutate(() => client.request("preset/select", {
                                bankId,
                                presetId: str(preset.id)
                            }))}
                        >
                            {str(preset.name)}
                        </button>
                    ))}
                </div>
            </section>

            {edit && (
                <div className="mfx-overlay" onClick={() => !busy && setEdit(null)}>
                    <div className="mfx-overlay-card" onClick={(event) => event.stopPropagation()}>
                        <div className="mfx-overlay-title">{edit.title}</div>
                        {edit.mode === "cloneBank" && (
                            <div className="muted">Copy this bank with its presets and Performance switch assignments.</div>
                        )}
                        <input
                            className="input"
                            autoFocus
                            value={edit.value}
                            disabled={busy}
                            onChange={(event) => setEdit({ ...edit, value: event.target.value })}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    submitEdit();
                                }
                                if (event.key === "Escape") {
                                    setEdit(null);
                                }
                            }}
                        />
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                            <button type="button" className="btn" disabled={busy} onClick={() => setEdit(null)}>CANCEL</button>
                            <button type="button" className="btn btn-accent" disabled={busy} onClick={submitEdit}>
                                {edit.mode === "cloneBank" ? (busy ? "CLONING..." : "CLONE") : "SAVE"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {confirm && (
                <div className="mfx-overlay">
                    <div className="mfx-overlay-card">
                        <div className="mfx-overlay-title danger">
                            {confirm === "bank"
                                ? `Delete bank “${str(obj(activeBank).name)}”?`
                                : `Delete preset “${str(obj(activePreset).name)}”?`}
                        </div>
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                            <button type="button" className="btn" onClick={() => setConfirm(null)}>CANCEL</button>
                            <button type="button" className="btn btn-danger" onClick={() => {
                                const kind = confirm;
                                setConfirm(null);
                                if (kind === "bank") {
                                    mutate(() => client.request("bank/delete", { bankId }));
                                } else {
                                    mutate(() => client.request("preset/delete", { presetId }));
                                }
                            }}>DELETE</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
