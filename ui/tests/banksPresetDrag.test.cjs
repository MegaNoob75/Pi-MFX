const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const view = fs.readFileSync(path.join(__dirname, '../src/views/BanksView.tsx'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, '../../engine/src/Engine.cpp'), 'utf8');

assert.match(view, /onPointerDown=\{\(event\) => beginPresetDrag\(event, preset, index\)\}/,
    'the whole preset row must start a pointer drag');
assert.match(view, /className="preset-drag-ghost"[\s\S]*presetDrag\.name/,
    'dragging must render a named preset ghost');
assert.match(view, /dropBankId === str\(bank\.id\)[\s\S]*preset-drop-target/,
    'the bank under the pointer must be visibly marked as the drop target');
assert.match(view, /client\.request\("preset\/move", \{[\s\S]*presetId: presetDragId,[\s\S]*bankId: targetBankId/,
    'dropping a preset on another bank must request a move');
assert.match(css, /\.preset-drag-ghost\s*\{[\s\S]*pointer-events:\s*none/,
    'the ghost must follow the pointer without blocking drop hit testing');
assert.match(engine, /movePresetToBank[\s\S]*config\.presetAssignments\.has\(source->id\)[\s\S]*member\.second\.asString\(\) != presetId/,
    'a cross-bank move must remove Performance assignments to the preset from its source bank');

console.log('banks/presets drag-and-drop regression checks passed');
