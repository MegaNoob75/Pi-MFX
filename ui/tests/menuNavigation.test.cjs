// Exercise the actual App navigation callback without mounting the full UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = ts.createSourceFile('App.tsx', fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'goTo') callback = node.initializer;
    ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback, 'App must define goTo');
const compiled = ts.transpileModule(`const navigate = ${callback.getText(source)}; return navigate;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
for (const view of ['drums', 'looper', 'recorder', 'performance']) {
    let localMenu = true;
    let shared = { view, menuOpen: true };
    let updates = 0;
    const engine = { client: { updateUiSession(patch) { shared = { ...shared, ...patch }; updates++; } } };
    const goTo = new Function('setMenuOpen', 'view', 'engine', 'layoutDirty', 'setLeaveLayout', 'navigateTo', compiled)(
        value => { localMenu = value; }, view, engine, false,
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
console.log('Menu navigation regression tests passed');
