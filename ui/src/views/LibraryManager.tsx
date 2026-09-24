import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { EngineSnapshot } from "../api";
import { num, obj, str, objects, type JsonObject } from "../json";
import { askText } from "../keyboard/ask";
import { updateUiSessionSection } from "../uiSession";

export type LibraryKind = "model" | "ir" | "aidax" | "plugin" | "layout" | "theme" | "backup" | "bank" | "backing" | "drumsample" | "drumkit";

const MODEL_DIR_KEY = "pimfx-t3k-model-dir";
const IR_DIR_KEY = "pimfx-t3k-ir-dir";
const AIDAX_DIR_KEY = "pimfx-t3k-aidax-dir";
const LONG_PRESS_MS = 550;

export function loadTone3000Dir(kind: LibraryKind): string {
    const key = kind === "ir" ? IR_DIR_KEY : kind === "aidax" ? AIDAX_DIR_KEY : MODEL_DIR_KEY;
    const stored = window.localStorage.getItem(key);
    return stored && stored !== "." ? stored : "TONE3000";
}

export function saveTone3000Dir(kind: LibraryKind, directory: string): void {
    const key = kind === "ir" ? IR_DIR_KEY : kind === "aidax" ? AIDAX_DIR_KEY : MODEL_DIR_KEY;
    window.localStorage.setItem(key, directory);
}

export function joinLibraryDir(parent: string, name: string): string {
    const leaf = name.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!leaf) {
        return parent;
    }
    return parent ? `${parent}/${leaf}` : leaf;
}

export function safeLibraryFolderName(name: string): string {
    const cleaned = name
        .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^\.+|\.+$/g, "")
        .trim();
    return cleaned.slice(0, 96).trim() || "TONE3000";
}

export function libraryRootLabel(kind: LibraryKind): string {
    if (kind === "drumsample") return "drums/samples";
    if (kind === "drumkit") return "drums/kits";
    if (kind === "ir") {
        return "irs";
    }
    if (kind === "aidax") {
        return "aidax";
    }
    if (kind === "plugin") {
        return "lv2";
    }
    if (kind === "layout") {
        return "layouts";
    }
    if (kind === "theme") {
        return "themes";
    }
    if (kind === "backup") {
        return "backups";
    }
    if (kind === "bank") {
        return "bank-exports";
    }
    if (kind === "backing") {
        return "backing-tracks";
    }
    return "models";
}

function readBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("could not read that file"));
        reader.onload = () => {
            const text = String(reader.result);
            const comma = text.indexOf(",");
            resolve(comma >= 0 ? text.slice(comma + 1) : text);
        };
        reader.readAsDataURL(file);
    });
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return "";
    }
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    return `${Math.round(bytes / 1024)} KB`;
}

type TreeNode = {
    name: string;
    relative: string;
    path: string;
    children: TreeNode[];
};

function parseTree(raw: JsonObject): TreeNode {
    return {
        name: str(raw.name),
        relative: str(raw.relative),
        path: str(raw.path),
        children: objects(raw.children).map(parseTree)
    };
}

