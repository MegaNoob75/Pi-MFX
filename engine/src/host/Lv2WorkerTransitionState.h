#pragma once

#include <cstddef>

namespace pimfx {

class Lv2WorkerTransitionState {
public:
    void begin() noexcept { active_ = true; }
    bool active() const noexcept { return active_; }

    bool canDispatch(bool hasWorker, bool workerBusy,
                     bool requestsEmpty, bool responsesEmpty) const noexcept {
        return !hasWorker || (!workerBusy && requestsEmpty && responsesEmpty);
    }

    void update(bool propertyQueueEmpty, size_t stagedPropertyCount,
                bool workerBusy, bool requestsEmpty, bool responsesEmpty) noexcept {
        if (active_ && propertyQueueEmpty && stagedPropertyCount == 0
            && !workerBusy && requestsEmpty && responsesEmpty) {
            active_ = false;
        }
    }

private:
    bool active_ = false; // audio thread only
};

} // namespace pimfx
