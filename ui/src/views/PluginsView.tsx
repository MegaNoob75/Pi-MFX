import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineSnapshot } from "../api";
import { arr, bool, num, str, objects, type JsonObject } from "../json";
import { isChainPlugin } from "./PluginBrowser";

type PluginTab = "installed" | "install";
type PatchSort = "downloads" | "alpha" | "newest" | "updated";
type InstallSource = "apt" | "github";

type InstallPackage = {
    id: string;
    package: string;
    source: InstallSource;
    title: string;
    description: string;
    plugins: string[];
};

const INSTALL_PACKAGES: InstallPackage[] = [
    {
        id: "toobamp",
        package: "toobamp",
        source: "github",
        title: "ToobAmp",
        description: "Raspberry Pi guitar pack with NAM A2, cab IR, delay, reverb and EQ. Installs from ToobAmp/PiPedal until a standalone apt package exists.",
        plugins: [
            "TooB NAM", "TooB Neural Amp", "TooB Cab", "TooB Convolution", "TooB Delay",
            "TooB Chorus", "TooB Flanger", "TooB Phaser", "TooB Tremolo", "TooB Tuner",
            "TooB Graphic EQ", "TooB Input", "TooB Output", "TooB Noise Gate", "TooB Freeverb"
        ]
    },
    {
        id: "guitarix-lv2",
        package: "guitarix-lv2",
        source: "apt",
        title: "Guitarix LV2",
        description: "Guitarix amps, drives and GxPlugins from Raspberry Pi OS (brummer10). This is the apt package for GxPlugins.lv2 — no git build required.",
        plugins: [
            "GxAmplifier-X", "GxTubeScreamer", "GxVintageFuzz", "GxWah", "GxCompressor",
            "GxEcho", "GxDelay", "GxReverb", "GxTone", "GxBooster", "GxFlanger", "GxChorus"
        ]
    },
    {
        id: "calf-plugins",
        package: "calf-plugins",
        source: "apt",
        title: "Calf Studio Gear",
        description: "Modulation, dynamics, EQ and studio effects.",
        plugins: ["Calf Compressor", "Calf Saturator", "Calf Vintage Delay", "Calf Reverb", "Calf Filter", "Calf Multiband"]
    },
    {
        id: "x42-plugins",
        package: "x42-plugins",
        source: "apt",
        title: "x42 Plugins",
        description: "Meters, tuners and utility LV2 plugins.",
        plugins: ["x42 Tuner", "x42 Stereo Mix", "x42 Delay", "x42 EQ", "x42 Meter"]
    },
    {
        id: "zam-plugins",
        package: "zam-plugins",
        source: "apt",
        title: "ZamPlugins",
        description: "Compressors, EQ, gates and limiters.",
        plugins: ["ZaMultiComp", "ZamEQ2", "ZamGate", "ZamTube", "ZamDelay"]
    },
    {
        id: "lsp-plugins-lv2",
        package: "lsp-plugins-lv2",
        source: "apt",
        title: "LSP Plugins",
        description: "Large studio suite: EQ, dynamics, delay and more.",
        plugins: ["LSP Equalizer", "LSP Compressor", "LSP Delay", "LSP Gate", "LSP Limiter"]
    },
    {
        id: "dragonfly-reverb",
        package: "dragonfly-reverb",
        source: "apt",
        title: "Dragonfly Reverb",
        description: "Hall, room, plate and early-reflection reverbs.",
        plugins: ["Dragonfly Hall", "Dragonfly Room", "Dragonfly Plate", "Dragonfly Early"]
    },
    {
        id: "eq10q",
        package: "eq10q",
        source: "apt",
        title: "EQ10Q",
        description: "Parametric equalizers.",
        plugins: ["EQ10Q"]
    },
    {
        id: "tap-plugins",
        package: "tap-plugins",
        source: "apt",
        title: "TAP Plugins",
        description: "Classic TAP LV2 effects.",
        plugins: ["TAP Reverberator", "TAP Echo", "TAP Tremolo", "TAP EQ"]
    },
    {
        id: "swh-lv2",
        package: "swh-lv2",
        source: "apt",
        title: "SWH Plugins",
        description: "Steve Harris LV2 ports of classic LADSPA effects.",
        plugins: ["SWH Delay", "SWH Phaser", "SWH Chorus", "SWH Distortion"]
    },
    {
        id: "invada-studio-plugins-lv2",
        package: "invada-studio-plugins-lv2",
        source: "apt",
        title: "Invada Studio",
        description: "Delay, compressor, filter and tube plugins.",
        plugins: ["Invada Delay", "Invada Compressor", "Invada Tube", "Invada Filter"]
    },
    {
        id: "mda-lv2",
        package: "mda-lv2",
        source: "apt",
        title: "MDA LV2",
        description: "Classic MDA effects ported to LV2.",
        plugins: ["MDA Overdrive", "MDA Delay", "MDA Combo", "MDA Leslie", "MDA TalkBox"]
    },
    {
        id: "dpf-plugins",
        package: "dpf-plugins",
        source: "apt",
        title: "DPF Plugins",
        description: "DISTRHO plugin ports.",
        plugins: ["Nekobi", "Kars", "Ping Pong Pan"]
    },
    {
        id: "infamous-plugins",
        package: "infamous-plugins",
        source: "apt",
        title: "Infamous Plugins",
        description: "Guitar-oriented LV2 effects.",
        plugins: ["stuck", "ewham", "powercut", "lushlife"]
    },
    {
        id: "rubberband-lv2",
        package: "rubberband-lv2",
        source: "apt",
        title: "Rubber Band",
        description: "Pitch and time stretching.",
        plugins: ["Rubber Band"]
    }
];

