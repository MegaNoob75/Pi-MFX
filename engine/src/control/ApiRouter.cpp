#include "control/ApiRouter.h"

#include "core/Crypto.h"
#include "core/Log.h"
#include "community/CommunityPresetPackage.h"

#include <set>
#include <array>
#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <filesystem>
#include <atomic>
#include <mutex>
#include <thread>
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

bool sameOrInsidePath(const std::string& candidate, const std::string& target) {
    std::error_code candidateError;
    std::error_code targetError;
    const auto candidatePath = std::filesystem::weakly_canonical(candidate, candidateError);
    const auto targetPath = std::filesystem::weakly_canonical(target, targetError);
    if (candidateError || targetError) return false;
    if (candidatePath == targetPath) return true;
    auto candidateIt = candidatePath.begin();
    for (auto targetIt = targetPath.begin(); targetIt != targetPath.end(); ++targetIt, ++candidateIt) {
        if (candidateIt == candidatePath.end() || *candidateIt != *targetIt) return false;
    }
    return true;
}

bool jsonReferencesLibraryTarget(const Json& value, Storage& storage,
                                 const std::vector<std::string>& targets) {
    if (value.isString()) {
        const std::string resolved = storage.resolveLibraryFile(value.asString());
        if (resolved.empty()) return false;
        return std::any_of(targets.begin(), targets.end(), [&](const std::string& target) {
            return sameOrInsidePath(resolved, target);
        });
    }
    if (value.isArray()) {
        for (const Json& child : value.items()) {
            if (jsonReferencesLibraryTarget(child, storage, targets)) return true;
        }
    } else if (value.isObject()) {
        for (const Json::Member& child : value.members()) {
            if (jsonReferencesLibraryTarget(child.second, storage, targets)) return true;
        }
    }
    return false;
}

std::array<int, 3> versionParts(const std::string& value) {
    std::array<int, 3> out{0, 0, 0};
    size_t start = 0;
    for (size_t i = 0; i < out.size(); ++i) {
        const size_t end = value.find('.', start);
        try { out[i] = std::stoi(value.substr(start, end - start)); } catch (...) { return {0, 0, 0}; }
        if (end == std::string::npos) break;
        start = end + 1;
    }
    return out;
}

std::string currentArchitecture() {
#if defined(__aarch64__) || defined(_M_ARM64)
    return "aarch64";
#elif defined(__arm__) || defined(_M_ARM)
    return "armv7";
#elif defined(__x86_64__) || defined(_M_X64)
    return "x86_64";
#else
    return "unknown";
#endif
}

std::string normalizedCatalogName(std::string value) {
    value.erase(value.begin(), std::find_if(value.begin(), value.end(), [](unsigned char c) {
        return !std::isspace(c);
    }));
    value.erase(std::find_if(value.rbegin(), value.rend(), [](unsigned char c) {
        return !std::isspace(c);
    }).base(), value.end());
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return value;
}

} // namespace

ApiRouter::ApiRouter(Engine& engine, Tone3000Client& tone3000, PluginStore& plugins,
                     CommunityCatalog& community, HttpServer& server)
    : engine_(engine), tone3000_(tone3000), plugins_(plugins), community_(community), server_(server) {
    uiSession_.set("type", "uiSession");
    uiSession_.set("view", "performance");
    uiSession_.set("menuOpen", false);
    uiSession_.set("performancePicker", "");
}

ApiRouter::~ApiRouter() {
    for (auto& thread : toneDownloadThreads_) {
        if (thread.joinable()) thread.join();
    }
}

void ApiRouter::attach() {
    server_.setRequestHandler([this](const HttpRequest& request, HttpResponse& response) {
        return handleRequest(request, response);
    });
    server_.setSocketOpenHandler([this](uint64_t clientId) { handleSocketOpen(clientId); });
    server_.setSocketMessageHandler([this](uint64_t clientId, const std::string& message) {
        handleSocketMessage(clientId, message);
    });
    server_.setSocketCloseHandler([this](uint64_t clientId) { handleSocketClose(clientId); });

    engine_.setStateListener([this](const Json& state) {
        if (state["type"].asString() == "uiNav") {
            const uint64_t clientId = uiNavClient_.load(std::memory_order_acquire);
            if (clientId != 0) {
                server_.sendTo(clientId, state.dump());
            }
            return;
        }
        server_.broadcast(state.dump());
    });
}

