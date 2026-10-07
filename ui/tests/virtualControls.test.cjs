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
const performanceControl = read(uiRoot, 'views', 'PerformanceControl.tsx');
const performanceCss = read(uiRoot, 'theme', 'performance.css');
const appCss = read(uiRoot, 'index.css');
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
assert.match(app, /dragOffset[\s\S]*performance-swipe-track[\s\S]*has-peek/,
    'performance and Virtual Controls must follow the finger during vertical navigation');
assert.match(app, /onPointerDownCapture=\{begin\}[\s\S]*onPointerMoveCapture=\{move\}[\s\S]*onPointerUpCapture=\{finish\}/,
    'view navigation must see vertical swipes before preset and virtual-control gestures');
assert.doesNotMatch(app, /"button, input, select, textarea, \[data-adjustable='true'\]/,
    'switch and preset buttons must not be excluded from view navigation swipes');
assert.match(performanceControl, /pimfx-surface-swipe-start[\s\S]*clearHold\(\)[\s\S]*tile\.onCancelPress/,
    'a claimed view swipe must cancel pending presses and preset rearranging');
assert.match(view, /virtual-controls\/press/);
assert.match(view, /virtual-controls\/value/);
assert.match(view, /virtual-controls\/turn/);
assert.match(view, /virtual-page-tabs[\s\S]*pages\.map/,
    'the live surface must render named page tabs');
assert.match(view, /Math\.abs\(dx\) > 70[\s\S]*showPage/,
    'the live surface must support horizontal page swipes');
assert.match(view, /onPageSwipe:[\s\S]*showPage\(pageIndex \+ delta\)/,
    'page swipes must also work when they begin over a control');
assert.match(view, /onDoublePress: manuallyEditable[\s\S]*askText\(display\.label[\s\S]*"chain\/control"/,
    'adjustable virtual controls must support double-tap numeric entry');
assert.match(performanceControl, /completedDrag\?\.scrollTouch \|\| completedDrag\?\.pageSwipeTouch[\s\S]*tapGesture\) queueTap/,
    'a tap on a page-swipe-aware analog control must still reach double-tap detection');
assert.match(performanceControl, /manualEntryTap[\s\S]*tile\.onDoublePress[\s\S]*!completedDrag\.adjusted[\s\S]*manualEntryTap\) queueTap/,
    'double-tap entry must also work when the virtual layout has only one page');
