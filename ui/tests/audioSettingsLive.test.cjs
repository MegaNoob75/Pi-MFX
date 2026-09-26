const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const settings = fs.readFileSync(path.join(__dirname, '../src/views/SettingsView.tsx'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, '../../engine/src/Engine.cpp'), 'utf8');
const router = fs.readFileSync(path.join(__dirname, '../../engine/src/control/ApiRouter.cpp'), 'utf8');
const model = fs.readFileSync(path.join(__dirname, '../../engine/src/model/Model.cpp'), 'utf8');

assert.match(router, /command == "audio\/preview"[\s\S]*previewAudioSettings\(payload\)/,
    'audio settings need a non-persistent live-preview route');

const preview = engine.match(/void Engine::previewAudioSettings\(const Json& json\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.match(preview, /configureAudioSafety\(preview\)/,
    'output-safety controls must update while audio is running');
assert.match(preview, /inputGain_\.store[\s\S]*targetOutputGain_\.store/,
    'input and output gains must update while audio is running');
assert.doesNotMatch(preview, /persistSettings|restartAudio|settings_\.audio\s*=/,
    'live preview must neither persist nor reopen the audio device');

assert.match(settings, /queueLiveRequest\("audio\/preview", patch\)/,
    'slider movement must use the live-preview route');
assert.match(settings, /window\.requestAnimationFrame[\s\S]*pendingLivePreview/,
    'live slider traffic must be frame-throttled');
assert.match(settings, /queueLiveRequest\("audio\/settings", \{ \[key\]: next \}\)/,
    'slider release must persist only the adjusted live value');
assert.match(settings, /const queueLiveRequest[\s\S]*livePreviewQueue\.current = request/,
    'audio previews and commits must remain ordered on one request queue');
assert.match(settings, /onPointerCancel=\{\(event\) => commitLive/,
    'interrupted touch drags must not leave a transient audio value uncommitted');
assert.match(settings, /Input gain[\s\S]*type="range" min=\{-60\} max=\{24\}[\s\S]*audio-live-number/,
    'input gain must use a capped slider plus compact numeric input');
assert.match(settings, /Output gain[\s\S]*type="range" min=\{-60\} max=\{12\}[\s\S]*audio-live-number/,
    'output gain must use a capped slider plus compact numeric input');
assert.match(settings, /\.map\(\(\[key, label, min, max, step, fallback, unit\]\)[\s\S]*previewLive\(key[\s\S]*commitLive\(key/,
    'mapped safety controls must preview while moving and persist on release');
for (const key of ['patchFadeOutMs', 'patchFadeInMs', 'limiterCeilingDb',
    'limiterLookaheadMs', 'limiterReleaseMs', 'dcBlockerHz']) {
    assert.match(settings, new RegExp(`"${key}"`), `${key} must remain in the mapped safety controls`);
}
assert.match(css, /\.audio-live-control[\s\S]*grid-template-columns:[^;]*84px/,
    'gain number fields must remain compact beside their sliders');
assert.match(model, /inputGainDb = std::max\(-60\.0f, std::min\(24\.0f/,
    'the engine must enforce the input-gain cap');
assert.match(model, /outputGainDb = std::max\(-60\.0f, std::min\(12\.0f/,
    'the engine must enforce the output-gain cap');
assert.match(model, /else if \(json\.has\("inputChannelOffset"\)\)/,
    'partial live-setting commits must preserve the selected guitar input');

console.log('Live audio settings regression tests passed');
