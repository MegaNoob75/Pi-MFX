import { useEffect, useRef, useState } from "react";
import type { EngineSnapshot } from "../api";
import { arr, bool, num, obj, str, objects, type Json, type JsonObject } from "../json";
import { LibraryFolderPicker, libraryRootLabel, loadTone3000Dir, saveTone3000Dir, type LibraryKind } from "./LibraryManager";

type CatalogSource = "trending" | "latest" | "search" | "downloaded" | "favorited" | "created";

const SOURCES: { id: CatalogSource; label: string }[] = [
    { id: "trending", label: "TRENDING" },
    { id: "latest", label: "LATEST" },
    { id: "search", label: "SEARCH" },
    { id: "downloaded", label: "DOWNLOADED" },
    { id: "favorited", label: "FAVORITES" },
    { id: "created", label: "CREATED" }
];

const GEARS: { id: string; label: string }[] = [
    { id: "", label: "ALL" },
    { id: "amp-cab", label: "AMP + CAB" },
    { id: "amp", label: "AMP HEAD" },
    { id: "cab", label: "CABINET" },
    { id: "pedal", label: "PEDAL" },
    { id: "outboard", label: "OUTBOARD" },
    { id: "space", label: "SPACE" },
    { id: "experimental", label: "EXPERIMENTAL" },
    { id: "ir", label: "IRs" }
];

const SORTS: { id: string; label: string }[] = [
    { id: "trending", label: "TRENDING" },
    { id: "newest", label: "NEWEST" },
    { id: "downloads-all-time", label: "DOWNLOADS" },
    { id: "best-match", label: "BEST MATCH" }
];

const ARCHITECTURES: { id: string; label: string }[] = [
    { id: "2", label: "A2" },
    { id: "1", label: "A1" },
    { id: "custom", label: "CUSTOM" }
];

const GEAR_LABELS: Record<string, string> = Object.fromEntries(
    GEARS.filter((item) => item.id).map((item) => [item.id, item.label])
);

const FAVORITE_CREATORS_KEY = "pimfx-t3k-favorite-creators";

type FavoriteCreator = { username: string; label: string };

type CatalogQuery = {
    source: CatalogSource;
    gear: string;
    query: string;
    sort: string;
    architecture: string;
    calibrated: boolean;
    verified: boolean;
    creators: string[];
};

function loadFavoriteCreators(): FavoriteCreator[] {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(FAVORITE_CREATORS_KEY) ?? "[]") as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        const seen = new Set<string>();
        const list: FavoriteCreator[] = [];
        for (const item of parsed) {
            if (!item || typeof item !== "object") {
                continue;
            }
            const raw = item as { username?: unknown; label?: unknown };
            const username = String(raw.username ?? "").replace(/^@/, "").trim();
            if (!username || seen.has(username.toLowerCase())) {
                continue;
            }
            seen.add(username.toLowerCase());
            list.push({
                username,
                label: String(raw.label ?? username).replace(/^@/, "").trim() || username
            });
        }
        return list;
    } catch {
        return [];
    }
}

function saveFavoriteCreators(list: FavoriteCreator[]): void {
    window.localStorage.setItem(FAVORITE_CREATORS_KEY, JSON.stringify(list));
}

function thisPageRedirect(): string {
    return `${window.location.origin}/`;
}

function parseOAuthCallback(text: string): { code: string; state: string } | null {
    const raw = text.trim();
    const tryParams = (params: URLSearchParams) => {
        const code = params.get("code") ?? "";
        const state = params.get("state") ?? "";
        return code && state ? { code, state } : null;
    };
    try {
        const fromUrl = tryParams(new URL(raw).searchParams);
        if (fromUrl) {
            return fromUrl;
        }
    } catch {
        // not a full URL
    }
    const query = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw;
    return tryParams(new URLSearchParams(query));
}

function jsonId(value: Json | undefined, fallback = ""): string {
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    return str(value, fallback);
}

function extractList(payload: Json | undefined): JsonObject[] {
    if (objects(payload).length) {
        return objects(payload);
    }
    const body = obj(payload);
    if (objects(body.data).length) {
        return objects(body.data);
    }
    if (objects(body.tones).length) {
        return objects(body.tones);
    }
    return objects(body.results);
}

function toneKey(tone: JsonObject): string {
    return jsonId(tone.id, str(tone.toneId, str(tone.title, "tone")));
}

function toneName(tone: JsonObject): string {
    return str(tone.name, str(tone.title, "Tone"));
}

function toneImage(tone: JsonObject): string {
    const images = arr(tone.images);
    const first = images.find((item) => typeof item === "string" && item.length > 0);
    return typeof first === "string" ? first : "";
}

function toneGear(tone: JsonObject): string {
    const gear = str(tone.gear, str(tone.format));
    return gear === "full-rig" ? "amp-cab" : gear;
}

function gearLabel(gear: string): string {
    if (gear === "ir") {
        return "IR";
    }
    return GEAR_LABELS[gear] || gear.toUpperCase();
}

function creatorName(tone: JsonObject): string {
    const name = creatorUsername(tone);
    return name ? `@${name}` : "";
}

function creatorUsername(tone: JsonObject): string {
    const user = obj(tone.user);
    return str(user.username, str(tone.creator, str(user.name))).replace(/^@/, "").trim();
}

function creatorKey(value: string): string {
    return value.replace(/^@/, "").trim().toLowerCase();
}

