#include "host/Lv2Host.h"
#include "transport/MusicalTransport.h"

#include "core/Log.h"
#include "core/SpscQueue.h"
#include "host/Lv2WorkerTransitionState.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <mutex>

#if defined(PIMFX_HAVE_LILV)
#include <lilv/lilv.h>
#include <lv2/atom/atom.h>
#include <lv2/atom/forge.h>
#include <lv2/atom/util.h>
#include <lv2/buf-size/buf-size.h>
#include <lv2/midi/midi.h>
#include <lv2/options/options.h>
#include <lv2/parameters/parameters.h>
#include <lv2/patch/patch.h>
#include <lv2/time/time.h>
#include <lv2/units/units.h>
#include <lv2/urid/urid.h>
#include <lv2/worker/worker.h>
#include <chrono>
#include <condition_variable>
#include <thread>
#endif

namespace pimfx {

Json PortInfo::toJson() const {
    Json json = Json::object();
    json.set("index", static_cast<int>(index));
    json.set("symbol", symbol);
    json.set("name", name);
    if (!comment.empty()) {
        json.set("comment", comment);
    }
    json.set("input", input);
    json.set("kind", audio ? "audio" : (atom ? "atom" : (cv ? "cv" : "control")));
    if (control) {
        json.set("min", minimum);
        json.set("max", maximum);
        json.set("default", defaultValue);
        json.set("toggled", toggled);
        json.set("integer", integer);
        json.set("enumerated", enumerated);
        json.set("logarithmic", logarithmic);
        json.set("sampleRate", sampleRate);
        json.set("trigger", trigger);
        json.set("notOnGui", notOnGui);
        if (rangeSteps > 0) {
            json.set("rangeSteps", static_cast<int>(rangeSteps));
        }
        json.set("meter", meter);
        if (!unit.empty()) {
            json.set("unit", unit);
        }
        if (!unitUri.empty()) {
            json.set("unitUri", unitUri);
        }
        if (!unitRender.empty()) {
            json.set("unitRender", unitRender);
        }
        json.set("tempoLinkCandidate", tempoLinkCandidate);
        if (!scalePoints.empty()) {
            Json points = Json::array();
            for (const ScalePoint& point : scalePoints) {
                points.push(Json::object({{"value", Json(point.value)}, {"label", Json(point.label)}}));
            }
            json.set("scalePoints", points);
        }
    }
    return json;
}

Json PatchProperty::toJson() const {
    Json json = Json::object();
    json.set("uri", uri);
    json.set("label", label);
    json.set("isPath", isPath);
    if (!fileTypes.empty()) {
        Json types = Json::array();
        for (const std::string& type : fileTypes) {
            types.push(Json(type));
        }
        json.set("fileTypes", types);
    }
    return json;
}

Json PluginInfo::toJson(bool includePorts) const {
    Json json = Json::object();
    json.set("uri", uri);
    json.set("name", name);
    json.set("brand", brand);
    json.set("category", className);
    json.set("author", author);
    json.set("audioInputs", static_cast<int>(audioInputs));
    json.set("audioOutputs", static_cast<int>(audioOutputs));
    json.set("midiInput", hasMidiInput);
    json.set("takesNamModel", takesNamModel);
    json.set("takesImpulseResponse", takesImpulseResponse);
    if (!comment.empty()) {
        json.set("comment", comment);
    }
    if (includePorts) {
        Json portArray = Json::array();
        for (const PortInfo& port : ports) {
            portArray.push(port.toJson());
        }
        json.set("ports", portArray);

        Json propertyArray = Json::array();
        for (const PatchProperty& property : properties) {
            propertyArray.push(property.toJson());
        }
        json.set("properties", propertyArray);
    }
    return json;
}

namespace {

std::string toLower(const std::string& text) {
    std::string out = text;
    std::transform(out.begin(), out.end(), out.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return out;
}

bool mentions(const std::string& haystack, std::initializer_list<const char*> needles) {
    const std::string lower = toLower(haystack);
    for (const char* needle : needles) {
        if (lower.find(needle) != std::string::npos) {
            return true;
        }
    }
    return false;
}

void addFileType(std::vector<std::string>& types, const std::string& extension) {
    if (extension.empty()) {
        return;
    }
    if (std::find(types.begin(), types.end(), extension) == types.end()) {
        types.push_back(extension);
    }
}

void addModFileTypes(std::vector<std::string>& types, const std::string& csv) {
    std::string token;
    for (size_t i = 0; i <= csv.size(); ++i) {
        const char c = i < csv.size() ? csv[i] : ',';
        if (c == ',' || c == ' ' || c == '\t') {
            if (!token.empty()) {
                const std::string lower = toLower(token);
                if (lower == "nam" || lower == "nammodel") {
                    addFileType(types, ".nam");
                    addFileType(types, ".aidax");
                } else if (lower == "json" || lower == "mlmodel" || lower == "mlmodels") {
                    addFileType(types, ".json");
                } else if (lower == "aidadspmodel" || lower == "aidax") {
                    addFileType(types, ".aidax");
                    addFileType(types, ".json");
                } else if (lower == "ir" || lower == "cabsim" || lower == "audio") {
                    addFileType(types, ".wav");
                    addFileType(types, ".flac");
                    addFileType(types, ".aiff");
                } else if (lower == "wav") {
                    addFileType(types, ".wav");
                } else if (lower == "flac") {
                    addFileType(types, ".flac");
                } else if (!lower.empty() && lower[0] == '.') {
                    addFileType(types, lower);
                }
                token.clear();
            }
        } else {
            token.push_back(c);
        }
    }
}

} // namespace

#if defined(PIMFX_HAVE_LILV)

namespace {

/// A single-producer single-consumer byte ring for worker messages.
///
/// The realtime thread writes work requests and reads responses; the worker
/// thread does the opposite. Each message is length-prefixed so a partial
/// message can never be read.
class ByteRing {
public:
    explicit ByteRing(size_t capacity) : buffer_(capacity) {}

    bool write(const void* data, uint32_t size) {
        if (size > buffer_.size() - sizeof(uint32_t)) {
            return false;
        }
        const size_t needed = sizeof(uint32_t) + size;
        if (available() < needed) {
            return false;
        }
        writeRaw(&size, sizeof(size));
        writeRaw(data, size);
        write_.store(pendingWrite_, std::memory_order_release);
        return true;
    }

    bool read(std::vector<uint8_t>& out) {
        const size_t read = read_.load(std::memory_order_relaxed);
        const size_t write = write_.load(std::memory_order_acquire);
        if (read == write) {
            return false;
        }
        uint32_t size = 0;
        size_t cursor = read;
        readRaw(cursor, &size, sizeof(size));
        out.resize(size);
        readRaw(cursor, out.data(), size);
        read_.store(cursor, std::memory_order_release);
        return true;
    }

    size_t maximumMessageSize() const {
        return buffer_.size() - sizeof(uint32_t) - 1;
    }

    bool empty() const {
        return read_.load(std::memory_order_acquire)
            == write_.load(std::memory_order_acquire);
    }

private:
    size_t available() const {
        const size_t read = read_.load(std::memory_order_acquire);
        const size_t write = pendingWrite_;
        const size_t used = write >= read ? write - read : buffer_.size() - read + write;
        return buffer_.size() - used - 1;
    }

    void writeRaw(const void* data, size_t size) {
        const uint8_t* bytes = static_cast<const uint8_t*>(data);
        for (size_t i = 0; i < size; ++i) {
            buffer_[pendingWrite_] = bytes[i];
            pendingWrite_ = (pendingWrite_ + 1) % buffer_.size();
        }
    }

