#include "control/ApiRouter.h"

#include "core/Crypto.h"
#include "core/Log.h"

#include <set>
#include <unordered_set>

namespace pimfx {
namespace {

Json queryToJson(const HttpRequest& request) {
    Json json = Json::object();
    for (const auto& entry : request.query) {
        json.set(entry.first, Json(entry.second));
    }
    return json;
}

Json envelope(bool ok, const std::string& error, const Json& payload) {
    Json json = payload.isObject() ? payload : Json::object();
    json.set("ok", ok);
    if (!ok && !error.empty()) {
        json.set("error", error);
    }
    return json;
}

} // namespace

ApiRouter::ApiRouter(Engine& engine, Tone3000Client& tone3000, PluginStore& plugins, HttpServer& server)
    : engine_(engine), tone3000_(tone3000), plugins_(plugins), server_(server) {}

void ApiRouter::attach() {
    server_.setRequestHandler([this](const HttpRequest& request, HttpResponse& response) {
        return handleRequest(request, response);
    });
    server_.setSocketOpenHandler([this](uint64_t clientId) { handleSocketOpen(clientId); });
    server_.setSocketMessageHandler([this](uint64_t clientId, const std::string& message) {
        handleSocketMessage(clientId, message);
    });

    engine_.setStateListener([this](const Json& state) {
        server_.broadcast(state.dump());
    });
}

bool ApiRouter::handleRequest(const HttpRequest& request, HttpResponse& response) {
    if (request.path.rfind("/api/", 0) != 0) {
        return false; // static files
    }

    const std::string command = request.path.substr(5);

    Json payload;
    if (request.method == "GET" || request.method == "DELETE") {
        payload = queryToJson(request);
    } else if (!request.body.empty()) {
        std::string parseError;
        payload = Json::parse(request.body, &parseError);
        if (!parseError.empty()) {
            response.error(400, "the request body is not valid JSON: " + parseError);
            return true;
        }
    } else {
        payload = Json::object();
    }

    bool ok = true;
    std::string error;
    const Json result = dispatch(command, payload, ok, error);

    if (!ok && error == "unknown command") {
        response.error(404, "no such API endpoint: " + command);
        return true;
    }
    response.json(envelope(ok, error, result).dump(), ok ? 200 : 400);
    return true;
}

void ApiRouter::handleSocketOpen(uint64_t clientId) {
    // A new client gets everything it needs to render, in one burst, rather
    // than making five requests before it can draw anything.
    server_.sendTo(clientId, engine_.fullState().dump());
    server_.sendTo(clientId, visibleCatalog(false).dump());
    server_.sendTo(clientId, engine_.libraryState().dump());
    server_.sendTo(clientId, engine_.meterState().dump());
}

void ApiRouter::handleSocketMessage(uint64_t clientId, const std::string& message) {
    std::string parseError;
    const Json json = Json::parse(message, &parseError);
    if (!parseError.empty()) {
        return;
    }

    const std::string command = json["command"].asString();
    if (command.empty()) {
        return;
    }

    bool ok = true;
    std::string error;
    const Json result = dispatch(command, json["payload"], ok, error);

    Json reply = envelope(ok, error, result);
    reply.set("type", "result");
    reply.set("id", json["id"]);
    reply.set("command", command);
    server_.sendTo(clientId, reply.dump());
}

Json ApiRouter::dispatch(const std::string& command, const Json& payload,
                         bool& ok, std::string& error) {
    ok = true;
    error.clear();

    // --- reads ------------------------------------------------------------
    if (command == "state") {
        return engine_.fullState();
    }
    if (command == "catalog") {
        return visibleCatalog(payload["ports"].asBool(false));
    }
    if (command == "audio/devices") {
        return engine_.audioDevicesState();
    }
    if (command == "midi/ports") {
        return engine_.midiPortsState();
    }
    if (command == "library") {
        return engine_.libraryState();
    }
    if (command == "diagnostics") {
        return engine_.diagnosticsState();
    }
    if (command == "meters") {
        return engine_.meterState();
    }

    // --- settings ---------------------------------------------------------
    if (command == "audio/settings") {
        ok = engine_.applyAudioSettings(payload, error);
        return engine_.fullState();
    }
    if (command == "system/settings") {
        ok = engine_.applySystemSettings(payload, error);
        return engine_.diagnosticsState();
    }
    if (command == "system/update/status") {
        const Json result = plugins_.updateStatus(payload["fetch"].asBool(true), error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "system/update/install") {
        const Json result = plugins_.updateInstall(error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "ui/settings") {
        ok = engine_.applyUiSettings(payload, error);
        return Json::object();
    }
    if (command == "meters/reset") {
        engine_.resetMeters();
        return Json::object();
    }

    // --- presets and banks -------------------------------------------------
    if (command == "preset/bind") {
        ok = engine_.bindPresetControl(payload, error);
        return Json::object();
    }
    if (command == "preset/select") {
        ok = engine_.selectPreset(payload["bankId"].asString(), payload["presetId"].asString(), error);
        return Json::object();
    }
    if (command == "preset/step") {
        ok = engine_.stepPreset(payload["delta"].asInt(1), error);
        return Json::object();
    }
    if (command == "bank/step") {
        ok = engine_.stepBank(payload["delta"].asInt(1), error);
        return Json::object();
    }
    if (command == "preset/save") {
        ok = engine_.savePreset(error);
        return Json::object();
    }
    if (command == "preset/saveAs") {
        ok = engine_.savePresetAs(payload["name"].asString(), error);
        Json result = Json::object();
        if (ok) {
            result.set("presetId", engine_.fullState()["activePresetId"].asString());
        }
        return result;
    }
    if (command == "preset/create") {
        ok = engine_.createPreset(payload["name"].asString(), payload["bankId"].asString(), error);
        Json result = Json::object();
        if (ok) {
            result.set("presetId", engine_.fullState()["activePresetId"].asString());
        }
        return result;
    }
    if (command == "preset/restoreLive") {
        ok = engine_.restoreLiveFromStoredPreset(error);
        return Json::object();
    }
    if (command == "preset/rename") {
        ok = engine_.renamePreset(payload["presetId"].asString(), payload["name"].asString(), error);
        return Json::object();
    }
    if (command == "preset/delete") {
        ok = engine_.deletePreset(payload["presetId"].asString(), error);
        return Json::object();
    }
    if (command == "preset/reorder") {
        ok = engine_.reorderPreset(payload["presetId"].asString(), payload["index"].asInt(0), error);
        return Json::object();
    }
    if (command == "preset/move") {
        ok = engine_.movePresetToBank(
            payload["presetId"].asString(),
            payload["bankId"].asString(),
            payload["index"].asInt(0),
            error);
        return Json::object();
    }
    if (command == "bank/create") {
        ok = engine_.createBank(payload["name"].asString(), error);
        return Json::object();
    }
    if (command == "bank/rename") {
        ok = engine_.renameBank(payload["bankId"].asString(), payload["name"].asString(), error);
        return Json::object();
    }
    if (command == "bank/delete") {
        ok = engine_.deleteBank(payload["bankId"].asString(), error);
        return Json::object();
    }
    if (command == "bank/reorder") {
        ok = engine_.reorderBank(payload["bankId"].asString(), payload["index"].asInt(0), error);
        return Json::object();
    }
    if (command == "bank/export") {
        const Json bank = engine_.exportBank(payload["bankId"].asString());
        if (bank.isNull()) {
            ok = false;
            error = "no such bank";
            return Json::object();
        }
        Json result = Json::object();
        result.set("bank", bank);
        return result;
    }
    if (command == "bank/import") {
        ok = engine_.importBank(payload["bank"], error);
        Json result = Json::object();
        if (ok) {
            const Json banks = engine_.fullState()["banks"];
            if (banks.size() > 0) {
                result.set("bankId", banks.at(banks.size() - 1)["id"].asString());
            }
        }
        return result;
    }

    // --- chain ------------------------------------------------------------
    if (command == "chain/add") {
        std::string slotId;
        ok = engine_.addEffect(payload["uri"].asString(), payload["index"].asInt(-1), slotId, error);
        Json result = Json::object();
        result.set("slotId", slotId);
        return result;
    }
    if (command == "chain/replace") {
        std::string slotId;
        ok = engine_.replaceEffect(payload["slotId"].asString(), payload["uri"].asString(), slotId, error);
        Json result = Json::object();
        result.set("slotId", slotId);
        return result;
    }
    if (command == "chain/remove") {
        ok = engine_.removeEffect(payload["slotId"].asString(), error);
        return Json::object();
    }
    if (command == "chain/move") {
        ok = engine_.moveEffect(payload["slotId"].asString(), payload["index"].asInt(0), error);
        return Json::object();
    }
    if (command == "chain/enable") {
        ok = engine_.setEffectEnabled(payload["slotId"].asString(),
                                      payload["enabled"].asBool(true), error);
        return Json::object();
    }
    if (command == "chain/name") {
        ok = engine_.setEffectName(payload["slotId"].asString(), payload["name"].asString(), error);
        return Json::object();
    }
    if (command == "chain/control") {
        ok = engine_.setControlValue(payload["slotId"].asString(),
                                     payload["port"].asString(),
                                     payload["value"].asFloat(0.0f), error);
        return Json::object();
    }
    if (command == "chain/property") {
        ok = engine_.setEffectProperty(payload["slotId"].asString(),
                                       payload["property"].asString(),
                                       payload["path"].asString(), error);
        return Json::object();
    }
    if (command == "chain/bypass") {
        engine_.setBypassAll(payload["bypassed"].asBool(!engine_.bypassAll()));
        return Json::object();
    }

    // --- snapshots ---------------------------------------------------------
    if (command == "snapshot/capture") {
        std::string snapshotId;
        ok = engine_.captureSnapshot(
            payload["name"].asString(),
            payload["slot"].asInt(-1),
            snapshotId,
            error
        );
        Json result = Json::object();
        result.set("snapshotId", snapshotId);
        return result;
    }
    if (command == "snapshot/select") {
        ok = engine_.selectSnapshot(payload["snapshotId"].asString(), error);
        return Json::object();
    }
    if (command == "snapshot/update") {
        ok = engine_.updateSnapshot(payload["snapshotId"].asString(), error);
        return Json::object();
    }
    if (command == "snapshot/delete") {
        ok = engine_.deleteSnapshot(payload["snapshotId"].asString(), error);
        return Json::object();
    }
    if (command == "snapshot/rename") {
        ok = engine_.renameSnapshot(payload["snapshotId"].asString(), payload["name"].asString(), error);
        return Json::object();
    }
    if (command == "snapshot/color") {
        ok = engine_.colorSnapshot(payload["snapshotId"].asString(), payload["color"].asString(), error);
        return Json::object();
    }
    if (command == "snapshot/mode") {
        engine_.setSnapshotMode(payload["enabled"].asBool(false));
        return Json::object();
    }

    // --- controller --------------------------------------------------------
    if (command == "controller/config") {
        ok = engine_.applyControllerConfig(payload, error);
        return Json::object();
    }
    if (command == "controller/connect") {
        ok = engine_.connectController(payload["port"].asString(), error);
        return engine_.midiPortsState();
    }
    if (command == "controller/disconnect") {
        engine_.disconnectController();
        return Json::object();
    }
    if (command == "controller/learn") {
        engine_.beginControlLearn(payload["controlId"].asString());
        return Json::object();
    }
    if (command == "controller/cancelLearn") {
        engine_.cancelControlLearn();
        return Json::object();
    }
    if (command == "controller/press") {
        ok = engine_.pressVirtualControl(payload["controlId"].asString(),
                                         payload["pressed"].asBool(true), error);
        return Json::object();
    }
    if (command == "controller/value") {
        ok = engine_.setVirtualControlValue(payload["controlId"].asString(),
                                            payload["value"].asFloat(0.0f), error);
        return Json::object();
    }

    // --- library -----------------------------------------------------------
    if (command == "library/upload") {
        // Files arrive base64-encoded inside JSON. A NAM capture is small
        // enough that this is simpler and safer than multipart parsing.
        const std::string contents = base64Decode(payload["data"].asString());
        std::string storedPath;
        ok = engine_.storeLibraryFile(payload["kind"].asString("model"),
                                      payload["name"].asString(),
                                      contents,
                                      payload["directory"].asString(),
                                      storedPath, error);
        Json result = Json::object();
        result.set("path", storedPath);
        return result;
    }
    if (command == "library/read") {
        const Json result = engine_.readLibraryFile(payload["path"].asString(), error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "library/delete") {
        ok = engine_.deleteLibraryFile(payload["path"].asString(), error);
        return Json::object();
    }
    if (command == "library/list") {
        const Json result = engine_.libraryList(payload["kind"].asString("model"),
                                                payload["directory"].asString(), error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "library/tree") {
        const Json result = engine_.libraryTree(payload["kind"].asString("model"), error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "library/mkdir") {
        ok = engine_.libraryMkdir(payload["kind"].asString("model"),
                                  payload["directory"].asString(), error);
        return Json::object();
    }
    if (command == "library/rename") {
        ok = engine_.libraryRename(payload["path"].asString(), payload["name"].asString(), error);
        return Json::object();
    }
    if (command == "library/move") {
        ok = engine_.libraryMove(payload["path"].asString(),
                                 payload["kind"].asString("model"),
                                 payload["directory"].asString(), error);
        return Json::object();
    }

    // --- performance -------------------------------------------------------
    if (command == "tap") {
        engine_.tapTempo();
        return Json::object();
    }
    if (command == "tuner") {
        engine_.setTunerEnabled(payload["enabled"].asBool(true));
        return Json::object();
    }
    if (command.rfind("plugins/", 0) == 0) {
        return pluginsCommand(command.substr(8), payload, ok, error);
    }

    if (command == "hotspot/status" || command == "hotspot/config") {
        const Json result = command == "hotspot/config"
            ? plugins_.hotspotConfig(error)
            : plugins_.hotspotStatus(error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "hotspot/apply") {
        const Json result = plugins_.applyHotspot(payload, error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "hotspot/wifi-scan") {
        const Json result = plugins_.wifiScan(error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "hotspot/wifi-connect") {
        const Json result = plugins_.wifiConnect(payload, error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "hotspot/wifi-disconnect") {
        const Json result = plugins_.wifiDisconnect(error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }

    if (command.rfind("tone3000/", 0) == 0) {
        return tone3000Command(command.substr(9), payload, ok, error);
    }

    ok = false;
    error = "unknown command";
    return Json::object();
}

Json ApiRouter::tone3000Command(const std::string& command, const Json& payload,
                                bool& ok, std::string& error) {
    if (command == "status") {
        return tone3000_.status();
    }
    if (command == "configure") {
        tone3000_.configure(payload["publishableKey"].asString(), payload["redirectUri"].asString());
        return tone3000_.status();
    }
    if (command == "auth/start") {
        const std::string url = tone3000_.beginAuthorization(payload["prompt"].asString(),
                                                             payload, error);
        ok = !url.empty();
        Json result = Json::object();
        result.set("authorizeUrl", url);
        return result;
    }
    if (command == "auth/complete") {
        ok = tone3000_.completeAuthorization(payload["code"].asString(),
                                             payload["state"].asString(), error);
        return tone3000_.status();
    }
    if (command == "auth/logout") {
        tone3000_.logout();
        return tone3000_.status();
    }
    if (command == "tones") {
        bool cached = false;
        const Json result = tone3000_.listTones(payload["source"].asString("search"), payload, error,
                                                &cached);
        ok = error.empty();
        Json wrapper = Json::object();
        wrapper.set("result", result);
        wrapper.set("cached", cached);
        return wrapper;
    }
    if (command == "users") {
        const Json result = tone3000_.listUsers(payload, error);
        ok = error.empty();
        Json wrapper = Json::object();
        wrapper.set("result", result);
        return wrapper;
    }
    if (command == "tone") {
        const Json result = tone3000_.tone(payload["toneId"].asString(), error);
        ok = error.empty();
        Json wrapper = Json::object();
        wrapper.set("result", result);
        return wrapper;
    }
    if (command == "model") {
        const Json result = tone3000_.model(payload["modelId"].asString(), error);
        ok = error.empty();
        Json wrapper = Json::object();
        wrapper.set("result", result);
        return wrapper;
    }
    if (command == "models") {
        const Json result = tone3000_.models(payload["toneId"].asString(), payload, error);
        ok = error.empty();
        Json wrapper = Json::object();
        wrapper.set("result", result);
        return wrapper;
    }
    if (command == "download") {
        std::string url = payload["url"].asString();
        std::string name = payload["name"].asString();
        const std::string modelId = payload["modelId"].asString();
        if (!modelId.empty()) {
            std::string modelError;
            const Json model = tone3000_.model(modelId, modelError);
            if (modelError.empty()) {
                std::string fresh = model["model_url"].asString();
                if (fresh.empty()) {
                    fresh = model["url"].asString();
                }
                if (fresh.empty()) {
                    fresh = model["download_url"].asString();
                }
                if (!fresh.empty()) {
                    url = fresh;
                }
                if (name.empty()) {
                    name = model["name"].asString();
                }
            } else if (url.empty()) {
                ok = false;
                error = modelError;
                return Json::object();
            }
        }
        std::string storedPath;
        ok = tone3000_.downloadModel(url, name, payload["kind"].asString("model"),
                                     payload["directory"].asString(),
                                     storedPath, error);
        Json result = Json::object();
        result.set("path", storedPath);
        return result;
    }

    ok = false;
    error = "unknown command";
    return Json::object();
}

Json ApiRouter::visibleCatalog(bool includePorts) const {
    Json json = engine_.catalogState(includePorts);
    std::unordered_set<std::string> hidden;
    for (const Json& item : plugins_.hiddenPlugins().items()) {
        const std::string uri = item["uri"].asString().empty() ? item.asString() : item["uri"].asString();
        if (!uri.empty()) {
            hidden.insert(uri);
        }
    }
    if (hidden.empty()) {
        return json;
    }

    Json filtered = Json::array();
    std::set<std::string> categories;
    for (const Json& plugin : json["plugins"].items()) {
        if (hidden.count(plugin["uri"].asString())) {
            continue;
        }
        filtered.push(plugin);
        const std::string category = plugin["category"].asString();
        if (!category.empty()) {
            categories.insert(category);
        }
    }
    json.set("plugins", filtered);
    Json categoryArray = Json::array();
    for (const std::string& category : categories) {
        categoryArray.push(Json(category));
    }
    json.set("categories", categoryArray);
    return json;
}

void ApiRouter::publishCatalog() {
    std::string rescanError;
    engine_.catalog().rescan(rescanError);
    engine_.publishState();
    server_.broadcast(visibleCatalog(false).dump());
}

Json ApiRouter::pluginsCommand(const std::string& command, const Json& payload,
                               bool& ok, std::string& error) {
    if (command == "status") {
        Json json = plugins_.status();
        json.set("pluginCount", static_cast<int>(engine_.catalog().plugins().size()));
        json.set("lv2Available", engine_.catalog().available());
        return json;
    }
    if (command == "rescan") {
        std::string rescanError;
        ok = engine_.catalog().rescan(rescanError);
        error = rescanError;
        engine_.publishState();
        server_.broadcast(visibleCatalog(false).dump());
        return visibleCatalog(false);
    }
    if (command == "apt/search") {
        const Json result = plugins_.aptSearch(payload["query"].asString(), error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "apt/list") {
        const Json result = plugins_.aptList(error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "apt/install") {
        ok = plugins_.aptInstall(payload["package"].asString(), error);
        if (ok) {
            publishCatalog();
        }
        Json result = Json::object();
        result.set("package", payload["package"].asString());
        return result;
    }
    if (command == "apt/remove") {
        ok = plugins_.aptRemove(payload["package"].asString(), error);
        if (ok) {
            publishCatalog();
        }
        Json result = Json::object();
        result.set("package", payload["package"].asString());
        return result;
    }
    if (command == "repo/list") {
        const Json result = plugins_.repoList(error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "repo/add") {
        ok = plugins_.repoAdd(payload, error);
        if (!ok) {
            return Json::object();
        }
        Json result = plugins_.repoList(error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "repo/remove") {
        ok = plugins_.repoRemove(payload["id"].asString(), error);
        if (!ok) {
            return Json::object();
        }
        Json result = plugins_.repoList(error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "github/list") {
        const Json result = plugins_.recommended(true, error);
        ok = true;
        Json wrapper = Json::object();
        wrapper.set("recommended", result);
        return wrapper;
    }
    if (command == "github/install") {
        ok = plugins_.githubInstall(payload["id"].asString(), error);
        if (ok) {
            publishCatalog();
        }
        Json result = Json::object();
        result.set("id", payload["id"].asString());
        return result;
    }
    if (command == "github/remove") {
        ok = plugins_.githubRemove(payload["id"].asString(), error);
        if (ok) {
            publishCatalog();
        }
        Json result = Json::object();
        result.set("id", payload["id"].asString());
        return result;
    }
    if (command == "patchstorage/search") {
        const Json result = plugins_.patchstorageSearch(payload, error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "patchstorage/install") {
        ok = plugins_.patchstorageInstall(payload["patchId"].asInt64(), error);
        if (ok) {
            publishCatalog();
        }
        Json result = Json::object();
        result.set("patchId", payload["patchId"].asInt());
        result.set("bundles", plugins_.installedBundles());
        return result;
    }
    if (command == "bundle/remove") {
        ok = plugins_.bundleRemove(payload["directory"].asString(), error);
        if (ok) {
            publishCatalog();
        }
        Json result = Json::object();
        result.set("bundles", plugins_.installedBundles());
        return result;
    }
    if (command == "hide") {
        const std::string uri = payload["uri"].asString();
        std::string name = payload["name"].asString();
        if (name.empty()) {
            const auto* info = engine_.catalog().find(uri);
            if (info) {
                name = info->name;
            }
        }
        ok = plugins_.hidePlugin(uri, name, error);
        if (ok) {
            server_.broadcast(visibleCatalog(false).dump());
        }
        Json result = Json::object();
        result.set("hidden", plugins_.hiddenPlugins());
        return result;
    }
    if (command == "unhide") {
        ok = plugins_.unhidePlugin(payload["uri"].asString(), error);
        if (ok) {
            server_.broadcast(visibleCatalog(false).dump());
        }
        Json result = Json::object();
        result.set("hidden", plugins_.hiddenPlugins());
        return result;
    }

    ok = false;
    error = "unknown command";
    return Json::object();
}

} // namespace pimfx
