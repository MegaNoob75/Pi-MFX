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

function firmwareVersionNumber(value: string): number | undefined {
    const match = /^(\d+)\.(\d+)$/.exec(value);
    if (!match || Number(match[1]) > 127 || Number(match[2]) > 127) return undefined;
    return Number(match[1]) * 128 + Number(match[2]);
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
    const [copyMessage, setCopyMessage] = useState("");
    const [firmware, setFirmware] = useState(obj({}));
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

    useEffect(() => {
        let stopped = false;
        const poll = async () => {
            try {
                const next = obj(await engine.client.request("controller/firmware/status", { branch: effectiveBranch }));
                if (!stopped) setFirmware(next);
            } catch (error) {
                if (!stopped) setFirmware({ state: "unavailable", message: error instanceof Error ? error.message : String(error) });
            }
        };
        void poll();
        const timer = window.setInterval(() => void poll(), POLL_MS);
        return () => { stopped = true; window.clearInterval(timer); };
    }, [engine.client, effectiveBranch]);
    const firmwareBusy = ["preparing", "building", "flashing", "verifying"].includes(str(firmware.state));
    const installedFirmware = str(obj(engine.state.controller).firmwareVersion, str(firmware.installedVersion, "Unknown"));
    const latestFirmware = str(firmware.latestVersion);
    const installedFirmwareNumber = firmwareVersionNumber(installedFirmware);
    const latestFirmwareNumber = firmwareVersionNumber(latestFirmware);
    const firmwareUpToDate = installedFirmwareNumber !== undefined && latestFirmwareNumber !== undefined
        && installedFirmwareNumber >= latestFirmwareNumber;
    const latestReady = str(firmware.latestBranch) === effectiveBranch && Boolean(str(firmware.latestCommit))
        && !str(firmware.latestError) && !bool(firmware.latestChecking);
    const checkFirmware = () => void run(async () => {
        setFirmware(obj(await engine.client.request("controller/firmware/status", { branch: effectiveBranch, refresh: true })));
    });
    const retryFirmware = () => {
        void run(async () => {
            const next = obj(await engine.client.request("controller/firmware/install", { branch: effectiveBranch }));
            setFirmware(next);
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
    // Firmware status retains its previous job's log. Keep it in the controller
    // card so old messages cannot appear after the current Pi-MFX build output.
    const progressLines = [...logLines, ...pluginLog];
    const progressText = progressLines.join("\n");

    const copyLog = async () => {
        try {
            if (navigator.clipboard?.writeText) {
                try {
                    await navigator.clipboard.writeText(progressText);
                    setCopyMessage("Log copied.");
                    return;
                } catch { /* Fall back for HTTP or denied clipboard access. */ }
            }
            const field = document.createElement("textarea");
            const focused = document.activeElement;
            const selection = window.getSelection();
            const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
            field.value = progressText;
            field.readOnly = true;
            field.style.cssText = "position:fixed;left:0;top:0;opacity:0;pointer-events:none";
            document.body.appendChild(field);
            try {
                field.focus({ preventScroll: true });
                field.select();
                if (!document.execCommand("copy")) throw new Error("Copy unavailable");
            } finally {
                field.remove();
                if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
                if (selection) {
                    selection.removeAllRanges();
                    for (const range of ranges) selection.addRange(range);
                }
            }
            setCopyMessage("Log copied.");
        } catch {
            setCopyMessage("Could not copy automatically. Select the log text and use Copy.");
        }
    };

    useEffect(() => {
        if (!copyMessage) return;
        const timer = window.setTimeout(() => setCopyMessage(""), 4000);
        return () => window.clearTimeout(timer);
    }, [copyMessage]);

    useEffect(() => {
        if (!followProgressRef.current) return;
        const frame = window.requestAnimationFrame(() => {
            const progress = progressRef.current;
            const selection = window.getSelection();
            if (progress && !(selection && !selection.isCollapsed && progress.contains(selection.anchorNode)))
                progress.scrollTop = progress.scrollHeight;
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
                            disabled={checking || installing || fetching || firmwareBusy}
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
                <section className="panel stack updates-card" style={{ gridColumn: "1 / -1" }}>
                    <h2>CONTROLLER FIRMWARE</h2>
                    <div className="muted">Latest firmware is checked on GitHub ({effectiveBranch}). Update the controller here without updating Pi-MFX. Keep it connected until verified.</div>
                    <div className="updates-version-grid">
                        <span>Installed</span><strong>{installedFirmware}</strong>
                        <span>Latest</span><strong>{str(firmware.latestBranch) !== effectiveBranch ? "Checking GitHub…"
                            : latestFirmware || (bool(firmware.latestChecking) ? "Checking GitHub…" : "Unavailable")}</strong>
                    </div>
                    {str(firmware.latestError) && <div className="danger" role="status">{str(firmware.latestError)}{latestFirmware ? ` Last checked version: ${latestFirmware}.` : ""}</div>}
                    <div className="updates-status" role="status">{firmwareBusy || ["failed", "pending", "bootstrap", "unavailable"].includes(str(firmware.state))
                        ? str(firmware.message) : bool(firmware.latestChecking) ? "Checking GitHub for controller firmware…"
                        : !latestReady ? "Check GitHub to find the latest installable firmware."
                        : firmwareUpToDate ? "Controller firmware is up to date."
                        : `Controller firmware ${latestFirmware} is available from GitHub.`}</div>
                    {str(firmware.state) === "flashing" && <progress max={100} value={num(firmware.progress)} aria-label="Controller firmware transfer" />}
                    {str(firmware.state) === "bootstrap" && <div className="muted">Older firmware needs one Arduino upload to enable MIDI updates. Use an OTA partition scheme; saved wiring is kept when NVS is retained.</div>}
                    <div className="row updates-actions">
                    <button type="button" className="btn" disabled={installing || firmwareBusy || bool(firmware.latestChecking)} onClick={checkFirmware}>CHECK GITHUB</button>
                    <button type="button" className="btn btn-accent" disabled={installing || firmwareBusy || !latestReady || firmwareUpToDate || str(firmware.state) === "unavailable"}
                        onClick={retryFirmware}>{str(firmware.state) === "preparing" ? "CHECKING CONTROLLER…"
                            : firmwareBusy ? "UPDATING CONTROLLER…" : latestReady && !firmwareUpToDate ? `UPDATE CONTROLLER TO ${latestFirmware}` : "UPDATE CONTROLLER FIRMWARE"}</button>
                    </div>
                    {str(firmware.log).trim() && <details>
                        <summary>{firmwareBusy ? "Controller update log" : "Last controller check / update log"}</summary>
                        <pre className="updates-progress" data-mfx-selectable="true" aria-label="Controller firmware log" tabIndex={0}>
                            {str(firmware.log)}
                        </pre>
                    </details>}
                </section>
                </div>
                {progressLines.length > 0 && (
                    <>
                    <div className="row updates-log-actions">
                        <button type="button" className="btn" onClick={() => void copyLog()}>COPY LOG</button>
                        <span className="muted" role="status">{copyMessage}</span>
                    </div>
                    <pre ref={progressRef} className="updates-progress" data-mfx-selectable="true" aria-label="Update log" tabIndex={0} aria-live="polite"
                        onScroll={(event) => {
                            const console = event.currentTarget;
                            followProgressRef.current = console.scrollHeight - console.scrollTop - console.clientHeight <= 12;
                        }}>
                        {progressText}
                    </pre>
                    </>
                )}
            </div>
            {confirmInstall && (
                <ConfirmDialog
                    title={`UPDATE ${effectiveBranch.toUpperCase()}?`}
                    body={`The update takes several minutes. Newer controller firmware is also built and flashed automatically; leave the controller connected and powered. If disconnected, its update waits until connection. Audio stops during the rebuild, and the Pi-MFX service restarts when it finishes.${unsavedPresetCount > 0 ? ` ${unsavedPresetCount} preset${unsavedPresetCount === 1 ? " has" : "s have"} unsaved live changes that will be lost.` : ""}`}
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
