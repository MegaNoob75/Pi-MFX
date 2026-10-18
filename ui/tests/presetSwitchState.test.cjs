const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const sockets = [], responses = [], timers = new Map();
let nextTimer = 0;
class Socket {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    constructor() { sockets.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() {}
}
const environment = {
    WebSocket: Socket,
    fetch: () => new Promise(resolve => responses.push(resolve)),
    window: { location: { protocol: 'http:', host: 'pi:8080', replace() {} },
        setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
        clearTimeout: id => timers.delete(id) }
};
const modules = new Map();
function load(name) {
    if (name === 'react') return {};
    if (modules.has(name)) return modules.get(name);
    const source = fs.readFileSync(path.join(__dirname, '../src', `${name}.ts`), 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(compiled, { ...environment, module, exports: module.exports,
        require: dependency => load(dependency.replace(/^\.\//, '')) });
    modules.set(name, module.exports);
    return module.exports;
}
const { EngineClient } = load('api');
const plain = value => JSON.parse(JSON.stringify(value));
const preset = id => ({ id, name: id, chain: [], snapshots: [{ id: id + '-snap', name: 'Space', slot: 1 }],
    parameterBindings: [], activeSnapshot: -1, rememberedSnapshotEnabled: false });
const full = (revision = 1, library = 1, epoch = 'engine') => ({
    type: 'state', stateEpoch: epoch, revision, bankLibraryRevision: library, presetSwitchProtocol: 1,
    activeBankId: 'a', browseBankId: 'a', activePresetId: 'a1', activeChainPresetId: 'a1',
    chainGeneration: 1, chainPreparing: false,
    banks: [{ id: 'a', name: 'Clean', lastPresetId: 'a1', presets: [preset('a1'), preset('a2')] },
        { id: 'b', name: 'Metal', lastPresetId: 'b1', presets: [preset('b1'), preset('b2')] }],
    chain: [{ id: 'old', state: { controls: { gain: 1 } } }], chainLayout: [{ id: 'old' }],
    editorBindings: [{ controlId: 'old-control' }], virtualControls: { pages: [{ id: 'old-page' }] },
    snapshotMode: false, bypassAll: false, controller: { presetAssignments: { a: { MOM1: 'a1' } } }
});
const switchTo = (revision, generation, id = 'b2', library = 1) => ({
    type: 'presetSwitch', stateEpoch: 'engine', revision, bankLibraryRevision: library, presetSwitchProtocol: 1,
    activeBankId: id[0], browseBankId: id[0], activePresetId: id, activeChainPresetId: id,
    chainGeneration: generation, chainPreparing: false,
    selectedPreset: { ...preset(id), name: 'New name', activeSnapshot: 1, rememberedSnapshotEnabled: true },
    bankSelections: [{ id: 'a', lastPresetId: id[0] === 'a' ? id : 'a1' },
        { id: 'b', lastPresetId: id[0] === 'b' ? id : 'b1' }],
    chain: [{ id: 'new', state: { controls: { gain: 5 } }, plugin: { name: 'New amp' } }],
    chainLayout: [{ id: 'new' }, { id: 'mixer', kind: 'mixer' }],
    editorBindings: [{ controlId: 'new-control', slotId: 'new' }],
    virtualControls: { pages: [{ id: 'new-page' }] }, routing: { edges: [{ from: 'input', to: 'new' }] },
    snapshotMode: false, bypassAll: false, controller: { presetAssignments: { b: { MOM1: id } } }
});
function setup() {
    const client = new EngineClient(); client.start(); const socket = sockets.at(-1); socket.onopen();
    return { client, socket, send: value => socket.onmessage({ data: JSON.stringify(value) }),
        count: command => socket.sent.filter(message => message.command === command).length };
}

(async () => {
    const a = setup();
    a.send(switchTo(2, 2)); a.send(switchTo(3, 3));
    assert.equal(a.client.snapshot.state.activePresetId, undefined);
    assert.equal(a.count('ui/stateResync'), 1, 'missing initial cache requests only one recovery snapshot');
    a.send(full());
    assert.equal(a.count('ui/stateProtocol'), 1, 'capability is negotiated only after a complete initial snapshot');
    const original = plain(a.client.snapshot.state);
    let notifications = 0;
    const remove = a.client.subscribe(() => notifications++); notifications = 0;
    a.send(switchTo(2, 2));
    assert.equal(notifications, 1, 'preset metadata and chain change atomically');
    const current = a.client.snapshot.state;
    assert.equal(current.activePresetId, 'b2');
    assert.equal(current.chain[0].id, 'new', 'the old plugin list is replaced');
    assert.equal(current.chainLayout[1].kind, 'mixer', 'routing/editor nodes are retained');
    assert.equal(current.editorBindings[0].slotId, 'new');
    assert.equal(current.virtualControls.pages[0].id, 'new-page');
    assert.equal(current.banks[1].presets[1].activeSnapshot, 1);
    assert.equal(current.banks[1].presets[1].snapshots[0].name, 'Space');
    assert.equal(current.banks[1].presets[1].rememberedSnapshotEnabled, true);
    assert.equal(current.banks[1].lastPresetId, 'b2');
    assert.deepEqual(plain(current.banks[0]), original.banks[0], 'other stored presets remain intact');
    assert.deepEqual(plain(current.controller), switchTo(2, 2).controller);
    assert.equal(current.selectedPreset, undefined, 'wire-only patch fields are not retained');
    const browsing = { ...switchTo(3, 2), browseBankId: 'a' };
    const browsed = load('presetSwitchState').mergePresetSwitch(current, browsing);
    assert.equal(browsed.browseBankId, 'a');
    assert.equal(browsed.activePresetId, 'b2', 'bank browsing must keep the sounding preset and chain');
    assert.equal(browsed.activeChainPresetId, 'b2');
    const staleLastId = switchTo(3, 3);
    staleLastId.bankSelections[0].lastPresetId = 'old-imported-id';
    const merged = load('presetSwitchState').mergePresetSwitch(current, staleLastId);
    assert.equal(merged.banks[0].lastPresetId, 'old-imported-id',
        'a pre-existing stale last-selection ID in another bank must not prevent valid switching');
    a.send(full(1));
    assert.equal(a.client.snapshot.state.activePresetId, 'b2', 'late full snapshots cannot roll back a switch');
    a.send(switchTo(1, 1));
    assert.equal(a.client.snapshot.state.chainGeneration, 2, 'stale switch messages are ignored');
    remove();

    // Partial control updates that overtake a switch must wait for its new chain.
    a.send({ type: 'performance', stateEpoch: 'engine', revision: 4, chainGeneration: 3,
        activeBankId: 'a', activePresetId: 'a2', slots: [{ id: 'new', state: { controls: { gain: 9 } } }] });
    assert.equal(a.client.snapshot.state.activePresetId, 'b2');
    a.send(switchTo(3, 3, 'a2'));
    assert.equal(a.client.snapshot.state.activePresetId, 'a2');
    assert.equal(a.client.snapshot.state.chain[0].state.controls.gain, 9,
        'a newer control value is overlaid onto the newly received chain');
    a.send({ type: 'performance', stateEpoch: 'engine', revision: 2, chainGeneration: 2,
        slots: [{ id: 'new', state: { controls: { gain: 0 } } }] });
    assert.equal(a.client.snapshot.state.chain[0].state.controls.gain, 9);

    const beforeInvalid = plain(a.client.snapshot.state);
    const resyncs = a.count('ui/stateResync');
    a.send(switchTo(5, 4, 'b2', 2)); a.send(switchTo(6, 5, 'b2', 2));
    assert.deepEqual(plain(a.client.snapshot.state), beforeInvalid, 'wrong library version cannot produce a mixed UI');
    assert.equal(a.count('ui/stateResync'), resyncs + 1);
    a.send(full(1));
    a.send(switchTo(6, 5, 'b2', 2));
    assert.equal(a.count('ui/stateResync'), resyncs + 1, 'stale snapshots cannot clear recovery coalescing');
    const renamed = full(7, 2); renamed.banks[1].name = 'Renamed bank';
    a.send(renamed); a.send(switchTo(8, 6, 'b2', 2));
    assert.equal(a.client.snapshot.state.banks[1].name, 'Renamed bank');
    assert.equal(a.count('ui/stateProtocol'), 2, 'recovery re-enables compact updates after receiving a full baseline');
    const missing = switchTo(9, 7, 'b2', 2); missing.selectedPreset.id = 'deleted';
    a.send(missing);
    assert.equal(a.client.snapshot.state.chainGeneration, 6, 'missing preset data triggers recovery without changing selection');

    const pending = { ...full(10, 2), chainPreparing: true };
    a.send(pending);
    assert.equal(a.client.snapshot.state.chainGeneration, 6, 'a recovery read during loading keeps the coherent display');
    assert.equal(timers.size, 1);
    a.send(full(11, 2));
    assert.equal(timers.size, 0, 'a committed snapshot cancels recovery polling');

    // A late HTTP state response must not undo a switch already delivered by WS.
    const request = a.client.request('state');
    a.send(switchTo(12, 8, 'b2', 2));
    responses.shift()({ status: 200, ok: true, json: async () => full(11, 2) });
    await request;
    assert.equal(a.client.snapshot.state.chainGeneration, 8);
    const oldEpochRequest = a.client.request('state');
    a.send({ ...full(1, 1, 'restarted'), audioError: 'Test status' });
    const restarted = { ...switchTo(2, 2), stateEpoch: 'restarted' };
    a.send(restarted);
    assert.equal(a.client.snapshot.state.audioError, undefined, 'complete switch metadata clears obsolete errors');
    responses.shift()({ status: 200, ok: true, json: async () => ({ ...full(100), audioError: 'Old engine' }) });
    await oldEpochRequest;
    assert.equal(a.client.snapshot.state.stateEpoch, 'restarted');

    // Independent browser caches receive the same coherent selection.
    const b = setup(), c = setup();
    b.send(full()); c.send(full());
    b.send(switchTo(2, 2)); c.send(switchTo(2, 2));
    assert.deepEqual(plain(b.client.snapshot.state), plain(c.client.snapshot.state));
    assert.equal(b.count('ui/stateResync'), 0, 'normal switching does not fetch another full library');
    b.socket.onopen();
    b.send({ type: 'performance', stateEpoch: 'engine-2', revision: 1, chainGeneration: 2,
        activePresetId: 'a2', slots: [{ id: 'new', state: { controls: { gain: 0 } } }] });
    assert.equal(b.client.snapshot.state.activePresetId, 'b2',
        'a restarted engine cannot reuse an old cached chain with the same numeric generation');
    b.send({ ...switchTo(3, 3), stateEpoch: 'engine-2' });
    assert.equal(b.count('ui/stateResync'), 1, 'reconnection requires a new baseline before compact updates');
    [a, b, c].forEach(item => item.client.stop());
    console.log('Compact preset-switch cache, editor, snapshot, ordering, recovery and multiple-client checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
