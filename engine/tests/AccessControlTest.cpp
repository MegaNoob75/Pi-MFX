#include "control/AccessControl.h"
#include "control/HttpServer.h"
#include "core/Crypto.h"
#include "core/Json.h"
#include "core/Paths.h"

#include <cassert>
#include <filesystem>

using namespace pimfx;

namespace {
HttpRequest request(const std::string& path, bool local = false) {
    HttpRequest result;
    result.method = "GET";
    result.path = path;
    result.local = local;
    result.headers["host"] = local ? "127.0.0.1:8080" : "pi-mfx.local:8080";
    return result;
}

HttpResponse call(AccessControl& access, HttpRequest request) {
    HttpResponse response;
    assert(access.handle(request, response));
    return response;
}

HttpRequest passwordRequest(const std::string& password, bool local) {
    auto result = request(local ? "/access/password" : "/access/login", local);
    result.method = "POST";
    result.headers["content-type"] = "application/json";
    result.headers["origin"] = "http://" + result.headers["host"];
    result.body = Json::object({{"password", password}}).dump();
    return result;
}

std::string loginCookie(const HttpResponse& response) {
    for (const auto& header : response.extraHeaders) {
        if (header.first == "Set-Cookie") return header.second.substr(0, header.second.find(';'));
    }
    return {};
}
}

