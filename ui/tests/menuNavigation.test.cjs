// Exercise the actual App navigation callback without mounting the full UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = ts.createSourceFile('App.tsx', fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
let navigateToCallback;
let nestedBackCallback;
let sanitizeOrderCallback;
let sanitizeShortcutsCallback;
function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'goTo') callback = node.initializer;
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'navigateTo') navigateToCallback = node.initializer;
    if (ts.isFunctionDeclaration(node) && node.name?.getText(source) === 'nestedSettingsBackPatch') nestedBackCallback = node;
    if (ts.isFunctionDeclaration(node) && node.name?.getText(source) === 'sanitizedMenuOrder') sanitizeOrderCallback = node;
    if (ts.isFunctionDeclaration(node) && node.name?.getText(source) === 'sanitizedShortcuts') sanitizeShortcutsCallback = node;
    ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback, 'App must define goTo');
assert.ok(navigateToCallback, 'App must define navigateTo');
assert.ok(nestedBackCallback, 'App must define nestedSettingsBackPatch');
assert.ok(sanitizeOrderCallback, 'App must validate persisted menu order');
assert.ok(sanitizeShortcutsCallback, 'App must validate persisted shortcuts');
const compiled = ts.transpileModule(`const navigate = ${callback.getText(source)}; return navigate;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
for (const view of ['community', 'drums', 'looper', 'recorder', 'performance']) {
    let localMenu = true;
    let shared = { view, menuOpen: true };
    let updates = 0;
    const engine = { client: { updateUiSession(patch) { shared = { ...shared, ...patch }; updates++; } } };
    const goTo = new Function('setMenuOpen', 'view', 'engine', 'history', 'setHistory', 'layoutDirty', 'setLeaveLayout', 'navigateTo', compiled)(
        value => { localMenu = value; }, view, engine, [],
        () => assert.fail('same-view navigation must not change history'),
        false,
        () => assert.fail('same-view navigation must not prompt'),
        () => assert.fail('same-view navigation must not change history')
    );
    goTo(view);
    assert.equal(localMenu, false);
    assert.equal(shared.menuOpen, false, `${view}: shared menu must close`);
    assert.equal(updates, 1);
    engine.client.updateUiSession({ navFocus: { list: view, index: 0 } });
    assert.equal(shared.menuOpen, false, `${view}: next screen interaction must not reopen menu`);
}

const compiledNavigateTo = ts.transpileModule(`const navigate = ${navigateToCallback.getText(source)}; return navigate;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
function runNavigation(view, history, next, fromMenu) {
    let nextView = view;
    let nextHistory = history;
    let shared = {};
    const engine = { client: { updateUiSession(patch) { shared = { ...shared, ...patch }; } } };
    const navigate = new Function(
        'setMenuOpen', 'view', 'engine', 'history', 'setEditSubpage', 'setEditEffectTitle', 'setHistory', 'setView',
        compiledNavigateTo
    )(
        () => undefined, view, engine, history, () => undefined, () => undefined,
        value => { nextHistory = value; }, value => { nextView = value; }
    );
    navigate(next, fromMenu);
    return { nextView, nextHistory, shared };
}

const menuSwitch = runNavigation('looper', ['performance'], 'transport', true);
assert.equal(menuSwitch.nextView, 'transport');
assert.deepEqual(menuSwitch.nextHistory, ['performance'], 'menu choices must start a fresh path from Performance');
assert.deepEqual(menuSwitch.shared.viewHistory, ['performance']);

const settingsChild = runNavigation('settings', ['performance'], 'controller', false);
assert.deepEqual(settingsChild.nextHistory, ['performance', 'settings'], 'child views must retain their parent path');

const presetEditor = runNavigation('performance', [], 'edit', false);
assert.equal(presetEditor.shared.editSubpage, 'chain', 'the shell must enter Preset Editor on the chain');
assert.equal(presetEditor.shared.editorPage, 'chain', 'EditorView must not restore stale plugin controls');

const compiledNestedBack = ts.transpileModule(`${nestedBackCallback.getText(source)}; return nestedSettingsBackPatch;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const nestedBack = new Function(compiledNestedBack)();
assert.deepEqual(nestedBack('controller', { controllerPage: 'hardware' }), { controllerPage: 'hub' });
assert.deepEqual(nestedBack('controller', { controllerPage: 'diagnostics' }), { controllerPage: 'hub' });
assert.deepEqual(nestedBack('system', { systemPage: 'realtime' }), { systemPage: 'hub' });
assert.equal(nestedBack('controller', { controllerPage: 'hub' }), null);

const menuIds = ['performance', 'transport', 'backingTracks', 'looper', 'recorder', 'drums', 'community', 'banks', 'edit', 'library', 'plugins', 'files', 'settings', 'about'];
const compiledSanitizers = ts.transpileModule(`
const MENU_IDS = ${JSON.stringify(menuIds)};
const SHORTCUT_LIMIT = 4;
${sanitizeOrderCallback.getText(source)}
${sanitizeShortcutsCallback.getText(source)}
return { sanitizedMenuOrder, sanitizedShortcuts };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const sanitizers = new Function(compiledSanitizers)();
const order = sanitizers.sanitizedMenuOrder(['drums', 'drums', 'unknown', 'performance']);
assert.deepEqual(order.slice(0, 2), ['drums', 'performance']);
assert.equal(new Set(order).size, menuIds.length, 'menu ids must be unique');
assert.equal(order.length, menuIds.length, 'new menu destinations must be appended');
assert.deepEqual(sanitizers.sanitizedShortcuts(['drums', 'drums', 'about', 'files', 'settings', 'plugins']),
    ['drums', 'about', 'files', 'settings'], 'shortcut areas must deduplicate and cap at four');
assert.deepEqual(sanitizers.sanitizedShortcuts(['drums', 'about'], new Set(['drums'])), ['about'],
    'the same shortcut cannot occupy both sides');
console.log('Menu navigation regression tests passed');
