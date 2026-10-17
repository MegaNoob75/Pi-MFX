#include "model/Storage.h"

#include <chrono>
#include <filesystem>
#include <iostream>
#include <stdexcept>

using namespace pimfx;

static void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

int main() {
    const auto root = std::filesystem::temp_directory_path() / ("pimfx-bank-storage-"
        + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    try {
        Paths paths;
        paths.dataRoot = root.string();
        require(makeDirectories(paths.banksDir()), "cannot create bank directory");
        Storage storage(paths);

        const auto starter = storage.loadBanks();
        require(starter.size() == 1 && !starter.front().presets.empty(),
            "fresh installation must retain its starter bank");
        require(storage.saveSettings(Settings{}), "cannot save settings");
        require(storage.deleteBank(starter.front().id), "cannot delete final bank");
        require(Storage(paths).loadBanks().empty(), "restart recreated a deleted bank");

        Bank source;
        source.id = "bank-source";
        source.name = "Empty bank";
        require(storage.saveBank(source), "cannot save empty bank");
        auto banks = Storage(paths).loadBanks();
        require(banks.size() == 1 && banks.front().presets.empty(),
            "empty bank did not survive restart");

        Preset preset;
        preset.id = "preset-first";
        preset.name = "First preset";
        source.presets.push_back(preset);
        require(storage.saveBank(source), "cannot add a preset to an empty bank");
        banks = Storage(paths).loadBanks();
        require(banks.size() == 1 && banks.front().presets.size() == 1
            && banks.front().presets.front().id == preset.id,
            "first preset did not survive restart");

        Bank target;
        target.id = "bank-target";
        target.name = "Move target";
        target.presets = source.presets;
        source.presets.clear();
        require(storage.saveBanks({source, target}), "cannot move the final preset");
        banks = Storage(paths).loadBanks();
        require(banks.size() == 2, "move lost a bank");
        for (const auto& bank : banks) {
            require(bank.id == source.id ? bank.presets.empty()
                : bank.presets.size() == 1 && bank.presets.front().id == preset.id,
                "final preset move did not survive restart");
            require(storage.deleteBank(bank.id), "cannot remove remaining bank");
        }
        require(Storage(paths).loadBanks().empty(), "empty library did not survive restart");

        std::filesystem::remove_all(root);
        std::cout << "Bank storage: first run, empty banks, final preset move and empty restart passed\n";
        return 0;
    } catch (const std::exception& failure) {
        std::cerr << failure.what() << '\n';
        std::error_code ignored;
        std::filesystem::remove_all(root, ignored);
        return 1;
    }
}
