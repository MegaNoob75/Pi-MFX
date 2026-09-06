import { useMemo, useState } from "react";
import { controlValue, type EngineSnapshot } from "../api";
import { arr, bool, num, obj, str, objects } from "../json";

export function EditorView({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const { client, state, catalog, library } = engine;
    const chain = objects(state.chain);
    const plugins = objects(catalog.plugins);
    const [selectedId, setSelectedId] = useState("");
    const [browserOpen, setBrowserOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("");

    const selected = chain.find((slot) => str(slot.id) === selectedId) ?? chain[0];
    const plugin = obj(obj(selected).plugin);
    const ports = objects(plugin.ports).filter((port) => str(port.kind) === "control" && bool(port.input, true));
    const properties = objects(plugin.properties);
    const models = objects(library.models);
    const irs = objects(library.impulseResponses);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return plugins.filter((item) => {
            if (category && str(item.category) !== category) {
                return false;
            }
            if (!needle) {
                return true;
            }
            const haystack = `${str(item.name)} ${str(item.brand)} ${str(item.category)}`.toLowerCase();
            return haystack.includes(needle);
        });
    }, [plugins, query, category]);

    const categoryNames = useMemo(() => {
        const names = new Set<string>();
        for (const name of arr(catalog.categories)) {
            if (typeof name === "string" && name) {
                names.add(name);
            }
        }
        for (const item of plugins) {
            if (str(item.category)) {
                names.add(str(item.category));
            }
        }
        return [...names].sort();
    }, [catalog.categories, plugins]);

    return (
        <div className="page-scroll stack">
            <div className="panel">
                <h2>CHAIN</h2>
                <div className="chain">
                    {chain.map((slot, index) => {
                        const info = obj(slot.plugin);
                        const on = bool(slot.enabled, true);
                        return (
                            <button
                                key={str(slot.id)}
                                type="button"
                                className={`chain-slot${str(obj(selected).id) === str(slot.id) ? " selected" : ""}${on ? "" : " off"}`}
                                onClick={() => setSelectedId(str(slot.id))}
                            >
                                <div className="field-label">{on ? "ON" : "OFF"}</div>
                                <strong>{str(info.name, str(slot.uri))}</strong>
                                <div className="muted">{str(info.brand) || str(info.category)}</div>
                                <div className="muted">#{index + 1}</div>
                            </button>
                        );
                    })}
                    <button type="button" className="chain-slot chain-add" onClick={() => setBrowserOpen(true)}>
                        + ADD
                    </button>
                </div>
            </div>

            {selected && (
                <div className="panel stack">
                    <div className="row">
                        <h2 style={{ margin: 0 }}>{str(plugin.name, "Effect")}</h2>
                        <button
                            type="button"
                            className={`btn ${bool(selected.enabled, true) ? "btn-active" : ""}`}
                            onClick={() => void run(() => client.request("chain/enable", {
                                slotId: str(selected.id),
                                enabled: !bool(selected.enabled, true)
                            }))}
                        >
                            {bool(selected.enabled, true) ? "ENABLED" : "BYPASSED"}
                        </button>
                        <button type="button" className="btn" onClick={() => {
                            const from = chain.findIndex((slot) => str(slot.id) === str(selected.id));
                            if (from > 0) {
                                void run(() => client.request("chain/move", { slotId: str(selected.id), index: from - 1 }));
                            }
                        }}>←</button>
                        <button type="button" className="btn" onClick={() => {
                            const from = chain.findIndex((slot) => str(slot.id) === str(selected.id));
                            if (from >= 0 && from < chain.length - 1) {
                                void run(() => client.request("chain/move", { slotId: str(selected.id), index: from + 1 }));
                            }
                        }}>→</button>
                        <button type="button" className="btn btn-danger" onClick={() => {
                            if (window.confirm(`Remove ${str(plugin.name, "this effect")}?`)) {
                                void run(() => client.request("chain/remove", { slotId: str(selected.id) }));
                            }
                        }}>REMOVE</button>
                    </div>

                    {ports.length === 0 && (
                        <div className="muted">This plugin has no control ports, or LV2 is not available on this build.</div>
                    )}
                    <div className="control-grid">
                        {ports.map((port) => {
                            const symbol = str(port.symbol);
                            const min = num(port.min, 0);
                            const max = num(port.max, 1);
                            const value = controlValue(selected, symbol, num(port.default, min));
                            const stepped = bool(port.integer) || bool(port.toggled);
                            return (
                                <label key={symbol} className="control-card field">
                                    <span>{str(port.name, symbol)} <span className="muted">{value.toFixed(stepped ? 0 : 2)}</span></span>
                                    {bool(port.toggled) ? (
                                        <button
                                            type="button"
                                            className={`btn ${value >= 0.5 ? "btn-active" : ""}`}
                                            onClick={() => void run(() => client.request("chain/control", {
                                                slotId: str(selected.id),
                                                port: symbol,
                                                value: value >= 0.5 ? 0 : 1
                                            }))}
                                        >
                                            {value >= 0.5 ? "ON" : "OFF"}
                                        </button>
                                    ) : (
                                        <input
                                            type="range"
                                            min={min}
                                            max={max}
                                            step={bool(port.integer) ? 1 : (max - min) / 200}
                                            value={value}
                                            onChange={(event) => {
                                                const next = Number(event.target.value);
                                                void run(() => client.request("chain/control", {
                                                    slotId: str(selected.id),
                                                    port: symbol,
                                                    value: next
                                                }));
                                            }}
                                        />
                                    )}
                                </label>
                            );
                        })}
                    </div>

                    {properties.filter((property) => bool(property.isPath)).map((property) => {
                        const files = bool(plugin.takesImpulseResponse) ? irs : models;
                        const current = str(obj(obj(selected.state).properties)[str(property.uri)]);
                        return (
                            <label key={str(property.uri)} className="field">
                                <span>{str(property.label, "File")}</span>
                                <select
                                    value={current}
                                    onChange={(event) => void run(() => client.request("chain/property", {
                                        slotId: str(selected.id),
                                        property: str(property.uri),
                                        path: event.target.value
                                    }))}
                                >
                                    <option value="">None</option>
                                    {files.map((file) => (
                                        <option key={str(file.path)} value={str(file.path)}>{str(file.name)}</option>
                                    ))}
                                </select>
                            </label>
                        );
                    })}
                </div>
            )}

            {browserOpen && (
                <div className="dialog-backdrop" onClick={() => setBrowserOpen(false)}>
                    <div className="dialog" onClick={(event) => event.stopPropagation()}>
                        <h2>ADD PLUGIN</h2>
                        <div className="row">
                            <label className="field">
                                <span>Search</span>
                                <input value={query} onChange={(event) => setQuery(event.target.value)} />
                            </label>
                            <label className="field">
                                <span>Category</span>
                                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                                    <option value="">All</option>
                                    {categoryNames.map((name) => (
                                        <option key={name} value={name}>{name}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                        <div className="plugin-list">
                            {filtered.map((item) => (
                                <button
                                    key={str(item.uri)}
                                    type="button"
                                    className="plugin-row"
                                    onClick={() => {
                                        void run(() => client.request("chain/add", { uri: str(item.uri), index: -1 }));
                                        setBrowserOpen(false);
                                    }}
                                >
                                    {str(item.name)}
                                    <small>{[str(item.brand), str(item.category)].filter(Boolean).join(" · ")}</small>
                                </button>
                            ))}
                            {filtered.length === 0 && <div className="muted">No plugins match.</div>}
                        </div>
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                            <button type="button" className="btn" onClick={() => setBrowserOpen(false)}>CLOSE</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
