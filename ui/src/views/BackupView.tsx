import { useEffect, useRef, useState } from "react";
import type { EngineClient, EngineSnapshot } from "../api";
import { bool, num, obj, objects, str, type JsonObject } from "../json";
import { isKioskDisplay } from "../keyboard/mode";
import { ConfirmDialog } from "./ConfirmDialog";
import { LibraryFileImport, LibraryJsonPicker } from "./LibraryManager";
import "../recovery.css";

const JOB_KEY = "pimfx-recovery-job";
const DOWNLOAD_KEY = "pimfx-backup-download-started";
type SaveHandle = { name: string; createWritable: () => Promise<WritableStream<Uint8Array>> };
type SavePicker = (options: { suggestedName: string }) => Promise<SaveHandle>;
const savePicker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
async function request(action: string, payload: JsonObject = {}): Promise<JsonObject> {
    const response = await fetch(`/api/backup/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    const value = obj(await response.json());
    if (!response.ok || value.ok === false) throw new Error(str(value.error, "Recovery request failed"));
    return value;
}
function size(bytes: number): string {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.ceil(bytes / 1024)} KB`;
}
function pluginRecoveryNote(value: JsonObject): string {
    const online = num(value.onlinePackages);
    return online > 0
        ? `${online} plugin or dependency packages will be downloaded during restore (up to ${size(num(value.downloadBytes))}). Internet access and the recorded versions must remain available. Manual plugins and ${num(value.bundledPackages)} other packages are included in the archive.`
        : "Plugin files and installers are included in the archive; no plugin downloads are recorded.";
}

export function BackupView({ engine, embedded = false }: {
    engine: EngineSnapshot & { client: EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    embedded?: boolean;
}) {
    const [options, setOptions] = useState<JsonObject>({});
    const [job, setJob] = useState<JsonObject>({});
    const [jobId, setJobId] = useState(() => window.sessionStorage.getItem(JOB_KEY) ?? "");
    const [tab, setTab] = useState<"backup" | "restore">("backup");
    const [full, setFull] = useState(true);
    const [pluginMode, setPluginMode] = useState("online");
    const [selected, setSelected] = useState<string[]>([]);
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [device, setDevice] = useState("");
    const [preview, setPreview] = useState<JsonObject | null>(null);
    const [source, setSource] = useState("");
    const [conflicts, setConflicts] = useState("replace");
    const [confirmation, setConfirmation] = useState<"backup" | "restore" | "rollback" | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [working, setWorking] = useState(false);
    const [legacy, setLegacy] = useState(false);
    const [usbFiles, setUsbFiles] = useState<JsonObject[]>([]);
    const [fileGroup, setFileGroup] = useState("");
    const [files, setFiles] = useState<JsonObject[]>([]);
    const [picked, setPicked] = useState<string[]>([]);
    const [page, setPage] = useState(0);
    const [totalFiles, setTotalFiles] = useState(0);
    const seenPreview = useRef("");
    const saveHandle = useRef<SaveHandle | null>(null);
    const exporting = useRef("");
    const autoDownload = useRef("");
    const [downloadStartedFor, setDownloadStartedFor] = useState(() => window.sessionStorage.getItem(DOWNLOAD_KEY) ?? "");
    const [exportAttempt, setExportAttempt] = useState(0);
    const kiosk = isKioskDisplay();
    const categories = preview ? objects(preview.categories) : objects(options.categories);
    const availableCategories = categories.filter((item) => !preview || preview.compatible !== false || !["plugins", "settings", "connections", "installation"].includes(str(item.id)));
    const busy = working || str(job.state) === "running" || str(job.state) === "queued";
    const operation = async (work: () => Promise<void>) => {
        setWorking(true); setError(""); setNotice("");
        try { await work(); } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
        finally { setWorking(false); }
    };
    const remember = (id: string) => {
        window.sessionStorage.setItem(JOB_KEY, id);
        setJobId(id); setJob({ id, state: "queued", message: "Recovery job queued" });
    };
    const refresh = async () => { setOptions(await request("options")); };
    useEffect(() => { void refresh().catch((caught: unknown) => setError(String(caught))); }, []);
    useEffect(() => {
        let disposed = false;
        const poll = async () => {
            try {
                const response = await request("status", jobId ? { id: jobId } : {});
                if (disposed) return;
                const next = obj(response.job); setJob(next);
                if (next.state === "complete" && next.action === "inspect" && seenPreview.current !== str(next.id)) {
                    seenPreview.current = str(next.id);
                    const result = obj(next.result);
                    setPreview(result); setSource(str(next.id)); setTab("restore");
                    const ids = objects(result.categories).map((item) => str(item.id));
                    setSelected(result.compatible === false ? ids.filter((id) => !["plugins", "settings", "connections", "installation"].includes(id)) : ids);
                    setFull(result.compatible !== false && ids.length === objects(options.categories).length && ids.length > 0);
                    setPicked([]); setFiles([]); setFileGroup("");
                }
            } catch { /* The supervised job continues while the engine is stopped. */ }
        };
        void poll();
        const timer = window.setInterval(() => { void poll(); }, 2000);
        return () => { disposed = true; window.clearInterval(timer); };
    }, [jobId, options.categories]);
    useEffect(() => {
        if (!source || !fileGroup) return;
        void request("files", { id: source, category: fileGroup, offset: page * 100 }).then((result) => {
            setFiles(objects(result.files)); setTotalFiles(num(result.total));
        }).catch((caught: unknown) => setError(String(caught)));
    }, [source, fileGroup, page]);
    const toggle = (id: string) => {
        setFull(false);
        setSelected((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]);
    };
    const startBackup = () => void operation(async () => {
        const groups = full ? objects(options.categories).map((item) => str(item.id)) : selected;
        if (!groups.length) throw new Error("Choose at least one backup category.");
        if (groups.some((c) => ["connections", "plugins", "other"].includes(c)) && password.length < 8) throw new Error("Use a backup password of at least 8 characters to include accounts, installed packages or other persistent files.");
        if (password !== confirmPassword) throw new Error("The backup passwords do not match.");
        if (kiosk && !device) throw new Error("Choose a USB drive so the backup leaves this Pi.");
        saveHandle.current = null;
        if (!device && savePicker) {
            try {
                saveHandle.current = await savePicker.call(window, { suggestedName: `Pi-MFX-${new Date().toISOString().slice(0, 10)}.pimfx-backup` });
            } catch (caught) {
                if (caught instanceof DOMException && caught.name === "AbortError") return;
                throw caught;
            }
        }
        const id = str((await request("create", { categories: groups, password, device, pluginMode })).id);
        autoDownload.current = !device && !savePicker ? id : "";
        remember(id);
        setPassword(""); setConfirmPassword("");
    });
    const importFile = (file: File) => void operation(async () => {
        setPreview(null); setFiles([]); setPicked([]);
        if (file.name.toLowerCase().endsWith(".json")) {
            if (file.size > 16 * 1024 * 1024) throw new Error("This legacy configuration file is too large.");
            remember(str((await request("legacy", { contents: JSON.parse(await file.text()) as JsonObject })).id));
            return;
        }
        const id = str((await request("upload-begin", { bytes: file.size })).id);
        for (let offset = 0; offset < file.size; offset += 512 * 1024) {
            setNotice(`Importing backup: ${Math.floor(offset / file.size * 100)}%`);
            const response = await fetch("/api/backup/upload/chunk", {
                method: "POST", headers: { "Content-Type": "application/octet-stream", "X-PiMFX-Job": id, "X-PiMFX-Offset": String(offset) },
                body: file.slice(offset, offset + 512 * 1024)
            });
            const result = obj(await response.json());
            if (!response.ok || result.ok === false) throw new Error(str(result.error, "Backup import was interrupted. Import the file again."));
        }
        remember(str((await request("inspect", { id, password })).id)); setPassword(""); setNotice("");
    });
    const startRestore = () => void operation(async () => {
        if (!preview || !selected.length) throw new Error("Choose what to restore.");
        remember(str((await request("restore", { source, categories: selected, full, conflicts: full ? "replace" : conflicts, trusted: true, files: full ? [] : picked })).id));
        setPreview(null); setSource("");
    });
    const browseUsb = () => void operation(async () => {
        if (!device) throw new Error("Choose a USB drive first.");
        setUsbFiles(objects((await request("usb-files", { device })).files));
    });
    const chooseTab = (next: "backup" | "restore") => {
        setTab(next); setPreview(null); setPassword(""); setConfirmPassword(""); setSelected([]); setFull(true); setError(""); setPicked([]);
    };
    const result = obj(job.result);
    const finishedBackup = job.state === "complete" && job.action === "create";
    const downloadUrl = (id: string) => `/api/backup/download?id=${encodeURIComponent(id)}`;
    const noteDownload = (id: string) => {
        window.sessionStorage.setItem(DOWNLOAD_KEY, id);
        setDownloadStartedFor(id);
        setError("");
        setNotice("Download requested. Your browser chooses the save location or uses its Downloads folder. Wait for it to finish, then check the saved file before confirming below. The Pi's temporary copy is still retained.");
    };
    const completeExport = async (id: string, destination: string) => {
        await request("exported", { id, destination });
        window.sessionStorage.removeItem(DOWNLOAD_KEY);
        setDownloadStartedFor("");
        setJob((previous) => str(previous.id) === id ? { ...previous,
            message: "Backup saved off the Pi; temporary archive removed",
            result: { ...obj(previous.result), exported: true, destination } } : previous);
    };
    const statistics = [
        typeof result.fileCount === "number" && Number.isFinite(result.fileCount) && result.fileCount >= 0 ? `${result.fileCount} files` : "",
        typeof result.elapsedSeconds === "number" && Number.isFinite(result.elapsedSeconds) && result.elapsedSeconds >= 0 ? `${result.elapsedSeconds} seconds` : ""
    ].filter(Boolean).join(" · ");
    useEffect(() => {
        const id = str(job.id);
        if (!finishedBackup || bool(result.exported) || kiosk || !id || exporting.current === id) return;
        if (!saveHandle.current) {
            // Only auto-download jobs started by this page. Existing archives
            // remain available through the explicit download link below.
            if (autoDownload.current === id) {
                autoDownload.current = "";
                const link = document.createElement("a");
                link.href = downloadUrl(id); link.download = str(result.name);
                document.body.appendChild(link); link.click(); link.remove();
                noteDownload(id);
            }
            return;
        }
        exporting.current = id;
        const handle = saveHandle.current;
        void operation(async () => {
            setNotice(`Saving backup to ${handle.name}…`);
            const response = await fetch(downloadUrl(id));
            if (!response.ok || !response.body) throw new Error("Backup transfer failed. The Pi still has the temporary archive; choose a save location to retry.");
            const writable = await handle.createWritable();
            await response.body.pipeTo(writable);
            // Closing the writable must succeed before the Pi can delete its copy.
            await completeExport(id, handle.name);
            saveHandle.current = null;
            setNotice(`Backup saved to ${handle.name}. Temporary archive removed from the Pi.`);
        });
    }, [job.id, finishedBackup, result.exported, exportAttempt, kiosk]);
    const retryExport = () => void operation(async () => {
        if (!savePicker) throw new Error("Use a browser with a save picker over a secure connection, or create a new backup to USB.");
        saveHandle.current = await savePicker.call(window, { suggestedName: str(result.name) });
        exporting.current = "";
        setExportAttempt((value) => value + 1);
        setNotice("Save location selected. Transferring backup…");
    });
    return <div className={embedded ? "stack recovery-view" : "page-scroll stack recovery-view"} data-mfx-sync-scroll="settings-backup">
        <section className="panel stack">
            <h2>BACKUP &amp; RESTORE</h2>
            <div className="muted">Export a compressed backup of your complete Pi-MFX rig, then restore it after installing Pi-MFX on a fresh OS. Audio pauses while a consistent copy is taken or a restore is applied.</div>
            <div className="row" style={{ flexWrap: "wrap" }}>
                <button className={`btn ${tab === "backup" ? "btn-accent" : ""}`} disabled={busy} onClick={() => chooseTab("backup")}>BACK UP</button>
                <button className={`btn ${tab === "restore" ? "btn-accent" : ""}`} disabled={busy} onClick={() => chooseTab("restore")}>RESTORE</button>
            </div>
            {busy && <div role="status" className="stack"><strong>{working ? notice || "Preparing recovery operation" : str(job.message, "Preparing recovery operation")}</strong><progress aria-label="Recovery operation in progress" />
                {!engine.connected && <span className="muted">Audio engine paused. This job continues independently; this screen will reconnect.</span>}
            </div>}
            {notice && <div role="status">{notice}</div>}
            {error && <div role="alert" className="danger">{error}</div>}
            {job.state === "failed" && <div role="alert" className="danger">{str(job.error, str(job.message))}</div>}
            {(job.state === "failed" || job.state === "attention") && job.action === "restore" && str(job.source) && <button className="btn" onClick={() => {
                seenPreview.current = ""; setPreview(null); remember(str(job.source));
            }}>REVIEW VERIFIED BACKUP AGAIN</button>}
            {(job.state === "complete" || job.state === "attention") && job.action === "restore" && <div role="status" className="stack"><strong>{str(job.message)}</strong><span className={job.state === "attention" ? "danger" : "muted"}>{str(result.note)}</span>
                {bool(result.rebootRecommended) && <span>Reboot after reviewing the restored audio and connection settings.</span>}
                {bool(result.rollbackAvailable) && <button className="btn" onClick={() => setConfirmation("rollback")}>ROLL BACK PI-MFX DATA</button>}
            </div>}
            {job.state === "complete" && job.action === "rollback" && <div role="status"><strong>{str(job.message)}</strong><p className="muted">{str(result.note)}</p></div>}
            {finishedBackup && <div className="stack" role="status"><strong>{bool(result.exported) ? str(job.message) : "Backup archive ready — export pending"}</strong><span>{str(result.name)} · {size(num(result.bytes))}</span>
                {Array.isArray(result.categories) && result.categories.includes("plugins") && <span className="muted">{pluginRecoveryNote(result)}</span>}
                {bool(result.exported) ? <span>Saved off the Pi: {str(result.destination)}. Temporary archive removed.</span>
                    : !working && <><span>Keep the Pi's temporary copy until the backup has finished saving on another computer or drive.</span>
                        {!kiosk && <>
                            {savePicker && <button className="btn" onClick={retryExport}>CHOOSE SAVE LOCATION TO RESUME</button>}
                            <a className="btn btn-accent" href={downloadUrl(str(job.id))} download={str(result.name)} onClick={() => noteDownload(str(job.id))}>
                                {downloadStartedFor === str(job.id) ? "DOWNLOAD AGAIN" : "DOWNLOAD BACKUP"}
                            </a>
                            {downloadStartedFor === str(job.id) && <>
                                <span>Check your browser's downloads and confirm that “{str(result.name)}” ({size(num(result.bytes))}) is saved off the Pi. Confirming removes only the temporary archive on the Pi.</span>
                                <button className="btn" onClick={() => void operation(async () => {
                                    await completeExport(str(job.id), "Browser download — saved file confirmed by user");
                                    setNotice("Saved backup confirmed. The temporary archive has been removed from the Pi.");
                                })}>I HAVE CHECKED THE SAVED BACKUP</button>
                            </>}
                            <span className="muted">Your browser may ask where to save or use its Downloads folder. If an automatic download was blocked, use Download Backup. A requested download is not proof that the file finished saving.</span>
                        </>}
                    </>}
                {statistics && <span className="muted">{statistics}</span>}
                <span className="muted">{bool(result.encrypted) ? "Password encrypted" : "Unencrypted"} · {Array.isArray(result.categories) ? result.categories.map((id) => str(objects(options.categories).find((item) => item.id === id)?.label, String(id))).join(", ") : ""}</span>
                <span className="muted recovery-checksum">SHA-256: {str(result.sha256)}</span>
            </div>}
        </section>
        {!busy && <>
            <section className="panel stack">
                <label className="field"><span>{tab === "backup" ? "Export destination" : "USB drive"}</span><select value={device} onChange={(event) => { setDevice(event.target.value); setUsbFiles([]); }}>
                    {!kiosk && <option value="">{tab === "backup" ? (savePicker ? "Choose a save location on this computer / tablet" : "Download to this computer / tablet") : "Import from this computer / tablet"}</option>}
                    {kiosk && <option value="">Choose a mounted USB drive</option>}
                    {objects(options.devices).map((item) => <option key={str(item.id)} value={str(item.id)}>{str(item.name)} · {size(num(item.freeBytes))} free</option>)}
                </select></label>
                {tab === "backup" && !device && !kiosk && !savePicker && <div className="muted">The backup will download in this browser when ready. To be asked for a folder, enable your browser's “Ask where to save each file” setting before starting. Otherwise it uses your Downloads folder. Confirm the saved file afterwards so Pi-MFX can remove its temporary copy.</div>}
                <button className="btn" onClick={() => void operation(refresh)}>REFRESH USB DRIVES</button>
                <label className="field"><span>{tab === "backup" ? "Backup password" : "Backup password, if encrypted"}</span><input type="password" autoComplete="new-password" maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
                {tab === "backup" && <><label className="field"><span>Confirm backup password</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
                    <div className="muted">A full backup includes credentials and requires a password. Keep the password with your recovery records; it cannot be recovered from the archive.</div></>}
            </section>
            {tab === "restore" && !preview && <section className="panel stack"><h3>CHOOSE A BACKUP</h3><div className="row" style={{ flexWrap: "wrap" }}>
                {!kiosk && <LibraryFileImport accept=".pimfx-backup,.json" label="IMPORT BACKUP FILE" onFile={importFile} />}
                <button className="btn" disabled={!device} onClick={browseUsb}>BROWSE USB BACKUPS</button>
                <button className="btn" onClick={() => setLegacy(true)}>OLD CONFIGURATION BACKUP</button>
            </div>
                {usbFiles.map((file) => <button key={str(file.id)} className="btn" onClick={() => void operation(async () => { remember(str((await request("import-usb", { device, file: str(file.id), password })).id)); setPassword(""); })}>{str(file.name)} · {size(num(file.bytes))}</button>)}
                <div className="muted">Import only a backup you trust. Plugin backups include executable software and installation packages.</div>
            </section>}
            {(tab === "backup" || preview) && <section className="panel stack"><div className="row" style={{ flexWrap: "wrap" }}>
                <button className={`btn ${full ? "btn-accent" : ""}`} disabled={!!preview && (preview.compatible === false || objects(preview.categories).length !== objects(options.categories).length)}
                    onClick={() => { setFull(true); setSelected(categories.map((item) => str(item.id))); setPicked([]); }}>{tab === "backup" ? "FULL BACKUP" : "RESTORE EVERYTHING"}</button>
                <button className={`btn ${!full ? "btn-accent" : ""}`} onClick={() => { setFull(false); setSelected(availableCategories.map((item) => str(item.id))); }}>CHOOSE CONTENT</button>
            </div>
                {!full && <div className="row">
                    <button className="btn" onClick={() => setSelected(availableCategories.map((item) => str(item.id)))}>SELECT ALL AVAILABLE</button>
                    <button className="btn" onClick={() => { setSelected([]); setPicked([]); setFileGroup(""); setFiles([]); }}>CLEAR SELECTION</button>
                </div>}
                {preview && <><div>{str(preview.createdAt)} · {num(preview.fileCount)} files · Pi-MFX {str(obj(preview.application).version, "unknown version")}</div>{str(preview.warning) && <div className="danger">{str(preview.warning)}</div>}</>}
                <div className="recovery-categories">{categories.map((item) => <label key={str(item.id)} className="recovery-category"><input type="checkbox" checked={full || selected.includes(str(item.id))} disabled={full || (!!preview && preview.compatible === false && ["plugins", "settings", "connections", "installation"].includes(str(item.id)))} onChange={() => toggle(str(item.id))} />
                    <span>{str(item.label)}{preview && <small>{num(item.count)} files · {size(num(item.bytes))}</small>}</span></label>)}</div>
                {tab === "backup" && (full || selected.includes("plugins")) && <>
                    <label className="field"><span>Plugin recovery</span><select value={pluginMode} onChange={(event) => setPluginMode(event.target.value)}>
                        <option value="online">Smaller backup — reinstall downloadable plugins</option>
                        <option value="self-contained">Self-contained backup — include plugin installers</option>
                    </select></label>
                    <div className="muted">{pluginMode === "online"
                        ? "Saves exact versions and download records instead of repository installers. Restore needs internet access and those versions must still be available. Manual plugins and packages without a download record stay included so they are not lost."
                        : "Includes plugin files and installers for restoration without plugin downloads. Uses more space and is the safest choice for long-term recovery."}</div>
                </>}
                {preview && selected.includes("plugins") && <div className="muted">{pluginRecoveryNote(preview)}</div>}
                {preview && !full && <>
                    {selected.includes("banks") && <div className="muted">Include Models, IRs and Plugins to restore the sounds used by these presets. Required missing files will be reported before applying the restore.</div>}
                    <label className="field"><span>Existing content</span><select value={conflicts} onChange={(event) => setConflicts(event.target.value)}><option value="replace">Replace selected content</option><option value="keep">Keep existing files</option><option value="copy">Import as copies where possible</option></select></label>
                    <label className="field"><span>Optional: select individual files</span><select value={fileGroup} onChange={(event) => { setFileGroup(event.target.value); setPage(0); setFiles([]); if (!event.target.value) setPicked([]); }}><option value="">All files in selected categories</option>
                        {categories.filter((item) => selected.includes(str(item.id)) && !["plugins", "settings", "connections"].includes(str(item.id))).map((item) => <option key={str(item.id)} value={str(item.id)}>{str(item.label)}</option>)}
                    </select></label>
                    {fileGroup && <div className="recovery-file-list"><div className="muted">{picked.length ? `${picked.length} individual files selected. Selected Models, IRs and Plugins are included as dependencies.` : "No individual selection: all files in selected categories will be restored."}</div>
                        {files.map((file) => <label key={str(file.path)} className="recovery-category"><input type="checkbox" checked={picked.includes(str(file.path))} onChange={() => setPicked((previous) => previous.includes(str(file.path)) ? previous.filter((p) => p !== str(file.path)) : [...previous, str(file.path)])} /><span>{str(file.label, str(file.path).replace(/^data\//, ""))}<small>{size(num(file.bytes))}</small></span></label>)}
                        <div className="row"><button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>PREVIOUS</button><span>{page * 100 + 1}–{Math.min((page + 1) * 100, totalFiles)} / {totalFiles}</span><button className="btn" disabled={(page + 1) * 100 >= totalFiles} onClick={() => setPage(page + 1)}>NEXT</button></div>
                        <button className="btn" onClick={() => setPicked([])}>CLEAR INDIVIDUAL SELECTION</button>
                    </div>}
                </>}
                <button className={`btn ${tab === "backup" ? "btn-accent" : "btn-danger"}`} disabled={(!full && !selected.length) || (tab === "restore" && !preview)} onClick={() => setConfirmation(tab === "backup" ? "backup" : "restore")}>{tab === "backup" ? (device ? "EXPORT BACKUP TO USB" : "PREPARE BACKUP DOWNLOAD") : "REVIEW & RESTORE"}</button>
            </section>}
        </>}
        {confirmation && <ConfirmDialog title={confirmation === "backup" ? "CREATE RECOVERY BACKUP?" : confirmation === "rollback" ? "ROLL BACK PI-MFX DATA?" : "RESTORE TRUSTED BACKUP?"}
            body={confirmation === "backup" ? `Audio pauses while Pi-MFX takes a consistent copy. Unsaved preset edits are captured separately; an active loop is saved as ‘Backup current loop’. Finish recording and downloads first. Export the archive off this Pi to complete your backup.${(full || selected.includes("plugins")) && pluginMode === "online" ? " This smaller backup requires internet access and the recorded plugin versions to remain available for restore." : ""}`
                : confirmation === "rollback" ? "Recover Pi-MFX data from before the last restore. Changes made since that restore will be set aside. Plugin package and OS installation changes remain. Audio pauses during recovery."
                : `${full ? "This replaces your complete Pi-MFX rig." : `This restores selected content using ‘${conflicts}’ for conflicts.`} ${preview && selected.includes("plugins") && num(preview.onlinePackages) > 0 ? "Required plugin downloads will be verified before replacing rig data. Internet access and the recorded versions must remain available. " : ""}Audio stops during restore. This backup must be trusted: plugin installation packages can run installation scripts. Current Pi-MFX data is retained for rollback; OS package changes may require separate recovery. Restoring connections can change the access password.`}
            confirmLabel={confirmation === "backup" ? "CREATE & EXPORT" : confirmation === "rollback" ? "ROLL BACK DATA" : "TRUST & RESTORE"} danger={confirmation !== "backup"} onCancel={() => setConfirmation(null)} onConfirm={() => { const action = confirmation; setConfirmation(null); if (action === "backup") startBackup(); else if (action === "restore") startRestore(); else void operation(async () => remember(str((await request("rollback")).id))); }} />}
        {legacy && <LibraryJsonPicker engine={engine} run={(work) => operation(async () => { await work(); })} kind="backup" mode="load" title="IMPORT OLD CONFIGURATION BACKUP" onClose={() => setLegacy(false)} onLoad={(contents) => {
            setLegacy(false); void operation(async () => remember(str((await request("legacy", { contents })).id)));
        }} />}
    </div>;
}
