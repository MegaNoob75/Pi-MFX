#include "transport/MusicalTransport.h"

#include <cassert>
#include <cmath>
#include <iostream>

using pimfx::MusicalTransport;

namespace {

bool closeTo(double left, double right, double tolerance = 0.0001) {
    return std::fabs(left - right) <= tolerance;
}

}

int main() {
    MusicalTransport transport;
    transport.setSampleRate(48000);
    transport.setBpm(120.0);
    transport.setTimeSignature(4, 4);

    auto stopped = transport.beginAudioBlock(64);
    assert(!stopped.playing);
    assert(stopped.frame == 0);
    assert(closeTo(stopped.framesPerBeat, 24000.0));

    const auto tapStart = std::chrono::steady_clock::time_point{};
    transport.tapAt(tapStart);
    const double tapped = transport.tapAt(tapStart + std::chrono::milliseconds(250));
    assert(closeTo(tapped, 240.0));
    transport.setBpm(120.0);

    MusicalTransport debounced;
    debounced.setBpm(90.0);
    debounced.tapAt(tapStart);
    assert(closeTo(debounced.tapAt(tapStart + std::chrono::milliseconds(50)), 90.0));
    assert(closeTo(debounced.tapAt(tapStart + std::chrono::milliseconds(500)), 120.0));

    transport.play(true);
    auto first = transport.beginAudioBlock(64);
    auto second = transport.beginAudioBlock(64);
    assert(first.playing);
    assert(first.frame == 0);
    assert(second.frame == 64);

    transport.setBpm(60.0);
    auto slower = transport.beginAudioBlock(64);
    assert(closeTo(slower.framesPerBeat, 48000.0));
    assert(slower.frame == 128);

    transport.setTimeSignature(3, 4);
    transport.restart();
    auto restarted = transport.beginAudioBlock(144000);
    auto nextBar = transport.beginAudioBlock(64);
    assert(restarted.bar == 0);
    assert(nextBar.bar == 1);
    assert(closeTo(nextBar.barBeat, 0.0));

    transport.setCountInBars(1);
    transport.restart();
    auto countIn = transport.beginAudioBlock(64);
    assert(countIn.countingIn);
    assert(countIn.timelineFrame == -144000);
    assert(countIn.frame == 0);

    transport.setMetronomeEnabled(true);
    transport.setQuantizationEnabled(true);
    auto json = transport.state();
    assert(json["metronomeEnabled"].asBool(false));
    assert(json["quantizationEnabled"].asBool(false));
    assert(json["beatsPerBar"].asInt(0) == 3);

    transport.stop();
    auto finalBlock = transport.beginAudioBlock(64);
    assert(!finalBlock.playing);
    assert(finalBlock.speed == 0.0);

    std::cout << "MusicalTransport tests passed\n";
    return 0;
}