function architectureLabel(model: JsonObject): string {
    const value = str(model.architecture_version, jsonId(model.architecture_version));
    if (!value) {
        return "";
    }
    if (value === "custom") {
        return "Custom";
    }
    return /^a/i.test(value) ? value.toUpperCase() : `A${value}`;
}

function matchesGear(tone: JsonObject, gear: string): boolean {
    if (!gear) {
        return true;
    }
    const value = toneGear(tone);
    if (gear === "ir") {
        return value === "ir" || str(tone.format) === "ir";
    }
    return value === gear;
}

function optionalCount(tone: JsonObject, key: string): number | null {
    const value = tone[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function matchesArchitecture(tone: JsonObject, architecture: string, gear: string): boolean {
    if (!architecture || gear === "ir" || str(tone.format) === "ir") {
        return true;
    }
    const a1 = optionalCount(tone, "a1_models_count");
    const a2 = optionalCount(tone, "a2_models_count");
    const custom = optionalCount(tone, "custom_models_count");
    if (a1 == null && a2 == null && custom == null) {
        return true;
    }
    if (architecture === "2") {
        return (a2 ?? 0) > 0;
    }
    if (architecture === "1") {
        return (a1 ?? 0) > 0;
    }
    if (architecture === "custom") {
        return (custom ?? 0) > 0;
    }
    return true;
}

function matchesCalibrated(tone: JsonObject, calibrated: boolean): boolean {
    if (!calibrated) {
        return true;
    }
    return bool(tone.calibrated) || num(tone.calibrated_models_count) > 0
        || arr(tone.tags).some((tag) => /calibrated/i.test(typeof tag === "string" ? tag : str(obj(tag).name)));
}

function matchesVerified(tone: JsonObject, verified: boolean): boolean {
    if (!verified) {
        return true;
    }
    const user = obj(tone.user);
    return bool(user.verified) || bool(tone.verified);
}

function matchesCreators(tone: JsonObject, creators: string[]): boolean {
    if (!creators.length) {
        return true;
    }
    const name = creatorKey(creatorUsername(tone));
    return creators.some((item) => creatorKey(item) === name);
}

function matchesCatalog(tone: JsonObject, catalog: CatalogQuery): boolean {
    return matchesGear(tone, catalog.gear)
        && matchesArchitecture(tone, catalog.architecture, catalog.gear)
        && matchesCalibrated(tone, catalog.calibrated)
        && matchesVerified(tone, catalog.verified)
        && matchesCreators(tone, catalog.creators);
}

function modelUrl(model: JsonObject): string {
    return str(model.model_url, str(model.url, str(model.downloadUrl, str(model.download_url))));
}

function modelIsIr(tone: JsonObject, model: JsonObject): boolean {
    if (str(tone.format) === "ir" || toneGear(tone) === "ir") {
        return true;
    }
    const text = `${str(model.kind)} ${str(model.format)} ${str(model.name)} ${str(model.filename)}`;
    return /(?:^|\b)ir(?:\b|$)|impulse|sm57|sm58|sm7|\.wav\b|4x12|2x12|1x12|\bcab\b/i.test(text);
}

function modelIsAidax(tone: JsonObject, model: JsonObject): boolean {
    const text = `${str(tone.format)} ${str(model.format)} ${str(model.kind)} ${str(model.name)} ${str(model.architecture)}`;
    return /aida/i.test(text) || /\.aidax$/i.test(text);
}

function downloadKind(tone: JsonObject, model: JsonObject): LibraryKind {
    if (modelIsIr(tone, model)) {
        return "ir";
    }
    if (modelIsAidax(tone, model)) {
        return "aidax";
    }
    return "model";
}

function pageSizeFor(source: CatalogSource): number {
    if (source === "downloaded" || source === "favorited" || source === "created") {
        return 50;
    }
    return 25;
}

function buildListPayload(catalog: CatalogQuery, page: number, refresh: boolean): JsonObject {
    const ir = catalog.gear === "ir";
    if (catalog.source === "downloaded" || catalog.source === "favorited" || catalog.source === "created") {
        return { refresh, source: catalog.source, page, page_size: pageSizeFor(catalog.source) };
    }

    // Trending / latest homepage feeds are only 10 items. Search is paginated,
    // so those tabs keep loading through /tones/search as the user scrolls.
    const body: JsonObject = {
        refresh,
        source: "search",
        page,
        page_size: pageSizeFor("search"),
        sort: catalog.source === "latest" ? "newest" : catalog.source === "trending" ? "trending" : catalog.sort
    };
    if (catalog.source === "search" && catalog.query.trim()) {
        body.query = catalog.query.trim();
    }
    if (ir) {
        body.format = "ir";
    } else if (catalog.gear) {
        body.gears = catalog.gear;
        body.format = "nam";
    }
    if (!ir && catalog.architecture) {
        body.architecture = catalog.architecture;
    }
    if (!ir && catalog.calibrated) {
        body.calibrated = "true";
    }
    if (catalog.verified) {
        body.verified = "true";
    }
    if (catalog.creators.length) {
        body.creators = catalog.creators.join(",");
    }
    return body;
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
    const [query, setQuery] = useState("");
    const [source, setSource] = useState<CatalogSource>("trending");
    const [gear, setGear] = useState("amp-cab");
    const [sort, setSort] = useState("trending");
    const [architecture, setArchitecture] = useState("2");
    const [calibrated, setCalibrated] = useState(false);
    const [verified, setVerified] = useState(false);
    const [favoriteCreators, setFavoriteCreators] = useState<FavoriteCreator[]>(loadFavoriteCreators);
    const [selectedCreators, setSelectedCreators] = useState<string[]>([]);
    const [creatorPickerOpen, setCreatorPickerOpen] = useState(false);
    const [tones, setTones] = useState<JsonObject[]>([]);
    const [modelsByTone, setModelsByTone] = useState<Record<string, JsonObject[]>>({});
    const [selectedTone, setSelectedTone] = useState<JsonObject | null>(null);
    const [folderPicker, setFolderPicker] = useState<LibraryKind | null>(null);
    const [modelDir, setModelDir] = useState(() => loadTone3000Dir("model"));
    const [irDir, setIrDir] = useState(() => loadTone3000Dir("ir"));
    const [aidaxDir, setAidaxDir] = useState(() => loadTone3000Dir("aidax"));
    const [pendingDownload, setPendingDownload] = useState<{ tone: JsonObject; models: JsonObject[] } | null>(null);
    const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0, name: "" });
    const [downloadStatus, setDownloadStatus] = useState("");
    const [downloadError, setDownloadError] = useState("");
    const [downloading, setDownloading] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [cached, setCached] = useState(false);
    const [loading, setLoading] = useState(false);
    const [key, setKey] = useState("");
    const [redirect, setRedirect] = useState(thisPageRedirect);
    const [code, setCode] = useState("");
    const [state, setState] = useState("");
    const [message, setMessage] = useState("");
    const completingOauth = useRef(false);
    const loadSeq = useRef(0);
    const pageRef = useRef(1);
    const hasMoreRef = useRef(false);
    const busyRef = useRef(false);
    const catalogRef = useRef<CatalogQuery>({
        source, gear, query, sort, architecture, calibrated, verified, creators: selectedCreators
    });
    const scrollerRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    catalogRef.current = {
        source, gear, query, sort, architecture, calibrated, verified, creators: selectedCreators
    };

    const refresh = () => {
        void engine.client.request("tone3000/status").then((result) => {
            setStatus(result);
            setKey(str(result.publishableKey));
            setRedirect(str(result.redirectUri, thisPageRedirect()));
        }).catch((error: unknown) => {
            setMessage(error instanceof Error ? error.message : String(error));
        });
    };

    useEffect(() => {
        refresh();
    }, [engine.client]);

    useEffect(() => {
        const parsed = parseOAuthCallback(window.location.href);
        if (!parsed || bool(status.connected) || completingOauth.current) {
            return;
        }
        completingOauth.current = true;
        setCode(parsed.code);
        setState(parsed.state);
        void run(async () => {
            try {
                await engine.client.request("tone3000/auth/complete", parsed);
                setMessage("Signed in to TONE3000.");
            } finally {
                const url = new URL(window.location.href);
                url.searchParams.delete("code");
                url.searchParams.delete("state");
                window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
                refresh();
            }
        });
    }, [engine.client, status.connected]);

    const fetchTones = async (opts: { refresh?: boolean; append?: boolean } = {}) => {
        if (opts.append && (busyRef.current || !hasMoreRef.current)) {
            return;
        }
        const seq = ++loadSeq.current;
        const catalog = catalogRef.current;
        const nextPage = opts.append ? pageRef.current + 1 : 1;
        busyRef.current = true;
        setLoading(true);
        try {
            const payload = buildListPayload(catalog, nextPage, Boolean(opts.refresh));
            const result = await engine.client.request("tone3000/tones", payload);
            if (seq !== loadSeq.current) {
                return;
            }
            const list = extractList(result.result);
            const filtered = catalog.source === "downloaded" || catalog.source === "favorited"
                || catalog.source === "created"
                ? list.filter((tone) => matchesCatalog(tone, catalog))
                : list;
            setTones((current) => {
                if (!opts.append) {
                    return filtered;
                }
                const seen = new Set(current.map((tone) => toneKey(tone)));
                return [...current, ...filtered.filter((tone) => !seen.has(toneKey(tone)))];
            });
            pageRef.current = nextPage;
            const more = list.length >= num(payload.page_size, pageSizeFor(catalog.source));
            hasMoreRef.current = more;
            setHasMore(more);
            setCached(bool(result.cached));
            setMessage(filtered.length || opts.append ? "" : "No tones in this section.");
        } catch (error: unknown) {
            if (seq !== loadSeq.current) {
                return;
            }
            hasMoreRef.current = false;
            setHasMore(false);
            setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            if (seq === loadSeq.current) {
                busyRef.current = false;
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        if (!bool(status.connected)) {
            return;
        }
        pageRef.current = 1;
        hasMoreRef.current = false;
        scrollerRef.current?.scrollTo({ top: 0 });
        const delay = source === "search" && query.trim() ? 400 : 0;
        const timer = window.setTimeout(() => {
            void fetchTones({ refresh: false, append: false });
        }, delay);
        return () => window.clearTimeout(timer);
        // catalog keys live on catalogRef; fetchTones reads them from there.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status.connected, source, gear, sort, query, architecture, calibrated, verified, selectedCreators]);

    useEffect(() => {
        if (!bool(status.connected) || !hasMore || loading) {
            return;
        }
        const root = scrollerRef.current;
        const sentinel = sentinelRef.current;
        if (!root || !sentinel) {
            return;
        }
        const io = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                void fetchTones({ append: true });
            }
        }, { root, rootMargin: "280px" });
        io.observe(sentinel);
        const rootBox = root.getBoundingClientRect();
        const sentBox = sentinel.getBoundingClientRect();
        if (sentBox.top <= rootBox.bottom + 280) {
            void fetchTones({ append: true });
        }
        return () => io.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status.connected, tones, hasMore, loading]);

    const applyCodeField = (text: string) => {
        const parsed = parseOAuthCallback(text);
        if (parsed) {
            setCode(parsed.code);
            setState(parsed.state);
            return;
        }
        setCode(text);
    };

    const resolveModel = async (model: JsonObject): Promise<JsonObject> => {
        if (modelUrl(model)) {
            return model;
        }
        const id = jsonId(model.id);
        if (!id) {
            return model;
        }
        const result = await engine.client.request("tone3000/model", { modelId: id });
        const body = obj(result.result);
        const nested = objects(body.data)[0];
        return { ...model, ...body, ...(nested ?? {}) };
    };

    const loadModels = async (tone: JsonObject): Promise<JsonObject[]> => {
        const id = toneKey(tone);
        if (modelsByTone[id]?.length) {
            return modelsByTone[id];
        }
        const requests = await Promise.allSettled([
            engine.client.request("tone3000/models", { toneId: id, architecture: "2", page_size: 50 }),
            engine.client.request("tone3000/models", { toneId: id, page_size: 50 })
        ]);
        const merged: JsonObject[] = [];
        const seen = new Set<string>();
        for (const request of requests) {
            if (request.status !== "fulfilled") {
                continue;
            }
            for (const model of extractList(request.value.result)) {
                const key = jsonId(model.id, modelUrl(model) || str(model.name));
                if (!key || seen.has(key)) {
                    continue;
                }
                seen.add(key);
                merged.push(model);
            }
        }
        const withUrls: JsonObject[] = [];
        for (const model of merged) {
            try {
                withUrls.push(await resolveModel(model));
            } catch {
                withUrls.push(model);
            }
        }
        setModelsByTone((current) => ({ ...current, [id]: withUrls }));
        return withUrls;
    };

    const saveDir = (kind: LibraryKind, directory: string) => {
        saveTone3000Dir(kind, directory);
        if (kind === "ir") {
            setIrDir(directory);
        } else if (kind === "aidax") {
            setAidaxDir(directory);
        } else {
            setModelDir(directory);
        }
    };

    const dirForKind = (kind: LibraryKind) => (kind === "ir" ? irDir : kind === "aidax" ? aidaxDir : modelDir);

    const downloadOne = async (tone: JsonObject, model: JsonObject) => {
        const resolved = await resolveModel(model);
        const url = modelUrl(resolved);
        const modelId = jsonId(resolved.id, jsonId(model.id));
        if (!url && !modelId) {
            throw new Error("that model has no download URL");
        }
        const kind = downloadKind(tone, resolved);
        const directory = dirForKind(kind);
        const label = str(resolved.name, toneName(tone));
        setDownloadStatus(`Downloading ${label}…`);
        setDownloadError("");
        const result = await engine.client.request("tone3000/download", {
            url,
            modelId,
            name: label,
            kind,
            directory
        });
        const stored = str(result.path);
        await engine.client.request("library");
        setDownloadStatus(`Saved ${label} to ${libraryRootLabel(kind)}/${directory || "TONE3000"}.`);
        return stored;
    };

    const downloadModels = async (tone: JsonObject, models: JsonObject[]) => {
        if (models.length === 0) {
            throw new Error("no downloadable models for that tone");
        }
        setDownloading(true);
        setDownloadError("");
        setDownloadProgress({ current: 0, total: models.length, name: "" });
        try {
            const saved: string[] = [];
            for (let index = 0; index < models.length; index += 1) {
                const label = str(models[index].name, toneName(tone));
                setDownloadProgress({ current: index + 1, total: models.length, name: label });
                setDownloadStatus(`Downloading ${index + 1} of ${models.length}: ${label}`);
                const path = await downloadOne(tone, models[index]);
                if (path) {
                    saved.push(path);
                }
            }
            setDownloadStatus(`Saved ${saved.length} file${saved.length === 1 ? "" : "s"}. ${models.length - saved.length} left unfinished.`);
            if (saved.length === models.length) {
                setDownloadStatus(`Saved ${saved.length} of ${models.length} file${models.length === 1 ? "" : "s"} to the library.`);
            }
        } catch (caught: unknown) {
            const text = caught instanceof Error ? caught.message : String(caught);
            setDownloadError(text);
            setDownloadStatus("");
            throw caught;
        } finally {
            setDownloading(false);
        }
    };

    const queueDownload = (tone: JsonObject, models: JsonObject[]) => {
        const first = models[0];
        const kind = first ? downloadKind(tone, first) : "model";
        setPendingDownload({ tone, models });
        setFolderPicker(kind);
    };

    const openTone = (tone: JsonObject) => {
        setSelectedTone(tone);
        setDownloadError("");
        setDownloadStatus("");
        void loadModels(tone).catch((caught: unknown) => {
            setDownloadError(caught instanceof Error ? caught.message : String(caught));
        });
    };

    const persistCreators = (list: FavoriteCreator[]) => {
        setFavoriteCreators(list);
        saveFavoriteCreators(list);
    };

    const addFavoriteCreator = (username: string, label = username) => {
        const clean = username.replace(/^@/, "").trim();
        if (!clean) {
            return;
        }
        const nextLabel = label.replace(/^@/, "").trim() || clean;
        if (favoriteCreators.some((item) => creatorKey(item.username) === creatorKey(clean))) {
            return;
        }
        persistCreators([...favoriteCreators, { username: clean, label: nextLabel }]);
    };

    const removeFavoriteCreator = (username: string) => {
        persistCreators(favoriteCreators.filter((item) => creatorKey(item.username) !== creatorKey(username)));
        setSelectedCreators((current) => current.filter((item) => creatorKey(item) !== creatorKey(username)));
    };

    const isFavoriteCreator = (username: string) => (
        favoriteCreators.some((item) => creatorKey(item.username) === creatorKey(username))
    );

    const browseCreators = (usernames: string[]) => {
        setSelectedCreators(usernames);
        setSelectedTone(null);
        if (source === "downloaded" || source === "favorited" || source === "created") {
            setSource("trending");
        }
    };

    const myCreatorsActive = favoriteCreators.length > 0
        && selectedCreators.length === favoriteCreators.length
        && favoriteCreators.every((item) => (
            selectedCreators.some((username) => creatorKey(username) === creatorKey(item.username))
        ));

    const signedInAs = str(obj(status.user).username);
    const settingsForm = (
        <>
            <h2>TONE3000</h2>
            <div className="muted">
                Use the <strong>publishable</strong> key from tone3000.com → Settings → API Keys
                (<code>t3k_pub_…</code>). Do not paste a secret key. Register this page&apos;s address
                as a redirect URI on that same API key, then sign in.
            </div>
            {!bool(status.available, true) && (
                <div className="danger">This build has no HTTPS support, so TONE3000 is unavailable.</div>
            )}
            {message && <div className="muted">{message}</div>}
            <label className="field">
                <span>Publishable key (t3k_pub_…)</span>
                <input value={key} onChange={(event) => setKey(event.target.value)} />
            </label>
            <label className="field">
                <span>Redirect URI (must match tone3000.com exactly)</span>
                <input value={redirect} onChange={(event) => setRedirect(event.target.value)} />
            </label>
            <div className="row">
                <button type="button" className="btn" onClick={() => setRedirect(thisPageRedirect())}>
                    USE THIS ADDRESS
                </button>
                <button type="button" className="btn" onClick={() => {
                    void run(async () => {
                        await engine.client.request("tone3000/configure", {
                            publishableKey: key.trim(),
                            redirectUri: redirect.trim() || thisPageRedirect()
                        });
                        refresh();
                        setMessage("Key saved. Sign in next.");
                    });
                }}>SAVE KEYS</button>
                <button type="button" className="btn btn-accent" onClick={() => {
                    void run(async () => {
                        const uri = redirect.trim() || thisPageRedirect();
                        if (!redirect.trim()) {
                            setRedirect(uri);
                        }
                        await engine.client.request("tone3000/configure", {
                            publishableKey: key.trim(),
                            redirectUri: uri
                        });
                        const result = await engine.client.request("tone3000/auth/start", { prompt: "" });
                        const url = str(result.authorizeUrl);
                        if (url) {
                            window.location.assign(url);
                        }
                    });
                }}>SIGN IN</button>
                {bool(status.connected) && (
                    <button type="button" className="btn" onClick={() => {
                        void run(async () => {
                            await engine.client.request("tone3000/auth/logout");
                            setTones([]);
                            refresh();
                        });
                    }}>SIGN OUT</button>
                )}
            </div>
            {!bool(status.connected) && (
                <div className="row">
                    <label className="field">
                        <span>OAuth code or full redirect URL</span>
                        <input value={code} onChange={(event) => applyCodeField(event.target.value)} />
                    </label>
                    <label className="field">
                        <span>State</span>
                        <input value={state} onChange={(event) => setState(event.target.value)} />
                    </label>
                    <button type="button" className="btn" onClick={() => {
                        void run(async () => {
                            const parsed = parseOAuthCallback(code) ?? { code, state };
                            await engine.client.request("tone3000/auth/complete", parsed);
                            refresh();
                        });
                    }}>COMPLETE</button>
                </div>
            )}
        </>
    );

    if (pane === "settings") {
        return <div className="panel stack">{settingsForm}</div>;
    }

    return (
        <div className="mfx-screen">
            <div className="mfx-screen-intro">
                <div className="mfx-screen-intro-title">LIBRARY</div>
                <div className="mfx-screen-intro-sub">Download NAM, AIDA-X and IR files from TONE3000</div>
            </div>
            <div className="page-scroll stack" style={{ flex: 1, minHeight: 0 }}>
                {!bool(status.connected) && (
                    <div className="panel stack">
                        <div className="muted">
                            Sign in to TONE3000 from Settings → Library, then come back here to browse.
                        </div>
                        {onOpenSettings && (
                            <button type="button" className="btn btn-accent" onClick={onOpenSettings}>
                                TONE3000 SETTINGS
                            </button>
                        )}
                    </div>
                )}
                {bool(status.connected) && (
                <div className="t3k-catalog">
                    <div className="t3k-status-row">
                        <div className="muted">
                            {signedInAs ? `Signed in as @${signedInAs}` : "Signed in"}
                            {cached ? " · cached" : ""}
                            {loading ? " · loading…" : ""}
                        </div>
                        <button
                            type="button"
                            className="btn"
                            onClick={() => void fetchTones({ refresh: true })}
                        >
                            REFRESH
                        </button>
                    </div>
                    <div className="t3k-tabs">
                        {SOURCES.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                className={`btn ${source === item.id ? "btn-active" : ""}`}
                                onClick={() => {
                                    setSource(item.id);
                                    setSelectedTone(null);
                                    if (item.id === "search" && !query.trim()) {
                                        setSort("trending");
                                    }
                                }}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                    <div className="t3k-gears">
                        {GEARS.map((item) => (
                            <button
                                key={item.id || "all"}
                                type="button"
                                className={`btn ${gear === item.id ? "btn-active" : ""}`}
                                onClick={() => {
                                    setGear(item.id);
                                    setSelectedTone(null);
                                }}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                    {gear !== "ir" && (
                        <div className="t3k-filters">
                            {ARCHITECTURES.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={`btn ${architecture === item.id ? "btn-active" : ""}`}
                                    onClick={() => {
                                        setArchitecture(item.id);
                                        setSelectedTone(null);
                                    }}
                                >
                                    {item.label}
                                </button>
                            ))}
                            <button
                                type="button"
                                className={`btn ${calibrated ? "btn-active" : ""}`}
                                onClick={() => {
                                    setCalibrated((value) => !value);
                                    setSelectedTone(null);
                                }}
                            >
                                CALIBRATED
                            </button>
                        </div>
                    )}
                    <div className="t3k-creators">
                        <button
                            type="button"
                            className={`btn ${creatorPickerOpen ? "btn-active" : ""}`}
                            onClick={() => setCreatorPickerOpen(true)}
                        >
                            CREATORS
                        </button>
                        <button
                            type="button"
                            className={`btn ${verified ? "btn-active" : ""}`}
                            onClick={() => {
                                setVerified((value) => !value);
                                setSelectedTone(null);
                            }}
                        >
                            VERIFIED
                        </button>
                        <button
                            type="button"
                            className={`btn ${myCreatorsActive ? "btn-active" : ""}`}
                            onClick={() => {
                                if (myCreatorsActive) {
                                    browseCreators([]);
                                    return;
                                }
                                if (!favoriteCreators.length) {
                                    setCreatorPickerOpen(true);
                                    return;
                                }
                                browseCreators(favoriteCreators.map((item) => item.username));
                            }}
                        >
                            MY CREATORS
                        </button>
                        {favoriteCreators.map((item) => {
                            const active = selectedCreators.some((username) => (
                                creatorKey(username) === creatorKey(item.username)
                            ));
                            return (
                                <button
                                    key={item.username}
                                    type="button"
                                    className={`btn ${active ? "btn-active" : ""}`}
                                    onClick={() => {
                                        if (active && selectedCreators.length === 1) {
                                            browseCreators([]);
                                            return;
                                        }
                                        if (active) {
                                            browseCreators(selectedCreators.filter((username) => (
                                                creatorKey(username) !== creatorKey(item.username)
                                            )));
                                            return;
                                        }
                                        browseCreators([...selectedCreators, item.username]);
                                    }}
                                >
                                    @{item.label}
                                </button>
                            );
                        })}
                    </div>
                    <div className="row">
                        <label className="field" style={{ flex: 1, minWidth: 180 }}>
                            <span>Search</span>
                            <input
                                value={query}
                                placeholder="Search TONE3000"
                                onChange={(event) => {
                                    const value = event.target.value;
                                    setQuery(value);
                                    if (source !== "search") {
                                        setSource("search");
                                        setSort(value.trim() ? "best-match" : "trending");
                                    }
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        setSource("search");
                                        void fetchTones({ refresh: false });
                                    }
                                }}
                            />
                        </label>
                        <button
                            type="button"
                            className="btn btn-accent"
                            onClick={() => {
                                setSource("search");
                                void fetchTones({ refresh: false });
                            }}
                        >
                            SEARCH
                        </button>
                    </div>
                    {source === "search" && (
                        <div className="t3k-sorts">
                            {SORTS.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={`btn ${sort === item.id ? "btn-active" : ""}`}
                                    onClick={() => setSort(item.id)}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="t3k-scroll" ref={scrollerRef}>
                    <div className="t3k-grid">
                        {tones.map((tone) => {
                            const id = toneKey(tone);
                            const name = toneName(tone);
                            const image = toneImage(tone);
                            const username = creatorUsername(tone);
                            const savedCreator = isFavoriteCreator(username);
                            return (
                                <div
                                    key={id}
                                    role="button"
                                    tabIndex={0}
                                    className={`t3k-card${selectedTone && toneKey(selectedTone) === id ? " expanded" : ""}`}
                                    onClick={() => openTone(tone)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            openTone(tone);
                                        }
                                    }}
                                >
                                    {image ? (
                                        <img className="t3k-card-image" src={image} alt="" />
                                    ) : (
                                        <div className="t3k-card-image-fallback">{gearLabel(toneGear(tone) || "NAM")}</div>
                                    )}
                                    <div className="t3k-card-body">
                                        <div className="t3k-card-gear">{gearLabel(toneGear(tone))}</div>
                                        <div className="t3k-card-title">{name}</div>
                                        <div className="t3k-card-meta">
                                            {username && (
                                                <button
                                                    type="button"
                                                    className={`btn t3k-creator-star ${savedCreator ? "btn-active" : ""}`}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        if (savedCreator) {
                                                            removeFavoriteCreator(username);
                                                        } else {
                                                            addFavoriteCreator(username);
                                                        }
                                                    }}
                                                >
                                                    {savedCreator ? "★" : "☆"} @{username}
                                                </button>
                                            )}
                                            <span>{num(tone.downloads_count)} dl</span>
                                            <span>{num(tone.favorites_count)} fav</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div ref={sentinelRef} className="t3k-sentinel" />
                    {loading && tones.length > 0 && (
                        <div className="muted" style={{ padding: "8px 12px 12px" }}>Loading more…</div>
                    )}
                    {!hasMore && tones.length > 0 && (
                        <div className="muted" style={{ padding: "8px 12px 12px" }}>End of list.</div>
                    )}
                    </div>
                    {selectedTone && (
                        <ToneDownloadDialog
                            tone={selectedTone}
                            models={modelsByTone[toneKey(selectedTone)] ?? []}
                            loadingModels={!(toneKey(selectedTone) in modelsByTone) && !downloadError}
                            downloading={downloading}
                            status={downloadStatus}
                            error={downloadError}
                            progress={downloadProgress}
                            onClose={() => {
                                if (!downloading) {
                                    setSelectedTone(null);
                                    setDownloadError("");
                                    setDownloadStatus("");
                                    setDownloadProgress({ current: 0, total: 0, name: "" });
                                }
                            }}
                            onDownloadAll={() => {
                                const models = modelsByTone[toneKey(selectedTone)] ?? [];
                                queueDownload(selectedTone, models);
                            }}
                            onDownloadOne={(model) => {
                                queueDownload(selectedTone, [model]);
                            }}
                            creatorSaved={isFavoriteCreator(creatorUsername(selectedTone))}
                            onToggleCreator={() => {
                                const username = creatorUsername(selectedTone);
                                if (!username) {
                                    return;
                                }
                                if (isFavoriteCreator(username)) {
                                    removeFavoriteCreator(username);
                                } else {
                                    addFavoriteCreator(username);
                                }
                            }}
                        />
                    )}
                    {creatorPickerOpen && (
                        <CreatorPickerDialog
                            engine={engine}
                            saved={favoriteCreators}
                            selected={selectedCreators}
                            onClose={() => setCreatorPickerOpen(false)}
                            onAdd={addFavoriteCreator}
                            onRemove={removeFavoriteCreator}
                            onShow={(usernames) => {
                                browseCreators(usernames);
                                setCreatorPickerOpen(false);
                            }}
                        />
                    )}
                    {folderPicker && (
                        <LibraryFolderPicker
                            engine={engine}
                            run={run}
                            kind={folderPicker}
                            value={dirForKind(folderPicker)}
                            onPick={(directory) => {
                                saveDir(folderPicker, directory);
                                const pending = pendingDownload;
                                setPendingDownload(null);
                                if (pending) {
                                    void downloadModels(pending.tone, pending.models).catch(() => undefined);
                                }
                            }}
                            onClose={() => {
                                setFolderPicker(null);
                                setPendingDownload(null);
                            }}
                        />
                    )}
                </div>
                )}
            </div>
        </div>
    );
}

function ToneDownloadDialog({
    tone,
    models,
    loadingModels,
    downloading,
    status,
    error,
    progress,
    creatorSaved,
    onClose,
    onDownloadAll,
    onDownloadOne,
    onToggleCreator
}: {
    tone: JsonObject;
    models: JsonObject[];
    loadingModels: boolean;
    downloading: boolean;
    status: string;
    error: string;
    progress: { current: number; total: number; name: string };
    creatorSaved: boolean;
    onClose: () => void;
    onDownloadAll: () => void;
    onDownloadOne: (model: JsonObject) => void;
    onToggleCreator: () => void;
}) {
    const name = toneName(tone);
    const username = creatorUsername(tone);
    const downloadable = models.filter((model) => modelUrl(model) || jsonId(model.id));
    const remaining = Math.max(0, progress.total - progress.current);
    const arch = (model: JsonObject) => architectureLabel(model);
    return (
        <div className="dialog-backdrop" onClick={onClose}>
            <div className="dialog t3k-dialog" onClick={(event) => event.stopPropagation()}>
                <div className="t3k-dialog-head">
                    <div>
                        <div className="t3k-card-gear">{gearLabel(toneGear(tone))}</div>
                        <h2>{name}</h2>
                        {creatorName(tone) && <div className="muted">{creatorName(tone)}</div>}
                    </div>
                    <button type="button" className="btn" onClick={onClose} disabled={downloading}>CLOSE</button>
                </div>
                <div className="muted">
                    Download asks where to save. NAM, AIDA-X, and IR files stay in separate folders.
                </div>
                {username && (
                    <button
                        type="button"
                        className={`btn ${creatorSaved ? "btn-active" : ""}`}
                        onClick={onToggleCreator}
                    >
                        {creatorSaved ? "REMOVE CREATOR" : "SAVE CREATOR"}
                    </button>
                )}
                {status && <div className="muted">{status}</div>}
                {downloading && progress.total > 0 && (
                    <div className="download-progress">
                        <div>
                            {progress.current} of {progress.total}
                            {progress.name ? ` · ${progress.name}` : ""}
                            {remaining > 0 ? ` · ${remaining} left` : ""}
                        </div>
                        <div className="download-progress-bar">
                            <div
                                className="download-progress-fill"
                                style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                            />
                        </div>
                    </div>
                )}
                {error && <div className="danger">{error}</div>}
                <button
                    type="button"
                    className="btn btn-accent"
                    disabled={downloading || loadingModels || downloadable.length === 0}
                    onClick={onDownloadAll}
                >
                    {downloading ? "DOWNLOADING…" : `DOWNLOAD ALL${downloadable.length ? ` (${downloadable.length})` : ""}`}
                </button>
                <div className="t3k-models">
                    {loadingModels && <div className="muted">Loading models…</div>}
                    {!loadingModels && downloadable.length === 0 && <div className="muted">No models listed.</div>}
                    {downloadable.map((model, modelIndex) => (
                        <div key={jsonId(model.id, String(modelIndex))} className="row">
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div>{str(model.name, name)}</div>
                                <div className="muted">
                                    {str(model.size)}
                                    {arch(model) ? ` · ${arch(model)}` : ""}
                                    {downloadKind(tone, model) === "ir" ? " · IR" : downloadKind(tone, model) === "aidax" ? " · AIDA-X" : " · NAM"}
                                </div>
                            </div>
                            <button
                                type="button"
                                className="btn btn-accent"
                                disabled={downloading}
                                onClick={() => onDownloadOne(model)}
                            >
                                DOWNLOAD
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function CreatorPickerDialog({
    engine,
    saved,
    selected,
    onClose,
    onAdd,
    onRemove,
    onShow
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    saved: FavoriteCreator[];
    selected: string[];
    onClose: () => void;
    onAdd: (username: string, label: string) => void;
    onRemove: (username: string) => void;
    onShow: (usernames: string[]) => void;
}) {
    const [query, setQuery] = useState("");
    const [users, setUsers] = useState<JsonObject[]>([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");

    useEffect(() => {
        let cancelled = false;
        const timer = window.setTimeout(() => {
            setLoading(true);
            void engine.client.request("tone3000/users", {
                query: query.trim(),
                sort: "tones",
                page: 1,
                page_size: 10
            }).then((result) => {
                if (cancelled) {
                    return;
                }
                const list = extractList(result.result);
                setUsers(list);
                setMessage(list.length ? "" : "No creators match that search.");
            }).catch((error: unknown) => {
                if (!cancelled) {
                    setUsers([]);
                    setMessage(error instanceof Error ? error.message : String(error));
                }
            }).finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });
        }, query.trim() ? 300 : 0);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [engine.client, query]);

    const savedKeys = new Set(saved.map((item) => creatorKey(item.username)));

    return (
        <div className="dialog-backdrop" onClick={onClose}>
            <div className="dialog t3k-dialog" onClick={(event) => event.stopPropagation()}>
                <div className="t3k-dialog-head">
                    <div>
                        <h2>Creators</h2>
                        <div className="muted">Search TONE3000 and save people to MY CREATORS.</div>
                    </div>
                    <button type="button" className="btn" onClick={onClose}>CLOSE</button>
                </div>
                {saved.length > 0 && (
                    <div className="stack">
                        <div className="muted">Saved</div>
                        <div className="t3k-creator-list">
                            {saved.map((item) => {
                                const active = selected.some((username) => creatorKey(username) === creatorKey(item.username));
                                return (
                                    <div key={item.username} className="row t3k-creator-row">
                                        <div style={{ flex: 1, minWidth: 0 }}>@{item.label}</div>
                                        <button
                                            type="button"
                                            className={`btn ${active ? "btn-active" : ""}`}
                                            onClick={() => onShow([item.username])}
                                        >
                                            SHOW
                                        </button>
                                        <button
                                            type="button"
                                            className="btn"
                                            onClick={() => onRemove(item.username)}
                                        >
                                            REMOVE
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                        <button
                            type="button"
                            className="btn btn-accent"
                            onClick={() => onShow(saved.map((item) => item.username))}
                        >
                            SHOW MY CREATORS
                        </button>
                    </div>
                )}
                <label className="field">
                    <span>Search creators</span>
                    <input
                        value={query}
                        placeholder="Username"
                        onChange={(event) => setQuery(event.target.value)}
                    />
                </label>
                {loading && <div className="muted">Searching…</div>}
                {message && <div className="muted">{message}</div>}
                <div className="t3k-creator-list">
                    {users.map((user, index) => {
                        const username = str(user.username, jsonId(user.id, String(index)));
                        if (!username) {
                            return null;
                        }
                        const savedUser = savedKeys.has(creatorKey(username));
                        return (
                            <div key={username} className="row t3k-creator-row">
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div>@{username}</div>
                                    <div className="muted">
                                        {num(user.tones_count)} tones · {num(user.downloads_count)} dl
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className={`btn ${savedUser ? "btn-active" : "btn-accent"}`}
                                    onClick={() => {
                                        if (savedUser) {
                                            onRemove(username);
                                        } else {
                                            onAdd(username, username);
                                        }
                                    }}
                                >
                                    {savedUser ? "SAVED" : "SAVE"}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
