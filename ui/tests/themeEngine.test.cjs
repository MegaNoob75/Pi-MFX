const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const storage = new Map();
const element = () => {
    const properties = new Map();
    return { dataset: {}, properties, style: {
        setProperty: (key, value) => properties.set(key, value),
        removeProperty: key => properties.delete(key)
    } };
};
const document = { documentElement: element(), body: element() };
const moduleUnderTest = { exports: {} };
const compiled = ts.transpileModule(fs.readFileSync(
    path.join(__dirname, '../src/theme/theme.ts'), 'utf8'
), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(compiled, {
    module: moduleUnderTest, exports: moduleUnderTest.exports, structuredClone, document,
    window: { localStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key)
    }, dispatchEvent() {} },
    Event: class Event {}
});
const theme = moduleUnderTest.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const base = () => structuredClone(theme.BUILT_IN_THEMES[0]);

test('every built-in survives validation and an export/import round trip', () => {
    for (const value of theme.BUILT_IN_THEMES) {
        const restored = theme.validateMultiFXTheme(plain(value));
        assert.ok(restored, value.name);
        assert.deepEqual(plain(restored), plain(value));
    }
});

test('palette colors follow their defaults without recoloring equal custom colors', () => {
    const original = base();
    const edited = theme.customizeMultiFXTheme(original, next => {
        next.appearance.surfaces.panel.text = original.colors.background;
    });
    const result = theme.recolorMultiFXTheme(edited, 'background', '#123456');
    assert.equal(result.colors.background, '#123456');
    assert.ok(result.appearance.surfaces.page.background.colors.includes('#123456'));
    assert.equal(result.appearance.surfaces.panel.text, original.colors.background);
    assert.deepEqual(plain(original), plain(base()));
});

test('explicit customization stays detached after a later palette color collision', () => {
    const edited = theme.customizeMultiFXTheme(base(), next => {
        next.appearance.surfaces.panel.text = '#123456';
    });
    const matching = theme.recolorMultiFXTheme(edited, 'text', '#123456');
    const renamed = theme.validateMultiFXTheme(plain({ ...matching, name: 'Renamed custom theme' }));
    const result = theme.recolorMultiFXTheme(renamed, 'text', '#654321');
    assert.equal(result.appearance.surfaces.panel.text, '#123456');
    assert.equal(result.colors.text, '#654321');
});

test('palette edits preserve explicit geometry, fonts and motion', () => {
    const edited = theme.customizeMultiFXTheme(base(), next => {
        next.appearance.controls.switchStyle = 'arcade';
        next.appearance.controls.switchShape = 'pill';
        next.appearance.fonts.controlPopupSizePercent = 190;
        next.appearance.motion.enabled = false;
    });
    const result = theme.recolorMultiFXTheme(edited, 'panel', '#123456');
    assert.deepEqual(plain(result.appearance.controls), plain(edited.appearance.controls));
    assert.deepEqual(plain(result.appearance.fonts), plain(edited.appearance.fonts));
    assert.deepEqual(plain(result.appearance.motion), plain(edited.appearance.motion));
    assert.equal(result.paletteProfile, base().paletteProfile);
});

test('legacy imports keep customized appearance and migrate retired shapes', () => {
    const legacy = base();
    delete legacy.paletteProfile;
    delete legacy.paletteOverrides;
    legacy.appearance.controls.switchShape = 'hexagon';
    legacy.appearance.surfaces.panel.text = legacy.colors.background;
    const loaded = theme.validateMultiFXTheme(legacy);
    assert.equal(loaded.appearance.controls.switchShape, 'rounded');
    const result = theme.recolorMultiFXTheme(loaded, 'background', '#123456');
    assert.equal(result.appearance.surfaces.panel.text, legacy.colors.background);
});

test('palette tracking rejects unknown profiles and arbitrary override paths', () => {
    assert.equal(theme.validateMultiFXTheme({ ...base(), paletteProfile: 'unknown' }), undefined);
    assert.equal(theme.validateMultiFXTheme({ ...base(), paletteOverrides: ['__proto__.value'] }), undefined);
});

test('a light set to None cannot keep an animation after import', () => {
    const edited = base();
    edited.appearance.controls.switchStyle = 'footswitch';
    edited.appearance.controls.indicatorStyle = 'none';
    edited.appearance.controls.indicatorAnimation = 'spin';
    assert.equal(theme.validateMultiFXTheme(edited).appearance.controls.indicatorAnimation, 'none');
    assert.deepEqual(plain(theme.indicatorAnimationOptions('footswitch', 'none')), [['none', 'Off']]);
    assert.ok(theme.indicatorAnimationOptions('arcade', 'bar').some(([name]) => name === 'chase'));
    assert.ok(theme.indicatorAnimationOptions('arcade', 'ring').some(([name]) => name === 'spin'));
});

test('function lights and pop-out dimensions are published independently', () => {
    const edited = theme.customizeMultiFXTheme(base(), next => {
        next.appearance.roles.navigation.normal.indicator = '#123456';
        next.appearance.roles.navigation.active.indicator = '#654321';
        next.appearance.fonts.controlPopupSizePercent = 190;
    });
    theme.applyMultiFXTheme(edited);
    const properties = document.documentElement.properties;
    assert.equal(properties.get('--mfx-role-navigation-normal-indicator'), '#123456');
    assert.equal(properties.get('--mfx-role-navigation-active-indicator'), '#654321');
    assert.equal(properties.get('--mfx-control-popup-scale'), '1.9');
    assert.equal(theme.themeLedColors(edited).navigation, '#654321');
    theme.clearAppliedMultiFXTheme();
    assert.equal(properties.has('--mfx-control-popup-scale'), false);
});

test('library updates replace names case-insensitively without mutating the input', () => {
    const original = base();
    const renamed = { ...base(), name: original.name.toUpperCase() };
    const current = [original];
    const result = theme.mergeCustomMultiFXTheme(current, renamed);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, renamed.name);
    assert.equal(current[0].name, original.name);
    assert.equal(theme.saveMultiFXTheme(renamed), true);
    assert.deepEqual(plain(theme.loadMultiFXTheme()), plain(theme.validateMultiFXTheme(renamed)));
});