bool ApiRouter::handleRequest(const HttpRequest& request, HttpResponse& response) {
    if (request.path.rfind("/api/", 0) != 0) {
        return false; // static files
    }

    const std::string command = request.path.substr(5);
    if (command == "drums/library/import" && request.method == "POST") {
        Json result = Json::object(); std::string error;
        const bool ok = engine_.drumLibraryImport(urlDecode(request.header("x-pimfx-relative")), request.body, result, error);
        response.json(envelope(ok, error, result).dump(), ok ? 200 : 400); return true;
    }
    if (command == "drums/library/audio" && request.method == "GET") {
        std::string error, bytes;
        if (!engine_.drumLibraryRead(request.queryValue("relative"), bytes, error)) response.error(400, error);
        else { response.status = 200; response.contentType = "audio/wav"; response.body = std::move(bytes); }
        return true;
    }

    // Media is uploaded as its original binary representation. JSON/base64
    // remains appropriate for small control payloads, but would inflate and
    // duplicate backing-track files in memory.
    if (command == "backing/import"
        && request.method == "POST"
        && request.header("content-type").find("application/octet-stream") != std::string::npos) {
        std::string error;
        const bool ok = engine_.backingImport(urlDecode(request.header("x-pimfx-filename")), request.body, error);
        response.json(envelope(ok, error, engine_.backingState()).dump(), ok ? 200 : 400);
        return true;
    }
    if (command == "drums/sample/import"
        && request.method == "POST"
        && request.header("content-type").find("application/octet-stream") != std::string::npos) {
        std::string error;
        const std::string voiceText = request.header("x-pimfx-drum-voice");
        char* end = nullptr;
        const long voice = std::strtol(voiceText.c_str(), &end, 10);
        const bool validVoice = !voiceText.empty() && end && *end == '\0' && voice >= 0;
        const bool ok = validVoice && engine_.drumImport(static_cast<unsigned>(voice),
            urlDecode(request.header("x-pimfx-filename")), request.body, error);
        if (!validVoice) error = "invalid drum voice";
        response.json(envelope(ok, error, engine_.drumState()).dump(), ok ? 200 : 400);
        return true;
    }
    if (command == "looper/export" && request.method == "GET") {
        std::string contents;
        std::string name;
        std::string error;
        if (!engine_.looperExport(request.queryValue("name"), contents, name, error)) {
            response.error(400, error);
        } else {
            response.status = 200;
            response.contentType = "audio/wav";
            response.body = std::move(contents);
            response.extraHeaders.emplace_back("Content-Disposition", "attachment; filename=\"" + name + "\"");
        }
        return true;
    }
    if (command == "recorder/export" && request.method == "GET") {
        std::string path;
        std::string name;
        std::string error;
        if (!engine_.recorderExport(request.queryValue("kind", "mix"), request.queryValue("track"), path, name, error)) {
            response.error(400, error);
        } else {
            response.status = 200;
            response.contentType = "audio/wav";
            response.filePath = std::move(path);
            std::error_code sizeError;
            response.fileSize = std::filesystem::file_size(response.filePath, sizeError);
            if (sizeError) {
                response.error(500, "could not inspect recorder export");
                response.filePath.clear();
            }
            response.extraHeaders.emplace_back("Content-Disposition", "attachment; filename=\"" + name + "\"");
        }
        return true;
    }

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
    uint64_t noOwner = 0;
    uiNavClient_.compare_exchange_strong(noOwner, clientId, std::memory_order_acq_rel);
    // A new client gets everything it needs to render, in one burst, rather
    // than making five requests before it can draw anything.
    server_.sendTo(clientId, engine_.fullState().dump());
    server_.sendTo(clientId, visibleCatalog(false).dump());
    server_.sendTo(clientId, engine_.libraryState().dump());
    server_.sendTo(clientId, engine_.meterState().dump());
    if (engine_.settings().system.sharedTransportEnabled) {
        server_.sendTo(clientId, engine_.transportState().dump());
    }
    server_.sendTo(clientId, engine_.looperState().dump());
    {
        std::lock_guard<std::mutex> lock(uiSessionMutex_);
        server_.sendTo(clientId, uiSession_.dump());
    }
}

