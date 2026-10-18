#include "drums/DrumMachine.h"

#include <algorithm>
#include <cassert>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <iostream>
#include <string>
#include <utility>
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
    // The live engine consumes queued changes on every audio callback, including
    // while stopped. Model those boundaries between control operations here.
    const auto consumeChanges = [&] {
        drums.render(nullptr, 0, nullptr, 0, 0, TransportBlock{});
    };
    const auto command = [&](const std::string& name, const Json& payload, std::string& message) {
        const bool ok = drums.command(name, payload, message);
        if (!ok) std::cerr << name << ": " << message << '\n';
        if (ok) consumeChanges();
        return ok;
    };
    assert(drums.importSample(0, "studio-kick.wav", impulseWave(), error));
    Json step = Json::object(); step.set("variation", 0); step.set("voice", 0); step.set("step", 0);
    step.set("velocity", 127); step.set("accent", true); assert(command("step", step, error));
    Json settings = Json::object(); settings.set("length", 16); settings.set("level", 0.8);
    settings.set("swing", 0.2); settings.set("humanization", 0.0); assert(command("settings", settings, error));
    assert(command("start", Json::object(), error));

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
    assert(state["voices"].size() >= 32);
    assert(fs::exists(root / "projects/Default/project.json"));

    Json kit = Json::object(); kit.set("name", "Studio Kit"); assert(command("kit/save", kit, error));
    Json clearSample = Json::object(); clearSample.set("voice", 0); assert(command("sample/clear", clearSample, error));
    assert(!drums.state()["voices"].at(0)["loaded"].asBool(true));
    assert(command("kit/load", kit, error));
    assert(drums.state()["voices"].at(0)["loaded"].asBool(false));
    Json deleteKit = kit; deleteKit.set("confirmed", true); assert(command("kit/delete", deleteKit, error));

    Json imported;
    std::string nestedWave = impulseWave(); nestedWave.back() = 1;
    const bool nestedImported = drums.importLibrarySample("Acoustic/Studio/snare.wav", nestedWave, imported, error);
    if (!nestedImported) std::cerr << error << '\n';
    assert(nestedImported);
    assert(!imported["duplicate"].asBool(true));
    assert(fs::exists(root / "samples/Acoustic/Studio/snare.wav"));
    assert(drums.importLibrarySample("DifferentFolder/renamed.wav", nestedWave, imported, error));
    assert(imported["duplicate"].asBool(false));
    assert(!fs::exists(root / "samples/DifferentFolder/renamed.wav"));
    assert(!drums.importLibrarySample("Acoustic/Studio/snare.wav", std::string(nestedWave).replace(45, 1, "x"), imported, error));
    assert(!drums.importLibrarySample("../escape.wav", nestedWave, imported, error));
    assert(!drums.importLibrarySample("/escape.wav", nestedWave, imported, error));
    assert(!drums.importLibrarySample("Acoustic/test.mp3", nestedWave, imported, error));
    Json load = Json::object(); load.set("voice", 4); load.set("relative", "Acoustic/Studio/snare.wav");
    assert(command("sample/load", load, error));
    assert(drums.state()["voices"].at(4)["name"].asString() == "snare");
    assert(!drums.canEditLibraryPath((root / "samples/Acoustic").string(), error));
    Json nestedKit = Json::object(); nestedKit.set("name", "Nested");
    assert(command("kit/save", nestedKit, error));
    assert(command("kit/new", Json::object(), error));
    assert(!drums.state()["voices"].at(4)["loaded"].asBool(true));
    assert(!drums.canEditLibraryPath((root / "samples/Acoustic").string(), error));
    assert(command("kit/load", nestedKit, error));
    assert(drums.state()["voices"].at(4)["loaded"].asBool(false));
    std::string preview;
    assert(drums.readLibrarySample("Acoustic/Studio/snare.wav", preview, error) && preview == nestedWave);
    assert(!drums.readLibrarySample("../project.json", preview, error));

    assert(command("fill", Json::object(), error));
    Json song = Json::object(); Json sections = Json::array();
    Json section = Json::object(); section.set("variation", 0); section.set("repeats", 2); sections.push(section);
    song.set("sections", sections); assert(command("song/set", song, error));
    Json songMode = Json::object(); songMode.set("enabled", true); assert(command("song/mode", songMode, error));
    assert(drums.state()["songMode"].asBool(false));
    const Json songState = drums.state();
    Json songFile = Json::object(); songFile.set("schemaVersion", 1); songFile.set("name", "Complete Song");
    songFile.set("level", songState["level"]); songFile.set("swing", songState["swing"]);
    songFile.set("humanization", songState["humanization"]); songFile.set("variations", songState["variations"]);
    songFile.set("fill", songState["fill"]); songFile.set("song", songState["song"]);
    Json songKit = Json::object(); songKit.set("name", songState["kitName"]); Json songSamples = Json::array();
    for (const Json& voice : songState["voices"].items()) songSamples.push(voice["sample"]);
    songKit.set("samples", std::move(songSamples)); songFile.set("kit", std::move(songKit));
    Json applySong = Json::object(); applySong.set("song", std::move(songFile));
    assert(command("song/apply", applySong, error));
    assert(drums.state()["song"].items().size() == 1);

    step.set("voice", 4); step.set("velocity", 87);
    assert(command("step", step, error));
    const Json savedPattern = drums.state();
    Json pattern = Json::object(); pattern.set("name", "Main Groove");
    assert(command("pattern/save", pattern, error));
    assert(fs::exists(root / "projects/Default/patterns/Main Groove.json"));
    assert(command("clear", Json::object(), error));
    assert(drums.state()["variations"].dump() != savedPattern["variations"].dump());
    assert(command("pattern/load", pattern, error));
    assert(drums.state()["variations"].dump() == savedPattern["variations"].dump());
    assert(drums.state()["fill"].dump() == savedPattern["fill"].dump());
    Json project = Json::object(); project.set("name", "Second Song");
    assert(command("project/new", project, error));
    assert(drums.state()["projectId"].asString() == "Second Song");
    Json openProject = Json::object(); openProject.set("id", "Default");
    assert(command("project/open", openProject, error));
    Json deleteProject = Json::object(); deleteProject.set("id", "Second Song"); deleteProject.set("confirmed", true);
    assert(command("project/delete", deleteProject, error));

    assert(command("stop", Json::object(), error));
    std::fill(left.begin(), left.end(), 0.0f); std::fill(right.begin(), right.end(), 0.0f);
    drums.render(master, 2, nullptr, 0, 64, transport);
    assert(std::all_of(left.begin(), left.end(), [](float value) { return value == 0.0f; }));

    // Deliberately omit audio callbacks to exercise queue saturation separately
    // from persistence. A rejected load must leave the editable pattern intact.
    const Json beforeFullQueue = drums.state();
    Json baseline = Json::object(); baseline.set("schemaVersion", 1);
    baseline.set("variations", beforeFullQueue["variations"]);
    baseline.set("fill", beforeFullQueue["fill"]);
    Json apply = Json::object(); apply.set("pattern", baseline);
    for (unsigned index = 0; index < 3; ++index)
        assert(drums.command("pattern/apply", apply, error));
    Json changed = baseline, variations = Json::array();
    for (Json variation : baseline["variations"].items()) {
        variation.set("length", 32); variations.push(std::move(variation));
    }
    changed.set("variations", std::move(variations));
    Json fill = baseline["fill"]; fill.set("length", 32); changed.set("fill", std::move(fill));
    apply.set("pattern", changed);
    assert(!drums.command("pattern/apply", apply, error));
    assert(error == "drum program command queue is full");
    assert(drums.state()["variations"].dump() == beforeFullQueue["variations"].dump());
    assert(drums.state()["fill"].dump() == beforeFullQueue["fill"].dump());
    consumeChanges();
    assert(command("pattern/apply", apply, error));
    assert(drums.state()["length"].asInt(0) == 32);
    fs::remove_all(root);
    std::cout << "DrumMachine tests passed\n";
    return 0;
}
