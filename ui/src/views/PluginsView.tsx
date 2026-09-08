import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineSnapshot } from "../api";
import { arr, bool, num, str, objects, type JsonObject } from "../json";
import { isChainPlugin } from "./PluginBrowser";
import { LibraryBrowser } from "./LibraryManager";

type PluginTab = "installed" | "apt" | "repos" | "patchstorage";
type PatchSort = "downloads" | "alpha" | "newest" | "updated";

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

export function PluginsView({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const [tab, setTab] = useState<PluginTab>("installed");
    const [status, setStatus] = useState<JsonObject>({});
    const [aptQuery, setAptQuery] = useState("");
    const [aptInstalled, setAptInstalled] = useState<JsonObject[]>([]);
    const [aptResults, setAptResults] = useState<JsonObject[]>([]);
    const [repos, setRepos] = useState<JsonObject[]>([]);
    const [repoId, setRepoId] = useState("");
    const [repoUri, setRepoUri] = useState("");
    const [repoSuite, setRepoSuite] = useState("");
    const [repoComponents, setRepoComponents] = useState("main");
    const [repoKeyUrl, setRepoKeyUrl] = useState("");
    const [patchQuery, setPatchQuery] = useState("");
    const [patches, setPatches] = useState<JsonObject[]>([]);
    const [patchSort, setPatchSort] = useState<PatchSort>("downloads");
    const [patchLoaded, setPatchLoaded] = useState(false);
    const [patchHasMore, setPatchHasMore] = useState(false);
    const [busy, setBusy] = useState("");
    const [recommended, setRecommended] = useState<JsonObject[]>([]);
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

    const refreshRepos = async () => {
        const next = await engine.client.request("plugins/repo/list");
        setRepos(objects(next.repos));
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
                await refreshRepos().catch(() => undefined);
            }
        });
    }, [engine.client]);

    useEffect(() => {
        if (tab !== "apt") {
            return;
        }
        void engine.client.request("plugins/github/list").then((next) => {
            const listed = objects(next.recommended);
            if (listed.length) {
                setRecommended(listed);
            }
        }).catch(() => undefined);
    }, [engine.client, tab]);

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
        if (tab !== "patchstorage" || !https || patchLoaded) {
            return;
        }
        loadPatchStorage(false);
    }, [tab, https, patchLoaded]);

    useEffect(() => {
        if (tab !== "patchstorage" || !patchHasMore) {
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

    const visiblePatches = useMemo(() => {
        const needle = patchQuery.trim().toLowerCase();
        const filtered = needle
            ? patches.filter((patch) => {
                const blob = `${str(patch.title)} ${str(patch.author)} ${str(patch.excerpt)} ${str(patch.license)}`.toLowerCase();
                return blob.includes(needle);
            })
            : patches;
        return sortPatches(filtered, patchSort);
    }, [patches, patchQuery, patchSort]);
    const bundles = objects(status.bundles);
    const suggested = arr(status.suggestedPackages).map((item) => String(item));
    const suggestedPackages = suggested.length ? suggested : [
        "calf-plugins",
        "x42-plugins",
        "zam-plugins",
        "guitarix-lv2",
        "lsp-plugins-lv2"
    ];

    return (
        <div className="mfx-screen">
            <div className="mfx-screen-intro">
                <div className="mfx-screen-intro-title">PLUGINS</div>
                <div className="mfx-screen-intro-sub">
                    Install LV2 effects from Raspberry Pi OS, ToobAmp, extra apt repos, or PatchStorage
                </div>
            </div>
            <div className="page-scroll stack">
                <div className="row">
                    <TabButton label="INSTALLED" active={tab === "installed"} onClick={() => setTab("installed")} />
                    <TabButton label="APT" active={tab === "apt"} onClick={() => setTab("apt")} />
                    <TabButton label="REPOS" active={tab === "repos"} onClick={() => setTab("repos")} />
                    <TabButton label="PATCHSTORAGE" active={tab === "patchstorage"} onClick={() => setTab("patchstorage")} />
                </div>
                {busy && <div className="muted">{busy}</div>}
                {tab === "installed" && (
                    <InstalledTab
                        engine={engine}
                        run={run}
                        catalog={objects(engine.catalog.plugins)}
                        status={status}
                        aptPackages={aptInstalled}
                        bundles={bundles}
                        onRescan={() => work("Rescanning LV2…", async () => {
                            await engine.client.request("plugins/rescan");
                            await refreshStatus();
                        })}
                        onRemoveApt={(name) => work(`Removing ${name}…`, async () => {
                            await engine.client.request("plugins/apt/remove", { package: name });
                            await refreshAptInstalled();
                            await refreshStatus();
                        })}
                        onRemoveBundle={(directory) => work(`Removing ${directory}…`, async () => {
                            await engine.client.request("plugins/bundle/remove", { directory });
                            await refreshStatus();
                        })}
                    />
                )}
                {tab === "apt" && (
                    <AptTab
                        helper={helper}
                        https={https}
                        recommended={recommended.length ? recommended : [{
                            id: "toobamp",
                            package: "toobamp",
                            title: "ToobAmp",
                            url: "https://github.com/rerdavies/ToobAmp",
                            description: "Raspberry Pi guitar LV2 pack: NAM, cab IR, delay, reverb, EQ, modulation."
                        }]}
                        suggested={suggestedPackages}
                        query={aptQuery}
                        packages={aptResults}
                        onQuery={setAptQuery}
                        onSearch={() => work("Searching apt…", async () => {
                            const next = await engine.client.request("plugins/apt/search", { query: aptQuery });
                            setAptResults(objects(next.packages));
                        })}
                        onInstall={(name) => work(`Installing ${name}…`, async () => {
                            await engine.client.request("plugins/apt/install", { package: name });
                            await refreshAptInstalled();
                            await refreshStatus();
                            setAptResults((list) => list.map((item) => (
                                str(item.name) === name ? { ...item, installed: true } : item
                            )));
                        })}
                        onRemove={(name) => work(`Removing ${name}…`, async () => {
                            await engine.client.request("plugins/apt/remove", { package: name });
                            await refreshAptInstalled();
                            await refreshStatus();
                            setAptResults((list) => list.map((item) => (
                                str(item.name) === name ? { ...item, installed: false } : item
                            )));
                            setRecommended((list) => list.map((item) => (
                                str(item.package) === name ? { ...item, installed: false } : item
                            )));
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
                    />
                )}
                {tab === "repos" && (
                    <ReposTab
                        helper={helper}
                        repos={repos}
                        repoId={repoId}
                        repoUri={repoUri}
                        repoSuite={repoSuite}
                        repoComponents={repoComponents}
                        repoKeyUrl={repoKeyUrl}
                        onRepoId={setRepoId}
                        onRepoUri={setRepoUri}
                        onRepoSuite={setRepoSuite}
                        onRepoComponents={setRepoComponents}
                        onRepoKeyUrl={setRepoKeyUrl}
                        onAdd={() => work("Adding repo…", async () => {
                            await engine.client.request("plugins/repo/add", {
                                id: repoId,
                                uri: repoUri,
                                suite: repoSuite,
                                components: repoComponents,
                                keyUrl: repoKeyUrl
                            });
                            await refreshRepos();
                            setRepoId("");
                            setRepoUri("");
                            setRepoSuite("");
                            setRepoKeyUrl("");
                        })}
                        onRemove={(id) => work(`Removing ${id}…`, async () => {
                            await engine.client.request("plugins/repo/remove", { id });
                            await refreshRepos();
                        })}
                    />
                )}
                {tab === "patchstorage" && (
                    <PatchStorageTab
                        https={https}
                        query={patchQuery}
                        sort={patchSort}
                        patches={visiblePatches}
                        total={patches.length}
                        hasMore={patchHasMore}
                        listEndRef={listEndRef}
                        onQuery={setPatchQuery}
                        onSort={setPatchSort}
                        onReload={() => loadPatchStorage(true)}
                        onInstall={(patchId, title) => work(`Installing ${title}…`, async () => {
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
    engine,
    run,
    catalog,
    status,
    aptPackages,
    bundles,
    onRescan,
    onRemoveApt,
    onRemoveBundle
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    catalog: JsonObject[];
    status: JsonObject;
    aptPackages: JsonObject[];
    bundles: JsonObject[];
    onRescan: () => void;
    onRemoveApt: (name: string) => void;
    onRemoveBundle: (directory: string) => void;
}) {
    const chainPlugins = catalog.filter(isChainPlugin).sort((a, b) => str(a.name).localeCompare(str(b.name)));
    const hidden = Math.max(0, catalog.length - chainPlugins.length);
    return (
        <>
            <div className="panel stack">
                <h2>CHAIN PLUGINS</h2>
                <div className="muted">
                    {chainPlugins.length} effects with audio in and out
                    {hidden ? ` · ${hidden} utilities hidden` : ""}
                    {bool(status.lv2Available, true) ? "" : " · LV2 host not available in this build"}
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
                        </div>
                    ))}
                    {chainPlugins.length === 0 && <div className="muted">No chain-usable LV2 plugins loaded yet.</div>}
                </div>
            </div>
            <div className="panel stack">
                <h2>USER LV2</h2>
                <div className="muted">
                    Bundles under {str(status.lv2Dir, "/var/lib/pimfx/lv2")}. System plugins in /usr/lib/lv2 stay hidden here.
                </div>
                <LibraryBrowser engine={engine} run={run} kind="plugin" dualDefault={false} />
            </div>
            <div className="panel stack">
                <h2>APT PACKAGES</h2>
                {!bool(status.helperAvailable) && (
                    <div className="muted">The plugin helper is not running, so apt packages cannot be listed yet.</div>
                )}
                {aptPackages.filter((item) => bool(item.installed)).map((item) => (
                    <div className="list-item" key={str(item.name)}>
                        <div>
                            <strong>{str(item.name)}</strong>
                            <div className="muted">{str(item.description)}</div>
                        </div>
                        <button type="button" className="btn btn-danger" onClick={() => onRemoveApt(str(item.name))}>
                            REMOVE
                        </button>
                    </div>
                ))}
                {bool(status.helperAvailable) && aptPackages.filter((item) => bool(item.installed)).length === 0 && (
                    <div className="muted">No apt plugin packages installed yet.</div>
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

function AptTab({
    helper,
    https,
    recommended,
    suggested,
    query,
    packages,
    onQuery,
    onSearch,
    onInstall,
    onRemove,
    onInstallGithub
}: {
    helper: boolean;
    https: boolean;
    recommended: JsonObject[];
    suggested: string[];
    query: string;
    packages: JsonObject[];
    onQuery: (value: string) => void;
    onSearch: () => void;
    onInstall: (name: string) => void;
    onRemove: (name: string) => void;
    onInstallGithub: (id: string, title: string) => void;
}) {
    return (
        <>
            <div className="panel stack">
                <h2>RECOMMENDED</h2>
                <div className="muted">
                    Guitar LV2 packs with Raspberry Pi builds. Pi-MFX downloads the project's arm64 .deb onto this Pi;
                    each project keeps its own license.
                </div>
                {recommended.map((pack) => (
                    <div className="list-item" key={str(pack.id, str(pack.package))}>
                        <div>
                            <strong>{str(pack.title, str(pack.package))}</strong>
                            <div className="muted">
                                {str(pack.repo, str(pack.url))}
                                {str(pack.latestVersion) ? ` · ${str(pack.latestVersion)}` : ""}
                            </div>
                            {str(pack.description) && <div className="muted">{str(pack.description)}</div>}
                        </div>
                        {bool(pack.installed) ? (
                            <button type="button" className="btn btn-danger" onClick={() => onRemove(str(pack.package))}>
                                REMOVE
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="btn btn-accent"
                                disabled={!helper || !https}
                                onClick={() => onInstallGithub(str(pack.id, str(pack.package)), str(pack.title))}
                            >
                                INSTALL
                            </button>
                        )}
                    </div>
                ))}
            </div>
            <div className="panel stack">
                <h2>RASPBERRY PI OS</h2>
                <div className="muted">
                    Pi-MFX ships no effects. These packages come from your distro under each plugin's own license.
                </div>
                {!helper && (
                    <div className="danger">
                        The plugin helper is not running. Update Pi-MFX on the Pi, then use this page to install plugins.
                    </div>
                )}
                <div className="row">
                    {suggested.filter((name) => !recommended.some((pack) => str(pack.package) === name)).map((name) => (
                        <button key={name} type="button" className="btn" disabled={!helper} onClick={() => onInstall(name)}>
                            {name.toUpperCase()}
                        </button>
                    ))}
                </div>
                <label className="field">
                    <span>Search packages</span>
                    <input
                        value={query}
                        onChange={(event) => onQuery(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                onSearch();
                            }
                        }}
                    />
                </label>
                <button type="button" className="btn btn-accent" disabled={!helper} onClick={onSearch}>SEARCH</button>
            </div>
            <div className="panel stack">
                <h2>RESULTS</h2>
                {packages.map((item) => (
                    <div className="list-item" key={str(item.name)}>
                        <div>
                            <strong>{str(item.name)}</strong>
                            <div className="muted">{str(item.description)}</div>
                        </div>
                        {bool(item.installed) ? (
                            <button type="button" className="btn btn-danger" onClick={() => onRemove(str(item.name))}>
                                REMOVE
                            </button>
                        ) : (
                            <button type="button" className="btn btn-accent" disabled={!helper} onClick={() => onInstall(str(item.name))}>
                                INSTALL
                            </button>
                        )}
                    </div>
                ))}
                {packages.length === 0 && <div className="muted">Search for lv2, or install a suggested package above.</div>}
            </div>
        </>
    );
}

function ReposTab({
    helper,
    repos,
    repoId,
    repoUri,
    repoSuite,
    repoComponents,
    repoKeyUrl,
    onRepoId,
    onRepoUri,
    onRepoSuite,
    onRepoComponents,
    onRepoKeyUrl,
    onAdd,
    onRemove
}: {
    helper: boolean;
    repos: JsonObject[];
    repoId: string;
    repoUri: string;
    repoSuite: string;
    repoComponents: string;
    repoKeyUrl: string;
    onRepoId: (value: string) => void;
    onRepoUri: (value: string) => void;
    onRepoSuite: (value: string) => void;
    onRepoComponents: (value: string) => void;
    onRepoKeyUrl: (value: string) => void;
    onAdd: () => void;
    onRemove: (id: string) => void;
}) {
    return (
        <>
            <div className="panel stack">
                <h2>EXTRA APT REPOS</h2>
                <div className="muted">
                    HTTPS Debian repos only. Files are written as /etc/apt/sources.list.d/pimfx-&lt;id&gt;.list.
                    Without a signing key the repo is marked trusted=yes.
                </div>
                {!helper && (
                    <div className="danger">
                        The plugin helper is not running, so extra repos cannot be added from this Pi.
                    </div>
                )}
                <label className="field">
                    <span>Id (letters, digits, dashes)</span>
                    <input value={repoId} onChange={(event) => onRepoId(event.target.value)} placeholder="kxstudio" />
                </label>
                <label className="field">
                    <span>URI</span>
                    <input value={repoUri} onChange={(event) => onRepoUri(event.target.value)} placeholder="https://example.com/debian" />
                </label>
                <label className="field">
                    <span>Suite</span>
                    <input value={repoSuite} onChange={(event) => onRepoSuite(event.target.value)} placeholder="stable" />
                </label>
                <label className="field">
                    <span>Components</span>
                    <input value={repoComponents} onChange={(event) => onRepoComponents(event.target.value)} />
                </label>
                <label className="field">
                    <span>Signing key URL (optional, HTTPS)</span>
                    <input value={repoKeyUrl} onChange={(event) => onRepoKeyUrl(event.target.value)} />
                </label>
                <button type="button" className="btn btn-accent" disabled={!helper} onClick={onAdd}>ADD REPO</button>
            </div>
            <div className="panel stack">
                <h2>ADDED BY PI-MFX</h2>
                {repos.map((repo) => (
                    <div className="list-item" key={str(repo.id)}>
                        <div>
                            <strong>{str(repo.id)}</strong>
                            <div className="muted">{str(repo.line)}</div>
                        </div>
                        <button type="button" className="btn btn-danger" onClick={() => onRemove(str(repo.id))}>REMOVE</button>
                    </div>
                ))}
                {repos.length === 0 && <div className="muted">No extra repos yet.</div>}
            </div>
        </>
    );
}

function PatchStorageTab({
    https,
    query,
    sort,
    patches,
    total,
    hasMore,
    listEndRef,
    onQuery,
    onSort,
    onReload,
    onInstall
}: {
    https: boolean;
    query: string;
    sort: PatchSort;
    patches: JsonObject[];
    total: number;
    hasMore: boolean;
    listEndRef: { current: HTMLDivElement | null };
    onQuery: (value: string) => void;
    onSort: (value: PatchSort) => void;
    onReload: () => void;
    onInstall: (patchId: number, title: string) => void;
}) {
    return (
        <>
            <div className="panel stack">
                <h2>PATCHSTORAGE</h2>
                <div className="muted">
                    LV2 plugins built for Raspberry Pi 64-bit (rpi-aarch64). The first page
                    opens immediately; more plugins load as you scroll. Pi-MFX downloads a file
                    you asked for onto this Pi. Each plugin keeps its own license.
                </div>
                {!https && <div className="danger">This build has no HTTPS support, so PatchStorage is unavailable.</div>}
                <div className="row">
                    <label className="field">
                        <span>Filter</span>
                        <input
                            value={query}
                            onChange={(event) => onQuery(event.target.value)}
                            placeholder="NAM, delay, reverb…"
                        />
                    </label>
                    <label className="field">
                        <span>Sort</span>
                        <select value={sort} onChange={(event) => onSort(event.target.value as PatchSort)}>
                            <option value="downloads">Most downloads</option>
                            <option value="alpha">Alphabetical</option>
                            <option value="newest">Newest</option>
                            <option value="updated">Recently updated</option>
                        </select>
                    </label>
                </div>
                <button type="button" className="btn" disabled={!https} onClick={onReload}>RELOAD</button>
            </div>
            <div className="panel stack">
                <h2>PLUGINS</h2>
                <div className="muted">
                    {total === 0
                        ? "No plugins loaded yet."
                        : query.trim()
                            ? `${patches.length} of ${total} plugins`
                            : `${total} plugins${hasMore ? " so far" : ""}`}
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
                                onClick={() => onInstall(num(patch.id), str(patch.title))}
                            >
                                INSTALL
                            </button>
                        )}
                    </div>
                ))}
                {total > 0 && patches.length === 0 && (
                    <div className="muted">No plugins match that filter.</div>
                )}
                {hasMore && <div className="muted">Loading more…</div>}
                <div ref={listEndRef} />
            </div>
        </>
    );
}
