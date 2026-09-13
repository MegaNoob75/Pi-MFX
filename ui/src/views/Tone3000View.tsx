import { useEffect, useRef, useState } from "react";
import type { EngineSnapshot } from "../api";
import { arr, bool, num, obj, str, objects, type Json, type JsonObject } from "../json";
import { LibraryFolderPicker, libraryRootLabel, loadTone3000Dir, saveTone3000Dir, type LibraryKind } from "./LibraryManager";

type CatalogSource = "trending" | "latest" | "search" | "downloads" | "favorited";

const SOURCES: { id: CatalogSource; label: string }[] = [
    { id: "trending", label: "TRENDING" },
    { id: "latest", label: "LATEST" },
    { id: "search", label: "SEARCH" },
    { id: "downloads", label: "DOWNLOADS" },
    { id: "favorited", label: "FAVORITES" }
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

function modelFileHint(model: JsonObject): string {
    const url = modelUrl(model).split("?")[0] ?? "";
    return str(model.filename, str(model.name, url)).toLowerCase();
}

function modelExtension(model: JsonObject): string {
    const match = /\.([a-z0-9]+)$/i.exec(modelFileHint(model));
    return match ? match[1].toLowerCase() : "";
}

function modelArchitecture(model: JsonObject): string {
    return str(model.architecture_version, jsonId(model.architecture_version)).toLowerCase();
}

function modelIsAidax(tone: JsonObject, model: JsonObject): boolean {
    if (modelExtension(model) === "aidax") {
        return true;
    }
    const text = `${str(tone.format)} ${str(model.format)} ${str(model.kind)} ${str(model.architecture)}`;
    return /aida/i.test(text);
}

function modelIsIr(tone: JsonObject, model: JsonObject): boolean {
    if (modelIsAidax(tone, model)) {
        return false;
    }
    const ext = modelExtension(model);
    if (ext === "nam") {
        return false;
    }
    if (ext === "wav" || ext === "flac" || ext === "aiff" || ext === "aif") {
        return true;
    }
    const architecture = modelArchitecture(model);
    if (architecture === "1" || architecture === "2" || architecture === "custom" || architecture.startsWith("a")) {
        return false;
    }
    const format = str(model.format, str(model.kind)).toLowerCase();
    if (format === "nam") {
        return false;
    }
    if (format === "ir" || format === "wav" || format === "impulse") {
        return true;
    }
    return str(tone.format) === "ir" || toneGear(tone) === "ir";
}

function downloadKind(tone: JsonObject, model: JsonObject): LibraryKind {
    if (modelIsAidax(tone, model)) {
        return "aidax";
    }
    if (modelIsIr(tone, model)) {
        return "ir";
    }
    return "model";
}

function downloadKindForModels(tone: JsonObject, models: JsonObject[]): LibraryKind {
    const kinds = models.map((model) => downloadKind(tone, model));
    if (kinds.includes("model")) {
        return "model";
    }
    if (kinds.includes("aidax")) {
        return "aidax";
    }
    if (kinds.includes("ir")) {
        return "ir";
    }
    return "model";
}

function fileStem(name: string): string {
    const leaf = name.replace(/\\/g, "/").split("/").pop() ?? name;
    return leaf.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function libraryFileStems(library: JsonObject): Set<string> {
    const stems = new Set<string>();
    for (const key of ["models", "aidax", "impulseResponses"] as const) {
        for (const item of objects(library[key])) {
            const stem = fileStem(str(item.name, str(item.path)));
            if (stem) {
                stems.add(stem);
            }
        }
    }
    return stems;
}

function modelOnDevice(model: JsonObject, stems: Set<string>): boolean {
    const candidates = [str(model.name), str(model.filename), modelFileHint(model)];
    return candidates.some((name) => {
        const stem = fileStem(name);
        return stem.length > 1 && stems.has(stem);
    });
}

function toneNameOnDevice(tone: JsonObject, stems: Set<string>): boolean {
    const stem = fileStem(toneName(tone));
    if (stem.length < 4) {
        return false;
    }
    for (const local of stems) {
        if (local === stem || (local.length >= 4 && (local.includes(stem) || stem.includes(local)))) {
            return true;
        }
    }
    return false;
}

function libraryFiles(library: JsonObject): JsonObject[] {
    return [
        ...objects(library.models),
        ...objects(library.aidax),
        ...objects(library.impulseResponses)
    ];
}

function entryMatchesName(entry: JsonObject, name: string): boolean {
    const entryStem = fileStem(str(entry.name, str(entry.path)));
    const stem = fileStem(name);
    return stem.length > 1 && entryStem === stem;
}

function filesForModel(model: JsonObject, files: JsonObject[]): JsonObject[] {
    const names = [str(model.name), str(model.filename), modelFileHint(model)].filter(Boolean);
    return files.filter((entry) => names.some((name) => entryMatchesName(entry, name)));
}

function filesForTone(tone: JsonObject, models: JsonObject[], files: JsonObject[]): JsonObject[] {
    const found = models.flatMap((model) => filesForModel(model, files));
    const byPath = new Map(found.map((entry) => [str(entry.path), entry]));
    if (byPath.size === 0) {
        for (const entry of files) {
            if (entryMatchesName(entry, toneName(tone))) {
                byPath.set(str(entry.path), entry);
            }
        }
    }
    return [...byPath.values()];
}

function toneOnDeviceState(
    tone: JsonObject,
    models: JsonObject[] | undefined,
    stems: Set<string>
): "none" | "some" | "all" {
    if (models && models.length > 0) {
        const downloadable = models.filter((model) => modelUrl(model) || jsonId(model.id));
        if (downloadable.length === 0) {
            return "none";
        }
        const saved = downloadable.filter((model) => modelOnDevice(model, stems)).length;
        if (saved === 0) {
            return "none";
        }
        return saved === downloadable.length ? "all" : "some";
    }
    return toneNameOnDevice(tone, stems) ? "some" : "none";
}

function pageSizeFor(source: CatalogSource): number {
    if (source === "favorited") {
        return 50;
    }
    return 25;
}

function buildListPayload(catalog: CatalogQuery, page: number, refresh: boolean): JsonObject {
    const ir = catalog.gear === "ir";
    if (catalog.source === "favorited") {
        return { refresh, source: catalog.source, page, page_size: pageSizeFor(catalog.source) };
    }

    // Trending / latest homepage feeds are only 10 items. Search is paginated,
    // so those tabs keep loading through /tones/search as the user scrolls.
    // DOWNLOADS is Tone3000's most-downloaded catalog, not the user's history.
    const body: JsonObject = {
        refresh,
        source: "search",
        page,
        page_size: pageSizeFor("search"),
        sort: catalog.source === "latest"
            ? "newest"
            : catalog.source === "trending"
                ? "trending"
                : catalog.source === "downloads"
                    ? "downloads-all-time"
                    : catalog.sort
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
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
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
    const [deleteConfirm, setDeleteConfirm] = useState<{ title: string; body: string; paths: string[] } | null>(null);
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
    const applyingSharedScroll = useRef(false);
    const scrollPublishFrame = useRef<number | null>(null);
    const pendingScrollRatio = useRef(0);
    const localScrollUntil = useRef(0);
    const sharedTone = obj(engine.uiSession.tone3000);
    const updateSharedTone = (patch: JsonObject) => {
        engine.client.updateUiSession({
            tone3000: { ...obj(engine.client.snapshot.uiSession.tone3000), ...patch }
        });
    };

    useEffect(() => {
        const nextSource = str(sharedTone.source) as CatalogSource;
        if (SOURCES.some((item) => item.id === nextSource) && nextSource !== source) setSource(nextSource);
        if (typeof sharedTone.gear === "string" && sharedTone.gear !== gear) setGear(sharedTone.gear);
        if (typeof sharedTone.sort === "string" && sharedTone.sort !== sort) setSort(sharedTone.sort);
        if (typeof sharedTone.architecture === "string" && sharedTone.architecture !== architecture) {
            setArchitecture(sharedTone.architecture);
        }
        if (typeof sharedTone.calibrated === "boolean" && sharedTone.calibrated !== calibrated) {
            setCalibrated(sharedTone.calibrated);
        }
        if (typeof sharedTone.verified === "boolean" && sharedTone.verified !== verified) {
            setVerified(sharedTone.verified);
        }
        if (typeof sharedTone.query === "string" && sharedTone.query !== query) setQuery(sharedTone.query);
        if (Array.isArray(sharedTone.selectedCreators)) {
            const next = sharedTone.selectedCreators.filter((item): item is string => typeof item === "string");
            if (JSON.stringify(next) !== JSON.stringify(selectedCreators)) setSelectedCreators(next);
        }
        if (Array.isArray(sharedTone.favoriteCreators)) {
            const next = objects(sharedTone.favoriteCreators).map((item) => ({
                username: str(item.username), label: str(item.label)
            })).filter((item) => item.username);
            if (JSON.stringify(next) !== JSON.stringify(favoriteCreators)) {
                setFavoriteCreators(next);
                saveFavoriteCreators(next);
            }
        }
        if (typeof sharedTone.creatorPickerOpen === "boolean"
            && sharedTone.creatorPickerOpen !== creatorPickerOpen) {
            setCreatorPickerOpen(sharedTone.creatorPickerOpen);
        }
        if (typeof sharedTone.sourcePickerOpen === "boolean"
            && sharedTone.sourcePickerOpen !== sourcePickerOpen) {
            setSourcePickerOpen(sharedTone.sourcePickerOpen);
        }
        if (typeof sharedTone.filtersOpen === "boolean" && sharedTone.filtersOpen !== filtersOpen) {
            setFiltersOpen(sharedTone.filtersOpen);
        }
    }, [engine.uiSession.tone3000]);

    useEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller || typeof sharedTone.scrollRatio !== "number") return;
        // Ignore the websocket echo of this browser's own scroll gesture.
        // Applying an older ratio during touchpad momentum makes the list
        // visibly jump back and forth.
        if (performance.now() < localScrollUntil.current) return;
        const range = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const desired = Math.max(0, Math.min(1, sharedTone.scrollRatio)) * range;
        if (Math.abs(scroller.scrollTop - desired) < 2) return;
        applyingSharedScroll.current = true;
        scroller.scrollTop = desired;
        const frame = window.requestAnimationFrame(() => {
            applyingSharedScroll.current = false;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [sharedTone.scrollRatio, tones.length]);

    useEffect(() => () => {
        if (scrollPublishFrame.current !== null) window.cancelAnimationFrame(scrollPublishFrame.current);
    }, []);

    const shareScroll = () => {
        const scroller = scrollerRef.current;
        if (!scroller || applyingSharedScroll.current) return;
        localScrollUntil.current = performance.now() + 250;
        const range = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        pendingScrollRatio.current = range > 0 ? scroller.scrollTop / range : 0;
        if (scrollPublishFrame.current !== null) return;
        scrollPublishFrame.current = window.requestAnimationFrame(() => {
            scrollPublishFrame.current = null;
            updateSharedTone({ scrollRatio: pendingScrollRatio.current });
        });
    };
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
            const filtered = catalog.source === "favorited"
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
        setPendingDownload({ tone, models });
        setFolderPicker(downloadKindForModels(tone, models));
    };

    const askDelete = (paths: string[], label: string) => {
        const unique = [...new Set(paths.filter(Boolean))];
        if (!unique.length) {
            return;
        }
        setDeleteConfirm({
            title: unique.length === 1 ? "DELETE FILE" : "DELETE FILES",
            body: unique.length === 1
                ? `Delete “${label}” from this Pi? This cannot be undone.`
                : `Delete ${unique.length} files for “${label}”? This cannot be undone.`,
            paths: unique
        });
    };

    const deleteConfirmed = () => {
        const confirm = deleteConfirm;
        if (!confirm) {
            return;
        }
        setDeleteConfirm(null);
        void run(async () => {
            for (const path of confirm.paths) {
                await engine.client.request("library/delete", { path });
            }
            await engine.client.request("library");
        });
    };

    const openTone = (tone: JsonObject) => {
        setSelectedTone(tone);
        updateSharedTone({ selectedToneId: toneKey(tone) });
        setDownloadError("");
        setDownloadStatus("");
        void loadModels(tone).catch((caught: unknown) => {
            setDownloadError(caught instanceof Error ? caught.message : String(caught));
        });
    };

    const persistCreators = (list: FavoriteCreator[]) => {
        setFavoriteCreators(list);
        saveFavoriteCreators(list);
        updateSharedTone({ favoriteCreators: list });
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
        setSelectedCreators((current) => {
            const next = current.filter((item) => creatorKey(item) !== creatorKey(username));
            updateSharedTone({ selectedCreators: next });
            return next;
        });
    };

    const isFavoriteCreator = (username: string) => (
        favoriteCreators.some((item) => creatorKey(item.username) === creatorKey(username))
    );

    const browseCreators = (usernames: string[]) => {
        setSelectedCreators(usernames);
        setSelectedTone(null);
        const nextSource = source === "favorited" ? "trending" : source;
        if (nextSource !== source) setSource(nextSource);
        updateSharedTone({
            selectedCreators: usernames,
            selectedToneId: "",
            source: nextSource
        });
    };

    useEffect(() => {
        const selectedToneId = str(sharedTone.selectedToneId);
        if (!selectedToneId) {
            if (selectedTone) setSelectedTone(null);
            return;
        }
        if (selectedTone && toneKey(selectedTone) === selectedToneId) return;
        const tone = tones.find((item) => toneKey(item) === selectedToneId);
        if (!tone) return;
        setSelectedTone(tone);
        setDownloadError("");
        setDownloadStatus("");
        void loadModels(tone).catch((caught: unknown) => {
            setDownloadError(caught instanceof Error ? caught.message : String(caught));
        });
    }, [sharedTone.selectedToneId, tones]);

    const myCreatorsActive = favoriteCreators.length > 0
        && selectedCreators.length === favoriteCreators.length
        && favoriteCreators.every((item) => (
            selectedCreators.some((username) => creatorKey(username) === creatorKey(item.username))
        ));

    const signedInAs = str(obj(status.user).username);
    const libraryStems = libraryFileStems(engine.library);
    const storedFiles = libraryFiles(engine.library);
    const sourceLabel = SOURCES.find((item) => item.id === source)?.label ?? "BROWSE";
    const activeFilterCount = (gear ? 1 : 0)
        + (gear !== "ir" && architecture ? 1 : 0)
        + (calibrated ? 1 : 0)
        + (verified ? 1 : 0)
        + selectedCreators.length
        + (source === "search" && sort !== "trending" ? 1 : 0);
    const chooseSource = (nextSource: CatalogSource) => {
        const nextSort = nextSource === "search" && !query.trim() ? "trending" : sort;
        setSource(nextSource);
        setSort(nextSort);
        setSelectedTone(null);
        setSourcePickerOpen(false);
        updateSharedTone({
            source: nextSource,
            sort: nextSort,
            selectedToneId: "",
            sourcePickerOpen: false
        });
    };

    useEffect(() => {
        void engine.client.request("library").catch(() => undefined);
    }, [engine.client]);
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
                <div className="mfx-screen-intro-title">MODEL LIBRARY</div>
                <div className="mfx-screen-intro-sub">Download NAM, AIDA-X and IR files from TONE3000</div>
            </div>
            <div className="page-scroll stack" style={{ flex: 1, minHeight: 0 }}>
                {!bool(status.connected) && (
                    <div className="panel stack">
                        <div className="muted">
                            Sign in to TONE3000 from Settings → Model Library, then come back here to browse.
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
                    <div className={`t3k-compact-bar${source === "search" ? " is-searching" : ""}`}
                        data-mfx-nav-list="tone-compact-bar">
                        <button
                            type="button"
                            className="btn btn-active t3k-source-button"
                            data-mfx-nav-key="source-picker"
                            onClick={() => {
                                setSourcePickerOpen(true);
                                updateSharedTone({ sourcePickerOpen: true });
                            }}
                        >
                            {sourceLabel} ▾
                        </button>
                        {source === "search" && (
                            <div className="t3k-compact-search">
                                <input
                                    value={query}
                                    aria-label="Search TONE3000"
                                    placeholder="Search models"
                                    onChange={(event) => setQuery(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            updateSharedTone({ query, source: "search", sort, selectedToneId: "" });
                                            void fetchTones({ refresh: false });
                                        }
                                    }}
                                />
                                <button type="button" className="btn btn-accent" data-mfx-nav-key="search" onClick={() => {
                                    updateSharedTone({ query, source: "search", sort, selectedToneId: "" });
                                    void fetchTones({ refresh: false });
                                }}>GO</button>
                            </div>
                        )}
                        <button
                            type="button"
                            className={`btn${activeFilterCount > 0 ? " btn-active" : ""}`}
                            data-mfx-nav-key="filters"
                            onClick={() => {
                                setFiltersOpen(true);
                                updateSharedTone({ filtersOpen: true });
                            }}
                        >
                            FILTERS{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
                        </button>
                        <button type="button" className="btn t3k-refresh-button" data-mfx-nav-key="refresh"
                            title={`${signedInAs ? `Signed in as @${signedInAs}` : "Signed in"}${cached ? " · cached" : ""}`}
                            onClick={() => void fetchTones({ refresh: true })}>
                            {loading ? "…" : "REFRESH"}
                        </button>
                    </div>
                    <div className="t3k-scroll" ref={scrollerRef} onScroll={shareScroll}>
                    <div className="t3k-grid" data-mfx-nav-list="tone-results">
                        {tones.map((tone) => {
                            const id = toneKey(tone);
                            const name = toneName(tone);
                            const image = toneImage(tone);
                            const username = creatorUsername(tone);
                            const savedCreator = isFavoriteCreator(username);
                            const onDevice = toneOnDeviceState(tone, modelsByTone[id], libraryStems);
                            return (
                                <div
                                    key={id}
                                    role="button"
                                    tabIndex={0}
                                    data-mfx-nav-key={`tone:${id}`}
                                    className={`t3k-card${selectedTone && toneKey(selectedTone) === id ? " expanded" : ""}${onDevice !== "none" ? " is-on-device" : ""}${onDevice === "all" ? " is-complete" : ""}`}
                                    onClick={() => openTone(tone)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            openTone(tone);
                                        }
                                    }}
                                >
                                    <div className="t3k-card-media">
                                        {image ? (
                                            <img className="t3k-card-image" src={image} alt="" />
                                        ) : (
                                            <div className="t3k-card-image-fallback">{gearLabel(toneGear(tone) || "NAM")}</div>
                                        )}
                                        {onDevice !== "none" && (
                                            <div className={`t3k-on-device-check${onDevice === "all" ? " is-complete" : ""}`} title={onDevice === "all" ? "All files on this Pi" : "Some files on this Pi"}>
                                                ✓
                                            </div>
                                        )}
                                    </div>
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
                    {sourcePickerOpen && (
                        <div className="dialog-backdrop" onClick={() => {
                            setSourcePickerOpen(false);
                            updateSharedTone({ sourcePickerOpen: false });
                        }}>
                            <div className="dialog t3k-compact-dialog" onClick={(event) => event.stopPropagation()}>
                                <h2>BROWSE</h2>
                                <div className="t3k-source-options" data-mfx-nav-list="tone-source-picker">
                                    {SOURCES.map((item) => (
                                        <button key={item.id} type="button"
                                            data-mfx-nav-key={`source:${item.id}`}
                                            className={`btn ${source === item.id ? "btn-active" : ""}`}
                                            onClick={() => chooseSource(item.id)}>
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                    {filtersOpen && (
                        <div className="dialog-backdrop" onClick={() => {
                            setFiltersOpen(false);
                            updateSharedTone({ filtersOpen: false });
                        }}>
                            <div className="dialog t3k-filter-dialog" onClick={(event) => event.stopPropagation()}>
                                <div className="t3k-dialog-head">
                                    <h2>FILTERS</h2>
                                    <button type="button" className="btn" onClick={() => {
                                        setFiltersOpen(false);
                                        updateSharedTone({ filtersOpen: false });
                                    }}>DONE</button>
                                </div>
                                <div className="field-label">GEAR</div>
                                <div className="t3k-filter-options" data-mfx-nav-list="tone-gears">
                                    {GEARS.map((item) => (
                                        <button key={item.id || "all"} type="button"
                                            data-mfx-nav-key={`gear:${item.id || "all"}`}
                                            className={`btn ${gear === item.id ? "btn-active" : ""}`}
                                            onClick={() => {
                                                setGear(item.id);
                                                setSelectedTone(null);
                                                updateSharedTone({ gear: item.id, selectedToneId: "" });
                                            }}>{item.label}</button>
                                    ))}
                                </div>
                                {gear !== "ir" && (
                                    <>
                                        <div className="field-label">ARCHITECTURE</div>
                                        <div className="t3k-filter-options" data-mfx-nav-list="tone-architecture">
                                            {ARCHITECTURES.map((item) => (
                                                <button key={item.id} type="button"
                                                    data-mfx-nav-key={`architecture:${item.id}`}
                                                    className={`btn ${architecture === item.id ? "btn-active" : ""}`}
                                                    onClick={() => {
                                                        setArchitecture(item.id);
                                                        setSelectedTone(null);
                                                        updateSharedTone({ architecture: item.id, selectedToneId: "" });
                                                    }}>{item.label}</button>
                                            ))}
                                            <button type="button" data-mfx-nav-key="calibrated"
                                                className={`btn ${calibrated ? "btn-active" : ""}`}
                                                onClick={() => {
                                                    const next = !calibrated;
                                                    setCalibrated(next);
                                                    setSelectedTone(null);
                                                    updateSharedTone({ calibrated: next, selectedToneId: "" });
                                                }}>CALIBRATED</button>
                                        </div>
                                    </>
                                )}
                                <div className="field-label">CREATORS</div>
                                <div className="t3k-filter-options" data-mfx-nav-list="tone-creators">
                                    <button type="button" data-mfx-nav-key="creator-picker"
                                        className={`btn ${creatorPickerOpen ? "btn-active" : ""}`}
                                        onClick={() => {
                                            setCreatorPickerOpen(true);
                                            updateSharedTone({ creatorPickerOpen: true });
                                        }}>CHOOSE CREATORS</button>
                                    <button type="button" data-mfx-nav-key="verified"
                                        className={`btn ${verified ? "btn-active" : ""}`}
                                        onClick={() => {
                                            const next = !verified;
                                            setVerified(next);
                                            setSelectedTone(null);
                                            updateSharedTone({ verified: next, selectedToneId: "" });
                                        }}>VERIFIED</button>
                                    <button type="button" data-mfx-nav-key="my-creators"
                                        className={`btn ${myCreatorsActive ? "btn-active" : ""}`}
                                        onClick={() => {
                                            if (myCreatorsActive) browseCreators([]);
                                            else if (!favoriteCreators.length) {
                                                setCreatorPickerOpen(true);
                                                updateSharedTone({ creatorPickerOpen: true });
                                            } else browseCreators(favoriteCreators.map((item) => item.username));
                                        }}>MY CREATORS</button>
                                    {favoriteCreators.map((item) => {
                                        const active = selectedCreators.some((username) => creatorKey(username) === creatorKey(item.username));
                                        return (
                                            <button key={item.username} type="button"
                                                data-mfx-nav-key={`creator:${item.username}`}
                                                className={`btn ${active ? "btn-active" : ""}`}
                                                onClick={() => browseCreators(active
                                                    ? selectedCreators.filter((username) => creatorKey(username) !== creatorKey(item.username))
                                                    : [...selectedCreators, item.username])}>
                                                @{item.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                {source === "search" && (
                                    <>
                                        <div className="field-label">SORT</div>
                                        <div className="t3k-filter-options" data-mfx-nav-list="tone-sorts">
                                            {SORTS.map((item) => (
                                                <button key={item.id} type="button"
                                                    data-mfx-nav-key={`sort:${item.id}`}
                                                    className={`btn ${sort === item.id ? "btn-active" : ""}`}
                                                    onClick={() => {
                                                        setSort(item.id);
                                                        updateSharedTone({ sort: item.id });
                                                    }}>{item.label}</button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                    {selectedTone && (
                        <ToneDownloadDialog
                            tone={selectedTone}
                            models={modelsByTone[toneKey(selectedTone)] ?? []}
                            libraryStems={libraryStems}
                            loadingModels={!(toneKey(selectedTone) in modelsByTone) && !downloadError}
                            downloading={downloading}
                            status={downloadStatus}
                            error={downloadError}
                            progress={downloadProgress}
                            onClose={() => {
                                if (!downloading) {
                                    setSelectedTone(null);
                                    updateSharedTone({ selectedToneId: "" });
                                    setDownloadError("");
                                    setDownloadStatus("");
                                    setDownloadProgress({ current: 0, total: 0, name: "" });
                                }
                            }}
                            onDownloadAll={(models) => {
                                queueDownload(selectedTone, models);
                            }}
                            onDownloadOne={(model) => {
                                queueDownload(selectedTone, [model]);
                            }}
                            onDeleteOne={(model) => {
                                const files = filesForModel(model, storedFiles);
                                askDelete(files.map((item) => str(item.path)), str(model.name, toneName(selectedTone)));
                            }}
                            onDeleteAll={(models) => {
                                const files = filesForTone(selectedTone, models, storedFiles);
                                askDelete(files.map((item) => str(item.path)), toneName(selectedTone));
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
                            onClose={() => {
                                setCreatorPickerOpen(false);
                                updateSharedTone({ creatorPickerOpen: false });
                            }}
                            onAdd={addFavoriteCreator}
                            onRemove={removeFavoriteCreator}
                            onShow={(usernames) => {
                                browseCreators(usernames);
                                setCreatorPickerOpen(false);
                                updateSharedTone({ creatorPickerOpen: false });
                            }}
                        />
                    )}
                    {deleteConfirm && (
                        <div className="dialog-backdrop" onClick={() => setDeleteConfirm(null)}>
                            <div className="dialog" onClick={(event) => event.stopPropagation()}>
                                <h2>{deleteConfirm.title}</h2>
                                <div>{deleteConfirm.body}</div>
                                <div className="row" style={{ justifyContent: "flex-end" }}>
                                    <button type="button" className="btn" onClick={() => setDeleteConfirm(null)}>CANCEL</button>
                                    <button type="button" className="btn btn-danger" onClick={deleteConfirmed}>DELETE</button>
                                </div>
                            </div>
                        </div>
                    )}
                    {folderPicker && (
                        <LibraryFolderPicker
                            engine={engine}
                            run={run}
                            kind={folderPicker}
                            value={dirForKind(folderPicker)}
                            onPick={(directory, kind) => {
                                saveDir(kind, directory);
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
    libraryStems,
    loadingModels,
    downloading,
    status,
    error,
    progress,
    creatorSaved,
    onClose,
    onDownloadAll,
    onDownloadOne,
    onDeleteOne,
    onDeleteAll,
    onToggleCreator
}: {
    tone: JsonObject;
    models: JsonObject[];
    libraryStems: Set<string>;
    loadingModels: boolean;
    downloading: boolean;
    status: string;
    error: string;
    progress: { current: number; total: number; name: string };
    creatorSaved: boolean;
    onClose: () => void;
    onDownloadAll: (models: JsonObject[]) => void;
    onDownloadOne: (model: JsonObject) => void;
    onDeleteOne: (model: JsonObject) => void;
    onDeleteAll: (models: JsonObject[]) => void;
    onToggleCreator: () => void;
}) {
    const name = toneName(tone);
    const username = creatorUsername(tone);
    const downloadable = models.filter((model) => modelUrl(model) || jsonId(model.id));
    const remainingModels = downloadable.filter((model) => !modelOnDevice(model, libraryStems));
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
                {remainingModels.length === 0 && downloadable.length > 0 ? (
                    <button
                        type="button"
                        className="btn btn-danger"
                        disabled={downloading || loadingModels}
                        onClick={() => onDeleteAll(downloadable)}
                    >
                        DELETE ALL
                    </button>
                ) : (
                    <button
                        type="button"
                        className={`btn ${remainingModels.length ? "btn-accent" : ""}`}
                        disabled={downloading || loadingModels || remainingModels.length === 0}
                        onClick={() => onDownloadAll(remainingModels)}
                    >
                        {downloading
                            ? "DOWNLOADING…"
                            : remainingModels.length < downloadable.length
                                ? `DOWNLOAD REMAINING (${remainingModels.length})`
                                : `DOWNLOAD ALL${downloadable.length ? ` (${downloadable.length})` : ""}`}
                    </button>
                )}
                <div className="t3k-models">
                    {loadingModels && <div className="muted">Loading models…</div>}
                    {!loadingModels && downloadable.length === 0 && <div className="muted">No models listed.</div>}
                    {downloadable.map((model, modelIndex) => {
                        const saved = modelOnDevice(model, libraryStems);
                        return (
                        <div key={jsonId(model.id, String(modelIndex))} className={`row t3k-model-row${saved ? " is-on-device" : ""}`}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div className={`t3k-model-name${saved ? " is-on-device" : ""}`}>{str(model.name, name)}</div>
                                <div className="muted">
                                    {str(model.size)}
                                    {arch(model) ? ` · ${arch(model)}` : ""}
                                    {downloadKind(tone, model) === "ir" ? " · IR" : downloadKind(tone, model) === "aidax" ? " · AIDA-X" : " · NAM"}
                                    {saved ? " · on device" : ""}
                                </div>
                            </div>
                            <button
                                type="button"
                                className={`btn ${saved ? "btn-danger" : "btn-accent"}`}
                                disabled={downloading}
                                onClick={() => (saved ? onDeleteOne(model) : onDownloadOne(model))}
                            >
                                {saved ? "DELETE" : "DOWNLOAD"}
                            </button>
                        </div>
                        );
                    })}
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
