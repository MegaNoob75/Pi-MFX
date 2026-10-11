const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engineHeader = fs.readFileSync(path.join(__dirname, '../../engine/src/Engine.h'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, '../../engine/src/Engine.cpp'), 'utf8');
const layout = fs.readFileSync(path.join(__dirname, '../src/layout.ts'), 'utf8');
const performance = fs.readFileSync(path.join(__dirname, '../src/views/PerformanceView.tsx'), 'utf8');
const settings = fs.readFileSync(path.join(__dirname, '../src/views/SettingsView.tsx'), 'utf8');

assert.match(engineHeader, /engineCpuLoad_/,
    'the engine must retain a whole-process CPU reading');
assert.match(engine, /hardware_concurrency\(\)[\s\S]*std::clock\(\)[\s\S]*engineCpuLoad_\.store/,
    'whole-process CPU must be normalized across the available CPU cores');
assert.match(engine, /json\.set\("engineCpuLoad"/,
    'whole-process CPU must be published with the live meters');
assert.match(layout, /cpuUsage: "Load"/,
    'the performance widget must use a concise heading for its stacked readings');
assert.match(performance, /AUDIO [\s\S]*dspLoad[\s\S]*CPU [\s\S]*engineCpuLoadAvailable[\s\S]*engineCpuLoad/,
    'the performance widget must stack audio load above engine CPU');
assert.match(performance, /widget\.showLabel && id !== "cpuUsage"/,
    'the compact load widget must not spend a third row on a redundant heading');
assert.match(settings, /Audio callback load[\s\S]*Engine CPU[\s\S]*whole Pi-MFX process[\s\S]*every Pi CPU core/,
    'audio status must explain the meaning of both CPU readings');

console.log('CPU meter regression tests passed');
