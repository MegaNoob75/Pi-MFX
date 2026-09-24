/* Documentation-only browser fixture. Loaded by /docs.html, never by the product UI. */

type Body = Record<string, unknown>;

const params = new URLSearchParams(window.location.search);
const requestedView = params.get("view") || "performance";
const variant = params.get("variant") || "";

const waveform = Array.from({ length: 72 }, (_, index) =>
    0.18 + Math.abs(Math.sin(index * 0.37)) * 0.72
);
const drumVelocities = Array.from({ length: 16 }, (_, index) =>
    [0, 4, 8, 12].includes(index) ? 118 : [2, 6, 10, 14].includes(index) ? 82 : 0
);

const snapshots = [
    { id: "snap-clean", name: "CLEAN", slot: 0 },
    { id: "snap-edge", name: "EDGE", slot: 1 },
    { id: "snap-lead", name: "LEAD", slot: 2 },
    { id: "snap-space", name: "SPACE", slot: 3 }
];

const banks = [
    {
        id: "test-bank",
        name: "test bank",
        presets: [
            { id: "preset-1", name: "Preset 1", tempo: 118, activeSnapshot: -1, snapshots, parameterBindings: [
                { controlId: "pot-1", action: "setParameter", slotId: "slot-nam", portSymbol: "input" },
                { controlId: "pot-2", action: "setParameter", slotId: "slot-nam", portSymbol: "quality" },
                { controlId: "pot-3", action: "setParameter", slotId: "slot-nam", portSymbol: "output" },
                { controlId: "pot-4", action: "setParameter", slotId: "slot-nam", portSymbol: "input" }
            ] },
            { id: "preset-2", name: "Preset 2", tempo: 118, activeSnapshot: -1, snapshots: [] },
            { id: "preset-3", name: "preset 3", tempo: 118, activeSnapshot: -1, snapshots: [] },
            { id: "preset-4", name: "preset 4", tempo: 118, activeSnapshot: -1, snapshots: [] },
            { id: "preset-5", name: "preset 5", tempo: 118, activeSnapshot: -1, snapshots: [] },
            { id: "preset-6", name: "preset 6", tempo: 118, activeSnapshot: -1, snapshots: [] },
            { id: "preset-7", name: "preset 7", tempo: 118, activeSnapshot: -1, snapshots: [] },
            { id: "preset-8", name: "preset 8", tempo: 118, activeSnapshot: -1, snapshots: [] }
        ]
    }
];

const chain = [
    {
        id: "slot-gate", name: "Noise Gate", enabled: true,
        state: { threshold: -54, release: 140 },
        plugin: { uri: "urn:pimfx:gate", name: "Noise Gate", author: "Pi-MFX", category: "Dynamics", ports: [
            { kind: "control", input: true, symbol: "threshold", name: "Threshold", minimum: -80, maximum: 0, default: -50, unit: "dB" },
            { kind: "control", input: true, symbol: "release", name: "Release", minimum: 10, maximum: 500, default: 120, unit: "ms" }
        ] }
    },
    {
        id: "slot-drive", name: "Valve Drive", enabled: true,
        state: { drive: 0.38, tone: 0.56, level: 0.72 },
        plugin: { uri: "urn:pimfx:drive", name: "Valve Drive", author: "Pi-MFX", category: "Distortion", ports: [
            { kind: "control", input: true, symbol: "drive", name: "Drive", minimum: 0, maximum: 1, default: 0.25 },
            { kind: "control", input: true, symbol: "tone", name: "Tone", minimum: 0, maximum: 1, default: 0.5 },
            { kind: "control", input: true, symbol: "level", name: "Level", minimum: 0, maximum: 1, default: 0.7 }
        ] }
    },
    {
        id: "slot-nam", name: "TooB NAM", enabled: true,
        state: { input: -6, quality: 1, output: -3 },
        plugin: { uri: "http://two-play.com/plugins/toob-nam", name: "TooB Neural Amp Modeler", author: "TooB", category: "Simulator", ports: [
            { kind: "control", input: true, symbol: "input", name: "Input Calibration Level", minimum: -30, maximum: 12, default: 0, unit: "dB" },
            { kind: "control", input: true, symbol: "quality", name: "Quality", minimum: 0, maximum: 2, default: 1, scalePoints: [{ value: 0, label: "Economy" }, { value: 1, label: "Normal" }, { value: 2, label: "High" }] },
            { kind: "control", input: true, symbol: "output", name: "Output", minimum: -30, maximum: 12, default: 0, unit: "dB" }
        ], properties: [{ key: "model", name: "NAM Model", kind: "path", value: "TONE3000/Deluxe-Clean.nam" }] }
    },
    {
        id: "slot-delay", name: "Stereo Delay", enabled: true,
        state: { time: 0.5, feedback: 0.34, mix: 0.22 },
        plugin: { uri: "urn:pimfx:delay", name: "Stereo Delay", author: "Pi-MFX", category: "Delay", ports: [
            { kind: "control", input: true, symbol: "time", name: "Time", minimum: 0.03, maximum: 2, default: 0.4, unit: "s" },
            { kind: "control", input: true, symbol: "feedback", name: "Feedback", minimum: 0, maximum: 0.95, default: 0.3 },
            { kind: "control", input: true, symbol: "mix", name: "Mix", minimum: 0, maximum: 1, default: 0.2 }
        ] }
    },
    {
        id: "slot-reverb", name: "Plate Reverb", enabled: true,
        state: { decay: 2.8, mix: 0.18 },
        plugin: { uri: "urn:pimfx:reverb", name: "Plate Reverb", author: "Pi-MFX", category: "Reverb", ports: [
            { kind: "control", input: true, symbol: "decay", name: "Decay", minimum: 0.2, maximum: 12, default: 2.5, unit: "s" },
            { kind: "control", input: true, symbol: "mix", name: "Mix", minimum: 0, maximum: 1, default: 0.2 }
        ] }
    }
];

