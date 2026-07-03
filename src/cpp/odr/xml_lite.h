#pragma once

#include <map>
#include <memory>
#include <string>
#include <vector>

namespace odrweb {

struct XmlNode {
  std::string name;
  std::string text;
  std::map<std::string, std::string> attributes;
  std::vector<std::unique_ptr<XmlNode>> children;

  const std::string& Attr(const std::string& key) const;
  const XmlNode* FirstChild(const std::string& child_name) const;
  std::vector<const XmlNode*> Children(const std::string& child_name) const;
};

class XmlLiteParser {
 public:
  std::unique_ptr<XmlNode> Parse(const std::string& text) const;
};

}  // namespace odrweb