    void readRaw(size_t& cursor, void* data, size_t size) {
        uint8_t* bytes = static_cast<uint8_t*>(data);
        for (size_t i = 0; i < size; ++i) {
            bytes[i] = buffer_[cursor];
            cursor = (cursor + 1) % buffer_.size();
        }
    }

    std::vector<uint8_t> buffer_;
    size_t pendingWrite_ = 0;
    std::atomic<size_t> write_{0};
    std::atomic<size_t> read_{0};
};

/// A property change queued from the control thread and forged into the
/// plugin's atom input on the audio thread. Fixed size so the queue itself
/// never allocates.
struct PropertyMessage {
    uint32_t propertyUrid = 0;
    char value[1024];
};

struct DeferredControlMessage {
    uint32_t portIndex = 0;
    float value = 0.0f;
};

struct MidiMessage {
    uint32_t frame;
    uint8_t size;
    uint8_t data[8];
};

} // namespace

struct Lv2Catalog::Impl {
    LilvWorld* world = nullptr;
    const LilvPlugins* plugins = nullptr;

    LilvNode* audioPort = nullptr;
    LilvNode* controlPort = nullptr;
    LilvNode* atomPort = nullptr;
    LilvNode* cvPort = nullptr;
    LilvNode* inputPort = nullptr;
    LilvNode* outputPort = nullptr;
    LilvNode* toggled = nullptr;
    LilvNode* integer = nullptr;
    LilvNode* enumeration = nullptr;
    LilvNode* logarithmic = nullptr;
    LilvNode* sampleRate = nullptr;
    LilvNode* trigger = nullptr;
    LilvNode* notOnGui = nullptr;
    LilvNode* rangeSteps = nullptr;
    LilvNode* patchWritable = nullptr;
    LilvNode* rdfsLabel = nullptr;
    LilvNode* rdfsRange = nullptr;
    LilvNode* rdfsComment = nullptr;
    LilvNode* atomPath = nullptr;
    LilvNode* atomSupports = nullptr;
    LilvNode* midiEvent = nullptr;
    LilvNode* timePosition = nullptr;
    LilvNode* unitsUnit = nullptr;
    LilvNode* unitsSymbol = nullptr;
    LilvNode* unitsRender = nullptr;
    LilvNode* fileTypeProperty = nullptr;
    LilvNode* modFileTypes = nullptr;