function sortPatches(list: JsonObject[], sort: PatchSort): JsonObject[] {
    const copy = [...list];
    copy.sort((left, right) => {
        if (sort === "alpha") {
            return str(left.title).localeCompare(str(right.title), undefined, { sensitivity: "base" });
        }
        if (sort === "newest") {
            return str(right.date).localeCompare(str(left.date)) || num(right.id) - num(left.id);
        }
        if (sort === "updated") {
            return str(right.modified).localeCompare(str(left.modified))
                || str(right.date).localeCompare(str(left.date));
        }
        return num(right.downloads) - num(left.downloads);
    });
    return copy;
}

function matchesNeedle(haystack: string, needle: string): boolean {
    return !needle || haystack.toLowerCase().includes(needle);
}

function packageSearchText(pack: InstallPackage): string {
    return [pack.title, pack.package, pack.description, ...pack.plugins].join(" ");
}

export function PluginsView({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const [tab, setTab] = useState<PluginTab>("installed");
    const [status, setStatus] = useState<JsonObject>({});
    const [installQuery, setInstallQuery] = useState("");
    const [aptInstalled, setAptInstalled] = useState<JsonObject[]>([]);
    const [recommended, setRecommended] = useState<JsonObject[]>([]);
    const [patches, setPatches] = useState<JsonObject[]>([]);
    const [patchSort, setPatchSort] = useState<PatchSort>("downloads");
    const [patchLoaded, setPatchLoaded] = useState(false);
    const [patchHasMore, setPatchHasMore] = useState(false);
    const [busy, setBusy] = useState("");
    const prefetching = useRef(false);
    const listEndRef = useRef<HTMLDivElement | null>(null);

    const mergePatches = (current: JsonObject[], incoming: JsonObject[]) => {
        const seen = new Set(current.map((patch) => num(patch.id)));
        const next = [...current];
        for (const item of incoming) {
            const id = num(item.id);
            if (!id) {
                continue;
            }
            const index = next.findIndex((patch) => num(patch.id) === id);
            if (index >= 0) {
                next[index] = item;
            } else if (!seen.has(id)) {
                seen.add(id);
                next.push(item);
            }
        }
        return next;
    };

    const applyPatchPage = (result: JsonObject, replace: boolean) => {
        const items = objects(result.items);
        setPatches((list) => (replace || bool(result.cached) ? items : mergePatches(list, items)));
        setPatchHasMore(bool(result.hasMore));
        return result;
    };

    const searchPatchPage = (page: number, refresh: boolean) => engine.client.request("plugins/patchstorage/search", {
        query: "",
        page,
        perPage: 100,
        all: false,
        refresh
    });

    const prefetchRemaining = async (startPage: number, hasMore: boolean) => {
        if (prefetching.current || !hasMore || startPage < 2) {
            return;
        }
        prefetching.current = true;
        try {
            let page = startPage;
            let more: boolean = hasMore;
            while (more && page > 0) {
                const next = await searchPatchPage(page, true);
                applyPatchPage(next, false);
                more = bool(next.hasMore);
                page = num(next.nextPage, 0);
            }
        } finally {
            prefetching.current = false;
            setPatchHasMore(false);
        }
    };

    const refreshStatus = async () => {
        const next = await engine.client.request("plugins/status");
        setStatus(next);
        const listed = objects(next.recommended);
        if (listed.length) {
            setRecommended(listed);
        }
        return next;
    };

    const refreshAptInstalled = async () => {
        const next = await engine.client.request("plugins/apt/list");
        setAptInstalled(objects(next.packages));
    };

    useEffect(() => {
        void run(async () => {
            const next = await refreshStatus();
            if (bool(next.helperAvailable)) {
                await refreshAptInstalled().catch(() => undefined);
            }
        });
    }, [engine.client]);

    useEffect(() => {
        void engine.client.request("plugins/github/list").then((next) => {
            const listed = objects(next.recommended);
            if (listed.length) {
                setRecommended(listed);
            }
        }).catch(() => undefined);
    }, [engine.client]);

    const work = (label: string, task: () => Promise<void>) => {
        void run(async () => {
            setBusy(label);
            try {
                await task();
            } finally {
                setBusy("");
            }
        });
    };

    const helper = bool(status.helperAvailable);
    const https = bool(status.httpsAvailable, true);

    const loadPatchStorage = (forceReload = false) => {
        if (!https) {
            return;
        }
        work(forceReload ? "Reloading PatchStorage…" : "Loading PatchStorage…", async () => {
            try {
                const first = await searchPatchPage(1, forceReload);
                applyPatchPage(first, true);
                const stale = bool(first.stale);
                const cached = bool(first.cached);
                if (cached && (forceReload || stale)) {
                    const live = await searchPatchPage(1, true);
                    applyPatchPage(live, true);
                    await prefetchRemaining(num(live.nextPage, 2), bool(live.hasMore));
                    return;
                }
                if (!cached || bool(first.hasMore)) {
                    await prefetchRemaining(num(first.nextPage, 2), bool(first.hasMore));
                }
            } finally {
                setPatchLoaded(true);
            }
        });
    };

    useEffect(() => {
        if (tab !== "install" || !https || patchLoaded) {
            return;
        }
        loadPatchStorage(false);
    }, [tab, https, patchLoaded]);

    useEffect(() => {
        if (tab !== "install" || !patchHasMore) {
            return;
        }
        const sentinel = listEndRef.current;
        if (!sentinel) {
            return;
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting) && !prefetching.current && patchHasMore) {
                const page = Math.floor(patches.length / 100) + 1;
                void prefetchRemaining(page, true);
            }
        }, { rootMargin: "240px" });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [tab, patchHasMore, patches.length]);

    const needle = installQuery.trim().toLowerCase();
    const visiblePackages = useMemo(
        () => INSTALL_PACKAGES.filter((pack) => matchesNeedle(packageSearchText(pack), needle)),
        [needle]
    );
    const visiblePatches = useMemo(() => {
        const filtered = needle
            ? patches.filter((patch) => {
                const blob = `${str(patch.title)} ${str(patch.author)} ${str(patch.excerpt)} ${str(patch.license)}`.toLowerCase();
                return blob.includes(needle);
            })
            : patches;
        return sortPatches(filtered, patchSort);
    }, [patches, needle, patchSort]);

    const bundles = objects(status.bundles);
    const hidden = objects(status.hidden);
    const installedNames = new Set([
        ...aptInstalled.filter((item) => bool(item.installed)).map((item) => str(item.name)),
        ...recommended.filter((item) => bool(item.installed)).map((item) => str(item.package, str(item.id)))
    ]);

    return (
        <div className="mfx-screen">
            <div className="mfx-screen-intro">
                <div className="mfx-screen-intro-title">PLUGINS</div>
                <div className="mfx-screen-intro-sub">
                    Installed effects, Raspberry Pi OS packages, and PatchStorage. Hide unused plugins without breaking apt.
                </div>
            </div>
            <div className="page-scroll stack">
                <div className="row">
                    <TabButton label="INSTALLED" active={tab === "installed"} onClick={() => setTab("installed")} />
                    <TabButton label="INSTALL" active={tab === "install"} onClick={() => setTab("install")} />
                </div>
                {busy && <div className="muted">{busy}</div>}
                {tab === "installed" && (
                    <InstalledTab
                        catalog={objects(engine.catalog.plugins)}
                        status={status}
                        aptPackages={aptInstalled}
                        bundles={bundles}
                        hidden={hidden}
                        onRescan={() => work("Rescanning LV2…", async () => {
                            await engine.client.request("plugins/rescan");
                            await refreshStatus();
                        })}
                        onHide={(uri, name) => work(`Hiding ${name}…`, async () => {
                            await engine.client.request("plugins/hide", { uri, name });
                            await refreshStatus();
                        })}
                        onUnhide={(uri, name) => work(`Restoring ${name}…`, async () => {
                            await engine.client.request("plugins/unhide", { uri });
                            await refreshStatus();
                        })}
                        onRemoveApt={(name) => work(`Removing ${name}…`, async () => {
                            await engine.client.request("plugins/apt/remove", { package: name });
                            await refreshAptInstalled();
                            await refreshStatus();
                        })}
                        onRemoveGithub={(id, title) => work(`Removing ${title}…`, async () => {
                            await engine.client.request("plugins/github/remove", { id });
                            await refreshAptInstalled();
                            await refreshStatus();
                        })}
                        onRemoveBundle={(directory) => work(`Removing ${directory}…`, async () => {
                            await engine.client.request("plugins/bundle/remove", { directory });
                            await refreshStatus();
                        })}
                    />
                )}
                {tab === "install" && (
                    <InstallTab
                        helper={helper}
                        https={https}
                        query={installQuery}
                        packages={visiblePackages}
                        installedNames={installedNames}
                        recommended={recommended}
                        patches={visiblePatches}
                        patchTotal={patches.length}
                        patchHasMore={patchHasMore}
                        patchSort={patchSort}
                        listEndRef={listEndRef}
                        onQuery={setInstallQuery}
                        onSort={setPatchSort}
                        onReload={() => loadPatchStorage(true)}
                        onInstallApt={(name) => work(`Installing ${name}…`, async () => {
                            await engine.client.request("plugins/apt/install", { package: name });
                            await refreshAptInstalled();
                            await refreshStatus();
                        })}
                        onRemoveApt={(name) => work(`Removing ${name}…`, async () => {
                            await engine.client.request("plugins/apt/remove", { package: name });
                            await refreshAptInstalled();
                            await refreshStatus();
                        })}
                        onInstallGithub={(id, title) => work(`Installing ${title}…`, async () => {
                            await engine.client.request("plugins/github/install", { id });
                            await refreshAptInstalled();
                            await refreshStatus();
                            setRecommended((list) => list.map((item) => (
                                str(item.id) === id || str(item.package) === id
                                    ? { ...item, installed: true }
                                    : item
                            )));
                        })}
                        onRemoveGithub={(id, title) => work(`Removing ${title}…`, async () => {
                            await engine.client.request("plugins/github/remove", { id });
                            await refreshAptInstalled();
                            await refreshStatus();
                            setRecommended((list) => list.map((item) => (
                                str(item.id) === id || str(item.package) === id
                                    ? { ...item, installed: false }
                                    : item
                            )));
                        })}
                        onInstallPatch={(patchId, title) => work(`Installing ${title}…`, async () => {
                            await engine.client.request("plugins/patchstorage/install", { patchId });
                            await refreshStatus();
                            setPatches((list) => list.map((item) => (
                                num(item.id) === patchId ? { ...item, installed: true } : item
                            )));
                        })}
                    />
                )}
            </div>
        </div>
    );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button type="button" className={`btn ${active ? "btn-active" : ""}`} onClick={onClick}>
            {label}
        </button>
    );
}

