#pragma once

// Wire format shared with the Pi. No Arduino, heap allocation, or native struct
// serialization: every MIDI payload byte is seven-bit and padding-independent.
#include <stddef.h>
#include <stdint.h>

namespace pimfxhw {
constexpr uint8_t Version = 1, Board = 1, None = 127, Slots = 32;
constexpr size_t EntryBytes = 11, ConfigBytes = 4 + Slots * EntryBytes;
enum Command : uint8_t {
    Read = 0x20, Learn = 0x21, Cancel = 0x22, Commit = 0x23,
    Begin = 0x24, Set = 0x25, Leds = 0x26, Preview = 0x27,
    TestLed = 0x28, LedFrame = 0x29,
    Header = 0x30, Entry = 0x31, End = 0x32, Status = 0x33
};
enum Kind : uint8_t { Empty = 0, Switch = 1, Analog = 2, Encoder = 3 };
enum Error : uint8_t {
    Ok = 0, Invalid = 1, Conflict = 2, Storage = 3, TimedOut = 4,
    Ambiguous = 5, Stale = 6, Busy = 7
};
struct Control {
    uint8_t kind = Empty, pinA = None, pinB = None, cc = 0, channel = 1;
    uint8_t steps = 4, debounce = 20;
    uint16_t minimum = 0, maximum = 4095;
};
struct Config {
    uint8_t ledPin = None, ledCount = 0, ledOrder = 0;
    Control controls[Slots];
};
inline bool inputPin(int p) {
    // ESP32-S3 DevKitC-1 direct wiring. Never probe USB, boot straps, flash,
    // PSRAM, UART, or pins absent on this board. GPIO48 is output-only here
    // because DevKit revisions use it for the onboard NeoPixel.
    return p == 1 || p == 2 || (p >= 4 && p <= 18) || p == 21
        || (p >= 38 && p <= 42) || p == 47;
}
inline bool analogPin(int p) { return inputPin(p) && p <= 18; }
inline bool outputPin(int p) { return inputPin(p) || p == 48; }
inline uint16_t read14(const uint8_t* p) { return p[0] | (uint16_t(p[1]) << 7); }
inline void write14(uint8_t* p, uint16_t v) { p[0] = v & 127; p[1] = (v >> 7) & 127; }
inline void encode(const Control& c, uint8_t* p) {
    p[0] = c.kind; p[1] = c.pinA; p[2] = c.pinB; p[3] = c.cc;
    p[4] = c.channel; p[5] = c.steps; p[6] = c.debounce;
    write14(p + 7, c.minimum); write14(p + 9, c.maximum);
}
inline Control decode(const uint8_t* p) {
    Control c;
    c.kind = p[0]; c.pinA = p[1]; c.pinB = p[2]; c.cc = p[3];
    c.channel = p[4]; c.steps = p[5]; c.debounce = p[6];
    c.minimum = read14(p + 7); c.maximum = read14(p + 9);
    return c;
}
inline void encode(const Config& c, uint8_t* p) {
    p[0] = Version; p[1] = c.ledPin; p[2] = c.ledCount; p[3] = c.ledOrder;
    for (unsigned i = 0; i < Slots; ++i) encode(c.controls[i], p + 4 + i * EntryBytes);
}
inline Config decodeConfig(const uint8_t* p) {
    Config c;
    c.ledPin = p[1]; c.ledCount = p[2]; c.ledOrder = p[3];
    for (unsigned i = 0; i < Slots; ++i) c.controls[i] = decode(p + 4 + i * EntryBytes);
    return c;
}
inline uint16_t checksum(const uint8_t* bytes, size_t n) {
    uint16_t crc = 0;
    for (size_t i = 0; i < n; ++i) {
        crc ^= uint16_t(bytes[i]) << 6;
        for (int b = 0; b < 8; ++b)
            crc = ((crc << 1) ^ ((crc & 0x2000) ? 0x0805 : 0)) & 0x3fff;
    }
    return crc;
}
inline uint16_t checksum(const Config& c) {
    uint8_t bytes[ConfigBytes]; encode(c, bytes); return checksum(bytes, sizeof bytes);
}
inline bool equal(const Config& a, const Config& b) {
    uint8_t x[ConfigBytes], y[ConfigBytes]; encode(a,x); encode(b,y);
    for (size_t i=0;i<ConfigBytes;++i) if (x[i]!=y[i]) return false;
    return true;
}
inline Error validate(const Config& c) {
    bool pins[49] = {};
    if (c.ledCount > 127 || c.ledOrder > 1) return Invalid;
    if (c.ledCount) {
        if (!outputPin(c.ledPin)) return Invalid;
        pins[c.ledPin] = true;
    } else if (c.ledPin != None) return Invalid;
    for (unsigned i = 0; i < Slots; ++i) {
        const Control& e = c.controls[i];
        if (!e.kind) continue;
        if (e.kind > Encoder || !inputPin(e.pinA) || e.cc > 127
            || e.channel < 1 || e.channel > 16 || e.steps < 1 || e.steps > 8
            || e.debounce < 5 || e.debounce > 80
            || e.minimum >= e.maximum || e.maximum > 4095) return Invalid;
        if (e.kind == Analog && (!analogPin(e.pinA) || e.maximum - e.minimum < 256)) return Invalid;
        if (e.kind != Encoder && e.pinB != None) return Invalid;
        if (pins[e.pinA]) return Conflict;
        pins[e.pinA] = true;
        if (e.kind == Encoder) {
            if (!inputPin(e.pinB)) return Invalid;
            if (pins[e.pinB]) return Conflict;
            pins[e.pinB] = true;
        }
        for (unsigned j = 0; j < i; ++j)
            if (c.controls[j].kind && c.controls[j].cc == e.cc
                && c.controls[j].channel == e.channel) return Conflict;
    }
    return Ok;
}
} // namespace pimfxhw
