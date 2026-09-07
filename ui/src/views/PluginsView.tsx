import { useEffect, useState } from "react";
import type { EngineSnapshot } from "../api";
import { arr, bool, num, str, objects, type JsonObject } from "../json";

type PluginTab = "installed" | "apt" | "repos" | "patchstorage";

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
    const [busy, setBusy] = useState("");
    const [recommended, setRecommended] = useState<JsonObject[]>([]);

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

    const helper = bool(status.helperAvailable);
    const https = bool(status.httpsAvailable, true);
    const bundles = objects(status.bundles);
    const suggested = arr(status.suggestedPackages).map((item) => String(item));
    const suggestedPackages = suggested.length ? suggested : [
        "calf-plugins",
        "x42-plugins",
        "zam-plugins",
        "guitarix-lv2",
        "lsp-plugins-lv2"
    ];

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
                        patches={patches}
                        onQuery={setPatchQuery}
                        onSearch={() => work("Searching PatchStorage…", async () => {
                            const next = await engine.client.request("plugins/patchstorage/search", {
                                query: patchQuery,
                                page: 1
                            });
                            setPatches(objects(next.items));
                        })}
                        onInstall={(patchId, title) => work(`Installing ${title}…`, async () => {
                            await engine.client.request("plugins/patchstorage/install", { patchId });
                            await refreshStatus();
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
    status,
    aptPackages,
    bundles,
    onRescan,
    onRemoveApt,
    onRemoveBundle
}: {
    status: JsonObject;
    aptPackages: JsonObject[];
    bundles: JsonObject[];
    onRescan: () => void;
    onRemoveApt: (name: string) => void;
    onRemoveBundle: (directory: string) => void;
}) {
    return (
        <>
            <div className="panel stack">
                <h2>CATALOG</h2>
                <div className="muted">
                    {num(status.pluginCount)} plugins loaded
                    {bool(status.lv2Available, true) ? "" : " · LV2 host not available in this build"}
                </div>
                <div className="muted">User bundles: {str(status.lv2Dir, "/var/lib/pimfx/lv2")}</div>
                <button type="button" className="btn" onClick={onRescan}>RESCAN LV2</button>
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
                <h2>PATCHSTORAGE / USER BUNDLES</h2>
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
    patches,
    onQuery,
    onSearch,
    onInstall
}: {
    https: boolean;
    query: string;
    patches: JsonObject[];
    onQuery: (value: string) => void;
    onSearch: () => void;
    onInstall: (patchId: number, title: string) => void;
}) {
    return (
        <>
            <div className="panel stack">
                <h2>PATCHSTORAGE</h2>
                <div className="muted">
                    LV2 plugins built for Raspberry Pi 64-bit (rpi-aarch64). Pi-MFX downloads a file you asked for
                    onto this Pi. Each plugin keeps its own license.
                </div>
                {!https && <div className="danger">This build has no HTTPS support, so PatchStorage is unavailable.</div>}
                <label className="field">
                    <span>Search</span>
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
                <button type="button" className="btn btn-accent" disabled={!https} onClick={onSearch}>SEARCH</button>
            </div>
            <div className="panel stack">
                <h2>RESULTS</h2>
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
                        <button
                            type="button"
                            className="btn btn-accent"
                            disabled={!https}
                            onClick={() => onInstall(num(patch.id), str(patch.title))}
                        >
                            INSTALL
                        </button>
                    </div>
                ))}
                {patches.length === 0 && <div className="muted">Search for NAM, reverb, delay, or leave blank for popular LV2 builds.</div>}
            </div>
        </>
    );
}
