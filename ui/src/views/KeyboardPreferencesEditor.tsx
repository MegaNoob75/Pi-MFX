import type { KeyboardSettings } from "../keyboard/settings";

/** Keyboard behavior stays independent of the selected color theme. */
export function KeyboardPreferencesEditor({ settings, onChange, onReset }: {
    settings: KeyboardSettings;
    onChange: (settings: KeyboardSettings) => void;
    onReset: () => void;
}) {
    const patch = (value: Partial<KeyboardSettings>) => onChange({ ...settings, ...value });
    return <section className="panel stack">
        <h3>KEYBOARD SIZE & BEHAVIOR</h3>
        <div className="muted">Changes are drafts until you choose APPLY KEYBOARD. Auto opens the keyboard on the Pi kiosk and tablets; Always opens it everywhere; Off uses a physical keyboard.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
            <label className="field"><span>Open on-screen keyboard</span>
                <select value={settings.mode} onChange={(event) => patch({ mode: event.target.value as KeyboardSettings["mode"] })}>
                    <option value="auto">Auto</option><option value="on">Always</option><option value="off">Off</option>
                </select>
            </label>
            <label className="field"><span>Key shape</span>
                <select value={settings.keyShape} onChange={(event) => patch({ keyShape: event.target.value as KeyboardSettings["keyShape"] })}>
                    <option value="rounded">Rounded</option><option value="square">Square</option>
                </select>
            </label>
            <label className="field"><span>Key text size</span>
                <select value={settings.textSize} onChange={(event) => patch({ textSize: event.target.value as KeyboardSettings["textSize"] })}>
                    <option value="normal">Normal</option><option value="large">Large</option><option value="extra-large">Extra large</option>
                </select>
            </label>
            <label className="field"><span>Keyboard size</span>
                <select value={settings.size} onChange={(event) => patch({ size: event.target.value as KeyboardSettings["size"] })}>
                    <option value="full">Full screen</option><option value="large">Large — 85%</option><option value="compact">Compact — 72%</option>
                </select>
            </label>
            <label className="field"><span>Screen position</span>
                <select value={settings.placement} onChange={(event) => patch({ placement: event.target.value as KeyboardSettings["placement"] })}>
                    <option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option>
                </select>
            </label>
            <label className="row"><input type="checkbox" checked={settings.hapticFeedback}
                onChange={(event) => patch({ hapticFeedback: event.target.checked })} />Touch vibration</label>
            <label className="row"><input type="checkbox" checked={settings.transparentBackground}
                onChange={(event) => patch({ transparentBackground: event.target.checked })} />Transparent backdrop & panel</label>
        </div>
        <button type="button" className="btn" onClick={onReset}>RESTORE KEYBOARD DEFAULTS</button>
    </section>;
}