export function LibraryConfirm({
    title,
    body,
    danger,
    onCancel,
    onConfirm
}: {
    title: string;
    body: string;
    danger?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <div className="dialog-backdrop" onClick={onCancel}>
            <div className="dialog" onClick={(event) => event.stopPropagation()}>
                <h2>{title}</h2>
                <div>{body}</div>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                    <button type="button" className="btn" onClick={onCancel}>CANCEL</button>
                    <button type="button" className={`btn ${danger ? "btn-danger" : "btn-accent"}`} onClick={onConfirm}>
                        {danger ? "DELETE" : "OK"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function FilesView({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    return (
        <div className="mfx-screen">
            <div className="mfx-screen-intro">
                <div className="mfx-screen-intro-title">FILES</div>
                <div className="mfx-screen-intro-sub">
                    NAM, AIDA-X and impulse responses
                </div>
            </div>
            <div className="page-scroll" style={{ flex: 1, minHeight: 0 }}>
                <LibraryFileManager engine={engine} run={run} />
            </div>
        </div>
    );
}

export function LibraryFileManager({
    engine,
    run,
    kinds = ["model", "aidax", "ir"]
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    kinds?: LibraryKind[];
}) {
    const availableKinds = PICKER_KINDS.filter((item) => kinds.includes(item.id));
    const [kind, setKind] = useState<LibraryKind>(availableKinds[0]?.id ?? "model");
    return (
        <div className="panel stack">
            <div className="muted">
                NAM files live in models. Impulse responses live in irs.
                {kinds.includes("aidax") && " AIDA-X files live in aidax."}
                Drag between the two panes, or long-press a row for more actions.
            </div>
            <div className="row explorer-kind-tabs">
                {availableKinds.map((item) => (
                    <button key={item.id} type="button" className={`btn ${kind === item.id ? "btn-active" : ""}`} onClick={() => setKind(item.id)}>
                        {item.label}
                    </button>
                ))}
            </div>
            <LibraryBrowser engine={engine} run={run} kind={kind} />
        </div>
    );
}

const PICKER_KINDS: { id: Exclude<LibraryKind, "plugin">; label: string }[] = [
    { id: "model", label: "NAM" },
    { id: "aidax", label: "AIDA-X" },
    { id: "ir", label: "IRs" }
];

export function LibraryFolderPicker({
    engine,
    run,
    kind,
    value,
    createFolderName,
    onPick,
    onClose,
    kinds = ["model", "aidax", "ir"]
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    kind: LibraryKind;
    value: string;
    createFolderName?: string;
    onPick: (directory: string, kind: LibraryKind) => void;
    onClose: () => void;
    kinds?: LibraryKind[];
}) {
    const [activeKind, setActiveKind] = useState<LibraryKind>(kind === "plugin" ? "model" : kind);
    const [directory, setDirectory] = useState(value || "TONE3000");
    const availableKinds = PICKER_KINDS.filter((item) => kinds.includes(item.id));
    const title = activeKind === "ir" ? "IR FOLDER" : activeKind === "aidax" ? "AIDA-X FOLDER" : "NAM FOLDER";
    const suggestedFolder = createFolderName ? safeLibraryFolderName(createFolderName) : "";
    return (
        <div className="dialog-backdrop" onClick={onClose}>
            <div className="dialog library-picker-dialog" onClick={(event) => event.stopPropagation()}>
                <h2>{title}</h2>
                <div className="muted">
                    Choose the folder under {libraryRootLabel(activeKind)}/ where files should be saved.
                </div>
                <div className="row explorer-kind-tabs">
                    {availableKinds.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className={`btn ${activeKind === item.id ? "btn-active" : ""}`}
                            onClick={() => {
                                setActiveKind(item.id);
                                setDirectory(loadTone3000Dir(item.id));
                            }}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
                <LibraryBrowser
                    engine={engine}
                    run={run}
                    kind={activeKind}
                    picker
                    directory={directory}
                    onDirectoryChange={setDirectory}
                />
                <div className="library-picker-actions">
                    <button type="button" className="btn" onClick={onClose}>CANCEL</button>
                    {suggestedFolder && (
                        <button
                            type="button"
                            className="btn btn-accent library-picker-create"
                            title={`Create ${suggestedFolder} and save there`}
                            onClick={() => {
                                const target = joinLibraryDir(directory, suggestedFolder);
                                void run(async () => {
                                    await engine.client.request("library/mkdir", {
                                        kind: activeKind,
                                        directory: target
                                    });
                                    onPick(target, activeKind);
                                    onClose();
                                });
                            }}
                        >
                            <span>SAVE IN NEW “{suggestedFolder}” FOLDER</span>
                        </button>
                    )}
                    <button
                        type="button"
                        className="btn btn-accent"
                        onClick={() => {
                            onPick(directory, activeKind);
                            onClose();
                        }}
                    >
                        USE THIS FOLDER
                    </button>
                </div>
            </div>
        </div>
    );
}

export function utf8ToBase64(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach((value) => {
        binary += String.fromCharCode(value);
    });
    return btoa(binary);
}

export function LibraryJsonPicker({
    engine,
    run,
    kind,
    mode,
    title,
    defaultName,
    contents,
    onClose,
    onLoad,
    onSaved
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    kind: LibraryKind;
    mode: "load" | "save";
    title: string;
    defaultName?: string;
    contents?: string;
    onClose: () => void;
    onLoad?: (parsed: JsonObject, path: string) => void;
    onSaved?: (path: string) => void;
}) {
    const [name, setName] = useState(defaultName ?? "");
    const [selectedPath, setSelectedPath] = useState("");
    const [files, setFiles] = useState<JsonObject[]>([]);
    const [error, setError] = useState("");

    useEffect(() => {
        const shared = obj(engine.uiSession.jsonPicker);
        if (str(shared.kind) !== kind || str(shared.mode) !== mode) {
            return;
        }
        if (typeof shared.name === "string") {
            setName(shared.name);
        }
        if (typeof shared.selectedPath === "string") {
            setSelectedPath(shared.selectedPath);
        }
    }, [engine.uiSession.jsonPicker, kind, mode]);

    const updatePicker = (patch: JsonObject) => {
        updateUiSessionSection(engine.client, "jsonPicker", { kind, mode, ...patch });
    };

    useEffect(() => {
        void engine.client.request("library/list", { kind, directory: "" }).then((result) => {
            setFiles(objects(obj(result).files));
        }).catch((item: unknown) => {
            setError(item instanceof Error ? item.message : String(item));
        });
    }, [engine.client, kind]);

    return (
        <div className="dialog-backdrop" onClick={onClose}>
            <div className="dialog library-picker-dialog" onClick={(event) => event.stopPropagation()}>
                <h2>{title}</h2>
                <div className="muted">Files in {libraryRootLabel(kind)}/</div>
                {mode === "save" && (
                    <label className="field">
                        <span>Name</span>
                        <input value={name} onChange={(event) => {
                            setName(event.target.value);
                            updatePicker({ name: event.target.value });
                        }} placeholder="My layout" />
                    </label>
                )}
                <div className="library-picker-files" data-mfx-sync-scroll={`settings-picker-${kind}-${mode}`}>
                    {files.length === 0 && <div className="muted">No files yet.</div>}
                    {files.map((item) => (
                        <button
                            key={str(item.path)}
                            type="button"
                            className={`btn ${selectedPath === str(item.path) ? "btn-active" : ""}`}
                            onClick={() => {
                                setSelectedPath(str(item.path));
                                updatePicker({ selectedPath: str(item.path) });
                                if (mode === "save") {
                                    const nextName = str(item.name).replace(/\.json$/i, "");
                                    setName(nextName);
                                    updatePicker({ name: nextName });
                                }
                            }}
                        >
                            {str(item.name)}
                        </button>
                    ))}
                </div>
                {error && <div className="danger">{error}</div>}
                <div className="row" style={{ justifyContent: "flex-end" }}>
                    <button type="button" className="btn" onClick={onClose}>CANCEL</button>
                    {mode === "load" ? (
                        <button
                            type="button"
                            className="btn btn-accent"
                            disabled={!selectedPath}
                            onClick={() => {
                                void run(async () => {
                                    const result = obj(await engine.client.request("library/read", { path: selectedPath }));
                                    const parsed = JSON.parse(str(result.contents)) as JsonObject;
                                    onLoad?.(parsed, selectedPath);
                                    onClose();
                                });
                            }}
                        >
                            LOAD
                        </button>
                    ) : (
                        <button type="button" className="btn btn-accent" onClick={() => {
                            const fileName = name.trim().replace(/\.json$/i, "");
                            if (!fileName) {
                                setError("Give the file a name.");
                                return;
                            }
                            if (!contents) {
                                setError("nothing to save");
                                return;
                            }
                            void run(async () => {
                                const stored = obj(await engine.client.request("library/upload", {
                                    kind,
                                    name: `${fileName}.json`,
                                    data: utf8ToBase64(contents),
                                    directory: ""
                                }));
                                onSaved?.(str(stored.path));
                                onClose();
                            });
                        }}>
                            SAVE
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

type LibraryItem = JsonObject;

export function LibraryBrowser({
    engine,
    run,
    kind,
    picker = false,
    dualDefault = true,
    directory: controlledDir,
    onDirectoryChange,
    onFileSelect
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    kind: LibraryKind;
    picker?: boolean;
    dualDefault?: boolean;
    directory?: string;
    onDirectoryChange?: (directory: string) => void;
    onFileSelect?: (item: JsonObject) => void;
}) {
    const [internalDir, setInternalDir] = useState("");
    const [rightDir, setRightDir] = useState("TONE3000");
    const directory = controlledDir ?? internalDir;
    const setDirectory = (next: string) => {
        onDirectoryChange?.(next);
        if (controlledDir === undefined) {
            setInternalDir(next);
        }
    };
    const [dual, setDual] = useState(!picker && dualDefault);
    const [tree, setTree] = useState<TreeNode | null>(null);
    const [leftFolders, setLeftFolders] = useState<LibraryItem[]>([]);
    const [leftFiles, setLeftFiles] = useState<LibraryItem[]>([]);
    const [rightFolders, setRightFolders] = useState<LibraryItem[]>([]);
    const [rightFiles, setRightFiles] = useState<LibraryItem[]>([]);
    const [activePane, setActivePane] = useState<"left" | "right">("left");
    const [selected, setSelected] = useState<LibraryItem | null>(null);
    const [multiSelect, setMultiSelect] = useState(false);
    const [checkedPaths, setCheckedPaths] = useState<string[]>([]);
    const [moving, setMoving] = useState<LibraryItem | null>(null);
    const [movingItems, setMovingItems] = useState<LibraryItem[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [menu, setMenu] = useState<{ x: number; y: number; item: LibraryItem | null } | null>(null);
    const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => void } | null>(null);
    const uploadRef = useRef<HTMLInputElement | null>(null);
    const folderUploadRef = useRef<HTMLInputElement | null>(null);
    const [importReport, setImportReport] = useState("");
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [pendingDirectory, setPendingDirectory] = useState("");
    const [deviceSelection, setDeviceSelection] = useState("");
    const deviceAudio = useRef<HTMLAudioElement | null>(null);
    const deviceTimer = useRef<number>();
    const deviceUrl = useRef("");
    const stopDevicePreview = () => {
        window.clearTimeout(deviceTimer.current); deviceAudio.current?.pause(); deviceAudio.current = null;
        if (deviceUrl.current) URL.revokeObjectURL(deviceUrl.current);
        deviceUrl.current = "";
    };
    useEffect(() => () => stopDevicePreview(), []);
    const previewDeviceFile = (file: File) => {
        stopDevicePreview(); setDeviceSelection(file.webkitRelativePath || file.name);
        if (!/\.wav$/i.test(file.name)) return;
        deviceUrl.current = URL.createObjectURL(file);
        const sound = new Audio(deviceUrl.current); sound.loop = true; deviceAudio.current = sound;
        void sound.play().catch(() => setError("Could not preview that WAV on this browser."));
        deviceTimer.current = window.setTimeout(stopDevicePreview, 5000);
    };
    const selectItem = (item: LibraryItem) => {
        setSelected(item);
        if (str(item.type) === "file") onFileSelect?.(item);
    };

    const activeDirectory = activePane === "right" && dual ? rightDir : directory;
    const setActiveDirectory = (next: string) => {
        if (activePane === "right" && dual) {
            setRightDir(next);
        } else {
            setDirectory(next);
        }
    };

    const refreshTree = async () => {
        const result = await engine.client.request("library/tree", { kind });
        setTree(parseTree(obj(obj(result).root)));
    };

    const refreshPane = async (dir: string, pane: "left" | "right") => {
        const result = await engine.client.request("library/list", { kind, directory: dir });
        const listed = obj(result);
        const folders = objects(listed.folders).sort((a, b) => str(a.name).localeCompare(str(b.name)));
        const files = objects(listed.files).sort((a, b) => str(a.name).localeCompare(str(b.name)));
        if (pane === "right") {
            setRightFolders(folders);
            setRightFiles(files);
        } else {
            setLeftFolders(folders);
            setLeftFiles(files);
        }
        return listed;
    };

    const refresh = async () => {
        setBusy(true);
        try {
            await refreshTree();
            await refreshPane(directory, "left");
            if (dual && !picker) {
                await refreshPane(rightDir, "right");
            }
            setError("");
        } catch (caught: unknown) {
            setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine.client, kind, directory, rightDir, dual, picker]);

    const work = (task: () => Promise<unknown>) => {
        void run(async () => {
            await task();
            if (kind === "backing") {
                await engine.client.request("backing/rescan");
            }
            await refresh();
            await engine.client.request("library").catch(() => undefined);
        });
    };

    const createFolder = async (parent = activeDirectory) => {
        const name = await askText("New folder name", "");
        if (!name?.trim()) {
            return;
        }
        const target = joinLibraryDir(parent, name.trim());
        work(async () => {
            await engine.client.request("library/mkdir", { kind, directory: target });
            if (picker) {
                setDirectory(target);
            }
        });
    };

    const renameItem = async (item: LibraryItem) => {
        const next = await askText("Rename", str(item.name));
        if (!next || next === str(item.name)) {
            return;
        }
        work(async () => {
            await engine.client.request("library/rename", { path: str(item.path), name: next });
        });
    };

    const paneItems = (pane: "left" | "right") => (
        pane === "right" ? [...rightFolders, ...rightFiles] : [...leftFolders, ...leftFiles]
    );
    const visibleItems = dual ? [...paneItems("left"), ...paneItems("right")] : paneItems("left");
    const checkedItems = visibleItems.filter((item) => checkedPaths.includes(str(item.path)));
    const targets = multiSelect ? checkedItems : (selected ? [selected] : []);

    const toggleChecked = (item: LibraryItem) => {
        const path = str(item.path);
        setCheckedPaths((current) => (
            current.includes(path) ? current.filter((value) => value !== path) : [...current, path]
        ));
        setSelected(item);
    };

    const deleteItems = (items: LibraryItem[]) => {
        if (!items.length) {
            return;
        }
        void run(async () => {
            const impact = await engine.client.request("library/delete-impact", {
                paths: items.map((item) => str(item.path))
            });
            const affected = objects(impact.affectedPresets);
            const folders = items.filter((item) => str(item.type) === "dir").length;
            const label = items.length === 1 ? `“${str(items[0].name)}”` : `${items.length} items`;
            const names = affected.slice(0, 3).map((item) => `“${str(item.presetName)}”`).join(", ");
            const more = affected.length > 3 ? ` and ${affected.length - 3} more` : "";
            const normalWarning = folders
                ? `Delete ${label} and any folders inside? This cannot be undone.`
                : `Delete ${label}? This cannot be undone.`;
            const dependencyWarning = affected.length
                ? `The ${affected.length === 1 ? "Community Preset" : `${affected.length} Community Presets`} ${names}${more} ${affected.length === 1 ? "needs" : "need"} these files. Continuing will also remove ${affected.length === 1 ? "that preset" : "those presets"} so the device is not left with broken presets.`
                : "";
            setConfirm({
                title: affected.length ? "DELETE FILES AND PRESETS" : items.length === 1 && folders ? "DELETE FOLDER" : "DELETE",
                body: dependencyWarning || normalWarning,
                run: () => {
                    work(async () => {
                        const removedBanks = new Set<string>();
                        for (const preset of affected) {
                            const bankId = str(preset.bankId);
                            if (Number(preset.bankPresetCount) <= 1) {
                                if (!removedBanks.has(bankId)) {
                                    await engine.client.request("bank/delete", { bankId });
                                    removedBanks.add(bankId);
                                }
                            } else {
                                await engine.client.request("preset/delete", { presetId: str(preset.presetId) });
                            }
                        }
                        for (const item of items) {
                            await engine.client.request("library/delete", { path: str(item.path) });
                        }
                        setSelected(null);
                        setCheckedPaths([]);
                    });
                }
            });
        });
    };

    const moveItemsTo = (items: LibraryItem[], destDir: string) => {
        if (!items.length) {
            return;
        }
        work(async () => {
            for (const item of items) {
                const relative = str(item.relative);
                if (relative === destDir || destDir.startsWith(relative + "/")) {
                    continue;
                }
                await engine.client.request("library/move", {
                    path: str(item.path),
                    kind,
                    directory: destDir
                });
            }
            setMoving(null);
            setMovingItems([]);
            setCheckedPaths([]);
        });
    };

    const moveItemTo = (item: LibraryItem, destDir: string) => moveItemsTo([item], destDir);

    const uploadFiles = (files: FileList | File[], destDir: string, confirmed = false) => {
        const list = Array.from(files);
        if (!list.length) {
            return;
        }
        if (kind === "drumsample" && !confirmed) {
            setPendingFiles(list); setPendingDirectory(destDir); setDeviceSelection(""); return;
        }
        work(async () => {
            let imported = 0, duplicates = 0, ignored = 0, failed = 0;
            let lastError = "";
            for (const file of list) {
                if (kind === "drumsample") {
                    if (!/\.wav$/i.test(file.name)) { ignored++; continue; }
                    const relative = joinLibraryDir(destDir, file.webkitRelativePath || file.name);
                    try {
                        const result = await engine.client.importDrumLibrary(file, relative);
                        if (result.duplicate) duplicates++; else imported++;
                    } catch (caught) { failed++; lastError = `${relative}: ${caught instanceof Error ? caught.message : String(caught)}`; }
                    setImportReport(`${imported} imported · ${duplicates} duplicates skipped · ${ignored} non-WAV skipped · ${failed} failed${lastError ? ` (${lastError})` : ""}`);
                    continue;
                }
                if (kind === "backing") {
                    await engine.client.uploadBackingTrack(file);
                    continue;
                }
                const data = await readBase64(file);
                await engine.client.request("library/upload", {
                    kind,
                    name: file.name,
                    data,
                    directory: destDir
                });
            }
        });
    };

    const dropOnDirectory = (destDir: string, event: DragEvent) => {
        event.preventDefault();
        const path = event.dataTransfer.getData("application/x-pimfx-path");
        const name = event.dataTransfer.getData("application/x-pimfx-name");
        const type = event.dataTransfer.getData("application/x-pimfx-type");
        if (path) {
            const relative = event.dataTransfer.getData("application/x-pimfx-relative");
            if (relative === destDir || destDir.startsWith(relative + "/")) {
                return;
            }
            moveItemTo({ path, name, type, relative }, destDir);
            return;
        }
        if (event.dataTransfer.files.length) {
            uploadFiles(event.dataTransfer.files, destDir);
        }
    };

    const openMenu = (event: { clientX: number; clientY: number }, item: LibraryItem | null) => {
        setMenu({ x: event.clientX, y: event.clientY, item });
        if (item) {
            setSelected(item);
        }
    };

    const selectedLabel = selected ? str(selected.name) : "nothing selected";

    return (
        <div className={`explorer ${dual && !picker ? "explorer-dual" : ""}`}>
            {pendingFiles.length > 0 && <div className="dialog-backdrop"><div className="dialog drum-import-dialog">
                <h2>IMPORT DRUM SAMPLES</h2>
                <div className="muted">Destination: drums/samples/{pendingDirectory} · Select a file to preview for five seconds. Folder hierarchy is preserved; identical files are skipped.</div>
                <div className="drum-import-list">{pendingFiles.map((file, index) => <div className="row" key={`${file.webkitRelativePath || file.name}-${index}`}>
                    <button type="button" className={`btn${deviceSelection === (file.webkitRelativePath || file.name) ? " btn-active" : ""}`} onClick={() => previewDeviceFile(file)}>{file.webkitRelativePath || file.name}</button>
                    <button type="button" className="btn btn-danger" aria-label={`Exclude ${file.name}`} onClick={() => { stopDevicePreview(); setPendingFiles((items) => items.filter((_, i) => i !== index)); }}>×</button>
                </div>)}</div>
                <div className="row"><button type="button" className="btn" onClick={() => { stopDevicePreview(); setPendingFiles([]); }}>CANCEL</button>
                    <button type="button" className="btn btn-accent" onClick={() => { stopDevicePreview(); const files = pendingFiles; setPendingFiles([]); uploadFiles(files, pendingDirectory, true); }}>IMPORT {pendingFiles.filter((file) => /\.wav$/i.test(file.name)).length} WAV FILES</button></div>
            </div></div>}
            <div className="explorer-toolbar">
                <div className="explorer-toolbar-main">
                    {!picker && (
                        <button
                            type="button"
                            className={`btn ${multiSelect ? "btn-active" : ""}`}
                            onClick={() => {
                                setMultiSelect((value) => !value);
                                setCheckedPaths([]);
                            }}
                        >
                            MULTI SELECT
                        </button>
                    )}
                    <button type="button" className="btn" onClick={() => void createFolder()}>NEW FOLDER</button>
                    {!picker && (
                        <>
                            {multiSelect && (
                                <button
                                    type="button"
                                    className="btn"
                                    onClick={() => {
                                        const paths = visibleItems.map((item) => str(item.path)).filter(Boolean);
                                        setCheckedPaths(checkedPaths.length === paths.length ? [] : paths);
                                    }}
                                >
                                    {checkedPaths.length && checkedPaths.length === visibleItems.length ? "CLEAR" : "SELECT ALL"}
                                </button>
                            )}
                            <button
                                type="button"
                                className="btn btn-danger"
                                disabled={!targets.length}
                                onClick={() => deleteItems(targets)}
                            >
                                DELETE{targets.length > 1 ? ` (${targets.length})` : ""}
                            </button>
                            <button
                                type="button"
                                className="btn"
                                disabled={!targets.length}
                                onClick={() => {
                                    setMoving(targets[0] ?? null);
                                    setMovingItems(targets);
                                }}
                            >
                                MOVE{targets.length > 1 ? ` (${targets.length})` : ""}
                            </button>
                            <button type="button" className="btn" onClick={() => uploadRef.current?.click()}>UPLOAD</button>
                            {kind === "drumsample" && <>
                                <button type="button" className="btn" onClick={() => folderUploadRef.current?.click()}>IMPORT FOLDER</button>
                                <input ref={(node) => { folderUploadRef.current = node; node?.setAttribute("webkitdirectory", ""); }} type="file" hidden multiple
                                    onChange={(event) => { if (event.target.files) uploadFiles(event.target.files, activeDirectory); event.target.value = ""; }} />
                            </>}
                            <input
                                ref={uploadRef}
                                type="file"
                                hidden
                                multiple
                                accept={kind === "drumsample" ? ".wav" : undefined}
                                onChange={(event) => {
                                    if (event.target.files) {
                                        uploadFiles(event.target.files, activeDirectory);
                                    }
                                    event.target.value = "";
                                }}
                            />
                        </>
                    )}
                </div>
                {!picker && (
                    <button type="button" className={`btn explorer-split-btn ${dual ? "btn-active" : ""}`} onClick={() => setDual((value) => !value)}>
                        SPLIT VIEW
                    </button>
                )}
            </div>
            {(moving || movingItems.length > 0) && (
                <div className="row explorer-move-bar">
                    <div className="muted" style={{ flex: 1 }}>
                        Move {movingItems.length > 1 ? `${movingItems.length} items` : str((movingItems[0] ?? moving)?.name)} into the highlighted pane, or drop on a folder.
                    </div>
                    <button type="button" className="btn btn-accent" onClick={() => moveItemsTo(movingItems.length ? movingItems : (moving ? [moving] : []), activeDirectory)}>
                        MOVE HERE
                    </button>
                    <button type="button" className="btn" onClick={() => { setMoving(null); setMovingItems([]); }}>CANCEL</button>
                </div>
            )}
            {error && (
                <div className="row">
                    <div className="danger" style={{ flex: 1 }}>{error}</div>
                    {/does not exist/i.test(error) && activeDirectory && (
                        <button
                            type="button"
                            className="btn btn-accent"
                            onClick={() => work(async () => {
                                await engine.client.request("library/mkdir", { kind, directory: activeDirectory });
                            })}
                        >
                            CREATE FOLDER
                        </button>
                    )}
                </div>
            )}
            {busy && <div className="muted">Loading…</div>}
            {importReport && <div className="muted" role="status">{importReport}</div>}
            <div className="explorer-panes">
                <ExplorerPane
                    kind={kind}
                    tree={tree}
                    directory={directory}
                    folders={leftFolders}
                    files={picker ? [] : leftFiles}
                    picker={picker}
                    selectedPath={str(selected?.path)}
                    checkedPaths={checkedPaths}
                    multiSelect={multiSelect}
                    active={activePane === "left"}
                    onActivate={() => setActivePane("left")}
                    onDirectory={setDirectory}
                    onSelect={selectItem}
                    onToggleChecked={toggleChecked}
                    onOpenFolder={setDirectory}
                    onOpenFile={(item) => {
                        if (kind === "backing") {
                            work(() => engine.client.request("backing/load", { path: str(item.path) }));
                        }
                    }}
                    onMenu={openMenu}
                    onDropDirectory={dropOnDirectory}
                />
                {dual && !picker && (
                    <ExplorerPane
                        kind={kind}
                        tree={tree}
                        directory={rightDir}
                        folders={rightFolders}
                        files={rightFiles}
                        picker={false}
                        selectedPath={str(selected?.path)}
                        checkedPaths={checkedPaths}
                        multiSelect={multiSelect}
                        active={activePane === "right"}
                        onActivate={() => setActivePane("right")}
                        onDirectory={setRightDir}
                        onSelect={selectItem}
                        onToggleChecked={toggleChecked}
                        onOpenFolder={setRightDir}
                        onOpenFile={(item) => {
                            if (kind === "backing") {
                                work(() => engine.client.request("backing/load", { path: str(item.path) }));
                            }
                        }}
                        onMenu={openMenu}
                        onDropDirectory={dropOnDirectory}
                    />
                )}
            </div>
            <div className="muted explorer-status">
                {libraryRootLabel(kind)}/{activeDirectory || ""} · {multiSelect
                    ? `${checkedPaths.length} selected`
                    : selectedLabel}
            </div>
            {menu && (
                <div className="explorer-menu-dismiss" onClick={() => setMenu(null)}>
                    <div
                        className="explorer-menu"
                        style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 220) }}
                        onClick={(event) => event.stopPropagation()}
                    >
                        {menu.item && str(menu.item.type) === "dir" && (
                            <button type="button" onClick={() => { setActiveDirectory(str(menu.item!.relative)); setMenu(null); }}>OPEN</button>
                        )}
                        {menu.item && kind === "backing" && str(menu.item.type) === "file" && (
                            <button type="button" disabled={!str(engine.backing.activeSetListId)} onClick={() => {
                                work(() => engine.client.request("backing/setlist/add", { path: str(menu.item!.path) }));
                                setMenu(null);
                            }}>ADD TO SET LIST</button>
                        )}
                        {menu.item && (
                            <button type="button" onClick={() => { void renameItem(menu.item!); setMenu(null); }}>RENAME</button>
                        )}
                        {menu.item && !picker && (
                            <button
                                type="button"
                                onClick={() => {
                                    const items = multiSelect && checkedItems.some((item) => str(item.path) === str(menu.item!.path))
                                        ? checkedItems
                                        : [menu.item!];
                                    setMoving(items[0] ?? null);
                                    setMovingItems(items);
                                    setMenu(null);
                                }}
                            >
                                MOVE{multiSelect && checkedItems.length > 1 && checkedItems.some((item) => str(item.path) === str(menu.item!.path))
                                    ? ` (${checkedItems.length})`
                                    : ""}
                            </button>
                        )}
                        {menu.item && !picker && (
                            <button
                                type="button"
                                className="danger"
                                onClick={() => {
                                    const items = multiSelect && checkedItems.some((item) => str(item.path) === str(menu.item!.path))
                                        ? checkedItems
                                        : [menu.item!];
                                    deleteItems(items);
                                    setMenu(null);
                                }}
                            >
                                DELETE
                            </button>
                        )}
                        <button type="button" onClick={() => { void createFolder(); setMenu(null); }}>NEW FOLDER</button>
                    </div>
                </div>
            )}
            {confirm && (
                <LibraryConfirm
                    title={confirm.title}
                    body={confirm.body}
                    danger
                    onCancel={() => setConfirm(null)}
                    onConfirm={() => {
                        confirm.run();
                        setConfirm(null);
                    }}
                />
            )}
        </div>
    );
}

function ExplorerPane({
    kind,
    tree,
    directory,
    folders,
    files,
    picker,
    selectedPath,
    checkedPaths,
    multiSelect,
    active,
    onActivate,
    onDirectory,
    onSelect,
    onToggleChecked,
    onOpenFolder,
    onOpenFile,
    onMenu,
    onDropDirectory
}: {
    kind: LibraryKind;
    tree: TreeNode | null;
    directory: string;
    folders: LibraryItem[];
    files: LibraryItem[];
    picker: boolean;
    selectedPath: string;
    checkedPaths: string[];
    multiSelect: boolean;
    active: boolean;
    onActivate: () => void;
    onDirectory: (directory: string) => void;
    onSelect: (item: LibraryItem) => void;
    onToggleChecked: (item: LibraryItem) => void;
    onOpenFolder: (directory: string) => void;
    onOpenFile: (item: LibraryItem) => void;
    onMenu: (event: { clientX: number; clientY: number }, item: LibraryItem | null) => void;
    onDropDirectory: (destDir: string, event: DragEvent) => void;
}) {
    const crumbs = useMemo(() => ["", ...directory.split("/").filter(Boolean)], [directory]);
    let crumbPath = "";
    return (
        <div
            className={`explorer-pane ${active ? "explorer-pane-active" : ""}`}
            onPointerDown={onActivate}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDropDirectory(directory, event)}
            onContextMenu={(event) => {
                event.preventDefault();
                onMenu(event, null);
            }}
        >
            <div className="explorer-crumbs">
                {crumbs.map((part, index) => {
                    if (index > 0) {
                        crumbPath = joinLibraryDir(crumbPath, part);
                    }
                    const path = index === 0 ? "" : crumbPath;
                    const label = index === 0 ? libraryRootLabel(kind) : part;
                    return (
                        <button
                            key={`${index}-${path}`}
                            type="button"
                            className={`btn ${path === directory ? "btn-active" : ""}`}
                            onClick={() => onDirectory(path)}
                        >
                            {label}
                        </button>
                    );
                })}
            </div>
            <div className="explorer-body">
                <div className="explorer-tree">
                    {tree && (
                        <TreeRows
                            node={tree}
                            rootLabel={libraryRootLabel(kind)}
                            current={directory}
                            onOpen={onDirectory}
                        />
                    )}
                </div>
                <div className="explorer-list">
                    {folders.map((folder) => (
                        <ExplorerRow
                            key={str(folder.path, str(folder.relative))}
                            item={folder}
                            selected={selectedPath === str(folder.path)}
                            checked={checkedPaths.includes(str(folder.path))}
                            multiSelect={multiSelect}
                            folder
                            onSelect={() => (multiSelect ? onToggleChecked(folder) : onSelect(folder))}
                            onToggleChecked={() => onToggleChecked(folder)}
                            onOpen={() => onOpenFolder(str(folder.relative))}
                            onMenu={onMenu}
                            onDrop={(event) => onDropDirectory(str(folder.relative), event)}
                        />
                    ))}
                    {!picker && files.map((file) => (
                        <ExplorerRow
                            key={str(file.path, str(file.relative))}
                            item={file}
                            selected={selectedPath === str(file.path)}
                            checked={checkedPaths.includes(str(file.path))}
                            multiSelect={multiSelect}
                            onSelect={() => {
                                if (multiSelect) {
                                    onToggleChecked(file);
                                } else if (selectedPath === str(file.path)) {
                                    onOpenFile(file);
                                } else {
                                    onSelect(file);
                                }
                            }}
                            onToggleChecked={() => onToggleChecked(file)}
                            onMenu={onMenu}
                        />
                    ))}
                    {folders.length === 0 && (picker || files.length === 0) && (
                        <div className="muted explorer-empty">Empty folder</div>
                    )}
                </div>
            </div>
        </div>
    );
}

function TreeRows({
    node,
    rootLabel,
    current,
    onOpen,
    depth = 0
}: {
    node: TreeNode;
    rootLabel: string;
    current: string;
    onOpen: (directory: string) => void;
    depth?: number;
}) {
    const [open, setOpen] = useState(depth < 2);
    const relative = node.relative;
    const active = current === relative || current.startsWith(relative ? `${relative}/` : "");
    useEffect(() => {
        if (active) {
            setOpen(true);
        }
    }, [active]);
    return (
        <div className="explorer-tree-node">
            <button
                type="button"
                className={`explorer-tree-row ${current === relative ? "selected" : ""}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => onOpen(relative)}
            >
                {node.children.length > 0 && (
                    <span
                        className="explorer-tree-twist"
                        onClick={(event) => {
                            event.stopPropagation();
                            setOpen((value) => !value);
                        }}
                    >
                        {open ? "▾" : "▸"}
                    </span>
                )}
                <span className="explorer-tree-label">{relative ? node.name : rootLabel}</span>
            </button>
            {open && node.children.map((child) => (
                <TreeRows
                    key={child.relative}
                    node={child}
                    rootLabel={rootLabel}
                    current={current}
                    onOpen={onOpen}
                    depth={depth + 1}
                />
            ))}
        </div>
    );
}

function ExplorerRow({
    item,
    selected,
    checked = false,
    multiSelect = false,
    folder = false,
    onSelect,
    onToggleChecked,
    onOpen,
    onMenu,
    onDrop
}: {
    item: LibraryItem;
    selected: boolean;
    checked?: boolean;
    multiSelect?: boolean;
    folder?: boolean;
    onSelect: () => void;
    onToggleChecked?: () => void;
    onOpen?: () => void;
    onMenu: (event: { clientX: number; clientY: number }, item: LibraryItem) => void;
    onDrop?: (event: DragEvent) => void;
}) {
    const timer = useRef<number>(0);
    const start = useRef({ x: 0, y: 0 });
    const longPress = useRef(false);
    return (
        <button
            type="button"
            className={`explorer-row ${selected ? "selected" : ""}${checked ? " is-checked" : ""}`}
            style={{ touchAction: "none", WebkitTouchCallout: "none" }}
            draggable
            onDragStart={(event) => {
                event.dataTransfer.setData("application/x-pimfx-path", str(item.path));
                event.dataTransfer.setData("application/x-pimfx-name", str(item.name));
                event.dataTransfer.setData("application/x-pimfx-type", str(item.type, folder ? "dir" : "file"));
                event.dataTransfer.setData("application/x-pimfx-relative", str(item.relative));
                event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={onDrop ? (event) => event.preventDefault() : undefined}
            onDrop={onDrop}
            onClick={() => {
                if (longPress.current) {
                    longPress.current = false;
                    return;
                }
                if (folder && selected && !multiSelect) {
                    onOpen?.();
                    return;
                }
                onSelect();
            }}
            onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelect();
                onMenu(event, item);
            }}
            onPointerDown={(event) => {
                longPress.current = false;
                start.current = { x: event.clientX, y: event.clientY };
                try {
                    event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                    // optional
                }
                window.clearTimeout(timer.current);
                timer.current = window.setTimeout(() => {
                    longPress.current = true;
                    onSelect();
                    onMenu({ clientX: start.current.x, clientY: start.current.y }, item);
                }, LONG_PRESS_MS);
            }}
            onPointerMove={(event) => {
                if (Math.abs(event.clientX - start.current.x) > 12 || Math.abs(event.clientY - start.current.y) > 12) {
                    window.clearTimeout(timer.current);
                }
            }}
            onPointerUp={() => window.clearTimeout(timer.current)}
            onPointerCancel={() => window.clearTimeout(timer.current)}
        >
            {multiSelect && (
                <span
                    className={`explorer-check${checked ? " is-on" : ""}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleChecked?.();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    {checked ? "☑" : "☐"}
                </span>
            )}
            <span className="explorer-row-icon">{folder ? "📁" : "📄"}</span>
            <span className="explorer-row-name">
                <strong>{str(item.name)}</strong>
                {!folder && <span className="muted">{formatBytes(num(item.bytes))}</span>}
            </span>
        </button>
    );
}
