import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineSnapshot } from "../api";
import { bool, obj, objects, str, type JsonObject } from "../json";

type Tab = "catalog" | "share";
type LocalPreset = { key: string; bankId: string; bankName: string; presetId: string; presetName: string };

const effectName = (uri: string) => ({
    "http://two-play.com/plugins/toob-nam": "TooB Neural Amp Modeler",
    "http://two-play.com/plugins/toob-cab-ir": "TooB Cab IR"
} as Record<string, string>)[uri] ?? uri;

export function CommunityPresetsView({ engine, run }: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const [tab, setTab] = useState<Tab>("catalog");
    const [status, setStatus] = useState<JsonObject>({});
    const [catalog, setCatalog] = useState<JsonObject>({});
    const [query, setQuery] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const [selectedManifest, setSelectedManifest] = useState<JsonObject>({});
    const [manifestLoadState, setManifestLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
    const [plan, setPlan] = useState<JsonObject | null>(null);
    const [installResult, setInstallResult] = useState<JsonObject | null>(null);
    const [busy, setBusy] = useState("");
    const [sharePresetKey, setSharePresetKey] = useState("");
    const [share, setShare] = useState({
        name: "", author: str(obj(engine.state.ui).communityAuthor), description: "", tags: ""
    });
    const [manifest, setManifest] = useState<JsonObject | null>(null);
    const [contextPreset, setContextPreset] = useState<JsonObject | null>(null);
    const [confirmUninstall, setConfirmUninstall] = useState<JsonObject | null>(null);
    const holdTimer = useRef<number | null>(null);

    const load = (refresh = true) => run(async () => {
        if (busy) return;
        setBusy("Loading community catalog…");
        try {
            const [nextStatus, nextCatalog] = await Promise.all([
                engine.client.request("community/status"),
                engine.client.request("community/catalog", { refresh })
            ]);
            setStatus(nextStatus);
            setCatalog(nextCatalog);
        } finally { setBusy(""); }
    });

    useEffect(() => { void load(true); }, []);

    const entries = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return objects(catalog.presets).filter((item) => !needle
            || [item.name, item.author, ...(Array.isArray(item.tags) ? item.tags : [])]
                .some((value) => String(value).toLowerCase().includes(needle)));
    }, [catalog.presets, query]);
    const installedIds = useMemo(() => new Set(objects(engine.state.banks).flatMap((bank) =>
        objects(bank.presets).map((preset) => str(obj(preset.community).catalogId)).filter(Boolean)
    )), [engine.state.banks]);

    useEffect(() => {
        if (entries.length === 0) { setSelectedId(""); setSelectedManifest({}); setManifestLoadState("idle"); return; }
        if (!entries.some((item) => str(item.id) === selectedId)) setSelectedId(str(entries[0].id));
    }, [entries, selectedId]);

    useEffect(() => {
        if (!selectedId) { setManifestLoadState("idle"); return; }
        let current = true;
        setSelectedManifest({});
        setManifestLoadState("loading");
        void engine.client.request("community/preset", { id: selectedId }).then((next) => {
            if (current) { setSelectedManifest(next); setManifestLoadState("ready"); }
        }).catch(() => { if (current) { setSelectedManifest({}); setManifestLoadState("error"); } });
        return () => { current = false; };
    }, [selectedId, engine.client]);

    const localPresets = useMemo<LocalPreset[]>(() => objects(engine.state.banks).flatMap((bank) =>
        objects(bank.presets)
            .filter((preset) => Object.keys(obj(preset.community)).length === 0)
            .map((preset) => ({
                key: `${str(bank.id)}:${str(preset.id)}`,
                bankId: str(bank.id), bankName: str(bank.name, "Bank"),
                presetId: str(preset.id), presetName: str(preset.name, "Preset")
            }))
    ), [engine.state.banks]);

    useEffect(() => {
        if (localPresets.length === 0) { setSharePresetKey(""); return; }
        if (!localPresets.some((item) => item.key === sharePresetKey)) setSharePresetKey(localPresets[0].key);
    }, [localPresets, sharePresetKey]);

    useEffect(() => {
        const selected = localPresets.find((item) => item.key === sharePresetKey);
        if (!selected) return;
        setShare((current) => ({ ...current, name: selected.presetName }));
        setManifest(null);
    }, [sharePresetKey, localPresets]);

    const selectedEntry = entries.find((item) => str(item.id) === selectedId);
    const selectedLocal = localPresets.find((item) => item.key === sharePresetKey);
    const openCatalog = () => { setTab("catalog"); void load(true); };

    const reviewInstall = (id: string) => run(async () => {
        setBusy("Building installation plan…"); setInstallResult(null);
        try { setPlan(await engine.client.request("community/install/plan", { id })); }
        finally { setBusy(""); }
    });

    const confirmInstall = () => {
        const token = str(obj(plan).planToken);
        if (!token) return;
        void run(async () => {
            setBusy("Installing approved requirements…");
            try {
                const result = await engine.client.request("community/install/confirm", { planToken: token });
                setInstallResult(result); setPlan(null);
            } finally { setBusy(""); }
        });
    };

    const saveAuthor = () => {
        const author = share.author.trim();
        if (!author || author === str(obj(engine.state.ui).communityAuthor)) return;
        void run(() => engine.client.request("ui/settings", { communityAuthor: author }));
    };

    const generateManifest = () => run(async () => {
        if (!selectedLocal) return;
        setBusy("Checking preset and dependencies…");
        try {
            const name = share.name.trim();
            const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
            const result = await engine.client.request("community/share/manifest", {
                bankId: selectedLocal.bankId, presetId: selectedLocal.presetId,
                id, name, author: share.author.trim(), description: share.description.trim(),
                tags: share.tags.split(",").map((item) => item.trim()).filter(Boolean),
                minimumPiMfxVersion: "0.1.0"
            });
            setManifest(obj(result.manifest)); saveAuthor();
        } finally { setBusy(""); }
    });

    const downloadManifest = () => {
        if (!manifest) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }));
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = `${str(manifest.id, "pimfx-community-preset")}.json`; anchor.click();
        URL.revokeObjectURL(url);
    };

    const submitForReview = () => {
        if (!manifest || !bool(status.submissionAvailable)) return;
        const submissionUrl = str(status.submissionUrl);
        if (!submissionUrl.startsWith("https://github.com/MegaNoob75/Pi-MFX-Community-Presets/")) return;
        downloadManifest(); window.open(submissionUrl, "_blank", "noopener,noreferrer");
    };

    const clearHold = () => {
        if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
        holdTimer.current = null;
    };
    const uninstall = (item: JsonObject) => {
        setConfirmUninstall(null); setContextPreset(null);
        void run(async () => {
            setBusy("Uninstalling community preset…");
            try {
                await engine.client.request("community/uninstall", { id: str(item.id) });
                setInstallResult(null);
            } finally { setBusy(""); }
        });
    };

    const dependencyRows = [
        ...objects(obj(selectedManifest.dependencies).effects).map((item) => ({
            label: effectName(str(item.uri)), detail: "LV2 PLUGIN"
        })),
        ...objects(obj(selectedManifest.dependencies).tone3000).map((item) => ({
            label: str(item.expectedFilename),
            detail: `${str(item.kind, "model").toUpperCase()} · TONE3000 ${str(item.modelId)}`
        })),
        ...objects(obj(selectedManifest.dependencies).irs).map((item) => ({
            label: str(item.expectedFilename), detail: "CABINET IR"
        })),
        ...objects(obj(selectedManifest.dependencies).localAssets).map((item) => ({
            label: str(item.expectedFilename), detail: `${str(item.kind, "asset").toUpperCase()} · MANUAL`
        }))
    ];

    return <div className="community-view">
        <div className="view-tabs compact-tabs">
            <button className={tab === "catalog" ? "active" : ""} onClick={openCatalog}>CATALOG</button>
            <button className={tab === "share" ? "active" : ""} onClick={() => setTab("share")}>SHARE PRESET</button>
        </div>
        {busy && <div className="community-banner">{busy}</div>}
        {tab === "catalog" ? <div className="community-catalog">
            {bool(catalog.cached) && <div className="notice">USING SAVED CATALOG — {str(catalog.refreshError, "OFFLINE")}</div>}
            <input className="field-input" value={query} onChange={(event) => setQuery(event.target.value)}
                placeholder="Search presets, authors or tags" aria-label="Search community presets" />
            {entries.length === 0 ? <div className="empty-state"><strong>NO COMMUNITY PRESETS YET</strong><span>The catalog is ready for its first approved submission.</span></div>
                : <div className="community-browser">
                    <div className="community-list" data-mfx-nav-list>{entries.map((item) => {
                        const id = str(item.id);
                        return <button key={id} className={`community-list-row${selectedId === id ? " selected" : ""}`}
                            onPointerDown={() => {
                                clearHold();
                                if (installedIds.has(id)) holdTimer.current = window.setTimeout(() => {
                                    setSelectedId(id); setContextPreset(item); holdTimer.current = null;
                                }, 600);
                            }} onPointerUp={clearHold} onPointerCancel={clearHold} onPointerLeave={clearHold}
                            onClick={() => setSelectedId(id)} onDoubleClick={() => void reviewInstall(id)}>
                            <strong>{str(item.name, id)}{installedIds.has(id) && <span className="community-installed" title="Installed">✓</span>}</strong>
                            <span>{str(item.author, "Unknown author")}</span>
                        </button>;
                    })}</div>
                    <section className="community-detail">
                        <div><h2>{str(selectedEntry?.name, selectedId).toUpperCase()}</h2><p className="muted">{str(selectedEntry?.author, "Unknown author")} · MIT</p></div>
                        <p>{str(selectedEntry?.description, "No description provided.")}</p>
                        <div className="community-tags">{(Array.isArray(selectedEntry?.tags) ? selectedEntry.tags : []).map((tag) => <span key={String(tag)}>{String(tag)}</span>)}</div>
                        <div className="community-dependency-summary"><strong>REQUIREMENTS</strong>
                            {manifestLoadState === "loading" && <span className="muted">Loading requirements…</span>}
                            {manifestLoadState === "error" && <span className="danger">Requirements could not be loaded. Reopen the catalog to retry.</span>}
                            {manifestLoadState === "ready" && dependencyRows.length === 0 && <span className="muted">No external NAM, IR or LV2 requirements.</span>}
                            {dependencyRows.map((item, index) => <div key={`${item.label}-${index}`}><span>{item.label}</span><small>{item.detail}</small></div>)}
                        </div>
                        <button className="btn btn-accent community-review" disabled={!selectedId || !!busy}
                            onClick={() => void reviewInstall(selectedId)}>REVIEW &amp; INSTALL</button>
                    </section>
                </div>}
            {installResult && <div className={bool(installResult.incomplete) ? "notice danger" : "notice success"}>
                {bool(installResult.incomplete) ? <>
                    <strong>Imported into the Community staging bank. These requirements need attention:</strong>
                    <div className="community-unresolved">{objects(installResult.unresolved).map((item, index) => <div key={`${str(item.id, str(item.uri))}-${index}`}>
                        <span>{effectName(str(item.label, str(item.expectedFilename, str(item.uri, "Unknown requirement"))))}</span>
                        <small>{str(item.reason, "This requirement is unavailable.")}</small>
                    </div>)}</div>
                </> : "Installed into the Community staging bank without overwriting user data."}
            </div>}
        </div> : <div className="community-share">
            <p className="muted">Choose one of your local presets. Community-installed presets are excluded. Manifests use MIT; referenced TONE3000 assets keep their own creator and license attribution.</p>
            <div className="notice">PUBLISHING: Check &amp; Create → Submit for Review and attach the downloaded JSON → after validation, apply <strong>approved-for-pr</strong> → merge the generated pull request.</div>
            {localPresets.length === 0 ? <div className="empty-state"><strong>NO LOCAL PRESETS TO SHARE</strong></div> : <>
                <div className="community-share-layout">
                    <div className="community-local-list" data-mfx-nav-list>{localPresets.map((item) => <button key={item.key}
                        className={`community-list-row${sharePresetKey === item.key ? " selected" : ""}`} onClick={() => setSharePresetKey(item.key)}>
                        <strong>{item.presetName}</strong><span>{item.bankName}</span>
                    </button>)}</div>
                    <div className="community-form">
                        <label className="field"><span>Community name</span><input value={share.name} onChange={(e) => { setShare({ ...share, name: e.target.value }); setManifest(null); }} /></label>
                        <label className="field"><span>Author</span><input value={share.author} onBlur={saveAuthor} onChange={(e) => { setShare({ ...share, author: e.target.value }); setManifest(null); }} /></label>
                        <label className="field wide"><span>Description</span><textarea value={share.description} onChange={(e) => { setShare({ ...share, description: e.target.value }); setManifest(null); }} /></label>
                        <label className="field wide"><span>Tags, comma separated</span><input value={share.tags} onChange={(e) => { setShare({ ...share, tags: e.target.value }); setManifest(null); }} /></label>
                        <div className="notice wide">LICENSE: MIT</div>
                    </div>
                </div>
                <div className="button-row">
                    <button className="btn btn-accent" disabled={!selectedLocal || !share.name.trim() || !share.author.trim() || !!busy} onClick={() => void generateManifest()}>CHECK &amp; CREATE</button>
                    <button className="btn" disabled={!manifest} onClick={downloadManifest}>DOWNLOAD JSON</button>
                    <button className="btn" disabled={!manifest || !bool(status.submissionAvailable)} title={str(status.submissionMessage)} onClick={submitForReview}>DOWNLOAD &amp; OPEN REVIEW</button>
                </div>
            </>}
            {manifest && <div className="notice success">Ready. The JSON will download and GitHub will open. Attach it, create the submission, apply approved-for-pr after validation, then merge the generated pull request to publish.</div>}
        </div>}
        {plan && <div className="dialog-backdrop"><div className="dialog community-plan" role="dialog" aria-modal="true" aria-label="Community preset installation plan">
            <h2>INSTALL {str(plan.name).toUpperCase()}</h2><p>{str(plan.author)} · MIT</p>
            <div className="community-requirements" data-mfx-nav-list>{objects(plan.requirements).map((item, index) => <div className="community-requirement" key={`${str(item.id)}-${index}`}>
                <span>{str(item.label, str(item.id))}</span><strong>{str(item.status).toUpperCase()}</strong>
            </div>)}</div>
            <p className="muted">Imports into the Community staging bank. Move it to a normal bank before using it in Performance. Existing banks and presets are never overwritten.</p>
            {!bool(plan.complete) && <p className="danger">Unavailable requirements will be clearly marked incomplete; Pi-MFX will not substitute them.</p>}
            {!bool(plan.compatible, true) && <p className="danger">{str(plan.compatibilityError, "This preset is not compatible with this device.")}</p>}
            <div className="button-row"><button className="btn" onClick={() => { void engine.client.request("community/install/cancel"); setPlan(null); }}>CANCEL</button>
                <button className="btn btn-accent" onClick={confirmInstall} disabled={!!busy || !str(plan.planToken)}>CONFIRM INSTALL</button></div>
        </div></div>}
        {contextPreset && <div className="dialog-backdrop" onClick={() => setContextPreset(null)}><div className="dialog" onClick={(event) => event.stopPropagation()}>
            <h2>{str(contextPreset.name, "COMMUNITY PRESET").toUpperCase()}</h2>
            <button className="btn btn-danger" onClick={() => { setConfirmUninstall(contextPreset); setContextPreset(null); }}>UNINSTALL</button>
        </div></div>}
        {confirmUninstall && <div className="dialog-backdrop"><div className="dialog" role="dialog" aria-modal="true" aria-label="Uninstall community preset">
            <h2>UNINSTALL PRESET?</h2>
            <p>Remove every local copy of “{str(confirmUninstall.name)}” and its unused NAM/IR files from the Community folders? The public catalog entry will remain.</p>
            <div className="button-row"><button className="btn" onClick={() => setConfirmUninstall(null)}>CANCEL</button>
                <button className="btn btn-danger" onClick={() => uninstall(confirmUninstall)}>UNINSTALL</button></div>
        </div></div>}
    </div>;
}
