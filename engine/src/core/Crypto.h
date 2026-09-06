#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace pimfx {

/// SHA-1 of `data`, returned as 20 raw bytes.
///
/// Used for the WebSocket handshake, which the RFC defines in terms of SHA-1.
/// It is not used anywhere that needs a secure digest.
std::vector<uint8_t> sha1(const std::string& data);

/// SHA-256 of `data`, returned as 32 raw bytes. Used for the TONE3000 OAuth
/// PKCE code challenge, which requires S256.
std::vector<uint8_t> sha256(const std::string& data);

std::string base64Encode(const uint8_t* data, size_t length);
std::string base64Encode(const std::string& data);
std::string base64Decode(const std::string& text);

/// Base64url without padding, as required for PKCE verifiers and challenges.
std::string base64UrlEncode(const uint8_t* data, size_t length);

/// Cryptographically random bytes from the platform generator.
std::vector<uint8_t> randomBytes(size_t count);

/// A random URL-safe token, used for PKCE verifiers, OAuth state, and the
/// session tokens handed to browser clients.
std::string randomToken(size_t bytes = 32);

/// Lowercase hex of `data`. Used for content addressing downloaded models.
std::string toHex(const std::vector<uint8_t>& data);

} // namespace pimfx
