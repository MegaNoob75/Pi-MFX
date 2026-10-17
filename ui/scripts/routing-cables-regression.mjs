import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/views/routingCables.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { routeCables, roundedCablePath } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
const bent = roundedCablePath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
assert.ok(bent.startsWith("M 0 0") && bent.endsWith("L 100 100") && bent.includes(" Q "), "Curved cable must preserve both endpoints");
assert.ok(!/NaN|Infinity/.test(roundedCablePath([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }])), "Short/duplicate points must remain finite");
const segments = route => route.points.slice(1).map((b, i) => ({ a: route.points[i], b }));
const overlap = (s, t) => {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    if (Math.abs(dx * (t.a.y - s.a.y) - dy * (t.a.x - s.a.x)) > .001
        || Math.abs(dx * (t.b.y - s.a.y) - dy * (t.b.x - s.a.x)) > .001) return false;
    const axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
    return Math.min(Math.max(s.a[axis], s.b[axis]), Math.max(t.a[axis], t.b[axis]))
        - Math.max(Math.min(s.a[axis], s.b[axis]), Math.min(t.a[axis], t.b[axis])) > .01;
};
function check(name, tiles, edges) {
    const routes = routeCables(tiles, edges);
    assert.equal(routes.length, edges.length);
    routes.forEach((route, i) => {
        assert.ok(route.path && route.points.length >= 2, `${name}: missing route ${i}`);
        const from = tiles.find(t => t.id === edges[i].from), to = tiles.find(t => t.id === edges[i].to);
        assert.deepEqual(route.points[0], { x: from.x + 174, y: from.y + 111 });
        assert.deepEqual(route.points.at(-1), { x: to.x, y: to.y + 111 });
        for (let j = 0; j < i; j++) for (const s of segments(route)) for (const t of segments(routes[j]))
            assert.ok(!overlap(s, t), `${name}: cables ${i} and ${j} share a segment`);
    });
    console.log(`${name}: ${edges.length} separate cables passed`);
}
const grid = Array.from({ length: 12 }, (_, i) => ({ id: String(i), x: 40 + i % 4 * 240, y: 40 + Math.floor(i / 4) * 190 }));
check("Fan out", grid, Array.from({ length: 10 }, (_, i) => ({ from: "0", to: String(i + 1) })));
check("Fan in", grid, Array.from({ length: 10 }, (_, i) => ({ from: String(i), to: "11" })));
check("Aligned chains", grid, [{ from: "0", to: "1" }, { from: "1", to: "2" }, { from: "2", to: "3" }, { from: "0", to: "3" }, { from: "1", to: "3" }]);
check("Crossing and reverse", grid, [{ from: "0", to: "11" }, { from: "3", to: "8" }, { from: "8", to: "1" }, { from: "11", to: "2" }, { from: "4", to: "7" }]);
check("Mixed branches", grid, Array.from({ length: 20 }, (_, i) => ({ from: String(i % 6), to: String(6 + Math.floor(i / 6)) })));
check("Overlapping tiles", grid.map((tile, i) => ({ ...tile, x: 40 + i % 4 * 110, y: 40 + Math.floor(i / 4) * 70 })), [{ from: "0", to: "11" }, { from: "1", to: "10" }, { from: "2", to: "9" }, { from: "3", to: "8" }]);
let seed = 1729;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
for (let trial = 0; trial < 12; trial++) {
    const tiles = grid.map(tile => ({ ...tile, x: 20 + Math.floor(random() * 900), y: 20 + Math.floor(random() * 600) }));
    const pairs = [];
    while (pairs.length < 16) {
        const a = Math.floor(random() * 11), b = a + 1 + Math.floor(random() * (11 - a));
        if (!pairs.some(e => e.from === String(a) && e.to === String(b))) pairs.push({ from: String(a), to: String(b) });
    }
    check(`Irregular placement ${trial + 1}`, tiles, pairs);
}
