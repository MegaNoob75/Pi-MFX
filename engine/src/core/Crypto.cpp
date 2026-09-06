#include "core/Crypto.h"

#include <cstring>
#include <random>

namespace pimfx {
namespace {

constexpr char kBase64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
constexpr char kBase64Url[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

inline uint32_t rotl32(uint32_t value, int bits) {
    return (value << bits) | (value >> (32 - bits));
}

inline uint32_t rotr32(uint32_t value, int bits) {
    return (value >> bits) | (value << (32 - bits));
}

std::string encodeWith(const char* alphabet, bool pad, const uint8_t* data, size_t length) {
    std::string out;
    out.reserve(((length + 2) / 3) * 4);
    size_t i = 0;
    while (i + 2 < length) {
        const uint32_t block = (static_cast<uint32_t>(data[i]) << 16)
                             | (static_cast<uint32_t>(data[i + 1]) << 8)
                             | static_cast<uint32_t>(data[i + 2]);
        out.push_back(alphabet[(block >> 18) & 0x3F]);
        out.push_back(alphabet[(block >> 12) & 0x3F]);
        out.push_back(alphabet[(block >> 6) & 0x3F]);
        out.push_back(alphabet[block & 0x3F]);
        i += 3;
    }
    const size_t remaining = length - i;
    if (remaining == 1) {
        const uint32_t block = static_cast<uint32_t>(data[i]) << 16;
        out.push_back(alphabet[(block >> 18) & 0x3F]);
        out.push_back(alphabet[(block >> 12) & 0x3F]);
        if (pad) {
            out += "==";
        }
    } else if (remaining == 2) {
        const uint32_t block = (static_cast<uint32_t>(data[i]) << 16)
                             | (static_cast<uint32_t>(data[i + 1]) << 8);
        out.push_back(alphabet[(block >> 18) & 0x3F]);
        out.push_back(alphabet[(block >> 12) & 0x3F]);
        out.push_back(alphabet[(block >> 6) & 0x3F]);
        if (pad) {
            out.push_back('=');
        }
    }
    return out;
}

int base64Value(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+' || c == '-') return 62;
    if (c == '/' || c == '_') return 63;
    return -1;
}

} // namespace

std::vector<uint8_t> sha1(const std::string& data) {
    uint32_t h[5] = {0x67452301u, 0xEFCDAB89u, 0x98BADCFEu, 0x10325476u, 0xC3D2E1F0u};

    std::string message = data;
    const uint64_t bitLength = static_cast<uint64_t>(data.size()) * 8;
    message.push_back(static_cast<char>(0x80));
    while (message.size() % 64 != 56) {
        message.push_back('\0');
    }
    for (int i = 7; i >= 0; --i) {
        message.push_back(static_cast<char>((bitLength >> (i * 8)) & 0xFF));
    }

    for (size_t offset = 0; offset < message.size(); offset += 64) {
        uint32_t w[80];
        for (int i = 0; i < 16; ++i) {
            const size_t base = offset + static_cast<size_t>(i) * 4;
            w[i] = (static_cast<uint32_t>(static_cast<uint8_t>(message[base])) << 24)
                 | (static_cast<uint32_t>(static_cast<uint8_t>(message[base + 1])) << 16)
                 | (static_cast<uint32_t>(static_cast<uint8_t>(message[base + 2])) << 8)
                 | static_cast<uint32_t>(static_cast<uint8_t>(message[base + 3]));
        }
        for (int i = 16; i < 80; ++i) {
            w[i] = rotl32(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        }

        uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
        for (int i = 0; i < 80; ++i) {
            uint32_t f = 0;
            uint32_t k = 0;
            if (i < 20) {
                f = (b & c) | (~b & d);
                k = 0x5A827999u;
            } else if (i < 40) {
                f = b ^ c ^ d;
                k = 0x6ED9EBA1u;
            } else if (i < 60) {
                f = (b & c) | (b & d) | (c & d);
                k = 0x8F1BBCDCu;
            } else {
                f = b ^ c ^ d;
                k = 0xCA62C1D6u;
            }
            const uint32_t temp = rotl32(a, 5) + f + e + k + w[i];
            e = d;
            d = c;
            c = rotl32(b, 30);
            b = a;
            a = temp;
        }
        h[0] += a;
        h[1] += b;
        h[2] += c;
        h[3] += d;
        h[4] += e;
    }

    std::vector<uint8_t> digest(20);
    for (int i = 0; i < 5; ++i) {
        digest[i * 4 + 0] = static_cast<uint8_t>((h[i] >> 24) & 0xFF);
        digest[i * 4 + 1] = static_cast<uint8_t>((h[i] >> 16) & 0xFF);
        digest[i * 4 + 2] = static_cast<uint8_t>((h[i] >> 8) & 0xFF);
        digest[i * 4 + 3] = static_cast<uint8_t>(h[i] & 0xFF);
    }
    return digest;
}

std::vector<uint8_t> sha256(const std::string& data) {
    static const uint32_t k[64] = {
        0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u,
        0x923f82a4u, 0xab1c5ed5u, 0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
        0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u, 0xe49b69c1u, 0xefbe4786u,
        0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
        0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u,
        0x06ca6351u, 0x14292967u, 0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
        0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u, 0xa2bfe8a1u, 0xa81a664bu,
        0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
        0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au,
        0x5b9cca4fu, 0x682e6ff3u, 0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
        0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u};

    uint32_t h[8] = {0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
                     0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u};

    std::string message = data;
    const uint64_t bitLength = static_cast<uint64_t>(data.size()) * 8;
    message.push_back(static_cast<char>(0x80));
    while (message.size() % 64 != 56) {
        message.push_back('\0');
    }
    for (int i = 7; i >= 0; --i) {
        message.push_back(static_cast<char>((bitLength >> (i * 8)) & 0xFF));
    }

    for (size_t offset = 0; offset < message.size(); offset += 64) {
        uint32_t w[64];
        for (int i = 0; i < 16; ++i) {
            const size_t base = offset + static_cast<size_t>(i) * 4;
            w[i] = (static_cast<uint32_t>(static_cast<uint8_t>(message[base])) << 24)
                 | (static_cast<uint32_t>(static_cast<uint8_t>(message[base + 1])) << 16)
                 | (static_cast<uint32_t>(static_cast<uint8_t>(message[base + 2])) << 8)
                 | static_cast<uint32_t>(static_cast<uint8_t>(message[base + 3]));
        }
        for (int i = 16; i < 64; ++i) {
            const uint32_t s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >> 3);
            const uint32_t s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16] + s0 + w[i - 7] + s1;
        }

        uint32_t a = h[0], b = h[1], c = h[2], d = h[3];
        uint32_t e = h[4], f = h[5], g = h[6], hh = h[7];
        for (int i = 0; i < 64; ++i) {
            const uint32_t s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
            const uint32_t ch = (e & f) ^ (~e & g);
            const uint32_t temp1 = hh + s1 + ch + k[i] + w[i];
            const uint32_t s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
            const uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
            const uint32_t temp2 = s0 + maj;
            hh = g;
            g = f;
            f = e;
            e = d + temp1;
            d = c;
            c = b;
            b = a;
            a = temp1 + temp2;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d;
        h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }

    std::vector<uint8_t> digest(32);
    for (int i = 0; i < 8; ++i) {
        digest[i * 4 + 0] = static_cast<uint8_t>((h[i] >> 24) & 0xFF);
        digest[i * 4 + 1] = static_cast<uint8_t>((h[i] >> 16) & 0xFF);
        digest[i * 4 + 2] = static_cast<uint8_t>((h[i] >> 8) & 0xFF);
        digest[i * 4 + 3] = static_cast<uint8_t>(h[i] & 0xFF);
    }
    return digest;
}

std::string base64Encode(const uint8_t* data, size_t length) {
    return encodeWith(kBase64, true, data, length);
}

std::string base64Encode(const std::string& data) {
    return encodeWith(kBase64, true, reinterpret_cast<const uint8_t*>(data.data()), data.size());
}

std::string base64UrlEncode(const uint8_t* data, size_t length) {
    return encodeWith(kBase64Url, false, data, length);
}

std::string base64Decode(const std::string& text) {
    std::string out;
    out.reserve(text.size() / 4 * 3);
    uint32_t buffer = 0;
    int bits = 0;
    for (char c : text) {
        if (c == '=' || c == '\n' || c == '\r') {
            continue;
        }
        const int value = base64Value(c);
        if (value < 0) {
            continue;
        }
        buffer = (buffer << 6) | static_cast<uint32_t>(value);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<char>((buffer >> bits) & 0xFF));
        }
    }
    return out;
}

std::vector<uint8_t> randomBytes(size_t count) {
    std::vector<uint8_t> out(count);
    std::random_device device;
    for (size_t i = 0; i < count; ++i) {
        out[i] = static_cast<uint8_t>(device() & 0xFF);
    }
    return out;
}

std::string randomToken(size_t bytes) {
    const std::vector<uint8_t> data = randomBytes(bytes);
    return base64UrlEncode(data.data(), data.size());
}

std::string toHex(const std::vector<uint8_t>& data) {
    static const char* digits = "0123456789abcdef";
    std::string out;
    out.reserve(data.size() * 2);
    for (uint8_t byte : data) {
        out.push_back(digits[byte >> 4]);
        out.push_back(digits[byte & 0x0F]);
    }
    return out;
}

} // namespace pimfx