assert.match(view, /onPress: \(\) => \{[\s\S]{0,120}if \(analog\) return/,
    'tapping an analog virtual control must select it without jumping its value');
assert.match(view, /const selectionChanged =[\s\S]*if \(selectionChanged\) return/,
    'selecting a control must not open its adjustment popup');
assert.match(view, /virtual-page-tabs[\s\S]*onPointerMove[\s\S]*scrollLeft = drag\.scrollLeft - dx/,
    'the page strip must follow a horizontal pointer drag');
assert.match(appCss, /\.virtual-page-tabs[\s\S]*scrollbar-width: none[\s\S]*touch-action: none/,
    'the draggable page strip must not show a scrollbar or yield its gesture to the browser');
assert.match(appCss, /\.virtual-controls-stage\s*\{[\s\S]*touch-action: none/,
    'blank parts of the live surface must retain horizontal page swipes');
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
assert.match(editor, /ADD PAGE[\s\S]*Page name/,
    'the layout editor must add and rename pages');
assert.match(editor, /pageId: activePageId/,
    'new controls must belong to the active page');
assert.match(editor, /onEngage: \(\) => setSelectedId/,
    'momentary and latching controls must be selectable in the layout editor');
assert.match(editor, /bindings from every preset using the shared layout/);
assert.match(editor, /ownerPresetId/,
    'bindings must be saved in their owning preset');
assert.match(editor, /SHARED[\s\S]*CUSTOM PRESET[\s\S]*AUTO FROM EFFECTS/,
    'each preset must be able to choose a shared, custom, or effect-generated surface');
assert.match(editor, /REBUILD CONTROLS FROM EFFECTS\?[\s\S]*replaces this preset's Virtual Controls pages and bindings/,
    'automatic generation must warn before replacing a preset surface');
assert.match(editor, /for \(const slot of chain\)[\s\S]*generatedPages\.push[\s\S]*generatedBindings\.push/,
    'automatic mode must build named effect pages and matching bindings');
assert.match(presetEditor, /VIRTUAL CONTROLS[\s\S]*PHYSICAL CONTROLS/,
    'effect settings must offer both virtual and physical binding targets');
assert.match(presetEditor, /Bindings save immediately/,
    'the binding chooser must explain its immediate-save behavior');
assert.doesNotMatch(presetEditor, /onReverse|mfx-bind-reverse|REVERSE \{bool\(assignedBinding\.inverted\)/,
    'the preset binding popup must leave physical direction to Hardware Setup');
assert.match(editor, /\["pot", "slider", "encoder"\]\.includes\(kind\)[\s\S]*<span>Reverse<\/span>[\s\S]*REVERSED/,
    'virtual analog controls must expose reversal in the Virtual Controls layout editor');
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
assert.match(app, /view === "edit" && editSubpage === "controls"[\s\S]*pimfx-editor-control-turn/,
    'the hardware encoder must adjust the selected preset-editor control');
assert.match(profiles, /virtualControls/);
assert.match(backup, /virtualControls/);

for (const command of ['config', 'select', 'press', 'value', 'turn']) {
    assert.match(router, new RegExp(`virtual-controls/${command}`));
}
assert.match(model, /json\.set\("virtualControls", virtualControls\.toJson\(\)\)/);
assert.match(model, /json\.set\("pageId", pageId\)/,
    'each control must persist its page');
assert.match(model, /json\.set\("pages", pageItems\)/,
    'named pages must persist with the layout');
assert.match(model, /json\.set\("virtualControlSurface", virtualControlSurface\)/,
    'preset-owned Virtual Controls surfaces must persist with the preset');
assert.match(model, /Page 1/,
    'older layouts must receive a backward-compatible default page');
assert.match(performanceControl, /tile\.kind === "momentary"[\s\S]*MultiFXFootswitchGraphic[\s\S]*tile\.kind === "latching"[\s\S]*MultiFXArcadeButtonGraphic/,
    'momentary and latching controls must use different hardware graphics');
assert.match(performanceCss, /mfx-hardware-knob__detents/,
    'encoders must retain detents that distinguish them from pots');
assert.match(performanceControl, /detentCount >= 2 && detentCount <= 12[\s\S]*mfx-hardware-knob__option-detents/,
    'enumerated encoders must show one readable detent per option');
assert.match(view, /scrollFriendly: analog[\s\S]*onPageSwipe: pages\.length > 1 && !analog/,
    'virtual analog controls must adjust horizontally while reserving vertical movement for view navigation');
assert.doesNotMatch(performanceControl, /mfx-hardware-knob__encoder-cap|>ENC<[/]?div/,
    'the encoder graphic must not contain an ENC badge');
assert.match(performanceControl, /tile\.kind === "toggle"[\s\S]*ToggleSwitchGraphic/,
    'two-state LV2 parameters must have a dedicated toggle-switch graphic');
assert.match(read(uiRoot, 'virtualControls.ts'), /if \(bool\(port\.toggled\)\) return ""/,
    'virtual toggles without plugin-provided state names must rely on switch position instead of 0/1 text');
assert.match(performanceControl, /touchAction: tile\.scrollFriendly \? "pan-y" : "none"/,
    'editor controls must allow vertical touch scrolling');
assert.match(performanceControl, /onWheel=\{\(event\) => \{[\s\S]*if \(tile\.scrollFriendly\) return;[\s\S]*schedulePopoutClose\(\)/,
    'the mouse wheel must scroll editor pages without opening a control popup');
assert.match(performanceControl, /mfx-performance-switch-wrap[\s\S]*style=\{\{ touchAction: tile\.scrollFriendly \? "pan-y" : "none" \}\}/,
    'the switch wrapper must not block vertical scrolling from an LV2 toggle');
assert.match(performanceControl, /if \(!activeDrag\.adjusted\)[\s\S]*revealPopout\(\)/,
    'touching a control must not open its popup until adjustment begins');
assert.match(performanceControl, /clearPopoutClose[\s\S]*revealPopout[\s\S]*schedulePopoutClose/,
    'starting a new adjustment must cancel an older popup close timer');
assert.match(performanceControl, /preserveAnalogTouch[\s\S]*pointercancel[\s\S]*touchmove[\s\S]*touchend/,
    'touch adjustment must survive pointer cancellation when the popup portal appears');
assert.match(model, /validPresetBindingAction/,
    'loaded banks must reject unknown preset-bound actions');
assert.match(engine, /proxyCatchAllows/);
assert.match(engine, /controlId\.empty\(\)[\s\S]*activeVirtualControlId_\.clear\(\)/,
    'an empty page must clear the hidden active control');
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
assert.match(engine, /effectiveVirtualControlsConfig\(\)[\s\S]*virtualControlSurface\["layout"\]/,
    'runtime control lookup must follow the active preset surface');
assert.match(engine, /sharedVirtualControls/,
    'the layout editor must still receive the shared surface while a preset surface is active');
assert.match(engine, /overlayPresetBind[\s\S]{0,180}effectiveActivePreset\(\)/,
    'hardware binding lookup must follow the active preset draft');
assert.match(engine, /runVirtualControlProxy[\s\S]{0,220}effectiveActivePreset\(\)/,
    'the contextual encoder must use bindings from the active preset draft');
assert.doesNotMatch(router, /virtual-controls\/proxy-turn"\)[\s\S]{0,160}validatePresetEvent/,
    'the contextual hardware proxy must not trust a stale browser preset id');
assert.match(engine, /clearSessionDraft\(preset->id\)[\s\S]*restoreStoredPresetToChainUnlocked/,
    'reload must discard the active preset draft before restoring disk state');

console.log('Virtual Controls regression tests passed');
