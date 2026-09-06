#include "core/Json.h"

#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace pimfx {
namespace {

class Parser {
public:
    Parser(const std::string& text) : text_(text) {}

    bool parseValue(Json& out) {
        skipSpace();
        if (pos_ >= text_.size()) {
            return fail("unexpected end of input");
        }
        switch (text_[pos_]) {
            case '{': return parseObject(out);
            case '[': return parseArray(out);
            case '"': {
                std::string value;
                if (!parseString(value)) {
                    return false;
                }
                out = Json(std::move(value));
                return true;
            }
            case 't': return parseLiteral("true", Json(true), out);
            case 'f': return parseLiteral("false", Json(false), out);
            case 'n': return parseLiteral("null", Json(), out);
            default: return parseNumber(out);
        }
    }

    bool atEnd() {
        skipSpace();
        return pos_ >= text_.size();
    }

    const std::string& error() const { return error_; }

private:
    bool fail(const std::string& reason) {
        if (error_.empty()) {
            error_ = reason + " at offset " + std::to_string(pos_);
        }
        return false;
    }

    void skipSpace() {
        while (pos_ < text_.size()) {
            const char c = text_[pos_];
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                ++pos_;
            } else {
                break;
            }
        }
    }

    bool parseLiteral(const char* literal, Json value, Json& out) {
        const size_t length = std::char_traits<char>::length(literal);
        if (text_.compare(pos_, length, literal) != 0) {
            return fail("invalid literal");
        }
        pos_ += length;
        out = std::move(value);
        return true;
    }

    bool parseNumber(Json& out) {
        const size_t start = pos_;
        if (pos_ < text_.size() && (text_[pos_] == '-' || text_[pos_] == '+')) {
            ++pos_;
        }
        bool digits = false;
        while (pos_ < text_.size() && std::isdigit(static_cast<unsigned char>(text_[pos_]))) {
            ++pos_;
            digits = true;
        }
        if (pos_ < text_.size() && text_[pos_] == '.') {
            ++pos_;
            while (pos_ < text_.size() && std::isdigit(static_cast<unsigned char>(text_[pos_]))) {
                ++pos_;
                digits = true;
            }
        }
        if (!digits) {
            return fail("expected a number");
        }
        if (pos_ < text_.size() && (text_[pos_] == 'e' || text_[pos_] == 'E')) {
            ++pos_;
            if (pos_ < text_.size() && (text_[pos_] == '-' || text_[pos_] == '+')) {
                ++pos_;
            }
            while (pos_ < text_.size() && std::isdigit(static_cast<unsigned char>(text_[pos_]))) {
                ++pos_;
            }
        }
        out = Json(std::strtod(text_.substr(start, pos_ - start).c_str(), nullptr));
        return true;
    }

