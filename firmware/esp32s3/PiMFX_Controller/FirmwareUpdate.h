#pragma once

// USB-MIDI firmware transfer v1. Every complete SysEx fits in 64 bytes.
// Only the inactive OTA application is written; the partition table and NVS
// are never replaced. The digest is a transfer checksum, not authentication.
#include <Update.h>
#include <esp_ota_ops.h>

namespace pimfxupdate {
constexpr uint8_t Begin = 0x40, Data = 0x41, Finish = 0x42, Ack = 0x43;
constexpr uint8_t Query = 0x44, Info = 0x45, Abort = 0x46;
uint16_t token = 0;
uint32_t received = 0, expected = 0, lastAt = 0, restartAt = 0;
bool busy = false;
inline uint32_t read28(const uint8_t* p) {
    return p[0] | (uint32_t(p[1])<<7) | (uint32_t(p[2])<<14) | (uint32_t(p[3])<<21);
}
inline void write28(uint8_t* p, uint32_t v) {
    for (unsigned i=0;i<4;++i) p[i]=(v>>(7*i))&127;
}
template<class Midi> void ack(Midi& midi, uint16_t t, uint8_t command, uint8_t error) {
    uint8_t b[] = {0xF0,0x7D,0x4D,0x46,Ack,uint8_t(t&127),uint8_t(t>>7),command,error,0,0,0,0,0xF7};
    write28(b+9,received); midi.sendSysEx(b);
}
inline void cancel() {
    if (busy) Update.abort();
    busy=false; token=0; received=expected=0;
}
template<class Midi> bool handle(Midi& midi, const uint8_t* b, size_t n,
                                 const char* deviceId, bool hardwareBusy) {
    const uint8_t cmd=b[4];
    if (cmd<Begin || cmd>Abort) return false;
    if (n<8) return true;
    const uint16_t t=b[5]|(uint16_t(b[6])<<7);
    if (!t) return true;
    if (cmd==Query && n==8) {
        const auto* part=esp_ota_get_next_update_partition(nullptr);
        const auto* running=esp_ota_get_running_partition();
        uint8_t out[29]={0xF0,0x7D,0x4D,0x46,Info,b[5],b[6],1,1,
            pimfx::kFirmwareMajor,pimfx::kFirmwareMinor,0,0,0,0};
        write28(out+11,part && part!=running ? part->size : 0);
        for (unsigned i=0;i<12;++i) out[15+i]=deviceId[i];
        out[27]=busy || hardwareBusy; out[28]=0xF7; midi.sendSysEx(out); return true;
    }
    if (cmd==Abort && n==8 && busy && t==token) { cancel(); ack(midi,t,cmd,0); return true; }
    if (cmd==Begin) {
        // Begin: image byte count (28 bit), ASCII MD5, protocol and board IDs.
        if (n!=46 || b[43]!=1 || b[44]!=1 || busy || hardwareBusy || restartAt) {
            ack(midi,t,cmd,1); return true;
        }
        const uint32_t size=read28(b+7);
        const auto* part=esp_ota_get_next_update_partition(nullptr);
        if (!size || !part || part==esp_ota_get_running_partition() || size>part->size) {
            ack(midi,t,cmd,2); return true;
        }
        char md5[33]={};
        for (unsigned i=0;i<32;++i) {
            if (!((b[11+i]>='0' && b[11+i]<='9') || (b[11+i]>='a' && b[11+i]<='f'))) {
                ack(midi,t,cmd,3); return true;
            }
            md5[i]=b[11+i];
        }
        if (!Update.begin(size,U_FLASH)) { ack(midi,t,cmd,4); return true; }
        if (!Update.setMD5(md5)) { Update.abort(); ack(midi,t,cmd,3); return true; }
        busy=true; token=t; expected=size; received=0; lastAt=millis();
        ack(midi,t,cmd,0); return true;
    }
    if (!busy || t!=token) { ack(midi,t,cmd,5); return true; }
    lastAt=millis();
    if (cmd==Data && n>=14 && n<=60) {
        const uint32_t offset=read28(b+7);
        uint8_t decoded[42]; size_t count=0;
        for (size_t i=11;i<n-1;) {
            const uint8_t high=b[i++];
            const size_t group=(n-1-i)<7 ? n-1-i : 7;
            if (!group || (high>>group)) { ack(midi,t,cmd,3); return true; }
            for (unsigned j=0;j<group;++j) decoded[count++]=b[i++]|(((high>>j)&1)<<7);
        }
        // Duplicate retries after a lost ACK are acknowledged without rewriting.
        if (offset<received && offset+count==received) { ack(midi,t,cmd,0); return true; }
        if (offset!=received || count>expected-received) { ack(midi,t,cmd,6); return true; }
        if (Update.write(decoded,count)!=count) { cancel(); ack(midi,t,cmd,4); return true; }
        received+=count; ack(midi,t,cmd,0); return true;
    }
    if (cmd==Finish && n==8 && received==expected) {
        if (!Update.end()) { cancel(); ack(midi,t,cmd,7); return true; }
        busy=false; ack(midi,t,cmd,0); restartAt=millis()+300; return true;
    }
    ack(midi,t,cmd,3); return true;
}
inline void poll() {
    if (busy && millis()-lastAt>30000) cancel();
    if (restartAt && int32_t(millis()-restartAt)>=0) ESP.restart();
}
} // namespace pimfxupdate
