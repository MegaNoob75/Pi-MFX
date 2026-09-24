#pragma once

#include <atomic>
#include <memory>

namespace pimfx {

/// Single-slot control-to-audio handoff. Publishing repeatedly keeps only the
/// newest object; superseded unpublished objects are destroyed by the producer.
template <typename T>
class LatestPointerMailbox {
public:
    ~LatestPointerMailbox() { delete clear(); }
    LatestPointerMailbox(const LatestPointerMailbox&) = delete;
    LatestPointerMailbox& operator=(const LatestPointerMailbox&) = delete;
    LatestPointerMailbox() = default;

    void publish(std::unique_ptr<T> value) {
        delete pending_.exchange(value.release(), std::memory_order_acq_rel);
    }
    T* take() noexcept { return pending_.exchange(nullptr, std::memory_order_acq_rel); }
    T* peek() const noexcept { return pending_.load(std::memory_order_acquire); }
    T* clear() noexcept { return pending_.exchange(nullptr, std::memory_order_acq_rel); }

private:
    std::atomic<T*> pending_{nullptr};
};

} // namespace pimfx
