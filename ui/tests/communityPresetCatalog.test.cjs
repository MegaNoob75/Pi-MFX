const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');
const view = fs.readFileSync(path.join(__dirname, '../src/views/CommunityPresetsView.tsx'), 'utf8');
const router = fs.readFileSync(path.join(__dirname, '../../engine/src/control/ApiRouter.cpp'), 'utf8');
const packageSource = fs.readFileSync(path.join(__dirname, '../../engine/src/community/CommunityPresetPackage.cpp'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');
const engineSource = fs.readFileSync(path.join(__dirname, '../../engine/src/Engine.cpp'), 'utf8');
const modelSource = fs.readFileSync(path.join(__dirname, '../../engine/src/model/Model.cpp'), 'utf8');
const performanceSource = fs.readFileSync(path.join(__dirname, '../src/views/PerformanceView.tsx'), 'utf8');

assert.match(app, /communityCatalogFeatureEnabled/, 'the view must be engine-feature-gated');
assert.match(app, /feature: "community"/, 'the menu entry must use the feature gate');
assert.match(view, /community\/install\/plan/, 'the UI must request a plan before installation');
assert.match(view, /community\/install\/confirm/, 'the UI must explicitly confirm a reviewed plan');
assert.match(view, /request\("community\/catalog", \{ refresh \}\)/, 'catalog requests must carry the refresh flag');
assert.match(view, /useEffect\(\(\) => \{ void load\(true\); \}, \[\]\)/, 'opening the view must refresh the catalog');
assert.doesNotMatch(view, />\s*REFRESH\s*</, 'the catalog must not retain a manual refresh button');
assert.match(view, /community-browser/, 'the catalog must use the compact master-detail browser');
assert.match(view, /community-list-row/, 'the catalog must render compact selectable rows');
assert.match(view, /manifestLoadState === "loading"/, 'requirements must show a loading state until the manifest arrives');
assert.match(view, /manifestLoadState === "error"/, 'manifest failures must not be reported as no requirements');
assert.match(view, /dependencies\)\.localAssets/, 'manual local assets must be included in the requirements summary');
assert.match(view, /"http:\/\/two-play\.com\/plugins\/toob-nam": "TooB Neural Amp Modeler"/,
    'known LV2 identifiers must be presented with a friendly plugin name');
assert.match(css, /\.community-review[^}]*margin-top:\s*auto/, 'the review button must stay at the bottom of the detail panel');
assert.match(view, /These requirements need attention:[\s\S]*item\.reason/,
    'incomplete installs must identify each unmet requirement and its reason');
assert.match(router, /kind, "Community"/,
    'community downloads must remain visible under the NAM or IR Community folder');
assert.match(router, /tone3000_\.model\(id, modelError\)[\s\S]*tone3000_\.models/,
    'community installs must resolve the exact TONE3000 model ID before falling back to a tone listing');
assert.match(modelSource, /communityHolding/, 'the Community staging bank marker must persist');
assert.match(engineSource, /name = "Community"[\s\S]*communityHolding = true/,
    'all community installs must use one reserved Community holding bank');
assert.match(engineSource, /!bank\.communityHolding[\s\S]*playable/,
    'hardware bank stepping must skip the Community holding bank');
assert.match(performanceSource, /filter\(\(item\) => !bool\(item\.communityHolding\)\)/,
    'the Community holding bank must be hidden from Performance');
assert.match(view, /installedIds[\s\S]*community-installed[\s\S]*✓/,
    'installed catalog entries must show a check mark');
assert.match(view, /setTimeout\([\s\S]*600[\s\S]*UNINSTALL PRESET/,
    'long-pressing an installed entry must offer a confirmed uninstall');
assert.match(router, /command == "uninstall"[\s\S]*uninstallCommunityPreset/,
    'catalog uninstall must be handled by the engine');
assert.match(engineSource, /provenance\.set\("dependencies"/,
    'installed presets must retain their community dependency provenance');
assert.match(engineSource, /removeDependencies\("tone3000"\)[\s\S]*removeDependencies\("irs"\)/,
    'preset deletion must clean unused community NAM and IR dependencies');
assert.match(view, /Object\.keys\(obj\(preset\.community\)\)\.length === 0/, 'community-installed presets must be excluded from sharing');
assert.match(view, /bankId:[\s\S]*presetId:/, 'sharing must identify a selected preset from any bank');
assert.match(view, /communityAuthor/, 'the author must be restored from Pi UI settings');
assert.match(view, /ui\/settings/, 'an edited author must be persisted');
assert.match(view, /MIT/, 'the fixed community preset license must be visible');
assert.match(view, /Community staging bank[\s\S]*never overwritten/i,
    'the UI must explain the staging bank without implying that each install creates a bank');
assert.match(view, /submissionAvailable/, 'submission must follow backend quarantine availability');
assert.match(view, /submissionUrl\.startsWith\("https:\/\/github\.com\/MegaNoob75\/Pi-MFX-Community-Presets\/"\)/,
    'the UI must only open the fixed GitHub catalog submission path');
assert.match(view, /downloadManifest\(\);[\s\S]*window\.open\(submissionUrl/,
    'submitting must download the reviewed manifest before opening GitHub');
assert.match(view, /merge the generated pull request/i,
    'the UI must explain the final publication step');
assert.match(router, /command == "share\/submit"[\s\S]*submissionAvailable/,
    'the submission endpoint must publish GitHub review availability');
assert.match(router, /pendingCommunityToken_/, 'confirmation must be tied to a short-lived plan token');
assert.match(router, /normalizedCatalogName/, 'sharing must reject duplicate catalog names');
assert.match(router, /contentFingerprint/, 'sharing must reject duplicate preset content');
assert.match(router, /importCommunityPreset\(manifest, incomplete/, 'unresolved requirements must produce an incomplete import');
assert.match(fs.readFileSync(path.join(__dirname, '../../engine/src/community/CommunityCatalog.cpp'), 'utf8'),
    /versionedUrl\(kCatalogIndex, refreshVersion\(\)\)/,
    'explicit catalog refreshes must bypass stale raw GitHub CDN responses');
assert.match(packageSource, /http:\/\/two-play\.com\/plugins\/toob-nam/, 'NAM files must be tied to TooB NAM');
assert.match(packageSource, /http:\/\/two-play\.com\/plugins\/toob-cab-ir/, 'IR files must be tied to TooB Cab IR');
assert.match(packageSource, /manifest\.set\("license", "MIT"\)/, 'manifests must always use MIT');
assert.match(packageSource, /packages cannot contain download URLs or data URLs/, 'arbitrary URLs must be rejected');
assert.match(packageSource, /plugin file properties must contain filenames only/, 'shared manifests must not expose filesystem paths');

console.log('Community preset catalog regression tests passed');
