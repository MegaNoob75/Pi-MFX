import { useEffect, useMemo, useState } from "react";
import { str, objects, arr } from "../json";
import type { JsonObject } from "../json";
import { MarqueeText } from "./MarqueeText";

export function PluginBrowser({
    open,
    title,
    actionLabel,
    catalog,
    onCancel,
    onChoose
}: {
    open: boolean;
    title: string;
    actionLabel: string;
    catalog: JsonObject;
    onCancel: () => void;
    onChoose: (uri: string) => void;
}) {
    const plugins = objects(catalog.plugins);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("All");
    const [selected, setSelected] = useState("");

    useEffect(() => {
        if (open) {
            setQuery("");
            setCategory("All");
            setSelected("");
        }
    }, [open]);

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
        return ["All", ...[...names].sort()];
    }, [catalog.categories, plugins]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return plugins.filter((item) => {
            if (category !== "All" && str(item.category) !== category) {
                return false;
            }
            if (!needle) {
                return true;
            }
            const haystack = `${str(item.name)} ${str(item.brand)} ${str(item.category)} ${str(item.uri)}`.toLowerCase();
            return haystack.includes(needle);
        }).sort((a, b) => str(a.name).localeCompare(str(b.name)));
    }, [plugins, query, category]);

    if (!open) {
        return null;
    }

    const chosen = plugins.find((item) => str(item.uri) === selected);

    return (
        <div className="plugin-browser-overlay">
            <button type="button" className="btn-mfx btn-back plugin-browser-back" aria-label="Back" onClick={onCancel}>
                ←
            </button>
            <div className="plugin-browser-header">
                <div className="mfx-screen-intro-title">{title}</div>
                <div className="mfx-screen-intro-sub">
                    Choose the plugin yourself. Nothing is added until you press {actionLabel}.
                </div>
            </div>
            <div className="plugin-browser-filters">
                <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search plugins..."
                    autoComplete="off"
                    className="input"
                />
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                    {categoryNames.map((name) => (
                        <option key={name} value={name}>{name}</option>
                    ))}
                </select>
            </div>
            <div className="plugin-browser-grid-wrap">
                <div className="plugin-browser-grid">
                    {filtered.map((item) => (
                        <button
                            key={str(item.uri)}
                            type="button"
                            className={`plugin-tile${selected === str(item.uri) ? " selected" : ""}`}
                            onClick={() => setSelected(str(item.uri))}
                            onDoubleClick={() => setSelected(str(item.uri))}
                        >
                            <strong>
                                <MarqueeText text={str(item.name)} align="left" fontWeight={800} />
                            </strong>
                            <small>
                                <MarqueeText
                                    text={[str(item.category, "Plugin"), str(item.brand)].filter(Boolean).join(" • ")}
                                    align="left"
                                    fontWeight={700}
                                />
                            </small>
                        </button>
                    ))}
                </div>
                {filtered.length === 0 && <div className="muted" style={{ padding: 30, textAlign: "center" }}>No plugins match this search.</div>}
            </div>
            <div className="plugin-browser-footer">
                <div className={chosen ? "plugin-browser-choice" : "muted"}>
                    {chosen
                        ? <MarqueeText text={str(chosen.name)} align="left" fontWeight={800} />
                        : "Select a plugin"}
                </div>
                <button type="button" className="btn" onClick={onCancel}>CANCEL</button>
                <button
                    type="button"
                    className="btn btn-accent"
                    disabled={!selected}
                    onClick={() => selected && onChoose(selected)}
                >
                    {actionLabel}
                </button>
            </div>
        </div>
    );
}
