const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(path.resolve(__dirname, "../src/tunerCatalog.ts"), "utf8");
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const moduleValue = { exports: {} };
new Function("exports", "module", "require", compiled)(moduleValue.exports, moduleValue, require);
const catalog = moduleValue.exports;

const ids = catalog.INSTRUMENTS.map((item) => item.id);
assert.deepEqual(ids, ["chromatic", "guitar6", "guitar7", "guitar8", "guitar9", "guitar12", "bass4", "bass5", "bass6", "bass7", "bass8"]);
for (const profile of catalog.INSTRUMENTS.filter((item) => item.id !== "chromatic")) {
    assert.ok(profile.presets.length > 0, `${profile.id} has presets`);
    for (const preset of profile.presets) {
        assert.ok(preset.courses.length > 0, `${preset.id} has courses`);
        assert.ok(preset.courses.every((course) => course.length && course.every(catalog.isNoteName)), `${preset.id} uses valid notes`);
    }
}
assert.equal(catalog.tuningSummary(catalog.instrumentById("guitar6").presets[0]), "E2 A2 D3 G3 B3 E4");
assert.equal(catalog.tuningSummary(catalog.instrumentById("guitar12").presets[0]), "E2/E3 A2/A3 D3/D4 G3/G4 B3/B3 E4/E4");
assert.equal(catalog.tuningSummary(catalog.instrumentById("bass7").presets[1]), "F#0 B0 E1 A1 D2 G2 C3");
assert.equal(catalog.transposeNote("E2", 3), "G2");
assert.equal(catalog.normalizeNote("Eb2"), "D#2");
assert.equal(catalog.normalizeNote("Cb2"), "B1");
assert.equal(catalog.noteMidi("B0"), 23);

console.log("tuner catalog regression checks passed");
