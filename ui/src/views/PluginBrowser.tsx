import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { str, objects, arr, num } from "../json";
import type { JsonObject } from "../json";
import { MarqueeText } from "./MarqueeText";

export function isChainPlugin(plugin: JsonObject): boolean {
    return num(plugin.audioInputs) >= 1 && num(plugin.audioOutputs) >= 1;
}

export function PluginBrowser({
    open,
    sessionKey,
    title,
    actionLabel,
    catalog,
    onCancel,
    onChoose
}: {
    open: boolean;
    sessionKey: string;
    title: string;
    actionLabel: string;
    catalog: JsonObject;
    onCancel: () => void;
    onChoose: (uri: string) => void;
}) {
    const plugins = useMemo(() => objects(catalog.plugins)
        .filter(isChainPlugin)
        .sort((a, b) => str(a.name).localeCompare(str(b.name))), [catalog.plugins]);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("All");
    const [selection, setSelection] = useState({ sessionKey: "", uri: "" });
    const [visibleCount, setVisibleCount] = useState(60);
    const loadMoreRef = useRef<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
        if (open) {
            setQuery("");
            setCategory("All");
            setSelection({ sessionKey, uri: "" });
            setVisibleCount(60);
        }
    }, [open, sessionKey]);

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
        });
    }, [plugins, query, category]);

    useEffect(() => setVisibleCount(60), [query, category, sessionKey]);

    useEffect(() => {
        const target = loadMoreRef.current;
        if (!open || !target || visibleCount >= filtered.length) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setVisibleCount((current) => Math.min(filtered.length, current + 60));
            }
        }, { rootMargin: "240px" });
        observer.observe(target);
        return () => observer.disconnect();
    }, [open, filtered.length, visibleCount]);

    if (!open) {
        return null;
    }

    const selected = selection.sessionKey === sessionKey ? selection.uri : "";
    const chosen = plugins.find((item) => str(item.uri) === selected);

    return (
        <div className="plugin-browser-overlay">
            <button type="button" className="btn-mfx btn-back plugin-browser-back" aria-label="Back" onClick={onCancel}>
                ←
            </button>
            <div className="plugin-browser-header">
                <div className="mfx-screen-intro-title">{title}</div>
                <div className="mfx-screen-intro-sub">
                    Double-click a plugin to add it, or press {actionLabel}.
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
                <div className="plugin-browser-grid" data-mfx-nav-list="plugins">
                    {filtered.slice(0, visibleCount).map((item) => (
                        <button
                            key={str(item.uri)}
                            type="button"
                            className={`plugin-tile${selected === str(item.uri) ? " selected" : ""}`}
                            onClick={() => setSelection({ sessionKey, uri: str(item.uri) })}
                            onDoubleClick={() => {
                                const uri = str(item.uri);
                                if (uri) {
                                    onChoose(uri);
                                }
                            }}
                        >
                            <strong title={str(item.name)}>{str(item.name)}</strong>
                            <small title={[str(item.category, "Plugin"), str(item.brand)].filter(Boolean).join(" • ")}>
                                {[str(item.category, "Plugin"), str(item.brand)].filter(Boolean).join(" • ")}
                            </small>
                        </button>
                    ))}
                </div>
                {visibleCount < filtered.length && <div ref={loadMoreRef} className="plugin-browser-load-more">
                    Loading more effects…
                </div>}
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