    ~Impl() {
        LilvNode* nodes[] = {audioPort, controlPort, atomPort, cvPort, inputPort, outputPort,
                             toggled, integer, enumeration, logarithmic, sampleRate,
                             trigger, notOnGui, rangeSteps, patchWritable,
                             rdfsLabel, rdfsRange, rdfsComment, atomPath, atomSupports,
                             midiEvent, timePosition, unitsUnit, unitsSymbol, unitsRender,
                             fileTypeProperty, modFileTypes};
        for (LilvNode* node : nodes) {
            if (node) {
                lilv_node_free(node);
            }
        }
        if (world) {
            lilv_world_free(world);
        }
    }
};

void applyLv2SearchPath(const std::string& userDir) {
#if !defined(_WIN32)
    std::string path;
    const auto append = [&](const std::string& dir) {
        if (dir.empty()) {
            return;
        }
        if (!path.empty()) {
            path += ':';
        }
        path += dir;
    };
    append(userDir);
    if (const char* home = std::getenv("HOME")) {
        append(std::string(home) + "/.lv2");
    }
    append("/usr/local/lib/lv2");
    append("/usr/local/lib/aarch64-linux-gnu/lv2");
    append("/usr/lib/lv2");
    append("/usr/lib/aarch64-linux-gnu/lv2");
    setenv("LV2_PATH", path.c_str(), 1);
#else
    (void)userDir;
#endif
}

void loadUserBundles(LilvWorld* world, const std::string& directory) {
    if (!world || directory.empty()) {
        return;
    }
    std::error_code ec;
    if (!std::filesystem::is_directory(directory, ec)) {
        return;
    }
    for (const std::filesystem::directory_entry& entry : std::filesystem::directory_iterator(directory, ec)) {
        if (!entry.is_directory(ec)) {
            continue;
        }
        std::string path = entry.path().string();
        const std::string name = entry.path().filename().string();
        if (name.size() < 4 || name.compare(name.size() - 4, 4, ".lv2") != 0) {
            continue;
        }
        if (path.empty() || (path.back() != '/' && path.back() != '\\')) {
            path += '/';
        }
        LilvNode* uri = lilv_new_file_uri(world, nullptr, path.c_str());
        if (!uri) {
            continue;
        }
        lilv_world_load_bundle(world, uri);
        lilv_node_free(uri);
    }
}

Lv2Catalog::Lv2Catalog() : impl_(std::make_unique<Impl>()) {}
Lv2Catalog::~Lv2Catalog() = default;

bool Lv2Catalog::available() const { return impl_ && impl_->world != nullptr; }

bool Lv2Catalog::rescan(std::string& error) {
    Impl& impl = *impl_;

    if (!impl.world) {
        impl.world = lilv_world_new();
        if (!impl.world) {
            error = "lilv could not create an LV2 world";
            return false;
        }
        impl.audioPort = lilv_new_uri(impl.world, LV2_CORE__AudioPort);
        impl.controlPort = lilv_new_uri(impl.world, LV2_CORE__ControlPort);
        impl.atomPort = lilv_new_uri(impl.world, LV2_ATOM__AtomPort);
        impl.cvPort = lilv_new_uri(impl.world, LV2_CORE__CVPort);
        impl.inputPort = lilv_new_uri(impl.world, LV2_CORE__InputPort);
        impl.outputPort = lilv_new_uri(impl.world, LV2_CORE__OutputPort);
        impl.toggled = lilv_new_uri(impl.world, LV2_CORE__toggled);
        impl.integer = lilv_new_uri(impl.world, LV2_CORE__integer);
        impl.enumeration = lilv_new_uri(impl.world, LV2_CORE__enumeration);
        impl.logarithmic = lilv_new_uri(impl.world, "http://lv2plug.in/ns/ext/port-props#logarithmic");
        impl.sampleRate = lilv_new_uri(impl.world, LV2_CORE__sampleRate);
        impl.trigger = lilv_new_uri(impl.world, "http://lv2plug.in/ns/ext/port-props#trigger");
        impl.notOnGui = lilv_new_uri(impl.world, "http://lv2plug.in/ns/ext/port-props#notOnGUI");
        impl.rangeSteps = lilv_new_uri(impl.world, "http://lv2plug.in/ns/ext/port-props#rangeSteps");
        impl.patchWritable = lilv_new_uri(impl.world, LV2_PATCH__writable);
        impl.rdfsLabel = lilv_new_uri(impl.world, "http://www.w3.org/2000/01/rdf-schema#label");
        impl.rdfsRange = lilv_new_uri(impl.world, "http://www.w3.org/2000/01/rdf-schema#range");
        impl.rdfsComment = lilv_new_uri(impl.world, "http://www.w3.org/2000/01/rdf-schema#comment");
        impl.atomPath = lilv_new_uri(impl.world, LV2_ATOM__Path);
        impl.atomSupports = lilv_new_uri(impl.world, LV2_ATOM__supports);
        impl.midiEvent = lilv_new_uri(impl.world, LV2_MIDI__MidiEvent);
        impl.timePosition = lilv_new_uri(impl.world, LV2_TIME__Position);
        impl.unitsUnit = lilv_new_uri(impl.world, LV2_UNITS__unit);
        impl.unitsSymbol = lilv_new_uri(impl.world, LV2_UNITS__symbol);
        impl.unitsRender = lilv_new_uri(impl.world, LV2_UNITS__render);
        impl.fileTypeProperty = lilv_new_uri(impl.world, "http://lv2plug.in/ns/ext/patch#fileType");
        impl.modFileTypes = lilv_new_uri(impl.world, "http://moddevices.com/ns/mod#fileTypes");
    }

    applyLv2SearchPath(userBundleDirectory_);
    lilv_world_load_all(impl.world);
    loadUserBundles(impl.world, userBundleDirectory_);
    impl.plugins = lilv_world_get_all_plugins(impl.world);

    std::vector<PluginInfo> discovered;
    LILV_FOREACH(plugins, iterator, impl.plugins) {
        const LilvPlugin* plugin = lilv_plugins_get(impl.plugins, iterator);

        PluginInfo info;
        info.uri = lilv_node_as_uri(lilv_plugin_get_uri(plugin));

        if (LilvNode* name = lilv_plugin_get_name(plugin)) {
            info.name = lilv_node_as_string(name);
            lilv_node_free(name);
        }
        if (LilvNode* author = lilv_plugin_get_author_name(plugin)) {
            info.author = lilv_node_as_string(author);
            lilv_node_free(author);
        }
        if (const LilvPluginClass* pluginClass = lilv_plugin_get_class(plugin)) {
            if (const LilvNode* label = lilv_plugin_class_get_label(pluginClass)) {
                info.className = lilv_node_as_string(label);
            }
        }
        if (LilvNodes* comments = lilv_plugin_get_value(plugin, impl.rdfsComment)) {
            if (const LilvNode* first = lilv_nodes_get_first(comments)) {
                info.comment = lilv_node_as_string(first);
            }
            lilv_nodes_free(comments);
        }

        const uint32_t portCount = lilv_plugin_get_num_ports(plugin);
        std::vector<float> minimums(portCount, 0.0f);
        std::vector<float> maximums(portCount, 1.0f);
        std::vector<float> defaults(portCount, 0.0f);
        lilv_plugin_get_port_ranges_float(plugin, minimums.data(), maximums.data(), defaults.data());

        for (uint32_t index = 0; index < portCount; ++index) {
            const LilvPort* port = lilv_plugin_get_port_by_index(plugin, index);

            PortInfo portInfo;
            portInfo.index = index;
            portInfo.symbol = lilv_node_as_string(lilv_port_get_symbol(plugin, port));
            if (LilvNode* label = lilv_port_get_name(plugin, port)) {
                portInfo.name = lilv_node_as_string(label);
                lilv_node_free(label);
            }
            if (LilvNodes* comments = lilv_port_get_value(plugin, port, impl.rdfsComment)) {
                if (const LilvNode* first = lilv_nodes_get_first(comments)) {
                    portInfo.comment = lilv_node_as_string(first);
                }
                lilv_nodes_free(comments);
            }
            portInfo.input = lilv_port_is_a(plugin, port, impl.inputPort);
            portInfo.audio = lilv_port_is_a(plugin, port, impl.audioPort);
            portInfo.control = lilv_port_is_a(plugin, port, impl.controlPort);
            portInfo.atom = lilv_port_is_a(plugin, port, impl.atomPort);
            portInfo.cv = lilv_port_is_a(plugin, port, impl.cvPort);

            if (portInfo.audio) {
                if (portInfo.input) {
                    ++info.audioInputs;
                } else {
                    ++info.audioOutputs;
                }
            }
            if (portInfo.atom && portInfo.input
                && lilv_port_supports_event(plugin, port, impl.midiEvent)) {
                info.hasMidiInput = true;
            }
            if (portInfo.atom && portInfo.input) {
                portInfo.supportsTimePosition = lilv_port_supports_event(plugin, port, impl.timePosition);
            }

            if (portInfo.control) {
                portInfo.minimum = std::isfinite(minimums[index]) ? minimums[index] : 0.0f;
                portInfo.maximum = std::isfinite(maximums[index]) ? maximums[index] : 1.0f;
                if (portInfo.maximum < portInfo.minimum) {
                    std::swap(portInfo.minimum, portInfo.maximum);
                }
                portInfo.defaultValue = std::isfinite(defaults[index])
                    ? std::max(portInfo.minimum, std::min(portInfo.maximum, defaults[index]))
                    : portInfo.minimum;
                if (info.uri == "http://two-play.com/plugins/toob-nam"
                    && portInfo.symbol == "calibration") {
                    // TooB publishes this control as the ambiguous "Value".
                    // Keep its documented -6 dBu starting point explicit even
                    // when an older installed bundle omits the expected default.
                    portInfo.name = "Input Calibration Level";
                    portInfo.defaultValue = std::max(portInfo.minimum,
                        std::min(portInfo.maximum, -6.0f));
                }
                portInfo.toggled = lilv_port_has_property(plugin, port, impl.toggled);
                portInfo.integer = lilv_port_has_property(plugin, port, impl.integer);
                portInfo.enumerated = lilv_port_has_property(plugin, port, impl.enumeration);
                portInfo.logarithmic = lilv_port_has_property(plugin, port, impl.logarithmic);
                portInfo.sampleRate = lilv_port_has_property(plugin, port, impl.sampleRate);
                portInfo.trigger = lilv_port_has_property(plugin, port, impl.trigger);
                portInfo.notOnGui = lilv_port_has_property(plugin, port, impl.notOnGui);
                portInfo.meter = !portInfo.input;

                if (LilvNodes* steps = lilv_port_get_value(plugin, port, impl.rangeSteps)) {
                    if (const LilvNode* first = lilv_nodes_get_first(steps);
                        first && lilv_node_is_int(first)) {
                        const int count = lilv_node_as_int(first);
                        portInfo.rangeSteps = count > 0 ? static_cast<unsigned>(count) : 0;
                    }
                    lilv_nodes_free(steps);
                }

                if (LilvNodes* units = lilv_port_get_value(plugin, port, impl.unitsUnit)) {
                    if (const LilvNode* unit = lilv_nodes_get_first(units)) {
                        if (lilv_node_is_uri(unit)) {
                            portInfo.unitUri = lilv_node_as_uri(unit);
                        }
                        if (LilvNode* symbol = lilv_world_get(impl.world, unit, impl.unitsSymbol, nullptr)) {
                            portInfo.unit = lilv_node_as_string(symbol);
                            lilv_node_free(symbol);
                        }
                        if (LilvNode* render = lilv_world_get(impl.world, unit, impl.unitsRender, nullptr)) {
                            portInfo.unitRender = lilv_node_as_string(render);
                            lilv_node_free(render);
                        }
                    }
                    lilv_nodes_free(units);
                }
                const std::string unitSymbol = toLower(portInfo.unit);
                if (portInfo.unitUri == LV2_UNITS__ms || unitSymbol == "ms") {
                    portInfo.secondsPerUnit = 0.001;
                    if (portInfo.unit.empty()) portInfo.unit = "ms";
                } else if (portInfo.unitUri == LV2_UNITS__s || unitSymbol == "s") {
                    portInfo.secondsPerUnit = 1.0;
                    if (portInfo.unit.empty()) portInfo.unit = "s";
                }

                const std::string pluginText = info.name + " " + info.className + " " + info.uri;
                const std::string portText = portInfo.name + " " + portInfo.symbol;
                portInfo.tempoLinkCandidate = portInfo.input
                    && portInfo.secondsPerUnit > 0.0
                    && mentions(pluginText, {"delay", "echo"})
                    && mentions(portText, {"delay", "time", "tap"});

                if (LilvScalePoints* points = lilv_port_get_scale_points(plugin, port)) {
                    LILV_FOREACH(scale_points, pointIterator, points) {
                        const LilvScalePoint* point = lilv_scale_points_get(points, pointIterator);
                        ScalePoint scalePoint;
                        scalePoint.value = lilv_node_as_float(lilv_scale_point_get_value(point));
                        scalePoint.label = lilv_node_as_string(lilv_scale_point_get_label(point));
                        if (std::isfinite(scalePoint.value)) {
                            portInfo.scalePoints.push_back(std::move(scalePoint));
                        }
                    }
                    lilv_scale_points_free(points);
                    std::sort(portInfo.scalePoints.begin(), portInfo.scalePoints.end(),
                              [](const ScalePoint& a, const ScalePoint& b) { return a.value < b.value; });
                }
            }

            info.ports.push_back(std::move(portInfo));
        }

        // Modern plugins take file paths through patch properties rather than
        // ports. This is how a NAM capture or an impulse response gets in.
        if (LilvNodes* writables = lilv_world_find_nodes(impl.world,
                                                        lilv_plugin_get_uri(plugin),
                                                        impl.patchWritable,
                                                        nullptr)) {
            LILV_FOREACH(nodes, propertyIterator, writables) {
                const LilvNode* propertyNode = lilv_nodes_get(writables, propertyIterator);
                PatchProperty property;
                property.uri = lilv_node_as_uri(propertyNode);

                if (LilvNode* label = lilv_world_get(impl.world, propertyNode, impl.rdfsLabel, nullptr)) {
                    property.label = lilv_node_as_string(label);
                    lilv_node_free(label);
                }
                if (LilvNode* range = lilv_world_get(impl.world, propertyNode, impl.rdfsRange, nullptr)) {
                    property.range = lilv_node_as_uri(range);
                    property.isPath = property.range == std::string(LV2_ATOM__Path);
                    lilv_node_free(range);
                }
                if (LilvNodes* types = lilv_world_find_nodes(impl.world, propertyNode,
                                                             impl.fileTypeProperty, nullptr)) {
                    LILV_FOREACH(nodes, typeIterator, types) {
                        addFileType(property.fileTypes,
                                    toLower(lilv_node_as_string(lilv_nodes_get(types, typeIterator))));
                    }
                    lilv_nodes_free(types);
                }
                if (LilvNode* modTypes = lilv_world_get(impl.world, propertyNode, impl.modFileTypes, nullptr)) {
                    addModFileTypes(property.fileTypes, lilv_node_as_string(modTypes));
                    lilv_node_free(modTypes);
                }

                if (property.label.empty()) {
                    property.label = property.uri;
                }

                if (property.isPath) {
                    // The LV2 vocabulary has no "this is an amp capture"
                    // predicate, so the kind of file is inferred from what the
                    // plugin calls the property. Wrong guesses only affect
                    // which browser button appears, never what is loaded.
                    const std::string haystack = property.uri + " " + property.label;
                    if (mentions(haystack, {"nam", "neural", "model", "capture", "profile"})) {
                        info.takesNamModel = true;
                    }
                    if (mentions(haystack, {"ir", "impulse", "cab", "convolution"})) {
                        info.takesImpulseResponse = true;
                    }
                }

                info.properties.push_back(std::move(property));
            }
            lilv_nodes_free(writables);
        }

        if (info.name.empty()) {
            info.name = info.uri;
        }
        if (info.className.empty()) {
            info.className = "Uncategorised";
        }
        discovered.push_back(std::move(info));
    }

    std::sort(discovered.begin(), discovered.end(),
              [](const PluginInfo& a, const PluginInfo& b) { return toLower(a.name) < toLower(b.name); });

    plugins_ = std::move(discovered);
    logInfo("lv2: " + std::to_string(plugins_.size()) + " plugins available");
    error.clear();
    return true;
}

struct PluginInstance::Impl {
    static constexpr size_t kWorkerRequestBufferSize = 64 * 1024;
    // Responses are normally small pointer-bearing records, but extra queue
    // headroom preserves event boundaries during rapid model changes.
    static constexpr size_t kWorkerResponseBufferSize = 256 * 1024;
    static constexpr size_t kPendingPropertyCapacity = 32;

