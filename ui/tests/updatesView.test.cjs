const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');
const view = fs.readFileSync(path.join(__dirname, '../src/views/UpdatesView.tsx'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');
const router = fs.readFileSync(path.join(__dirname, '../../engine/src/control/ApiRouter.cpp'), 'utf8');
const store = fs.readFileSync(path.join(__dirname, '../../engine/src/library/PluginStore.cpp'), 'utf8');
const helper = fs.readFileSync(path.join(__dirname, '../../scripts/plugin-helper.py'), 'utf8');
const service = fs.readFileSync(path.join(__dirname, '../../systemd/pimfx-plugin-helper.service.in'), 'utf8');

assert.match(css, /\.updates-progress\s*\{[^}]*max-height:\s*150px[^}]*overflow:\s*auto/s,
    'the update terminal must stay fixed-height and scroll');
assert.match(css, /\.updates-layout\s*\{[^}]*grid-template-columns:/s,
    'the Updates page must use the compact landscape layout');
assert.match(view, /\(\["dev", "main"\] as const\)/,
    'only dev and main are product update channels');
assert.doesNotMatch(view, /"workstation"/,
    'the retired workstation branch must not appear in the product updater');
assert.match(app, /global-update-label[\s\S]*UPDATE AVAILABLE/,
    'a global code-update label must be rendered above the page title');
assert.match(app, /branch:\s*""/,
    'the background check must follow the currently installed Git branch');
assert.match(view, /UPDATE LV2 PLUGINS/,
    'the Updates page must expose the combined LV2 update action');
assert.match(router, /command == "updates\/status"/,
    'the engine must expose cached LV2 update status');
assert.match(router, /command == "updates\/apt"/,
    'the engine must expose the derived apt LV2 update action');
assert.match(store, /record\.set\("provider", "pipedal-bundle"\)/,
    'TooB installs must retain provider provenance for a future apt migration');
assert.match(helper, /time\.sleep\(60\)/,
    'boot checks must wait for audio startup');
assert.match(service, /Nice=19[\s\S]*IOSchedulingClass=idle/,
    'background checks must run below the realtime audio service');

console.log('Updates view and background checker regression tests passed');
