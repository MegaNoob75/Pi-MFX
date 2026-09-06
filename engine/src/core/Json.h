#pragma once

#include <cstdint>
#include <initializer_list>
#include <string>
#include <utility>
#include <vector>

namespace pimfx {

/// A small JSON value used for settings, presets, and the control API.
///
/// Objects keep insertion order so a preset file written by Pi-MFX diffs
/// cleanly against the previous version instead of shuffling keys around.
class Json {
public:
    enum class Type { Null, Bool, Number, String, Array, Object };

    using Member = std::pair<std::string, Json>;

    Json() = default;
    Json(std::nullptr_t) {}
    Json(bool value) : type_(Type::Bool), bool_(value) {}
    Json(int value) : type_(Type::Number), number_(value) {}
    Json(int64_t value) : type_(Type::Number), number_(static_cast<double>(value)) {}
    Json(unsigned value) : type_(Type::Number), number_(value) {}
    Json(double value) : type_(Type::Number), number_(value) {}
    Json(const char* value) : type_(Type::String), string_(value ? value : "") {}
    Json(std::string value) : type_(Type::String), string_(std::move(value)) {}

    static Json array();
    static Json array(std::initializer_list<Json> items);
    static Json object();
    static Json object(std::initializer_list<Member> members);

    static Json parse(const std::string& text, std::string* error = nullptr);

    /// `indent` < 0 produces the compact form used on the wire; >= 0 produces
    /// the pretty form used for files a human may open.
    std::string dump(int indent = -1) const;

    Type type() const { return type_; }
    bool isNull() const { return type_ == Type::Null; }
    bool isBool() const { return type_ == Type::Bool; }
    bool isNumber() const { return type_ == Type::Number; }
    bool isString() const { return type_ == Type::String; }
    bool isArray() const { return type_ == Type::Array; }
    bool isObject() const { return type_ == Type::Object; }

    bool asBool(bool fallback = false) const;
    double asDouble(double fallback = 0.0) const;
    float asFloat(float fallback = 0.0f) const { return static_cast<float>(asDouble(fallback)); }
    int asInt(int fallback = 0) const;
    int64_t asInt64(int64_t fallback = 0) const;
    std::string asString(const std::string& fallback = std::string()) const;

    /// Array access. Out-of-range reads return null rather than throwing, which
    /// keeps request parsing free of exception handling.
    size_t size() const;
    const Json& at(size_t index) const;
    void push(Json value);
    const std::vector<Json>& items() const { return array_; }

    /// Object access. Missing keys read as null.
    bool has(const std::string& key) const;
    const Json& operator[](const std::string& key) const;
    void set(const std::string& key, Json value);
    void remove(const std::string& key);
    const std::vector<Member>& members() const { return object_; }

private:
    static const Json& nullValue();
    void dumpTo(std::string& out, int indent, int depth) const;

    Type type_ = Type::Null;
    bool bool_ = false;
    double number_ = 0.0;
    std::string string_;
    std::vector<Json> array_;
    std::vector<Member> object_;
};

/// Escapes a string as a JSON string literal, quotes included.
std::string jsonQuote(const std::string& text);

} // namespace pimfx
