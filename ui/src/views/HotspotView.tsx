import { useEffect, useState } from "react";
import type { EngineSnapshot } from "../api";
import { bool, num, str, objects, type JsonObject } from "../json";
import { askText } from "../keyboard/ask";

type HotspotMode = "off" | "auto" | "always";

function asMode(value: string): HotspotMode {
    if (value === "auto" || value === "always") {
        return value;
    }
    return "off";
}

export function HotspotView({
    engine,
    run
}: {
    engine: EngineSnapshot & { client: import("../api").EngineClient };
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const [status, setStatus] = useState<JsonObject>({});
    const [ssid, setSsid] = useState("PI-MFX");
    const [password, setPassword] = useState("");
    const [mode, setMode] = useState<HotspotMode>("off");
    const [busy, setBusy] = useState(false);
    const [networks, setNetworks] = useState<JsonObject[]>([]);

    const applyStatus = (next: JsonObject) => {
        setStatus(next);
        setSsid(str(next.ssid, "PI-MFX"));
        if (str(next.password)) {
            setPassword(str(next.password));
        }
        setMode(asMode(str(next.mode, "off")));
        if (objects(next.networks).length) {
            setNetworks(objects(next.networks));
        }
        return next;
    };

    const refresh = async () => {
        const next = await engine.client.request("hotspot/config");
        return applyStatus(next);
    };

    useEffect(() => {
        void run(() => refresh().catch(() => ({})));
    }, [engine.client]);

    const save = (nextMode: HotspotMode) => {
        void run(async () => {
            setBusy(true);
            try {
                const next = await engine.client.request("hotspot/apply", {
                    mode: nextMode,
                    ssid,
                    password
                });
                applyStatus(next);
            } finally {
                setBusy(false);
            }
        });
    };

    const scan = () => {
        void run(async () => {
            setBusy(true);
            try {
                const next = await engine.client.request("hotspot/wifi-scan");
                applyStatus(next);
                setNetworks(objects(next.networks));
            } finally {
                setBusy(false);
            }
        });
    };

    const joinNetwork = (network: JsonObject) => {
        const name = str(network.ssid);
        if (!name) {
            return;
        }
        const open = bool(network.open);
        const connect = (psk: string) => {
            void run(async () => {
                setBusy(true);
                try {
                    const next = await engine.client.request("hotspot/wifi-connect", {
                        ssid: name,
                        password: psk
                    });
                    applyStatus(next);
                    setMode("off");
                } finally {
                    setBusy(false);
                }
            });
        };
        if (open) {
            connect("");
            return;
        }
        void askText(`Password for ${name}`, "").then((psk) => {
            if (psk) {
                connect(psk);
            }
        });
    };

    const active = bool(status.active);
    const helper = bool(status.helperAvailable, true);
    const url = str(status.url);
    const ip = str(status.ip);
    const device = str(status.device);
    const liveError = str(status.error);
    const stationSsid = str(status.stationSsid);
    const stationConnected = bool(status.stationConnected);
    const joinBlocked = mode === "always" || active;

    return (
        <div className="mfx-screen">
            <div className="mfx-screen-intro">
                <div className="mfx-screen-intro-title">WIFI / HOTSPOT</div>
                <div className="mfx-screen-intro-sub">
                    Join a home network or host a tablet access point
                </div>
            </div>
            <div className="page-scroll stack">
                <div className="panel stack">
                    <h2>JOIN A NETWORK</h2>
                    <div className="muted">
                        Raspberry Pi boards cannot stay on home Wi-Fi and host a hotspot on the
                        same radio at once. Connecting to a network turns the hotspot OFF. A tablet
                        using the PI-MFX access point will drop unless it is also on that home
                        network.
                    </div>
                    <div className="muted">
                        {stationConnected
                            ? `Connected to ${stationSsid}`
                            : "Not connected to a Wi-Fi network"}
                    </div>
                    {joinBlocked && (
                        <div className="muted">
                            Turn the hotspot OFF (or AUTO) before scanning or joining a home network.
                        </div>
                    )}
                    <div className="row">
                        <button type="button" className="btn" disabled={busy || joinBlocked || !helper} onClick={scan}>
                            SCAN
                        </button>
                        {stationConnected && (
                            <button type="button" className="btn" disabled={busy || !helper} onClick={() => {
                                void run(async () => {
                                    setBusy(true);
                                    try {
                                        applyStatus(await engine.client.request("hotspot/wifi-disconnect"));
                                    } finally {
                                        setBusy(false);
                                    }
                                });
                            }}>
                                DISCONNECT
                            </button>
                        )}
                    </div>
                    {networks.map((network) => (
                        <button
                            key={str(network.ssid)}
                            type="button"
                            className={`list-item ${bool(network.inUse) ? "selected" : ""}`}
                            disabled={busy || joinBlocked}
                            onClick={() => joinNetwork(network)}
                        >
                            <div>
                                <strong>{str(network.ssid)}</strong>
                                <div className="muted">
                                    {num(network.signal)}%
                                    {str(network.security) ? ` · ${str(network.security)}` : " · open"}
                                    {bool(network.inUse) ? " · connected" : ""}
                                </div>
                            </div>
                            <span className="muted">{bool(network.open) ? "JOIN" : "PASSWORD"}</span>
                        </button>
                    ))}
                </div>
                <div className="panel stack">
                    <h2>WI-FI ACCESS POINT</h2>
                    <div className="muted">
                        AUTO starts the PI-MFX network when this Pi has no ethernet and no other
                        Wi-Fi, so a tablet can join it at a gig. ALWAYS keeps the hotspot up. OFF
                        leaves Wi-Fi for the home network.
                    </div>
                    <div className="row">
                        <button type="button" className={`btn ${mode === "off" ? "btn-active" : ""}`}
                            disabled={busy} onClick={() => save("off")}>
                            OFF
                        </button>
                        <button type="button" className={`btn ${mode === "auto" ? "btn-active" : ""}`}
                            disabled={busy} onClick={() => save("auto")}>
                            AUTO
                        </button>
                        <button type="button" className={`btn ${mode === "always" ? "btn-active" : ""}`}
                            disabled={busy} onClick={() => save("always")}>
                            ALWAYS
                        </button>
                    </div>
                    <label className="field">
                        <span>Network name</span>
                        <input value={ssid} maxLength={32} autoComplete="off"
                            onChange={(event) => setSsid(event.target.value)}
                            onBlur={() => {
                                if (mode !== "off") {
                                    save(mode);
                                }
                            }} />
                    </label>
                    <label className="field">
                        <span>Password (8+ characters)</span>
                        <input value={password} maxLength={63} autoComplete="off"
                            onChange={(event) => setPassword(event.target.value)}
                            onBlur={() => {
                                if (mode !== "off") {
                                    save(mode);
                                }
                            }} />
                    </label>
                    <div className="row">
                        <button type="button" className="btn" disabled={busy} onClick={() => {
                            const generated = Array.from(crypto.getRandomValues(new Uint8Array(8)))
                                .map((byte) => byte.toString(16).padStart(2, "0")).join("");
                            setPassword(generated);
                        }}>
                            GENERATE PASSWORD
                        </button>
                        <button type="button" className="btn" disabled={busy} onClick={() => save(mode)}>
                            APPLY
                        </button>
                    </div>
                </div>
                <div className="panel stack">
                    <h2>STATUS</h2>
                    {!helper && (
                        <div className="muted">
                            The hotspot helper is not running. On the Pi run
                            {" "}sudo bash ./scripts/pimfx.sh update
                        </div>
                    )}
                    <div className="muted">
                        {active ? "Hotspot is on" : "Hotspot is off"}
                        {device ? ` · ${device}` : ""}
                        {stationConnected ? ` · station ${stationSsid}` : ""}
                        {bool(status.otherConnection) ? " · another network is connected" : ""}
                    </div>
                    {active && (
                        <div className="muted">
                            On a tablet, join <strong>{str(status.ssid, ssid)}</strong>
                            {password ? `, password ${password}` : ""}.
                            Then open {url || (ip ? `http://${ip}:8080` : "http://10.42.0.1:8080")}.
                        </div>
                    )}
                    {liveError && <div className="muted">{liveError}</div>}
                </div>
            </div>
        </div>
    );
}
