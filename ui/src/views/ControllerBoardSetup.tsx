import { useEffect, useId, useRef, useState } from "react";
import type { EngineClient } from "../api";
import { arr, bool, num, obj, objects, str, type JsonObject } from "../json";
import { ConfirmDialog } from "./ConfirmDialog";

const busyPhases = new Set(["reading", "searching", "proposing", "review", "saving"]);
const pinText = (entry: JsonObject) => num(entry.kind) === 3
    ? `A GPIO ${num(entry.pinA)}, B GPIO ${num(entry.pinB)}, ${num(entry.steps)} transitions per click`
    : `GPIO ${num(entry.pinA)}${num(entry.kind) === 2 ? `, range ${num(entry.minimum)}–${num(entry.maximum)}` : ""}`;

export function ControllerBoardSetup({ controller, selected, client, run }: {
    controller: JsonObject;
    selected?: JsonObject;
    client: EngineClient;
    run: (work: () => Promise<unknown>) => Promise<void>;
}) {
    const board = obj(controller.boardSetup);
    const active = obj(board.active);
    const controls = objects(controller.controls);
    const phase = str(board.phase, "idle");
    const busy = busyPhases.has(phase);
    const ready = bool(board.ready) && bool(board.storageReady) && bool(controller.connected);
    const [expanded, setExpanded] = useState(false);
    const [section, setSection] = useState<"control" | "leds" | "wiring" | "recovery">("control");
    const advancedRef = useRef<HTMLDivElement>(null);
    const advancedId = useId();
    const advancedTitleId = useId();
    useEffect(() => {
        if (!expanded) return;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        advancedRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
        const keydown = (event: KeyboardEvent) => {
            if (document.querySelector(".mfx-overlay")) return;
            if (event.key === "Escape") { event.preventDefault(); setExpanded(false); }
            if (event.key !== "Tab") return;
            const fields = Array.from(advancedRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)") ?? []);
            if (!fields.length) return;
            const index = fields.indexOf(document.activeElement as HTMLElement);
            const next = event.shiftKey ? (index <= 0 ? fields.length - 1 : index - 1) : (index + 1) % fields.length;
            event.preventDefault(); fields[next].focus();
        };
        document.addEventListener("keydown", keydown, true);
        return () => { document.removeEventListener("keydown", keydown, true); if (previous?.isConnected) previous.focus(); };
    }, [expanded]);
    const [targetId, setTargetId] = useState("");
    const selectedId = str(selected?.id);
    useEffect(() => setTargetId(selectedId), [selectedId]);
    const control = controls.find((c) => str(c.id) === targetId) ?? selected;
    const id = str(control?.id);
    const wiring = obj(control?.hardware);
    const kind = str(control?.kind);
    const analog = ["pot", "slider", "expression"].includes(kind);
    const encoder = kind === "encoder";
    const paired = controls.find((c) => str(c.id) === str(selected?.pairId));
    const [pinA, setPinA] = useState("127"), [pinB, setPinB] = useState("127");
    const [steps, setSteps] = useState("4"), [debounce, setDebounce] = useState("20");
    const [minimum, setMinimum] = useState("0"), [maximum, setMaximum] = useState("4095");
    const [ledPin, setLedPin] = useState("48"), [ledCount, setLedCount] = useState("8"), [ledOrder, setLedOrder] = useState("0");
    const [testPixel, setTestPixel] = useState("0");
    const revision = num(active.revision);
    useEffect(() => {
        setPinA(String(num(wiring.pinA, 127))); setPinB(String(num(wiring.pinB, 127)));
        setSteps(String(num(wiring.steps, 4))); setDebounce(String(num(wiring.debounce, 20)));
        setMinimum(String(num(wiring.minimum))); setMaximum(String(num(wiring.maximum, 4095)));
    }, [id, revision, wiring.pinA, wiring.pinB, wiring.steps, wiring.debounce, wiring.minimum, wiring.maximum]);
    useEffect(() => {
        setLedPin(String(num(active.ledPin, 48) === 127 ? 48 : num(active.ledPin)));
        setLedCount(String(num(active.ledCount))); setLedOrder(String(num(active.ledOrder)));
    }, [revision, active.device, active.ledPin, active.ledCount, active.ledOrder]);
    const request = (action: string, values: JsonObject = {}) =>
        void run(() => client.request("controller/hardware", { action, ...values }));
    const numeric = (text: string) => text.trim() === "" ? -1 : Number(text);
    const fields = { controlId: id, pinA: Number(pinA), pinB: Number(pinB), steps: numeric(steps),
        debounce: numeric(debounce), minimum: numeric(minimum), maximum: numeric(maximum) };
    const pins = arr(analog ? board.analogPins : board.inputPins).map((p) => num(p));
    const options = (values: number[]) => <>
        <option value="127">Choose pin</option>
        {values.map((p) => <option key={p} value={p}>GPIO {p}</option>)}
    </>;
    const candidate = obj(board.candidate);
    const candidateControls = objects(candidate.controls);
    const pending = candidateControls.find((c) => num(c.slot) === num(board.slot, -1));
    const operation = str(board.operation);
    const targetControl = controls.find((c) => str(c.id) === str(board.target));
    const summary = ["remove", "delete"].includes(operation)
        ? `Remove ${str(targetControl?.label, "this control")}${operation === "delete" ? " and its paired button, if present" : "’s wiring"}.`
        : pending ? `${str(targetControl?.label, "Control")}: ${pinText(pending)}.`
        : `${candidateControls.length} controls; ${num(candidate.ledCount)} LEDs${num(candidate.ledCount) ? ` on GPIO ${num(candidate.ledPin)}` : ""}.`;
    const reviewSlots = [...new Set([...objects(active.controls), ...candidateControls].map((c) => num(c.slot)))];
    const searching = phase === "searching";
    const searchingControl = controls.find((c) => str(c.id) === str(board.target));
    const searchingKind = str(searchingControl?.kind);
    const learningAnalog = ["pot", "slider", "expression"].includes(searchingKind);
    const learnStage = str(board.learnStage);
    const instruction = searchingKind === "encoder"
        ? "Wait one second, turn only this encoder clockwise at least four clicks, then stop."
        : learningAnalog
            ? learnStage === "minimum" ? "Step 1 of 2: Turn this control to its 0 / minimum position. Keep it still, then tap SET MINIMUM. You have three minutes."
                : learnStage === "maximum" ? "Step 2 of 2: Slowly turn only this control all the way to maximum. Keep it still, then tap SET MAXIMUM. You have three minutes."
                : learnStage === "starting" ? "Starting calibration. Keep the other controls still."
                : "Reading the position. Keep this control still…"
            : "Wait one second, then press and release only this switch. For a latching switch, change its position.";
    const calibration = <>
        {str(board.message) && str(board.message) !== "Controller wiring read successfully." && <div role="status" className={phase === "error" ? "danger" : "muted"}>{str(board.message)}</div>}
        {searching && <div role="status">{instruction}</div>}
        {searching && learningAnalog && <div className="row">
            <button type="button" className="btn btn-accent" disabled={learnStage !== "minimum" && learnStage !== "maximum"}
                onClick={() => request("capture")}>
                {learnStage === "minimum" ? "SET MINIMUM" : learnStage === "maximum" ? "SET MAXIMUM" : "READING POSITION…"}
            </button>
        </div>}
        {phase === "saving" && <div role="status">Saving on controller and checking the result…</div>}
    </>;
    return <section className="controller-board-setup" aria-label="ESP32 wiring setup">
        <div className="row">
            <strong>ESP32-S3 · {busy ? phase.toUpperCase() : ready ? "READY" : "READ BOARD TO SET UP"}</strong>
            <button type="button" className="btn" disabled={busy} onClick={() => request("read")}>READ BOARD</button>
            <button type="button" className={`btn${expanded ? " btn-active" : ""}`} aria-expanded={expanded} aria-controls={advancedId} onClick={() => setExpanded(!expanded)}>WIRING &amp; RECOVERY</button>
            {busy && phase !== "review" && phase !== "saving" &&
                <button type="button" className="btn" onClick={() => request("cancel")}>CANCEL SETUP</button>}
        </div>
        {!expanded && calibration}
        {expanded && <div id={advancedId} ref={advancedRef} className="controller-wiring-overlay" role="dialog" aria-modal="true" aria-labelledby={advancedTitleId}>
            <div className="controller-wiring-header">
                <strong id={advancedTitleId}>WIRING &amp; RECOVERY</strong>
                <button type="button" className="btn" disabled={busy} onClick={() => request("read")}>READ BOARD</button>
                <button type="button" className="btn" onClick={() => setExpanded(false)}>DONE</button>
            </div>
            <div className="controller-wiring-tabs" aria-label="Wiring sections">
                {([ ["control", "CONTROL"], ["leds", "LEDs"], ["wiring", "SAVED WIRING"], ["recovery", "RECOVERY"] ] as const).map(([key, label]) =>
                    <button key={key} type="button" className={`btn${section === key ? " btn-active" : ""}`} aria-pressed={section === key} onClick={() => setSection(key)}>{label}</button>)}
            </div>
            <div className="stack controller-board-advanced">
                {calibration}
                {busy && phase !== "review" && phase !== "saving" && <button type="button" className="btn" onClick={() => request("cancel")}>CANCEL SETUP</button>}
                {section === "control" && <p className="muted">ESP32-S3 direct wiring: switches and encoders connect to ground; pots use 3.3 V and ground. Select a control in Hardware Setup to edit its connection.</p>}
                {section === "control" && selected && <fieldset disabled={!ready || busy} className="stack">
                    <legend>{str(control?.label, "Control")} · connection</legend>
                    {paired && <label className="field"><span>Control</span><select value={id} onChange={(e) => setTargetId(e.target.value)}>
                        <option value={selectedId}>{str(selected.label, "Encoder")}</option>
                        <option value={str(paired.id)}>{str(paired.label, "Push button")}</option>
                    </select></label>}
                    <div className="hardware-field-grid">
                        <label className="field"><span>{encoder ? "A pin" : "Input pin"}</span><select value={pinA} onChange={(e) => setPinA(e.target.value)}>{options(pins)}</select></label>
                        {encoder && <label className="field"><span>B pin</span><select value={pinB} onChange={(e) => setPinB(e.target.value)}>{options(pins)}</select></label>}
                        {encoder && <label className="field"><span>Transitions per click</span><select value={steps} onChange={(e) => setSteps(e.target.value)}>{[1,2,4,8].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
                        {!analog && !encoder && <label className="field"><span>Debounce (ms)</span><input type="number" min={5} max={80} value={debounce} onChange={(e) => setDebounce(e.target.value)} /></label>}
                        {analog && <>
                            <label className="field"><span>Minimum raw reading</span><input type="number" min={0} max={4095} value={minimum} onChange={(e) => setMinimum(e.target.value)} /></label>
                            <label className="field"><span>Maximum raw reading</span><input type="number" min={0} max={4095} value={maximum} onChange={(e) => setMaximum(e.target.value)} /></label>
                        </>}
                    </div>
                    <div className="row">
                        <button type="button" className="btn" onClick={() => request("manual", fields)}>REVIEW WIRING</button>
                        <button type="button" className="btn" onClick={() => request("learn", { controlId: id, steps: numeric(steps), debounce: numeric(debounce) })}>LEARN CONNECTION</button>
                        {str(wiring.device) === str(active.device) && <button type="button" className="btn btn-danger" onClick={() => request("remove", { controlId: id })}>REMOVE WIRING</button>}
                    </div>
                    <span className="muted">{str(wiring.device) === str(active.device) ? pinText(wiring) : "No wiring confirmed on this controller."}</span>
                </fieldset>}
                {section === "leds" && <fieldset disabled={!ready || busy} className="stack">
                    <legend>NeoPixel / WS2812 LEDs</legend>
                    <div className="hardware-field-grid">
                        <label className="field"><span>Data pin</span><select value={ledPin} onChange={(e) => setLedPin(e.target.value)}>{options(arr(board.outputPins).map((p) => num(p)))}</select></label>
                        <label className="field"><span>Pixel count (0 disables)</span><input type="number" min={0} max={127} value={ledCount} onChange={(e) => setLedCount(e.target.value)} /></label>
                        <label className="field"><span>Colour order</span><select value={ledOrder} onChange={(e) => setLedOrder(e.target.value)}><option value="0">GRB</option><option value="1">RGB</option></select></label>
                    </div>
                    <button type="button" className="btn" onClick={() => request("leds", { pin: Number(ledPin), count: numeric(ledCount), order: Number(ledOrder) })}>REVIEW LED WIRING</button>
                    <div className="row">
                        <label className="field"><span>Test saved pixel (index)</span><input type="number" min={0} max={126} value={testPixel} onChange={(e) => setTestPixel(e.target.value)} /></label>
                        <button type="button" className="btn" disabled={num(active.ledCount) === 0} onClick={() => request("test-led", { index: numeric(testPixel) })}>TEST PIXEL</button>
                    </div>
                </fieldset>}
                {section === "recovery" && <><div className="controller-recovery-actions">
                    <button type="button" className="btn" disabled={!ready || busy} onClick={() => request("adopt")}>USE BOARD CONTROLS</button>
                    <button type="button" className="btn" disabled={!ready || busy || !controller.boardHardware} onClick={() => request("restore")}>REVIEW SAVED WIRING</button>
                    <button type="button" className="btn" disabled={!ready || busy} onClick={() => request("default")}>DEFAULT WIRING TEMPLATE</button>
                    <button type="button" className="btn btn-danger" disabled={!ready || busy} onClick={() => request("clear")}>CLEAR BOARD WIRING</button>
                </div>
                <span className="muted">Profiles and backups retain wiring. Loading them never changes a connected board automatically. Use Review Saved Wiring to apply them. Use Board Controls adds missing controls to Pi-MFX without changing the board. Expansion modules require their own supported driver.</span></>}
                {section === "wiring" && (objects(active.controls).length > 0 ? <div className="controller-wiring-summary"><table>
                    <thead><tr><th>Control</th><th>Connection</th><th>MIDI</th></tr></thead>
                    <tbody>{objects(active.controls).map((e) => <tr key={num(e.slot)}>
                        <td>{str(controls.find((c) => str(obj(c.hardware).device) === str(active.device) && num(obj(c.hardware).slot, -1) === num(e.slot))?.label, `Slot ${num(e.slot) + 1}`)}</td>
                        <td>{pinText(e)}</td><td>Ch {num(e.channel)} CC {num(e.cc)}</td>
                    </tr>)}</tbody>
                </table></div> : <p className="muted">No saved controls on this board. Read Board to refresh the list.</p>)}
            </div>
        </div>}
        {phase === "review" && <ConfirmDialog title={operation === "learn" ? "CONNECTION DETECTED" : "APPLY BOARD WIRING?"}
            body={`${summary} ${["restore", "default", "clear"].includes(operation) ? "This replaces the board’s wiring configuration. Check your physical connections first. " : ""}Confirm to save on the ESP32. Performance controls are paused until setup finishes.`}
            confirmLabel="SAVE ON CONTROLLER" danger={["clear", "delete"].includes(operation)}
            onCancel={() => request("cancel")} onConfirm={() => request("confirm")}>
            <div className="controller-wiring-summary"><table>
                <thead><tr><th>Slot</th><th>Current wiring</th><th>Proposed wiring</th></tr></thead>
                <tbody>{reviewSlots.map((slot) => {
                    const before = objects(active.controls).find((e) => num(e.slot) === slot);
                    const after = candidateControls.find((e) => num(e.slot) === slot);
                    if (JSON.stringify(before) === JSON.stringify(after)) return null;
                    return <tr key={slot}><td>{slot + 1}</td><td>{before ? pinText(before) : "Unused"}</td><td>{after ? pinText(after) : "Removed"}</td></tr>;
                })}</tbody>
            </table></div>
            <p>LEDs: {num(active.ledCount)} on GPIO {num(active.ledPin) === 127 ? "—" : num(active.ledPin)} → {num(candidate.ledCount)} on GPIO {num(candidate.ledPin) === 127 ? "—" : num(candidate.ledPin)}.</p>
        </ConfirmDialog>}
    </section>;
}
