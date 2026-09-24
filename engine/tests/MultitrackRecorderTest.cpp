#include "recorder/MultitrackRecorder.h"

#include <algorithm>
#include <cassert>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <thread>
#include <vector>

using pimfx::Json;
using pimfx::MultitrackRecorder;

int main() {
    const auto root = std::filesystem::temp_directory_path()
        / ("pimfx-recorder-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    MultitrackRecorder recorder(root.string());
    recorder.prepare(100, 16);
    recorder.setSourceAvailable(MultitrackRecorder::Source::Backing, true);
    recorder.start();

    std::string error;
    assert(recorder.command("project/new", Json::object({{"name", "Session"}}), error));
    assert(recorder.command("track/add", Json::object({{"source", "raw"}, {"name", "Dry"}}), error));
    assert(!recorder.command("track/add", Json::object({{"source", "drum"}, {"name", "Drums"}}), error));
    error.clear();
    assert(recorder.command("record/start", Json::object({{"playBacking", true}}), error));

    std::vector<float> raw(10, 0.25f), wetLeft(10, 0.5f), wetRight(10, -0.5f);
    std::vector<float> backingLeft(10, 0.1f), backingRight(10, -0.1f);
    const float* rawPointers[] = {raw.data()};
    const float* wetPointers[] = {wetLeft.data(), wetRight.data()};
    const float* backingPointers[] = {backingLeft.data(), backingRight.data()};
    for (int block = 0; block < 8; ++block) {
        assert(recorder.beginCapture(10, block * 10));
        recorder.captureSource(MultitrackRecorder::Source::Raw, rawPointers, 1, 10);
        recorder.captureSource(MultitrackRecorder::Source::Processed, wetPointers, 2, 10);
        recorder.captureSource(MultitrackRecorder::Source::Backing, backingPointers, 2, 10);
        recorder.finishCapture();
    }
    assert(recorder.command("record/stop", Json::object(), error));
    for (int attempt = 0; attempt < 200 && recorder.state()["status"].asString() != "stopped"; ++attempt)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));

    Json state = recorder.state();
    assert(state["status"].asString() == "stopped");
    assert(state["tracks"].size() == 3);
    assert(state["tracks"].at(0)["source"].asString() == "processed");
    assert(state["tracks"].at(2)["source"].asString() == "backing");
    assert(state["tracks"].at(0)["clips"].size() == 1);
    assert(state["tracks"].at(0)["clips"].at(0)["length"].asInt64() == 80);
    assert(state["droppedBlocks"].asInt64() == 0);

    assert(recorder.command("playback/play", Json::object(), error));
    std::vector<float> playbackLeft(10), playbackRight(10);
    float* playbackPointers[] = {playbackLeft.data(), playbackRight.data()};
    bool heardPlayback = false;
    for (int attempt = 0; attempt < 100 && !heardPlayback; ++attempt) {
        std::fill(playbackLeft.begin(), playbackLeft.end(), 0.0f);
        std::fill(playbackRight.begin(), playbackRight.end(), 0.0f);
        recorder.renderPlayback(playbackPointers, 2, 10);
        heardPlayback = std::any_of(playbackLeft.begin(), playbackLeft.end(), [](float sample) { return std::abs(sample) > 0.01f; });
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    assert(heardPlayback);
    assert(recorder.command("track/update", Json::object({
        {"id", state["tracks"].at(0)["id"]}, {"level", 0.75}
    }), error));
    assert(recorder.state()["playbackStatus"].asString() == "playing");
    assert(recorder.command("playback/pause", Json::object(), error));
    assert(recorder.state()["playbackStatus"].asString() == "paused");
    assert(recorder.command("playback/stop", Json::object(), error));

    const std::string clipId = state["tracks"].at(0)["clips"].at(0)["id"].asString();
    assert(recorder.command("clip/split", Json::object({{"id", clipId}, {"position", 40}}), error));
    state = recorder.state();
    assert(state["tracks"].at(0)["clips"].size() == 2);

    std::string path, name;
    assert(recorder.exportFile("mix", "", path, name, error));
    assert(std::filesystem::is_regular_file(path));
    assert(std::filesystem::file_size(path) == 44 + 80 * 4);

    recorder.stop();
    std::error_code ignored;
    std::filesystem::remove_all(root, ignored);
    return 0;
}
