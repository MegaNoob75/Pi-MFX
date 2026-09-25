const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audioTypes = fs.readFileSync(path.join(__dirname, '../../engine/src/audio/AudioTypes.h'), 'utf8');
const model = fs.readFileSync(path.join(__dirname, '../../engine/src/model/Model.cpp'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, '../../engine/src/Engine.cpp'), 'utf8');
const settings = fs.readFileSync(path.join(__dirname, '../src/views/SettingsView.tsx'), 'utf8');
const editor = fs.readFileSync(path.join(__dirname, '../src/views/EditorView.tsx'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');

for (const key of ['inputMode', 'calibrationMode', 'instrumentProfileName', 'instrumentLevelDbU',
    'interfaceReferenceDbU', 'interfaceGainDb', 'namCalibrationManaged', 'instrumentProfiles']) {
    assert.match(audioTypes, new RegExp(key), `${key} must be part of persisted audio settings`);
    assert.match(model, new RegExp(`json\\.set\\("${key}"`), `${key} must serialize`);
    assert.match(model, new RegExp(`json\\.has\\("${key}"`), `${key} must deserialize`);
}

assert.match(model, /for \(const InstrumentInputProfile& profile : settings\.instrumentProfiles\)[\s\S]*json\.set\("instrumentProfiles"/,
    'all instrument profiles must be serialized');
assert.match(model, /json\["instrumentProfiles"\]\.items\(\)[\s\S]*settings\.instrumentProfiles\.push_back/,
    'all saved instrument profiles must be restored');

assert.match(engine, /selectedInput = inputs\[guitar\][\s\S]*guitarInputPeak_\.store[\s\S]*guitarInputRms_\.store/,
    'the wizard must measure the selected raw guitar channel');
assert.match(engine, /applyManagedNamCalibration\(settings_\.audio, \*plugin\)/,
    'managed calibration must be applied after loading each TooB NAM state');
assert.match(engine, /rebuildForCalibration[\s\S]*buildChain\(\*currentPreset/,
    'changing or disabling managed calibration must rebuild the live chain');

assert.match(settings, /AudioSettingsTab = "device" \| "input" \| "output" \| "status"/,
    'audio settings must be divided into the four requested tabs');
assert.match(settings, /STAY QUIET[\s\S]*PLAY GUITAR[\s\S]*Maximum[\s\S]*Noise estimate/,
    'the input wizard must guide silence and playing phases and explain results');
assert.match(settings, /not the interface's maximum input specification/i,
    'the calibration wizard must explain the dBu distinction');
assert.match(settings, /dBFS[\s\S]*digital meter level[\s\S]*dBu[\s\S]*analog voltage/i,
    'the calibration wizard must explain dBFS versus dBu for beginners');
assert.match(settings, /Current hardware gain[\s\S]*gain added above the interface's minimum-gain position[\s\S]*Leave this at <strong>0 dB<\/strong>/,
    'hardware gain must explain the minimum position and give a concrete value');
assert.match(settings, /maximum input level[\s\S]*Do not copy a Line-input value[\s\S]*do not guess/i,
    'the interface reference must explain where to find the correct specification');
assert.match(settings, /What does management do\?[\s\S]*configure each preset separately[\s\S]*saved in its preset/,
    'managed calibration must explain both choices in beginner language');
assert.match(settings, /LOAD SELECTED[\s\S]*NEW PROFILE[\s\S]*DELETE SELECTED[\s\S]*SAVE CURRENT PROFILE/,
    'the calibration page must provide explicit multi-profile controls');
assert.match(settings, /loadCalibrationProfile[\s\S]*audio\/settings[\s\S]*deleteCalibrationProfile/,
    'loading and deleting profiles must persist the newly active profile');
assert.match(settings, /MANAGE TOOB NAM FROM THIS PROFILE/,
    'the user must explicitly control global TooB profile management');
assert.match(editor, /calibrationManaged[\s\S]*MANAGED BY AUDIO PROFILE[\s\S]*disabled=.*calibrationManaged/,
    'a globally managed TooB calibration control must identify its source and be read-only');
assert.match(css, /\.audio-settings-tabs[\s\S]*repeat\(4/,
    'the four audio tabs must share the available width');

console.log('Audio input calibration wizard regression tests passed');