const performanceElements = {
    currentBank: { id: "currentBank", visible: true, showLabel: true, rect: { x: .15, y: .02, width: .22, height: .11 } },
    activePreset: { id: "activePreset", visible: true, showLabel: true, rect: { x: .42, y: .02, width: .22, height: .11 } },
    snapshotModeStatus: { id: "snapshotModeStatus", visible: true, showLabel: true, rect: { x: .68, y: .02, width: .10, height: .11 } },
    chainBypassStatus: { id: "chainBypassStatus", visible: true, showLabel: true, rect: { x: .79, y: .02, width: .10, height: .11 } },
    outputMeter: { id: "outputMeter", visible: true, showLabel: true, orientation: "vertical", rect: { x: .80, y: .18, width: .04, height: .52 } },
    tuner: { id: "tuner", visible: true, showLabel: true, rect: { x: .01, y: .79, width: .16, height: .11 } },
    cpuUsage: { id: "cpuUsage", visible: true, showLabel: true, rect: { x: .18, y: .81, width: .08, height: .09 } },
    xruns: { id: "xruns", visible: true, showLabel: true, rect: { x: .28, y: .81, width: .08, height: .09 } },
    inputMeter: { id: "inputMeter", visible: true, showLabel: true, orientation: "horizontal", rect: { x: .37, y: .81, width: .40, height: .09 } },
    audioStatus: { id: "audioStatus", visible: true, showLabel: true, rect: { x: .80, y: .72, width: .19, height: .18 } }
};

const controls = [
    { id: "enc-1", label: "ENC 1", kind: "encoder", binding: { action: "navigate" }, x: .02, y: .01, width: .11, height: .15 },
    ...Array.from({ length: 8 }, (_, index) => ({
        id: `mom-${index + 1}`,
        label: `MOM ${index + 1}`,
        kind: "momentary",
        binding: {
            action: "selectPreset",
            presetId: `preset-${index + 1}`,
            doubleAction: "reloadPreset",
            ...(index === 3 ? { holdAction: "bypassAll" } : {}),
            ...(index === 7 ? { holdAction: "snapshotMode" } : {})
        },
        x: .02 + (index % 4) * .18,
        y: index < 4 ? .18 : .49,
        width: .15,
        height: .25
    })),
    { id: "pot-1", label: "POT 1", kind: "pot", binding: { action: "setParameter" }, x: .91, y: .04, width: .075, height: .14 },
    { id: "pot-2", label: "POT 2", kind: "pot", binding: { action: "setParameter" }, x: .91, y: .21, width: .075, height: .14 },
    { id: "pot-3", label: "POT 3", kind: "pot", binding: { action: "setParameter" }, x: .91, y: .38, width: .075, height: .14 },
    { id: "pot-4", label: "POT 4", kind: "pot", binding: { action: "setParameter" }, x: .91, y: .55, width: .075, height: .14 }
];

