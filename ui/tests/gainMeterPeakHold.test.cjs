const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const meter = fs.readFileSync(path.join(__dirname, '../src/views/GainMeter.tsx'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');

assert.match(meter, /const PEAK_HOLD_MS = 1500/,
    'gain meters must hold a peak long enough to read it');
assert.match(meter, /PEAK_FALL_DB_PER_SECOND[\s\S]*setHeldPeakDb/,
    'held peaks must fall smoothly back toward the live level');
assert.match(meter, /gain-meter-peak-line[\s\S]*gain-meter-peak-value/,
    'gain meters must render a peak line and its numeric value');
assert.match(meter, /Math\.min\(95, Math\.max\(5/,
    'the moving peak value must stay readable at the meter edges');
assert.match(css, /\.gain-meter\.is-vertical \.gain-meter-peak-line[\s\S]*width: 24px/,
    'vertical meters need a horizontal peak line through the track');
assert.match(css, /\.gain-meter\.is-horizontal \.gain-meter-peak-line[\s\S]*height: 22px/,
    'horizontal meters need a vertical peak line through the track');

console.log('Gain meter peak-hold regression tests passed');
