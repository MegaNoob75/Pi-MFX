import { useEffect, useMemo, useState } from "react";
import { str, objects, arr } from "../json";
import type { JsonObject } from "../json";

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
    const [category, setCategory] = useState("");
    const [selected, setSelected] = useState("");

    useEffect(() => {
        if (open) {
            setQuery("");
            setCategory("");
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
        return [...names].sort();
    }, [catalog.categories, plugins]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return plugins.filter((item) => {
            if (category && str(item.category) !== category) {
                return false;
            }
            if (!needle) {
                return true;
            }
            const haystack = `${str(item.name)} ${str(item.brand)} ${str(item.category)} ${str(item.uri)}`.toLowerCase();
            return haystack.includes(needle);
        });
    }, [plugins, query, category]);

    if (!open) {
        return null;
    }

    return (
        <div className="dialog-backdrop plugin-browser" onClick={onCancel}>
            <div className="dialog plugin-browser-dialog" onClick={(event) => event.stopPropagation()}>
                <div className="row">
                    <h2 style={{ margin: 0, flex: 1 }}>{title}</h2>
                    <button type="button" className="btn" onClick={onCancel}>←</button>
                </div>
                <div className="row">
                    <label className="field">
                        <span>Search</span>
                        <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
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
                <div className="plugin-list plugin-browser-list">
                    {filtered.map((item) => (
                        <button
                            key={str(item.uri)}
                            type="button"
                            className={`plugin-row${selected === str(item.uri) ? " selected" : ""}`}
                            onClick={() => setSelected(str(item.uri))}
                            onDoubleClick={() => onChoose(str(item.uri))}
                        >
                            {str(item.name)}
                            <small>{[str(item.brand), str(item.category)].filter(Boolean).join(" · ")}</small>
                        </button>
                    ))}
                    {filtered.length === 0 && <div className="muted">No plugins match.</div>}
                </div>
                <div className="row" style={{ justifyContent: "flex-end" }}>
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
        </div>
    );
}
