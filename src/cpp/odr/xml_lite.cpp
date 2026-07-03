#include "src/cpp/odr/xml_lite.h"

#include <cctype>
#include <stdexcept>
#include <string_view>
#include <utility>

namespace odrweb {
namespace {

const std::string kEmptyString;

class Parser {
 public:
  explicit Parser(const std::string& text) : text_(text) {}

  std::unique_ptr<XmlNode> ParseDocument() {
    SkipMisc();
    auto root = ParseElement();
    SkipMisc();
    return root;
  }

 private:
  void SkipWhitespace() {
    while (pos_ < text_.size() &&
           std::isspace(static_cast<unsigned char>(text_[pos_]))) {
      ++pos_;
    }
  }

  void SkipMisc() {
    bool consumed = true;
    while (consumed) {
      consumed = false;
      SkipWhitespace();
      if (StartsWith("<?")) {
        SkipUntil("?>");
        consumed = true;
      } else if (StartsWith("<!--")) {
        SkipUntil("-->");
        consumed = true;
      }
    }
  }

  bool StartsWith(std::string_view needle) const {
    return pos_ + needle.size() <= text_.size() &&
           text_.compare(pos_, needle.size(), needle.data(), needle.size()) ==
               0;
  }

  void Expect(char ch) {
    if (pos_ >= text_.size() || text_[pos_] != ch) {
      throw std::runtime_error("Invalid XML: expected token");
    }
    ++pos_;
  }

  void SkipUntil(const char* end) {
    const std::string marker(end);
    const std::size_t found = text_.find(marker, pos_);
    if (found == std::string::npos) {
      throw std::runtime_error("Invalid XML: unterminated block");
    }
    pos_ = found + marker.size();
  }

  std::string ParseName() {
    const std::size_t start = pos_;
    while (pos_ < text_.size()) {
      const char ch = text_[pos_];
      if (std::isalnum(static_cast<unsigned char>(ch)) || ch == '_' ||
          ch == '-' || ch == ':' || ch == '.') {
        ++pos_;
      } else {
        break;
      }
    }
    if (start == pos_) throw std::runtime_error("Invalid XML: missing name");
    return text_.substr(start, pos_ - start);
  }

  std::string DecodeEntities(std::string value) const {
    ReplaceAll(&value, "&quot;", "\"");
    ReplaceAll(&value, "&apos;", "'");
    ReplaceAll(&value, "&lt;", "<");
    ReplaceAll(&value, "&gt;", ">");
    ReplaceAll(&value, "&amp;", "&");
    return value;
  }

  static void ReplaceAll(std::string* value, const std::string& from,
                         const std::string& to) {
    std::size_t pos = 0;
    while ((pos = value->find(from, pos)) != std::string::npos) {
      value->replace(pos, from.size(), to);
      pos += to.size();
    }
  }

  std::string ParseQuotedValue() {
    SkipWhitespace();
    if (pos_ >= text_.size() || (text_[pos_] != '"' && text_[pos_] != '\'')) {
      throw std::runtime_error("Invalid XML: expected quoted attribute");
    }
    const char quote = text_[pos_++];
    const std::size_t start = pos_;
    while (pos_ < text_.size() && text_[pos_] != quote) ++pos_;
    if (pos_ >= text_.size()) {
      throw std::runtime_error("Invalid XML: unterminated attribute");
    }
    std::string value = text_.substr(start, pos_ - start);
    ++pos_;
    return DecodeEntities(std::move(value));
  }

  std::unique_ptr<XmlNode> ParseElement() {
    Expect('<');
    if (StartsWith("![CDATA[")) {
      throw std::runtime_error("Invalid XML: CDATA cannot be root element");
    }
    auto node = std::make_unique<XmlNode>();
    node->name = ParseName();

    while (true) {
      SkipWhitespace();
      if (StartsWith("/>")) {
        pos_ += 2;
        return node;
      }
      if (pos_ < text_.size() && text_[pos_] == '>') {
        ++pos_;
        break;
      }
      const std::string key = ParseName();
      SkipWhitespace();
      Expect('=');
      node->attributes[key] = ParseQuotedValue();
    }

    while (pos_ < text_.size()) {
      if (StartsWith("</")) {
        pos_ += 2;
        const std::string close_name = ParseName();
        if (close_name != node->name) {
          throw std::runtime_error("Invalid XML: mismatched close tag");
        }
        SkipWhitespace();
        Expect('>');
        return node;
      }
      if (StartsWith("<!--")) {
        SkipUntil("-->");
      } else if (StartsWith("<![CDATA[")) {
        pos_ += 9;
        const std::size_t end = text_.find("]]>", pos_);
        if (end == std::string::npos) {
          throw std::runtime_error("Invalid XML: unterminated CDATA");
        }
        node->text += text_.substr(pos_, end - pos_);
        pos_ = end + 3;
      } else if (pos_ < text_.size() && text_[pos_] == '<') {
        node->children.push_back(ParseElement());
      } else {
        const std::size_t start = pos_;
        while (pos_ < text_.size() && text_[pos_] != '<') ++pos_;
        node->text += DecodeEntities(text_.substr(start, pos_ - start));
      }
    }
    throw std::runtime_error("Invalid XML: unterminated element");
  }

  const std::string& text_;
  std::size_t pos_ = 0;
};

}  // namespace

const std::string& XmlNode::Attr(const std::string& key) const {
  const auto it = attributes.find(key);
  return it == attributes.end() ? kEmptyString : it->second;
}

const XmlNode* XmlNode::FirstChild(const std::string& child_name) const {
  for (const auto& child : children) {
    if (child->name == child_name) return child.get();
  }
  return nullptr;
}

std::vector<const XmlNode*> XmlNode::Children(
    const std::string& child_name) const {
  std::vector<const XmlNode*> out;
  for (const auto& child : children) {
    if (child->name == child_name) out.push_back(child.get());
  }
  return out;
}

std::unique_ptr<XmlNode> XmlLiteParser::Parse(const std::string& text) const {
  return Parser(text).ParseDocument();
}

}  // namespace odrweb
