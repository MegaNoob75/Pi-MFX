#include "host/Lv2Host.h"

#include "core/Log.h"
#include "core/SpscQueue.h"

#include <algorithm>
#include <atomic>
#include <cctype>
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
        json.set("meter", meter);
        if (!unit.empty()) {
            json.set("unit", unit);
        }
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
    char property[256];
    char value[512];
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
    LilvNode* patchWritable = nullptr;
    LilvNode* rdfsLabel = nullptr;
    LilvNode* rdfsRange = nullptr;
    LilvNode* rdfsComment = nullptr;
    LilvNode* atomPath = nullptr;
    LilvNode* atomSupports = nullptr;
    LilvNode* midiEvent = nullptr;
    LilvNode* fileTypeProperty = nullptr;

    ~Impl() {
        LilvNode* nodes[] = {audioPort, controlPort, atomPort, cvPort, inputPort, outputPort,
                             toggled, integer, enumeration, logarithmic, patchWritable,
                             rdfsLabel, rdfsRange, rdfsComment, atomPath, atomSupports,
                             midiEvent, fileTypeProperty};
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
        impl.patchWritable = lilv_new_uri(impl.world, LV2_PATCH__writable);
        impl.rdfsLabel = lilv_new_uri(impl.world, "http://www.w3.org/2000/01/rdf-schema#label");
        impl.rdfsRange = lilv_new_uri(impl.world, "http://www.w3.org/2000/01/rdf-schema#range");
        impl.rdfsComment = lilv_new_uri(impl.world, "http://www.w3.org/2000/01/rdf-schema#comment");
        impl.atomPath = lilv_new_uri(impl.world, LV2_ATOM__Path);
        impl.atomSupports = lilv_new_uri(impl.world, LV2_ATOM__supports);
        impl.midiEvent = lilv_new_uri(impl.world, LV2_MIDI__MidiEvent);
        impl.fileTypeProperty = lilv_new_uri(impl.world, "http://lv2plug.in/ns/ext/patch#fileType");
    }

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

            if (portInfo.control) {
                portInfo.minimum = minimums[index];
                portInfo.maximum = maximums[index];
                portInfo.defaultValue = defaults[index];
                portInfo.toggled = lilv_port_has_property(plugin, port, impl.toggled);
                portInfo.integer = lilv_port_has_property(plugin, port, impl.integer);
                portInfo.enumerated = lilv_port_has_property(plugin, port, impl.enumeration);
                portInfo.logarithmic = lilv_port_has_property(plugin, port, impl.logarithmic);
                portInfo.meter = !portInfo.input;

                if (LilvScalePoints* points = lilv_port_get_scale_points(plugin, port)) {
                    LILV_FOREACH(scale_points, pointIterator, points) {
                        const LilvScalePoint* point = lilv_scale_points_get(points, pointIterator);
                        ScalePoint scalePoint;
                        scalePoint.value = lilv_node_as_float(lilv_scale_point_get_value(point));
                        scalePoint.label = lilv_node_as_string(lilv_scale_point_get_label(point));
                        portInfo.scalePoints.push_back(std::move(scalePoint));
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
                        property.fileTypes.push_back(
                            lilv_node_as_string(lilv_nodes_get(types, typeIterator)));
                    }
                    lilv_nodes_free(types);
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
    SpscQueue<MidiMessage> midiQueue{256};
    std::vector<std::pair<std::string, std::string>> propertyValues;
    mutable std::mutex propertyMutex;

    // Worker extension.
    const LV2_Worker_Interface* workerInterface = nullptr;
    ByteRing workRequests{64 * 1024};
    ByteRing workResponses{64 * 1024};
    std::thread workerThread;
    std::mutex workerMutex;
    std::condition_variable workerSignal;
    std::atomic<bool> workerRunning{false};

    LV2_URID_Map uridMap{};
    LV2_URID_Unmap uridUnmap{};
    LV2_Worker_Schedule workerSchedule{};
    LV2_Options_Option options[5]{};
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
    } urids;

    float sampleRateValue = 48000.0f;
    int32_t maxBlockLength = 64;
    int32_t minBlockLength = 1;
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
        impl->workerSignal.notify_one();
        return LV2_WORKER_SUCCESS;
    }

    static LV2_Worker_Status respond(LV2_Worker_Respond_Handle handle,
                                     uint32_t size,
                                     const void* data) {
        Impl* impl = static_cast<Impl*>(handle);
        return impl->workResponses.write(data, size)
            ? LV2_WORKER_SUCCESS
            : LV2_WORKER_ERR_NO_SPACE;
    }
};

