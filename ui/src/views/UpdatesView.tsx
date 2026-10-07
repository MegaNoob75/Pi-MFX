import { useCallback, useEffect, useRef, useState } from "react";
import type { EngineSnapshot } from "../api";
import { bool, num, obj, objects, str } from "../json";
import { updateUiSessionSection } from "../uiSession";
import { markReturnToUpdatesAfterInstall } from "../updateReturn";
import { ConfirmDialog } from "./ConfirmDialog";

const POLL_MS = 2000;
const CLI_COMMAND = "sudo bash ./scripts/pimfx.sh update --branch dev";

function normalizeBranch(value: string) {
    return value === "main" ? "main" : "dev";
}

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
    const [branch, setBranch] = useState("");
    const [checking, setChecking] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [confirmInstall, setConfirmInstall] = useState(false);
    const [confirmPluginInstall, setConfirmPluginInstall] = useState(false);
    const [message, setMessage] = useState("");
    const [pluginStatus, setPluginStatus] = useState(obj({}));
    const [pluginInstalling, setPluginInstalling] = useState(false);
    const [pluginLog, setPluginLog] = useState<string[]>([]);
    const unsavedPresetCount = num(engine.state.sessionPresetDirtyCount);
    const progressRef = useRef<HTMLPreElement | null>(null);
    const followProgressRef = useRef(true);

    useEffect(() => {
        const shared = obj(engine.uiSession.updates);
        const sharedBranch = str(shared.branch);
        if (sharedBranch === "dev" || sharedBranch === "main") {
            setBranch(sharedBranch);
        }
        setConfirmInstall(bool(shared.confirmInstall));
    }, [engine.uiSession.updates]);

    const chooseBranch = (next: "dev" | "main") => {
        setBranch(next);
        updateUiSessionSection(engine.client, "updates", { branch: next });
    };

    const showInstallConfirmation = (show: boolean) => {
        setConfirmInstall(show);
        updateUiSessionSection(engine.client, "updates", { confirmInstall: show });
    };

    const applyStatus = (next: ReturnType<typeof obj>) => {
        setStatus(next);
        const detectedBranch = str(next.requestedBranch) || str(next.branch);
        if (!branch && (detectedBranch === "dev" || detectedBranch === "main")) {
            setBranch(detectedBranch);
        }
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

    const fetching = bool(status.fetching);
    const effectiveBranch = branch || (str(status.requestedBranch) === "main" ? "main" : "dev");

    const check = useCallback(async (fetchLatest = true) => {
        setChecking(true);
        setMessage("");
        try {
            const next = obj(await engine.client.request("system/update/status", {
                fetch: fetchLatest,
                branch,
                installedCommit: gitSha
            }));
            applyStatus(next);
            if (str(next.error) && !bool(next.ok, true)) {
                setMessage(str(next.error));
            }
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            setChecking(false);
        }
    }, [branch, engine.client, gitSha]);

    useEffect(() => {
        void check(true);
    }, [check]);

    useEffect(() => {
        // Keep observing the backend even while this browser is idle. Another
        // browser (for example the PC) may start an update, and every open
        // Updates page must join that shared job without a local button press.
        let stopped = false;
        const poll = async () => {
            try {
                const next = obj(await engine.client.request("system/update/status", {
                    fetch: false,
                    branch,
                    installedCommit: gitSha
                }));
                if (stopped) {
                    return;
                }
                applyStatus(next);
            } catch (error) {
                // pimfx.service restarts during a successful update. Keep polling
                // in that case, but a failed Git fetch must clear the spinner and
                // show its error instead of leaving `fetching` stuck forever.
                if (!installing && !stopped) {
                    const detail = error instanceof Error ? error.message : String(error);
                    setStatus((current) => ({ ...current, fetching: false, ok: false, error: detail }));
                    setMessage(detail);
                }
            }
        };
        const timer = window.setInterval(() => void poll(), POLL_MS);
        void poll();
        return () => {
            stopped = true;
            window.clearInterval(timer);
        };
    }, [branch, engine.client, gitSha, installing, fetching]);

    const installedCommit = gitSha || str(status.installedCommit);
    const latestCommit = str(status.latestCommit);
    const updateAvailable = bool(status.updateAvailable);
    const helperMissing = str(status.error).includes("not configured")
        || str(message).includes("helper")
        || str(status.error).toLowerCase().includes("helper")
        || str(message).includes("not configured");
    const logLines = str(status.log).split(/\r?\n/).filter(Boolean);
    const currentBranch = str(status.branch);
    const switching = Boolean(currentBranch) && currentBranch !== effectiveBranch;
    const upToDate = bool(status.ok, true)
        && Boolean(installedCommit)
        && Boolean(latestCommit)
        && !updateAvailable
        && !switching
        && str(status.jobState, "idle") === "idle"
        && !str(status.error);

    const install = () => {
        showInstallConfirmation(false);
        setInstalling(true);
        setMessage("Starting update…");
        followProgressRef.current = true;
        markReturnToUpdatesAfterInstall();
        void run(async () => {
            try {
                const next = obj(await engine.client.request("system/update/install", {
                    branch: effectiveBranch,
                    installedCommit: gitSha
                }));
                applyStatus(next);
                setMessage(str(next.message) || str(next.error) || "Update started.");
            } catch (error) {
                setMessage(error instanceof Error ? error.message : String(error));
            }
        });
    };

    const refreshPluginUpdates = useCallback(async (force = false) => {
        const next = obj(await engine.client.request("plugins/updates/status", {
            refresh: true,
            force
        }));
        setPluginStatus(next);
        return next;
    }, [engine.client]);

    useEffect(() => {
        void refreshPluginUpdates(false).catch((error) => {
            setPluginStatus({ ok: false, error: error instanceof Error ? error.message : String(error) });
        });
        const timer = window.setInterval(() => {
            void engine.client.request("plugins/updates/status", { refresh: false }).then((next) => {
                setPluginStatus(obj(next));
            }).catch(() => undefined);
        }, 5000);
        return () => window.clearInterval(timer);
    }, [engine.client, refreshPluginUpdates]);

    const pluginItems = objects(pluginStatus.items);
    const pluginUpdates = pluginItems.filter((item) => bool(item.updateAvailable));
    const pluginUpdateCount = num(pluginStatus.updateCount, pluginUpdates.length);
    const pluginChecking = bool(pluginStatus.checking);
    const pluginError = str(pluginStatus.error)
        || str(pluginItems.find((item) => str(item.error))?.error);

    const installPluginUpdates = () => {
        setConfirmPluginInstall(false);
        setPluginInstalling(true);
        setPluginLog([]);
        followProgressRef.current = true;
        void run(async () => {
            const append = (line: string) => setPluginLog((lines) => [...lines, line]);
            try {
                if (pluginUpdates.some((item) => str(item.source) === "apt")) {
                    append("Updating apt-managed LV2 plugins…");
                    await engine.client.request("plugins/updates/apt");
                    append("Apt LV2 plugins updated.");
                }
                for (const item of pluginUpdates) {
                    const source = str(item.source);
                    const title = str(item.title, "LV2 plugin");
                    if (source === "patchstorage") {
                        append(`Updating ${title} from PatchStorage…`);
                        await engine.client.request("plugins/patchstorage/install", { patchId: num(item.id) });
                        append(`${title} updated.`);
                    } else if (source === "pipedal-bundle") {
                        append("Updating TooB from the approved PiPedal bundle…");
                        await engine.client.request("plugins/github/install", { id: "toobamp" });
                        append("TooB updated.");
                    }
                }
                append("LV2 plugin updates finished.");
            } catch (error) {
                append(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
            } finally {
                setPluginInstalling(false);
                await refreshPluginUpdates(true).catch(() => undefined);
            }
        });
    };
    const progressLines = [...logLines, ...pluginLog];
    const progressText = progressLines.join("\n");

    useEffect(() => {
        if (!followProgressRef.current) return;
        const frame = window.requestAnimationFrame(() => {
            const progress = progressRef.current;
            if (progress) progress.scrollTop = progress.scrollHeight;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [progressText]);

    return (
        <div className="mfx-screen">
            <div className="page-scroll updates-page" data-mfx-sync-scroll="settings-updates">
                <div className="updates-layout">
                <section className="panel stack updates-card updates-pimfx-card">
                    <h2>PI-MFX UPDATE</h2>
                    <div className="updates-pimfx-body">
                        <div className="updates-version-grid">
                            <span>Version</span>
                            <strong>{version}</strong>
                            <span>Installed</span>
                            <strong>{installedCommit || "Unknown"}</strong>
                            {latestCommit && (
                                <>
                                    <span>Latest on {effectiveBranch}</span>
                                    <strong>{latestCommit}</strong>
                                </>
                            )}
                            {currentBranch && (
                                <>
                                    <span>This Pi</span>
                                    <strong>{currentBranch}</strong>
                                </>
                            )}
                        </div>
                        <div className="updates-channel-actions">
                            {(["dev", "main"] as const).map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    className={`btn ${effectiveBranch === item ? "btn-active" : ""}`}
                                    disabled={checking || installing || fetching}
                                    onClick={() => chooseBranch(item)}
                                >
                                    {item === "dev" ? "DEV (LATEST)" : "MAIN (RELEASE)"}
                                </button>
                            ))}
                            <button
                                type="button"
                                className="btn"
                                disabled={checking || installing || fetching}
                                onClick={() => void check(true)}
                            >
                                {checking || fetching ? "CHECKING..." : "CHECK FOR UPDATES"}
                            </button>
                        </div>
                    </div>
                    <div className="updates-status">
                        {(checking || fetching) && "Checking for updates…"}
                        {!checking && !fetching && installing && (str(status.message) || "Installing the update…")}
                        {!checking && !fetching && !installing && switching && `This Pi is on ${currentBranch}. Update to switch to ${effectiveBranch}.`}
                        {!checking && !fetching && !installing && !switching && updateAvailable && `Commit ${latestCommit} is available on ${effectiveBranch}.`}
                        {!checking && !fetching && !installing && upToDate
                            && `Pi-MFX is all up to date on ${effectiveBranch} (${latestCommit}).`}
                        {!checking && !fetching && !installing && str(status.jobState) === "failed" && str(status.message)}
                        {!checking && !fetching && !installing && str(status.error) && str(status.error)}
                        {!checking && !fetching && !installing && !updateAvailable && !upToDate && !switching && !str(status.error)
                            && (str(status.message) || "Could not determine update status.")}
                    </div>
                    {(updateAvailable || switching) && (
                        <button
                            type="button"
                            className="btn btn-accent updates-install-action"
                            disabled={checking || installing || fetching}
                            onClick={() => showInstallConfirmation(true)}
                        >
                            {installing ? "UPDATING..." : `UPDATE TO ${latestCommit || effectiveBranch.toUpperCase()}`}
                        </button>
                    )}
                    {message && <div className="muted">{message}</div>}
                    <details className="updates-recovery">
                        <summary>COMMAND-LINE RECOVERY</summary>
                        <div className="muted">
                            {helperMissing
                                ? "The updater cannot see the Pi-MFX clone yet. From the clone, run this once:"
                                : "If an update cannot be started from this screen, update from the Pi-MFX clone:"}
                        </div>
                        <pre className="updates-command">{`sudo bash ./scripts/pimfx.sh update --branch ${normalizeBranch(effectiveBranch)}`}</pre>
                        <div className="muted">{CLI_COMMAND.replace("dev", "main")} for release.</div>
                    </details>
                </section>
                <section className="panel stack updates-card">
                    <h2>LV2 PLUGIN UPDATES</h2>
                    <div className="updates-status">
                        {pluginChecking
                            ? "Checking installed LV2 plugins…"
                            : pluginInstalling
                                ? "Updating LV2 plugins…"
                                : pluginError
                                    ? `Plugin check failed: ${pluginError}`
                                    : pluginUpdateCount > 0
                                        ? `${pluginUpdateCount} LV2 plugin update${pluginUpdateCount === 1 ? " is" : "s are"} available.`
                                        : "Installed LV2 plugins are up to date."}
                    </div>
                    <div className="updates-plugin-list">
                        {pluginItems.map((item) => (
                            <div className="updates-plugin-row" key={`${str(item.source)}-${String(item.id ?? "")}`}>
                                <span>{str(item.title, "LV2 plugin")}</span>
                                <strong className={str(item.error) || bool(item.updateAvailable) ? "warning" : "muted"}>
                                    {str(item.error) ? "ERROR" : bool(item.updateAvailable) ? (bool(item.versionUnknown) ? "REFRESH" : "UPDATE") : "CURRENT"}
                                </strong>
                            </div>
                        ))}
                    </div>
                    <div className="row updates-actions">
                        <button type="button" className="btn" disabled={pluginChecking || pluginInstalling}
                            onClick={() => void refreshPluginUpdates(true)}>
                            {pluginChecking ? "CHECKING…" : "CHECK LV2"}
                        </button>
                        <button type="button" className="btn btn-accent"
                            disabled={pluginChecking || pluginInstalling || pluginUpdateCount <= 0}
                            onClick={() => setConfirmPluginInstall(true)}>
                            {pluginInstalling ? "UPDATING…" : `UPDATE LV2 PLUGINS${pluginUpdateCount > 0 ? ` (${pluginUpdateCount})` : ""}`}
                        </button>
                    </div>
                </section>
                </div>
                {progressLines.length > 0 && (
                    <pre ref={progressRef} className="updates-progress" aria-live="polite"
                        onScroll={(event) => {
                            const console = event.currentTarget;
                            followProgressRef.current = console.scrollHeight - console.scrollTop - console.clientHeight <= 12;
                        }}>
                        {progressText}
                    </pre>
                )}
            </div>
            {confirmInstall && (
                <ConfirmDialog
                    title={`UPDATE ${effectiveBranch.toUpperCase()}?`}
                    body={`The update takes several minutes. Audio stops during the rebuild, and the Pi-MFX service restarts when it finishes.${unsavedPresetCount > 0 ? ` ${unsavedPresetCount} preset${unsavedPresetCount === 1 ? " has" : "s have"} unsaved live changes that will be lost.` : ""}`}
                    confirmLabel="UPDATE"
                    danger
                    onCancel={() => showInstallConfirmation(false)}
                    onConfirm={install}
                />
            )}
            {confirmPluginInstall && (
                <ConfirmDialog
                    title="UPDATE LV2 PLUGINS?"
                    body={`Update ${pluginUpdateCount} installed LV2 plugin${pluginUpdateCount === 1 ? "" : "s"}? Downloads and installation run at low priority; the plugin catalog is rescanned as each source finishes.`}
                    confirmLabel="UPDATE LV2"
                    danger
                    onCancel={() => setConfirmPluginInstall(false)}
                    onConfirm={installPluginUpdates}
                />
            )}
        </div>
    );
}
