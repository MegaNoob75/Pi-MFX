#pragma once
#include "model/Model.h"
#include <algorithm>
#include <cmath>
#include <map>
#include <set>

namespace pimfx {
// Place additions without moving existing blocks. Persist fallback positions
// before insertion changes their indices (particularly the Output tile).
inline bool placeRoutingBlock(Preset& preset, const std::string& addedId,
                              const Json& layout, std::string& error) {
    double spacing = layout["spacing"].asDouble(20);
    if (!std::isfinite(spacing)) spacing = 20;
    spacing = std::max(20.0, std::min(100.0, spacing));
    const bool snap = layout["snap"].asBool(true);
    const auto aligned = [&](double value) {
        return snap ? std::round(value / spacing) * spacing : value;
    };
    Json positions = preset.routing["positions"];
    std::vector<std::string> existing{"input"};
    for (const auto& slot : preset.chain) if (slot.id != addedId) existing.push_back(slot.id);
    existing.push_back("output");
    for (size_t i = 0; i < existing.size(); ++i) {
        const auto& id = existing[i];
        if (!positions.has(id)) positions.set(id, Json::object({
            {"x", aligned(30 + (i % 4) * 210)},
            {"y", aligned(30 + (i / 4) * 180)}}));
    }
    // Match the canvas tile footprint, plus a gap for its selection/pulse ring.
    constexpr double width = 174, height = 140, gap = 24;
    const auto free = [&](double x, double y) {
        for (const auto& id : existing) {
            const auto& p = positions[id];
            const double px = p["x"].asDouble(), py = p["y"].asDouble();
            if (x < px + width + gap && x + width + gap > px
                && y < py + height + gap && y + height + gap > py) return false;
        }
        return true;
    };
    double originX = layout["x"].asDouble(20), originY = layout["y"].asDouble(20);
    double visibleWidth = layout["width"].asDouble(800), visibleHeight = layout["height"].asDouble(420);
    if (!std::isfinite(originX) || !std::isfinite(originY)
        || !std::isfinite(visibleWidth) || !std::isfinite(visibleHeight)) {
        error = "Invalid block placement"; return false;
    }
    originX = aligned(std::max(0.0, std::min(10000.0, originX)));
    originY = aligned(std::max(0.0, std::min(10000.0, originY)));
    const double stepX = std::ceil((width + gap) / spacing) * spacing;
    const double stepY = std::ceil((height + gap) / spacing) * spacing;
    const auto scan = [&](double left, double top, double right, double bottom) {
        for (double y = top; y <= bottom && y <= 10000; y += stepY)
            for (double x = left; x <= right && x <= 10000; x += stepX)
                if (free(x, y)) {
                    positions.set(addedId, Json::object({{"x", x}, {"y", y}}));
                    preset.routing.set("positions", positions);
                    return true;
                }
        return false;
    };
    // Prefer a fully visible position; expand/search the canvas if it is full.
    if (scan(originX, originY, originX + std::max(0.0, visibleWidth - width - 24),
             originY + std::max(0.0, visibleHeight - height - 24))) return true;
    if (scan(aligned(20), aligned(20), 10000, 10000)) return true;
    error = "No free canvas space for another block";
    return false;
}

inline Json routingWithMix(const Json& routing, const Json& mix) {
    Json result = routing, edges = Json::array();
    for (const auto& edge : routing["edges"].items()) {
        Json value = edge;
        for (const auto& stored : mix.items()) {
            if (stored["from"].asString() != edge["from"].asString()
                || stored["to"].asString() != edge["to"].asString()) continue;
            for (const char* key : {"levelDb", "pan", "mute", "solo"})
                if (stored.has(key)) value.set(key, stored[key]);
        }
        edges.push(value);
    }
    result.set("edges", edges);
    return result;
}
// Control-thread validation and topological sorting. No callback allocation.
inline bool routingOrder(const Preset& preset, const Json& routing,
                         std::vector<std::string>& order, std::string& error) {
    order.clear();
    const auto keysAllowed = [](const Json& value, const std::set<std::string>& keys) {
        if (!value.isObject()) return false;
        for (const auto& member : value.members()) if (!keys.count(member.first)) return false;
        return true;
    };
    if (routing["version"].asInt() != 1 || !routing["edges"].isArray()
        || !routing["positions"].isObject() || !keysAllowed(routing, {"version", "positions", "edges"})) {
        error = "Invalid routing format"; return false;
    }
    std::map<std::string, unsigned> degree{{"input", 0}, {"output", 0}};
    for (const auto& slot : preset.chain) {
        if (slot.id.empty() || degree.count(slot.id)
            || (slot.kind != "effect" && slot.kind != "mixer")) {
            error = "Invalid or duplicate routing block"; return false;
        }
        degree[slot.id] = 0;
    }
    for (const auto& position : routing["positions"].members()) {
        if (!degree.count(position.first) || !keysAllowed(position.second, {"x", "y"})) {
            error = "Unknown block position"; return false;
        }
        for (const char* axis : {"x", "y"}) {
            const double value = position.second[axis].asDouble(-1);
            if (!position.second[axis].isNumber() || !std::isfinite(value) || value < 0 || value > 10000) {
                error = "Invalid block position"; return false;
            }
        }
    }
    std::set<std::pair<std::string, std::string>> unique;
    for (const auto& edge : routing["edges"].items()) {
        if (!keysAllowed(edge, {"from", "to", "levelDb", "pan", "mute", "solo"})
            || !edge["from"].isString() || !edge["to"].isString()
            || (edge.has("levelDb") && !edge["levelDb"].isNumber())
            || (edge.has("pan") && !edge["pan"].isNumber())
            || (edge.has("mute") && !edge["mute"].isBool())
            || (edge.has("solo") && !edge["solo"].isBool())) {
            error = "Invalid audio connection settings"; return false;
        }
        const auto from = edge["from"].asString(), to = edge["to"].asString();
        if (!degree.count(from) || !degree.count(to) || to == "input" || from == "output"
            || from == to || !unique.insert({from, to}).second) {
            error = "Invalid or duplicate audio connection"; return false;
        }
        const double gain = edge["levelDb"].asDouble(), pan = edge["pan"].asDouble();
        if (!std::isfinite(gain) || gain < -60 || gain > 12
            || !std::isfinite(pan) || pan < -1 || pan > 1) {
            error = "Invalid mixer level or pan"; return false;
        }
        ++degree[to];
    }
    std::vector<std::string> ready;
    for (const auto& entry : degree) if (!entry.second) ready.push_back(entry.first);
    for (size_t i = 0; i < ready.size(); ++i) {
        const auto id = ready[i];
        order.push_back(id);
        for (const auto& edge : routing["edges"].items()) {
            if (edge["from"].asString() == id && --degree[edge["to"].asString()] == 0)
                ready.push_back(edge["to"].asString());
        }
    }
    if (order.size() != degree.size()) { error = "Feedback loops are not supported"; return false; }
    return true;
}
inline bool routingMixValid(const Preset& preset, const Json& mix, std::string& error) {
    if (!mix.isArray()) { error = "Invalid snapshot mixer settings"; return false; }
    std::set<std::pair<std::string, std::string>> seen;
    for (const auto& value : mix.items()) {
        if (!value.isObject()) { error = "Invalid snapshot mixer settings"; return false; }
        for (const auto& member : value.members())
            if (member.first != "from" && member.first != "to" && member.first != "levelDb"
                && member.first != "pan" && member.first != "mute" && member.first != "solo") {
                error = "Invalid snapshot mixer setting"; return false;
            }
        const auto pair = std::make_pair(value["from"].asString(), value["to"].asString());
        bool exists = false;
        for (const auto& edge : preset.routing["edges"].items())
            if (edge["from"].asString() == pair.first && edge["to"].asString() == pair.second) exists = true;
        if (!exists || !seen.insert(pair).second) {
            error = "Snapshot references an unknown or duplicate connection"; return false;
        }
    }
    std::vector<std::string> order;
    return routingOrder(preset, routingWithMix(preset.routing, mix), order, error);
}
inline void pruneRoutingSnapshots(Preset& preset) {
    for (auto& snapshot : preset.snapshots) {
        Json slots = snapshot.slots;
        for (const auto& member : snapshot.slots.members())
            if (!preset.findSlot(member.first)) slots.remove(member.first);
        snapshot.slots = std::move(slots);
        Json mix = Json::array();
        for (const auto& value : snapshot.routingMix.items())
            for (const auto& edge : preset.routing["edges"].items())
                if (value["from"].asString() == edge["from"].asString()
                    && value["to"].asString() == edge["to"].asString()) { mix.push(value); break; }
        snapshot.routingMix = std::move(mix);
    }
}
} // namespace pimfx
