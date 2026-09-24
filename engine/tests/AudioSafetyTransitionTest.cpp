#include "audio/MasterOutputSafety.h"
#include "core/LatestPointerMailbox.h"
#include "host/Lv2WorkerTransitionState.h"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <limits>
#include <memory>
#include <vector>

using namespace pimfx;

namespace {

void processMono(MasterOutputSafety& safety, std::vector<float>& samples,
                 bool allowFadeIn = true) {
    float* channels[] = {samples.data()};
    safety.process(channels, 1, static_cast<unsigned>(samples.size()), allowFadeIn);
}

void limiterBoundsOutput() {
    AudioSettings settings;
    settings.dcBlockerEnabled = false;
    settings.limiterEnabled = true;
    settings.limiterCeilingDb = -6.0f;
    settings.limiterLookaheadMs = 0.0f;
    MasterOutputSafety safety;
    safety.configure(settings, 48000);
    safety.prepare(48000);
    std::vector<float> samples(256, 2.0f);
    processMono(safety, samples);
    const float ceiling = std::pow(10.0f, -6.0f / 20.0f);
    for (float sample : samples) assert(std::fabs(sample) <= ceiling + 1e-5f);
}

void dcBlockerRejectsOffset() {
    AudioSettings settings;
    settings.dcBlockerEnabled = true;
    settings.dcBlockerHz = 10.0f;
    settings.limiterEnabled = false;
    MasterOutputSafety safety;
    safety.configure(settings, 48000);
    safety.prepare(48000);
    std::vector<float> samples(48000, 0.5f);
    processMono(safety, samples);
    assert(std::fabs(samples.front()) > 0.45f);
    assert(std::fabs(samples.back()) < 0.001f);
}

void fadesReachSilenceBeforeRelease() {
    AudioSettings settings;
    settings.dcBlockerEnabled = false;
    settings.limiterEnabled = false;
    settings.patchFadeOutMs = 4.0f;
    settings.patchFadeInMs = 4.0f;
    MasterOutputSafety safety;
    safety.configure(settings, 1000);
    safety.prepare(1000);
    safety.beginFadeOut();
    std::vector<float> fadeOut(4, 1.0f);
    processMono(safety, fadeOut, false);
    assert(safety.transitionState() == MasterOutputSafety::TransitionState::Muted);
    assert(std::fabs(fadeOut.back()) < 1e-6f);

    std::vector<float> held(4, 1.0f);
    processMono(safety, held, false);
    assert(std::all_of(held.begin(), held.end(), [](float value) { return value == 0.0f; }));

    std::vector<float> fadeIn(4, 1.0f);
    processMono(safety, fadeIn, true);
    assert(safety.transitionState() == MasterOutputSafety::TransitionState::Running);
    assert(std::fabs(fadeIn.back() - 1.0f) < 1e-6f);
}

struct TrackedChain {
    explicit TrackedChain(int value) : id(value) {}
    ~TrackedChain() { ++destroyed; }
    int id;
    static int destroyed;
};
int TrackedChain::destroyed = 0;

void rapidPublicationKeepsNewestChain() {
    TrackedChain::destroyed = 0;
    LatestPointerMailbox<TrackedChain> mailbox;
    mailbox.publish(std::make_unique<TrackedChain>(1));
    mailbox.publish(std::make_unique<TrackedChain>(2));
    mailbox.publish(std::make_unique<TrackedChain>(3));
    assert(TrackedChain::destroyed == 2);
    std::unique_ptr<TrackedChain> latest(mailbox.take());
    assert(latest && latest->id == 3);
    assert(mailbox.peek() == nullptr);
}

void lv2WorkerTransitionWaitsForTheWholePipeline() {
    Lv2WorkerTransitionState state;
    state.begin();
    assert(state.active());
    assert(!state.canDispatch(true, true, true, true));
    assert(!state.canDispatch(true, false, false, true));
    assert(!state.canDispatch(true, false, true, false));
    assert(state.canDispatch(true, false, true, true));

    state.update(true, 0, false, true, false);
    assert(state.active());
    state.update(true, 0, false, true, true);
    assert(!state.active());
}

} // namespace

int main() {
    limiterBoundsOutput();
    dcBlockerRejectsOffset();
    fadesReachSilenceBeforeRelease();
    rapidPublicationKeepsNewestChain();
    lv2WorkerTransitionWaitsForTheWholePipeline();
    return 0;
}
