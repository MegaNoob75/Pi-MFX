const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Render the actual component with deterministic hooks and pointer/timer events.
// No browser, audio backend, or replacement gesture implementation is involved.
let now = 10000, nextTimer = 0, hook = 0;
const hooks = [], timers = new Map();
const environment = {
    Date: { now: () => now },
    window: {
        setTimeout(callback, delay) { timers.set(++nextTimer, { at: now + delay, callback }); return nextTimer; },
        clearTimeout(id) { timers.delete(id); }, addEventListener() {}, removeEventListener() {}
    },
    document: { addEventListener() {}, removeEventListener() {} }
};
const react = {
    useRef(value) { const n = hook++; return hooks[n] ??= { current: value }; },
    useState(value) { const n = hook++; if (!(n in hooks)) hooks[n] = value; return [hooks[n], v => { hooks[n] = v; }]; },
    useEffect() {}
};
const jsx = (type, props) => ({ type, props });
const json = require('typescript').transpileModule(fs.readFileSync(path.join(__dirname, '../src/json.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText;
const jsonModule = { exports: {} }; vm.runInNewContext(json, { exports: jsonModule.exports, module: jsonModule });
const dependencies = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'react-dom': { createPortal: v => v },
    '../api': { clampUnit: v => Math.max(0, Math.min(1, v)), isAnalogKind: () => false, isEncoderKind: () => false },
    '../json': jsonModule.exports,
    '../controlPopout': { announceControlPopout() {}, CONTROL_POPOUT_OPEN_EVENT: 'popout' },
    '../uiBehavior': { loadUiBehavior: () => ({ controlPopout: false, controlPopoutScale: 1 }) },
    '../theme/FootswitchGraphic': { default: 'footswitch', MultiFXArcadeButtonGraphic: 'arcade' },
    './MarqueeText': { MarqueeText: 'text' }
};
const source = fs.readFileSync(path.join(__dirname, '../src/views/PerformanceControl.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX
} }).outputText;
const componentModule = { exports: {} };
vm.runInNewContext(compiled, { ...environment, module: componentModule, exports: componentModule.exports,
    require(name) { assert.ok(name in dependencies, name); return dependencies[name]; } });
const { PerformanceControl } = componentModule.exports;
function advance(ms) {
    now += ms;
    for (;;) {
        const due = [...timers].find(([, timer]) => timer.at <= now);
        if (!due) break;
        timers.delete(due[0]); due[1].callback();
    }
}
function setup(immediateTap) {
    hooks.length = 0; timers.clear();
    const events = [];
    let tile = { id: 'preset', switchLabel: 'Preset', valueText: 'Clean', kind: 'momentary',
        role: 'preset', lightState: 'inactive', active: false, immediateTap,
        onPress: () => events.push('tap'), onDoublePress: () => events.push('double'),
        onLongPress: () => events.push('hold') };
    let button;
    function render() {
        hook = 0;
        const tree = PerformanceControl({ tile, switchStyle: 'default', bypassed: false });
        function find(node) {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'button' && node.props.onPointerDown) return node;
            for (const child of [node.props?.children].flat(Infinity)) { const found = find(child); if (found) return found; }
        }
        button = find(tree); assert.ok(button, 'actual switch button must be rendered');
    }
    const event = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10,
        preventDefault() {}, stopPropagation() {}, currentTarget: {
            setPointerCapture() {}, releasePointerCapture() {}, closest() { return null; }
        } };
    render();
    return { events,
        down: () => button.props.onPointerDown(event),
        up: () => button.props.onPointerUp(event),
        cancel: () => button.props.onPointerCancel(event),
        rerender(allowed) { tile = { ...tile, immediateTap: allowed, active: true }; render(); }
    };
}

let a = setup(true);
a.down(); assert.deepEqual(a.events, [], 'press must preserve hold recognition');
a.up(); assert.deepEqual(a.events, ['tap'], 'first release must select immediately');
advance(321); assert.deepEqual(a.events, ['tap'], 'window expiry cannot repeat eager tap');

a = setup(true); a.down(); a.up(); advance(100);
a.rerender(false); // Selected target may publish a snapshot-sensitive state.
a.down(); a.up(); assert.deepEqual(a.events, ['tap', 'double'], 'rerender must retain second-tap recognition');
advance(321); assert.deepEqual(a.events, ['tap', 'double'], 'double cannot leak another single tap');

a = setup(false); a.down(); a.up(); advance(319);
assert.deepEqual(a.events, [], 'snapshot/other-action tap retains existing waiting window');
advance(2); assert.deepEqual(a.events, ['tap']);
a = setup(false); a.down(); a.up(); advance(100); a.down(); a.up();
assert.deepEqual(a.events, ['double'], 'delayed double must not select first');

a = setup(true); a.down(); advance(601); a.up();
assert.deepEqual(a.events, ['hold'], 'hold must suppress tap and double');
a = setup(true); a.down(); a.cancel(); advance(1000);
assert.deepEqual(a.events, [], 'cancelled pointer cannot select or hold');
console.log('Actual touchscreen tap, double, hold, cancellation and rerender timing checks passed');
