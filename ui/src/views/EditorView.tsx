import { useState } from "react";
import { controlValue, type EngineSnapshot } from "../api";
import { arr, bool, isObj, num, obj, str, objects, type JsonObject } from "../json";
import { askText } from "../keyboard/ask";
import { PluginBrowser } from "./PluginBrowser";

type EditPage = "chain" | "controls" | "bindings";

export function EditorView({
    engine,
    run,
    lockChain = false
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    lockChain?: boolean;
}) {
    const { client, state, catalog, library } = engine;
    const chain = objects(state.chain);
    const plugins = objects(catalog.plugins);
    const [selectedId, setSelectedId] = useState("");
    const [page, setPage] = useState<EditPage>("chain");
    const [browser, setBrowser] = useState<{ mode: "add" | "replace"; index: number } | null>(null);

    const selected = chain.find((slot) => str(slot.id) === selectedId) ?? chain[0];
    const plugin = obj(obj(selected).plugin);
    const ports = objects(plugin.ports).filter((port) => str(port.kind) === "control" && bool(port.input, true));
    const properties = objects(plugin.properties);
    const models = objects(library.models);
    const irs = objects(library.impulseResponses);
    const controller = obj(state.controller);
    const controls = objects(controller.controls);

    const selectedIndex = chain.findIndex((slot) => str(slot.id) === str(obj(selected).id));

    return (
        <div className={lockChain ? "stack" : "page-scroll stack"}>
            {!lockChain && (
                <div className="panel stack">
                    <div className="row">
                        <button type="button" className="btn btn-accent" onClick={() => void run(() => client.request("preset/save"))}>
                            SAVE PRESET
                        </button>
                        <button type="button" className="btn" onClick={() => {
                            void askText("Save preset as", "").then((name) => {
                                if (name?.trim()) {
                                    void run(() => client.request("preset/saveAs", { name: name.trim() }));
                                }
                            });
                        }}>SAVE AS</button>
                    </div>
                </div>
            )}

            <div className="panel">
                <div className="row">
                    {(["chain", "controls", "bindings"] as EditPage[]).map((item) => (
                        <button
                            key={item}
                            type="button"
                            className={`btn ${page === item ? "btn-active" : ""}`}
                            onClick={() => setPage(item)}
                            disabled={item !== "chain" && !selected}
                        >
                            {item === "chain" ? "CHAIN" : item === "controls" ? "CONTROLS" : "BINDINGS"}
                        </button>
                    ))}
                </div>
            </div>

            {page === "chain" && (
                <div className="panel">
                    <h2>CHAIN</h2>
                    {lockChain && (
                        <div className="muted" style={{ marginBottom: 8 }}>
                            Snapshot editing cannot add, remove or reorder effects.
                        </div>
                    )}
                    <div className="chain">
                        {chain.map((slot, index) => {
                            const info = obj(slot.plugin);
                            const on = bool(slot.enabled, true);
                            return (
                                <button
                                    key={str(slot.id)}
                                    type="button"
                                    className={`chain-slot${str(obj(selected).id) === str(slot.id) ? " selected" : ""}${on ? "" : " off"}`}
                                    onClick={() => {
                                        setSelectedId(str(slot.id));
                                        setPage("controls");
                                    }}
                                >
                                    <div className="field-label">{on ? "ON" : "OFF"}</div>
                                    <strong>{str(slot.name) || str(info.name, str(slot.uri))}</strong>
                                    <div className="muted">{str(info.brand) || str(info.category)}</div>
                                    <div className="muted">#{index + 1}</div>
                                </button>
                            );
                        })}
                        {!lockChain && (
                            <button type="button" className="chain-slot chain-add" onClick={() => setBrowser({ mode: "add", index: chain.length })}>
                                + ADD
                            </button>
                        )}
                    </div>
                </div>
            )}

            {page !== "chain" && selected && (
                <div className="panel stack">
                    <div className="row">
                        <h2 style={{ margin: 0 }}>{str(selected.name) || str(plugin.name, "Effect")}</h2>
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
                        {!lockChain && (
                            <>
                                <button type="button" className="btn" onClick={() => {
                                    void askText("Effect name", str(selected.name) || str(plugin.name)).then((name) => {
                                        if (name) {
                                            void run(() => client.request("chain/name", {
                                                slotId: str(selected.id),
                                                name
                                            }));
                                        }
                                    });
                                }}>RENAME</button>
                                <button type="button" className="btn" onClick={() => {
                                    if (selectedIndex > 0) {
                                        void run(() => client.request("chain/move", { slotId: str(selected.id), index: selectedIndex - 1 }));
                                    }
                                }}>←</button>
                                <button type="button" className="btn" onClick={() => {
                                    if (selectedIndex >= 0 && selectedIndex < chain.length - 1) {
                                        void run(() => client.request("chain/move", { slotId: str(selected.id), index: selectedIndex + 1 }));
                                    }
                                }}>→</button>
                                <button type="button" className="btn" onClick={() => setBrowser({ mode: "replace", index: selectedIndex })}>
                                    REPLACE
                                </button>
                                <button type="button" className="btn btn-danger" onClick={() => {
                                    if (window.confirm(`Remove ${str(plugin.name, "this effect")}?`)) {
                                        void run(() => client.request("chain/remove", { slotId: str(selected.id) }));
                                    }
                                }}>REMOVE</button>
                            </>
                        )}
                    </div>

                    {page === "controls" && (
                        <EffectControls
                            selected={selected}
                            ports={ports}
                            properties={properties}
                            plugin={plugin}
                            models={models}
                            irs={irs}
                            run={run}
                            client={client}
                        />
                    )}

                    {page === "bindings" && (
                        <BindingsPanel
                            selected={selected}
                            ports={ports}
                            controls={controls}
                            controller={controller}
                            run={run}
                            client={client}
                        />
                    )}
                </div>
            )}

            <PluginBrowser
                open={browser !== null}
                catalog={catalog}
                title={browser?.mode === "replace" ? "REPLACE EFFECT" : "ADD PLUGIN"}
                actionLabel={browser?.mode === "replace" ? "REPLACE" : "ADD"}
                onCancel={() => setBrowser(null)}
                onChoose={(uri) => {
                    const target = browser;
                    setBrowser(null);
                    if (!target) {
                        return;
                    }
                    void run(async () => {
                        if (target.mode === "replace" && selected) {
                            await client.request("chain/remove", { slotId: str(selected.id) });
                            await client.request("chain/add", { uri, index: target.index });
                        } else {
                            await client.request("chain/add", { uri, index: target.index });
                        }
                    });
                }}
            />
            {plugins.length === 0 && (
                <div className="muted">No LV2 plugins in the catalog. Rescan from Settings → System.</div>
            )}
        </div>
    );
}

