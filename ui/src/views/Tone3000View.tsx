import { useEffect, useRef, useState } from "react";
import type { EngineSnapshot } from "../api";
import { arr, bool, num, obj, str, objects, type Json, type JsonObject } from "../json";
import {
    LibraryFileManager,
    LibraryFolderPicker,
    loadTone3000Dir,
    saveTone3000Dir,
    type LibraryKind
} from "./LibraryManager";

type OAuthCallback = {
    code: string;
    state: string;
    toneId: string;
    canceled: boolean;
    error: string;
};

function thisPageRedirect(): string {
    return `${window.location.origin}/`;
}

function parseOAuthCallback(text: string): OAuthCallback | null {
    const raw = text.trim();
    const parse = (params: URLSearchParams): OAuthCallback | null => {
        const code = params.get("code") ?? "";
        const state = params.get("state") ?? "";
        const toneId = params.get("tone_id") ?? "";
        const canceled = params.get("canceled") === "true";
        const error = params.get("error") ?? "";
        return code || state || toneId || canceled || error
            ? { code, state, toneId, canceled, error }
            : null;
    };
    try {
        const parsed = parse(new URL(raw).searchParams);
        if (parsed) return parsed;
    } catch {
        // Accept a pasted query string as well as a complete callback URL.
    }
    const query = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw;
    return parse(new URLSearchParams(query));
}

