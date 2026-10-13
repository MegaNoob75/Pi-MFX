import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/views/cabinetBlend.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { blendRange, blendLevels } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const cabinets = Array.from({ length: 3 }, (_, index) => ({ index, min: -40, max: 20 }));
for (const weights of [[1 / 3, 1 / 3, 1 / 3], [.7, .2, .1], [1, 0, 0]]) {
    const range = blendRange(cabinets, weights);
    for (let step = 1; step <= 100; step++) {
        const db = range.min + (range.max - range.min) * step / 100;
        const next = blendLevels(cabinets, weights, 10 ** (db / 20), [0, 0, 0]);
        assert(next.values.some((value, i) => value > cabinets[i].min), "fader has no dead zone above mute");
        assert(next.values.every((value, i) => value <= cabinets[i].max + 1e-8), "levels stay in the plugin range");
    }
    assert.deepEqual(blendLevels(cabinets, weights, 0, [0, 0, 0]).values, [-40, -40, -40]);
    const restored = blendLevels(cabinets, weights, 1, [-40, -40, -40]);
    weights.forEach((weight, i) => {
        if (weight) assert(Math.abs(restored.values[i] - 20 * Math.log10(weight)) < 1e-8, "mute recovery retains the blend");
    });
}
// Moving between triangle corners/centre preserves the requested common level.
for (const weights of [[1, 0, 0], [.2, .5, .3], [0, 0, 1]]) {
    assert.equal(blendLevels(cabinets, weights, .8, [0, 0, 0]).amplitude, .8);
}
// A single loaded slot must leave the two unloaded slots unchanged.
assert.deepEqual(blendLevels([cabinets[1]], [1], 1, [-7, -8, -9]).values, [-7, 0, -9]);
console.log("Cabinet blend regression checks passed.");