function EffectControls({
    selected,
    ports,
    properties,
    plugin,
    models,
    irs,
    run,
    client
}: {
    selected: JsonObject;
    ports: JsonObject[];
    properties: JsonObject[];
    plugin: JsonObject;
    models: JsonObject[];
    irs: JsonObject[];
    run: (work: () => Promise<unknown>) => Promise<void>;
    client: import("../api").EngineClient;
}) {
    return (
        <>
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
                            <span>{str(port.name, symbol)} <span className="muted">{formatControl(value, port)}</span></span>
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
                            ) : arr(port.scalePoints).filter(isObj).length > 0 ? (
                                <select
                                    value={String(value)}
                                    onChange={(event) => void run(() => client.request("chain/control", {
                                        slotId: str(selected.id),
                                        port: symbol,
                                        value: Number(event.target.value)
                                    }))}
                                >
                                    {arr(port.scalePoints).filter(isObj).map((item) => (
                                        <option key={str(item.label, String(num(item.value)))} value={num(item.value)}>
                                            {str(item.label, String(num(item.value)))}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    type="range"
                                    min={min}
                                    max={max}
                                    step={stepped ? 1 : (max - min) / 200}
                                    value={value}
                                    onChange={(event) => {
                                        const next = Number(event.target.value);
                                        void client.request("chain/control", {
                                            slotId: str(selected.id),
                                            port: symbol,
                                            value: next
                                        }).catch(() => undefined);
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
        </>
    );
}

function BindingsPanel({
    selected,
    ports,
    controls,
    controller,
    run,
    client
}: {
    selected: JsonObject;
    ports: JsonObject[];
    controls: JsonObject[];
    controller: JsonObject;
    run: (work: () => Promise<unknown>) => Promise<void>;
    client: import("../api").EngineClient;
}) {
    const slotId = str(selected.id);
    const learningId = str(controller.learningControlId);

    const boundControl = (symbol: string, action: string) =>
        controls.find((control) => {
            const binding = obj(control.binding);
            return str(binding.action) === action
                && str(binding.slotId) === slotId
                && (action !== "setParameter" || str(binding.portSymbol) === symbol);
        });

    const assign = (controlId: string, action: string, portSymbol = "", min = 0, max = 1) => {
        const next = controls.map((control) => {
            if (str(control.id) !== controlId) {
                const binding = obj(control.binding);
                if (str(binding.slotId) === slotId
                    && str(binding.action) === action
                    && (action !== "setParameter" || str(binding.portSymbol) === portSymbol)) {
                    return { ...control, binding: { ...binding, action: "none", slotId: "", portSymbol: "" } };
                }
                return control;
            }
            return {
                ...control,
                binding: {
                    ...obj(control.binding),
                    action,
                    slotId,
                    portSymbol,
                    min,
                    max
                }
            };
        });
        void run(() => client.request("controller/config", { ...controller, controls: next }));
    };

    return (
        <div className="stack">
            <div className="muted">
                Bind a floorboard or on-screen control to this effect. Learn listens for
                the next MIDI CC or note on that control.
            </div>
            <div className="list-item" style={{ flexWrap: "wrap" }}>
                <strong>Toggle this effect</strong>
                <select
                    value={str(obj(boundControl("", "toggleEffect")).id)}
                    onChange={(event) => assign(event.target.value, "toggleEffect")}
                >
                    <option value="">None</option>
                    {controls.map((control) => (
                        <option key={str(control.id)} value={str(control.id)}>{str(control.label, str(control.id))}</option>
                    ))}
                </select>
            </div>
            {ports.map((port) => {
                const symbol = str(port.symbol);
                const bound = boundControl(symbol, "setParameter");
                return (
                    <div key={symbol} className="list-item" style={{ flexWrap: "wrap" }}>
                        <div style={{ flex: 1 }}>
                            <strong>{str(port.name, symbol)}</strong>
                            <div className="muted">{str(obj(bound).label) || "No control"}</div>
                        </div>
                        <select
                            value={str(obj(bound).id)}
                            onChange={(event) => assign(
                                event.target.value,
                                "setParameter",
                                symbol,
                                num(port.min, 0),
                                num(port.max, 1)
                            )}
                        >
                            <option value="">None</option>
                            {controls.map((control) => (
                                <option key={str(control.id)} value={str(control.id)}>
                                    {str(control.label, str(control.id))} · {str(control.kind)}
                                </option>
                            ))}
                        </select>
                        {bound && (
                            <button
                                type="button"
                                className="btn"
                                onClick={() => void run(() => client.request("controller/learn", { controlId: str(bound.id) }))}
                            >
                                {learningId === str(bound.id) ? "LISTENING…" : "LEARN"}
                            </button>
                        )}
                    </div>
                );
            })}
            {controls.length === 0 && (
                <div className="muted">Add switches and pots in Settings → Controller first.</div>
            )}
        </div>
    );
}

function formatControl(value: number, port: JsonObject): string {
    const unit = str(port.unit);
    const digits = bool(port.integer) || bool(port.toggled) ? 0 : 2;
    return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}
