import { useEffect, useRef, useState } from "react";
import type { EngineSnapshot } from "../api";
import { bool, obj, str, objects, type JsonObject } from "../json";

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

export function Tone3000View({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const [status, setStatus] = useState<JsonObject>({});
    const [query, setQuery] = useState("");
    const [source, setSource] = useState("search");
    const [tones, setTones] = useState<JsonObject[]>([]);
    const [key, setKey] = useState("");
    const [redirect, setRedirect] = useState(thisPageRedirect);
    const [code, setCode] = useState("");
    const [state, setState] = useState("");
    const [message, setMessage] = useState("");
    const completingOauth = useRef(false);

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

    const applyCodeField = (text: string) => {
        const parsed = parseOAuthCallback(text);
        if (parsed) {
            setCode(parsed.code);
            setState(parsed.state);
            return;
        }
        setCode(text);
    };

    const search = () => {
        void run(async () => {
            const result = await engine.client.request("tone3000/tones", { source, query });
            const payload = result.result;
            const list = objects(payload).length
                ? objects(payload)
                : objects(obj(payload as JsonObject).data).length
                    ? objects(obj(payload as JsonObject).data)
                    : objects(obj(payload as JsonObject).tones);
            setTones(list);
            setMessage(list.length ? "" : "No tones returned.");
        });
    };

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
                <>
                    <div className="row">
                        <label className="field">
                            <span>Search</span>
                            <input value={query} onChange={(event) => setQuery(event.target.value)} />
                        </label>
                        <label className="field">
                            <span>Source</span>
                            <select value={source} onChange={(event) => setSource(event.target.value)}>
                                {["search", "created", "favorited", "downloaded", "trending", "latest"].map((item) => (
                                    <option key={item} value={item}>{item}</option>
                                ))}
                            </select>
                        </label>
                        <button type="button" className="btn" onClick={search}>SEARCH</button>
                    </div>
                    {tones.map((tone, index) => {
                        const id = str(tone.id, str(tone.toneId, String(index)));
                        const name = str(tone.name, str(tone.title, "Tone"));
                        const models = objects(tone.models).length ? objects(tone.models) : objects(tone.files);
                        return (
                            <div key={id} className="list-item" style={{ flexWrap: "wrap" }}>
                                <div>
                                    <strong>{name}</strong>
                                    <div className="muted">{str(tone.creator) || str(obj(tone.user).name)}</div>
                                </div>
                                {(models.length ? models : [tone]).map((model, modelIndex) => {
                                    const url = str(model.url, str(model.downloadUrl, str(model.download_url)));
                                    if (!url) {
                                        return null;
                                    }
                                    return (
                                        <button
                                            key={`${id}-${modelIndex}`}
                                            type="button"
                                            className="btn btn-accent"
                                            onClick={() => void run(async () => {
                                                await engine.client.request("tone3000/download", {
                                                    url,
                                                    name: str(model.name, name),
                                                    kind: /ir|impulse/i.test(str(model.kind, str(model.format))) ? "ir" : "model"
                                                });
                                                await engine.client.request("library");
                                            })}
                                        >
                                            DOWNLOAD
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })}
                </>
            )}
        </div>
    );
}
