#include "midi/ControllerHardware.h"
#include "midi/Mapping.h"
#include <algorithm>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <thread>

using namespace pimfx;
namespace hw = pimfxhw;
static void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
static std::vector<uint8_t> packet(uint8_t command, uint16_t token, const std::vector<uint8_t>& payload) {
    std::vector<uint8_t> b={0xF0,0x7D,0x4D,0x46,command,uint8_t(token&127),uint8_t(token>>7)};
    b.insert(b.end(),payload.begin(),payload.end()); b.push_back(0xF7); return b;
}
struct Rig {
    ControllerHardware hardware;
    ControllerConfig config;
    std::vector<std::vector<uint8_t>> sent;
    bool changed=false;
    std::string error;
    std::string device="012345ABCDEF";
    ControllerHardware::Sender send=[this](const std::vector<uint8_t>& b) { sent.push_back(b); return true; };
    uint16_t token() const { return hw::read14(sent.back().data()+5); }
    bool command(const char* action, const Json& j=Json::object()) {
        error.clear(); return hardware.command(action,j,config,send,error);
    }
    bool receive(uint8_t cmd, const std::vector<uint8_t>& p, int t=-1) {
        return hardware.receive(packet(cmd,t<0 ? token() : t,p),config,send,changed);
    }
    void snapshot(const hw::Config& c, int revision, bool preview=false, bool badCrc=false,
                  const std::string& identity="") {
        const auto t=token(); std::vector<uint8_t> h(22);
        h[0]=hw::Version; h[1]=hw::Board; h[2]=preview;
        const auto& uid=identity.empty() ? device : identity;
        std::copy(uid.begin(),uid.end(),h.begin()+3);
        hw::write14(h.data()+15,revision); h[17]=c.ledPin; h[18]=c.ledCount; h[19]=c.ledOrder;
        for (auto& e:c.controls) if(e.kind) ++h[20]; h[21]=1;
        receive(hw::Header,h,t);
        for (int i=0;i<hw::Slots;++i) if(c.controls[i].kind) {
            std::vector<uint8_t> e(1+hw::EntryBytes); e[0]=i; hw::encode(c.controls[i],e.data()+1);
            receive(hw::Entry,e,t);
        }
        std::vector<uint8_t> crc(2); hw::write14(crc.data(),hw::checksum(c)^(badCrc ? 1 : 0));
        receive(hw::End,crc,t);
    }
    void read(const hw::Config& c=hw::Config{}, int revision=0) {
        require(command("read"),"read request failed"); snapshot(c,revision);
        require(hardware.ready(),"valid board read did not become ready");
    }
    void control(const std::string& id, ControlKind kind=ControlKind::Momentary) {
        ControllerControl c; c.id=id; c.label=id; c.kind=kind; config.controls.push_back(c);
    }
};
static hw::Control input(int pin, int cc=0, int kind=hw::Switch) {
    hw::Control c; c.kind=kind; c.pinA=pin; c.cc=cc; return c;
}
static void validation() {
    ControllerRuntime::Identity identity;
    const std::vector<uint8_t> current={0xF0,0x7D,0x4D,0x46,0x10,1,0,0,0,0,0,1,3,0xF7};
    require(ControllerRuntime::parseIdentity(current,identity) && identity.firmwareVersion=="1.0"
        && identity.hardwareSetup && identity.guidedAnalog,"renumbered firmware lost advertised capabilities");
    auto legacy=current; legacy.erase(legacy.end()-2); legacy[5]=1; legacy[6]=1;
    require(ControllerRuntime::parseIdentity(legacy,identity) && !identity.hardwareSetup && !identity.guidedAnalog,"legacy 1.1 mistaken for renumbered firmware");
    legacy[5]=2; legacy[6]=2;
    require(ControllerRuntime::parseIdentity(legacy,identity) && identity.hardwareSetup && !identity.guidedAnalog,"2.2 compatibility lost");
    legacy[6]=3;
    require(ControllerRuntime::parseIdentity(legacy,identity) && identity.hardwareSetup && identity.guidedAnalog,"2.3 compatibility lost");
    hw::Config c;
    require(hw::validate(c)==hw::Ok,"empty board must be valid");
    for(int p : {0,3,19,20,22,26,32,35,36,37,43,44,45,46,48,127}) {
        c.controls[0]=input(p);
        require(hw::validate(c)==hw::Invalid,"reserved input accepted");
    }
    c.controls[0]=input(6); c.controls[1]=input(6,1);
    require(hw::validate(c)==hw::Conflict,"shared pin accepted");
    c.controls[1]=input(7);
    require(hw::validate(c)==hw::Conflict,"shared MIDI address accepted");
    c.controls[1].channel=2;
    require(hw::validate(c)==hw::Ok,"same CC on distinct channels rejected");
    c.controls[0]=input(38,3,hw::Analog);
    require(hw::validate(c)==hw::Invalid,"non-ADC pin accepted");
    c.controls[0]=input(8,3,hw::Analog); c.controls[0].maximum=100;
    require(hw::validate(c)==hw::Invalid,"invalid analog range accepted");
    c.controls[0]=input(18,3,hw::Encoder); c.controls[0].pinB=18;
    require(hw::validate(c)==hw::Conflict,"encoder with identical pins accepted");
    c.controls[0].pinB=17; c.ledCount=8; c.ledPin=18;
    require(hw::validate(c)==hw::Conflict,"LED and encoder pin collision accepted");
    c.ledPin=48;
    require(hw::validate(c)==hw::Ok,"valid board rejected");
    uint8_t bytes[hw::ConfigBytes]; hw::encode(c,bytes);
    require(std::all_of(std::begin(bytes),std::end(bytes),[](uint8_t b){return b<128;}),"non-MIDI-safe encoding");
    require(hw::equal(c,hw::decodeConfig(bytes)),"wire roundtrip lost configuration");
    const auto crc=hw::checksum(bytes,sizeof bytes); bytes[7]^=1;
    require(crc!=hw::checksum(bytes,sizeof bytes),"checksum missed payload corruption");
}
static void learnAndPersist() {
    Rig r; r.control("switch"); r.read();
    const auto before=r.config.toJson().dump();
    require(r.command("learn",Json::object({{"controlId","switch"}})),"learn request failed");
    const auto& request=r.sent.back(); require(request[4]==hw::Learn,"not physical Learn");
    hw::Config proposed;
    const int slot=request[9]; // payload: base revision (2), slot (1), record
    proposed.controls[slot]=hw::decode(request.data()+10); proposed.controls[slot].pinA=6;
    r.snapshot(proposed,0,true);
    require(r.hardware.phase()=="review","Learn did not request confirmation");
    require(r.config.toJson().dump()==before,"discovery mutated saved host settings");
    require(!r.hardware.accepts(MidiMessage{0xB0,proposed.controls[slot].cc,127},r.config),"setup event reached performance");
    require(r.command("confirm"),"confirmation failed");
    require(r.sent.back()[4]==hw::Commit,"confirmation did not commit");
    require(r.config.toJson().dump()==before,"host settings changed before verified readback");
    r.snapshot(proposed,1);
    require(r.changed && r.hardware.phase()=="idle","verified save not committed");
    require(r.config.controls[0].hardware["pinA"].asInt()==6,"wiring not attached to logical control");
    require(r.hardware.accepts(MidiMessage{0xB0,proposed.controls[slot].cc,127},r.config),"verified controller input rejected");
    const auto saved=ControllerConfig::fromJson(Json::parse(r.config.toJson().dump()));
    require(saved.boardHardware["device"].asString()=="012345ABCDEF","profile lost board identity");
    Rig reboot; reboot.config=saved; reboot.read(proposed,1);
    require(reboot.hardware.accepts(MidiMessage{0xB0,proposed.controls[slot].cc,127},reboot.config),"restart lost wiring mapping");
    require(reboot.command("manual",Json::object({{"controlId","switch"},{"pinA",19}}))==false,"USB pin accepted by host");
    require(reboot.command("learn",Json::object({{"controlId","switch"}})),"relearn failed");
    require(reboot.command("cancel"),"cancel failed");
    require(reboot.hardware.phase()=="idle" && reboot.config.toJson().dump()==saved.toJson().dump(),"cancel altered persisted settings");

    Rig lost; lost.config=saved;
    lost.config.controls[0].hardware=Json(); lost.config.boardHardware=Json();
    lost.read(proposed,1);
    const auto unbound=lost.config.toJson().dump();
    require(lost.command("learn",Json::object({{"controlId","switch"}})),"relearn with missing wiring metadata failed");
    require(lost.sent.back()[9]==slot,"relearn allocated a new slot instead of recovering existing wiring");
    require(lost.config.toJson().dump()==unbound,"relearn mutated mapping before confirmation");
    auto relearned=proposed;
    relearned.controls[slot]=hw::decode(lost.sent.back().data()+10);
    relearned.controls[slot].pinA=6;
    lost.snapshot(relearned,1,true);
    require(lost.hardware.phase()=="review","relearn did not propose its original pin");
    require(lost.command("confirm"),"relearn confirmation failed"); lost.snapshot(relearned,2);
    require(lost.config.controls[0].hardware["slot"].asInt(-1)==slot,"relearn failed to restore wiring metadata");
}
static void guidedAnalogCalibration() {
    Rig r; r.control("pot",ControlKind::Pot); r.read();
    const auto before=r.config.toJson().dump();
    require(r.command("learn",Json::object({{"controlId","pot"}})),"guided learn did not start");
    require(r.sent.back()[4]==hw::GuidedLearn,"analog used automatic sweep instead of guided Learn");
    const int slot=r.sent.back()[9];
    auto entry=hw::decode(r.sent.back().data()+10);
    r.receive(hw::LearnProgress,{0,hw::Ok});
    require(r.hardware.state()["learnStage"].asString()=="minimum","minimum prompt missing");
    require(r.command("capture"),"minimum capture failed");
    require(r.sent.back()[4]==hw::Capture && r.sent.back()[7]==0,"minimum capture had wrong stage");
    require(!r.command("capture"),"duplicate minimum capture accepted before board acknowledgement");
    r.receive(hw::LearnProgress,{1,hw::Ok});
    require(r.hardware.state()["learnStage"].asString()=="maximum","maximum prompt missing");
    require(r.command("capture"),"maximum capture failed");
    r.receive(hw::LearnProgress,{1,hw::RangeTooSmall});
    require(r.hardware.phase()=="searching" && r.hardware.state()["learnStage"].asString()=="maximum","small range aborted instead of allowing another maximum capture");
    require(r.config.toJson().dump()==before,"calibration changed saved host config before confirmation");
    require(r.command("capture"),"maximum retry failed");
    hw::Config calibrated; entry.pinA=8; entry.minimum=100; entry.maximum=3900; calibrated.controls[slot]=entry;
    r.snapshot(calibrated,0,true);
    require(r.hardware.phase()=="review","calibration did not reach review");
    require(r.command("confirm"),"calibration confirm failed"); r.snapshot(calibrated,1);
    require(r.config.controls[0].hardware["minimum"].asInt()==100 && r.config.controls[0].hardware["maximum"].asInt()==3900,"calibration endpoints were not saved");
}
static void failuresAndRecovery() {
    Rig corrupt; require(corrupt.command("read"),"read failed"); corrupt.snapshot(hw::Config{},0,false,true);
    require(!corrupt.hardware.ready() && corrupt.hardware.phase()=="error","bad checksum accepted");
    Rig stale; require(stale.command("read"),"read failed");
    require(!stale.receive(hw::Status,{hw::Invalid},(stale.token()+1)&0x3fff),"stale token processed");
    require(stale.hardware.phase()=="reading","stale reply changed transaction");
    stale.snapshot(hw::Config{},0); require(stale.hardware.ready(),"valid reply after stale ignored failed");
    Rig duplicate; require(duplicate.command("read"),"read failed");
    hw::Config c; c.controls[0]=input(6); c.controls[1]=input(6,1);
    duplicate.snapshot(c,0);
    require(!duplicate.hardware.ready(),"conflicting board read accepted");
    Rig save; save.control("s"); save.read(); const auto before=save.config.toJson().dump();
    require(save.command("manual",Json::object({{"controlId","s"},{"pinA",6}})),"manual setup failed");
    hw::Config manual;
    for (const auto& b:save.sent) if (b[4]==hw::Set) manual.controls[b[7]]=hw::decode(b.data()+8);
    save.snapshot(manual,0,true); require(save.command("confirm"),"confirm failed");
    save.receive(hw::Status,{hw::Storage});
    require(save.config.toJson().dump()==before && !save.hardware.ready(),"storage failure accepted as saved");
    require(save.command("read"),"read recovery failed"); save.snapshot(manual,1);
    require(save.hardware.ready(),"recovery read failed");
    require(save.command("adopt"),"board adoption failed");
    require(save.config.controls.size()==2,"board adoption did not recover saved input");
    require(save.command("adopt") && save.config.controls.size()==2,"board adoption duplicated inputs");
}
static void templateRestoreDelete() {
    Rig r; r.read(); require(r.command("default"),"default template failed");
    hw::Config templ;
    for (const auto& b:r.sent) {
        if (b[4]==hw::Set) templ.controls[b[7]]=hw::decode(b.data()+8);
        if (b[4]==hw::Leds) { templ.ledPin=b[7]; templ.ledCount=b[8]; templ.ledOrder=b[9]; }
    }
    require(hw::validate(templ)==hw::Ok && templ.controls[13].pinA==21,"bad default template");
    r.snapshot(templ,0,true); require(r.command("confirm"),"default confirm failed"); r.snapshot(templ,1);
    require(r.command("adopt") && r.config.controls.size()==14,"default adoption failed");
    const auto profile=r.config;
    Rig replacement; replacement.device="FEDCBA543210"; replacement.config=profile; replacement.read();
    require(replacement.hardware.state()["active"]["controls"].size()==0,"profile silently configured replacement board");
    require(replacement.command("restore"),"saved wiring restore failed");
    replacement.snapshot(templ,0,true); require(replacement.command("confirm"),"restore confirm failed"); replacement.snapshot(templ,1);
    require(replacement.config.controls[0].hardware["device"].asString()==replacement.device,"replacement restore did not remap device identity");
    const auto target=replacement.config.controls[0].id;
    require(replacement.command("delete",Json::object({{"controlId",target}})),"delete did not stage board changes");
    auto without=templ; without.controls[0]=hw::Control{};
    replacement.snapshot(without,1,true); require(replacement.command("confirm"),"delete confirm failed"); replacement.snapshot(without,2);
    require(replacement.config.controls.size()==13,"delete did not remove logical input after board save");
    // Commercial/legacy controllers retain the original MIDI Learn path.
    ControllerRuntime runtime; ControllerConfig generic; ControllerControl g; g.id="generic";
    generic.controls.push_back(g); runtime.setConfig(generic); runtime.beginLearn(g.id);
    const auto learned=runtime.handleMessage(MidiMessage{0xB2,50,127});
    require(learned.size()==1 && learned[0].action=="learned" && runtime.config().controls[0].midiChannel==3,"legacy MIDI Learn regressed");
}
static void immediatePresetGestures() {
    ControllerRuntime runtime;
    ControllerConfig config;
    ControllerControl control;
    control.id="fast-preset"; control.channel=27; control.midiChannel=1;
    control.binding.action="selectPreset"; control.binding.doubleAction="reloadPreset";
    control.binding.doubleTapMilliseconds=80;
    config.controls.push_back(control);
    runtime.setConfig(config);
    require(runtime.virtualPress(control.id,true,true).empty(),"preset must wait for release to preserve hold");
    auto actions=runtime.virtualPress(control.id,false,true);
    require(actions.size()==1 && actions[0].action=="selectPreset","compatible first release did not fire immediately");
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    require(runtime.pollHolds().empty(),"eager tap fired twice when double window expired");

    runtime.virtualPress(control.id,true,true);
    require(runtime.virtualPress(control.id,false,true).size()==1,"first tap lost");
    // Eligibility can change when the first selection loads a remembered snapshot.
    actions=runtime.virtualPress(control.id,true,false);
    require(actions.size()==1 && actions[0].action=="reloadPreset" && actions[0].fromDouble,"fast pair lost double recognition");
    require(runtime.virtualPress(control.id,false,false).empty(),"double release fired an extra tap");

    runtime.setConfig(config);
    runtime.virtualPress(control.id,true,false);
    require(runtime.virtualPress(control.id,false,false).empty(),"snapshot/draft policy did not retain delayed tap");
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    actions=runtime.pollHolds();
    require(actions.size()==1 && actions[0].action=="selectPreset","delayed tap disappeared");

    config.controls[0].binding.doubleAction="bankUp"; runtime.setConfig(config);
    runtime.virtualPress(control.id,true,true);
    require(runtime.virtualPress(control.id,false,true).empty(),"incompatible double action fired first tap early");
    actions=runtime.virtualPress(control.id,true,true);
    require(actions.size()==1 && actions[0].action=="bankUp","bank double action changed");
    runtime.virtualPress(control.id,false,true);

    config.controls[0].binding.doubleAction="reloadPreset";
    config.controls[0].binding.holdAction="tuner";
    config.controls[0].binding.holdMilliseconds=250; runtime.setConfig(config);
    runtime.virtualPress(control.id,true,true);
    std::this_thread::sleep_for(std::chrono::milliseconds(275));
    actions=runtime.pollHolds();
    require(actions.size()==1 && actions[0].action=="tuner" && actions[0].fromHold,"hold action lost");
    require(runtime.virtualPress(control.id,false,true).empty(),"hold release selected a preset");

    runtime.setConfig(config);
    require(runtime.handleMessage(MidiMessage{0xB0,27,127},{control.id}).empty(),"physical press selected before release");
    actions=runtime.handleMessage(MidiMessage{0xB0,27,0},{control.id});
    require(actions.size()==1 && actions[0].action=="selectPreset","physical MIDI release did not use fast policy");
    actions=runtime.handleMessage(MidiMessage{0xB0,27,127},{control.id});
    require(actions.size()==1 && actions[0].action=="reloadPreset","physical double tap lost reload");
    runtime.handleMessage(MidiMessage{0xB0,27,0},{control.id});
    require(runtime.pollHolds().empty(),"physical double generated another action");
}

int main() {
    try {
        validation(); learnAndPersist(); guidedAnalogCalibration(); failuresAndRecovery(); templateRestoreDelete(); immediatePresetGestures();
        std::cout << "Controller hardware protocol tests passed\n"; return 0;
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
