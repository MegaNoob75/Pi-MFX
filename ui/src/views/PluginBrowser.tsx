import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { str, objects, arr, num, bool } from "../json";
import type { JsonObject } from "../json";
import { MarqueeText } from "./MarqueeText";

export function isChainPlugin(plugin: JsonObject): boolean {
    return num(plugin.audioInputs) >= 1 && num(plugin.audioOutputs) >= 1;
}

const TOOB_NAM = "http://two-play.com/plugins/toob-nam";
const TOOB_IR = "http://two-play.com/plugins/toob-cab-ir";
function mixerAlternative(plugin: JsonObject) {
    const uri = str(plugin.uri);
    if (uri === TOOB_NAM || uri === TOOB_IR) return null;
    const text = `${uri} ${str(plugin.name)} ${objects(plugin.properties).map(p => `${str(p.uri)} ${str(p.label)} ${arr(p.fileTypes).join(" ")}`).join(" ")}`;
    // takesNamModel also includes generic model-file properties (e.g. TooB ML).
    // Only NAM-specific metadata warrants suggesting TooB NAM as a replacement.
    if (/\bnam\b|nammodel/i.test(text))
        return { uri: TOOB_NAM, name: "TooB NAM" };
    if (bool(plugin.takesImpulseResponse) || /\bir\b|impulse|convolution|cab.?ir|cabinet/i.test(text))
        return { uri: TOOB_IR, name: "TooB Cab IR" };
    return null;
}

export function PluginBrowser({
    open,
    sessionKey,
    title,
    actionLabel,
    catalog,
    onCancel,
    secondaryActionLabel,
    onSecondaryAction,
    warnMixerCompatibility = false,
    onInstallToob,
    onChoose
}: {
    open: boolean;
    sessionKey: string;
    title: string;
    actionLabel: string;
    catalog: JsonObject;
    onCancel: () => void;
    secondaryActionLabel?: string;
    onSecondaryAction?: () => void;
    warnMixerCompatibility?: boolean;
    onInstallToob?: () => Promise<void>;
    onChoose: (uri: string) => void;
}) {
    const plugins = useMemo(() => objects(catalog.plugins)
        .filter(isChainPlugin)
        .sort((a, b) => str(a.name).localeCompare(str(b.name))), [catalog.plugins]);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("All");
    const [selection, setSelection] = useState({ sessionKey: "", uri: "" });
    const [visibleCount, setVisibleCount] = useState(60);
    const [compatibilityChoice, setCompatibilityChoice] = useState<{ sessionKey: string; plugin: JsonObject } | null>(null);
    const [installingToob, setInstallingToob] = useState(false);
    const [installMessage, setInstallMessage] = useState("");
    const loadMoreRef = useRef<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
        if (open) {
            setQuery("");
            setCategory("All");
            setSelection({ sessionKey, uri: "" });
            setVisibleCount(60);
            setCompatibilityChoice(null);
            setInstallMessage("");
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
    const pendingChoice = compatibilityChoice?.sessionKey === sessionKey ? compatibilityChoice.plugin : null;
    const alternative = pendingChoice ? mixerAlternative(pendingChoice) : null;
    const replacementInstalled = alternative && plugins.some(p => str(p.uri) === alternative.uri);
    const choose = (uri: string) => {
        const plugin = plugins.find(p => str(p.uri) === uri);
        if (warnMixerCompatibility && plugin && mixerAlternative(plugin)) {
            setInstallMessage("");
            setCompatibilityChoice({ sessionKey, plugin });
        } else onChoose(uri);
    };
    const completeChoice = (uri: string) => { setCompatibilityChoice(null); onChoose(uri); };
    const installToob = async () => {
        if (!onInstallToob || installingToob) return;
        setInstallingToob(true); setInstallMessage("");
        try {
            await onInstallToob();
            setInstallMessage("TooB plugins installed. Choose the matching TooB plugin below, or add your original choice.");
        } catch (error) {
            setInstallMessage(error instanceof Error ? error.message : "Could not install TooB plugins. Try again or use Plugin Manager.");
        } finally { setInstallingToob(false); }
    };

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
                                    choose(uri);
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
                {secondaryActionLabel && onSecondaryAction && (
                    <button type="button" className="btn plugin-browser-secondary-action" onClick={onSecondaryAction}>
                        {secondaryActionLabel}
                    </button>
                )}
                <button
                    type="button"
                    className="btn btn-accent"
                    disabled={!selected}
                    onClick={() => selected && choose(selected)}
                >
                    {actionLabel}
                </button>
            </div>
            {pendingChoice && alternative && <div className="mfx-overlay plugin-compatibility-overlay">
                <div className="mfx-overlay-card" role="dialog" aria-modal="true" aria-labelledby="plugin-compatibility-title"
                    onKeyDown={e => {
                        if (e.key === "Escape") { e.stopPropagation(); if (!installingToob) setCompatibilityChoice(null); }
                        if (e.key === "Tab") {
                            if (installingToob) { e.preventDefault(); return; }
                            const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
                            const first = buttons[0], last = buttons[buttons.length - 1];
                            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
                            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
                        }
                    }}>
                    <div id="plugin-compatibility-title" className="mfx-overlay-title">NAM / IR MIXER SUPPORT</div>
                    <p className="muted">{str(pendingChoice.name, str(pendingChoice.uri))} can still be mixed as an audio path. Dedicated NAM/IR mixer integration supports TooB NAM and TooB Cab IR. Use this plugin’s own controls for its model or cabinet settings.</p>
                    {!replacementInstalled && !installingToob && <p className="muted">{alternative.name} is not available. Install the TooB plugin pack to use it.</p>}
                    {installingToob && <p className="muted" role="status">Installing TooB plugins… This may take a few minutes.</p>}
                    {installMessage && <p className="muted" role="status">{installMessage}</p>}
                    <div className="row" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button type="button" className="btn" autoFocus disabled={installingToob} onClick={() => setCompatibilityChoice(null)}>CANCEL</button>
                        <button type="button" className="btn" disabled={installingToob} onClick={() => completeChoice(str(pendingChoice.uri))}>ADD ANYWAY</button>
                        {replacementInstalled
                            ? <button type="button" className="btn btn-accent" disabled={installingToob}
                                onClick={() => completeChoice(alternative.uri)}>ADD {alternative.name.toUpperCase()}</button>
                            : <button type="button" className="btn btn-accent" disabled={installingToob || !onInstallToob}
                                onClick={() => { void installToob(); }}>INSTALL TOOB PLUGINS</button>}
                    </div>
                </div>
            </div>}
        </div>
    );
}
