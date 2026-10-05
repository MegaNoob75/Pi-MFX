const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const uiRoot = path.join(__dirname, '..', 'src');
const engineRoot = path.join(__dirname, '..', '..', 'engine', 'src');
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

const app = read(uiRoot, 'App.tsx');
const view = read(uiRoot, 'views', 'VirtualControlsView.tsx');
const editor = read(uiRoot, 'views', 'VirtualControlsLayoutEditorView.tsx');
const settings = read(uiRoot, 'views', 'SettingsView.tsx');
const profiles = read(uiRoot, 'views', 'SetupProfilesView.tsx');
const backup = read(uiRoot, 'views', 'BackupView.tsx');
const engine = read(engineRoot, 'Engine.cpp');
const model = read(engineRoot, 'model', 'Model.cpp');
const router = read(engineRoot, 'control', 'ApiRouter.cpp');

assert.match(app, /SwipeSurface direction="up"[^]*goTo\("virtualControls"\)/,
    'Performance must swipe up to Virtual Controls');
assert.match(app, /SwipeSurface direction="down"[^]*goTo\("performance"/,
    'Virtual Controls must swipe down to Performance');
assert.match(view, /virtual-controls\/press/);
assert.match(view, /virtual-controls\/value/);
assert.match(view, /virtual-controls\/turn/);
assert.match(view, /CURRENT PRESET/,
    'the live surface must identify the preset being adjusted');
assert.match(view, /SAVE CHANGES TO PRESET/,
    'the live surface must offer an explicit preset save');
assert.match(view, /client\.request\("preset\/save"\)/,
    'the explicit save must capture the current live chain');
assert.match(editor, /VIRTUAL_CONTROL_TYPES\.map/);
assert.match(editor, /This removes the control and its bindings from every preset/);
assert.match(editor, /ownerPresetId/,
    'bindings must be saved in their owning preset');
assert.match(settings, /virtualControlProxy/,
    'continuous hardware controls must offer the selected-control proxy');
assert.match(settings, /virtualControlProxyFine/,
    'encoder push must offer fine-mode control');
assert.match(settings, /navigateOrVirtualControlProxy/,
    'one encoder must be able to navigate except inside Virtual Controls');
assert.match(settings, /selectOrVirtualControlFine/,
    'the same encoder push must be able to select or toggle fine mode by context');
assert.match(app, /view === "virtualControls" && virtualAction/,
    'contextual encoder routing must be owned by the active UI view');
assert.match(app, /virtual-controls\/proxy-turn/);
assert.match(profiles, /virtualControls/);
assert.match(backup, /virtualControls/);

for (const command of ['config', 'select', 'press', 'value', 'turn']) {
    assert.match(router, new RegExp(`virtual-controls/${command}`));
}
assert.match(model, /json\.set\("virtualControls", virtualControls\.toJson\(\)\)/);
assert.match(model, /validPresetBindingAction/,
    'loaded banks must reject unknown preset-bound actions');
assert.match(engine, /proxyCatchAllows/);
assert.match(engine, /crossed = state\.lastVisual/,
    'absolute hardware proxy must use target crossing soft takeover');
assert.match(engine, /previousConfig/);
assert.match(engine, /previousBanks/,
    'layout changes must retain rollback state for cascading binding deletion');
assert.match(engine, /toggleBoundParameter[\s\S]*setControlValue\([\s\S]*error, false\)/,
    'virtual parameter toggles must not rewrite the stored preset');
assert.match(engine, /setEffectEnabled\(binding\.slotId, latchOn\(request\), error, request\.persist\)/,
    'virtual effect toggles must respect live-only requests');

console.log('Virtual Controls regression tests passed');
