const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const uiRoot = path.join(__dirname, '..', 'src');
const engineRoot = path.join(__dirname, '..', '..', 'engine', 'src');
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

const app = read(uiRoot, 'App.tsx');
const view = read(uiRoot, 'views', 'VirtualControlsView.tsx');
const editor = read(uiRoot, 'views', 'VirtualControlsLayoutEditorView.tsx');
const presetEditor = read(uiRoot, 'views', 'EditorView.tsx');
const settings = read(uiRoot, 'views', 'SettingsView.tsx');
const profiles = read(uiRoot, 'views', 'SetupProfilesView.tsx');
const backup = read(uiRoot, 'views', 'BackupView.tsx');
const engine = read(engineRoot, 'Engine.cpp');
const model = read(engineRoot, 'model', 'Model.cpp');
const router = read(engineRoot, 'control', 'ApiRouter.cpp');
const api = read(uiRoot, 'api.ts');

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
assert.match(view, /client\.request\("preset\/save", \{ presetId \}\)/,
    'the explicit save must capture the current live chain');
assert.match(view, /RELOAD SAVED/,
    'the live surface must offer an explicit discard and reload action');
assert.match(view, /sessionPresetDirty/,
    'the live surface must report unsaved session state');
assert.match(api, /sessionPresetDirty: message\.sessionPresetDirty/,
    'live performance updates must enable Save as soon as a draft changes');
assert.match(api, /sessionPresetDirtyIds: message\.sessionPresetDirtyIds/,
    'live performance updates must keep destructive-action warnings current');
assert.match(presetEditor, /SAVE CHANGES/,
    'the preset editor must require an explicit save');
assert.match(presetEditor, /ownerPresetId: sessionPresetId/,
    'preset-editor binding requests must identify their owning preset');
assert.match(presetEditor, /DISCARD LIVE CHANGES/,
    'the preset editor must confirm destructive reloads');
assert.doesNotMatch(app, /view === "edit"[\s\S]{0,220}client\.request\("preset\/save"\)/,
    'leaving the preset editor must not auto-save the live sound');
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
assert.match(engine, /sessionPresetDrafts_/,
    'temporary sound must be retained by the engine per preset');
assert.match(engine, /overlayPresetBind[\s\S]{0,180}effectiveActivePreset\(\)/,
    'hardware binding lookup must follow the active preset draft');
assert.match(engine, /runVirtualControlProxy[\s\S]{0,220}effectiveActivePreset\(\)/,
    'the contextual encoder must use bindings from the active preset draft');
assert.doesNotMatch(router, /virtual-controls\/proxy-turn"\)[\s\S]{0,160}validatePresetEvent/,
    'the contextual hardware proxy must not trust a stale browser preset id');
assert.match(engine, /clearSessionDraft\(preset->id\)[\s\S]*restoreStoredPresetToChainUnlocked/,
    'reload must discard the active preset draft before restoring disk state');

console.log('Virtual Controls regression tests passed');
