const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const uiRoot = path.join(__dirname, '..', 'src');
const engineRoot = path.join(__dirname, '..', '..', 'engine', 'src');
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

const settings = read(uiRoot, 'views', 'SettingsView.tsx');
const setupProfiles = read(uiRoot, 'views', 'SetupProfilesView.tsx');
const library = read(uiRoot, 'views', 'LibraryManager.tsx');
const recorder = read(uiRoot, 'views', 'RecorderView.tsx');
const looper = read(uiRoot, 'views', 'LooperView.tsx');
const drumsView = read(uiRoot, 'views', 'DrumMachineView.tsx');
const styles = read(uiRoot, 'index.css');
const drums = read(engineRoot, 'drums', 'DrumMachine.cpp');
const engine = read(engineRoot, 'Engine.cpp');
const sequencer = read(engineRoot, 'drums', 'DrumSequencer.h');
const recorderEngine = read(engineRoot, 'recorder', 'MultitrackRecorder.cpp');

assert.match(settings, /SETUP PROFILES/);
assert.match(settings, /kind="controllerprofile"/);
assert.match(setupProfiles, /format: "pimfx-setup-profile"/);
assert.match(setupProfiles, /audio: obj\(state\.audio\)/);
assert.match(setupProfiles, /controller: controllerSnapshot\(\)/);
assert.match(library, /Locked to \{libraryRootLabel\(kind\)\}/);
assert.match(library, /"controllerprofile" \| "setupprofile"/);
assert.match(library, /if \(mode !== "load" \|\| !onPreview \|\| !path\) return;/,
    'selecting an existing file in save mode must never preview or load it');
assert.match(library, /OVERWRITE EXISTING FILE\?/);
assert.match(library, /confirmLabel="OVERWRITE"/,
    'overwrite confirmations must not use the delete action label');
assert.match(engine, /confirm overwrite to replace it/,
    'the engine must reject silent file replacement');

assert.match(recorder, /raw: "RAW TRACK"/);
assert.match(recorder, /processed: "PROCESSED TRACK"/);
assert.match(recorder, /LibraryItemPicker/);
assert.match(recorder, /kind="recording"/);
assert.match(recorderEngine, /"tracks"/);
assert.match(recorderEngine, /"takes"/);
assert.match(recorderEngine, /"stems"/);

assert.match(sequencer, /kVoiceCount = 32/);
assert.match(drumsView, />ADD DRUM</);
assert.doesNotMatch(drumsView, />SAMPLE BROWSER</);
assert.match(drumsView, /LibraryItemPicker/);
assert.match(drumsView, /LibraryJsonPicker/);
assert.match(drumsView, /baseDirectory=\{`\$\{str\(drums\.projectId\)\}\/songs`\}/);
assert.match(drumsView, /LOAD SONG/);
assert.match(drumsView, /SAVE SONG AS/);
assert.match(drums, /joinPath\(root_, "projects"\)/);
assert.match(drums, /joinPath\(projectRoot_, "patterns"\)/);
assert.match(drums, /bool DrumMachine::applySong/);
assert.match(drums, /"activeStep"/);
assert.match(styles, /\.drums-grid-header b\.playing::after/,
    'the pattern header must show the currently playing step');
assert.match(styles, /\.drums-kit-actions \{[^}]*grid-template-columns: repeat\(4/,
    'the kit actions must span the top of the kit page');
assert.match(styles, /\.drum-designer-frame \{[^}]*flex: 1 1 0;[^}]*overflow: hidden/,
    'the drum list frame must consume the remaining kit-page space');
assert.match(engine, /if \(kind == "drumsample"\) \{\s*error = "use the drum sample importer"/,
    'drum kit JSON must use the shared file manager while sample WAVs retain the dedicated importer');
assert.doesNotMatch(engine, /kind == "drumsample" \|\| kind == "drumkit"\) \{\s*error = "use the drum sample importer/,
    'drum kit saves must not be rejected as sample imports');
assert.match(looper, /LibraryBrowser/);
assert.match(looper, /LibraryFileSavePicker/);
assert.doesNotMatch(styles, /#c45c26|rgba\(196\s*,\s*92\s*,\s*38/,
    'the shared file manager must not fall back to the old brown accent');

for (const file of ['BackingTracksView.tsx', 'BackupView.tsx', 'BanksView.tsx', 'ThemeManagerView.tsx']) {
    assert.doesNotMatch(read(uiRoot, 'views', file), /type="file"/,
        `${file} must import through the shared file manager`);
}

console.log('Setup profiles and organized media regression tests passed');
