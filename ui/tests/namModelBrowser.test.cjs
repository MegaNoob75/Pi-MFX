const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const editor = fs.readFileSync(path.join(__dirname, '../src/views/EditorView.tsx'), 'utf8');
const library = fs.readFileSync(path.join(__dirname, '../src/views/LibraryManager.tsx'), 'utf8');

assert.match(editor, /BROWSE \{isIrBrowser \? "CAB IRS" : "NAM MODELS"\}[\s\S]*CLEAR \{assetLabel\}/,
    'TooB NAM and Cab IR must use explicit browser buttons and separate clear actions');
assert.match(editor, /\{assetLabel\} BROWSER[\s\S]*<LibraryBrowser[\s\S]*filePicker[\s\S]*dualDefault=\{false\}/,
    'the NAM popup must reuse the library explorer in single-pane file-picker mode');
assert.match(editor, /currentEntry\?\.category[\s\S]*PATH_BROWSER_DIR_KEYS\[fileBrowserKind\]/,
    'the NAM browser must open in the current or remembered directory');
assert.match(editor, /onFileSelect=\{\(item\) => previewPath/,
    'highlighting a file must audition it without committing');
assert.match(editor, /onClick=\{\(\) => commit\(highlighted\)\}[\s\S]*USE MODEL/,
    'Use Model must be the explicit model commit action');
assert.doesNotMatch(editor, /onFileOpen=\{\(item\) => commit/,
    'touching or pressing an already-selected file must not commit it');
assert.match(editor, /allowedFilePaths=\{allowedFilePaths\}/,
    'the browser must show only files accepted by the plugin property');
assert.match(editor, /const cancel[\s\S]*original\.current[\s\S]*persist: false/,
    'cancelling the browser must restore the original model without saving');
assert.match(editor, /engine\.uiSession\.pathBrowser[\s\S]*shared\.slotId[\s\S]*shared\.propertyUri[\s\S]*shared\.kind/,
    'the path popup must follow the shared UI session in every browser');
assert.match(editor, /updateUiSessionSection\(client, "pathBrowser"[\s\S]*slotId[\s\S]*propertyUri[\s\S]*kind:/,
    'opening and operating a path popup must publish shared state and claim navigation ownership');
assert.match(editor, /syncPathBrowser\(\{[\s\S]*open: true,[\s\S]*directory:[\s\S]*originalPath:[\s\S]*highlightedPath:/,
    'the shared popup state must include its directory, original model, and highlighted model');

assert.match(library, /!filePicker && <div className="explorer-toolbar">/,
    'file-picker mode must hide library management and split-view controls');
assert.match(library, /readOnly=\{filePicker\}/,
    'the NAM explorer must not allow drag, move, upload, or delete operations');
assert.match(library, /MutationObserver\(syncEncoderHighlight\)[\s\S]*data-library-path/,
    'encoder navigation must select the highlighted explorer row');
assert.match(library, /data-mfx-nav-remote[\s\S]*return;/,
    'a mirrored encoder cursor must not replay the originating model audition');
assert.match(library, /data-mfx-nav-default=\{readOnly \? "true" : undefined\}/,
    'the file list must retain encoder ownership over breadcrumbs and folder-tree buttons');
assert.match(library, /onStepSelection[\s\S]*ArrowDown[\s\S]*onWheelSelection/,
    'arrows and the mouse wheel must navigate the visible directory rows');
assert.match(library, /if \(str\(item\.type\) === "file"\) \{\s*selectItem\(item\);[\s\S]*setDirectory\(str\(item\.relative\)\)/,
    'activation must keep files selected while opening folders');

assert.match(editor, /toob-cab-ir"[\s\S]*\? "ir"/,
    'each TooB Cab IR path property must receive an IR-library browser');
assert.match(editor, /BROWSE \{isIrBrowser \? "CAB IRS" : "NAM MODELS"\}/,
    'the picker button must identify whether it browses cab IRs or NAM models');

const css = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');
assert.match(css, /\.asset-file-browser \{[\s\S]*height: min\([^;]+100dvh[\s\S]*display: flex;[\s\S]*overflow: hidden;/,
    'the asset browser dialog must remain constrained to the viewport');
assert.match(css, /\.asset-file-browser \.explorer \{[\s\S]*flex: 1 1 auto;[\s\S]*overflow: hidden;/,
    'only the browser contents may consume the flexible dialog space');
assert.match(css, /\.asset-file-browser-actions \{[\s\S]*flex: 0 0 auto;/,
    'Cancel and Use buttons must remain pinned at the bottom of the dialog');

console.log('NAM model browser regression tests passed');