namespace {

LV2_URID uridMapCallback(LV2_URID_Map_Handle handle, const char* uri) {
    return static_cast<UridMap*>(handle)->map(uri);
}

const char* uridUnmapCallback(LV2_URID_Unmap_Handle handle, LV2_URID urid) {
    // The plugin only borrows this string for the duration of the call, but a
    // few hold it longer, so it is cached per instance rather than returned
    // from a temporary.
    static thread_local std::string cached;
    cached = static_cast<UridMap*>(handle)->unmap(urid);
    return cached.c_str();
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

    impl.catalog = &catalog;
    impl.plugin = plugin;
    impl.sampleRate = sampleRate;
    impl.maxFrames = maxFrames;
    impl.sampleRateValue = static_cast<float>(sampleRate);
    impl.maxBlockLength = static_cast<int32_t>(maxFrames);

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
    impl.options[2] = {LV2_OPTIONS_INSTANCE, 0, impl.urids.bufSequenceSize,
                       sizeof(int32_t), urids.map(LV2_ATOM__Int), &impl.sequenceSize};
    impl.options[3] = {LV2_OPTIONS_INSTANCE, 0, impl.urids.paramSampleRate,
                       sizeof(float), impl.urids.atomFloat, &impl.sampleRateValue};
    impl.options[4] = {LV2_OPTIONS_BLANK, 0, 0, 0, 0, nullptr};

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
                impl.atomInputPort = static_cast<int>(port.index);
            } else {
                impl.atomOutputPort = static_cast<int>(port.index);
            }
        } else if (port.cv) {
            // CV ports are connected to a silent buffer so the plugin has
            // valid memory even though Pi-MFX does not route CV.
            impl.spareOutputs.emplace_back(maxFrames, 0.0f);
            lilv_instance_connect_port(impl.instance, port.index, impl.spareOutputs.back().data());
        }
    }

    impl.silentInputs.assign(impl.audioInputPorts.size(), std::vector<float>(maxFrames, 0.0f));
    impl.spareOutputs.reserve(impl.spareOutputs.size() + impl.audioOutputPorts.size());
    for (size_t i = 0; i < impl.audioOutputPorts.size(); ++i) {
        impl.spareOutputs.emplace_back(maxFrames, 0.0f);
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
        impl.workerRunning.store(true);
        Impl* raw = &impl;
        impl.workerThread = std::thread([raw]() {
            std::string message;
            // Below the audio thread on purpose: a long load must never delay
            // the next period.
            std::vector<uint8_t> request;
            while (raw->workerRunning.load()) {
                {
                    std::unique_lock<std::mutex> lock(raw->workerMutex);
                    raw->workerSignal.wait_for(lock, std::chrono::milliseconds(20));
                }
                while (raw->workRequests.read(request)) {
                    raw->workerInterface->work(lilv_instance_get_handle(raw->instance),
                                               Impl::respond,
                                               raw,
                                               static_cast<uint32_t>(request.size()),
                                               request.data());
                }
            }
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
    if (propertyUri.size() >= sizeof(PropertyMessage::property)
        || value.size() >= sizeof(PropertyMessage::value)) {
        error = "property or value is too long";
        return false;
    }

    PropertyMessage message{};
    std::memcpy(message.property, propertyUri.c_str(), propertyUri.size() + 1);
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

void PluginInstance::process(const float* const* inputs, unsigned inputCount,
                             float* const* outputs, unsigned outputCount,
                             unsigned frames) {
    Impl& impl = *impl_;
    if (!impl.instance) {
        return;
    }

    for (size_t i = 0; i < impl.live.size(); ++i) {
        if (impl.isControlInput[i]) {
            impl.live[i] = impl.staged[i].load(std::memory_order_relaxed);
        }
    }

    for (size_t i = 0; i < impl.audioInputPorts.size(); ++i) {
        const float* source = i < inputCount ? inputs[i] : impl.silentInputs[i].data();
        lilv_instance_connect_port(impl.instance, impl.audioInputPorts[i],
                                   const_cast<float*>(source));
    }
    for (size_t i = 0; i < impl.audioOutputPorts.size(); ++i) {
        float* destination = i < outputCount ? outputs[i] : impl.spareOutputs[i].data();
        lilv_instance_connect_port(impl.instance, impl.audioOutputPorts[i], destination);
    }

    if (impl.atomInputPort >= 0) {
        lv2_atom_forge_set_buffer(&impl.forge, impl.atomInput.data(), impl.atomInput.size());
        LV2_Atom_Forge_Frame sequenceFrame;
        lv2_atom_forge_sequence_head(&impl.forge, &sequenceFrame, 0);

        MidiMessage midi;
        while (impl.midiQueue.pop(midi)) {
            lv2_atom_forge_frame_time(&impl.forge, static_cast<int64_t>(midi.frame));
            lv2_atom_forge_atom(&impl.forge, midi.size, impl.urids.midiEvent);
            lv2_atom_forge_write(&impl.forge, midi.data, midi.size);
        }

        PropertyMessage property;
        while (impl.propertyQueue.pop(property)) {
            const LV2_URID propertyUrid = impl.uridMap.map(impl.uridMap.handle, property.property);
            LV2_Atom_Forge_Frame objectFrame;
            lv2_atom_forge_frame_time(&impl.forge, 0);
            lv2_atom_forge_object(&impl.forge, &objectFrame, 0, impl.urids.patchSet);
            lv2_atom_forge_key(&impl.forge, impl.urids.patchProperty);
            lv2_atom_forge_urid(&impl.forge, propertyUrid);
            lv2_atom_forge_key(&impl.forge, impl.urids.patchValue);
            lv2_atom_forge_path(&impl.forge, property.value,
                                static_cast<uint32_t>(std::strlen(property.value)));
            lv2_atom_forge_pop(&impl.forge, &objectFrame);
        }

        lv2_atom_forge_pop(&impl.forge, &sequenceFrame);
    }

    if (impl.atomOutputPort >= 0) {
        LV2_Atom_Sequence* sequence = reinterpret_cast<LV2_Atom_Sequence*>(impl.atomOutput.data());
        sequence->atom.size = static_cast<uint32_t>(impl.atomOutput.size() - sizeof(LV2_Atom));
        sequence->atom.type = impl.urids.atomSequence;
    }

    lilv_instance_run(impl.instance, frames);

    if (impl.workerInterface) {
        std::vector<uint8_t> response;
        while (impl.workResponses.read(response)) {
            if (impl.workerInterface->work_response) {
                impl.workerInterface->work_response(lilv_instance_get_handle(impl.instance),
                                                    static_cast<uint32_t>(response.size()),
                                                    response.data());
            }
        }
        if (impl.workerInterface->end_run) {
            impl.workerInterface->end_run(lilv_instance_get_handle(impl.instance));
        }
    }
}

Json PluginInstance::saveState() const {
    Json state = Json::object();
    Json controls = Json::object();
    for (const PortInfo& port : info_.ports) {
        if (port.control && port.input) {
            controls.set(port.symbol, Json(control(port.index)));
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

void PluginInstance::loadState(const Json& state) {
    const Json& controls = state["controls"];
    for (const PortInfo& port : info_.ports) {
        if (!port.control || !port.input) {
            continue;
        }
        if (controls.has(port.symbol)) {
            const float value = controls[port.symbol].asFloat(port.defaultValue);
            setControl(port.index, std::max(port.minimum, std::min(port.maximum, value)));
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
float PluginInstance::control(uint32_t) const { return 0.0f; }
float PluginInstance::readOutput(uint32_t) const { return 0.0f; }
void PluginInstance::pushMidi(const uint8_t*, uint32_t, uint32_t) {}
bool PluginInstance::setProperty(const std::string&, const std::string&, std::string& error) {
    error = "this build has no LV2 support";
    return false;
}
std::string PluginInstance::property(const std::string&) const { return std::string(); }
void PluginInstance::process(const float* const*, unsigned, float* const*, unsigned, unsigned) {}
Json PluginInstance::saveState() const { return Json::object(); }
void PluginInstance::loadState(const Json&) {}

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
