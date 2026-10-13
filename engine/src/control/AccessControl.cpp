#include "control/AccessControl.h"
#include "control/HttpServer.h"
#include "core/Crypto.h"
#include "core/Json.h"
#include "core/Paths.h"

#include <filesystem>
#include <fstream>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/rand.h>

namespace pimfx {
namespace {
constexpr int kIterations = 600000;
// Browsers cap persistent cookies; refresh on use without expiring the server token.
constexpr int64_t kCookieSeconds = 400LL * 24 * 60 * 60;
const char* kCookie = "pimfx_access=";

std::string passwordHash(const std::string& password, const std::string& salt) {
    unsigned char digest[32];
    if (PKCS5_PBKDF2_HMAC(password.data(), static_cast<int>(password.size()),
        reinterpret_cast<const unsigned char*>(salt.data()), static_cast<int>(salt.size()),
        kIterations, EVP_sha256(), sizeof(digest), digest) != 1) return {};
    return base64Encode(digest, sizeof(digest));
}

bool sameOrigin(const HttpRequest& request) {
    const auto origin = request.header("origin");
    if (!origin.empty() && origin != "http://" + request.header("host")) return false;
    if (request.header("sec-fetch-site") == "cross-site") {
        // TONE3000 returns to the app through a top-level GET navigation.
        // Only the app document may enter this way; API/access/WS requests
        // still require a same-origin caller and remote sessions remain required.
        return request.method == "GET" && request.path == "/"
            && request.header("sec-fetch-mode") == "navigate"
            && request.header("sec-fetch-dest") == "document";
    }
    return true;
}

const char* kLoginPage = R"HTML(<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pi-MFX access</title><style>
body{background:#15151b;color:#eee;font:18px system-ui;display:grid;place-items:center;min-height:100vh;margin:0}
main{width:min(360px,85vw)}input,button{box-sizing:border-box;width:100%;padding:14px;margin:8px 0;font:inherit;border-radius:8px}
button{background:#6b51cb;color:white;border:0}p{line-height:1.5}#message{color:#ffb7b7}
</style><main><h1>Pi-MFX</h1><p>Enter the Pi-MFX password to connect.</p>
<form><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required maxlength="128">
<div id="confirm-row" hidden><label for="confirm">Confirm password</label><input id="confirm" type="password" autocomplete="new-password" maxlength="128"></div>
<button disabled>UNLOCK</button></form><p id="message" role="status"></p>
<p id="help">You can change your password under Settings → System after signing in.</p></main>
<script>let setup=false;const button=document.querySelector('button');
async function send(action,password){const r=await fetch('/access/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});const j=await r.json();if(!r.ok)throw Error(j.error||'Could not unlock');}
fetch('/access/status').then(r=>r.json()).then(j=>{setup=j.setupAllowed;button.disabled=!j.enabled&&!setup;
if(setup){document.querySelector('main>p').textContent='Create your Pi-MFX password (4–128 characters).';document.querySelector('#confirm-row').hidden=false;document.querySelector('#confirm').required=true;document.querySelector('#password').minLength=4;document.querySelector('#password').autocomplete='new-password';button.textContent='SET PASSWORD';document.querySelector('#help').textContent='Set up on your own network or the Pi hotspot. The first person to finish setup sets the password.';}
else if(!j.enabled)document.querySelector('#message').textContent='Password settings could not be read. Recover them on the Pi or through SSH.';}).catch(()=>{document.querySelector('#message').textContent='Could not contact Pi-MFX. Reload to try again.';});
document.querySelector('form').onsubmit=async e=>{e.preventDefault();button.disabled=true;
try{const password=document.querySelector('#password').value;if(setup){if(password!==document.querySelector('#confirm').value)throw Error('Passwords do not match.');await send('password',password);setup=false;}await send('login',password);location.replace('/');}
catch(e){document.querySelector('#message').textContent=e.message;}finally{button.disabled=false;}};</script></html>)HTML";
}

void AccessControl::load(const std::string& file) {
    file_ = file;
    salt_.clear();
    hash_.clear();
    sessions_.clear();
    std::error_code fileError;
    firstSetup_ = !std::filesystem::exists(file, fileError) && !fileError;
    std::string text;
    if (!readFile(file, text)) return;
    const Json stored = Json::parse(text);
    // Invalid or unreadable credentials never unlock remote access.
    if (stored["version"].asInt() != 1 || stored["iterations"].asInt() != kIterations) return;
    const auto salt = stored["salt"].asString();
    const auto hash = stored["hash"].asString();
    if (base64Decode(salt).size() == 32 && base64Decode(hash).size() == 32) {
        salt_ = salt;
        hash_ = hash;
        for (const auto& session : stored["sessions"].items()) {
            const auto key = session["tokenHash"].asString();
            if (key.size() == 64 && sessions_.size() < 32)
                sessions_[key] = 0;
        }
    }
}

bool AccessControl::trustedLocal(const HttpRequest& request) {
    if (!request.local || !sameOrigin(request)) return false;
    const auto host = request.header("host");
    // Do not trust forwarded headers, ?kiosk=1, or DNS names resolving to loopback.
    return host == "localhost" || host.rfind("localhost:", 0) == 0
        || host == "127.0.0.1" || host.rfind("127.0.0.1:", 0) == 0;
}

std::string AccessControl::sessionToken(const HttpRequest& request) {
    const auto cookies = request.header("cookie");
    size_t start = 0;
    while (start < cookies.size()) {
        while (start < cookies.size() && cookies[start] == ' ') ++start;
        const size_t end = cookies.find(';', start);
        const auto cookie = cookies.substr(start, end == std::string::npos ? end : end - start);
        if (cookie.rfind(kCookie, 0) == 0) return cookie.substr(std::char_traits<char>::length(kCookie));
        if (end == std::string::npos) break;
        start = end + 1;
    }
    return {};
}

bool AccessControl::sessionValid(const std::string& token, bool local) const {
    if (local) return true;
    if (token.size() != 43) return false;
    const auto found = sessions_.find(toHex(sha256(token)));
    return !hash_.empty() && found != sessions_.end();
}

bool AccessControl::authorized(const HttpRequest& request) const {
    return sameOrigin(request) && sessionValid(sessionToken(request), trustedLocal(request));
}

bool AccessControl::verify(const std::string& password) const {
    if (hash_.empty() || password.size() > 128) return false;
    const auto computed = passwordHash(password, base64Decode(salt_));
    return computed.size() == hash_.size()
        && CRYPTO_memcmp(computed.data(), hash_.data(), hash_.size()) == 0;
}

bool AccessControl::save(const std::string& salt, const std::string& hash,
                         const std::map<std::string, int64_t>& sessions) const {
    if (file_.empty() || !makeDirectories(parentPath(file_))) return false;
    Json records = Json::array();
    for (const auto& session : sessions) {
        records.push(Json::object({{"tokenHash", session.first}}));
    }
    const auto temporary = file_ + ".tmp";
    { std::ofstream create(temporary, std::ios::binary | std::ios::trunc); }
    std::error_code permissionError;
    std::filesystem::permissions(temporary, std::filesystem::perms::owner_read
        | std::filesystem::perms::owner_write, std::filesystem::perm_options::replace, permissionError);
    return !permissionError && writeFileAtomic(file_, Json::object({{"version", 1},
        {"iterations", kIterations}, {"salt", salt}, {"hash", hash}, {"sessions", records}}).dump());
}

bool AccessControl::handle(const HttpRequest& request, HttpResponse& response) {
    const bool allowed = authorized(request);
    const bool accessRoute = request.path.rfind("/access/", 0) == 0;
    if (allowed && !trustedLocal(request) && (!accessRoute || request.path == "/access/status")) {
        response.extraHeaders.emplace_back("Set-Cookie", "pimfx_access=" + sessionToken(request)
            + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + std::to_string(kCookieSeconds));
    }
    if (!accessRoute && allowed) return false;
    response.extraHeaders.emplace_back("Cache-Control", "no-store");
    response.extraHeaders.emplace_back("X-Frame-Options", "DENY");
    response.extraHeaders.emplace_back("Referrer-Policy", "no-referrer");
    if (!sameOrigin(request)) {
        response.error(403, "Cross-origin access is not allowed.");
        return true;
    }
    if (request.path == "/access/status" && request.method == "GET") {
        response.json(Json::object({{"ok", true}, {"enabled", !hash_.empty()},
            {"local", trustedLocal(request)}, {"authenticated", allowed}, {"setupAllowed", firstSetup_}}).dump());
        return true;
    }
    if (request.path == "/access/logout" && request.method == "POST") {
        auto next = sessions_;
        const auto token = sessionToken(request);
        if (!token.empty() && next.erase(toHex(sha256(token)))) {
            if (!save(salt_, hash_, next)) {
                response.error(500, "Could not forget this browser. Please try again.");
                return true;
            }
            sessions_ = std::move(next);
        }
        response.extraHeaders.emplace_back("Set-Cookie", "pimfx_access=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
        response.json("{\"ok\":true}");
        return true;
    }
    if ((request.path == "/access/login" || request.path == "/access/password")
        && request.method == "POST") {
        if (request.header("content-type").find("application/json") != 0 || request.body.size() > 2048) {
            response.error(400, "Invalid access request.");
            return true;
        }
        const Json body = Json::parse(request.body);
        if (request.path == "/access/password") {
            if (!trustedLocal(request) && !firstSetup_) {
                if (!allowed) {
                    response.error(403, "Sign in before changing the password.");
                    return true;
                }
                if (std::chrono::steady_clock::now() < nextAttempt_) {
                    response.error(429, "Please wait before trying again.");
                    return true;
                }
                if (!verify(body["currentPassword"].asString())) {
                    ++failures_;
                    nextAttempt_ = std::chrono::steady_clock::now() + std::chrono::seconds(failures_ >= 5 ? 30 : 1);
                    response.error(403, "Current password is incorrect.");
                    return true;
                }
            }
            const auto password = body["password"].asString();
            if (password.size() < 4 || password.size() > 128) {
                response.error(400, "Use a password of 4 to 128 characters.");
                return true;
            }
            unsigned char random[32];
            if (RAND_bytes(random, sizeof(random)) != 1) {
                response.error(500, "Could not generate secure credentials.");
                return true;
            }
            const std::string salt(reinterpret_cast<char*>(random), sizeof(random));
            const auto hash = passwordHash(password, salt);
            if (hash.empty() || !save(base64Encode(salt), hash, {})) {
                response.error(500, "Could not save the access password.");
                return true;
            }
            salt_ = base64Encode(salt);
            hash_ = hash;
            firstSetup_ = false;
            sessions_.clear();
            failures_ = 0;
            nextAttempt_ = {};
            response.json(Json::object({{"ok", true}, {"enabled", true},
                {"local", trustedLocal(request)}}).dump());
            return true;
        }
        const auto now = std::chrono::steady_clock::now();
        if (now < nextAttempt_) {
            const auto seconds = std::chrono::duration_cast<std::chrono::seconds>(nextAttempt_ - now).count() + 1;
            response.extraHeaders.emplace_back("Retry-After", std::to_string(seconds));
            response.error(429, "Please wait before trying again.");
            return true;
        }
        if (!verify(body["password"].asString())) {
            ++failures_;
            nextAttempt_ = std::chrono::steady_clock::now() + std::chrono::seconds(failures_ >= 5 ? 30 : 1);
            response.error(401, hash_.empty() ? "Set up your Pi-MFX password first." : "Incorrect password.");
            return true;
        }
        failures_ = 0;
        nextAttempt_ = {};
        auto next = sessions_;
        if (next.size() >= 32) {
            response.error(409, "Too many remembered browsers. Lock an unused browser before adding another.");
            return true;
        }
        unsigned char random[32];
        if (RAND_bytes(random, sizeof(random)) != 1) {
            response.error(500, "Could not create a session.");
            return true;
        }
        const auto token = base64UrlEncode(random, sizeof(random));
        next[toHex(sha256(token))] = 0;
        if (!save(salt_, hash_, next)) {
            response.error(500, "Could not remember this browser. Please try again.");
            return true;
        }
        sessions_ = std::move(next);
        response.extraHeaders.emplace_back("Set-Cookie", "pimfx_access=" + token
            + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + std::to_string(kCookieSeconds));
        response.json("{\"ok\":true}");
        return true;
    }
    if (!allowed && request.method == "GET" && request.path.rfind("/api/", 0) != 0
        && request.path != "/ws" && !accessRoute) {
        response.status = 401;
        response.contentType = "text/html; charset=utf-8";
        response.body = kLoginPage;
    } else {
        response.error(allowed ? 404 : 401, allowed ? "Unknown access request." : "Pi-MFX password required.");
    }
    return true;
}
} // namespace pimfx
