const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');
const view = fs.readFileSync(path.join(__dirname, '../src/views/CommunityPresetsView.tsx'), 'utf8');
const router = fs.readFileSync(path.join(__dirname, '../../engine/src/control/ApiRouter.cpp'), 'utf8');
const packageSource = fs.readFileSync(path.join(__dirname, '../../engine/src/community/CommunityPresetPackage.cpp'), 'utf8');

assert.match(app, /communityCatalogFeatureEnabled/, 'the view must be engine-feature-gated');
assert.match(app, /feature: "community"/, 'the menu entry must use the feature gate');
assert.match(view, /community\/install\/plan/, 'the UI must request a plan before installation');
assert.match(view, /community\/install\/confirm/, 'the UI must explicitly confirm a reviewed plan');
assert.match(view, /request\("community\/catalog", \{ refresh \}\)/, 'catalog requests must carry the refresh flag');
assert.match(view, /useEffect\(\(\) => \{ void load\(true\); \}, \[\]\)/, 'opening the view must refresh the catalog');
assert.doesNotMatch(view, />\s*REFRESH\s*</, 'the catalog must not retain a manual refresh button');
assert.match(view, /community-browser/, 'the catalog must use the compact master-detail browser');
assert.match(view, /community-list-row/, 'the catalog must render compact selectable rows');
assert.match(view, /Object\.keys\(obj\(preset\.community\)\)\.length === 0/, 'community-installed presets must be excluded from sharing');
assert.match(view, /bankId:[\s\S]*presetId:/, 'sharing must identify a selected preset from any bank');
assert.match(view, /communityAuthor/, 'the author must be restored from Pi UI settings');
assert.match(view, /ui\/settings/, 'an edited author must be persisted');
assert.match(view, /MIT/, 'the fixed community preset license must be visible');
assert.match(view, /importsToNewBank|new bank/i, 'the UI must tell the user imports do not overwrite banks');
assert.match(view, /submissionAvailable/, 'submission must follow backend quarantine availability');
assert.match(view, /submissionUrl\.startsWith\("https:\/\/github\.com\/MegaNoob75\/Pi-MFX-Community-Presets\/"\)/,
    'the UI must only open the fixed GitHub catalog submission path');
assert.match(view, /downloadManifest\(\);[\s\S]*window\.open\(submissionUrl/,
    'submitting must download the reviewed manifest before opening GitHub');
assert.match(router, /command == "share\/submit"[\s\S]*submissionAvailable/,
    'the submission endpoint must publish GitHub review availability');
assert.match(router, /pendingCommunityToken_/, 'confirmation must be tied to a short-lived plan token');
assert.match(router, /normalizedCatalogName/, 'sharing must reject duplicate catalog names');
assert.match(router, /contentFingerprint/, 'sharing must reject duplicate preset content');
assert.match(router, /importCommunityPreset\(manifest, incomplete/, 'unresolved requirements must produce an incomplete import');
assert.match(packageSource, /http:\/\/two-play\.com\/plugins\/toob-nam/, 'NAM files must be tied to TooB NAM');
assert.match(packageSource, /http:\/\/two-play\.com\/plugins\/toob-cab-ir/, 'IR files must be tied to TooB Cab IR');
assert.match(packageSource, /manifest\.set\("license", "MIT"\)/, 'manifests must always use MIT');
assert.match(packageSource, /packages cannot contain download URLs or data URLs/, 'arbitrary URLs must be rejected');
assert.match(packageSource, /plugin file properties must contain filenames only/, 'shared manifests must not expose filesystem paths');

console.log('Community preset catalog regression tests passed');
