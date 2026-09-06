#pragma once

#include <atomic>
#include <cstddef>
#include <vector>

namespace pimfx {

/// A single-producer single-consumer queue with a fixed capacity.
///
/// This is how the control thread talks to the audio thread. Both ends are
/// wait-free: `push` never blocks the UI and `pop` never blocks the audio
/// callback. Capacity is rounded up to a power of two so the index wrap is a
/// mask rather than a modulo.
///
/// `T` must be trivially copyable and must not own heap memory, because the
/// audio thread may be the one that overwrites a slot. Pass ownership of
/// anything larger by pointer, and free it on the control thread.
template <typename T>
class SpscQueue {
public:
    explicit SpscQueue(size_t capacity = 1024) {
        size_t size = 2;
        while (size < capacity) {
            size <<= 1;
        }
        slots_.resize(size);
        mask_ = size - 1;
    }

    bool push(const T& value) {
        const size_t head = head_.load(std::memory_order_relaxed);
        const size_t next = (head + 1) & mask_;
        if (next == tail_.load(std::memory_order_acquire)) {
            return false; // full
        }
        slots_[head] = value;
        head_.store(next, std::memory_order_release);
        return true;
    }

    bool pop(T& out) {
        const size_t tail = tail_.load(std::memory_order_relaxed);
        if (tail == head_.load(std::memory_order_acquire)) {
            return false; // empty
        }
        out = slots_[tail];
        tail_.store((tail + 1) & mask_, std::memory_order_release);
        return true;
    }

    bool empty() const {
        return head_.load(std::memory_order_acquire) == tail_.load(std::memory_order_acquire);
    }

    size_t capacity() const { return mask_; }

private:
    std::vector<T> slots_;
    size_t mask_ = 0;
    std::atomic<size_t> head_{0};
    std::atomic<size_t> tail_{0};
};

} // namespace pimfx
