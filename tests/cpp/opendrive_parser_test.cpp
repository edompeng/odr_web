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
    <offset x="12.5" y="-34.25"/>
  </header>
  <road name="Main Road" length="120" id="1" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="70"><line/></geometry>
      <geometry s="70" x="70" y="0" hdg="0" length="50"><arc curvature="0.018"/></geometry>
    </planView>
    <elevationProfile>
      <elevation s="0" a="1" b="0.1" c="0" d="0"/>
      <elevation s="70" a="10" b="0" c="0" d="0"/>
    </elevationProfile>
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

const char kMixedEmptyRoad[] = R"xml(<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <road name="Valid" length="20" id="1" junction="-1">
    <planView>
      <geometry s="0" x="500000" y="3000000" hdg="0" length="20"><line/></geometry>
    </planView>
    <lanes>
      <laneSection s="0">
        <center><lane id="0" type="none" level="false"/></center>
      </laneSection>
    </lanes>
  </road>
  <road name="Empty" length="10" id="2" junction="-1"/>
</OpenDRIVE>)xml";

const char kLaneOffsetAndElementGeometry[] = R"xml(<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <road name="Offset" length="20" id="1" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="20"><line/></geometry>
    </planView>
    <lanes>
      <laneOffset s="0" a="2" b="0" c="0" d="0"/>
      <laneSection s="0">
        <left>
          <lane id="1" type="driving" level="false">
            <width sOffset="0" a="3" b="0" c="0" d="0"/>
          </lane>
        </left>
        <center><lane id="0" type="none" level="false"/></center>
      </laneSection>
    </lanes>
    <objects>
      <object id="box" type="building" s="10" t="2" hdg="0" width="4" length="6">
        <outline>
          <cornerLocal u="-3" v="-2"/>
          <cornerLocal u="3" v="-2"/>
          <cornerLocal u="3" v="2"/>
          <cornerLocal u="-3" v="2"/>
        </outline>
      </object>
    </objects>
    <signals>
      <signal id="sign" type="274" s="12" t="5" width="1.2" height="2.5" hOffset="0"/>
    </signals>
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
  Check(std::abs(map.header.x_offset - 12.5) < 1e-9,
        "header x offset mismatch");
  Check(std::abs(map.header.y_offset + 34.25) < 1e-9,
        "header y offset mismatch");
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
  Check(std::abs(road.reference_line.front().z - 1.0) < 1e-9,
        "reference elevation start mismatch");
  Check(road.reference_line.back().x > 110.0, "arc endpoint mismatch");
  Check(std::abs(road.reference_line.back().z - 10.0) < 1e-9,
        "reference elevation end mismatch");
  Check(road.lanes.size() == 3, "lane shape count mismatch");
  Check(road.lanes.front().polygon.size() == road.reference_line.size() * 2,
        "lane polygon size mismatch");
  Check(std::abs(road.lanes.front().centerline.front().z - 1.0) < 1e-9,
        "lane elevation was not preserved");
  Check(road.objects.front().point.y < 0.0, "object projection mismatch");
  Check(road.objects.front().point.z > 4.0, "object elevation mismatch");
  Check(road.signals.front().point.y > 0.0, "signal projection mismatch");
  Check(std::abs(road.signals.front().point.z - 10.0) < 1e-9,
        "signal elevation mismatch");
}

void TestJsonExport() {
  const std::string json = odrweb::ParseOpenDriveToJson(kSample, "sample.xodr");
  Check(json.find("\"fileName\":\"sample.xodr\"") != std::string::npos,
        "fileName missing from JSON");
  Check(json.find("\"roads\":1") != std::string::npos,
        "stats missing from JSON");
  Check(json.find("\"xOffset\":12.5") != std::string::npos,
        "header x offset missing from JSON");
  Check(json.find("\"z\":1") != std::string::npos,
        "point elevation missing from JSON");
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

void TestMapBoundsIgnoreEmptyRoads() {
  const odrweb::OpenDriveMap map =
      odrweb::OpenDriveParser().Parse(kMixedEmptyRoad, "large.xodr");
  Check(map.bounds.min_x > 499990.0, "map bounds were skewed toward origin");
  Check(map.bounds.max_x < 500030.0, "map bounds max x mismatch");
  Check(map.bounds.min_y > 2999990.0, "map bounds min y mismatch");
  Check(map.bounds.max_y < 3000010.0, "map bounds max y mismatch");

  const std::string json =
      odrweb::ParseOpenDriveToJson(kMixedEmptyRoad, "large.xodr");
  Check(json.find("1e+100") == std::string::npos,
        "invalid bounds sentinel leaked to JSON");
}

void TestLaneOffsetAndElementGeometry() {
  const odrweb::OpenDriveMap map =
      odrweb::OpenDriveParser().Parse(kLaneOffsetAndElementGeometry,
                                      "geometry.xodr");
  const odrweb::Road& road = map.roads.front();
  Check(std::abs(road.lanes.front().centerline.front().y - 3.5) < 1e-9,
        "laneOffset was not applied to lane centerline");
  Check(road.objects.front().outline.size() == 4,
        "object outline geometry was not parsed");
  Check(road.signals.front().shape.size() == 4,
        "signal shape geometry was not generated");

  const std::string json = odrweb::ParseOpenDriveToJson(
      kLaneOffsetAndElementGeometry, "geometry.xodr");
  Check(json.find("\"outline\"") != std::string::npos,
        "object outline missing from JSON");
  Check(json.find("\"shape\"") != std::string::npos,
        "signal shape missing from JSON");
}

}  // namespace

int main() {
  TestParseMapStats();
  TestGeometryAndLaneMesh();
  TestJsonExport();
  TestLaneSectionsAreClippedAndVariableWidth();
  TestMapBoundsIgnoreEmptyRoads();
  TestLaneOffsetAndElementGeometry();
  std::cout << "opendrive_parser_test passed\n";
  return 0;
}
