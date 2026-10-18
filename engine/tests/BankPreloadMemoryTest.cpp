#include "core/PreloadMemory.h"

#include <cassert>
#include <iostream>

using pimfx::PreloadMemory;

int main() {
    constexpr int64_t MiB = PreloadMemory::MiB;
    // Scale to the actual Pi rather than assuming the development machine's RAM.
    const PreloadMemory small{1024 * MiB, 650 * MiB, 120 * MiB};
    const PreloadMemory medium{2048 * MiB, 1500 * MiB, 180 * MiB};
    const PreloadMemory large{8192 * MiB, 7000 * MiB, 250 * MiB};
    assert(small.budget() == 138 * MiB);
    assert(medium.budget() == 988 * MiB);
    assert(large.budget() == 4096 * MiB);
    assert(small.canLoad(0, 100 * MiB, small.budget()));
    assert(!small.canLoad(0, 200 * MiB, small.budget()));
    assert(large.canLoad(0, 2048 * MiB, large.budget()));
    // Other applications taking memory must override the startup ceiling.
    const PreloadMemory pressure{large.total, large.reserve() + 100 * MiB, large.resident};
    assert(!pressure.canLoad(0, 200 * MiB, large.budget()));
    assert(!large.canLoad(large.budget() - 50 * MiB, 100 * MiB, large.budget()));
    assert(!large.canLoad(large.budget() + 1, MiB, large.budget()));
    assert(!large.canLoad(0, 0, large.budget()));
    const PreloadMemory unavailable{};
    assert(unavailable.budget() == 0);
    assert(!unavailable.canLoad(0, MiB, large.budget()));
    const PreloadMemory exhausted{1024 * MiB, 256 * MiB, 120 * MiB};
    assert(exhausted.budget() == 0);
    std::cout << "Bank preload memory policy tests passed\n";
}