    void appendUtf8(std::string& out, uint32_t code) {
        if (code < 0x80) {
            out.push_back(static_cast<char>(code));
        } else if (code < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (code >> 6)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
        } else if (code < 0x10000) {
            out.push_back(static_cast<char>(0xE0 | (code >> 12)));
            out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xF0 | (code >> 18)));
            out.push_back(static_cast<char>(0x80 | ((code >> 12) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
        }
    }

    bool parseHex4(uint32_t& out) {
        if (pos_ + 4 > text_.size()) {
            return fail("truncated \\u escape");
        }
        out = 0;
        for (int i = 0; i < 4; ++i) {
            const char c = text_[pos_++];
            out <<= 4;
            if (c >= '0' && c <= '9') {
                out |= static_cast<uint32_t>(c - '0');
            } else if (c >= 'a' && c <= 'f') {
                out |= static_cast<uint32_t>(c - 'a' + 10);
            } else if (c >= 'A' && c <= 'F') {
                out |= static_cast<uint32_t>(c - 'A' + 10);
            } else {
                return fail("bad hex digit in \\u escape");
            }
        }
        return true;
    }

    bool parseString(std::string& out) {
        if (text_[pos_] != '"') {
            return fail("expected a string");
        }
        ++pos_;
        out.clear();
        while (pos_ < text_.size()) {
            const char c = text_[pos_++];
            if (c == '"') {
                return true;
            }
            if (c != '\\') {
                out.push_back(c);
                continue;
            }
            if (pos_ >= text_.size()) {
                return fail("truncated escape");
            }
            const char escape = text_[pos_++];
            switch (escape) {
                case '"': out.push_back('"'); break;
                case '\\': out.push_back('\\'); break;
                case '/': out.push_back('/'); break;
                case 'b': out.push_back('\b'); break;
                case 'f': out.push_back('\f'); break;
                case 'n': out.push_back('\n'); break;
                case 'r': out.push_back('\r'); break;
                case 't': out.push_back('\t'); break;
                case 'u': {
                    uint32_t code = 0;
                    if (!parseHex4(code)) {
                        return false;
                    }
                    // Surrogate pairs arrive as two escapes and must be joined
                    // before encoding, or the result is invalid UTF-8.
                    if (code >= 0xD800 && code <= 0xDBFF
                        && pos_ + 1 < text_.size()
                        && text_[pos_] == '\\' && text_[pos_ + 1] == 'u') {
                        pos_ += 2;
                        uint32_t low = 0;
                        if (!parseHex4(low)) {
                            return false;
                        }
                        if (low >= 0xDC00 && low <= 0xDFFF) {
                            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                        } else {
                            appendUtf8(out, code);
                            code = low;
                        }
                    }
                    appendUtf8(out, code);
                    break;
                }
                default:
                    return fail("unknown escape");
            }
        }
        return fail("unterminated string");
    }

    bool parseArray(Json& out) {
        ++pos_;
        out = Json::array();
        skipSpace();
        if (pos_ < text_.size() && text_[pos_] == ']') {
            ++pos_;
            return true;
        }
        while (true) {
            Json item;
            if (!parseValue(item)) {
                return false;
            }
            out.push(std::move(item));
            skipSpace();
            if (pos_ >= text_.size()) {
                return fail("unterminated array");
            }
            if (text_[pos_] == ',') {
                ++pos_;
                continue;
            }
            if (text_[pos_] == ']') {
                ++pos_;
                return true;
            }
            return fail("expected ',' or ']'");
        }
    }

    bool parseObject(Json& out) {
        ++pos_;
        out = Json::object();
        skipSpace();
        if (pos_ < text_.size() && text_[pos_] == '}') {
            ++pos_;
            return true;
        }
        while (true) {
            skipSpace();
            if (pos_ >= text_.size() || text_[pos_] != '"') {
                return fail("expected an object key");
            }
            std::string key;
            if (!parseString(key)) {
                return false;
            }
            skipSpace();
            if (pos_ >= text_.size() || text_[pos_] != ':') {
                return fail("expected ':'");
            }
            ++pos_;
            Json value;
            if (!parseValue(value)) {
                return false;
            }
            out.set(key, std::move(value));
            skipSpace();
            if (pos_ >= text_.size()) {
                return fail("unterminated object");
            }
            if (text_[pos_] == ',') {
                ++pos_;
                continue;
            }
            if (text_[pos_] == '}') {
                ++pos_;
                return true;
            }
            return fail("expected ',' or '}'");
        }
    }

    const std::string& text_;
    size_t pos_ = 0;
    std::string error_;
};

} // namespace

const Json& Json::nullValue() {
    static const Json value;
    return value;
}

Json Json::array() {
    Json value;
    value.type_ = Type::Array;
    return value;
}

Json Json::array(std::initializer_list<Json> items) {
    Json value = array();
    value.array_.assign(items.begin(), items.end());
    return value;
}

Json Json::object() {
    Json value;
    value.type_ = Type::Object;
    return value;
}

Json Json::object(std::initializer_list<Member> members) {
    Json value = object();
    for (const Member& member : members) {
        value.set(member.first, member.second);
    }
    return value;
}

Json Json::parse(const std::string& text, std::string* error) {
    Parser parser(text);
    Json value;
    if (!parser.parseValue(value) || !parser.atEnd()) {
        if (error) {
            *error = parser.error().empty() ? "trailing content after JSON value" : parser.error();
        }
        return Json();
    }
    if (error) {
        error->clear();
    }
    return value;
}

bool Json::asBool(bool fallback) const {
    if (type_ == Type::Bool) {
        return bool_;
    }
    if (type_ == Type::Number) {
        return number_ != 0.0;
    }
    return fallback;
}

double Json::asDouble(double fallback) const {
    if (type_ == Type::Number) {
        return number_;
    }
    if (type_ == Type::Bool) {
        return bool_ ? 1.0 : 0.0;
    }
    return fallback;
}

int Json::asInt(int fallback) const {
    return static_cast<int>(asInt64(fallback));
}

int64_t Json::asInt64(int64_t fallback) const {
    if (type_ != Type::Number && type_ != Type::Bool) {
        return fallback;
    }
    const double value = asDouble(static_cast<double>(fallback));
    if (!std::isfinite(value)) {
        return fallback;
    }
    return static_cast<int64_t>(value < 0.0 ? value - 0.5 : value + 0.5);
}