function InstalledTab({
    catalog,
    status,
    aptPackages,
    bundles,
    hidden,
    onRescan,
    onHide,
    onUnhide,
    onRemoveApt,
    onRemoveGithub,
    onRemoveBundle
}: {
    catalog: JsonObject[];
    status: JsonObject;
    aptPackages: JsonObject[];
    bundles: JsonObject[];
    hidden: JsonObject[];
    onRescan: () => void;
    onHide: (uri: string, name: string) => void;
    onUnhide: (uri: string, name: string) => void;
    onRemoveApt: (name: string) => void;
    onRemoveGithub: (id: string, title: string) => void;
    onRemoveBundle: (directory: string) => void;
}) {
    const chainPlugins = catalog.filter(isChainPlugin).sort((a, b) => str(a.name).localeCompare(str(b.name)));
    const hiddenCount = hidden.length;
    const extras = Math.max(0, catalog.length - chainPlugins.length);
    return (
        <>
            <div className="panel stack">
                <h2>CHAIN PLUGINS</h2>
                <div className="muted">
                    {chainPlugins.length} effects with audio in and out
                    {extras ? ` · ${extras} utilities hidden from this list` : ""}
                    {bool(status.lv2Available, true) ? "" : " · LV2 host not available in this build"}
                    {" · Delete hides a plugin from Add Effect without removing the apt package."}
                </div>
                <button type="button" className="btn" onClick={onRescan}>RESCAN LV2</button>
                <div className="plugin-catalog-list">
                    {chainPlugins.map((plugin) => (
                        <div className="plugin-catalog-row" key={str(plugin.uri)}>
                            <div style={{ minWidth: 0 }}>
                                <strong>{str(plugin.name)}</strong>
                                <div className="muted">
                                    {str(plugin.brand, str(plugin.category))}
                                    {str(plugin.category) && str(plugin.brand) ? ` · ${str(plugin.category)}` : ""}
                                </div>
                            </div>
                            <button
                                type="button"
                                className="btn btn-danger"
                                onClick={() => onHide(str(plugin.uri), str(plugin.name))}
                            >
                                DELETE
                            </button>
                        </div>
                    ))}
                    {chainPlugins.length === 0 && <div className="muted">No chain-usable LV2 plugins loaded yet.</div>}
                </div>
            </div>
            {hiddenCount > 0 && (
                <div className="panel stack">
                    <h2>HIDDEN FROM ADD EFFECT</h2>
                    <div className="muted">These files stay installed. Restore puts them back in the preset editor.</div>
                    {hidden.map((item) => (
                        <div className="list-item" key={str(item.uri)}>
                            <div>
                                <strong>{str(item.name, str(item.uri))}</strong>
                                <div className="muted">{str(item.uri)}</div>
                            </div>
                            <button
                                type="button"
                                className="btn"
                                onClick={() => onUnhide(str(item.uri), str(item.name, "plugin"))}
                            >
                                RESTORE
                            </button>
                        </div>
                    ))}
                </div>
            )}
            <div className="panel stack">
                <h2>PACKAGES</h2>
                {!bool(status.helperAvailable) && (
                    <div className="muted">The plugin helper is not running, so apt packages cannot be listed yet.</div>
                )}
                {aptPackages.filter((item) => bool(item.installed)).map((item) => (
                    <div className="list-item" key={str(item.name)}>
                        <div>
                            <strong>{str(item.name)}</strong>
                            <div className="muted">{str(item.description)}</div>
                        </div>
                        {str(item.name) === "toobamp" ? (
                            <button type="button" className="btn btn-danger" onClick={() => onRemoveGithub("toobamp", "ToobAmp")}>
                                REMOVE
                            </button>
                        ) : (
                            <button type="button" className="btn btn-danger" onClick={() => onRemoveApt(str(item.name))}>
                                REMOVE
                            </button>
                        )}
                    </div>
                ))}
                {bool(status.helperAvailable) && aptPackages.filter((item) => bool(item.installed)).length === 0 && (
                    <div className="muted">No plugin packages installed yet.</div>
                )}
            </div>
            <div className="panel stack">
                <h2>PATCHSTORAGE</h2>
                {bundles.map((bundle) => {
                    const directories = arr(bundle.directories).map((item) => String(item));
                    const names = directories.length ? directories : [str(bundle.directory)];
                    return names.filter(Boolean).map((directory) => (
                        <div className="list-item" key={directory}>
                            <div>
                                <strong>{str(bundle.title, directory)}</strong>
                                <div className="muted">
                                    {directory}
                                    {str(bundle.license) ? ` · ${str(bundle.license)}` : ""}
                                </div>
                            </div>
                            <button type="button" className="btn btn-danger" onClick={() => onRemoveBundle(directory)}>
                                REMOVE
                            </button>
                        </div>
                    ));
                })}
                {bundles.length === 0 && <div className="muted">Nothing installed from PatchStorage yet.</div>}
            </div>
        </>
    );
}