    Lv2Catalog* catalog = nullptr;
    const LilvPlugin* plugin = nullptr;
    LilvInstance* instance = nullptr;

    unsigned sampleRate = 48000;
    unsigned maxFrames = 64;
    bool active = false;

    // Control ports. `staged` is written by whoever moves a knob and read by
    // the audio thread, which copies it into `live` (the memory the plugin
    // actually reads) once per period.
    std::vector<std::atomic<float>> staged;
    std::vector<float> live;
    std::vector<bool> isControlInput;
    std::vector<bool> isControlOutput;

    std::vector<uint32_t> audioInputPorts;
    std::vector<uint32_t> audioOutputPorts;
    std::vector<std::vector<float>> silentInputs;
    std::vector<std::vector<float>> spareOutputs;

    // Atom ports for MIDI and patch messages.
    int atomInputPort = -1;
    int atomOutputPort = -1;
    std::vector<uint8_t> atomInput;
    std::vector<uint8_t> atomOutput;
    LV2_Atom_Forge forge{};

    SpscQueue<PropertyMessage> propertyQueue{32};
    SpscQueue<DeferredControlMessage> deferredControls{2048};
    std::atomic<bool> propertyChangesHeld{false};
    // Audio-thread-owned staging. Repeated changes to the same property are
    // coalesced here while a worker transaction is active, so a NAM plugin
    // never has multiple model load/swap/free cycles in flight at once.
    std::array<PropertyMessage, kPendingPropertyCapacity> pendingProperties{};
    size_t pendingPropertyCount = 0;
    Lv2WorkerTransitionState propertyTransition;
    SpscQueue<MidiMessage> midiQueue{256};
    std::vector<std::pair<std::string, std::string>> propertyValues;
    mutable std::mutex propertyMutex;

    // Worker extension.
    const LV2_Worker_Interface* workerInterface = nullptr;
    ByteRing workRequests{kWorkerRequestBufferSize};
    ByteRing workResponses{kWorkerResponseBufferSize};
    // Reserved before activation. std::vector storage has the same fundamental
    // alignment as the previously working implementation, and resize remains
    // allocation-free because no ring message can exceed the reservation.
    std::vector<uint8_t> workerScratch;
    std::thread workerThread;
    std::mutex workerMutex;
    std::condition_variable workerSignal;
    std::atomic<bool> workerRunning{false};
    std::atomic<bool> workerBusy{false};

    LV2_URID_Map uridMap{};
    LV2_URID_Unmap uridUnmap{};
    LV2_Worker_Schedule workerSchedule{};
    LV2_Options_Option options[6]{};
    std::vector<LV2_Feature> featureStorage;
    std::vector<const LV2_Feature*> features;

