const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("ui/src/App.tsx");
const view = read("ui/src/views/TunerView.tsx");
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
assert.match(view, /Standard[\s\S]*Drop D[\s\S]*Eb Standard[\s\S]*D Standard[\s\S]*Open G[\s\S]*Open D/);
assert.match(view, /referencePitch[\s\S]*threshold[\s\S]*muteOnOpen[\s\S]*smoothing[\s\S]*tolerance/);
assert.match(view, /for \(const harmonic of \[0\.5, 1, 2, 3, 4\]\)[\s\S]*correctedFrequency = smoothFrequency \/ harmonic/);
assert.match(model, /json\.set\("tuner", tuner\.isObject\(\)/);
assert.match(engine, /request\.action == "tuner"[\s\S]*notifyUiView\("tunerToggle"\)/);
assert.match(engine, /tunerOutputGain_[\s\S]*outputs\[channel\]\[frame\] \*= tunerOutputGain_/);
assert.match(engine, /cumulative mean normalized difference[\s\S]*difference\[lag\] < 0\.18/);
assert.match(engine, /tunerDryMix_[\s\S]*dry - outputs\[channel\]\[frame\]/);
assert.match(engine, /tunerRing_\[write\] = source\[frame\] \* inputGain/);

console.log("tuner view regression checks passed");