function InstallTab({
    helper,
    https,
    query,
    packages,
    installedNames,
    recommended,
    patches,
    patchTotal,
    patchHasMore,
    patchSort,
    listEndRef,
    onQuery,
    onSort,
    onReload,
    onInstallApt,
    onRemoveApt,
    onInstallGithub,
    onRemoveGithub,
    onInstallPatch
}: {
    helper: boolean;
    https: boolean;
    query: string;
    packages: InstallPackage[];
    installedNames: Set<string>;
    recommended: JsonObject[];
    patches: JsonObject[];
    patchTotal: number;
    patchHasMore: boolean;
    patchSort: PatchSort;
    listEndRef: { current: HTMLDivElement | null };
    onQuery: (value: string) => void;
    onSort: (value: PatchSort) => void;
    onReload: () => void;
    onInstallApt: (name: string) => void;
    onRemoveApt: (name: string) => void;
    onInstallGithub: (id: string, title: string) => void;
    onRemoveGithub: (id: string, title: string) => void;
    onInstallPatch: (patchId: number, title: string) => void;
}) {
    const needle = query.trim().toLowerCase();
    return (
        <>
            <div className="panel stack">
                <h2>FIND A PLUGIN</h2>
                <div className="muted">
                    Search package names, individual effects inside those packages, and PatchStorage titles and descriptions.
                    Apt still installs a whole package; hide unused effects on Installed.
                </div>
                <label className="field">
                    <span>Search</span>
                    <input
                        value={query}
                        onChange={(event) => onQuery(event.target.value)}
                        placeholder="NAM, delay, GxTubeScreamer, calf…"
                    />
                </label>
            </div>
            <div className="panel stack">
                <h2>RASPBERRY PI OS</h2>
                <div className="muted">
                    Curated LV2 packs, including ToobAmp and Guitarix / GxPlugins. Each package can contain several effects.
                </div>
                {!helper && (
                    <div className="danger">
                        The plugin helper is not running. Update Pi-MFX on the Pi, then use this page to install plugins.
                    </div>
                )}
                {packages.map((pack) => {
                    const installed = installedNames.has(pack.package) || recommended.some((item) => (
                        bool(item.installed) && (str(item.id) === pack.id || str(item.package) === pack.package)
                    ));
                    const matchingPlugins = needle
                        ? pack.plugins.filter((name) => name.toLowerCase().includes(needle))
                        : pack.plugins;
                    return (
                        <div className="list-item plugin-install-card" key={pack.id}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <strong>{pack.title}</strong>
                                <div className="muted">{pack.package}{pack.source === "github" ? " · GitHub until apt has it" : " · apt"}</div>
                                <div className="muted">{pack.description}</div>
                                {matchingPlugins.length > 0 && (
                                    <div className="muted plugin-install-plugins">
                                        {matchingPlugins.slice(0, 8).join(" · ")}
                                        {matchingPlugins.length > 8 ? ` · +${matchingPlugins.length - 8}` : ""}
                                    </div>
                                )}
                            </div>
                            {installed ? (
                                <button
                                    type="button"
                                    className="btn btn-danger"
                                    onClick={() => pack.source === "github"
                                        ? onRemoveGithub(pack.id, pack.title)
                                        : onRemoveApt(pack.package)}
                                >
                                    REMOVE
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="btn btn-accent"
                                    disabled={!helper || (pack.source === "github" && !https)}
                                    onClick={() => pack.source === "github"
                                        ? onInstallGithub(pack.id, pack.title)
                                        : onInstallApt(pack.package)}
                                >
                                    INSTALL
                                </button>
                            )}
                        </div>
                    );
                })}
                {packages.length === 0 && <div className="muted">No Raspberry Pi OS packages match that search.</div>}
            </div>
            <div className="panel stack">
                <h2>PATCHSTORAGE</h2>
                <div className="muted">
                    LV2 builds for Raspberry Pi 64-bit. Filter uses the same search box above.
                </div>
                {!https && <div className="danger">This build has no HTTPS support, so PatchStorage is unavailable.</div>}
                <div className="row">
                    <label className="field">
                        <span>Sort</span>
                        <select value={patchSort} onChange={(event) => onSort(event.target.value as PatchSort)}>
                            <option value="downloads">Most downloads</option>
                            <option value="alpha">Alphabetical</option>
                            <option value="newest">Newest</option>
                            <option value="updated">Recently updated</option>
                        </select>
                    </label>
                    <button type="button" className="btn" disabled={!https} onClick={onReload}>RELOAD</button>
                </div>
                <div className="muted">
                    {patchTotal === 0
                        ? "No plugins loaded yet."
                        : needle
                            ? `${patches.length} of ${patchTotal} plugins`
                            : `${patchTotal} plugins${patchHasMore ? " so far" : ""}`}
                </div>
                {patches.map((patch) => (
                    <div className="list-item" key={num(patch.id)}>
                        <div>
                            <strong>{str(patch.title)}</strong>
                            <div className="muted">
                                {str(patch.author)}
                                {num(patch.downloads) ? ` · ${num(patch.downloads)} downloads` : ""}
                                {str(patch.license) ? ` · ${str(patch.license)}` : ""}
                            </div>
                            {str(patch.excerpt) && <div className="muted">{str(patch.excerpt)}</div>}
                        </div>
                        {bool(patch.installed) ? (
                            <button type="button" className="btn" disabled>INSTALLED</button>
                        ) : (
                            <button
                                type="button"
                                className="btn btn-accent"
                                disabled={!https}
                                onClick={() => onInstallPatch(num(patch.id), str(patch.title))}
                            >
                                INSTALL
                            </button>
                        )}
                    </div>
                ))}
                {patchTotal > 0 && patches.length === 0 && (
                    <div className="muted">No PatchStorage plugins match that search.</div>
                )}
                {patchHasMore && <div className="muted">Loading more…</div>}
                <div ref={listEndRef} />
            </div>
        </>
    );
}
