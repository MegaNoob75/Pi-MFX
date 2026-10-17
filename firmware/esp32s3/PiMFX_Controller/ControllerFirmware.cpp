/* Pi-MFX universal ESP32-S3 controller. Configure wiring in Hardware Setup.
 * Arduino: ESP32S3 Dev Module, USB-OTG (TinyUSB), CDC on boot disabled.
 * Libraries: Control Surface, Adafruit NeoPixel.
 */
#include <Arduino.h>
#include <Control_Surface.h>
#include <Adafruit_NeoPixel.h>
#include <Preferences.h>
#include <string.h>
#include "Protocol.h"
#include "HardwareProtocol.h"
#include "FirmwareUpdate.h"
#if !defined(CONFIG_IDF_TARGET_ESP32S3)
#error "This universal image supports ESP32-S3 only."
#endif

USBMIDI_Interface midi;
Adafruit_NeoPixel pixels(0, -1, NEO_GRB + NEO_KHZ800);
Preferences preferences;
namespace {
namespace hw = pimfxhw;
hw::Config active, draft;
uint16_t revision = 0, transaction = 0;
uint32_t transactionAt = 0, lastIdentityAt = 0;
uint32_t ledTestUntil = 0;
uint8_t ledSaved[127 * 3] = {}, ledSavedBrightness = 0;
bool candidate = false, discovering = false, storageReady = false;
uint8_t learnSlot = 0, identityBursts = 8;
char deviceId[13] = {};
const int8_t quadrature[] = {0,-1,1,0,1,0,0,-1,-1,0,0,1,0,1,-1,0};
struct InputState {
    bool raw = false, stable = false, primed = false;
    uint32_t changed = 0, filtered = 0;
    uint8_t ab = 0, last = 0;
    int accum = 0;
} states[hw::Slots];
struct Probe {
    bool initial = true, raw = true, activated = false;
    uint32_t changed = 0, extremeAt = 0;
    unsigned transitions = 0, smooth = 0;
    int low = 4095, high = 0, baselineLow = 4095, baselineHigh = 0, last = -1;
} probes[49];
uint32_t lastProbe = 0;
int pairAccum[49][49] = {};
unsigned pairErrors[49][49] = {};
uint8_t previousLevels[49] = {};

void packet(uint8_t command, uint16_t token, const uint8_t* payload = nullptr, size_t n = 0) {
    // Every configuration packet is complete and below 64 bytes.
    uint8_t bytes[64] = {0xF0,0x7D,0x4D,0x46,command};
    hw::write14(bytes + 5, token);
    for (size_t i = 0; i < n; ++i) bytes[7+i] = payload[i];
    bytes[7+n] = 0xF7; midi.sendSysEx(bytes, uint16_t(8+n));
}
void status(uint16_t token, hw::Error error) { const uint8_t code = error; packet(hw::Status, token, &code, 1); }
void snapshot(uint16_t token, const hw::Config& c, bool preview) {
    uint8_t h[22] = {hw::Version,hw::Board,uint8_t(preview)};
    for (unsigned i = 0; i < 12; ++i) h[3+i] = deviceId[i];
    hw::write14(h+15, revision); h[17] = c.ledPin; h[18] = c.ledCount; h[19] = c.ledOrder;
    for (const auto& e : c.controls) if (e.kind) ++h[20];
    h[21] = storageReady ? 1 : 0; packet(hw::Header, token, h, sizeof h);
    for (unsigned i = 0; i < hw::Slots; ++i) if (c.controls[i].kind) {
        uint8_t bytes[1+hw::EntryBytes]; bytes[0] = i;
        hw::encode(c.controls[i], bytes+1); packet(hw::Entry, token, bytes, sizeof bytes);
    }
    uint8_t crc[2]; hw::write14(crc, hw::checksum(c)); packet(hw::End, token, crc, 2);
}
bool readSaved(const char* key, hw::Config& c, uint16_t& rev) {
    uint8_t b[hw::ConfigBytes+4];
    if (preferences.getBytesLength(key) != sizeof b || preferences.getBytes(key,b,sizeof b) != sizeof b
        || b[0] != hw::Version) return false;
    for (const auto v : b) if (v > 127) return false;
    if (hw::checksum(b,hw::ConfigBytes+2) != hw::read14(b+hw::ConfigBytes+2)) return false;
    hw::Config loaded = hw::decodeConfig(b);
    if (hw::validate(loaded) != hw::Ok) return false;
    c = loaded; rev = hw::read14(b+hw::ConfigBytes); return true;
}
bool saveConfig(const hw::Config& c, uint16_t rev) {
    if (!storageReady) return false;
    uint8_t b[hw::ConfigBytes+4];
    hw::encode(active,b); hw::write14(b+hw::ConfigBytes,revision);
    hw::write14(b+hw::ConfigBytes+2,hw::checksum(b,hw::ConfigBytes+2));
    if (preferences.putBytes("previous",b,sizeof b) != sizeof b) return false;
    hw::encode(c,b); hw::write14(b+hw::ConfigBytes,rev); hw::write14(b+hw::ConfigBytes+2,hw::checksum(b,hw::ConfigBytes+2));
    if (preferences.putBytes("current",b,sizeof b) != sizeof b) return false;
    hw::Config verified; uint16_t checked = 0;
    return readSaved("current",verified,checked) && checked == rev && hw::equal(verified,c);
}
void configureInputs() {
    // WS2812 pixels latch their last colour. Blank the old strip before freeing
    // its pin, including when the user disables it or moves the data connection.
    if (pixels.numPixels()) { pixels.clear(); pixels.show(); }
    pixels.setPin(-1); ledTestUntil=0;
    for (int p = 0; p < 49; ++p) if (hw::inputPin(p) || p == 48) pinMode(p,INPUT);
    for (unsigned i = 0; i < hw::Slots; ++i) {
        states[i] = InputState{}; const auto& e = active.controls[i]; if (!e.kind) continue;
        pinMode(e.pinA,e.kind == hw::Analog ? INPUT : INPUT_PULLUP);
        if (e.kind == hw::Encoder) {
            pinMode(e.pinB,INPUT_PULLUP);
            states[i].ab = (digitalRead(e.pinA)<<1) | digitalRead(e.pinB);
        } else if (e.kind == hw::Switch) states[i].raw = states[i].stable = digitalRead(e.pinA) == LOW;
    }
    pixels.updateLength(active.ledCount); pixels.setPin(active.ledCount ? active.ledPin : -1);
    pixels.updateType((active.ledOrder ? NEO_RGB : NEO_GRB) + NEO_KHZ800);
    if (active.ledCount) { pixels.begin(); pixels.clear(); pixels.show(); }
}
void cancelTransaction() { transaction = 0; candidate = discovering = false; configureInputs(); }
bool usedPin(int p, int exceptSlot) {
    if (active.ledCount && active.ledPin == p) return true;
    for (unsigned i = 0; i < hw::Slots; ++i) if (int(i) != exceptSlot) {
        const auto& c = active.controls[i];
        if (c.kind && (c.pinA == p || (c.kind == hw::Encoder && c.pinB == p))) return true;
    }
    return false;
}
void propose() {
    const hw::Error error = hw::validate(draft); discovering = false; configureInputs();
    if (error != hw::Ok) { status(transaction,error); cancelTransaction(); return; }
    candidate = true; transactionAt = millis(); snapshot(transaction,draft,true);
}
void startProbe() {
    const auto& e = draft.controls[learnSlot];
    for (int p = 0; p < 49; ++p) {
        probes[p] = Probe{};
        for (int q = 0; q < 49; ++q) { pairAccum[p][q] = 0; pairErrors[p][q] = 0; }
        if (!hw::inputPin(p) || usedPin(p,learnSlot) || (e.kind == hw::Analog && !hw::analogPin(p))) continue;
        pinMode(p,e.kind == hw::Analog ? INPUT_PULLDOWN : INPUT_PULLUP);
        probes[p].initial = probes[p].raw = digitalRead(p) == HIGH;
        previousLevels[p] = probes[p].initial;
    }
    discovering = true; transactionAt = millis(); lastProbe = 0;
}
void pollProbe() {
    const uint32_t now = millis(), elapsed = now-transactionAt;
    auto& e = draft.controls[learnSlot];
    if (now-lastProbe < (e.kind == hw::Analog ? 8u : 1u)) return;
    lastProbe = now;
    if (e.kind == hw::Analog) {
        unsigned moving = 0; int detected = -1;
        for (int p = 0; p < 49; ++p) if (hw::analogPin(p) && !usedPin(p,learnSlot)) {
            auto& s = probes[p]; int value = 0;
            for (int n = 0; n < 4; ++n) value += analogRead(p);
            value /= 4; pinMode(p,INPUT_PULLDOWN); // weak bias rejects floating unused ADC inputs
            if (elapsed < 700) {
                if (elapsed > 200) {
                    if (value < s.baselineLow) s.baselineLow = value;
                    if (value > s.baselineHigh) s.baselineHigh = value;
                }
                s.low = s.high = value; s.last = value; continue;
            }
            if (value < s.low-12 || value > s.high+12) s.extremeAt = now;
            if (value < s.low) s.low = value;
            if (value > s.high) s.high = value;
            const int delta = abs(value-s.last);
            if (delta >= 8 && delta <= 400) ++s.smooth;
            s.last = value;
            if (s.baselineHigh-s.baselineLow < 150 && s.high-s.low >= 700 && s.smooth >= 8) {
                ++moving; detected = p;
            }
        }
        if (moving > 1) { status(transaction,hw::Ambiguous); cancelTransaction(); return; }
        if (moving == 1 && now-probes[detected].extremeAt > 800) {
            e.pinA = detected; e.pinB = hw::None;
            e.minimum = probes[detected].low; e.maximum = probes[detected].high; propose();
        }
        return;
    }
    uint8_t levels[49] = {}; unsigned moving = 0; int found = -1, second = -1;
    for (int p = 0; p < 49; ++p) if (hw::inputPin(p) && !usedPin(p,learnSlot)) {
        auto& s = probes[p]; levels[p] = digitalRead(p) == HIGH;
        if (elapsed < 400) { s.initial = s.raw = levels[p]; previousLevels[p] = levels[p]; continue; }
        if (levels[p] != s.raw) { s.raw = levels[p]; s.changed = now; ++s.transitions; }
        if (e.kind == hw::Switch) {
            // Remember a debounced activation even after release. The quiet
            // window below checks for competing inputs, not a minimum hold.
            if (s.raw != s.initial && now-s.changed >= e.debounce) s.activated = true;
            if (s.activated) { ++moving; found = p; }
        } else if (s.transitions >= 4) { ++moving; if (found < 0) found = p; else second = p; }
    }
    if (elapsed < 400) return;
    if (e.kind == hw::Switch) {
        if (moving > 1) { status(transaction,hw::Ambiguous); cancelTransaction(); return; }
        if (moving == 1 && now-probes[found].changed > 180) { e.pinA = found; e.pinB = hw::None; propose(); }
    } else {
        for (int a = 0; a < 49; ++a) if (hw::inputPin(a) && !usedPin(a,learnSlot))
            for (int b = a+1; b < 49; ++b) if (hw::inputPin(b) && !usedPin(b,learnSlot)) {
                const int old = (previousLevels[a]<<1) | previousLevels[b], next = (levels[a]<<1) | levels[b];
                if ((old^next) == 3) ++pairErrors[a][b];
                pairAccum[a][b] += quadrature[(old<<2)|next];
            }
        if (moving > 2) { status(transaction,hw::Ambiguous); cancelTransaction(); return; }
        if (moving == 2 && second >= 0 && abs(pairAccum[found][second]) >= 12
            && pairErrors[found][second] <= 1 && now-probes[found].changed > 250
            && now-probes[second].changed > 250) {
            const bool forward = pairAccum[found][second] > 0;
            e.pinA = forward ? found : second; e.pinB = forward ? second : found; propose();
        }
    }
    for (int p = 0; p < 49; ++p) previousLevels[p] = levels[p];
}
void sendIdentityReply() {
    unsigned count = 0; for (const auto& e : active.controls) if (e.kind) ++count;
    const uint8_t b[] = {0xF0,0x7D,0x4D,0x46,0x10,pimfx::kFirmwareMajor,pimfx::kFirmwareMinor,
        uint8_t(count),0,active.ledCount,0,1,0xF7};
    midi.sendSysEx(b); lastIdentityAt = millis();
}
void applyLedMessage(const uint8_t* p, size_t n) {
    if (n < 3 || !active.ledCount || transaction || int32_t(ledTestUntil-millis()) > 0) return;
    const unsigned count = hw::read14(p+1); if (n != 3+count*4) return;
    pixels.setBrightness(uint16_t(p[0])*255/127); pixels.clear();
    for (size_t o = 3; o+4 <= n; o += 4) if (p[o] < active.ledCount)
        pixels.setPixelColor(p[o],pixels.Color(uint16_t(p[o+1])*255/127,
            uint16_t(p[o+2])*255/127,uint16_t(p[o+3])*255/127));
    pixels.show();
}
void handleIncomingSysEx(SysExMessage message) {
    const uint8_t* b = message.data; const size_t n = message.length;
    if (n < 6 || b[0] != 0xF0 || b[n-1] != 0xF7 || b[1] != 0x7D || b[2] != 0x4D || b[3] != 0x46) return;
    for (size_t i = 1; i+1 < n; ++i) if (b[i] > 127) return;
    const uint8_t command = b[4];
    if (pimfxupdate::handle(midi,b,n,deviceId,transaction!=0)) return;
    if (pimfxupdate::busy || pimfxupdate::restartAt) return;
    if (command == 0x01 && n == 6) { sendIdentityReply(); return; }
    if (command == 0x02) { applyLedMessage(b+5,n-6); return; }
    if (command == hw::LedFrame) {
        if (n < 9 || !active.ledCount || transaction || int32_t(ledTestUntil-millis()) > 0) return;
        const uint8_t brightness=b[5], flags=b[6], count=b[7];
        if (flags>3 || count>24 || n!=9u+4u*count) return;
        pixels.setBrightness(uint16_t(brightness)*255/127);
        if (flags&1) pixels.clear();
        for (size_t o=8;o+4<n;o+=4) if (b[o]<active.ledCount)
            pixels.setPixelColor(b[o],pixels.Color(uint16_t(b[o+1])*255/127,uint16_t(b[o+2])*255/127,uint16_t(b[o+3])*255/127));
        if (flags&2) pixels.show();
        return;
    }
    if (n < 8) return;
    const uint16_t token = hw::read14(b+5); const uint8_t* p = b+7; const size_t len = n-8;
    if (!token) return;
    if (command == hw::TestLed && len == 1 && !transaction && p[0]<active.ledCount) {
        if (!pixels.getPixels()) return;
        if (!ledTestUntil) {
            memcpy(ledSaved,pixels.getPixels(),size_t(active.ledCount)*3);
            ledSavedBrightness=pixels.getBrightness();
        }
        pixels.clear(); pixels.setBrightness(32); pixels.setPixelColor(p[0],pixels.Color(255,255,255));
        pixels.show(); ledTestUntil=millis()+1500; return;
    }
    if (command == hw::Read && !len) {
        // A new host can recover an abandoned setup immediately. Read discards
        // only the unsaved draft; it never writes pins/configuration to NVS.
        if (transaction) cancelTransaction();
        snapshot(token,active,false); return;
    }
    if (command == hw::Cancel && !len && token == transaction) { cancelTransaction(); return; }
    if (command == hw::Begin || command == hw::Learn) {
        if (len != (command == hw::Begin ? 3u : 3u+hw::EntryBytes)) { status(token,hw::Invalid); return; }
        if (transaction) { status(token,hw::Busy); return; }
        if (hw::read14(p) != revision) { status(token,hw::Stale); return; }
        draft = active; transaction = token; transactionAt = millis();
        if (command == hw::Begin) {
            if (p[2] > 1) { status(token,hw::Invalid); cancelTransaction(); return; }
            if (p[2]) draft = hw::Config{}; return;
        }
        learnSlot = p[2]; if (learnSlot >= hw::Slots) { status(token,hw::Invalid); cancelTransaction(); return; }
        draft.controls[learnSlot] = hw::decode(p+3); const auto& e = draft.controls[learnSlot];
        if (e.kind < hw::Switch || e.kind > hw::Encoder || e.channel < 1 || e.channel > 16
            || e.steps < 1 || e.steps > 8 || e.debounce < 5 || e.debounce > 80) {
            status(token,hw::Invalid); cancelTransaction(); return;
        }
        startProbe(); return;
    }
    if (!transaction || token != transaction) { status(token,hw::Stale); return; }
    transactionAt = millis();
    if (command == hw::Set && len == 1+hw::EntryBytes && !candidate && !discovering && p[0] < hw::Slots) {
        draft.controls[p[0]] = hw::decode(p+1); return;
    }
    if (command == hw::Leds && len == 3 && !candidate && !discovering) {
        draft.ledPin = p[0]; draft.ledCount = p[1]; draft.ledOrder = p[2]; return;
    }
    if (command == hw::Preview && !len && !candidate && !discovering) { propose(); return; }
    if (command == hw::Commit && len == 2 && candidate) {
        if (hw::read14(p) != hw::checksum(draft)) { status(token,hw::Invalid); cancelTransaction(); return; }
        const uint16_t next = (revision+1)&0x3fff;
        if (!saveConfig(draft,next)) { storageReady=false; status(token,hw::Storage); cancelTransaction(); return; }
        active = draft; revision = next; cancelTransaction(); snapshot(token,active,false); sendIdentityReply(); return;
    }
    status(token,hw::Invalid); cancelTransaction();
}
struct Callbacks : MIDI_Callbacks {
    void onSysExMessage(MIDI_Interface&,SysExMessage message) override { handleIncomingSysEx(message); }
} callbacks;
void pollInputs() {
    static uint32_t analogAt = 0;
    const uint32_t now = millis(); const bool sampleAnalog = now-analogAt >= 4;
    if (sampleAnalog) analogAt = now;
    for (unsigned i = 0; i < hw::Slots; ++i) {
        const auto& e = active.controls[i]; auto& s = states[i]; if (!e.kind) continue;
        int value = -1;
        if (e.kind == hw::Switch) {
            const bool pressed = digitalRead(e.pinA) == LOW;
            if (pressed != s.raw) { s.raw = pressed; s.changed = now; }
            if (pressed != s.stable && now-s.changed >= e.debounce) { s.stable = pressed; value = pressed ? 127 : 0; }
        } else if (e.kind == hw::Encoder) {
            const uint8_t ab = (digitalRead(e.pinA)<<1) | digitalRead(e.pinB);
            s.accum += quadrature[(s.ab<<2)|ab]; s.ab = ab;
            if (s.accum >= e.steps) { value = 65; s.accum = 0; }
            else if (s.accum <= -int(e.steps)) { value = 63; s.accum = 0; }
        } else if (sampleAnalog) {
            const uint32_t raw = analogRead(e.pinA);
            s.filtered = s.primed ? s.filtered-(s.filtered>>3)+raw : raw<<3;
            const int current = constrain((int(s.filtered>>3)-e.minimum)*127/(e.maximum-e.minimum),0,127);
            if (!s.primed) { s.primed = true; s.last = current; }
            if (abs(current-s.last) > 1 || (current != s.last && (current == 0 || current == 127))) {
                s.last = current; value = current;
            }
        }
        if (value >= 0) midi.sendControlChange({e.cc,Channel(e.channel-1)},uint8_t(value));
    }
}
} // namespace
void pimfxControllerSetup() {
    analogReadResolution(12);
    const uint64_t mac = ESP.getEfuseMac();
    for (unsigned i = 0; i < 12; ++i) deviceId[i] = "0123456789ABCDEF"[(mac>>((11-i)*4))&15];
    storageReady = preferences.begin("pimfx-hw",false);
    if (storageReady && !readSaved("current",active,revision)) {
        if (!readSaved("previous",active,revision)) { active = hw::Config{}; revision = 0; }
    }
    configureInputs(); Control_Surface.begin(); midi.setCallbacks(callbacks);
}
void pimfxControllerLoop() {
    Control_Surface.loop();
    pimfxupdate::poll();
    if (pimfxupdate::busy || pimfxupdate::restartAt) return;
    if (ledTestUntil && int32_t(millis()-ledTestUntil)>=0) {
        ledTestUntil=0; pixels.setBrightness(ledSavedBrightness);
        if (pixels.getPixels()) memcpy(pixels.getPixels(),ledSaved,size_t(active.ledCount)*3);
        pixels.show();
    }
    if (transaction && millis()-transactionAt > 90000) { status(transaction,hw::TimedOut); cancelTransaction(); }
    if (discovering) pollProbe(); else if (!transaction) pollInputs();
    if (identityBursts && millis()-lastIdentityAt >= 500) { sendIdentityReply(); --identityBursts; }
}
