import { useEffect, useState } from "react";
import { askPassword } from "../keyboard/ask";
import { bool, str, type JsonObject } from "../json";

async function accessRequest(action: string, payload?: JsonObject): Promise<JsonObject> {
    const response = await fetch(`/access/${action}`, payload ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    } : undefined);
    const result = await response.json() as JsonObject;
    if (!response.ok) throw new Error(str(result.error, "Could not update access settings."));
    return result;
}

export function AccessSettings() {
    const [local, setLocal] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    useEffect(() => {
        let mounted = true;
        void accessRequest("status").then((result) => {
            if (!mounted) return;
            setLocal(bool(result.local));
            setEnabled(bool(result.enabled));
            setReady(true);
        }).catch((error: unknown) => {
            if (mounted) setMessage(error instanceof Error ? error.message : String(error));
        });
        return () => { mounted = false; };
    }, []);

    const setPassword = async () => {
        setBusy(true);
        setMessage("");
        try {
            let currentPassword = "";
            if (!local && enabled) {
                const current = await askPassword("Current Pi-MFX password");
                if (current === null) return;
                currentPassword = current;
            }
            const password = await askPassword("New Pi-MFX password (4–128 characters)");
            if (password === null) return;
            if (password.length < 4 || password.length > 128) {
                setMessage("Use a password of 4 to 128 characters.");
                return;
            }
            const confirmation = await askPassword("Confirm Pi-MFX password");
            if (confirmation === null) return;
            if (password !== confirmation) {
                setMessage("Passwords do not match.");
                return;
            }
            await accessRequest("password", { password, currentPassword });
            if (!local) {
                window.location.replace("/");
                return;
            }
            setEnabled(true);
            setMessage("Password saved. Remote browsers must sign in again.");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="panel stack" style={{ gridColumn: "1 / -1" }}>
            <h2>REMOTE ACCESS PASSWORD</h2>
            <div className="muted">
                {enabled ? "Remote access requires your Pi-MFX password."
                    : "Remote access is locked until you set a Pi-MFX password."}
                {" "}The Pi touchscreen stays unlocked. This password is separate from Wi-Fi and SSH.
                {" "}Signed-in browsers stay remembered until you lock them or change the password, including Pi restarts.
            </div>
            <div className="row">
                <button type="button" className="btn" disabled={!ready || busy}
                    onClick={() => void setPassword()}>
                    {enabled ? "CHANGE PASSWORD" : "SET PASSWORD"}
                </button>
                {!local && (
                    <>
                        <div className="muted">Changing the password requires your current password.</div>
                        <button type="button" className="btn" disabled={!ready || busy} onClick={() => {
                            setBusy(true);
                            void accessRequest("logout", {}).then(() => window.location.replace("/"))
                                .catch((error: unknown) => {
                                    setMessage(error instanceof Error ? error.message : String(error));
                                    setBusy(false);
                                });
                        }}>LOCK THIS BROWSER</button>
                    </>
                )}
            </div>
            <div className="muted">HTTP connections are not encrypted. Use a trusted network.</div>
            {message && <div className="muted" role="status">{message}</div>}
        </div>
    );
}
