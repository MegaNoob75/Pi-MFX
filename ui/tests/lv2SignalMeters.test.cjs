const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engineHeader = fs.readFileSync(path.join(__dirname, '../../engine/src/Engine.h'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, '../../engine/src/Engine.cpp'), 'utf8');
const editor = fs.readFileSync(path.join(__dirname, '../src/views/EditorView.tsx'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');

assert.match(engineHeader, /ChainSlot[\s\S]*atomic<float> inputPeak[\s\S]*atomic<float> outputPeak/,
    'each live LV2 slot must own lock-free pre/post peak readings');
assert.match(engine, /sourcePeak = audioBufferPeak\(\*source, channels, frames\)[\s\S]*inputPeak\.store\(sourcePeak[\s\S]*plugin->process[\s\S]*sourcePeak = audioBufferPeak\(\*destination, channels, frames\)/,
    'the audio callback must measure immediately before and after each plugin');
assert.match(engine, /Json effectMeters = Json::array\(\)[\s\S]*meter\.set\("slotId"[\s\S]*json\.set\("effects"/,
    'the off-thread meter message must publish readings by stable slot id');
assert.match(editor, /useMeters\(client\)[\s\S]*meters\.effects[\s\S]*hasAudioPorts[\s\S]*LIVE SIGNAL[\s\S]*GainMeter label="In"[\s\S]*GainMeter label="Out"/,
    'audio LV2 editors must show live pre/post gain meters');
assert.match(css, /\.lv2-signal-meters[\s\S]*grid-template-columns: repeat\(2/,
    'the pre/post meters must remain paired on the main editor layout');

console.log('LV2 signal meter regression tests passed');
