import { useState } from "react";
import { num, str, type JsonObject } from "../json";

const MIT_URL = "https://opensource.org/licenses/MIT";
const REPO_URL = "https://github.com/MegaNoob75/Pi-MFX";

export function buildIdentity(state: JsonObject) {
    const engineGitSha = str(state.gitSha);
    return {
        version: str(state.version, "0.1.0"),
        gitSha: engineGitSha && engineGitSha !== "unknown"
            ? engineGitSha
            : import.meta.env.VITE_PIMFX_GIT_SHA || ""
    };
}

export function AboutView({ state }: { state: JsonObject }) {
    const [legalOpen, setLegalOpen] = useState(false);
    const { version, gitSha } = buildIdentity(state);

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
                        <InfoRow label="Version" value={version} />
                        {gitSha && <InfoRow label="Commit" value={gitSha} />}
                        <InfoRow label="Engine" value={str(state.audioBackend, "unknown")} />
                        <InfoRow label="Plugins" value={`${num(state.pluginCount)} loaded`} />
                        <p>
                            Pi-MFX is an original Raspberry Pi 5 guitar multi-effects system.
                            Copyright Ross Morgenstern. Released under the{" "}
                            <a href={MIT_URL} target="_blank" rel="noopener noreferrer">MIT License</a>.
                        </p>
                        <p className="muted">
                            Anyone on the same local network or hotspot can open this UI and
                            control the Pi. There is no login on the LAN HTTP or WebSocket APIs.
                        </p>
                    </section>
                    <section className="panel stack">
                        <h2>Third-party components</h2>
                        <p className="muted">
                            Linked, not pasted. License texts live in licenses/ on the Pi.
                        </p>
                        <LegalLink name="LV2 / lilv" href="https://lv2plug.in/" note="ISC" />
                        <LegalLink name="ALSA" href="https://www.alsa-project.org/" note="LGPL-2.1-or-later" />
                        <LegalLink name="libsndfile" href="https://libsndfile.github.io/libsndfile/" note="LGPL-2.1-or-later" />
                        <LegalLink name="libsamplerate" href="http://libsndfile.github.io/libsamplerate/" note="BSD-2-Clause" />
                        <LegalLink name="libcurl" href="https://curl.se/docs/copyright.html" note="curl / MIT-X" />
                        <LegalLink name="React / Vite / TypeScript" href="https://opensource.org/licenses/MIT" note="MIT" />
                        <LegalLink name="ESP-IDF" href="https://github.com/espressif/esp-idf" note="Apache-2.0" />
                        <LegalLink name="TinyUSB" href="https://github.com/hathach/tinyusb" note="MIT" />
                        <p className="muted">
                            LV2 plugins you install keep their own licenses — see{" "}
                            <span className="about-path">docs/PLUGIN_LICENSES.md</span>.
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
                        <h2>Source and notices</h2>
                        <p className="muted">
                            Source:{" "}
                            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">{REPO_URL}</a>
                        </p>
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
                            <div className="muted">version {version}</div>
                            {gitSha && <div className="muted">{gitSha}</div>}
                        </div>
                    </div>
                    <div style={{ color: "var(--mfx-cyan)", fontWeight: 800 }}>
                        Headless guitar multi-fx for Raspberry Pi 5
                    </div>
                    <p>
                        Direct ALSA hardware I/O, in-process LV2, and a touchscreen control
                        surface.
                    </p>
                    <InfoRow label="Engine" value={str(state.audioBackend, "unknown")} />
                    <InfoRow label="Plugins" value={`${num(state.pluginCount)} loaded`} />
                    <div className="row" style={{ marginTop: 8 }}>
                        <button type="button" className="btn-mfx" onClick={() => setLegalOpen(true)}>
                            ABOUT / LEGAL
                        </button>
                    </div>
                    <div className="muted">
                        Copyright Ross Morgenstern.{" "}
                        <a href={MIT_URL} target="_blank" rel="noopener noreferrer">MIT license</a>.
                        {" "}Third-party LV2 plugins keep their own licenses.
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

function LegalLink({ name, href, note }: { name: string; href: string; note: string }) {
    return (
        <div className="about-info-row">
            <span>{name}</span>
            <strong>
                <a href={href} target="_blank" rel="noopener noreferrer">{note}</a>
            </strong>
        </div>
    );
}
