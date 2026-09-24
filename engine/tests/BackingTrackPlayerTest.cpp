#include "backing/BackingTrackPlayer.h"

#include <sndfile.h>

#include <cassert>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <thread>
#include <vector>

using pimfx::BackingTrackPlayer;
using pimfx::Json;

int main() {
    const auto root = std::filesystem::temp_directory_path()
        / ("pimfx-backing-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    std::filesystem::create_directories(root);
    const auto track = root / "mono-44100.wav";
    const auto stereoTrack = root / "stereo-48000.wav";

    SF_INFO info{};
    info.samplerate = 44100;
    info.channels = 1;
    info.format = SF_FORMAT_WAV | SF_FORMAT_PCM_16;
    SNDFILE* output = sf_open(track.string().c_str(), SFM_WRITE, &info);
    assert(output);
    std::vector<float> source(44100 * 8);
    for (size_t i = 0; i < source.size(); ++i) source[i] = 0.25f * std::sin(2.0 * 3.141592653589793 * 440.0 * i / 44100.0);
    assert(sf_writef_float(output, source.data(), static_cast<sf_count_t>(source.size())) == static_cast<sf_count_t>(source.size()));
    sf_close(output);

    SF_INFO stereoInfo{};
    stereoInfo.samplerate = 48000;
    stereoInfo.channels = 2;
    stereoInfo.format = SF_FORMAT_WAV | SF_FORMAT_PCM_16;
    output = sf_open(stereoTrack.string().c_str(), SFM_WRITE, &stereoInfo);
    assert(output);
    std::vector<float> stereoSource(4800 * 2);
    for (size_t frame = 0; frame < stereoSource.size() / 2; ++frame) {
        stereoSource[frame * 2] = 0.25f * std::sin(2.0 * 3.141592653589793 * 440.0 * frame / 48000.0);
        stereoSource[frame * 2 + 1] = 0.1f * std::sin(2.0 * 3.141592653589793 * 220.0 * frame / 48000.0);
    }
    assert(sf_writef_float(output, stereoSource.data(), 4800) == 4800);
    sf_close(output);

    BackingTrackPlayer player(root.string());
    assert(player.available());
    player.prepare(48000);
    player.start();
    std::string error;
    assert(player.load(track.string(), error));
    for (int attempt = 0; attempt < 100 && !player.state()["loaded"].asBool(); ++attempt) {
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    assert(player.state()["loaded"].asBool());

    Json create = Json::object(); create.set("name", "Show");
    assert(player.setListCommand("create", create, error));
    Json add = Json::object(); add.set("path", track.string());
    assert(player.setListCommand("add", add, error));
    add.set("path", stereoTrack.string());
    assert(player.setListCommand("add", add, error));
    assert(player.loadSetListEntry(0, error));
    player.next();
    assert(player.state()["path"].asString() == std::filesystem::weakly_canonical(stereoTrack).string());
    assert(player.loadSetListEntry(0, error));

    player.play();
    std::vector<float> left(480), right(480);
    float* channels[] = {left.data(), right.data()};
    double energy = 0.0;
    for (int block = 0; block < 80; ++block) {
        std::fill(left.begin(), left.end(), 0.0f);
        std::fill(right.begin(), right.end(), 0.0f);
        player.render(channels, 2, 480);
        for (size_t i = 0; i < left.size(); ++i) {
            energy += std::abs(left[i]);
            assert(std::abs(left[i] - right[i]) < 0.0001f);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    assert(energy > 1.0);
    assert(player.state()["position"].asDouble() > 0.5);

    // Consume more than the ring's capacity so both producer and consumer
    // indexes cross the wrap boundary while decoding continues.
    for (int block = 0; block < 1500 && player.state()["position"].asDouble() < 6.0; ++block) {
        player.render(channels, 2, 480);
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    assert(player.state()["position"].asDouble() >= 6.0);

    player.pause();
    assert(player.state()["status"].asString() == "paused");
    player.play();

    player.seek(0.25);
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
    player.setLoop(true, 0.25, 0.35);
    for (int block = 0; block < 60; ++block) {
        player.render(channels, 2, 480);
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    assert(player.state()["position"].asDouble() >= 0.25);
    assert(player.state()["position"].asDouble() < 0.36);

    player.setLoop(false, 0.0, 8.0);
    player.seek(7.98);
    player.play();
    for (int block = 0; block < 200 && player.state()["playing"].asBool(); ++block) {
        player.render(channels, 2, 480);
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    assert(!player.state()["playing"].asBool());
    assert(player.state()["status"].asString() == "ended");

    assert(player.load(stereoTrack.string(), error));
    player.play();
    double channelDifference = 0.0;
    for (int block = 0; block < 100 && channelDifference < 1.0; ++block) {
        std::fill(left.begin(), left.end(), 0.0f);
        std::fill(right.begin(), right.end(), 0.0f);
        player.render(channels, 2, 480);
        for (size_t frame = 0; frame < left.size(); ++frame) channelDifference += std::abs(left[frame] - right[frame]);
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    assert(channelDifference > 1.0);
    player.stop();

    {
        BackingTrackPlayer restored(root.string());
        assert(restored.state()["setLists"].items().size() == 1);
        restored.start();
        assert(restored.load(track.string(), error));
        restored.fileDeleted(track.string());
        assert(!restored.state()["loaded"].asBool());
        assert(restored.state()["setLists"].items().front()["entries"].items().size() == 1);
        restored.stop();
    }
    std::filesystem::remove_all(root);
    return 0;
}