int main() {
    const auto root = std::filesystem::temp_directory_path() / ("pimfx-access-test-" + randomToken(12));
    const auto path = (root / "access.json").string();
    AccessControl access;
    access.load(path);

    // Unconfigured devices are locked remotely, including assets and WebSockets.
    assert(call(access, request("/api/state")).status == 401);
    assert(call(access, request("/ws")).status == 401);
    assert(call(access, request("/")).body.find("UNLOCK") != std::string::npos);
    assert(!access.authorized(request("/api/state")));
    assert(access.authorized(request("/api/state", true)));

    auto forged = request("/api/state");
    forged.query["kiosk"] = "1";
    forged.headers["x-forwarded-for"] = "127.0.0.1";
    assert(!access.authorized(forged));
    auto rebound = request("/api/state", true);
    rebound.headers["host"] = "attacker.example:8080";
    assert(!access.authorized(rebound));
    auto crossOrigin = request("/api/state", true);
    crossOrigin.headers["origin"] = "http://attacker.example";
    assert(call(access, crossOrigin).status == 403);

    const std::string password = "1234";
    auto remoteSetup = passwordRequest(password, false);
    remoteSetup.path = "/access/password";
    assert(call(access, remoteSetup).status == 200);
    // First-use setup cannot be reused to replace a configured password.
    assert(call(access, remoteSetup).status == 403);
    assert(call(access, passwordRequest("123", true)).status == 400);
    assert(call(access, passwordRequest(password, true)).status == 200);
    std::string stored;
    assert(readFile(path, stored));
    const Json credentials = Json::parse(stored);
    assert(!credentials.has("password"));
    assert(credentials["hash"].asString() != password);
    assert(credentials["iterations"].asInt() == 600000);
    assert(!credentials["hash"].asString().empty());
    AccessControl damaged;
    assert(writeFileAtomic(path, "invalid password configuration"));
    damaged.load(path);
    assert(call(damaged, remoteSetup).status == 403);
    assert(!Json::parse(call(damaged, request("/access/status")).body)["setupAllowed"].asBool());
    assert(writeFileAtomic(path, stored));

    auto loggedIn = call(access, passwordRequest(password, false));
    assert(loggedIn.status == 200);
    const auto cookie = loginCookie(loggedIn);
    assert(!cookie.empty());
    bool laxCookie = false;
    for (const auto& header : loggedIn.extraHeaders) {
        if (header.first == "Set-Cookie" && header.second.find("SameSite=Lax") != std::string::npos)
            laxCookie = true;
    }
    assert(laxCookie);
    // Hosted TONE3000 navigation returns to the app without locking the browser.
    auto callback = request("/");
    callback.headers["sec-fetch-site"] = "cross-site";
    callback.headers["sec-fetch-mode"] = "navigate";
    callback.headers["sec-fetch-dest"] = "document";
    callback.query["code"] = "test-code";
    callback.query["state"] = "test-state";
    assert(call(access, callback).status == 401); // Remote access still needs a session.
    callback.headers["cookie"] = cookie;
    HttpResponse callbackResponse;
    assert(!access.handle(callback, callbackResponse));
    auto localCallback = callback;
    localCallback.local = true;
    localCallback.headers["host"] = "127.0.0.1:8080";
    localCallback.headers.erase("cookie");
    assert(access.authorized(localCallback));
    for (const auto& path : {"/api/state", "/access/status", "/ws"}) {
        auto blocked = callback;
        blocked.path = path;
        assert(call(access, blocked).status == 403);
    }
    auto blocked = callback;
    blocked.method = "POST";
    assert(call(access, blocked).status == 403);
    blocked = callback;
    blocked.headers["sec-fetch-dest"] = "iframe";
    assert(call(access, blocked).status == 403);
    blocked = callback;
    blocked.headers["sec-fetch-mode"] = "cors";
    assert(call(access, blocked).status == 403);
    blocked = callback;
    blocked.headers["origin"] = "http://attacker.example";
    assert(call(access, blocked).status == 403);
    auto authenticated = request("/api/state");
    authenticated.headers["cookie"] = cookie;
    assert(access.authorized(authenticated));
    AccessControl remembered;
    remembered.load(path);
    assert(remembered.authorized(authenticated));
    std::string rememberedFile;
    assert(readFile(path, rememberedFile));
    assert(rememberedFile.find(AccessControl::sessionToken(authenticated)) == std::string::npos);
    const auto savedSessions = Json::parse(rememberedFile)["sessions"];
    assert(savedSessions.size() == 1);
    assert(!savedSessions.at(0).has("expires"));
    HttpResponse passthrough;
    assert(!access.handle(authenticated, passthrough));
    authenticated.path = "/ws";
    assert(access.authorized(authenticated));
    authenticated.headers["origin"] = "http://attacker.example";
    assert(!access.authorized(authenticated));
    authenticated.headers.erase("origin");

    // Saving a new password revokes existing remote WebSocket/session credentials.
    auto remoteChange = remoteSetup;
    remoteChange.headers["cookie"] = cookie;
    remoteChange.body = Json::object({{"password", "Updated test password 456!"},
        {"currentPassword", password}}).dump();
    auto missingCurrent = remoteChange;
    missingCurrent.body = Json::object({{"password", "Changed without current password"}}).dump();
    // An authenticated session alone is insufficient to replace credentials.
    AccessControl isolated;
    isolated.load(path);
    const auto isolatedLogin = call(isolated, passwordRequest(password, false));
    missingCurrent.headers["cookie"] = loginCookie(isolatedLogin);
    assert(call(isolated, missingCurrent).status == 403);
    assert(call(access, remoteChange).status == 200);
    assert(!access.authorized(authenticated));
    assert(access.authorized(request("/api/state", true)));

    // Password changes revoke remembered browsers across restarts too.
    AccessControl restarted;
    restarted.load(path);
    assert(!restarted.authorized(authenticated));
    const auto newLogin = call(restarted, passwordRequest("Updated test password 456!", false));
    assert(newLogin.status == 200);
    authenticated.headers["cookie"] = loginCookie(newLogin);
    assert(restarted.authorized(authenticated));
    authenticated.path = "/access/logout";
    authenticated.method = "POST";
    assert(call(restarted, authenticated).status == 200);
    assert(!restarted.authorized(authenticated));
    AccessControl afterLogout;
    afterLogout.load(path);
    assert(!afterLogout.authorized(authenticated));

    assert(call(restarted, passwordRequest("Incorrect password", false)).status == 401);
    assert(call(restarted, passwordRequest("Incorrect password", false)).status == 429);
    std::filesystem::remove_all(root);
    return 0;
}
