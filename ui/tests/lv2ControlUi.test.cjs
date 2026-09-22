const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const editor = fs.readFileSync(path.join(__dirname, '../src/views/EditorView.tsx'), 'utf8');
const snapshot = fs.readFileSync(path.join(__dirname, '../src/views/SnapshotEditView.tsx'), 'utf8');
const host = fs.readFileSync(path.join(__dirname, '../../engine/src/host/Lv2Host.cpp'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, '../../engine/src/Engine.cpp'), 'utf8');
const router = fs.readFileSync(path.join(__dirname, '../../engine/src/control/ApiRouter.cpp'), 'utf8');

assert.match(editor, /bool\(port\.enumerated\) && points\.length > 0/,
    'scale points alone must not turn a continuous port into a selector');
assert.match(editor, /hasLogarithmicRange\(port\)/,
    'logarithmic ports must use logarithmic slider conversion');
assert.match(editor, /bool\(port\.trigger\)[\s\S]*TRIGGER/,
    'trigger ports must render as one-shot buttons');
assert.match(editor, /value > 0 \? "ON" : "OFF"/,
    'LV2 toggles must treat all positive values as on');
assert.match(editor, /!bool\(port\.notOnGui\)/,
    'ports marked notOnGUI must be omitted from the main editor');
assert.match(snapshot, /!bool\(port\.notOnGui\)/,
    'snapshot editing must use the same port visibility rule');
assert.match(editor, /onPointerUp=.*commit/,
    'range controls must commit once when a pointer drag ends');
assert.match(editor, /const \[previewValues, setPreviewValues\]/,
    'range controls must keep an optimistic local value while awaiting engine acknowledgement');
assert.match(editor, /pendingValues\.current\.set\(symbol, clamped\)/,
    'a released value must remain pending until the engine reports it back');
assert.match(editor, /onPreview\(portValue\(port, raw\)\)/,
    'the displayed value must follow the local drag immediately');
assert.match(editor, /window\.requestAnimationFrame[\s\S]*persist: false/,
    'drag previews must be frame-throttled and non-persistent');
assert.match(editor, /pendingPreview\.current = null;[\s\S]*persist: true/,
    'release must cancel any queued preview and persist the final value');
assert.match(editor, /data-mfx-nav-list="file-property"/,
    'path properties must expose real list items to hardware encoder navigation');
assert.match(editor, /MutationObserver\(syncEncoderHighlight\)/,
    'moving the hardware navigation cursor must audition the highlighted file');
assert.match(editor, /previewPath[\s\S]*persist: false/,
    'auditioning a NAM profile must change the live plugin without saving the preset');
assert.match(editor, /commit[\s\S]*persist: true/,
    'choosing a NAM profile must persist it');
assert.match(editor, /const cancel[\s\S]*original\.current[\s\S]*persist: false/,
    'cancelling profile audition must restore the original live model');
assert.match(router, /payload\["persist"\]\.asBool\(true\)/,
    'live control and property APIs must accept non-persistent updates while defaulting to persistence');
assert.match(host, /portInfo\.sampleRate = lilv_port_has_property/,
    'sample-rate-relative port metadata must be discovered');
assert.match(host, /port\.minimum \*= rate;[\s\S]*port\.defaultValue \*= rate;/,
    'sample-rate-relative bounds and defaults must be resolved per instance');
assert.match(host, /port\.trigger[\s\S]*\.exchange\([\s\S]*port\.defaultValue/,
    'trigger values must automatically reset after one audio block');
assert.match(engine, /port\.enumerated && !port\.scalePoints\.empty\(\)/,
    'engine value validation must constrain enumerations to their scale points');
assert.match(engine, /port\.rangeSteps > 1/,
    'hardware encoders must honor declared range steps');
assert.match(engine, /mappedBindingValue\(request, boundPort\)/,
    'continuous hardware bindings must honor logarithmic port metadata');

console.log('LV2 control UI regression tests passed');