    struct Urids {
        LV2_URID atomFloat = 0;
        LV2_URID atomPath = 0;
        LV2_URID atomString = 0;
        LV2_URID atomChunk = 0;
        LV2_URID atomSequence = 0;
        LV2_URID atomEventTransfer = 0;
        LV2_URID midiEvent = 0;
        LV2_URID patchSet = 0;
        LV2_URID patchProperty = 0;
        LV2_URID patchValue = 0;
        LV2_URID bufMaxBlockLength = 0;
        LV2_URID bufMinBlockLength = 0;
        LV2_URID bufNominalBlockLength = 0;
        LV2_URID bufSequenceSize = 0;
        LV2_URID paramSampleRate = 0;
        LV2_URID unitsFrame = 0;
        LV2_URID timePosition = 0;
        LV2_URID timeFrame = 0;
        LV2_URID timeSpeed = 0;
        LV2_URID timeBar = 0;
        LV2_URID timeBarBeat = 0;
        LV2_URID timeBeat = 0;
        LV2_URID timeBeatUnit = 0;
        LV2_URID timeBeatsPerBar = 0;
        LV2_URID timeBeatsPerMinute = 0;
        LV2_URID timeFramesPerSecond = 0;
    } urids;

    float sampleRateValue = 48000.0f;
    int32_t maxBlockLength = 64;
    int32_t minBlockLength = 64;
    int32_t sequenceSize = 8192;

    ~Impl() {
        stopWorker();
        if (instance) {
            if (active) {
                lilv_instance_deactivate(instance);
            }
            lilv_instance_free(instance);
        }
    }

    void stopWorker() {
        if (!workerRunning.exchange(false)) {
            return;
        }
        workerSignal.notify_all();
        if (workerThread.joinable()) {
            workerThread.join();
        }
    }

    static LV2_Worker_Status scheduleWork(LV2_Worker_Schedule_Handle handle,
                                          uint32_t size,
                                          const void* data) {
        Impl* impl = static_cast<Impl*>(handle);
        if (!impl->workRequests.write(data, size)) {
            return LV2_WORKER_ERR_NO_SPACE;
        }
        return LV2_WORKER_SUCCESS;
    }

    static LV2_Worker_Status respond(LV2_Worker_Respond_Handle handle,
                                     uint32_t size,
                                     const void* data) {
        Impl* impl = static_cast<Impl*>(handle);
        if (size > impl->workResponses.maximumMessageSize()) {
            logWarn("lv2 worker: response exceeds preallocated queue capacity ("
                    + std::to_string(size) + " bytes)");
            return LV2_WORKER_ERR_NO_SPACE;
        }
        if (!impl->workResponses.write(data, size)) {
            logWarn("lv2 worker: response queue is full; response was rejected");
            return LV2_WORKER_ERR_NO_SPACE;
        }
        return LV2_WORKER_SUCCESS;
    }

