import { num, str, type JsonObject } from "../json";

export function AboutView({ state }: { state: JsonObject }) {
    return (
        <div className="page-scroll">
            <div className="panel stack">
                <div className="row">
                    <svg className="about-logo" viewBox="0 0 32 32" aria-hidden="true">
                        <path d="M6 22c0-7 4.2-13 10.4-15.4C14 10 13 14.2 13.6 18.2 16 16 19.6 15 23 16.2 20.8 20 16.8 23.2 12 24.2 9.6 24.6 7.6 23.8 6 22z" />
                    </svg>
                    <div>
                        <h2 style={{ margin: 0 }}>PI-MFX</h2>
                        <div className="muted">version {str(state.version, "0.1.0")}</div>
                    </div>
                </div>
                <p>
                    An original Raspberry Pi 5 guitar multi-effects pedalboard. Direct ALSA hardware I/O,
                    in-process LV2, and a browser control surface. Not a fork of PiPedal or MODEP.
                </p>
                <p className="muted">
                    Copyright Ross. MIT license. Third-party LV2 plugins keep their own licenses —
                    see docs/PLUGIN_LICENSES.md on the Pi.
                </p>
                <p className="muted">
                    Engine backend: {str(state.audioBackend, "unknown")} · {num(state.pluginCount)} plugins loaded.
                </p>
            </div>
        </div>
    );
}
