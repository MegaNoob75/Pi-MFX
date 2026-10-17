#include "midi/ControllerHardware.h"
#include <algorithm>
#include <cmath>
#include <iterator>

namespace pimfx {
namespace {
using namespace pimfxhw;
uint8_t wireKind(ControlKind k) {
    if (k == ControlKind::Encoder) return Encoder;
    if (k == ControlKind::Pot || k == ControlKind::Slider || k == ControlKind::Expression) return Analog;
    return Switch;
}
Json entryJson(const Control& e, int slot) {
    return Json::object({{"slot",slot},{"kind",int(e.kind)},{"pinA",int(e.pinA)},
        {"pinB",int(e.pinB)},{"cc",int(e.cc)},{"channel",int(e.channel)},
        {"steps",int(e.steps)},{"debounce",int(e.debounce)},
        {"minimum",int(e.minimum)},{"maximum",int(e.maximum)}});
}
bool number(const Json& j, const char* name, int low, int high, int fallback, int& result) {
    if (!j.has(name)) { result = fallback; return true; }
    const double d = j[name].asDouble(-1);
    if (!j[name].isNumber() || !std::isfinite(d) || std::floor(d) != d || d < low || d > high) return false;
    result = int(d); return true;
}
bool entryFromJson(const Json& j, Control& e) {
    int kind, a, b, cc, channel, steps, debounce, minimum, maximum;
    if (!number(j,"kind",1,3,0,kind) || !kind || !number(j,"pinA",0,127,127,a)
        || !number(j,"pinB",0,127,127,b) || !number(j,"cc",0,127,0,cc)
        || !number(j,"channel",1,16,1,channel) || !number(j,"steps",1,8,4,steps)
        || !number(j,"debounce",5,80,20,debounce) || !number(j,"minimum",0,4095,0,minimum)
        || !number(j,"maximum",0,4095,4095,maximum)) return false;
    e.kind=kind; e.pinA=a; e.pinB=b; e.cc=cc; e.channel=channel;
    e.steps=steps; e.debounce=debounce; e.minimum=minimum; e.maximum=maximum; return true;
}
bool fromSnapshot(const Json& j, Config& c) {
    int pin, count, order;
    if (j["version"].asInt() != Version || j["board"].asInt() != Board
        || !j["controls"].isArray() || j["controls"].size() > Slots
        || !number(j,"ledPin",0,127,127,pin) || !number(j,"ledCount",0,127,0,count)
        || !number(j,"ledOrder",0,1,0,order)) return false;
    c = Config{}; c.ledPin=pin; c.ledCount=count; c.ledOrder=order;
    bool used[Slots] = {};
    for (const auto& item : j["controls"].items()) {
        int slot;
        if (!number(item,"slot",0,Slots-1,-1,slot) || slot < 0 || used[slot]
            || !entryFromJson(item,c.controls[slot])) return false;
        used[slot] = true;
    }
    return validate(c) == Ok;
}
const char* errorText(int code) {
    switch (code) {
    case Conflict: return "Pins or MIDI addresses are already in use. Remove the old wiring assignment first.";
    case Storage: return "The ESP32 could not verify its saved configuration. Power-cycle the board and read it again before retrying.";
    case TimedOut: return "Learn timed out. Keep controls still for one second, then operate only the selected control.";
    case Ambiguous: return "More than one input moved. Keep other controls still and retry, or choose pins in Advanced wiring.";
    case Stale: return "The board configuration changed. Read the board again before applying changes.";
    case Busy: return "The board has another setup operation in progress. Cancel it or wait 90 seconds, then read the board.";
    default: return "The board rejected this wiring configuration.";
    }
}
}

ControllerHardware::ControllerHardware() {
    token_=static_cast<uint16_t>(std::chrono::steady_clock::now().time_since_epoch().count())&0x3fff;
}
void ControllerHardware::reset() {
    // Keep tokens advancing across reconnects so delayed replies cannot match.
    ready_=storageReady_=assembling_=false; device_.clear(); target_.clear(); operation_.clear();
    phase_="idle"; message_.clear(); slot_=-1; active_=pimfxhw::Config{};
}
bool ControllerHardware::sendPacket(uint8_t command, const std::vector<uint8_t>& payload, const Sender& send) {
    std::vector<uint8_t> b = {0xF0,0x7D,0x4D,0x46,command,uint8_t(token_&127),uint8_t(token_>>7)};
    b.insert(b.end(),payload.begin(),payload.end()); b.push_back(0xF7); return send(b);
}
void ControllerHardware::fail(const std::string& message, const Sender& send) {
    sendPacket(pimfxhw::Cancel,{},send);
    message_=message; phase_="error"; assembling_=false; target_.clear();
    // A lost reply may follow a successful board save. Force readback next.
    ready_=false;
}
bool ControllerHardware::start(const std::string& phase, const Sender&) {
    token_ = (token_+1)&0x3fff; if (!token_) ++token_;
    phase_=phase; message_.clear(); assembling_=false;
    deadline_=std::chrono::steady_clock::now()+std::chrono::seconds(phase == "searching" ? 75 : 8);
    return true;
}
Json ControllerHardware::describe(const pimfxhw::Config& c) const {
    Json entries=Json::array();
    for (unsigned i=0; i<pimfxhw::Slots; ++i) if (c.controls[i].kind) entries.push(entryJson(c.controls[i],i));
    return Json::object({{"version",int(pimfxhw::Version)},{"board",int(pimfxhw::Board)},
        {"device",device_},{"revision",int(revision_)},{"ledPin",int(c.ledPin)},
        {"ledCount",int(c.ledCount)},{"ledOrder",int(c.ledOrder)},
        {"controls",entries},{"checksum",int(pimfxhw::checksum(c))}});
}
Json ControllerHardware::state() const {
    Json pins=Json::array(), analog=Json::array(), outputs=Json::array();
    for (int p=0;p<49;++p) {
        if (pimfxhw::inputPin(p)) pins.push(p);
        if (pimfxhw::analogPin(p)) analog.push(p);
        if (pimfxhw::outputPin(p)) outputs.push(p);
    }
    Json j=Json::object({{"ready",ready_},{"storageReady",storageReady_},{"phase",phase_},
        {"message",message_},{"target",target_},{"operation",operation_},{"slot",slot_},
        {"boardName","ESP32-S3 DevKitC-1 (direct wiring)"},{"inputPins",pins},
        {"analogPins",analog},{"outputPins",outputs},{"maxControls",int(pimfxhw::Slots)},
        {"active",describe(active_)}});
    if (phase_=="review" || phase_=="saving") j.set("candidate",describe(proposed_));
    return j;
}

bool ControllerHardware::command(const std::string& action, const Json& payload,
    ControllerConfig& config, const Sender& send, std::string& error) {
    using namespace pimfxhw;
    if (action=="cancel") {
        if (phase_=="saving") { error="Wait for the controller save to finish before cancelling."; return false; }
        sendPacket(Cancel,{},send); phase_="idle"; target_.clear(); assembling_=false;
        message_="Setup cancelled. Saved wiring was not changed."; return true;
    }
    if (action=="confirm") {
        if (phase_!="review") { error="There is no detected wiring to confirm."; return false; }
        phase_="saving"; deadline_=std::chrono::steady_clock::now()+std::chrono::seconds(10);
        std::vector<uint8_t> crc(2); write14(crc.data(),checksum(proposed_));
        if (!sendPacket(Commit,crc,send)) { fail("Could not send configuration to the board.",send); error=message_; return false; }
        return true;
    }
    if (busy()) { error="Finish or cancel the current hardware setup operation first."; return false; }
    if (action=="read") {
        start("reading",send); target_.clear(); operation_="read";
        if (!sendPacket(Read,{},send)) { fail("The selected MIDI port cannot send configuration to the board.",send); error=message_; return false; }
        return true;
    }
    if (!ready_ || !storageReady_) { error="Read a supported ESP32-S3 board with working configuration storage first."; return false; }
    if (action=="test-led") {
        int index;
        if (!number(payload,"index",0,126,0,index) || index>=active_.ledCount) {
            error="Choose an existing pixel on the configured strip."; return false;
        }
        if (!sendPacket(TestLed,{uint8_t(index)},send)) { error="Could not send LED test."; return false; }
        return true;
    }
    if (action=="adopt") {
        // Recover logical controls from a board on a replacement Pi. Never drive
        // output pins or change board wiring during adoption.
        for (unsigned i=0;i<Slots;++i) if (active_.controls[i].kind) {
            auto existing=std::find_if(config.controls.begin(),config.controls.end(),[&](const ControllerControl& c) {
                return c.hardware["device"].asString()==device_ && c.hardware["slot"].asInt(-1)==int(i);
            });
            if (existing==config.controls.end()) {
                // Reuse stock/legacy logical controls with matching addresses.
                existing=std::find_if(config.controls.begin(),config.controls.end(),[&](const ControllerControl& c) {
                    return c.hardware.isNull() && !c.useNoteMessages && wireKind(c.kind)==active_.controls[i].kind
                        && c.channel==active_.controls[i].cc
                        && (c.midiChannel==0 || c.midiChannel==active_.controls[i].channel);
                });
            }
            if (existing==config.controls.end()) {
                ControllerControl c; c.id=newId("ctl"); c.label="Control "+std::to_string(i+1);
                c.kind=active_.controls[i].kind==Encoder ? ControlKind::Encoder
                    : active_.controls[i].kind==Analog ? ControlKind::Pot : ControlKind::Momentary;
                c.binding.action="none"; c.hardware=entryJson(active_.controls[i],i); c.hardware.set("device",device_);
                c.channel=active_.controls[i].cc; c.midiChannel=active_.controls[i].channel;
                config.controls.push_back(std::move(c));
            } else {
                if (wireKind(existing->kind)!=active_.controls[i].kind) {
                    existing->kind=active_.controls[i].kind==Encoder ? ControlKind::Encoder
                        : active_.controls[i].kind==Analog ? ControlKind::Pot : ControlKind::Momentary;
                    existing->binding=ControlBinding{};
                }
                existing->hardware=entryJson(active_.controls[i],i); existing->hardware.set("device",device_);
                existing->channel=active_.controls[i].cc; existing->midiChannel=active_.controls[i].channel;
                existing->useNoteMessages=false;
            }
        }
        // Give each adopted input one logical owner, just like MIDI Learn.
        for (const auto& e:active_.controls) if (e.kind) {
            auto owner=std::find_if(config.controls.begin(),config.controls.end(),[&](const ControllerControl& c) {
                return c.hardware["device"].asString()==device_ && c.hardware["cc"].asInt(-1)==e.cc
                    && c.hardware["channel"].asInt(-1)==e.channel;
            });
            if (owner!=config.controls.end()) for (auto& other:config.controls)
                if (other.id!=owner->id && !other.useNoteMessages && other.channel==e.cc
                    && (other.midiChannel==0 || other.midiChannel==e.channel)) other.channel=-1;
        }
        for (auto& c:config.controls) if (c.hardware["device"].asString()==device_) {
            const int slot=c.hardware["slot"].asInt(-1);
            if (slot<0 || slot>=Slots || !active_.controls[slot].kind) { c.hardware=Json(); c.channel=-1; }
        }
        config.boardHardware=describe(active_); message_="Controller wiring read into Pi-MFX. Assign actions and place controls in Layout.";
        return true;
    }
    if (action!="learn" && action!="manual" && action!="remove" && action!="delete" && action!="leds"
        && action!="restore" && action!="default" && action!="clear") { error="Unknown hardware setup action."; return false; }
    expected_=active_; slot_=-1; target_=payload["controlId"].asString(); operation_=action;
    if (action=="learn" || action=="manual" || action=="remove" || action=="delete") {
        auto it=std::find_if(config.controls.begin(),config.controls.end(),[&](const ControllerControl& c){return c.id==target_;});
        if (it==config.controls.end()) { error="Select an existing control first."; return false; }
        if (!it->module.empty()) { error="Expansion modules require a supported firmware driver; direct GPIO Learn cannot scan them."; return false; }
        if (it->hardware["device"].asString()==device_) slot_=it->hardware["slot"].asInt(-1);
        if (slot_<0 || slot_>=Slots) slot_=-1;
        if (action=="remove" || action=="delete") {
            if (slot_<0 && action=="remove") { error="This control has no wiring assignment on this board."; return false; }
            if (slot_>=0) expected_.controls[slot_]=Control{};
            if (action=="delete" && it->kind==ControlKind::Encoder) {
                const auto pair=std::find_if(config.controls.begin(),config.controls.end(),[&](const ControllerControl& c){return c.id==it->pairId;});
                if (pair!=config.controls.end() && pair->hardware["device"].asString()==device_) {
                    const int pairedSlot=pair->hardware["slot"].asInt(-1);
                    if (pairedSlot>=0 && pairedSlot<Slots) expected_.controls[pairedSlot]=Control{};
                }
            }
        } else {
            if (slot_<0) for (int i=0;i<Slots;++i) if (!active_.controls[i].kind) { slot_=i; break; }
            if (slot_<0) { error="The board has no free control slots."; return false; }
            Control e=active_.controls[slot_]; e.kind=wireKind(it->kind);
            // Allocate a CC without colliding with any board or Pi mapping.
            bool allocated=false;
            for (int ch=1;ch<=16 && !allocated;++ch) for (int cc=0;cc<120;++cc) {
                bool used=false;
                for (int i=0;i<Slots;++i) if (i!=slot_ && active_.controls[i].kind
                    && active_.controls[i].channel==ch && active_.controls[i].cc==cc) used=true;
                for (const auto& c:config.controls) if (c.id!=target_ && !c.useNoteMessages
                    && c.channel==cc && (c.midiChannel==0 || c.midiChannel==ch)) used=true;
                if (!used) { e.cc=cc; e.channel=ch; allocated=true; break; }
            }
            if (!allocated) { error="No free MIDI control address."; return false; }
            int steps,debounce,a,b,min,max;
            if (!number(payload,"steps",1,8,e.steps,steps) || !number(payload,"debounce",5,80,e.debounce,debounce)
                || !number(payload,"pinA",0,127,e.pinA,a) || !number(payload,"pinB",0,127,e.pinB,b)
                || !number(payload,"minimum",0,4095,0,min) || !number(payload,"maximum",0,4095,4095,max)) {
                error="Invalid wiring values."; return false;
            }
            e.steps=steps; e.debounce=debounce; e.pinA=a; e.pinB=e.kind==Encoder ? b : None;
            e.minimum=min; e.maximum=max; expected_.controls[slot_]=e;
            if (action=="learn") {
                unsigned available=0;
                for (int p=0;p<49;++p) if (inputPin(p) && (e.kind!=Analog || analogPin(p))) {
                    bool used=active_.ledCount && active_.ledPin==p;
                    for (int i=0;i<Slots;++i) if (i!=slot_ && active_.controls[i].kind
                        && (active_.controls[i].pinA==p || active_.controls[i].pinB==p)) used=true;
                    if (!used) ++available;
                }
                if (available < (e.kind==Encoder ? 2u : 1u)) {
                    error="No unused eligible input pins remain. Remove another wiring assignment first."; return false;
                }
            }
        }
    } else if (action=="leds") {
        int pin,count,order;
        if (!number(payload,"pin",0,127,127,pin) || !number(payload,"count",0,127,0,count)
            || !number(payload,"order",0,1,0,order)) { error="Invalid LED settings."; return false; }
        expected_.ledPin=count ? pin : None; expected_.ledCount=count; expected_.ledOrder=order;
    } else if (action=="restore") {
        if (!fromSnapshot(config.boardHardware,expected_)) { error="The saved profile has no valid ESP32-S3 wiring configuration."; return false; }
    } else if (action=="clear") expected_=Config{};
    else if (action=="default") {
        expected_=Config{}; const uint8_t switches[]={6,7,15,16,1,2,4,5}, pots[]={8,12,13,11};
        for (int i=0;i<8;++i) { auto& e=expected_.controls[i]; e.kind=Switch; e.pinA=switches[i]; e.cc=20+i; }
        for (int i=0;i<4;++i) { auto& e=expected_.controls[8+i]; e.kind=Analog; e.pinA=pots[i]; e.cc=10+i; }
        auto& enc=expected_.controls[12]; enc.kind=Encoder; enc.pinA=18; enc.pinB=17; enc.cc=30;
        auto& push=expected_.controls[13]; push.kind=Switch; push.pinA=21; push.cc=31;
        expected_.ledPin=48; expected_.ledCount=8;
    }
    if (action!="learn" && validate(expected_)!=Ok) { error="Invalid or conflicting pins, calibration, or MIDI addresses."; return false; }
    start(action=="learn" ? "searching" : "proposing",send);
    std::vector<uint8_t> begin(3); write14(begin.data(),revision_); begin[2]=action=="learn" ? slot_ : 1;
    bool sent=true;
    if (action=="learn") {
        begin.resize(3+EntryBytes); encode(expected_.controls[slot_],begin.data()+3);
        sent=sendPacket(Learn,begin,send);
    } else {
        sent=sendPacket(Begin,begin,send);
        for (int i=0;i<Slots && sent;++i) if (expected_.controls[i].kind) {
            std::vector<uint8_t> e(1+EntryBytes); e[0]=i; encode(expected_.controls[i],e.data()+1);
            sent=sendPacket(Set,e,send);
        }
        if (sent) sent=sendPacket(Leds,{expected_.ledPin,expected_.ledCount,expected_.ledOrder},send);
        if (sent) sent=sendPacket(Preview,{},send);
    }
    if (!sent) { fail("Could not send wiring setup to the board. Read the board and retry.",send); error=message_; return false; }
    return true;
}

void ControllerHardware::bindConfirmed(ControllerConfig& config) {
    using namespace pimfxhw;
    if (operation_=="delete") {
        const auto target=std::find_if(config.controls.begin(),config.controls.end(),[&](const ControllerControl& c){return c.id==target_;});
        const std::string pair=target!=config.controls.end() && target->kind==ControlKind::Encoder ? target->pairId : "";
        config.controls.erase(std::remove_if(config.controls.begin(),config.controls.end(),[&](const ControllerControl& c){return c.id==target_ || (!pair.empty() && c.id==pair);}),config.controls.end());
        for (auto& c:config.controls) if (c.pairId==target_) c.pairId.clear();
    }
    for (auto& c:config.controls) {
        int slot=c.hardware["slot"].asInt(-1);
        const bool selected=c.id==target_;
        if (selected) slot=slot_;
        else if (operation_=="restore") {
            // Explicit restore may target a replacement board; remap saved slots.
        } else if (c.hardware["device"].asString()!=device_) continue;
        if (slot<0 || slot>=Slots) continue;
        const auto& e=active_.controls[slot];
        if (!e.kind || wireKind(c.kind)!=e.kind || operation_=="default" || operation_=="clear") {
            c.hardware=Json(); c.channel=-1; continue;
        }
        c.hardware=entryJson(e,slot); c.hardware.set("device",device_);
        c.channel=e.cc; c.midiChannel=e.channel; c.useNoteMessages=false;
    }
    config.boardHardware=describe(active_);
}
bool ControllerHardware::receive(const std::vector<uint8_t>& b, ControllerConfig& config,
    const Sender& send, bool& configChanged) {
    using namespace pimfxhw;
    if (b.size()<8 || b.front()!=0xF0 || b.back()!=0xF7 || b[1]!=0x7D || b[2]!=0x4D || b[3]!=0x46
        || b[4]<Header || b[4]>Status) return false;
    for (size_t i=1;i+1<b.size();++i) if (b[i]>127) return false;
    if (read14(b.data()+5)!=token_ || !busy()) return false;
    const auto* p=b.data()+7; const size_t n=b.size()-8;
    if (b[4]==Status) { if (n==1) fail(errorText(p[0]),send); return true; }
    if (b[4]==Header) {
        if (n!=22 || p[0]!=Version || p[1]!=Board || p[2]>1 || p[20]>Slots || p[21]>1) {
            fail("Unsupported or malformed board configuration.",send); return true;
        }
        incomingPreview_=p[2];
        if ((phase_=="saving" || phase_=="reading") == incomingPreview_) {
            fail("Unexpected board configuration reply.",send); return true;
        }
        incomingDevice_=std::string(reinterpret_cast<const char*>(p+3),12);
        if (!std::all_of(incomingDevice_.begin(),incomingDevice_.end(),[](char c){return (c>='0'&&c<='9')||(c>='A'&&c<='F');})
            || (!device_.empty() && incomingDevice_!=device_)) {
            fail("Controller identity changed. Reconnect and read the selected board.",send); return true;
        }
        incomingRevision_=read14(p+15);
        incoming_=Config{}; incoming_.ledPin=p[17]; incoming_.ledCount=p[18]; incoming_.ledOrder=p[19];
        expectedCount_=p[20]; storageReady_=p[21]; receivedCount_=0;
        std::fill(std::begin(seen_),std::end(seen_),false); assembling_=true; return true;
    }
    if (!assembling_) { fail("Incomplete board configuration. Read the board again.",send); return true; }
    if (b[4]==Entry) {
        if (n!=1+EntryBytes || p[0]>=Slots || seen_[p[0]] || !p[1]) {
            fail("Invalid or duplicate board control record.",send); return true;
        }
        seen_[p[0]]=true; ++receivedCount_; incoming_.controls[p[0]]=decode(p+1); return true;
    }
    if (b[4]!=End || n!=2 || receivedCount_!=expectedCount_ || validate(incoming_)!=Ok
        || read14(p)!=checksum(incoming_)) { fail("Board configuration checksum or validation failed.",send); return true; }
    assembling_=false;
    if (incomingPreview_) {
        if (incomingRevision_!=revision_) { fail("Board wiring changed during setup. Read it again.",send); return true; }
        Config expected=expected_;
        if (operation_=="learn" && slot_>=0) {
            // Discovery may choose only this control's pins and analog range.
            auto& e=expected.controls[slot_]; const auto& learned=incoming_.controls[slot_];
            e.pinA=learned.pinA; e.pinB=learned.pinB; e.minimum=learned.minimum; e.maximum=learned.maximum;
        }
        if (!equal(expected,incoming_)) { fail("Board proposed unexpected wiring changes.",send); return true; }
        proposed_=incoming_; phase_="review"; deadline_=std::chrono::steady_clock::now()+std::chrono::seconds(75);
        message_="Check the detected wiring, then confirm to save it on the controller.";
    } else {
        if (phase_=="saving" && (incomingRevision_!=((revision_+1)&0x3fff) || !equal(incoming_,proposed_))) {
            fail("The saved board configuration did not match. Read the board before retrying.",send); return true;
        }
        const bool saved=phase_=="saving";
        active_=incoming_; revision_=incomingRevision_; device_=incomingDevice_; ready_=true;
        if (saved) { bindConfirmed(config); configChanged=true; }
        phase_="idle"; target_.clear(); message_=saved ? "Saved on controller and verified." : "Controller wiring read successfully.";
        if (saved && operation_=="default") message_+=" Use Board Controls to add the template controls to Pi-MFX.";
    }
    return true;
}
bool ControllerHardware::accepts(const MidiMessage& message, const ControllerConfig& config) const {
    using namespace pimfxhw;
    if (!ready_ || busy() || !message.isControlChange()) return false;
    for (const auto& c:config.controls) if (!c.useNoteMessages && c.channel==message.data1
        && (c.midiChannel==0 || c.midiChannel==message.channel()+1)) {
        const int slot=c.hardware["slot"].asInt(-1);
        if (c.hardware["device"].asString()!=device_ || slot<0 || slot>=Slots) return false;
        const auto& e=active_.controls[slot]; Control saved;
        if (!entryFromJson(c.hardware,saved) || !e.kind || wireKind(c.kind)!=e.kind) return false;
        Config a,b; a.controls[0]=e; b.controls[0]=saved;
        return equal(a,b) && e.cc==message.data1 && e.channel==message.channel()+1;
    }
    return false;
}
bool ControllerHardware::tick(const Sender& send) {
    if (busy() && std::chrono::steady_clock::now()>deadline_) {
        fail("Hardware setup timed out. Read the board and retry; the saved configuration may need to be checked.",send); return true;
    }
    return false;
}
} // namespace pimfx
