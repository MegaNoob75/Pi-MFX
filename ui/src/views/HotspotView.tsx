import { useEffect, useState } from "react";
import type { EngineSnapshot } from "../api";
import { bool, str, type JsonObject } from "../json";

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

    const refresh = async () => {
        const next = await engine.client.request("hotspot/config");
        setStatus(next);
        setSsid(str(next.ssid, "PI-MFX"));
        setPassword(str(next.password));
        setMode(asMode(str(next.mode, "off")));
        return next;
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
                setStatus(next);
                setSsid(str(next.ssid, ssid));
                setPassword(str(next.password, password));
                setMode(asMode(str(next.mode, nextMode)));
            } finally {
                setBusy(false);
            }
        });
    };

    const active = bool(status.active);
    const helper = bool(status.helperAvailable, true);
    const url = str(status.url);
    const ip = str(status.ip);
    const device = str(status.device);
    const liveError = str(status.error);

    return (
        <div className="mfx-screen">
            <div className="mfx-screen-intro">
                <div className="mfx-screen-intro-title">HOTSPOT</div>
                <div className="mfx-screen-intro-sub">
                    Tablet control when this Pi has no other network
                </div>
            </div>
            <div className="page-scroll stack">
                <div className="panel stack">
                    <h2>WI-FI ACCESS POINT</h2>
                    <div className="muted">
                        Raspberry Pi boards cannot stay on home Wi-Fi and host a hotspot on the
                        same radio at once. AUTO starts the PI-MFX network when this Pi has no
                        ethernet and no other Wi-Fi, so a tablet can join it at a gig. ALWAYS
                        keeps the hotspot up. OFF leaves Wi-Fi for the home network.
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
