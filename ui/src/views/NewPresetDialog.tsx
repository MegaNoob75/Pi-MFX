import { useState } from "react";
import { dismissOnScreenKeyboard } from "../keyboard/ask";
import { str, objects, type JsonObject } from "../json";

export function NewPresetDialog({
    banks,
    defaultBankId,
    defaultName = "Untitled",
    onCancel,
    onCreate
}: {
    banks: JsonObject[];
    defaultBankId: string;
    defaultName?: string;
    onCancel: () => void;
    onCreate: (name: string, bankId: string) => void;
}) {
    const [name, setName] = useState(defaultName);
    const [bankId, setBankId] = useState(defaultBankId || str(objects(banks)[0]?.id));

    const close = () => {
        dismissOnScreenKeyboard();
        onCancel();
    };

    return (
        <div className="mfx-overlay" onClick={close}>
            <div className="mfx-overlay-card" onClick={(event) => event.stopPropagation()}>
                <div className="mfx-overlay-title">NEW PRESET</div>
                <label className="field">
                    <span>Name</span>
                    <input
                        className="input"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && name.trim()) {
                                onCreate(name.trim(), bankId);
                            }
                            if (event.key === "Escape") {
                                close();
                            }
                        }}
                    />
                </label>
                <label className="field">
                    <span>Bank</span>
                    <select
                        value={bankId}
                        onChange={(event) => setBankId(event.target.value)}
                    >
                        {banks.map((bank) => (
                            <option key={str(bank.id)} value={str(bank.id)}>
                                {str(bank.name, str(bank.id))}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                    <button type="button" className="btn" onClick={close}>CANCEL</button>
                    <button
                        type="button"
                        className="btn btn-accent"
                        disabled={!name.trim() || !bankId}
                        onClick={() => onCreate(name.trim(), bankId)}
                    >
                        CREATE
                    </button>
                </div>
            </div>
        </div>
    );
}
