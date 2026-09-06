import { findBank, findPreset, type EngineSnapshot } from "../api";
import { obj, str, objects } from "../json";

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

    const ask = (message: string, fallback = "") => {
        const value = window.prompt(message, fallback);
        return value?.trim() ?? "";
    };

    return (
        <div className="page-scroll stack">
            <div className="panel">
                <h2>BANKS</h2>
                <div className="row">
                    <button type="button" className="btn btn-accent" onClick={() => {
                        const name = ask("New bank name", "Bank");
                        if (name) {
                            void run(() => client.request("bank/create", { name }));
                        }
                    }}>NEW BANK</button>
                    <button type="button" className="btn" disabled={!activeBank} onClick={() => {
                        const name = ask("Rename bank", str(obj(activeBank).name));
                        if (name && activeBank) {
                            void run(() => client.request("bank/rename", { bankId: str(activeBank.id), name }));
                        }
                    }}>RENAME</button>
                    <button type="button" className="btn btn-danger" disabled={banks.length < 2} onClick={() => {
                        if (activeBank && window.confirm(`Delete bank “${str(activeBank.name)}”?`)) {
                            void run(() => client.request("bank/delete", { bankId: str(activeBank.id) }));
                        }
                    }}>DELETE</button>
                </div>
                <div className="stack" style={{ marginTop: 10 }}>
                    {banks.map((bank) => (
                        <button
                            key={str(bank.id)}
                            type="button"
                            className={`list-item${str(bank.id) === str(state.activeBankId) ? " selected" : ""}`}
                            onClick={() => {
                                const first = objects(bank.presets)[0];
                                if (first) {
                                    void run(() => client.request("preset/select", {
                                        bankId: str(bank.id),
                                        presetId: str(first.id)
                                    }));
                                }
                            }}
                        >
                            <strong>{str(bank.name)}</strong>
                            <span className="muted">{objects(bank.presets).length} presets</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="panel">
                <h2>PRESETS</h2>
                <div className="row">
                    <button type="button" className="btn btn-accent" onClick={() => {
                        const name = ask("New preset name", "Untitled");
                        if (name) {
                            void run(() => client.request("preset/saveAs", { name }));
                        }
                    }}>SAVE AS</button>
                    <button type="button" className="btn" onClick={() => void run(() => client.request("preset/save"))}>
                        SAVE
                    </button>
                    <button type="button" className="btn" disabled={!activePreset} onClick={() => {
                        const name = ask("Rename preset", str(obj(activePreset).name));
                        if (name && activePreset) {
                            void run(() => client.request("preset/rename", { presetId: str(activePreset.id), name }));
                        }
                    }}>RENAME</button>
                    <button type="button" className="btn btn-danger" disabled={presets.length < 2} onClick={() => {
                        if (activePreset && window.confirm(`Delete preset “${str(activePreset.name)}”?`)) {
                            void run(() => client.request("preset/delete", { presetId: str(activePreset.id) }));
                        }
                    }}>DELETE</button>
                </div>
                <div className="stack" style={{ marginTop: 10 }}>
                    {presets.map((preset) => (
                        <button
                            key={str(preset.id)}
                            type="button"
                            className={`list-item${str(preset.id) === str(state.activePresetId) ? " selected" : ""}`}
                            onClick={() => void run(() => client.request("preset/select", {
                                bankId: str(state.activeBankId),
                                presetId: str(preset.id)
                            }))}
                        >
                            <strong>{str(preset.name)}</strong>
                            <span className="muted">{objects(preset.chain).length} effects</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
