#include "src/cpp/odr/opendrive_parser.h"

#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

const char kSample[] = R"xml(<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <header revMajor="1" revMinor="4" name="sample" vendor="test">
    <geoReference><![CDATA[+proj=tmerc +lat_0=0]]></geoReference>
  </header>
  <road name="Main Road" length="120" id="1" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="70"><line/></geometry>
      <geometry s="70" x="70" y="0" hdg="0" length="50"><arc curvature="0.018"/></geometry>
    </planView>
    <lanes>
      <laneSection s="0">
        <left>
          <lane id="1" type="driving" level="false">
            <width sOffset="0" a="3.5" b="0" c="0" d="0"/>
            <roadMark type="solid" color="white"/>
          </lane>
        </left>
        <center><lane id="0" type="none" level="false"/></center>
        <right>
          <lane id="-1" type="driving" level="false">
            <width sOffset="0" a="3.5" b="0" c="0" d="0"/>
          </lane>
        </right>
      </laneSection>
    </lanes>
    <objects><object id="obj-1" type="pole" s="38" t="-5" width="0.5" length="0.5"/></objects>
    <signals><signal id="sig-1" type="1000001" subtype="trafficLight" s="88" t="4"/></signals>
  </road>
  <junction id="10" name="Sample Junction">
    <connection id="1" incomingRoad="1" connectingRoad="2" contactPoint="start"/>
  </junction>
</OpenDRIVE>)xml";

const char kSectionedRoad[] = R"xml(<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <road name="Sectioned" length="20" id="1" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="20"><line/></geometry>
    </planView>
    <lanes>
      <laneSection s="0">
        <left>
          <lane id="1" type="driving" level="false">
            <width sOffset="0" a="2" b="0" c="0" d="0"/>
          </lane>
        </left>
        <center><lane id="0" type="none" level="false"/></center>
      </laneSection>
      <laneSection s="10">
        <left>
          <lane id="1" type="driving" level="false">
            <width sOffset="0" a="2" b="0.1" c="0" d="0"/>
          </lane>
        </left>
        <center><lane id="0" type="none" level="false"/></center>
      </laneSection>
    </lanes>
  </road>
</OpenDRIVE>)xml";

void Check(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

void TestParseMapStats() {
  const odrweb::OpenDriveMap map =
      odrweb::OpenDriveParser().Parse(kSample, "sample.xodr");
  Check(map.header.name == "sample", "header name mismatch");
  Check(map.header.geo_reference.find("+proj=tmerc") != std::string::npos,
        "geoReference not parsed");
  Check(map.stats.roads == 1, "road count mismatch");
  Check(map.stats.lanes == 2, "lane count mismatch");
  Check(map.stats.objects == 1, "object count mismatch");
  Check(map.stats.signals == 1, "signal count mismatch");
  Check(map.stats.junctions == 1, "junction count mismatch");
  Check(std::abs(map.stats.length_meters - 120.0) < 1e-9,
        "road length mismatch");
}

void TestGeometryAndLaneMesh() {
  const odrweb::OpenDriveMap map =
      odrweb::OpenDriveParser().Parse(kSample, "sample.xodr");
  const odrweb::Road& road = map.roads.front();
  Check(road.reference_line.size() > 20, "reference line undersampled");
  Check(road.reference_line.front().x == 0.0, "reference start mismatch");
  Check(road.reference_line.back().x > 110.0, "arc endpoint mismatch");
  Check(road.lanes.size() == 3, "lane shape count mismatch");
  Check(road.lanes.front().polygon.size() == road.reference_line.size() * 2,
        "lane polygon size mismatch");
  Check(road.objects.front().point.y < 0.0, "object projection mismatch");
  Check(road.signals.front().point.y > 0.0, "signal projection mismatch");
}

void TestJsonExport() {
  const std::string json = odrweb::ParseOpenDriveToJson(kSample, "sample.xodr");
  Check(json.find("\"fileName\":\"sample.xodr\"") != std::string::npos,
        "fileName missing from JSON");
  Check(json.find("\"roads\":1") != std::string::npos,
        "stats missing from JSON");
  Check(json.find("\"laneType\":\"driving\"") != std::string::npos,
        "lane type missing from JSON");
}

void TestLaneSectionsAreClippedAndVariableWidth() {
  const odrweb::OpenDriveMap map =
      odrweb::OpenDriveParser().Parse(kSectionedRoad, "sectioned.xodr");
  const odrweb::Road& road = map.roads.front();
  Check(road.lanes.size() == 4, "sectioned lane count mismatch");

  const odrweb::Lane& first_left = road.lanes[0];
  const odrweb::Lane& second_left = road.lanes[2];
  Check(std::abs(first_left.centerline.front().s - 0.0) < 1e-9,
        "first section start mismatch");
  Check(std::abs(first_left.centerline.back().s - 10.0) < 1e-9,
        "first section end mismatch");
  Check(std::abs(second_left.centerline.front().s - 10.0) < 1e-9,
        "second section start mismatch");
  Check(std::abs(second_left.centerline.back().s - 20.0) < 1e-9,
        "second section end mismatch");
  Check(first_left.bounds.max_y < 2.1, "first section width drifted");
  Check(second_left.bounds.max_y > 2.9, "variable width not sampled");
}

}  // namespace

int main() {
  TestParseMapStats();
  TestGeometryAndLaneMesh();
  TestJsonExport();
  TestLaneSectionsAreClippedAndVariableWidth();
  std::cout << "opendrive_parser_test passed\n";
  return 0;
}