void ApiRouter::handleSocketClose(uint64_t clientId) {
    uint64_t closingOwner = clientId;
    uiNavClient_.compare_exchange_strong(closingOwner, 0, std::memory_order_acq_rel);
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
    if (command == "ui/focus") {
        uiNavClient_.store(clientId, std::memory_order_release);
        return;
    }
    if (command == "ui/session") {
        Json session = json["payload"];
        if (!session.isObject()) {
            return;
        }
        session.set("type", "uiSession");
        session.set("owner", static_cast<double>(clientId));
        {
            std::lock_guard<std::mutex> lock(uiSessionMutex_);
            uiSession_ = session;
        }
        uiNavClient_.store(clientId, std::memory_order_release);
        server_.broadcast(session.dump());
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
    if (command == "audio/preview") {
        engine_.previewAudioSettings(payload);
        return Json::object();
    }
    if (command == "audio/settings") {
        ok = engine_.applyAudioSettings(payload, error);
        return engine_.fullState();
    }
    if (command == "system/settings") {
        ok = engine_.applySystemSettings(payload, error);
        return engine_.diagnosticsState();
    }
    if (command == "system/update/status") {
        const Json result = plugins_.updateStatus(payload, error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "system/update/install") {
        const Json result = plugins_.updateInstall(payload, error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "system/reboot") {
        const Json result = plugins_.systemPower("reboot", error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "system/shutdown") {
        const Json result = plugins_.systemPower("shutdown", error);
        ok = error.empty();
        return result.isObject() ? result : Json::object();
    }
    if (command == "ui/settings") {
        ok = engine_.applyUiSettings(payload, error);
        return Json::object();
    }
    if (command == "controller/sessionPresets") {
        ok = engine_.applySessionPresets(payload, error);
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
    if (command == "bank/select") {
        ok = engine_.selectBank(payload["bankId"].asString(), error);
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
                                     payload["value"].asFloat(0.0f), error,
                                     payload["persist"].asBool(true));
        return Json::object();
    }
    if (command == "chain/tempo-link") {
        ok = engine_.setTempoLink(payload["slotId"].asString(),
                                  payload["port"].asString(),
                                  payload["beats"].asDouble(0.0), error);
        return Json::object();
    }
    if (command == "chain/property") {
        ok = engine_.setEffectProperty(payload["slotId"].asString(),
                                       payload["property"].asString(),
                                       payload["path"].asString(), error,
                                       payload["persist"].asBool(true));
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
        if (payload["cancel"].asBool(false)) {
            engine_.cancelVirtualHold(payload["controlId"].asString());
            return Json::object();
        }
        const std::string fire = payload["fire"].asString();
        if (fire == "tap" || fire == "hold" || fire == "double") {
            ok = engine_.fireVirtualAction(payload["controlId"].asString(), fire, error);
            return Json::object();
        }
        ok = engine_.pressVirtualControl(payload["controlId"].asString(),
                                         payload["pressed"].asBool(true), error);
        return Json::object();
    }
    if (command == "controller/value") {
        ok = engine_.setVirtualControlValue(payload["controlId"].asString(),
                                            payload["value"].asFloat(0.0f), error);
        return Json::object();
    }
    if (command == "controller/turn") {
        ok = engine_.turnVirtualEncoder(payload["controlId"].asString(),
                                        payload["delta"].asInt(1), error);
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
    if (command == "library/delete-impact") {
        std::vector<std::string> targets;
        for (const Json& item : payload["paths"].items()) {
            const std::string path = item.asString();
            if (!path.empty() && engine_.storage().isPathInLibrary(path)) targets.push_back(path);
        }
        Json affected = Json::array();
        if (!targets.empty()) {
            const Json state = engine_.fullState();
            for (const Json& bank : state["banks"].items()) {
                for (const Json& preset : bank["presets"].items()) {
                    const Json& community = preset["community"];
                    if (!community.isObject() || community.members().empty()) continue;
                    if (!jsonReferencesLibraryTarget(preset, engine_.storage(), targets)) continue;
                    Json item = Json::object();
                    item.set("bankId", bank["id"]);
                    item.set("bankName", bank["name"]);
                    item.set("bankPresetCount", static_cast<int>(bank["presets"].size()));
                    item.set("presetId", preset["id"]);
                    item.set("presetName", preset["name"]);
                    affected.push(item);
                }
            }
        }
        Json result = Json::object();
        result.set("affectedPresets", affected);
        return result;
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
    if (command == "transport/settings") {
        ok = engine_.applyTransportSettings(payload, error);
        return engine_.transportState();
    }
    if (command == "transport/play") {
        ok = engine_.transportPlay(payload["restart"].asBool(false), error);
        return engine_.transportState();
    }
    if (command == "transport/stop") {
        ok = engine_.transportStop(error);
        return engine_.transportState();
    }
    if (command == "transport/restart") {
        ok = engine_.transportRestart(error);
        return engine_.transportState();
    }
    if (command == "tap") {
        engine_.tapTempo();
        return Json::object();
    }
    if (command == "backing/import") {
        ok = false;
        error = "backing tracks must be uploaded as their original binary file";
        return engine_.backingState();
    }
    if (command == "backing/state") return engine_.backingState();
    if (command.rfind("backing/", 0) == 0) {
        ok = engine_.backingCommand(command.substr(8), payload, error);
        return engine_.backingState();
    }
    if (command == "looper/settings") {
        ok = engine_.applyLooperSettings(payload, error);
        return engine_.looperState();
    }
    if (command == "looper/state") return engine_.looperState();
    if (command.rfind("looper/", 0) == 0) {
        ok = engine_.looperCommand(command.substr(7), payload, error);
        return engine_.looperState();
    }
    if (command == "recorder/state") return engine_.recorderState();
    if (command.rfind("recorder/", 0) == 0) {
        ok = engine_.recorderCommand(command.substr(9), payload, error);
        return engine_.recorderState();
    }
    if (command == "drums/state") return engine_.drumState();
    if (command.rfind("drums/", 0) == 0) {
        ok = engine_.drumCommand(command.substr(6), payload, error);
        return engine_.drumState();
    }
    if (command == "tuner") {
        engine_.setTunerEnabled(payload["enabled"].asBool(true));
        return Json::object();
    }
    if (command == "tuner/output") {
        engine_.setTunerViewState(payload["open"].asBool(false), payload["muted"].asBool(false));
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
    if (command.rfind("community/", 0) == 0) {
        return communityCommand(command.substr(10), payload, ok, error);
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
        Json provenance = Json::object();
        for (const char* key : {"toneId", "modelId", "architecture", "toneTitle",
                                "creator", "sourceLicense"}) {
            const std::string value = payload[key].asString();
            if (!value.empty()) provenance.set(key, value);
        }
        ok = tone3000_.downloadModel(url, name, payload["kind"].asString("model"),
                                     payload["directory"].asString(),
                                     storedPath, error, std::string(), provenance);
        Json result = Json::object();
        result.set("path", storedPath);
        return result;
    }
    if (command == "download-batch") {
        const Json& items = payload["items"];
        if (!items.isArray() || items.size() == 0) {
            ok = false;
            error = "no models were selected";
            return Json::object();
        }

        struct BatchResult {
            bool ok = false;
            std::string path;
            std::string error;
            std::string name;
        };
        std::vector<BatchResult> results(items.size());
        std::atomic<size_t> next{0};
        const size_t workerCount = std::min<size_t>(3, items.size());
        std::vector<std::thread> workers;
        workers.reserve(workerCount);
        for (size_t worker = 0; worker < workerCount; ++worker) {
            workers.emplace_back([&]() {
                while (true) {
                    const size_t index = next.fetch_add(1);
                    if (index >= items.size()) break;
                    const Json& item = items.at(index);
                    BatchResult& result = results[index];
                    result.name = item["name"].asString("TONE3000 model");
                    Json provenance = Json::object();
                    for (const char* key : {"toneId", "modelId", "architecture", "toneTitle",
                                            "creator", "sourceLicense"}) {
                        const std::string value = item[key].asString();
                        if (!value.empty()) provenance.set(key, value);
                    }
                    result.ok = tone3000_.downloadModel(
                        item["url"].asString(), result.name,
                        item["kind"].asString("model"), item["directory"].asString(),
                        result.path, result.error, std::string(), provenance);
                }
            });
        }
        for (auto& worker : workers) worker.join();

        Json saved = Json::array();
        Json failed = Json::array();
        for (const BatchResult& result : results) {
            Json entry = Json::object();
            entry.set("name", result.name);
            if (result.ok) {
                entry.set("path", result.path);
                saved.push(entry);
            } else {
                entry.set("error", result.error);
                failed.push(entry);
            }
        }
        Json response = Json::object();
        response.set("saved", saved);
        response.set("failed", failed);
        response.set("concurrency", static_cast<int>(workerCount));
        return response;
    }
    if (command == "download-job/start") {
        const Json items = payload["items"];
        if (!items.isArray() || items.size() == 0) {
            ok = false; error = "no models were selected"; return Json::object();
        }
        const std::string jobId = "tone-download-" + std::to_string(nextToneDownloadJob_.fetch_add(1));
        auto job = std::make_shared<ToneDownloadJob>();
        job->files.reserve(items.size());
        for (const Json& item : items.items()) {
            ToneDownloadFile file;
            file.name = item["name"].asString("TONE3000 model");
            job->files.push_back(std::move(file));
        }
        {
            std::lock_guard<std::mutex> lock(toneDownloadJobsMutex_);
            toneDownloadJobs_[jobId] = job;
        }
        toneDownloadThreads_.emplace_back([this, job, items]() {
            std::atomic<size_t> next{0};
            const size_t workerCount = std::min<size_t>(3, items.size());
            std::vector<std::thread> workers;
            for (size_t worker = 0; worker < workerCount; ++worker) {
                workers.emplace_back([this, job, &items, &next]() {
                    while (true) {
                        const size_t index = next.fetch_add(1);
                        if (index >= items.size()) break;
                        const Json& item = items.at(index);
                        {
                            std::lock_guard<std::mutex> lock(job->mutex);
                            job->files[index].state = "downloading";
                        }
                        Json provenance = Json::object();
                        for (const char* key : {"toneId", "modelId", "architecture", "toneTitle",
                                                "creator", "sourceLicense"}) {
                            const std::string value = item[key].asString();
                            if (!value.empty()) provenance.set(key, value);
                        }
                        std::string path;
                        std::string downloadError;
                        const bool saved = tone3000_.downloadModel(
                            item["url"].asString(), item["name"].asString(),
                            item["kind"].asString("model"), item["directory"].asString(),
                            path, downloadError, std::string(), provenance);
                        {
                            std::lock_guard<std::mutex> lock(job->mutex);
                            ToneDownloadFile& file = job->files[index];
                            file.state = saved ? "saved" : "failed";
                            file.path = path;
                            file.error = downloadError;
                        }
                        job->completed.fetch_add(1);
                    }
                });
            }
            for (auto& worker : workers) worker.join();
            job->done.store(true);
        });
        Json result = Json::object();
        result.set("jobId", jobId);
        return result;
    }
    if (command == "download-job/status") {
        std::shared_ptr<ToneDownloadJob> job;
        {
            std::lock_guard<std::mutex> lock(toneDownloadJobsMutex_);
            const auto found = toneDownloadJobs_.find(payload["jobId"].asString());
            if (found != toneDownloadJobs_.end()) job = found->second;
        }
        if (!job) { ok = false; error = "download job was not found"; return Json::object(); }
        Json files = Json::array();
        {
            std::lock_guard<std::mutex> lock(job->mutex);
            for (const ToneDownloadFile& file : job->files) {
                Json item = Json::object();
                item.set("name", file.name);
                item.set("state", file.state);
                if (!file.path.empty()) item.set("path", file.path);
                if (!file.error.empty()) item.set("error", file.error);
                files.push(item);
            }
        }
        Json result = Json::object();
        result.set("files", files);
        result.set("completed", job->completed.load());
        result.set("total", static_cast<int>(job->files.size()));
        result.set("done", job->done.load());
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

Json ApiRouter::communityPlan(const Json& manifest, std::string& error) const {
    if (!CommunityPresetPackage::validate(manifest, error)) return Json::object();

    const Json library = engine_.libraryState();
    auto assetState = [&](const Json& dependency, const char* libraryKey) {
        const std::string expectedName = dependency["expectedFilename"].asString();
        const std::string expectedHash = dependency["sha256"].asString();
        for (const Json& item : library[libraryKey].items()) {
            if (fileName(item["path"].asString()) != expectedName) continue;
            std::string bytes;
            if (readFile(item["path"].asString(), bytes)
                && toHex(sha256(bytes)) == expectedHash) return std::string("installed");
            return std::string("checksum-mismatch");
        }
        return std::string("missing");
    };

    Json requirements = Json::array();
    bool complete = true;
    int changes = 0;
    for (const Json& effect : manifest["dependencies"]["effects"].items()) {
        Json item = Json::object();
        const std::string uri = effect["uri"].asString();
        const std::string catalogId = effect["catalogId"].asString();
        const bool installed = engine_.catalog().find(uri) != nullptr;
        item.set("kind", "effect"); item.set("id", uri); item.set("label", uri);
        item.set("status", installed ? "installed" : catalogId.empty() ? "manual" : "install");
        item.set("catalogId", catalogId);
        if (!installed) { ++changes; if (catalogId.empty()) complete = false; }
        requirements.push(item);
    }
    for (const Json& dependency : manifest["dependencies"]["tone3000"].items()) {
        Json item = dependency;
        const std::string kind = dependency["kind"].asString("model");
        const std::string state = assetState(dependency,
            kind == "ir" ? "impulseResponses" : kind == "aidax" ? "aidax" : "models");
        item.set("kind", "tone3000"); item.set("id", dependency["modelId"].asString());
        item.set("assetKind", kind);
        item.set("label", dependency["expectedFilename"].asString());
        item.set("status", state == "installed" ? "installed" : "download");
        if (state != "installed") ++changes;
        requirements.push(item);
    }
    for (const Json& dependency : manifest["dependencies"]["irs"].items()) {
        Json item = dependency;
        const std::string state = assetState(dependency, "impulseResponses");
        const bool supported = dependency["provider"].asString() == "tone3000";
        item.set("kind", "ir"); item.set("id", dependency["sourceId"].asString());
        item.set("label", dependency["expectedFilename"].asString());
        item.set("status", state == "installed" ? "installed" : supported ? "download" : "manual");
        if (state != "installed") { ++changes; if (!supported) complete = false; }
        requirements.push(item);
    }
    for (const Json& dependency : manifest["dependencies"]["localAssets"].items()) {
        Json item = dependency;
        const std::string kind = dependency["kind"].asString();
        const std::string state = assetState(dependency,
            kind == "ir" ? "impulseResponses" : kind == "aidax" ? "aidax" : "models");
        item.set("id", dependency["expectedFilename"].asString());
        item.set("label", dependency["expectedFilename"].asString());
        item.set("status", state == "installed" ? "installed" : "manual");
        if (state != "installed") { ++changes; complete = false; }
        requirements.push(item);
    }

    Json plan = Json::object();
    plan.set("manifest", manifest);
    plan.set("manifestSha256", CommunityPresetPackage::checksum(manifest));
    plan.set("name", manifest["name"].asString());
    plan.set("author", manifest["author"].asString());
    plan.set("license", manifest["license"].asString());
    plan.set("requirements", requirements);
    plan.set("changes", changes);
    plan.set("complete", complete);
    plan.set("importsToCommunityBank", true);
    plan.set("overwritesUserData", false);
    const Json& compatibility = manifest["compatibility"];
    const auto current = versionParts(PIMFX_VERSION);
    const auto minimum = versionParts(compatibility["minimumPiMfxVersion"].asString());
    const std::string maximumText = compatibility["maximumPiMfxVersion"].asString();
    const bool versionCompatible = current >= minimum
        && (maximumText.empty() || current <= versionParts(maximumText));
    bool architectureCompatible = true;
    if (compatibility["architectures"].isArray() && compatibility["architectures"].size() != 0) {
        architectureCompatible = false;
        for (const Json& architecture : compatibility["architectures"].items()) {
            if (architecture.asString() == currentArchitecture()) architectureCompatible = true;
        }
    }
    plan.set("compatible", versionCompatible && architectureCompatible);
    if (!versionCompatible) plan.set("compatibilityError", "this preset does not support Pi-MFX " PIMFX_VERSION);
    else if (!architectureCompatible) plan.set("compatibilityError", "this preset does not support " + currentArchitecture());
    return plan;
}

Json ApiRouter::communityCommand(const std::string& command, const Json& payload,
                                 bool& ok, std::string& error) {
#if !defined(PIMFX_ENABLE_COMMUNITY_CATALOG)
    (void)command; (void)payload;
    ok = false; error = "community catalog is disabled in this build";
    return Json::object();
#else
    if (command == "status") return community_.status();
    if (command == "catalog") {
        Json catalog = community_.index(payload["refresh"].asBool(false), error);
        ok = error.empty();
        return catalog;
    }
    if (command == "preset") {
        Json manifest = community_.preset(payload["id"].asString(), payload["refresh"].asBool(false), error);
        ok = error.empty();
        return manifest;
    }
    if (command == "share/manifest") {
        Preset preset;
        if (!engine_.exportPresetForCommunity(payload["bankId"].asString(),
                payload["presetId"].asString(), preset, error)) { ok = false; return Json::object(); }
        Json manifest = CommunityPresetPackage::create(preset, engine_.storagePaths(), payload, error);
        ok = error.empty();
        Json result = Json::object();
        if (ok) {
            if (manifest["dependencies"]["localAssets"].size() != 0) {
                ok = false;
                error = "every NAM and IR must be downloaded from TONE3000 before this preset can be shared";
                return Json::object();
            }
            Json catalog = community_.index(true, error);
            if (!error.empty()) { ok = false; return Json::object(); }
            const std::string nameKey = normalizedCatalogName(manifest["name"].asString());
            const std::string fingerprint = CommunityPresetPackage::contentFingerprint(manifest);
            for (const Json& entry : catalog["presets"].items()) {
                if (normalizedCatalogName(entry["name"].asString()) == nameKey) {
                    ok = false; error = "a community preset already uses that name"; return Json::object();
                }
                if (entry["contentSha256"].asString() == fingerprint) {
                    ok = false; error = "that exact preset is already in the community catalog"; return Json::object();
                }
            }
            result.set("manifest", manifest);
            result.set("sha256", CommunityPresetPackage::checksum(manifest));
            result.set("contentSha256", fingerprint);
        }
        return result;
    }
    if (command == "share/submit") {
        Json status = community_.status();
        ok = status["submissionAvailable"].asBool(false);
        if (!ok) error = status["submissionMessage"].asString();
        return status;
    }
    if (command == "install/plan") {
        Json manifest = payload["manifest"];
        if (!manifest.isObject()) manifest = community_.preset(payload["id"].asString(), false, error);
        if (!error.empty()) { ok = false; return Json::object(); }
        Json plan = communityPlan(manifest, error);
        ok = error.empty();
        if (!ok) return Json::object();
        if (!plan["compatible"].asBool(false)) return plan;
        const std::string token = randomToken(24);
        {
            std::lock_guard<std::mutex> lock(communityMutex_);
            pendingCommunityManifest_ = manifest;
            pendingCommunityToken_ = token;
        }
        plan.set("planToken", token);
        return plan;
    }
    if (command == "install/cancel") {
        std::lock_guard<std::mutex> lock(communityMutex_);
        pendingCommunityManifest_ = Json();
        pendingCommunityToken_.clear();
        return Json::object();
    }
    if (command == "uninstall") {
        int removed = 0;
        ok = engine_.uninstallCommunityPreset(payload["id"].asString(), removed, error);
        Json result = Json::object();
        result.set("removed", removed);
        return result;
    }
    if (command == "install/confirm") {
        Json manifest;
        {
            std::lock_guard<std::mutex> lock(communityMutex_);
            if (pendingCommunityToken_.empty() || payload["planToken"].asString() != pendingCommunityToken_) {
                ok = false; error = "that installation plan expired; review it again"; return Json::object();
            }
            manifest = pendingCommunityManifest_;
            pendingCommunityManifest_ = Json();
            pendingCommunityToken_.clear();
        }

        Json unresolved = Json::array();
        bool catalogChanged = false;
        for (const Json& effect : manifest["dependencies"]["effects"].items()) {
            if (engine_.catalog().find(effect["uri"].asString())) continue;
            const std::string catalogId = effect["catalogId"].asString();
            std::string installError;
            if (catalogId.empty() || !plugins_.githubInstall(catalogId, installError)) {
                Json item = effect; item.set("reason", installError.empty() ? "locate or install this effect" : installError);
                unresolved.push(item);
            } else {
                catalogChanged = true;
            }
        }
        if (catalogChanged) {
            std::string scanError;
            engine_.catalog().rescan(scanError);
            if (!scanError.empty()) logWarn("community plugin rescan: " + scanError);
        }
        for (const Json& effect : manifest["dependencies"]["effects"].items()) {
            if (engine_.catalog().find(effect["uri"].asString())) continue;
            bool alreadyReported = false;
            for (const Json& item : unresolved.items()) {
                if (item["uri"].asString() == effect["uri"].asString()) alreadyReported = true;
            }
            if (!alreadyReported) {
                Json item = effect;
                item.set("reason", "the approved plugin was installed but its required LV2 URI is still unavailable");
                unresolved.push(item);
            }
        }

        auto downloadToneAsset = [&](const Json& dependency, const std::string& id, const std::string& kind) {
            auto downloadUrl = [](const Json& model) {
                std::string url = model["model_url"].asString();
                if (url.empty()) url = model["download_url"].asString();
                if (url.empty()) url = model["url"].asString();
                return url;
            };
            std::string modelError;
            Json model = tone3000_.model(id, modelError);
            if (model["data"].isArray() && model["data"].size() != 0) model = model["data"].at(0);
            if (!modelError.empty() || !model.isObject() || downloadUrl(model).empty()) {
                modelError.clear();
                Json query = Json::object();
                query.set("page_size", 100);
                const std::string architecture = dependency["architecture"].asString();
                if (!architecture.empty()) query.set("architecture", architecture);
                const Json response = tone3000_.models(dependency["toneId"].asString(), query, modelError);
                const Json& candidates = response["data"].isArray() ? response["data"] : response;
                model = Json();
                for (const Json& candidate : candidates.items()) {
                    if (candidate["id"].asString() == id) { model = candidate; break; }
                }
            }
            if (modelError.empty() && !model.isObject()) modelError = "the referenced TONE3000 model is no longer available";
            const std::string url = downloadUrl(model);
            std::string stored;
            if (!modelError.empty() || url.empty() || !tone3000_.downloadModel(
                    url, dependency["expectedFilename"].asString(), kind, "Community",
                    stored, modelError, dependency["sha256"].asString(), dependency)) {
                Json item = dependency;
                item.set("reason", modelError.empty() ? "the provider did not return a download" : modelError);
                unresolved.push(item);
            }
        };
        const Json currentPlan = communityPlan(manifest, error);
        if (!error.empty()) { ok = false; return Json::object(); }
        for (const Json& requirement : currentPlan["requirements"].items()) {
            if (requirement["status"].asString() == "installed") continue;
            if (requirement["kind"].asString() == "tone3000") {
                downloadToneAsset(requirement, requirement["modelId"].asString(), requirement["assetKind"].asString("model"));
            } else if (requirement["kind"].asString() == "ir"
                       && requirement["provider"].asString() == "tone3000") {
                downloadToneAsset(requirement, requirement["sourceId"].asString(), "ir");
            } else if (requirement["kind"].asString() != "effect") {
                Json item = requirement; item.set("reason", "locate this asset in the Pi-MFX library");
                unresolved.push(item);
            }
        }

        const bool incomplete = unresolved.size() != 0;
        std::string bankId;
        ok = engine_.importCommunityPreset(manifest, incomplete, bankId, error);
        Json result = Json::object();
        result.set("bankId", bankId);
        result.set("incomplete", incomplete);
        result.set("unresolved", unresolved);
        return result;
    }
    ok = false; error = "unknown command";
    return Json::object();
#endif
}

} // namespace pimfx
