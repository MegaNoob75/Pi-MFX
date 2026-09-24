#include "drums/DrumSequencer.h"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <iostream>
#include <string>

using pimfx::DrumSequencer;
using pimfx::TransportBlock;

namespace {

TransportBlock playingBlock(int64_t timelineFrame, double framesPerBeat = 24000.0) {
    TransportBlock block;
    block.playing = true;
    block.timelineFrame = timelineFrame;
    block.frame = std::max<int64_t>(0, timelineFrame);
    block.framesPerBeat = framesPerBeat;
    block.framesPerSecond = 48000.0;
    return block;
}

bool closeTo(float left, float right, float tolerance = 0.0001f) {
    return std::fabs(left - right) <= tolerance;
}

} // namespace

int main() {
    DrumSequencer sequencer;
    DrumSequencer::Pattern pattern;
    pattern.length = 16;
    pattern.steps[0][0] = {127, 1};
    pattern.steps[1][1] = {64, 0};

    std::string error;
    assert(sequencer.setPattern(pattern, error));
    assert(error.empty());

    std::array<DrumSequencer::Trigger, 16> triggers{};
    size_t count = sequencer.renderBlock(playingBlock(0), 7000, triggers.data(), triggers.size());
    assert(count == 2);
    assert(triggers[0].frameOffset == 0);
    assert(triggers[0].voice == 0);
    assert(triggers[0].accent);
    assert(closeTo(triggers[0].velocity, 1.0f));
    assert(triggers[1].frameOffset == 6000);
    assert(triggers[1].voice == 1);
    assert(!triggers[1].accent);

    sequencer.setSwing(1.0f);
    count = sequencer.renderBlock(playingBlock(6000), 4000, triggers.data(), triggers.size());
    assert(count == 1);
    assert(triggers[0].voice == 1);
    assert(triggers[0].frameOffset == 2700);

    sequencer.setSwing(0.0f);
    sequencer.setHumanization(1.0f);
    DrumSequencer::Pattern humanPattern;
    humanPattern.length = 32;
    humanPattern.steps[2][2] = {100, 0};
    assert(sequencer.setPattern(humanPattern, error));
    const size_t firstCount = sequencer.renderBlock(playingBlock(9000), 6000, triggers.data(), triggers.size());
    assert(firstCount == 1);
    const auto firstHumanTrigger = triggers[0];
    const size_t secondCount = sequencer.renderBlock(playingBlock(9000), 6000, triggers.data(), triggers.size());
    assert(secondCount == 1);
    assert(triggers[0].frameOffset == firstHumanTrigger.frameOffset);
    assert(closeTo(triggers[0].velocity, firstHumanTrigger.velocity));
    assert(sequencer.activePatternLength() == 32);

    TransportBlock countIn = playingBlock(-64);
    countIn.countingIn = true;
    assert(sequencer.renderBlock(countIn, 64, triggers.data(), triggers.size()) == 0);

    TransportBlock stopped = playingBlock(0);
    stopped.playing = false;
    assert(sequencer.renderBlock(stopped, 7000, triggers.data(), triggers.size()) == 0);

    DrumSequencer::Pattern invalid;
    invalid.length = 24;
    assert(!sequencer.setPattern(invalid, error));
    assert(!error.empty());

    DrumSequencer::Pattern dense;
    dense.length = 64;
    for (auto& voice : dense.steps) voice[0] = {127, 0};
    assert(sequencer.setPattern(dense, error));
    sequencer.setHumanization(0.0f);
    sequencer.clearDroppedTriggers();
    std::array<DrumSequencer::Trigger, 2> smallBuffer{};
    assert(sequencer.renderBlock(playingBlock(0), 1, smallBuffer.data(), smallBuffer.size()) == 2);
    assert(sequencer.droppedTriggers() == DrumSequencer::kVoiceCount - smallBuffer.size());
    assert(sequencer.activePatternLength() == 64);

    DrumSequencer arranged;
    DrumSequencer::Program program;
    for (auto& item : program.variations) item.length = 16;
    program.fill.length = 16;
    program.variations[0].steps[0][0] = {100, 0};
    program.variations[1].steps[1][0] = {100, 0};
    program.fill.steps[2][0] = {100, 1};
    program.songLength = 2;
    program.song[0] = {0, 1};
    program.song[1] = {1, 1};
    assert(arranged.setProgram(program, error));
    arranged.requestVariation(1);
    count = arranged.renderBlock(playingBlock(0), 1, triggers.data(), triggers.size());
    assert(count == 1 && triggers[0].voice == 1);
    assert(arranged.activeVariation() == 1);
    arranged.triggerFill();
    count = arranged.renderBlock(playingBlock(0), 1, triggers.data(), triggers.size());
    assert(count == 1 && triggers[0].voice == 2 && triggers[0].accent);
    assert(arranged.fillActive());
    arranged.setSongMode(true);
    count = arranged.renderBlock(playingBlock(96000), 1, triggers.data(), triggers.size());
    assert(count == 1 && triggers[0].voice == 1);
    assert(arranged.activeSongSection() == 1);

    std::cout << "DrumSequencer tests passed\n";
    return 0;
}
