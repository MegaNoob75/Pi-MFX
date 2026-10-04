const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("ui/src/App.tsx");
const view = read("ui/src/views/TunerView.tsx");
const catalog = read("ui/src/tunerCatalog.ts");
const performance = read("ui/src/views/PerformanceView.tsx");
const icons = read("ui/src/theme/MenuIcon.tsx");
const engine = read("engine/src/Engine.cpp");
const model = read("engine/src/model/Model.cpp");

assert.match(app, /\| "tuner"/);
assert.match(app, /view === "tuner" && <TunerView/);
assert.match(app, /id: "tuner", view: "tuner"[\s\S]*icon: "tuner"/);
assert.match(icons, /tuner: \["M4 17a8 8/);
assert.match(app, /tunerToggle[\s\S]*history\.slice\(0, -1\)/);
assert.match(app, /request\("tuner\/output", \{ open: view === "tuner", muted: mute \}\)/);
assert.match(performance, /id === "tuner" \? \(\) => onOpenView\?\.\("tuner"\)/);
assert.match(view, /Needle[\s\S]*Strobe[\s\S]*Horizontal Bar[\s\S]*Arc[\s\S]*Minimal[\s\S]*Stage/);
for (const profile of ["guitar6", "guitar7", "guitar8", "guitar9", "guitar12", "bass4", "bass5", "bass6", "bass7", "bass8"]) {
    assert.match(catalog, new RegExp(`id: "${profile}"`));
}
assert.match(catalog, /standard12[\s\S]*\[\["E2", "E3"\][\s\S]*\["B3", "B3"\]/);
assert.match(catalog, /bass7LowFSharp[\s\S]*"F#0", "B0", "E1", "A1", "D2", "G2", "C3"/);
assert.match(catalog, /Drop D[\s\S]*Eb Standard[\s\S]*DADGAD[\s\S]*Open G[\s\S]*Open D/);
assert.match(view, /referencePitch[\s\S]*threshold[\s\S]*muteOnOpen[\s\S]*smoothing[\s\S]*tolerance/);
assert.match(view, /for \(const target of candidates\) for \(const harmonic of \[0\.5, 1, 2, 3, 4\]\)/);
assert.match(view, /CUSTOM TUNING[\s\S]*SAVE CUSTOM[\s\S]*DELETE SELECTED/);
assert.match(view, /Detection boost[\s\S]*Low-level cutoff/);
assert.match(view, /data-mfx-nav-list="tuner-strings"/);
assert.match(model, /json\.set\("tuner", tuner\.isObject\(\)/);
assert.match(engine, /request\.action == "tuner"[\s\S]*notifyUiView\("tunerToggle"\)/);
assert.match(engine, /tunerOutputGain_[\s\S]*outputs\[channel\]\[frame\] \*= tunerOutputGain_/);
assert.match(engine, /cumulative mean normalized difference[\s\S]*difference\[lag\] < 0\.18/);
assert.match(engine, /tunerDryMix_[\s\S]*dry - outputs\[channel\]\[frame\]/);
assert.match(engine, /tunerRing_\[write\] = source\[frame\] \* inputGain/);
assert.match(engine, /tunerExtendedRange_[\s\S]*captured\[i \* 2\]/);
assert.match(engine, /tunerAutoBoost_[\s\S]*0\.12f \/ std::max\(rms/);
assert.match(engine, /tunerJson\.set\("confidence", reading\.confidence\)/);

console.log("tuner view regression checks passed");
