const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Exercise the real public EngineClient with controlled HTTP/socket delivery.
// No browser, engine process, or source-pattern assertions are required.
const responses = [];
let socket;
class Socket {
    static OPEN = 1;
    readyState = 1;
    constructor() { socket = this; }
    send() {}
    close() {}
}
const environment = {
    WebSocket: Socket,
    fetch: () => new Promise(resolve => responses.push(resolve)),
    window: { location: { protocol: "http:", host: "pi:8080", replace() {} }, setTimeout, clearTimeout }
};
const modules = new Map();
function load(name) {
    if (name === "react") return {};
    if (modules.has(name)) return modules.get(name);
    const source = fs.readFileSync(path.join(__dirname, "../src", `${name}.ts`), "utf8");
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(compiled, { ...environment, module, exports: module.exports,
        require: dependency => load(dependency.replace(/^\.\//, "")) });
    modules.set(name, module.exports);
    return module.exports;
}
const { EngineClient } = load("api");
const full = (revision, epoch, bankName = "Bank") => ({
    type: "state", revision, stateEpoch: epoch, banks: [{ id: "bank", name: bankName }],
    chain: [{ id: "effect", state: { controls: { gain: 1 } } }], chainLayout: []
});
const send = message => socket.onmessage({ data: JSON.stringify(message) });
const answer = body => responses.shift()({ status: 200, ok: true, json: async () => ({ ok: true, ...body }) });

(async () => {
    const client = new EngineClient();
    client.start();
    socket.onopen();
    send(full(10, "first"));
    send({ type: "performance", revision: 12, stateEpoch: "first",
        slots: [{ id: "effect", state: { controls: { gain: 3 } } }] });
    const request = client.request("state");
    answer(full(11, "first", "Renamed"));
    await request;
    assert.equal(client.snapshot.state.banks[0].name, "Renamed", "full-only fields survive a newer partial update");
    assert.equal(client.snapshot.state.chain[0].state.controls.gain, 3, "late full state cannot undo live controls");
    send(full(9, "first", "Stale"));
    assert.equal(client.snapshot.state.banks[0].name, "Renamed");
    send({ type: "performance", revision: 8, stateEpoch: "first", bypassAll: true });
    assert.notEqual(client.snapshot.state.bypassAll, true, "stale partial state is ignored");

    send({ ...full(13, "first"), recorder: { tracks: [{ id: "track" }], status: "stopped" } });
    send({ ...full(14, "first"), recorder: { partial: true, status: "finalizing" } });
    assert.equal(client.snapshot.recorder.tracks[0].id, "track", "status-only engine state retains recorder details");
    assert.equal(client.snapshot.recorder.status, "finalizing");

    const oldRequest = client.request("state");
    send(full(1, "restarted", "New engine"));
    answer(full(99, "first", "Old engine"));
    await oldRequest;
    assert.equal(client.snapshot.state.banks[0].name, "New engine", "old HTTP replies cannot replace a restarted engine");
    send({ type: "performance", revision: 2, stateEpoch: "restarted", bypassAll: true });
    assert.equal(client.snapshot.state.bypassAll, true);
    client.stop();
    console.log("Engine snapshot ordering and restart checks passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
