import { useState } from "react";
import { num, str, type JsonObject } from "../json";

export function AboutView({ state }: { state: JsonObject }) {
    const [legalOpen, setLegalOpen] = useState(false);

    if (legalOpen) {
        return (
            <div className="mfx-screen">
                <div className="mfx-screen-intro">
                    <button type="button" className="btn-mfx" onClick={() => setLegalOpen(false)}>← BACK</button>
                    <div className="mfx-screen-intro-title" style={{ flex: 1, textAlign: "center" }}>ABOUT / LEGAL</div>
                    <div style={{ width: 76 }} />
                </div>
                <div className="page-scroll about-legal">
                    <section className="panel stack">
                        <h2>Pi-MFX</h2>
                        <InfoRow label="Version" value={str(state.version, "0.1.0")} />
                        <InfoRow label="Engine" value={str(state.audioBackend, "unknown")} />
                        <InfoRow label="Plugins" value={`${num(state.pluginCount)} loaded`} />
                        <p>
                            Pi-MFX is an original Raspberry Pi 5 guitar multi-effects system.
                            The audio engine, control protocol, preset format and ESP32 firmware
                            are written from scratch for this project. MIT license.
                        </p>
                    </section>
                    <section className="panel stack">
                        <h2>Third-party components</h2>
                        <p className="muted">
                            Linked, not pasted: LV2 / lilv (ISC), ALSA and libsndfile (LGPL),
                            libsamplerate (BSD-2-Clause), libcurl, React / Vite / TypeScript (MIT),
                            ESP-IDF (Apache-2.0), TinyUSB (MIT).
                        </p>
                        <p className="muted">
                            Full texts live in licenses/ on the Pi. LV2 plugins users install keep
                            their own licenses — see docs/PLUGIN_LICENSES.md.
                        </p>
                    </section>
                    <section className="panel stack">
                        <h2>TONE3000 and NAM</h2>
                        <p className="muted">
                            Pi-MFX can browse a signed-in user’s TONE3000 captures. It ships no
                            TONE3000 content. Neural Amp Modeler is the work of Steven Atkinson
                            and the NAM community. Impulse responses are supplied by the user.
                        </p>
                    </section>
                    <section className="panel stack">
                        <h2>Notices</h2>
                        <p className="muted">
                            See NOTICE.md and docs/THIRD_PARTY.md in the Pi-MFX tree for the
                            complete attribution record.
                        </p>
                    </section>
                </div>
            </div>
        );
    }

    return (
        <div className="mfx-screen">
            <div className="page-scroll">
                <div className="about-hero panel stack">
                    <div className="row">
                        <svg className="about-logo" viewBox="0 0 32 32" aria-hidden="true">
                            <path d="M6 22c0-7 4.2-13 10.4-15.4C14 10 13 14.2 13.6 18.2 16 16 19.6 15 23 16.2 20.8 20 16.8 23.2 12 24.2 9.6 24.6 7.6 23.8 6 22z" />
                        </svg>
                        <div>
                            <h2 style={{ margin: 0, fontSize: "1.7rem" }}>PI-MFX</h2>
                            <div className="muted">version {str(state.version, "0.1.0")}</div>
                        </div>
                    </div>
                    <div style={{ color: "var(--mfx-cyan)", fontWeight: 800 }}>
                        Headless guitar multi-fx for Raspberry Pi 5
                    </div>
                    <p>
                        Direct ALSA hardware I/O, in-process LV2, and a touchscreen control
                        surface. Not a fork of PiPedal or MODEP.
                    </p>
                    <InfoRow label="Engine" value={str(state.audioBackend, "unknown")} />
                    <InfoRow label="Plugins" value={`${num(state.pluginCount)} loaded`} />
                    <div className="row" style={{ marginTop: 8 }}>
                        <button type="button" className="btn-mfx" onClick={() => setLegalOpen(true)}>
                            ABOUT / LEGAL
                        </button>
                    </div>
                    <div className="muted">
                        Copyright Ross. MIT license. Third-party LV2 plugins keep their own
                        licenses.
                    </div>
                </div>
            </div>
        </div>
    );
}

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="about-info-row">
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}
