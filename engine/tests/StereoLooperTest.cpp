#include "looper/StereoLooper.h"

#include <cassert>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <thread>
#include <vector>

using pimfx::StereoLooper;
using pimfx::TransportBlock;

int main() {
    const auto root = std::filesystem::temp_directory_path()
        / ("pimfx-looper-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    StereoLooper looper(root.string());
    looper.prepare(100, 2);
    looper.configure("free", false, 1.0f, 1.0f);
    looper.start();

    std::vector<float> left(25, 0.25f), right(25, -0.125f);
    std::vector<float> outLeft(25), outRight(25);
    const float* inputs[] = {left.data(), right.data()};
    float* outputs[] = {outLeft.data(), outRight.data()};
    TransportBlock transport;
    transport.playing = true;
    transport.framesPerBeat = 50.0;
    transport.beatsPerBar = 4.0;

    std::string error;
    assert(looper.enqueue(StereoLooper::Action::Record, error));
    looper.process(inputs, 2, outputs, 2, 25, &transport);
    assert(looper.state()["status"].asString() == "recording");
    assert(looper.enqueue(StereoLooper::Action::Finish, error));
    looper.process(inputs, 2, outputs, 2, 25, &transport);
    assert(looper.state()["hasLoop"].asBool());
    assert(looper.state()["duration"].asDouble() == 0.25);

    assert(looper.enqueue(StereoLooper::Action::Play, error));
    std::fill(outLeft.begin(), outLeft.end(), 0.0f);
    std::fill(outRight.begin(), outRight.end(), 0.0f);
    looper.process(inputs, 2, outputs, 2, 25, &transport);
    assert(std::abs(outLeft[0] - 0.25f) < 0.0001f);
    assert(std::abs(outRight[0] + 0.125f) < 0.0001f);

    assert(looper.enqueue(StereoLooper::Action::Overdub, error));
    looper.process(inputs, 2, outputs, 2, 25, &transport);
    assert(looper.state()["status"].asString() == "overdubbing");
    assert(looper.state()["canUndo"].asBool());
    assert(looper.enqueue(StereoLooper::Action::Overdub, error));
    looper.process(inputs, 2, outputs, 2, 1, &transport);
    assert(looper.state()["status"].asString() == "playing");
    assert(looper.enqueue(StereoLooper::Action::Undo, error));
    looper.process(inputs, 2, outputs, 2, 1, &transport);
    assert(looper.state()["canRedo"].asBool());

    assert(looper.save("take", error));
    for (int attempt = 0; attempt < 100 && looper.state()["status"].asString() == "saving"; ++attempt) {
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    assert(looper.state()["saveError"].asString().empty());
    assert(std::filesystem::is_regular_file(looper.savedPath()));
    assert(looper.state()["savedLoops"].items().size() == 1);

    assert(looper.renameSaved("take.wav", "renamed", error));
    assert(std::filesystem::is_regular_file(root / "renamed.wav"));

    assert(looper.enqueue(StereoLooper::Action::Clear, error));
    looper.process(inputs, 2, outputs, 2, 1, &transport);
    assert(!looper.state()["hasLoop"].asBool());
    assert(looper.load("renamed.wav", error));
    looper.process(inputs, 2, outputs, 2, 1, &transport);
    assert(looper.state()["hasLoop"].asBool());
    assert(looper.deleteSaved("renamed.wav", error));
    assert(looper.state()["savedLoops"].items().empty());

    assert(looper.enqueue(StereoLooper::Action::Mute, error));
    looper.process(inputs, 2, outputs, 2, 1, &transport);
    assert(looper.state()["muted"].asBool());
    assert(looper.enqueue(StereoLooper::Action::Mute, error));
    looper.process(inputs, 2, outputs, 2, 1, &transport);

    assert(looper.enqueue(StereoLooper::Action::Clear, error));
    looper.process(inputs, 2, outputs, 2, 1, &transport);
    looper.configure("beat", false, 1.0f, 1.0f);
    transport.timelineFrame = 25;
    assert(looper.enqueue(StereoLooper::Action::Record, error));
    looper.process(inputs, 2, outputs, 2, 25, &transport);
    assert(looper.state()["status"].asString() == "armed");
    transport.timelineFrame = 50;
    looper.process(inputs, 2, outputs, 2, 25, &transport);
    assert(looper.state()["status"].asString() == "recording");
    assert(looper.enqueue(StereoLooper::Action::Stop, error));
    transport.timelineFrame = 75;
    looper.process(inputs, 2, outputs, 2, 25, &transport);
    transport.timelineFrame = 100;
    looper.process(inputs, 2, outputs, 2, 1, &transport);
    assert(std::abs(looper.state()["duration"].asDouble() - 0.5) < 0.0001);
    looper.stop();
    std::filesystem::remove_all(root);
    return 0;
}
