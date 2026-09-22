const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const view = fs.readFileSync(path.join(__dirname, '../src/views/Tone3000View.tsx'), 'utf8');
const library = fs.readFileSync(path.join(__dirname, '../src/views/LibraryManager.tsx'), 'utf8');
const keyboard = fs.readFileSync(path.join(__dirname, '../src/keyboard/KeyboardProvider.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '../../engine/src/library/Tone3000.cpp'), 'utf8');
const router = fs.readFileSync(path.join(__dirname, '../../engine/src/control/ApiRouter.cpp'), 'utf8');
const installer = fs.readFileSync(path.join(__dirname, '../../scripts/pimfx.sh'), 'utf8');

assert.match(view, /prompt: "select_tone"/, 'Model Library must launch the hosted Select flow');
assert.match(view, /menubar: "true"/, 'hosted browsing must provide navigation and close controls');
assert.match(view, /preview: "true"/, 'hosted browsing must enable TONE3000 previews');
assert.match(view, /redirectUri: thisPageRedirect\(\)/,
    'each browser must return to the Pi-MFX address it used to start browsing');
assert.match(view, /params\.get\("tone_id"\)/, 'the OAuth callback must retain the selected tone id');
assert.match(view, /tone3000\/tone/, 'Pi-MFX must fetch the selected tone after return');
assert.match(view, /tone3000\/models/, 'Pi-MFX must fetch selectable model files after return');
assert.match(view, /LibraryFileManager[\s\S]*kinds=\{\["model", "ir"\]\}/,
    'the local Model Library must prioritize NAM and IR files');
assert.match(view, /LibraryFolderPicker[\s\S]*kinds=\{\["model", "ir"\]\}/,
    'TONE3000 downloads must only target NAM and IR roots');
assert.match(view, /createFolderName=\{toneName\(selectedTone\)\}/,
    'the save dialog must receive the selected amp or cabinet name');
assert.doesNotMatch(view, /tone3000\/tones|tone3000\/users|IntersectionObserver/,
    'Pi-MFX must not recreate the hosted catalog or creator search');
assert.doesNotMatch(view, /aidax|AIDA-X/i, 'AIDA-X must stay outside the TONE3000 workflow');
assert.match(library, /kinds\?: LibraryKind\[\]/, 'the shared file manager must support a focused set of roots');
assert.match(library, /safeLibraryFolderName[\s\S]*library\/mkdir[\s\S]*onPick\(target, activeKind\)/,
    'the folder picker must safely create a tone-named folder before downloading into it');
assert.match(library, /library\/delete-impact[\s\S]*DELETE FILES AND PRESETS[\s\S]*bank\/delete/,
    'deleting required models must warn and remove affected Community Presets');
assert.match(router, /library\/delete-impact[\s\S]*jsonReferencesLibraryTarget[\s\S]*affectedPresets/,
    'the engine must report Community Presets that reference a deleted library target');
assert.match(client, /"menubar", "preview"/, 'the backend must forward hosted browser options');
assert.match(client, /pendingRedirectUri_/, 'the token exchange must reuse the initiating browser callback');
assert.match(installer, /squeekboard[^\n]*&/, 'the kiosk must provide a keyboard on the hosted page');
assert.doesNotMatch(installer, /purge_squeekboard|VirtualKeyboard,OnScreenKeyboard/,
    'the installer must not remove or disable the hosted-page keyboard');
assert.match(keyboard, /suppressSystemKeyboard/, 'Pi-MFX must suppress the system keyboard inside its own UI');
assert.match(styles, /\.model-library-body[\s\S]*overflow: hidden/,
    'the Model Library page itself must not scroll');
assert.match(styles, /\.model-library-files \.explorer-panes[\s\S]*flex: 1 1 auto/,
    'only the file manager panes should consume and scroll within remaining height');
assert.match(styles, /\.t3k-dialog-image[\s\S]*width: 112px[\s\S]*height: 70px/,
    'selected-tone artwork must remain a compact thumbnail');
assert.match(styles, /\.t3k-dialog \.t3k-models[\s\S]*flex: 1 1 auto[\s\S]*overflow: auto/,
    'the individual model list must receive the remaining dialog height and scroll');
assert.match(view, /type="checkbox"[\s\S]*selectedIds/, 'individual models must use multi-select checkboxes');
assert.match(view, /DOWNLOAD SELECTED/, 'the dialog must download the checked model subset');
assert.match(view, /download-job\/start[\s\S]*download-job\/status/,
    'selected models must use a live-polled background download job');
assert.match(view, /setDownloadFiles\(files\)[\s\S]*current: completed/,
    'the UI must update per-file and total progress while downloads run');
assert.match(view, /FINISHED DOWNLOADING[\s\S]*savedCount[\s\S]*failedCount[\s\S]*!downloadFinished && <div className="t3k-models">/,
    'completed downloads must show final statistics instead of returning to the selection list');
assert.match(router, /download-job\/start[\s\S]*std::min<size_t>\(3, items\.size\(\)\)/,
    'the engine must limit TONE3000 downloads to three concurrent files');
assert.match(styles, /\.t3k-download-actions[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
    'Download Selected and Download All must have equal widths');

console.log('TONE3000 hosted Model Library regression tests passed');
