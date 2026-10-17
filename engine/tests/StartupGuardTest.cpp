#include "core/StartupGuard.h"
#include <chrono>
#include <iostream>
#include <stdexcept>

using namespace pimfx;

static void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

int main() {
    const auto root = std::filesystem::temp_directory_path() / ("pimfx-startup-guard-"
        + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    try {
        std::string error;
        bool recovery = true;
        {
            StartupGuard first(root.string());
            require(first.arm(recovery, error), error.c_str());
            require(!recovery, "first startup unexpectedly entered recovery");
            // Simulate a crash: destroy the guard without finishing shutdown.
        }
        StartupGuard afterCrash(root.string());
        require(afterCrash.arm(recovery, error), error.c_str());
        require(recovery, "unclean shutdown was not detected");
        require(afterCrash.finish(), "clean shutdown did not remove marker");
        StartupGuard afterClean(root.string());
        require(afterClean.arm(recovery, error), error.c_str());
        require(!recovery, "clean restart unexpectedly entered recovery");
        require(afterClean.finish(), "cannot clear marker after clean restart");

        // A marker that cannot be created must prevent plugin startup.
        const auto blocked = root / "regular-file";
        require(writeFileAtomic(blocked.string(), "not a directory"), "cannot create failure fixture");
        StartupGuard unavailable(blocked.string());
        require(!unavailable.arm(recovery, error), "invalid data root was accepted");
        std::filesystem::remove_all(root);
        std::cout << "Startup guard: crash recovery, clean restart and failure checks passed\n";
        return 0;
    } catch (const std::exception& failure) {
        std::cerr << failure.what() << '\n';
        std::error_code ignored;
        std::filesystem::remove_all(root, ignored);
        return 1;
    }
}
