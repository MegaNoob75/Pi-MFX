import { useCallback, useEffect, useState } from "react";
import type { EngineSnapshot } from "../api";
import { bool, obj, str } from "../json";

const POLL_MS = 2000;
const CLI_COMMAND = "sudo bash ./scripts/pimfx.sh update";

export function UpdatesView({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const version = str(engine.state.version, "0.1.0");
    const gitSha = str(engine.state.gitSha);
    const [status, setStatus] = useState(obj({}));
    const [checking, setChecking] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [message, setMessage] = useState("");

    const applyStatus = (next: ReturnType<typeof obj>) => {
        setStatus(next);
        const job = str(next.jobState, "idle");
        setInstalling((wasInstalling) => {
            if (job === "installing") {
                return true;
            }
            if (wasInstalling) {
                setMessage(str(next.message) || (bool(next.ok, true) ? "Update finished." : str(next.error)));
            }
            return false;
        });
        return next;
    };

    const check = useCallback(async (fetchLatest = true) => {
        setChecking(true);
        setMessage("");
        try {
            const next = obj(await engine.client.request("system/update/status", { fetch: fetchLatest }));
            applyStatus(next);
            if (str(next.error) && !bool(next.ok, true)) {
                setMessage(str(next.error));
            }
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            setChecking(false);
        }
    }, [engine.client]);

    useEffect(() => {
        void check(true);
    }, [check]);

    useEffect(() => {
        if (!installing) {
            return;
        }
        let stopped = false;
        const poll = async () => {
            try {
                const next = obj(await engine.client.request("system/update/status", { fetch: false }));
                if (stopped) {
                    return;
                }
                applyStatus(next);
            } catch {
                // pimfx.service restarts during a successful update. Keep polling.
            }
        };
        const timer = window.setInterval(() => void poll(), POLL_MS);
        void poll();
        return () => {
            stopped = true;
            window.clearInterval(timer);
        };
    }, [engine.client, installing]);

    const installedCommit = str(status.installedCommit, gitSha);
    const latestCommit = str(status.latestCommit);
    const updateAvailable = bool(status.updateAvailable);
    const helperMissing = str(status.error).includes("not configured")
        || str(message).includes("helper")
        || str(status.error).toLowerCase().includes("helper");
    const logLines = str(status.log).split(/\r?\n/).filter(Boolean);
    const upToDate = bool(status.ok, true)
        && Boolean(installedCommit)
        && Boolean(latestCommit)
        && !updateAvailable
        && str(status.jobState, "idle") === "idle"
        && !str(status.error);

    const install = () => {
        const approved = window.confirm(
            "Install the latest Pi-MFX commit now?\n\n"
            + "Audio stops while the engine rebuilds. This takes several minutes and restarts the Pi-MFX service.\n\n"
            + "update.sh runs git reset --hard on this Pi's clone, so local source edits there will be discarded."
        );
        if (!approved) {
            return;
        }
        setInstalling(true);
        setMessage("Starting update…");
        void run(async () => {
            try {
                const next = obj(await engine.client.request("system/update/install"));
                applyStatus(next);
                setMessage(str(next.message) || str(next.error) || "Update started.");
            } catch (error) {
                setMessage(error instanceof Error ? error.message : String(error));
            }
        });
    };

    return (
        <div className="mfx-screen">
            <div className="page-scroll stack updates-page">
                <section className="panel stack">
                    <h2>PI-MFX UPDATE</h2>
                    <div className="updates-version-grid">
                        <span>Version</span>
                        <strong>{version}</strong>
                        <span>Installed</span>
                        <strong>{installedCommit || "Unknown"}</strong>
                        {latestCommit && (
                            <>
                                <span>Latest</span>
                                <strong>{latestCommit}</strong>
                            </>
                        )}
                        {str(status.branch) && (
                            <>
                                <span>Branch</span>
                                <strong>{str(status.branch)}</strong>
                            </>
                        )}
                    </div>
                    <div className="updates-status">
                        {checking && "Checking for updates…"}
                        {!checking && installing && (str(status.message) || "Installing the update…")}
                        {!checking && !installing && updateAvailable && `Commit ${latestCommit} is available.`}
                        {!checking && !installing && upToDate && "Pi-MFX is up to date."}
                        {!checking && !installing && str(status.jobState) === "failed" && str(status.message)}
                        {!checking && !installing && str(status.error) && str(status.error)}
                        {!checking && !installing && !updateAvailable && !upToDate && !str(status.error)
                            && (str(status.message) || "Could not determine update status.")}
                    </div>
                    {logLines.length > 0 && (
                        <pre className="updates-progress">{logLines.join("\n")}</pre>
                    )}
                    <div className="updates-warning">
                        An update stops audio, rebuilds the engine and UI, and restarts the Pi-MFX service.
                        The plugin helper stays up so this page can keep showing progress.
                    </div>
                    <div className="row" style={{ flexWrap: "wrap" }}>
                        <button
                            type="button"
                            className="btn"
                            disabled={checking || installing}
                            onClick={() => void check(true)}
                        >
                            {checking ? "CHECKING..." : "CHECK FOR UPDATES"}
                        </button>
                        {updateAvailable && (
                            <button
                                type="button"
                                className="btn btn-accent"
                                disabled={checking || installing}
                                onClick={install}
                            >
                                {installing ? "UPDATING..." : "UPDATE"}
                            </button>
                        )}
                    </div>
                    {message && <div className="muted">{message}</div>}
                </section>
                <section className="panel stack">
                    <h2>COMMAND-LINE RECOVERY</h2>
                    <div className="muted">
                        {helperMissing
                            ? "The plugin helper is not available, so updates cannot start from this screen. On the Pi, from the Pi-MFX clone, run:"
                            : "If an update cannot be started from this screen, update from the Pi-MFX clone:"}
                    </div>
                    <pre className="updates-command">{CLI_COMMAND}</pre>
                </section>
            </div>
        </div>
    );
}
