import { useEffect, useState } from "react";
import type { EngineSnapshot } from "../api";
import { num, obj, str, objects, type JsonObject } from "../json";

export type LibraryKind = "model" | "ir";

const MODEL_DIR_KEY = "pimfx-t3k-model-dir";
const IR_DIR_KEY = "pimfx-t3k-ir-dir";

export function loadTone3000Dir(kind: LibraryKind): string {
    const stored = window.localStorage.getItem(kind === "ir" ? IR_DIR_KEY : MODEL_DIR_KEY);
    return stored && stored !== "." ? stored : "TONE3000";
}

export function saveTone3000Dir(kind: LibraryKind, directory: string): void {
    window.localStorage.setItem(kind === "ir" ? IR_DIR_KEY : MODEL_DIR_KEY, directory);
}

export function joinLibraryDir(parent: string, name: string): string {
    const leaf = name.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!leaf) {
        return parent;
    }
    return parent ? `${parent}/${leaf}` : leaf;
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

export function LibraryFileManager({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const [kind, setKind] = useState<LibraryKind>("model");
    return (
        <div className="panel stack">
            <h2>LIBRARY</h2>
            <div className="muted">
                NAM files stay under models. Impulse responses stay under IRs. Create folders such as
                amps/clean so TONE3000 downloads can land in the right place.
            </div>
            <div className="row">
                <button
                    type="button"
                    className={`btn ${kind === "model" ? "btn-active" : ""}`}
                    onClick={() => setKind("model")}
                >
                    NAM MODELS
                </button>
                <button
                    type="button"
                    className={`btn ${kind === "ir" ? "btn-active" : ""}`}
                    onClick={() => setKind("ir")}
                >
                    IMPULSE RESPONSES
                </button>
            </div>
            <LibraryBrowser engine={engine} run={run} kind={kind} />
        </div>
    );
}

export function LibraryFolderPicker({
    engine,
    run,
    kind,
    value,
    onPick,
    onClose
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    kind: LibraryKind;
    value: string;
    onPick: (directory: string) => void;
    onClose: () => void;
}) {
    const [directory, setDirectory] = useState(value || "TONE3000");
    return (
        <div className="dialog-backdrop" onClick={onClose}>
            <div className="dialog library-picker-dialog" onClick={(event) => event.stopPropagation()}>
                <h2>{kind === "ir" ? "IR FOLDER" : "NAM FOLDER"}</h2>
                <div className="muted">
                    {kind === "ir"
                        ? "Impulse responses are stored only in the IR library."
                        : "NAM captures are stored only in the models library."}
                </div>
                <LibraryBrowser
                    engine={engine}
                    run={run}
                    kind={kind}
                    picker
                    directory={directory}
                    onDirectoryChange={setDirectory}
                />
                <div className="row" style={{ justifyContent: "flex-end" }}>
                    <button type="button" className="btn" onClick={onClose}>CANCEL</button>
                    <button
                        type="button"
                        className="btn btn-accent"
                        onClick={() => {
                            onPick(directory);
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

export function LibraryBrowser({
    engine,
    run,
    kind,
    picker = false,
    directory: controlledDir,
    onDirectoryChange
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
    kind: LibraryKind;
    picker?: boolean;
    directory?: string;
    onDirectoryChange?: (directory: string) => void;
}) {
    const [internalDir, setInternalDir] = useState("");
    const directory = controlledDir ?? internalDir;
    const setDirectory = (next: string) => {
        onDirectoryChange?.(next);
        if (controlledDir === undefined) {
            setInternalDir(next);
        }
    };
    const [folders, setFolders] = useState<JsonObject[]>([]);
    const [files, setFiles] = useState<JsonObject[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [newFolder, setNewFolder] = useState("");
    const [moving, setMoving] = useState<JsonObject | null>(null);

    const refresh = async (dir = directory) => {
        setBusy(true);
        try {
            const result = await engine.client.request("library/list", { kind, directory: dir });
            const listed = obj(result);
            setFolders(objects(listed.folders).sort((a, b) => str(a.name).localeCompare(str(b.name))));
            setFiles(objects(listed.files).sort((a, b) => str(a.name).localeCompare(str(b.name))));
            setError("");
        } catch (caught: unknown) {
            setFolders([]);
            setFiles([]);
            setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        void refresh(directory);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine.client, kind, directory]);

    const work = (task: () => Promise<unknown>) => {
        void run(async () => {
            await task();
            await refresh();
            await engine.client.request("library").catch(() => undefined);
        });
    };

    const createFolder = () => {
        const name = newFolder.trim();
        if (!name) {
            return;
        }
        const target = joinLibraryDir(directory, name);
        work(async () => {
            await engine.client.request("library/mkdir", { kind, directory: target });
            setNewFolder("");
            if (picker) {
                setDirectory(target);
            }
        });
    };

    const renameItem = (item: JsonObject) => {
        const next = window.prompt("Rename", str(item.name));
        if (!next || next === str(item.name)) {
            return;
        }
        work(async () => {
            await engine.client.request("library/rename", { path: str(item.path), name: next });
        });
    };

    const deleteItem = (item: JsonObject) => {
        const label = str(item.name);
        const folder = str(item.type) === "dir";
        if (!window.confirm(folder ? `Delete folder “${label}” and everything inside it?` : `Delete “${label}”?`)) {
            return;
        }
        work(async () => {
            await engine.client.request("library/delete", { path: str(item.path) });
        });
    };

    const moveHere = (item: JsonObject) => {
        work(async () => {
            await engine.client.request("library/move", {
                path: str(item.path),
                kind,
                directory
            });
            setMoving(null);
        });
    };

    const crumbs = ["", ...directory.split("/").filter(Boolean)];
    let crumbPath = "";

    return (
        <div className="library-browser">
            <div className="library-crumbs">
                {crumbs.map((part, index) => {
                    if (index > 0) {
                        crumbPath = joinLibraryDir(crumbPath, part);
                    }
                    const path = index === 0 ? "" : crumbPath;
                    const label = index === 0 ? (kind === "ir" ? "IRs" : "NAM") : part;
                    return (
                        <button
                            key={`${index}-${path}`}
                            type="button"
                            className={`btn ${path === directory ? "btn-active" : ""}`}
                            onClick={() => setDirectory(path)}
                        >
                            {label}
                        </button>
                    );
                })}
            </div>
            <div className="row">
                <label className="field" style={{ flex: 1, minWidth: 0 }}>
                    <span>New folder</span>
                    <input
                        value={newFolder}
                        placeholder={kind === "ir" ? "cabs" : "amps/clean"}
                        onChange={(event) => setNewFolder(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                createFolder();
                            }
                        }}
                    />
                </label>
                <button type="button" className="btn" onClick={createFolder}>CREATE</button>
                {!picker && (
                    <label className="btn">
                        UPLOAD
                        <input
                            type="file"
                            hidden
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) {
                                    work(async () => {
                                        const data = await readBase64(file);
                                        await engine.client.request("library/upload", {
                                            kind,
                                            name: file.name,
                                            data,
                                            directory
                                        });
                                    });
                                }
                                event.target.value = "";
                            }}
                        />
                    </label>
                )}
            </div>
            {moving && (
                <div className="row">
                    <div className="muted" style={{ flex: 1 }}>
                        Move {str(moving.name)} into this folder?
                    </div>
                    <button type="button" className="btn btn-accent" onClick={() => moveHere(moving)}>MOVE HERE</button>
                    <button type="button" className="btn" onClick={() => setMoving(null)}>CANCEL</button>
                </div>
            )}
            {error && (
                <div className="row">
                    <div className="danger" style={{ flex: 1 }}>{error}</div>
                    {/does not exist/i.test(error) && directory && (
                        <button
                            type="button"
                            className="btn btn-accent"
                            onClick={() => work(async () => {
                                await engine.client.request("library/mkdir", { kind, directory });
                            })}
                        >
                            CREATE FOLDER
                        </button>
                    )}
                </div>
            )}
            {busy && <div className="muted">Loading…</div>}
            <div className="library-list">
                {folders.map((folder) => (
                    <div key={str(folder.path, str(folder.relative))} className="library-row">
                        <button
                            type="button"
                            className="btn library-row-name"
                            onClick={() => setDirectory(str(folder.relative))}
                        >
                            {str(folder.name)}/
                        </button>
                        <button type="button" className="btn" onClick={() => renameItem(folder)}>RENAME</button>
                        {!picker && (
                            <>
                                <button type="button" className="btn" onClick={() => setMoving(folder)}>MOVE</button>
                                <button type="button" className="btn btn-danger" onClick={() => deleteItem(folder)}>DELETE</button>
                            </>
                        )}
                    </div>
                ))}
                {!picker && files.map((file) => (
                    <div key={str(file.path, str(file.relative))} className="library-row">
                        <div className="library-row-name">
                            <strong>{str(file.name)}</strong>
                            <div className="muted">{formatBytes(num(file.bytes))}</div>
                        </div>
                        <button type="button" className="btn" onClick={() => renameItem(file)}>RENAME</button>
                        <button type="button" className="btn" onClick={() => setMoving(file)}>MOVE</button>
                        <button type="button" className="btn btn-danger" onClick={() => deleteItem(file)}>DELETE</button>
                    </div>
                ))}
                {folders.length === 0 && (picker || files.length === 0) && !busy && !error && (
                    <div className="muted">{picker ? "No folders here yet." : "Nothing stored in this folder yet."}</div>
                )}
            </div>
            {picker && (
                <div className="muted">Saving into: {directory ? `${kind === "ir" ? "irs" : "models"}/${directory}` : (kind === "ir" ? "irs" : "models")}</div>
            )}
        </div>
    );
}
