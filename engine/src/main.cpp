#include "Engine.h"
#include "control/ApiRouter.h"
#include "control/HttpServer.h"
#include "community/CommunityCatalog.h"
#include "core/Log.h"
#include "core/Paths.h"
#include "library/PluginStore.h"
#include "library/Tone3000.h"

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <thread>

namespace {

std::atomic<bool> g_shouldExit{false};

void onSignal(int) {
    // Only a flag: the main loop does the shutdown, because closing an audio
    // device from a signal handler is not something to attempt.
    g_shouldExit.store(true);
}

void printUsage() {
    std::printf(
        "Pi-MFX engine %s\n"
        "\n"
        "Usage: pimfx [options]\n"
        "\n"
        "  --port <n>          HTTP port for the UI and API (default 8080)\n"
        "  --data-root <path>  Where settings, banks, models and IRs live\n"
        "  --web-root <path>   Directory containing the built UI\n"
        "  --verbose           Log debug detail\n"
        "  --list-devices      Print audio devices and exit\n"
        "  --version           Print the version and exit\n"
        "  --help              This text\n",
        PIMFX_VERSION);
}

} // namespace

int main(int argc, char** argv) {
    using namespace pimfx;

    uint16_t port = 8080;
    std::string dataRoot;
    std::string webRoot;
    bool listDevices = false;

    for (int i = 1; i < argc; ++i) {
        const std::string argument = argv[i];
        const bool hasValue = i + 1 < argc;

        if (argument == "--help" || argument == "-h") {
            printUsage();
            return 0;
        }
        if (argument == "--version") {
            std::printf("%s\n", PIMFX_VERSION);
            return 0;
        }
        if (argument == "--verbose") {
            logSetLevel(LogLevel::Debug);
        } else if (argument == "--list-devices") {
            listDevices = true;
        } else if (argument == "--port" && hasValue) {
            port = static_cast<uint16_t>(std::strtoul(argv[++i], nullptr, 10));
        } else if (argument == "--data-root" && hasValue) {
            dataRoot = argv[++i];
        } else if (argument == "--web-root" && hasValue) {
            webRoot = argv[++i];
        } else {
            std::fprintf(stderr, "unknown option: %s\n", argument.c_str());
            printUsage();
            return 2;
        }
    }

    std::signal(SIGINT, onSignal);
    std::signal(SIGTERM, onSignal);
#if !defined(_WIN32)
    // A browser closing a connection mid-write must not take the service down.
    std::signal(SIGPIPE, SIG_IGN);
#endif

    Paths paths = Paths::resolve(dataRoot);
    if (!webRoot.empty()) {
        paths.webRoot = webRoot;
    }

    if (listDevices) {
        const std::unique_ptr<AudioBackend> backend = createAudioBackend();
        for (const AudioDeviceInfo& device : backend->enumerateDevices()) {
            std::printf("%-16s %-32s %s%s in:%u out:%u%s\n",
                        device.id.c_str(),
                        device.name.c_str(),
                        device.driver.c_str(),
                        device.isHat ? " (HAT)" : "",
                        device.maxInputChannels,
                        device.maxOutputChannels,
                        device.duplex ? " duplex" : "");
        }
        return 0;
    }

    logInfo("Pi-MFX " PIMFX_VERSION " starting");
    logInfo("data root: " + paths.dataRoot);

    Engine engine(paths);
    std::string error;
    if (!engine.start(error)) {
        logError("engine failed to start: " + error);
        return 1;
    }

    Tone3000Client tone3000(paths);
    PluginStore plugins(paths);
    CommunityCatalog community(paths);
    HttpServer server;
    ApiRouter router(engine, tone3000, plugins, community, server);
    router.attach();

    if (!server.start(port, paths.webRoot, error)) {
        logError("web server failed to start: " + error);
        engine.stop();
        return 1;
    }

    logInfo("ready: open http://<this-pi>:" + std::to_string(port) + " from any browser on the network");

    while (!g_shouldExit.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }

    logInfo("shutting down");
    server.stop();
    engine.stop();
    return 0;
}
