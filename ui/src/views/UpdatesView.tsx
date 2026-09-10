import { useCallback, useEffect, useState } from "react";
import type { EngineSnapshot } from "../api";
import { bool, obj, str } from "../json";
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
    const [branch, setBranch] = useState("dev");
    const [checking, setChecking] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [confirmInstall, setConfirmInstall] = useState(false);
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

    const fetching = bool(status.fetching);

    const check = useCallback(async (fetchLatest = true) => {
        setChecking(true);
        setMessage("");
        try {
            const next = obj(await engine.client.request("system/update/status", {
                fetch: fetchLatest,
                branch
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
    }, [branch, engine.client]);

    useEffect(() => {
        void check(true);
    }, [check]);

    useEffect(() => {
        if (!installing && !fetching) {
            return;
        }
        let stopped = false;
        const poll = async () => {
            try {
                const next = obj(await engine.client.request("system/update/status", { fetch: false, branch }));
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
    }, [branch, engine.client, installing, fetching]);

    const installedCommit = str(status.installedCommit, gitSha);
    const latestCommit = str(status.latestCommit);
    const updateAvailable = bool(status.updateAvailable);
    const helperMissing = str(status.error).includes("not configured")
        || str(message).includes("helper")
        || str(status.error).toLowerCase().includes("helper")
        || str(message).includes("not configured");
    const logLines = str(status.log).split(/\r?\n/).filter(Boolean);
    const currentBranch = str(status.branch);
    const switching = Boolean(currentBranch) && currentBranch !== branch;
    const upToDate = bool(status.ok, true)
        && Boolean(installedCommit)
        && Boolean(latestCommit)
        && !updateAvailable
        && !switching
        && str(status.jobState, "idle") === "idle"
        && !str(status.error);

    const install = () => {
        setConfirmInstall(false);
        setInstalling(true);
        setMessage("Starting update…");
        void run(async () => {
            try {
                const next = obj(await engine.client.request("system/update/install", { branch }));
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
                                <span>Latest on {branch}</span>
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
                    <div className="row" style={{ flexWrap: "wrap" }}>
                        {(["dev", "main"] as const).map((item) => (
                            <button
                                key={item}
                                type="button"
                                className={`btn ${branch === item ? "btn-active" : ""}`}
                                disabled={checking || installing || fetching}
                                onClick={() => setBranch(item)}
                            >
                                {item === "dev" ? "DEV (LATEST)" : "MAIN (RELEASE)"}
                            </button>
                        ))}
                    </div>
                    <div className="muted">
                        Dev tracks day-to-day work. Main is the release branch.
                    </div>
                    <div className="updates-status">
                        {(checking || fetching) && "Checking for updates…"}
                        {!checking && !fetching && installing && (str(status.message) || "Installing the update…")}
                        {!checking && !fetching && !installing && switching && `This Pi is on ${currentBranch}. Update to switch to ${branch}.`}
                        {!checking && !fetching && !installing && !switching && updateAvailable && `Commit ${latestCommit} is available on ${branch}.`}
                        {!checking && !fetching && !installing && upToDate && `Pi-MFX is up to date on ${branch}.`}
                        {!checking && !fetching && !installing && str(status.jobState) === "failed" && str(status.message)}
                        {!checking && !fetching && !installing && str(status.error) && str(status.error)}
                        {!checking && !fetching && !installing && !updateAvailable && !upToDate && !switching && !str(status.error)
                            && (str(status.message) || "Could not determine update status.")}
                    </div>
                    {logLines.length > 0 && (
                        <pre className="updates-progress">{logLines.join("\n")}</pre>
                    )}
                    <div className="updates-warning">
                        An update rebuilds the engine and UI in the background so the controller stays live,
                        then restarts the Pi-MFX service at the end. Audio drops only for that restart.
                    </div>
                    <div className="row" style={{ flexWrap: "wrap" }}>
                        <button
                            type="button"
                            className="btn"
                            disabled={checking || installing || fetching}
                            onClick={() => void check(true)}
                        >
                            {checking || fetching ? "CHECKING..." : "CHECK FOR UPDATES"}
                        </button>
                        {(updateAvailable || switching) && (
                            <button
                                type="button"
                                className="btn btn-accent"
                                disabled={checking || installing || fetching}
                                onClick={() => setConfirmInstall(true)}
                            >
                                {installing ? "UPDATING..." : `UPDATE ${branch.toUpperCase()}`}
                            </button>
                        )}
                    </div>
                    {message && <div className="muted">{message}</div>}
                </section>
                <section className="panel stack">
                    <h2>COMMAND-LINE RECOVERY</h2>
                    <div className="muted">
                        {helperMissing
                            ? "The updater cannot see the Pi-MFX clone yet. From the clone, run this once, then this page can update itself:"
                            : "If an update cannot be started from this screen, update from the Pi-MFX clone:"}
                    </div>
                    <pre className="updates-command">{`sudo bash ./scripts/pimfx.sh update --branch ${normalizeBranch(branch)}`}</pre>
                    <div className="muted">{CLI_COMMAND.replace("dev", "main")} for release.</div>
                </section>
            </div>
            {confirmInstall && (
                <ConfirmDialog
                    title={`UPDATE ${branch.toUpperCase()}?`}
                    body="Audio stops while the engine rebuilds. This takes several minutes, restarts the Pi-MFX service, and discards local source edits on this Pi. Banks stay in /var/lib/pimfx."
                    confirmLabel="UPDATE"
                    danger
                    onCancel={() => setConfirmInstall(false)}
                    onConfirm={install}
                />
            )}
        </div>
    );
}
