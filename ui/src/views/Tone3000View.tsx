import { useEffect, useRef, useState } from "react";
import type { EngineSnapshot } from "../api";
import { arr, bool, num, obj, str, objects, type Json, type JsonObject } from "../json";

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

const GEAR_LABELS: Record<string, string> = Object.fromEntries(
    GEARS.filter((item) => item.id).map((item) => [item.id, item.label])
);

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
    const user = obj(tone.user);
    const name = str(user.username, str(tone.creator, str(obj(tone.user).name)));
    return name ? `@${name.replace(/^@/, "")}` : "";
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

function modelUrl(model: JsonObject): string {
    return str(model.model_url, str(model.url, str(model.downloadUrl, str(model.download_url))));
}

function modelIsIr(tone: JsonObject, model: JsonObject): boolean {
    if (str(tone.format) === "ir" || toneGear(tone) === "ir") {
        return true;
    }
    const text = `${str(model.kind)} ${str(model.format)} ${str(model.name)}`;
    return /(?:^|\b)ir(?:\b|$)|impulse/i.test(text);
}

function pageSizeFor(source: CatalogSource): number {
    if (source === "downloaded" || source === "favorited" || source === "created") {
        return 50;
    }
    return 25;
}

function buildListPayload(
    source: CatalogSource,
    gear: string,
    query: string,
    sort: string,
    page: number,
    refresh: boolean
): JsonObject {
    const ir = gear === "ir";
    if (source === "downloaded" || source === "favorited" || source === "created") {
        return { refresh, source, page, page_size: pageSizeFor(source) };
    }

    // Trending / latest homepage feeds are only 10 items. Search is paginated,
    // so those tabs keep loading through /tones/search as the user scrolls.
    const body: JsonObject = {
        refresh,
        source: "search",
        page,
        page_size: pageSizeFor("search"),
        sort: source === "latest" ? "newest" : source === "trending" ? "trending" : sort
    };
    if (source === "search" && query.trim()) {
        body.query = query.trim();
    }
    if (ir) {
        body.format = "ir";
    } else if (gear) {
        body.gears = gear;
        body.format = "nam";
    }
    return body;
}

export function Tone3000View({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const [status, setStatus] = useState<JsonObject>({});
    const [query, setQuery] = useState("");
    const [source, setSource] = useState<CatalogSource>("trending");
    const [gear, setGear] = useState("amp-cab");
    const [sort, setSort] = useState("trending");
    const [tones, setTones] = useState<JsonObject[]>([]);
    const [modelsByTone, setModelsByTone] = useState<Record<string, JsonObject[]>>({});
    const [expandedId, setExpandedId] = useState("");
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
    const catalogRef = useRef({ source, gear, query, sort });
    const scrollerRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    catalogRef.current = { source, gear, query, sort };

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
            const payload = buildListPayload(
                catalog.source,
                catalog.gear,
                catalog.query,
                catalog.sort,
                nextPage,
                Boolean(opts.refresh)
            );
            const result = await engine.client.request("tone3000/tones", payload);
            if (seq !== loadSeq.current) {
                return;
            }
            const list = extractList(result.result);
            const filtered = catalog.source === "downloaded" || catalog.source === "favorited"
                || catalog.source === "created"
                ? list.filter((tone) => matchesGear(tone, catalog.gear))
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
        // query/source/gear/sort are the catalog keys; fetchTones reads them from refs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status.connected, source, gear, sort, query]);

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

    const downloadOne = async (tone: JsonObject, model: JsonObject) => {
        const resolved = await resolveModel(model);
        const url = modelUrl(resolved);
        const modelId = jsonId(resolved.id, jsonId(model.id));
        if (!url && !modelId) {
            throw new Error("that model has no download URL");
        }
        setMessage(`Downloading ${str(resolved.name, toneName(tone))}…`);
        const result = await engine.client.request("tone3000/download", {
            url,
            modelId,
            name: str(resolved.name, toneName(tone)),
            kind: modelIsIr(tone, resolved) ? "ir" : "model"
        });
        const stored = str(result.path);
        await engine.client.request("library");
        setMessage(stored ? `Saved ${str(resolved.name, toneName(tone))} to the library.` : `Saved ${toneName(tone)} to the library.`);
    };

    const downloadBest = async (tone: JsonObject) => {
        const models = await loadModels(tone);
        if (models.length === 0) {
            throw new Error("no downloadable models for that tone");
        }
        const preferred = models.find((item) => jsonId(item.architecture_version) === "2")
            ?? models.find((item) => modelUrl(item) || jsonId(item.id))
            ?? models[0];
        await downloadOne(tone, preferred);
    };

    const signedInAs = str(obj(status.user).username);

    return (
        <div className="panel stack">
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
                                    setExpandedId("");
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
                                    setExpandedId("");
                                }}
                            >
                                {item.label}
                            </button>
                        ))}
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
                            const expanded = expandedId === id;
                            const models = modelsByTone[id] ?? [];
                            return (
                                <div key={id} className={`t3k-card${expanded ? " expanded" : ""}`}>
                                    {image ? (
                                        <img className="t3k-card-image" src={image} alt="" />
                                    ) : (
                                        <div className="t3k-card-image-fallback">{gearLabel(toneGear(tone) || "NAM")}</div>
                                    )}
                                    <div className="t3k-card-body">
                                        <div className="t3k-card-gear">{gearLabel(toneGear(tone))}</div>
                                        <div className="t3k-card-title">{name}</div>
                                        <div className="t3k-card-meta">
                                            {creatorName(tone) && <span>{creatorName(tone)}</span>}
                                            <span>{num(tone.downloads_count)} dl</span>
                                            <span>{num(tone.favorites_count)} fav</span>
                                        </div>
                                        <div className="t3k-card-actions">
                                            <button
                                                type="button"
                                                className="btn btn-accent"
                                                onClick={() => void run(async () => {
                                                    await downloadBest(tone);
                                                })}
                                            >
                                                DOWNLOAD
                                            </button>
                                            <button
                                                type="button"
                                                className="btn"
                                                onClick={() => {
                                                    const next = expanded ? "" : id;
                                                    setExpandedId(next);
                                                    if (next) {
                                                        void run(async () => {
                                                            await loadModels(tone);
                                                        });
                                                    }
                                                }}
                                            >
                                                {expanded ? "HIDE" : "MODELS"}
                                            </button>
                                        </div>
                                        {expanded && (
                                            <div className="t3k-models">
                                                {models.length === 0 && <div className="muted">No models listed.</div>}
                                                {models.map((model, modelIndex) => {
                                                    const url = modelUrl(model);
                                                    const modelId = jsonId(model.id);
                                                    if (!url && !modelId) {
                                                        return null;
                                                    }
                                                    return (
                                                        <div key={`${id}-${jsonId(model.id, String(modelIndex))}`} className="row">
                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                <div>{str(model.name, name)}</div>
                                                                <div className="muted">
                                                                    {str(model.size)}
                                                                    {jsonId(model.architecture_version) ? ` · A${jsonId(model.architecture_version)}` : ""}
                                                                </div>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                className="btn btn-accent"
                                                                onClick={() => void run(async () => {
                                                                    await downloadOne(tone, model);
                                                                })}
                                                            >
                                                                DOWNLOAD
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
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
                </div>
            )}
        </div>
    );
}