std::string Json::asString(const std::string& fallback) const {
    if (type_ == Type::String) {
        return string_;
    }
    return fallback;
}

size_t Json::size() const {
    if (type_ == Type::Array) {
        return array_.size();
    }
    if (type_ == Type::Object) {
        return object_.size();
    }
    return 0;
}

const Json& Json::at(size_t index) const {
    if (type_ != Type::Array || index >= array_.size()) {
        return nullValue();
    }
    return array_[index];
}

void Json::push(Json value) {
    if (type_ != Type::Array) {
        type_ = Type::Array;
        array_.clear();
    }
    array_.push_back(std::move(value));
}

bool Json::has(const std::string& key) const {
    if (type_ != Type::Object) {
        return false;
    }
    for (const Member& member : object_) {
        if (member.first == key) {
            return true;
        }
    }
    return false;
}

const Json& Json::operator[](const std::string& key) const {
    if (type_ == Type::Object) {
        for (const Member& member : object_) {
            if (member.first == key) {
                return member.second;
            }
        }
    }
    return nullValue();
}

void Json::set(const std::string& key, Json value) {
    if (type_ != Type::Object) {
        type_ = Type::Object;
        object_.clear();
    }
    for (Member& member : object_) {
        if (member.first == key) {
            member.second = std::move(value);
            return;
        }
    }
    object_.emplace_back(key, std::move(value));
}

void Json::remove(const std::string& key) {
    if (type_ != Type::Object) {
        return;
    }
    for (size_t i = 0; i < object_.size(); ++i) {
        if (object_[i].first == key) {
            object_.erase(object_.begin() + static_cast<long>(i));
            return;
        }
    }
}

std::string jsonQuote(const std::string& text) {
    std::string out;
    out.reserve(text.size() + 2);
    out.push_back('"');
    for (unsigned char c : text) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char buffer[8];
                    std::snprintf(buffer, sizeof(buffer), "\\u%04x", c);
                    out += buffer;
                } else {
                    out.push_back(static_cast<char>(c));
                }
        }
    }
    out.push_back('"');
    return out;
}

void Json::dumpTo(std::string& out, int indent, int depth) const {
    const bool pretty = indent >= 0;
    const std::string pad = pretty ? std::string(static_cast<size_t>(indent * (depth + 1)), ' ') : std::string();
    const std::string closePad = pretty ? std::string(static_cast<size_t>(indent * depth), ' ') : std::string();

    switch (type_) {
        case Type::Null:
            out += "null";
            return;
        case Type::Bool:
            out += bool_ ? "true" : "false";
            return;
        case Type::Number: {
            if (!std::isfinite(number_)) {
                out += "null";
                return;
            }
            // Integral values are written without a decimal point so port
            // indices and counts do not read as "3.0" in saved presets.
            if (number_ == std::floor(number_) && std::fabs(number_) < 1e15) {
                out += std::to_string(static_cast<int64_t>(number_));
                return;
            }
            char buffer[40];
            std::snprintf(buffer, sizeof(buffer), "%.17g", number_);
            out += buffer;
            return;
        }
        case Type::String:
            out += jsonQuote(string_);
            return;
        case Type::Array: {
            if (array_.empty()) {
                out += "[]";
                return;
            }
            out += '[';
            for (size_t i = 0; i < array_.size(); ++i) {
                if (i > 0) {
                    out += ',';
                }
                if (pretty) {
                    out += '\n';
                    out += pad;
                }
                array_[i].dumpTo(out, indent, depth + 1);
            }
            if (pretty) {
                out += '\n';
                out += closePad;
            }
            out += ']';
            return;
        }
        case Type::Object: {
            if (object_.empty()) {
                out += "{}";
                return;
            }
            out += '{';
            for (size_t i = 0; i < object_.size(); ++i) {
                if (i > 0) {
                    out += ',';
                }
                if (pretty) {
                    out += '\n';
                    out += pad;
                }
                out += jsonQuote(object_[i].first);
                out += pretty ? ": " : ":";
                object_[i].second.dumpTo(out, indent, depth + 1);
            }
            if (pretty) {
                out += '\n';
                out += closePad;
            }
            out += '}';
            return;
        }
    }
}

std::string Json::dump(int indent) const {
    std::string out;
    dumpTo(out, indent, 0);
    return out;
}

} // namespace pimfx
