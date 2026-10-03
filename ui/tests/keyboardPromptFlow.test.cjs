const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const provider = fs.readFileSync(
    path.join(__dirname, '../src/keyboard/KeyboardProvider.tsx'),
    'utf8'
);

assert.match(provider,
    /if \(shouldUseOnScreenKeyboard\(\)\) \{[\s\S]*target: null,[\s\S]*resolve: request\.resolve[\s\S]*setSession\(next\);[\s\S]*return;/,
    'askText requests must open a directly resolved Pi-MFX keyboard session');
assert.match(provider,
    /setAsk\(\(previous\) => \{[\s\S]*return request;[\s\S]*setAskValue\(request\.value\);/,
    'keyboard-disabled browsers must retain the standard Cancel/OK prompt');
assert.match(provider,
    /onCancel=\{\(\) => \{[\s\S]*finish\(session, null\)/,
    'Cancel must resolve a direct prompt without applying a value');
assert.match(provider,
    /onDone=\{\(value\) => finish\(session, value\)\}/,
    'Done must resolve a direct prompt with the entered value');

console.log('Keyboard prompt flow regression tests passed');
