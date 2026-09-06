import { useEffect, useState } from "react";
import type { EngineSnapshot } from "../api";
import { bool, obj, str, objects, type JsonObject } from "../json";

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
    const [redirect, setRedirect] = useState("");
    const [code, setCode] = useState("");
    const [state, setState] = useState("");
    const [message, setMessage] = useState("");

    const refresh = () => {
        void engine.client.request("tone3000/status").then((result) => {
            setStatus(result);
            setKey(str(result.publishableKey));
            setRedirect(str(result.redirectUri));
        }).catch((error: unknown) => {
            setMessage(error instanceof Error ? error.message : String(error));
        });
    };

    useEffect(() => {
        refresh();
    }, [engine.client]);

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
                Sign in with your own TONE3000 account. Pi-MFX never ships factory packs and
                only downloads a file you asked for onto this Pi.
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
                <span>Redirect URI (same value registered on tone3000.com)</span>
                <input value={redirect} onChange={(event) => setRedirect(event.target.value)} />
            </label>
            <div className="row">
                <button type="button" className="btn" onClick={() => {
                    void run(async () => {
                        await engine.client.request("tone3000/configure", {
                            publishableKey: key,
                            redirectUri: redirect
                        });
                        refresh();
                    });
                }}>SAVE KEYS</button>
                <button type="button" className="btn btn-accent" onClick={() => {
                    void run(async () => {
                        const result = await engine.client.request("tone3000/auth/start", { prompt: "" });
                        const url = str(result.authorizeUrl);
                        if (url) {
                            window.open(url, "_blank", "noopener");
                            setMessage("Finish sign-in in the browser, then paste code and state below.");
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
                        <span>OAuth code</span>
                        <input value={code} onChange={(event) => setCode(event.target.value)} />
                    </label>
                    <label className="field">
                        <span>State</span>
                        <input value={state} onChange={(event) => setState(event.target.value)} />
                    </label>
                    <button type="button" className="btn" onClick={() => {
                        void run(async () => {
                            await engine.client.request("tone3000/auth/complete", { code, state });
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