    void runCycle(const float* const* inputs, unsigned inputCount,
                  float* const* outputs, unsigned outputCount,
                  unsigned frames, const TransportBlock* transport);
};

namespace {

LV2_URID uridMapCallback(LV2_URID_Map_Handle handle, const char* uri) {
    return static_cast<UridMap*>(handle)->map(uri);
}

const char* uridUnmapCallback(LV2_URID_Unmap_Handle handle, LV2_URID urid) {
    return static_cast<UridMap*>(handle)->unmap(urid);
}

} // namespace

PluginInstance::PluginInstance() : impl_(std::make_unique<Impl>()) {}

PluginInstance::~PluginInstance() = default;

std::unique_ptr<PluginInstance> PluginInstance::create(Lv2Catalog& catalog,
                                                       const std::string& uri,
                                                       unsigned sampleRate,
                                                       unsigned maxFrames,
                                                       std::string& error) {
    if (!catalog.available()) {
        error = "no LV2 support in this build";
        return nullptr;
    }
    const PluginInfo* info = catalog.find(uri);
    if (!info) {
        error = "plugin not installed: " + uri;
        return nullptr;
    }

    Lv2Catalog::Impl& world = *catalog.impl();
    LilvNode* uriNode = lilv_new_uri(world.world, uri.c_str());
    const LilvPlugin* plugin = lilv_plugins_get_by_uri(world.plugins, uriNode);
    lilv_node_free(uriNode);
    if (!plugin) {
        error = "plugin disappeared from the LV2 world: " + uri;
        return nullptr;
    }

    std::unique_ptr<PluginInstance> self(new PluginInstance());
    Impl& impl = *self->impl_;
    self->info_ = *info;
    for (PortInfo& port : self->info_.ports) {
        if (port.control && port.sampleRate) {
            const float rate = static_cast<float>(sampleRate);
            port.minimum *= rate;
            port.maximum *= rate;
            port.defaultValue *= rate;
            for (ScalePoint& point : port.scalePoints) {
                point.value *= rate;
            }
        }
    }

    impl.catalog = &catalog;
    impl.plugin = plugin;
    impl.sampleRate = sampleRate;
    impl.maxFrames = maxFrames;
    impl.sampleRateValue = static_cast<float>(sampleRate);
    impl.maxBlockLength = static_cast<int32_t>(maxFrames);
    impl.minBlockLength = impl.maxBlockLength;

    UridMap& urids = catalog.urids();
    impl.urids.atomFloat = urids.map(LV2_ATOM__Float);
    impl.urids.atomPath = urids.map(LV2_ATOM__Path);
    impl.urids.atomString = urids.map(LV2_ATOM__String);
    impl.urids.atomChunk = urids.map(LV2_ATOM__Chunk);
    impl.urids.atomSequence = urids.map(LV2_ATOM__Sequence);
    impl.urids.atomEventTransfer = urids.map(LV2_ATOM__eventTransfer);
    impl.urids.midiEvent = urids.map(LV2_MIDI__MidiEvent);
    impl.urids.patchSet = urids.map(LV2_PATCH__Set);
    impl.urids.patchProperty = urids.map(LV2_PATCH__property);
    impl.urids.patchValue = urids.map(LV2_PATCH__value);
    impl.urids.bufMaxBlockLength = urids.map(LV2_BUF_SIZE__maxBlockLength);
    impl.urids.bufMinBlockLength = urids.map(LV2_BUF_SIZE__minBlockLength);
    impl.urids.bufNominalBlockLength = urids.map(LV2_BUF_SIZE__nominalBlockLength);
    impl.urids.bufSequenceSize = urids.map(LV2_BUF_SIZE__sequenceSize);
    impl.urids.paramSampleRate = urids.map(LV2_PARAMETERS__sampleRate);
    impl.urids.unitsFrame = urids.map("http://lv2plug.in/ns/extensions/units#frame");
    impl.urids.timePosition = urids.map(LV2_TIME__Position);
    impl.urids.timeFrame = urids.map(LV2_TIME__frame);
    impl.urids.timeSpeed = urids.map(LV2_TIME__speed);
    impl.urids.timeBar = urids.map(LV2_TIME__bar);
    impl.urids.timeBarBeat = urids.map(LV2_TIME__barBeat);
    impl.urids.timeBeat = urids.map(LV2_TIME__beat);
    impl.urids.timeBeatUnit = urids.map(LV2_TIME__beatUnit);
    impl.urids.timeBeatsPerBar = urids.map(LV2_TIME__beatsPerBar);
    impl.urids.timeBeatsPerMinute = urids.map(LV2_TIME__beatsPerMinute);
    impl.urids.timeFramesPerSecond = urids.map(LV2_TIME__framesPerSecond);

    impl.uridMap.handle = &urids;
    impl.uridMap.map = uridMapCallback;
    impl.uridUnmap.handle = &urids;
    impl.uridUnmap.unmap = uridUnmapCallback;
    impl.workerSchedule.handle = &impl;
    impl.workerSchedule.schedule_work = Impl::scheduleWork;

    impl.options[0] = {LV2_OPTIONS_INSTANCE, 0, impl.urids.bufMaxBlockLength,
                       sizeof(int32_t), urids.map(LV2_ATOM__Int), &impl.maxBlockLength};
    impl.options[1] = {LV2_OPTIONS_INSTANCE, 0, impl.urids.bufMinBlockLength,
                       sizeof(int32_t), urids.map(LV2_ATOM__Int), &impl.minBlockLength};
    impl.options[2] = {LV2_OPTIONS_INSTANCE, 0, impl.urids.bufNominalBlockLength,
                       sizeof(int32_t), urids.map(LV2_ATOM__Int), &impl.maxBlockLength};
    impl.options[3] = {LV2_OPTIONS_INSTANCE, 0, impl.urids.bufSequenceSize,
                       sizeof(int32_t), urids.map(LV2_ATOM__Int), &impl.sequenceSize};
    impl.options[4] = {LV2_OPTIONS_INSTANCE, 0, impl.urids.paramSampleRate,
                       sizeof(float), impl.urids.atomFloat, &impl.sampleRateValue};
    impl.options[5] = {LV2_OPTIONS_BLANK, 0, 0, 0, 0, nullptr};

    static LV2_Feature boundedBlockLength = {LV2_BUF_SIZE__boundedBlockLength, nullptr};
    static LV2_Feature powerOf2BlockLength = {LV2_BUF_SIZE__powerOf2BlockLength, nullptr};
    static LV2_Feature fixedBlockLength = {LV2_BUF_SIZE__fixedBlockLength, nullptr};

    impl.featureStorage = {
        LV2_Feature{LV2_URID__map, &impl.uridMap},
        LV2_Feature{LV2_URID__unmap, &impl.uridUnmap},
        LV2_Feature{LV2_WORKER__schedule, &impl.workerSchedule},
        LV2_Feature{LV2_OPTIONS__options, impl.options},
    };
    impl.features.clear();
    for (LV2_Feature& feature : impl.featureStorage) {
        impl.features.push_back(&feature);
    }
    impl.features.push_back(&boundedBlockLength);
    impl.features.push_back(&powerOf2BlockLength);
    impl.features.push_back(&fixedBlockLength);
    impl.features.push_back(nullptr);

    impl.instance = lilv_plugin_instantiate(plugin, sampleRate, impl.features.data());
    if (!impl.instance) {
        error = "plugin refused to instantiate: " + uri;
        return nullptr;
    }

    const uint32_t portCount = lilv_plugin_get_num_ports(plugin);
    impl.staged = std::vector<std::atomic<float>>(portCount);
    impl.live.assign(portCount, 0.0f);
    impl.isControlInput.assign(portCount, false);
    impl.isControlOutput.assign(portCount, false);

    for (const PortInfo& port : self->info_.ports) {
        if (port.control) {
            impl.staged[port.index].store(port.defaultValue, std::memory_order_relaxed);
            impl.live[port.index] = port.defaultValue;
            impl.isControlInput[port.index] = port.input;
            impl.isControlOutput[port.index] = !port.input;
            lilv_instance_connect_port(impl.instance, port.index, &impl.live[port.index]);
        } else if (port.audio) {
            if (port.input) {
                impl.audioInputPorts.push_back(port.index);
            } else {
                impl.audioOutputPorts.push_back(port.index);
            }
        } else if (port.atom) {
            if (port.input) {
                if (impl.atomInputPort < 0 || port.supportsTimePosition) {
                    impl.atomInputPort = static_cast<int>(port.index);
                }
            } else {
                impl.atomOutputPort = static_cast<int>(port.index);
            }
        } else if (port.cv) {
            // CV ports are connected to a silent buffer so the plugin has
            // valid memory even though Pi-MFX does not route CV.
            impl.spareOutputs.emplace_back(impl.maxFrames, 0.0f);
            lilv_instance_connect_port(impl.instance, port.index, impl.spareOutputs.back().data());
        }
    }

    impl.silentInputs.assign(impl.audioInputPorts.size(), std::vector<float>(impl.maxFrames, 0.0f));
    impl.spareOutputs.reserve(impl.spareOutputs.size() + impl.audioOutputPorts.size());
    for (size_t i = 0; i < impl.audioOutputPorts.size(); ++i) {
        impl.spareOutputs.emplace_back(impl.maxFrames, 0.0f);
    }

    if (impl.atomInputPort >= 0) {
        impl.atomInput.assign(static_cast<size_t>(impl.sequenceSize), 0);
        lilv_instance_connect_port(impl.instance, static_cast<uint32_t>(impl.atomInputPort),
                                   impl.atomInput.data());
    }
    if (impl.atomOutputPort >= 0) {
        impl.atomOutput.assign(static_cast<size_t>(impl.sequenceSize), 0);
        lilv_instance_connect_port(impl.instance, static_cast<uint32_t>(impl.atomOutputPort),
                                   impl.atomOutput.data());
    }

    lv2_atom_forge_init(&impl.forge, &impl.uridMap);

    // Plugins that do heavy loading (a NAM capture, a long impulse response)
    // do it on the worker thread so the audio thread never waits on a file.
    if (const void* extension = lilv_instance_get_extension_data(impl.instance, LV2_WORKER__interface)) {
        impl.workerInterface = static_cast<const LV2_Worker_Interface*>(extension);
        impl.workerScratch.reserve(impl.workResponses.maximumMessageSize());
        impl.workerRunning.store(true);
        Impl* raw = &impl;
        impl.workerThread = std::thread([raw]() {
            // Below the audio thread on purpose: a long load must never delay
            // the next period.
            std::vector<uint8_t> request;
            while (raw->workerRunning.load()) {
                {
                    std::unique_lock<std::mutex> lock(raw->workerMutex);
                    raw->workerSignal.wait_for(lock, std::chrono::milliseconds(20));
                }
                raw->workerBusy.store(true, std::memory_order_release);
                while (raw->workRequests.read(request)) {
                    raw->workerInterface->work(lilv_instance_get_handle(raw->instance),
                                               Impl::respond,
                                               raw,
                                               static_cast<uint32_t>(request.size()),
                                               request.data());
                }
                raw->workerBusy.store(false, std::memory_order_release);
            }
            raw->workerBusy.store(false, std::memory_order_release);
        });
    }

    lilv_instance_activate(impl.instance);
    impl.active = true;
    return self;
}

void PluginInstance::setControl(uint32_t portIndex, float value) {
    Impl& impl = *impl_;
    if (portIndex >= impl.staged.size() || !impl.isControlInput[portIndex]) {
        return;
    }
    impl.staged[portIndex].store(value, std::memory_order_relaxed);
}

bool PluginInstance::setControlDeferred(uint32_t portIndex, float value) {
    return impl_->deferredControls.push({portIndex, value});
}

float PluginInstance::control(uint32_t portIndex) const {
    const Impl& impl = *impl_;
    if (portIndex >= impl.staged.size()) {
        return 0.0f;
    }
    return impl.staged[portIndex].load(std::memory_order_relaxed);
}

float PluginInstance::readOutput(uint32_t portIndex) const {
    const Impl& impl = *impl_;
    if (portIndex >= impl.live.size()) {
        return 0.0f;
    }
    return impl.live[portIndex];
}

void PluginInstance::pushMidi(const uint8_t* data, uint32_t size, uint32_t frameOffset) {
    if (size == 0 || size > sizeof(MidiMessage::data)) {
        return;
    }
    MidiMessage message{};
    message.frame = frameOffset;
    message.size = static_cast<uint8_t>(size);
    std::memcpy(message.data, data, size);
    impl_->midiQueue.push(message);
}

bool PluginInstance::setProperty(const std::string& propertyUri,
                                 const std::string& value,
                                 std::string& error) {
    Impl& impl = *impl_;
    if (impl.atomInputPort < 0) {
        error = "this plugin has no atom input, so it cannot take a file";
        return false;
    }
    if (value.size() >= sizeof(PropertyMessage::value)) {
        error = "property or value is too long";
        return false;
    }

    PropertyMessage message{};
    message.propertyUrid = impl.uridMap.map(impl.uridMap.handle, propertyUri.c_str());
    std::memcpy(message.value, value.c_str(), value.size() + 1);
    if (!impl.propertyQueue.push(message)) {
        error = "the plugin is not keeping up with property changes";
        return false;
    }

    {
        std::lock_guard<std::mutex> lock(impl.propertyMutex);
        bool replaced = false;
        for (auto& entry : impl.propertyValues) {
            if (entry.first == propertyUri) {
                entry.second = value;
                replaced = true;
                break;
            }
        }
        if (!replaced) {
            impl.propertyValues.emplace_back(propertyUri, value);
        }
    }
    return true;
}

std::string PluginInstance::property(const std::string& propertyUri) const {
    const Impl& impl = *impl_;
    std::lock_guard<std::mutex> lock(impl.propertyMutex);
    for (const auto& entry : impl.propertyValues) {
        if (entry.first == propertyUri) {
            return entry.second;
        }
    }
    return std::string();
}

void PluginInstance::holdPropertyChanges() {
    impl_->propertyChangesHeld.store(true, std::memory_order_release);
}

void PluginInstance::releasePropertyChanges() {
    impl_->propertyChangesHeld.store(false, std::memory_order_release);
}

bool PluginInstance::propertyTransitionPending() const {
    const Impl& impl = *impl_;
    return impl.propertyChangesHeld.load(std::memory_order_acquire)
        || !impl.deferredControls.empty()
        || !impl.propertyQueue.empty()
        || impl.pendingPropertyCount != 0
        || impl.propertyTransition.active();
}

void PluginInstance::beginDeferredStateChanges() {
    impl_->propertyChangesHeld.store(true, std::memory_order_release);
}

bool PluginInstance::applyDeferredStateChanges() {
    Impl& impl = *impl_;
    bool changed = false;
    DeferredControlMessage control;
    while (impl.deferredControls.pop(control)) {
        if (control.portIndex < impl.staged.size() && impl.isControlInput[control.portIndex]) {
            impl.staged[control.portIndex].store(control.value, std::memory_order_relaxed);
            changed = true;
        }
    }
    const bool wasHeld = impl.propertyChangesHeld.exchange(false, std::memory_order_acq_rel);
    return changed || wasHeld;
}

void PluginInstance::Impl::runCycle(const float* const* inputs, unsigned inputCount,
                                    float* const* outputs, unsigned outputCount,
                                    unsigned frames, const TransportBlock* transport) {
    for (size_t i = 0; i < audioInputPorts.size(); ++i) {
        const float* source = i < inputCount ? inputs[i] : silentInputs[i].data();
        lilv_instance_connect_port(instance, audioInputPorts[i], const_cast<float*>(source));
    }
    for (size_t i = 0; i < audioOutputPorts.size(); ++i) {
        float* destination = i < outputCount ? outputs[i] : spareOutputs[i].data();
        lilv_instance_connect_port(instance, audioOutputPorts[i], destination);
    }

    if (atomInputPort >= 0) {
        lv2_atom_forge_set_buffer(&forge, atomInput.data(), atomInput.size());
        LV2_Atom_Forge_Frame sequenceFrame;
        lv2_atom_forge_sequence_head(&forge, &sequenceFrame, urids.unitsFrame);

        if (transport) {
            LV2_Atom_Forge_Frame positionFrame;
            lv2_atom_forge_frame_time(&forge, 0);
            lv2_atom_forge_object(&forge, &positionFrame, 0, urids.timePosition);
            lv2_atom_forge_key(&forge, urids.timeFrame);
            lv2_atom_forge_long(&forge, transport->frame);
            lv2_atom_forge_key(&forge, urids.timeSpeed);
            lv2_atom_forge_float(&forge, static_cast<float>(transport->speed));
            lv2_atom_forge_key(&forge, urids.timeBar);
            lv2_atom_forge_long(&forge, transport->bar);
            lv2_atom_forge_key(&forge, urids.timeBarBeat);
            lv2_atom_forge_float(&forge, static_cast<float>(transport->barBeat));
            lv2_atom_forge_key(&forge, urids.timeBeat);
            lv2_atom_forge_double(&forge, transport->beat);
            lv2_atom_forge_key(&forge, urids.timeBeatUnit);
            lv2_atom_forge_int(&forge, transport->beatUnit);
            lv2_atom_forge_key(&forge, urids.timeBeatsPerBar);
            lv2_atom_forge_float(&forge, static_cast<float>(transport->beatsPerBar));
            lv2_atom_forge_key(&forge, urids.timeBeatsPerMinute);
            lv2_atom_forge_float(&forge, static_cast<float>(transport->bpm));
            lv2_atom_forge_key(&forge, urids.timeFramesPerSecond);
            lv2_atom_forge_float(&forge, static_cast<float>(transport->framesPerSecond));
            lv2_atom_forge_pop(&forge, &positionFrame);
        }

        MidiMessage midi;
        while (midiQueue.pop(midi)) {
            lv2_atom_forge_frame_time(&forge, static_cast<int64_t>(midi.frame));
            lv2_atom_forge_atom(&forge, midi.size, urids.midiEvent);
            lv2_atom_forge_write(&forge, midi.data, midi.size);
        }

        PropertyMessage property{};
        while (!propertyChangesHeld.load(std::memory_order_acquire)
               && propertyQueue.pop(property)) {
            propertyTransition.begin();
            size_t pending = 0;
            for (; pending < pendingPropertyCount; ++pending) {
                if (pendingProperties[pending].propertyUrid == property.propertyUrid) {
                    pendingProperties[pending] = property;
                    break;
                }
            }
            if (pending == pendingPropertyCount) {
                if (pendingPropertyCount < pendingProperties.size()) {
                    pendingProperties[pendingPropertyCount++] = property;
                } else {
                    // The producer queue has the same bounded capacity. This
                    // only affects a plugin exposing more than 32 distinct
                    // path properties changed during one worker transaction;
                    // retain the newest value without allocating or blocking.
                    pendingProperties.back() = property;
                }
            }
        }

        const bool workerPipelineIdle = propertyTransition.canDispatch(
            workerInterface != nullptr, workerBusy.load(std::memory_order_acquire),
            workRequests.empty(), workResponses.empty());
        if (pendingPropertyCount > 0 && workerPipelineIdle) {
            property = pendingProperties[0];
            pendingProperties[0] = pendingProperties[--pendingPropertyCount];

            LV2_Atom_Forge_Frame objectFrame;
            lv2_atom_forge_frame_time(&forge, 0);
            lv2_atom_forge_object(&forge, &objectFrame, 0, urids.patchSet);
            lv2_atom_forge_key(&forge, urids.patchProperty);
            lv2_atom_forge_urid(&forge, property.propertyUrid);
            lv2_atom_forge_key(&forge, urids.patchValue);
            lv2_atom_forge_path(&forge, property.value,
                                static_cast<uint32_t>(std::strlen(property.value) + 1));
            lv2_atom_forge_pop(&forge, &objectFrame);
        }

        lv2_atom_forge_pop(&forge, &sequenceFrame);
    }

    if (atomOutputPort >= 0) {
        LV2_Atom_Sequence* sequence = reinterpret_cast<LV2_Atom_Sequence*>(atomOutput.data());
        sequence->atom.size = static_cast<uint32_t>(atomOutput.size() - sizeof(LV2_Atom));
        sequence->atom.type = urids.atomSequence;
    }

    lilv_instance_run(instance, frames);

    if (workerInterface) {
        // Bound response handling to one transaction per block. In
        // particular, NAM's response swaps the active model and schedules the
        // previous model for destruction; draining a burst here can overlap
        // those lifetimes even though the callback itself never xruns.
        if (workResponses.read(workerScratch)) {
            if (workerInterface->work_response) {
                workerInterface->work_response(lilv_instance_get_handle(instance),
                                               static_cast<uint32_t>(workerScratch.size()),
                                               workerScratch.empty() ? nullptr : workerScratch.data());
            }
        }
        if (workerInterface->end_run) {
            workerInterface->end_run(lilv_instance_get_handle(instance));
        }
    }

    propertyTransition.update(propertyQueue.empty(), pendingPropertyCount,
                              workerBusy.load(std::memory_order_acquire),
                              workRequests.empty(), workResponses.empty());
}

void PluginInstance::process(const float* const* inputs, unsigned inputCount,
                             float* const* outputs, unsigned outputCount,
                             unsigned frames, const TransportBlock* transport) {
    Impl& impl = *impl_;
    if (!impl.instance) {
        return;
    }

    for (size_t i = 0; i < impl.live.size(); ++i) {
        if (impl.isControlInput[i]) {
            impl.live[i] = impl.staged[i].load(std::memory_order_relaxed);
        }
    }
    for (const PortInfo& port : info_.ports) {
        if (port.control && port.input && port.trigger) {
            // A trigger is visible for exactly one run. Exchange before the
            // run so a new press arriving concurrently remains queued for the
            // following block rather than being accidentally cleared.
            impl.live[port.index] = impl.staged[port.index].exchange(
                port.defaultValue, std::memory_order_acq_rel);
        }
    }

    impl.runCycle(inputs, inputCount, outputs, outputCount, frames, transport);
}

Json PluginInstance::saveState() const {
    Json state = Json::object();
    Json controls = Json::object();
    for (const PortInfo& port : info_.ports) {
        if (port.control && port.input) {
            controls.set(port.symbol, Json(port.trigger ? port.defaultValue : control(port.index)));
        }
    }
    state.set("controls", controls);

    Json properties = Json::object();
    {
        std::lock_guard<std::mutex> lock(impl_->propertyMutex);
        for (const auto& entry : impl_->propertyValues) {
            properties.set(entry.first, Json(entry.second));
        }
    }
    if (properties.size() > 0) {
        state.set("properties", properties);
    }
    return state;
}

void PluginInstance::loadState(const Json& state, bool deferControls) {
    const Json& controls = state["controls"];
    for (const PortInfo& port : info_.ports) {
        if (!port.control || !port.input) {
            continue;
        }
        if (controls.has(port.symbol)) {
            const float requested = controls[port.symbol].asFloat(port.defaultValue);
            float value = std::max(port.minimum, std::min(port.maximum, requested));
            if (port.trigger) {
                value = port.defaultValue;
            } else if (port.toggled) {
                value = requested > 0.0f
                    ? std::max(port.minimum, std::min(port.maximum, 1.0f))
                    : std::max(port.minimum, std::min(port.maximum, 0.0f));
            } else if (port.enumerated && !port.scalePoints.empty()) {
                const ScalePoint* closest = &port.scalePoints.front();
                for (const ScalePoint& point : port.scalePoints) {
                    if (std::abs(point.value - requested) < std::abs(closest->value - requested)) {
                        closest = &point;
                    }
                }
                value = closest->value;
            } else if (port.integer) {
                value = std::round(value);
            }
            value = std::max(port.minimum, std::min(port.maximum, value));
            if (deferControls) {
                // A state has far fewer controls than this bounded queue. If a
                // malformed plugin exceeds it, retain silence rather than
                // applying part of the snapshot before the fade completes.
                setControlDeferred(port.index, value);
            } else {
                setControl(port.index, value);
            }
        }
    }

    const Json& properties = state["properties"];
    std::string error;
    for (const Json::Member& member : properties.members()) {
        setProperty(member.first, member.second.asString(), error);
    }
}

#else // no lilv: the control plane still runs, and the UI explains why

struct Lv2Catalog::Impl {};

Lv2Catalog::Lv2Catalog() : impl_(std::make_unique<Impl>()) {}
Lv2Catalog::~Lv2Catalog() = default;

bool Lv2Catalog::available() const { return false; }

bool Lv2Catalog::rescan(std::string& error) {
    plugins_.clear();
    error = "this build has no LV2 support (lilv was not found at build time)";
    return false;
}

struct PluginInstance::Impl {};

PluginInstance::PluginInstance() : impl_(std::make_unique<Impl>()) {}
PluginInstance::~PluginInstance() = default;

std::unique_ptr<PluginInstance> PluginInstance::create(Lv2Catalog&, const std::string&,
                                                       unsigned, unsigned, std::string& error) {
    error = "this build has no LV2 support";
    return nullptr;
}

void PluginInstance::setControl(uint32_t, float) {}
bool PluginInstance::setControlDeferred(uint32_t, float) { return false; }
float PluginInstance::control(uint32_t) const { return 0.0f; }
float PluginInstance::readOutput(uint32_t) const { return 0.0f; }
void PluginInstance::pushMidi(const uint8_t*, uint32_t, uint32_t) {}
bool PluginInstance::setProperty(const std::string&, const std::string&, std::string& error) {
    error = "this build has no LV2 support";
    return false;
}
std::string PluginInstance::property(const std::string&) const { return std::string(); }
void PluginInstance::holdPropertyChanges() {}
void PluginInstance::releasePropertyChanges() {}
bool PluginInstance::propertyTransitionPending() const { return false; }
void PluginInstance::beginDeferredStateChanges() {}
bool PluginInstance::applyDeferredStateChanges() { return false; }
void PluginInstance::process(const float* const*, unsigned, float* const*, unsigned, unsigned,
                             const TransportBlock*) {}
Json PluginInstance::saveState() const { return Json::object(); }
void PluginInstance::loadState(const Json&, bool) {}

#endif

void Lv2Catalog::setUserBundleDirectory(std::string directory) {
    userBundleDirectory_ = std::move(directory);
}

const PluginInfo* Lv2Catalog::find(const std::string& uri) const {
    for (const PluginInfo& info : plugins_) {
        if (info.uri == uri) {
            return &info;
        }
    }
    return nullptr;
}

std::vector<std::string> Lv2Catalog::categories() const {
    std::vector<std::string> out;
    for (const PluginInfo& info : plugins_) {
        if (std::find(out.begin(), out.end(), info.className) == out.end()) {
            out.push_back(info.className);
        }
    }
    std::sort(out.begin(), out.end());
    return out;
}

} // namespace pimfx
