#include "core/BankPreloadTargets.h"
#include <cassert>
#include <iostream>

using namespace pimfx;

int main() {
    Bank bank; bank.id = "bank";
    for (int i = 0; i < 20; ++i) { Preset p; p.id = "p" + std::to_string(i); bank.presets.push_back(p); }
    ControllerConfig config; config.controls.clear(); config.presetAssignments = Json::object();
    Json mapping = Json::object();
    for (int i = 0; i < 15; ++i) {
        ControllerControl control; control.id = "sw" + std::to_string(i);
        control.binding.action = "selectPreset"; config.controls.push_back(control);
        mapping.set(control.id, bank.presets[i].id);
    }
    config.presetAssignments.set(bank.id, mapping);
    assert(bankPreloadTargets(bank, config, Json(), 8).size() == 15);
    config.controls.resize(8);
    auto targets = bankPreloadTargets(bank, config, Json(), 15);
    assert(targets.size() == 8 && targets.back() == "p7");
    // Mapping entries for removed switches must not keep unused presets loaded.
    mapping.set("sw7", "p18"); config.presetAssignments.set(bank.id, mapping);
    targets = bankPreloadTargets(bank, config, Json(), 8);
    assert(targets.size() == 8 && targets.back() == "p18");
    mapping.set("sw7", "p0"); config.presetAssignments.set(bank.id, mapping);
    assert(bankPreloadTargets(bank, config, Json(), 8).size() == 7);
    Json session = Json::object();
    session.set("sw0", Json::object({{"bankId", "other"}, {"presetId", "p19"}}));
    session.set("sw7", Json::object({{"bankId", bank.id}, {"presetId", "p19"}}));
    targets = bankPreloadTargets(bank, config, session, 8);
    assert(targets.size() == 7 && targets.back() == "p19");
    config.presetAssignments = Json::object();
    assert(bankPreloadTargets(bank, config, Json(), 8).empty());
    config.controls.clear();
    assert(bankPreloadTargets(bank, config, Json(), 8).size() == 8);
    assert(bankPreloadTargets(bank, config, Json(), 15).size() == 15);
    assert(bankPreloadTargets(bank, config, Json(), 100).size() == 20);
    std::cout << "Dynamic bank preload target tests passed\n";
}