const state: Body = {
    type: "state",
    version: "0.6.0-dev",
    gitSha: "workstation",
    audioBackend: "ALSA hw: USB Audio",
    pluginCount: 18,
    audioRunning: true,
    audioInterface: "Scarlett Solo 4th Gen",
    activeBankId: "test-bank",
    activePresetId: "preset-1",
    activeSnapshot: variant === "snapshots" ? 1 : -1,
    snapshotMode: variant === "snapshots",
    bypassAll: false,
    tempo: 118,
    banks,
    chain,
    transportFeatureEnabled: true,
    backingTrackFeatureEnabled: true,
    recorderFeatureEnabled: true,
    drumFeatureEnabled: true,
    communityCatalogFeatureEnabled: true,
    audio: { device: "hw:USB", sampleRate: 48000, periodFrames: 32, periodCount: 4, bufferMs: 2.67, inputChannels: 2, outputChannels: 2, guitarInput: 1, useMmap: true },
    actualAudio: { device: "hw:USB", sampleRate: 48000, periodFrames: 32, periodCount: 4 },
    system: { sharedTransportEnabled: true, backingTracksEnabled: true },
    ui: {
        themeId: "Silverface",
        communityAuthor: "Pi-MFX Player",
        menuOrder: ["performance", "transport", "backingTracks", "looper", "recorder", "drums", "community", "tuner", "banks", "edit", "library", "plugins", "files", "settings", "about"],
        shortcuts: { left: ["looper", "recorder", "backingTracks", "files", "tuner"], right: ["drums", "banks", "edit", "community", "settings"] },
        tuner: { referenceHz: 440, muteOnOpen: true }
    },
    controller: {
        device: "Pi-MFX Controller",
        connected: true,
        controls,
        presetAssignments: { "test-bank": Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`mom-${index + 1}`, `preset-${index + 1}`])) },
        performanceLayout: { name: "default", elements: performanceElements, snapshotElements: snapshots.map((_item, index) => ({ id: `snap-slot-${index}`, slot: index, rect: { x: .06 + (index % 2) * .47, y: .08 + Math.floor(index / 2) * .44, width: .41, height: .36 } })) }
    },
    controlPositions: { "pot-1": .57, "pot-2": .5, "pot-3": .64, "pot-4": .42, "enc-1": .5 }
};

const catalog: Body = {
    type: "catalog",
    plugins: [
        ...chain.map((slot) => {
            const plugin = slot.plugin as Body;
            return {
                ...plugin,
                installed: true,
                audioInputs: 1,
                audioOutputs: 1,
                ports: [
                    { kind: "audio", input: true, name: "Input" },
                    { kind: "audio", input: false, name: "Output" },
                    ...((plugin.ports as unknown[]) ?? [])
                ]
            };
        }),
        { uri: "urn:pimfx:compressor", name: "Studio Compressor", author: "Pi-MFX", category: "Dynamics", audioInputs: 1, audioOutputs: 1, ports: [{ kind: "audio", input: true }, { kind: "audio", input: false }] },
        { uri: "http://two-play.com/plugins/toob-cab-ir", name: "TooB Cab IR", author: "TooB", category: "Simulator", audioInputs: 1, audioOutputs: 1, ports: [{ kind: "audio", input: true }, { kind: "audio", input: false }] }
    ]
};

const library: Body = {
    type: "library",
    models: [
        { name: "Deluxe-Clean.nam", path: "TONE3000/Deluxe-Clean.nam" },
        { name: "British-Crunch.nam", path: "TONE3000/British-Crunch.nam" }
    ],
    aidax: [{ name: "Studio-Lead.json", path: "AIDA-X/Studio-Lead.json" }],
    impulseResponses: [{ name: "Greenback-212.wav", path: "Cabinets/Greenback-212.wav" }]
};

