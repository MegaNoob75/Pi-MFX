const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = fs.readFileSync(path.join(__dirname, '../../engine/src/Engine.cpp'), 'utf8');
const header = fs.readFileSync(path.join(__dirname, '../../engine/src/Engine.h'), 'utf8');

assert.match(header, /std::atomic<bool> chainStateDirty_\{false\}/,
    'deferred chain publication must expose an off-thread state notification flag');
assert.match(header, /std::atomic<int> pendingEnabled\{-1\}/,
    'effect enable changes must be staged until the master reaches silence');

const swap = engine.match(/bool Engine::swapPendingChainFromAudio\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.match(swap, /activeChain_\.exchange[\s\S]*chainStateDirty_\.store\(true/,
    'the audio-thread swap must mark the newly active chain for publication');
assert.doesNotMatch(swap, /notify\(/,
    'the audio thread must never serialize or broadcast UI state');

const housekeeping = engine.match(/void Engine::housekeepingThread\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.match(housekeeping, /chainStateDirty_\.exchange\(false[\s\S]*notify\(\)/,
    'housekeeping must broadcast state after the deferred chain becomes active');

const notify = engine.match(/void Engine::notify\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.match(notify, /pendingChain_\.peek[\s\S]*return/,
    'state broadcasts must not mix new preset metadata with the outgoing live chain');

const notifyPerformance = engine.match(/void Engine::notifyPerformance\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.match(notifyPerformance, /pendingChain_\.peek[\s\S]*return/,
    'performance broadcasts must also wait for the deferred chain swap');

assert.match(engine, /beginDeferredStateChanges\(\)[\s\S]*loadState\([\s\S]*mutedTransition\)[\s\S]*pendingEnabled\.store/,
    'snapshot controls and enable state must be staged together behind the fade');
assert.match(engine, /TransitionState::Muted[\s\S]*applyDeferredTransitionStateFromAudio\(\)/,
    'staged state must only be applied by the audio thread after reaching silence');
assert.match(engine, /TransitionState::Muted\) \{\s*const bool chainReady = swapPendingChainFromAudio\(\);\s*if \(chainReady\) applyDeferredTransitionStateFromAudio\(\);/,
    'fade-only changes must apply at silence without requiring a whole-chain swap');

console.log('Preset editor synchronization regression tests passed');
