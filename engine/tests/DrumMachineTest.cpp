#include "drums/DrumMachine.h"

#include <algorithm>
#include <cassert>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

using pimfx::DrumMachine;
using pimfx::Json;
using pimfx::TransportBlock;

namespace {

void put16(std::string& out, uint16_t value) {
    out.push_back(static_cast<char>(value)); out.push_back(static_cast<char>(value >> 8));
}
void put32(std::string& out, uint32_t value) {
    put16(out, static_cast<uint16_t>(value)); put16(out, static_cast<uint16_t>(value >> 16));
}
std::string impulseWave() {
    constexpr uint32_t frames = 32, rate = 48000, bytes = frames * 2;
    std::string out("RIFF", 4); put32(out, 36 + bytes); out += "WAVEfmt "; put32(out, 16);
    put16(out, 1); put16(out, 1); put32(out, rate); put32(out, rate * 2); put16(out, 2); put16(out, 16);
    out += "data"; put32(out, bytes); put16(out, 32767);
    for (uint32_t frame = 1; frame < frames; ++frame) put16(out, 0);
    return out;
}

} // namespace

int main() {
    namespace fs = std::filesystem;
    const fs::path root = fs::temp_directory_path()
        / ("pimfx-drums-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    DrumMachine drums(root.string());
    drums.prepare(48000);

    std::string error;
    assert(drums.importSample(0, "studio-kick.wav", impulseWave(), error));
    Json step = Json::object(); step.set("variation", 0); step.set("voice", 0); step.set("step", 0);
    step.set("velocity", 127); step.set("accent", true); assert(drums.command("step", step, error));
    Json settings = Json::object(); settings.set("length", 16); settings.set("level", 0.8);
    settings.set("swing", 0.2); settings.set("humanization", 0.0); assert(drums.command("settings", settings, error));
    assert(drums.command("start", Json::object(), error));

    std::vector<float> left(64), right(64), tapLeft(64), tapRight(64);
    float* master[] = {left.data(), right.data()}; float* tap[] = {tapLeft.data(), tapRight.data()};
    TransportBlock transport; transport.playing = true; transport.timelineFrame = 0;
    transport.framesPerBeat = 24000.0; transport.framesPerSecond = 48000.0;
    drums.render(master, 2, tap, 2, 64, transport);
    assert(left[0] > 0.7f && right[0] > 0.7f);
    assert(std::fabs(left[0] - tapLeft[0]) < 0.0001f);

    const Json state = drums.state();
    assert(state["playing"].asBool(false));
    assert(state["length"].asInt(0) == 16);
    assert(state["voices"].at(0)["loaded"].asBool(false));
    assert(state["variations"].at(0)["voices"].at(0)["velocities"].at(0).asInt(0) == 127);

    Json kit = Json::object(); kit.set("name", "Studio Kit"); assert(drums.command("kit/save", kit, error));
    Json clearSample = Json::object(); clearSample.set("voice", 0); assert(drums.command("sample/clear", clearSample, error));
    assert(!drums.state()["voices"].at(0)["loaded"].asBool(true));
    assert(drums.command("kit/load", kit, error));
    assert(drums.state()["voices"].at(0)["loaded"].asBool(false));
    Json deleteKit = kit; deleteKit.set("confirmed", true); assert(drums.command("kit/delete", deleteKit, error));

    assert(drums.command("fill", Json::object(), error));
    Json song = Json::object(); Json sections = Json::array();
    Json section = Json::object(); section.set("variation", 0); section.set("repeats", 2); sections.push(section);
    song.set("sections", sections); assert(drums.command("song/set", song, error));
    Json songMode = Json::object(); songMode.set("enabled", true); assert(drums.command("song/mode", songMode, error));
    assert(drums.state()["songMode"].asBool(false));

    assert(drums.command("stop", Json::object(), error));
    std::fill(left.begin(), left.end(), 0.0f); std::fill(right.begin(), right.end(), 0.0f);
    drums.render(master, 2, nullptr, 0, 64, transport);
    assert(std::all_of(left.begin(), left.end(), [](float value) { return value == 0.0f; }));
    fs::remove_all(root);
    std::cout << "DrumMachine tests passed\n";
    return 0;
}