const transport: Body = { type: "transport", bpm: 118, beatsPerBar: 4, beatUnit: 4, countInBars: 1, metronomeEnabled: true, quantizationEnabled: true, playing: true, bar: 12, beat: 2.36, samplePosition: 1048576 };
const backing: Body = {
    type: "backing", loaded: true, playing: true, status: "playing", name: "Midnight Drive.wav", title: "Midnight Drive", artist: "Practice Set", album: "Live Rehearsal", notes: "Verse · chorus · solo · double chorus", duration: 238, position: 74, level: .82, manualBpm: 118, loopEnabled: false, loopStart: 0, loopEnd: 238, underruns: 0, waveform,
    activeSetListId: "set-live", setListIndex: 0, setLists: [{ id: "set-live", name: "FRIDAY SET", entries: [{ name: "Midnight Drive", path: "Live/Midnight Drive.wav" }, { name: "Slow Burn", path: "Live/Slow Burn.flac" }, { name: "Finale", path: "Live/Finale.wav" }] }]
};
const looper: Body = { type: "looper", status: "playing", hasLoop: true, position: 7.4, duration: 16.3, beats: 32, bars: 8, level: .9, feedback: .82, quantization: "bar", countIn: true, canUndo: true, canRedo: false, muted: false, waveform, maximumSeconds: 120, remainingSeconds: 103, savedLoops: ["verse-idea.wav", "ambient-bed.wav"] };
const recorder: Body = {
    type: "recorder", status: "recording", projectId: "rehearsal-01", projectName: "Friday Rehearsal", elapsed: 74.2, remainingSeconds: 6420,
    tracks: [
        { id: "processed", name: "Processed Guitar", source: "processed", armed: true, recording: true, mute: false, solo: false, level: .9, pan: 0 },
        { id: "backing", name: "Backing Track", source: "backing", armed: true, recording: true, mute: false, solo: false, level: .72, pan: 0 },
        { id: "drums", name: "Drum Machine", source: "drums", armed: true, recording: true, mute: false, solo: false, level: .78, pan: 0 }
    ]
};
const drums: Body = {
    type: "drums", playing: true, fillActive: false, activeVariation: 0, activePatternId: "pattern-rock", level: .78, swing: .08, humanization: .05, songMode: false, droppedTriggers: 0, droppedKitChanges: 0,
    kit: { id: "kit-studio", name: "STUDIO KIT", voices: ["KICK", "SNARE", "CLOSED HAT", "OPEN HAT", "TOM", "CRASH"].map((name, index) => ({ name, sample: `Studio/${name.toLowerCase().replaceAll(" ", "-")}.wav`, level: index < 2 ? 1 : .78, pan: index > 3 ? .2 : 0 })) },
    patterns: [{ id: "pattern-rock", name: "DRIVING ROCK", length: 16, voices: ["KICK", "SNARE", "CLOSED HAT", "OPEN HAT", "TOM", "CRASH"].map((_, index) => ({ velocities: drumVelocities.map((value, step) => index === 0 ? value : index === 1 ? ([4, 12].includes(step) ? 120 : 0) : index === 2 ? (step % 2 === 0 ? 72 : 0) : 0), accents: "0000000000000000" })) }],
    song: [{ variation: 0, repeats: 4 }, { variation: 1, repeats: 4 }, { variation: 2, repeats: 2 }]
};
const meters: Body = { type: "meters", running: true, dspLoad: .09, xruns: 0, bufferMs: 2.67, roundTripMs: 5.25, input: [.31, .08], output: [.27, .25], inputPeak: [.62, .12], outputPeak: [.55, .51] };

const uiSession: Body = {
    type: "uiSession",
    view: requestedView,
    viewHistory: [],
    editSubpage: variant === "controls" ? "controls" : variant === "io" ? "io" : "chain",
    editorPage: variant === "controls" ? "controls" : variant === "io" ? "io" : "chain",
    editorSelectedId: "slot-nam",
    plugins: { tab: variant === "install" ? "install" : "installed" },
    layoutEditor: { stage: variant === "snapshots" ? "snapshots" : "performance" },
    settings: {
        controllerPage: variant === "hardware" ? "hardware" : "hub",
        systemPage: variant === "realtime" ? "realtime" : "hub"
    }
};

const communityCatalog = {
    ok: true,
    presets: [
        { id: "studio-clean", name: "STUDIO CLEAN", author: "Tone Foundry", description: "Wide clean platform with a gentle compressor and plate.", tags: ["clean", "studio"] },
        { id: "british-stage", name: "BRITISH STAGE", author: "Amp Room", description: "Crunch rhythm and lead snapshots for a compact live rig.", tags: ["rock", "live", "nam"] },
        { id: "ambient-swells", name: "AMBIENT SWELLS", author: "Night Signal", description: "Volume swells into stereo delay and long reverb.", tags: ["ambient", "delay"] }
    ]
};

