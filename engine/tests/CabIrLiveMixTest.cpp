#include "host/Lv2Host.h"

#include <array>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <thread>

using namespace pimfx;
namespace {
constexpr unsigned rate = 48000, frames = 64;
constexpr const char* uri = "http://two-play.com/plugins/toob-cab-ir";
constexpr std::array<const char*, 3> files{{
    "http://two-play.com/plugins/toob-cab-ir#impulseFile",
    "http://two-play.com/plugins/toob-cab-ir#impulseFile2",
    "http://two-play.com/plugins/toob-cab-ir#impulseFile3"}};
constexpr std::array<const char*, 3> levels{{"reverb_mix", "reverb_mix2", "reverb_mix3"}};

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

struct TemporaryFiles {
    std::filesystem::path directory;
    TemporaryFiles() {
        directory = std::filesystem::temp_directory_path() / ("pimfx-cab-mix-" +
            std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
        require(std::filesystem::create_directory(directory), "cannot create temporary IR directory");
    }
    ~TemporaryFiles() {
        std::error_code ignored;
        std::filesystem::remove_all(directory, ignored);
    }
};

void writeImpulse(const std::filesystem::path& path, unsigned tap, int amplitude) {
    std::ofstream stream(path, std::ios::binary);
    auto littleEndian = [&](uint32_t value, unsigned bytes) {
        for (unsigned i = 0; i < bytes; ++i) stream.put(static_cast<char>((value >> (8 * i)) & 255));
    };
    constexpr unsigned samples = 256, dataBytes = samples * 2;
    stream.write("RIFF", 4); littleEndian(36 + dataBytes, 4); stream.write("WAVEfmt ", 8);
    littleEndian(16, 4); littleEndian(1, 2); littleEndian(1, 2);
    littleEndian(rate, 4); littleEndian(rate * 2, 4); littleEndian(2, 2); littleEndian(16, 2);
    stream.write("data", 4); littleEndian(dataBytes, 4);
    for (unsigned i = 0; i < samples; ++i) littleEndian(static_cast<uint16_t>(i == tap ? amplitude : 0), 2);
    require(stream.good(), "cannot write test IR");
}

uint32_t port(const PluginInstance& plugin, const char* symbol) {
    for (const auto& p : plugin.info().ports) if (p.symbol == symbol) return p.index;
    throw std::runtime_error(std::string("missing Cab IR port: ") + symbol);
}

struct Audio {
    std::array<float, frames> input{}, output{};
    void run(PluginInstance& plugin) {
        const float* inputs[]{input.data()};
        float* outputs[]{output.data()};
        plugin.process(inputs, 1, outputs, 1, frames);
        for (float value : output) require(std::isfinite(value), "non-finite Cab IR output");
    }
};

void settle(PluginInstance& plugin) {
    Audio audio;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(15);
    unsigned quietBlocks = 0;
    while (quietBlocks < 160) {
        audio.run(plugin);
        // TooB's loader state 1 is Idle (0 means NotLoaded, 2 means Error).
        if (plugin.propertyTransitionPending() || plugin.readOutput(port(plugin, "loading_state")) != 1.0f) quietBlocks = 0;
        else ++quietBlocks;
        require(std::chrono::steady_clock::now() < deadline, "Cab IR worker did not settle");
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
}

void compareSteady(PluginInstance& split, PluginInstance& native) {
    Audio a, b;
    // Flush history and allow gain smoothing to settle before comparing.
    for (unsigned block = 0; block < 256; ++block) {
        for (unsigned i = 0; i < frames; ++i) {
            a.input[i] = b.input[i] = .02f * std::sin((block * frames + i) * .057595865f);
        }
        a.run(split); b.run(native);
        if (block < 160) continue;
        for (unsigned i = 0; i < frames; ++i) {
            require(std::abs(a.output[i] - b.output[i]) < .0001f,
                    "split cabinet mix differs from native steady output");
        }
    }
}
} // namespace

int main() {
    try {
        Lv2Catalog catalog;
        std::string error;
        if (!catalog.rescan(error) || !catalog.find(uri)) {
            std::cout << "SKIP: TooB Cab IR is not installed\n";
            return 77;
        }
        TemporaryFiles temporary;
        auto split = PluginInstance::create(catalog, uri, rate, frames, error, true);
        auto native = PluginInstance::create(catalog, uri, rate, frames, error, false);
        require(split && native, error.c_str());
        Json controls = Json::object(), properties = Json::object();
        for (unsigned i = 0; i < files.size(); ++i) {
            const auto path = temporary.directory / ("cab" + std::to_string(i) + ".wav");
            writeImpulse(path, i * 17, i == 2 ? -8192 : 16384);
            properties.set(files[i], path.string());
            controls.set(levels[i], -12.0 + 3 * i);
        }
        controls.set("direct_mix", -40.0);
        Json state = Json::object({{"controls", controls}, {"properties", properties}});
        split->loadState(state); native->loadState(state);
        settle(*split); settle(*native);
        compareSteady(*split, *native);
        const Json saved = split->saveState();
        for (unsigned i = 0; i < files.size(); ++i) {
            require(saved["properties"][files[i]].asString() == properties[files[i]].asString(), "logical IR slot was not preserved");
            require(saved["controls"][levels[i]].asFloat() == controls[levels[i]].asFloat(), "logical IR level was not preserved");
        }

        // Rapid gain updates must never cause the native loader to rebuild.
        Audio audio;
        audio.input.fill(.02f);
        const auto loading = port(*split, "loading_state");
        for (unsigned block = 0; block < 400; ++block) {
            const float position = static_cast<float>(block % 100) / 99;
            split->setControls({{port(*split, levels[0]), -30 + 24 * position},
                                {port(*split, levels[1]), -6 - 24 * position},
                                {port(*split, levels[2]), -18}});
            audio.run(*split);
            require(!split->propertyTransitionPending(), "volume update queued a file transition");
            require(split->readOutput(loading) == 1.0f, "volume update restarted the IR loader");
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        // Dry audio must be added exactly once, not once per cabinet.
        controls.set("direct_mix", -12.0);
        state.set("controls", controls);
        split->beginDeferredStateChanges();
        split->loadState(state, true);
        require(split->control(port(*split, "direct_mix")) == -40.0f, "snapshot controls applied before release");
        require(split->applyDeferredStateChanges(), "snapshot changes were not released");
        native->loadState(state);
        settle(*split); settle(*native);
        compareSteady(*split, *native);

        // Clearing slots and restoring them exercises one/two/three cabinet state.
        for (unsigned active = 1; active <= 3; ++active) {
            Json subset = properties;
            for (unsigned i = active; i < files.size(); ++i) subset.set(files[i], "");
            state.set("properties", subset);
            split->loadState(state); native->loadState(state);
            settle(*split); settle(*native);
            compareSteady(*split, *native);
        }
        // Graph removal may retire a processor during a file transaction or
        // after its buffers have been rebound, including an inactive branch.
        for (unsigned cycle = 0; cycle < 4; ++cycle) {
            auto retiring = PluginInstance::create(catalog, uri, rate, frames, error, true);
            require(retiring != nullptr, error.c_str());
            retiring->loadState(state);
            Audio first;
            first.run(*retiring);
            if (cycle % 2) settle(*retiring);
            Audio replacement;
            const float* inputs[]{replacement.input.data()};
            float* outputs[]{replacement.output.data()};
            retiring->connectAudioBuffers(inputs, 1, outputs, 1);
            retiring.reset();
        }
        std::cout << "Cab IR live mix: steady output, dry signal, slots, state, no-reload and retirement checks passed\n";
        return 0;
    } catch (const std::exception& failure) {
        std::cerr << failure.what() << '\n';
        return 1;
    }
}
