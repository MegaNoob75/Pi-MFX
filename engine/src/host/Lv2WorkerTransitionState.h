#pragma once

#include <atomic>
#include <cstddef>

namespace pimfx {

class Lv2WorkerTransitionState {
public:
    void begin() noexcept { active_.store(true, std::memory_order_release); }
    bool active() const noexcept { return active_.load(std::memory_order_acquire); }

    bool canDispatch(bool hasWorker, bool workerBusy,
                     bool requestsEmpty, bool responsesEmpty) const noexcept {
        return !hasWorker || (!workerBusy && requestsEmpty && responsesEmpty);
    }

    void update(bool propertyQueueEmpty, size_t stagedPropertyCount,
                bool workerBusy, bool requestsEmpty, bool responsesEmpty) noexcept {
        if (active() && propertyQueueEmpty && stagedPropertyCount == 0
            && !workerBusy && requestsEmpty && responsesEmpty) {
            active_.store(false, std::memory_order_release);
        }
    }

private:
    // Written by the processing thread, inspected by editor/state readers.
    std::atomic<bool> active_{false};
};

} // namespace pimfx