function responseFor(command: string): Body {
    if (command === "tone3000/status") return { ok: true, configured: true, authenticated: true, accountName: "Pi-MFX Player", publishableKey: "configured", redirectUri: `${window.location.origin}/` };
    if (command === "community/status") return { ok: true, enabled: true, submissionAvailable: true, submissionUrl: "https://github.com/MegaNoob75/Pi-MFX-Community-Presets/issues/new" };
    if (command === "community/catalog") return communityCatalog;
    if (command === "community/preset") return { ok: true, ...communityCatalog.presets[0], dependencies: { effects: [{ uri: "http://two-play.com/plugins/toob-nam" }], tone3000: [{ modelId: "12345", expectedFilename: "Deluxe-Clean.nam", kind: "model" }], irs: [{ expectedFilename: "Greenback-212.wav" }] } };
    if (command === "plugins/status") return { ok: true, helperOnline: true, recommended: [{ id: "toob", name: "TooB LV2", description: "NAM, cabinet IR and utility effects", installed: true }, { id: "mod-utilities", name: "MOD Utilities", description: "Meters, filters and routing tools", installed: false }] };
    if (command === "plugins/apt/list") return { ok: true, packages: [{ name: "calf-plugins", description: "Calf Studio Gear", installed: true }, { name: "mda-lv2", description: "Classic MDA effects", installed: false }] };
    if (command === "plugins/patchstorage/search") return { ok: true, items: [{ id: 101, name: "Stereo Tape Delay", author: "PatchStorage", description: "Tempo-aware stereo delay", downloads: 1800 }, { id: 102, name: "Shimmer Reverb", author: "PatchStorage", description: "Ambient pitch reverb", downloads: 1260 }], hasMore: false };
    if (command === "library" || command === "catalog") return { ok: true };
    if (command === "library/tree") return { ok: true, directories: ["TONE3000", "Cabinets", "Favorites"] };
    if (command === "library/list") return { ok: true, directory: "", items: [{ name: "TONE3000", path: "TONE3000", directory: true }, { name: "Deluxe-Clean.nam", path: "Deluxe-Clean.nam", size: 684213 }, { name: "British-Crunch.nam", path: "British-Crunch.nam", size: 721442 }] };
    if (command === "system/update/status") return { ok: true, phase: "idle", branch: "workstation", currentCommit: "workstation", remoteCommit: "workstation", updateAvailable: false, message: "Pi-MFX is up to date" };
    if (command === "hotspot/config") return { ok: true, mode: "wifi", connected: true, ssid: "Studio Network", ip: "192.168.1.42", hotspotSsid: "PI-MFX", hotspotIp: "10.42.0.1" };
    return { ok: true };
}

class DocsWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly url: string;
    readyState = DocsWebSocket.CONNECTING;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;

    constructor(url: string | URL) {
        this.url = String(url);
        window.setTimeout(() => {
            this.readyState = DocsWebSocket.OPEN;
            this.onopen?.(new Event("open"));
            [state, catalog, library, transport, backing, looper, recorder, drums, meters, uiSession].forEach((message) =>
                this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) }))
            );
        }, 10);
    }
    send(_data: string) { /* Documentation preview is read-only. */ }
    close() {
        this.readyState = DocsWebSocket.CLOSED;
    }
    addEventListener() { /* EngineClient uses on* handlers. */ }
    removeEventListener() { /* EngineClient uses on* handlers. */ }
    dispatchEvent() { return true; }
}

Object.assign(window, { WebSocket: DocsWebSocket });

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/api/")) return realFetch(input, init);
    const command = url.slice(url.indexOf("/api/") + 5).split("?")[0];
    return new Response(JSON.stringify(responseFor(command)), { status: 200, headers: { "Content-Type": "application/json" } });
};

function clickText(text: string, exact = true) {
    const deadline = Date.now() + 3000;
    const tryClick = () => {
        const button = Array.from(document.querySelectorAll("button")).find((item) => {
            const copy = item.textContent?.trim() ?? "";
            return exact ? copy === text : copy.startsWith(text);
        });
        if (button instanceof HTMLButtonElement) button.click();
        else if (Date.now() < deadline) window.setTimeout(tryClick, 50);
    };
    window.setTimeout(tryClick, 300);
}

if (variant === "legal") clickText("ABOUT / LEGAL");
if (variant === "menu") clickText("PI-MFX");
if (["options", "library", "pattern", "song", "kit", "share"].includes(variant)) {
    clickText(variant === "share" ? "SHARE PRESET" : variant.toUpperCase(), variant !== "library");
}