function clearOAuthCallback(): void {
    const url = new URL(window.location.href);
    for (const key of ["code", "state", "tone_id", "canceled", "error", "error_description"]) {
        url.searchParams.delete(key);
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function jsonId(value: Json | undefined, fallback = ""): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : str(value, fallback);
}

function extractList(payload: Json | undefined): JsonObject[] {
    if (objects(payload).length) return objects(payload);
    const body = obj(payload);
    if (objects(body.data).length) return objects(body.data);
    if (objects(body.models).length) return objects(body.models);
    return objects(body.results);
}

function toneName(tone: JsonObject): string {
    return str(tone.name, str(tone.title, "TONE3000 tone"));
}

function creatorName(tone: JsonObject): string {
    const user = obj(tone.user);
    const name = str(user.username, str(tone.creator, str(user.name))).replace(/^@/, "").trim();
    return name ? `@${name}` : "";
}

function toneImage(tone: JsonObject): string {
    const image = arr(tone.images).find((item) => typeof item === "string" && item.length > 0);
    return typeof image === "string" ? image : "";
}

function modelUrl(model: JsonObject): string {
    return str(model.model_url, str(model.url, str(model.downloadUrl, str(model.download_url))));
}

function modelFileHint(model: JsonObject): string {
    const url = modelUrl(model).split("?")[0] ?? "";
    return str(model.filename, str(model.name, url)).toLowerCase();
}

function modelIsIr(tone: JsonObject, model: JsonObject): boolean {
    const hint = modelFileHint(model);
    if (/\.(wav|flac|aiff|aif)$/.test(hint)) return true;
    if (/\.nam$/.test(hint)) return false;
    const format = `${str(tone.format)} ${str(tone.gear)} ${str(model.format)} ${str(model.kind)}`.toLowerCase();
    return /(^|\s)(ir|impulse|wav)(\s|$)/.test(format);
}

function downloadKind(tone: JsonObject, model: JsonObject): "model" | "ir" {
    return modelIsIr(tone, model) ? "ir" : "model";
}

function architectureLabel(model: JsonObject): string {
    const value = str(model.architecture_version, jsonId(model.architecture_version));
    if (!value) return "";
    if (value === "custom") return "Custom";
    return /^a/i.test(value) ? value.toUpperCase() : `A${value}`;
}

function fileStem(name: string): string {
    const leaf = name.replace(/\\/g, "/").split("/").pop() ?? name;
    return leaf.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function libraryFileStems(library: JsonObject): Set<string> {
    const stems = new Set<string>();
    for (const key of ["models", "impulseResponses"] as const) {
        for (const item of objects(library[key])) {
            const stem = fileStem(str(item.name, str(item.path)));
            if (stem) stems.add(stem);
        }
    }
    return stems;
}

function modelOnDevice(model: JsonObject, stems: Set<string>): boolean {
    return [str(model.name), str(model.filename), modelFileHint(model)].some((name) => {
        const stem = fileStem(name);
        return stem.length > 1 && stems.has(stem);
    });
}

export function Tone3000View({
    engine,
    run,
    pane = "catalog",
    onOpenSettings
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    pane?: "settings" | "catalog";
    onOpenSettings?: () => void;
}) {
    const [status, setStatus] = useState<JsonObject>({});
    const [key, setKey] = useState("");
    const [redirect, setRedirect] = useState(thisPageRedirect);
    const [manualCode, setManualCode] = useState("");
    const [manualState, setManualState] = useState("");
    const [message, setMessage] = useState("");
    const [selectedTone, setSelectedTone] = useState<JsonObject | null>(null);
    const [models, setModels] = useState<JsonObject[]>([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [folderPicker, setFolderPicker] = useState<"model" | "ir" | null>(null);
    const [pendingDownload, setPendingDownload] = useState<JsonObject[]>([]);
    const [downloading, setDownloading] = useState(false);
    const [downloadStatus, setDownloadStatus] = useState("");
    const [downloadError, setDownloadError] = useState("");
    const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0, name: "" });
    const [downloadFiles, setDownloadFiles] = useState<JsonObject[]>([]);
    const completingOauth = useRef(false);

    const refreshStatus = async () => {
        const result = await engine.client.request("tone3000/status");
        setStatus(result);
        setKey(str(result.publishableKey));
        setRedirect(str(result.redirectUri, thisPageRedirect()));
    };

    useEffect(() => {
        void refreshStatus().catch((error: unknown) => {
            setMessage(error instanceof Error ? error.message : String(error));
        });
        void engine.client.request("library").catch(() => undefined);
    }, [engine.client]);

    const resolveModel = async (model: JsonObject): Promise<JsonObject> => {
        if (modelUrl(model)) return model;
        const modelId = jsonId(model.id);
        if (!modelId) return model;
        const result = await engine.client.request("tone3000/model", { modelId });
        const body = obj(result.result);
        return { ...model, ...body, ...(objects(body.data)[0] ?? {}) };
    };

    const loadSelectedTone = async (toneId: string) => {
        setLoadingModels(true);
        setDownloadError("");
        setDownloadStatus("");
        try {
            const toneResult = await engine.client.request("tone3000/tone", { toneId });
            const toneBody = obj(toneResult.result);
            const tone = objects(toneBody.data)[0] ?? toneBody;
            setSelectedTone(tone);
            const responses = await Promise.allSettled([
                engine.client.request("tone3000/models", { toneId, architecture: "2", page_size: 100 }),
                engine.client.request("tone3000/models", { toneId, page_size: 100 })
            ]);
            const merged: JsonObject[] = [];
            const seen = new Set<string>();
            for (const response of responses) {
                if (response.status !== "fulfilled") continue;
                for (const model of extractList(response.value.result)) {
                    const id = jsonId(model.id, modelUrl(model) || str(model.name));
                    if (!id || seen.has(id)) continue;
                    seen.add(id);
                    merged.push(model);
                }
            }
            const resolved: JsonObject[] = [];
            for (const model of merged) {
                try {
                    resolved.push(await resolveModel(model));
                } catch {
                    resolved.push(model);
                }
            }
            setModels(resolved);
            if (!resolved.length) setDownloadError("TONE3000 did not list any downloadable models for that tone.");
        } finally {
            setLoadingModels(false);
        }
    };

    useEffect(() => {
        const callback = parseOAuthCallback(window.location.href);
        if (!callback || completingOauth.current) return;
        completingOauth.current = true;
        void run(async () => {
            try {
                if (callback.error) throw new Error(`TONE3000 returned ${callback.error}.`);
                if (callback.canceled) {
                    setMessage("TONE3000 browsing canceled.");
                    return;
                }
                if (!callback.code || !callback.state) throw new Error("TONE3000 returned an incomplete authorization response.");
                await engine.client.request("tone3000/auth/complete", {
                    code: callback.code,
                    state: callback.state
                });
                await refreshStatus();
                if (callback.toneId) await loadSelectedTone(callback.toneId);
                else setMessage("Signed in to TONE3000.");
            } finally {
                clearOAuthCallback();
                completingOauth.current = false;
            }
        });
        // The callback is consumed once from the browser address.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine.client]);

    const startHostedBrowse = () => {
        if (!bool(status.configured)) {
            onOpenSettings?.();
            return;
        }
        void run(async () => {
            const result = await engine.client.request("tone3000/auth/start", {
                prompt: "select_tone",
                menubar: "true",
                preview: "true",
                redirectUri: thisPageRedirect()
            });
            const url = str(result.authorizeUrl);
            if (url) window.location.assign(url);
        });
    };

    const downloadModels = async (tone: JsonObject, selected: JsonObject[], directory: string, chosenKind: LibraryKind) => {
        setDownloading(true);
        setDownloadError("");
        setDownloadFiles([]);
        setDownloadProgress({ current: 0, total: selected.length, name: "" });
        try {
            setDownloadStatus(`Preparing ${selected.length} file${selected.length === 1 ? "" : "s"}…`);
            const resolved = await Promise.all(selected.map((model) => resolveModel(model)));
            const items = resolved.map((model, index) => {
                const name = str(model.name, toneName(tone));
                const modelId = jsonId(model.id, jsonId(selected[index].id));
                const kind = downloadKind(tone, model);
                return {
                    url: modelUrl(model),
                    modelId,
                    toneId: jsonId(tone.id),
                    toneTitle: toneName(tone),
                    creator: creatorName(tone).replace(/^@/, ""),
                    sourceLicense: str(obj(tone.license).name, str(tone.license)),
                    architecture: str(model.architecture_version),
                    name,
                    kind,
                    directory: kind === chosenKind ? directory : loadTone3000Dir(kind)
                };
            });
            setDownloadProgress({ current: 0, total: selected.length, name: "Up to 3 files at once" });
            setDownloadFiles(items.map((item) => ({ name: item.name, state: "queued" })));
            const started = await engine.client.request("tone3000/download-job/start", { items });
            const jobId = str(started.jobId);
            let response: JsonObject = {};
            do {
                response = await engine.client.request("tone3000/download-job/status", { jobId });
                const files = objects(response.files);
                const completed = num(response.completed);
                const active = files.filter((file) => str(file.state) === "downloading");
                setDownloadFiles(files);
                setDownloadProgress({
                    current: completed,
                    total: selected.length,
                    name: active.length ? active.map((file) => str(file.name)).join(" · ") : "Finishing…"
                });
                setDownloadStatus(`Finished ${completed} of ${selected.length} · ${active.length} downloading`);
                if (!bool(response.done)) {
                    await new Promise((resolve) => window.setTimeout(resolve, 250));
                }
            } while (!bool(response.done));
            const files = objects(response.files);
            const saved = files.filter((file) => str(file.state) === "saved");
            const failed = files.filter((file) => str(file.state) === "failed");
            await engine.client.request("library");
            setDownloadProgress({ current: selected.length, total: selected.length, name: "" });
            setDownloadStatus(`Finished downloading. Saved ${saved.length} file${saved.length === 1 ? "" : "s"} to the Pi-MFX library.`);
            if (failed.length) {
                const first = failed[0];
                setDownloadError(`${failed.length} file${failed.length === 1 ? "" : "s"} failed. ${str(first.name)}: ${str(first.error)}`);
            }
        } catch (error: unknown) {
            setDownloadError(error instanceof Error ? error.message : String(error));
            setDownloadStatus("");
        } finally {
            setDownloading(false);
        }
    };

    const queueDownload = (selected: JsonObject[]) => {
        if (!selectedTone || !selected.length) return;
        const kind = downloadKind(selectedTone, selected[0]);
        setPendingDownload(selected);
        setFolderPicker(kind);
    };

    const settingsForm = (
        <>
            <h2>TONE3000</h2>
            <div className="muted">
                Use the publishable key from TONE3000 Settings → API Keys. Register this page&apos;s address as the redirect URI.
                Pi-MFX uses TONE3000&apos;s hosted catalog and never stores a secret key.
            </div>
            <div className="muted">
                Register every address you browse Pi-MFX from, including the controller&apos;s <code>http://127.0.0.1:8080/</code>
                and this browser&apos;s <code>{thisPageRedirect()}</code>.
            </div>
            {!bool(status.available, true) && <div className="danger">This build has no HTTPS support.</div>}
            {message && <div className="muted">{message}</div>}
            <label className="field">
                <span>Publishable key (t3k_pub_…)</span>
                <input value={key} onChange={(event) => setKey(event.target.value)} />
            </label>
            <label className="field">
                <span>Redirect URI</span>
                <input value={redirect} onChange={(event) => setRedirect(event.target.value)} />
            </label>
            <div className="row">
                <button type="button" className="btn" onClick={() => setRedirect(thisPageRedirect())}>USE THIS ADDRESS</button>
                <button type="button" className="btn btn-accent" onClick={() => void run(async () => {
                    await engine.client.request("tone3000/configure", {
                        publishableKey: key.trim(),
                        redirectUri: redirect.trim() || thisPageRedirect()
                    });
                    await refreshStatus();
                    setMessage("TONE3000 settings saved.");
                })}>SAVE</button>
                {bool(status.connected) && (
                    <button type="button" className="btn" onClick={() => void run(async () => {
                        await engine.client.request("tone3000/auth/logout");
                        await refreshStatus();
                    })}>SIGN OUT</button>
                )}
            </div>
            {!bool(status.connected) && (
                <div className="row">
                    <label className="field">
                        <span>OAuth code or callback URL</span>
                        <input value={manualCode} onChange={(event) => setManualCode(event.target.value)} />
                    </label>
                    <label className="field">
                        <span>State</span>
                        <input value={manualState} onChange={(event) => setManualState(event.target.value)} />
                    </label>
                    <button type="button" className="btn" onClick={() => void run(async () => {
                        const parsed = parseOAuthCallback(manualCode);
                        await engine.client.request("tone3000/auth/complete", parsed ?? { code: manualCode, state: manualState });
                        await refreshStatus();
                    })}>COMPLETE</button>
                </div>
            )}
        </>
    );

    if (pane === "settings") return <div className="panel stack">{settingsForm}</div>;

    const stems = libraryFileStems(engine.library);
    return (
        <div className="mfx-screen">
            <div className="mfx-screen-intro">
                <div className="mfx-screen-intro-title">MODEL LIBRARY</div>
                <div className="mfx-screen-intro-sub">Manage local NAM models and impulse responses</div>
            </div>
            <div className="model-library-body">
                <div className="panel row model-library-launch">
                    <div style={{ flex: 1 }}>
                        <div className="field-label">TONE3000</div>
                        <div className="muted">Browse the complete catalog, preview tones, then return here to choose files and a destination folder.</div>
                    </div>
                    <button type="button" className="btn btn-accent" onClick={startHostedBrowse}>BROWSE TONE3000</button>
                    {!bool(status.configured) && onOpenSettings && (
                        <button type="button" className="btn" onClick={onOpenSettings}>SETTINGS</button>
                    )}
                </div>
                {message && <div className="muted">{message}</div>}
                <div className="model-library-files">
                    <LibraryFileManager engine={engine} run={run} kinds={["model", "ir"]} />
                </div>
            </div>
            {selectedTone && (
                <ToneDownloadDialog
                    tone={selectedTone}
                    models={models}
                    stems={stems}
                    loading={loadingModels}
                    downloading={downloading}
                    status={downloadStatus}
                    error={downloadError}
                    progress={downloadProgress}
                    downloadFiles={downloadFiles}
                    onClose={() => {
                        if (!downloading) {
                            setSelectedTone(null);
                            setModels([]);
                            setDownloadStatus("");
                            setDownloadError("");
                            setDownloadFiles([]);
                        }
                    }}
                    onDownload={queueDownload}
                />
            )}
            {folderPicker && selectedTone && (
                <LibraryFolderPicker
                    engine={engine}
                    run={run}
                    kind={folderPicker}
                    value={loadTone3000Dir(folderPicker)}
                    kinds={["model", "ir"]}
                    createFolderName={toneName(selectedTone)}
                    onPick={(directory, kind) => {
                        saveTone3000Dir(kind, directory);
                        const selected = pendingDownload;
                        setPendingDownload([]);
                        setFolderPicker(null);
                        void downloadModels(selectedTone, selected, directory, kind);
                    }}
                    onClose={() => {
                        setFolderPicker(null);
                        setPendingDownload([]);
                    }}
                />
            )}
        </div>
    );
}

function ToneDownloadDialog({
    tone,
    models,
    stems,
    loading,
    downloading,
    status,
    error,
    progress,
    downloadFiles,
    onClose,
    onDownload
}: {
    tone: JsonObject;
    models: JsonObject[];
    stems: Set<string>;
    loading: boolean;
    downloading: boolean;
    status: string;
    error: string;
    progress: { current: number; total: number; name: string };
    downloadFiles: JsonObject[];
    onClose: () => void;
    onDownload: (models: JsonObject[]) => void;
}) {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const name = toneName(tone);
    const image = toneImage(tone);
    const downloadable = models.filter((model) => modelUrl(model) || jsonId(model.id));
    const remaining = downloadable.filter((model) => !modelOnDevice(model, stems));
    const modelKey = (model: JsonObject) => jsonId(model.id, modelUrl(model) || str(model.name));
    const selectedModels = remaining.filter((model) => selectedIds.includes(modelKey(model)));
    const downloadFinished = !downloading && downloadFiles.length > 0
        && downloadFiles.every((file) => ["saved", "failed"].includes(str(file.state)));
    const savedCount = downloadFiles.filter((file) => str(file.state) === "saved").length;
    const failedCount = downloadFiles.filter((file) => str(file.state) === "failed").length;
    const fileProgress = downloadFiles.length > 0 && (downloading || downloadFinished) && (
        <div className="download-progress">
            <div>{progress.current} of {progress.total}{progress.name ? ` · ${progress.name}` : ""}</div>
            <div className="download-progress-bar"><div className="download-progress-fill" style={{ width: `${Math.round(progress.current / progress.total * 100)}%` }} /></div>
            <div className="t3k-file-progress">
                {downloadFiles.map((file, index) => (
                    <div key={`${str(file.name)}-${index}`} className={`t3k-file-progress-row is-${str(file.state, "queued")}`}>
                        <span>{str(file.name)}</span>
                        <strong>{str(file.state, "queued").toUpperCase()}</strong>
                    </div>
                ))}
            </div>
        </div>
    );
    return (
        <div className="dialog-backdrop" onClick={onClose}>
            <div className="dialog t3k-dialog" onClick={(event) => event.stopPropagation()}>
                <div className="t3k-dialog-head">
                    <div className="row" style={{ alignItems: "center" }}>
                        {image && <img className="t3k-dialog-image" src={image} alt="" />}
                        <div>
                            <h2>{name}</h2>
                            {creatorName(tone) && <div className="muted">{creatorName(tone)}</div>}
                        </div>
                    </div>
                    <button type="button" className="btn" disabled={downloading} onClick={onClose}>CLOSE</button>
                </div>
                {!downloadFinished && <div className="muted">Choose a NAM model or IR, then select its destination in the Pi-MFX library.</div>}
                {downloadFinished && (
                    <div className="t3k-download-finished">
                        <h3>FINISHED DOWNLOADING</h3>
                        <div className="t3k-download-stats">
                            <div><strong>{downloadFiles.length}</strong><span>TOTAL</span></div>
                            <div><strong>{savedCount}</strong><span>SAVED</span></div>
                            <div className={failedCount ? "has-failures" : ""}><strong>{failedCount}</strong><span>FAILED</span></div>
                        </div>
                    </div>
                )}
                {status && <div className="muted">{status}</div>}
                {error && <div className="danger">{error}</div>}
                {fileProgress}
                {!downloadFinished && remaining.length > 0 && (
                    <div className="t3k-download-actions">
                        <button type="button" className="btn btn-accent"
                            disabled={downloading || loading || selectedModels.length === 0}
                            onClick={() => onDownload(selectedModels)}>
                            DOWNLOAD SELECTED ({selectedModels.length})
                        </button>
                        <button type="button" className="btn btn-accent"
                            disabled={downloading || loading}
                            onClick={() => onDownload(remaining)}>
                            DOWNLOAD ALL ({remaining.length})
                        </button>
                    </div>
                )}
                {!downloadFinished && <div className="t3k-models">
                    {loading && <div className="muted">Loading models…</div>}
                    {!loading && !downloadable.length && <div className="muted">No downloadable models were returned.</div>}
                    {downloadable.map((model, index) => {
                        const saved = modelOnDevice(model, stems);
                        const kind = downloadKind(tone, model);
                        const id = modelKey(model) || String(index);
                        return (
                            <label key={id} className={`row t3k-model-row${saved ? " is-on-device" : ""}`}>
                                <input
                                    type="checkbox"
                                    className="t3k-model-check"
                                    checked={!saved && selectedIds.includes(id)}
                                    disabled={downloading || saved}
                                    onChange={(event) => setSelectedIds((current) => (
                                        event.target.checked
                                            ? [...current, id]
                                            : current.filter((item) => item !== id)
                                    ))}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div className="t3k-model-name">{str(model.name, name)}</div>
                                    <div className="muted">
                                        {architectureLabel(model) ? `${architectureLabel(model)} · ` : ""}{kind === "ir" ? "IR" : "NAM"}{saved ? " · on device" : ""}
                                    </div>
                                </div>
                            </label>
                        );
                    })}
                </div>}
            </div>
        </div>
    );
}
