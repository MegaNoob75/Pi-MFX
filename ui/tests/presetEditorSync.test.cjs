const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = fs.readFileSync(path.join(__dirname, '../../engine/src/Engine.cpp'), 'utf8');
const header = fs.readFileSync(path.join(__dirname, '../../engine/src/Engine.h'), 'utf8');

assert.match(header, /std::atomic<bool> chainStateDirty_\{false\}/,
    'deferred chain publication must expose an off-thread state notification flag');

const swap = engine.match(/bool Engine::swapPendingChainFromAudio\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.match(swap, /activeChain_\.exchange[\s\S]*chainStateDirty_\.store\(true/,
    'the audio-thread swap must mark the newly active chain for publication');
assert.doesNotMatch(swap, /notify\(/,
    'the audio thread must never serialize or broadcast UI state');

const housekeeping = engine.match(/void Engine::housekeepingThread\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.match(housekeeping, /chainStateDirty_\.exchange\(false[\s\S]*notify\(\)/,
    'housekeeping must broadcast state after the deferred chain becomes active');

const notify = engine.match(/void Engine::notify\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.match(notify, /pendingChain_\.load[\s\S]*return/,
    'state broadcasts must not mix new preset metadata with the outgoing live chain');

const notifyPerformance = engine.match(/void Engine::notifyPerformance\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.match(notifyPerformance, /pendingChain_\.load[\s\S]*return/,
    'performance broadcasts must also wait for the deferred chain swap');

console.log('Preset editor synchronization regression tests passed');
