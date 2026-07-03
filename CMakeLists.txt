cmake_minimum_required(VERSION 3.16)
project(OdrWebViewer LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(MSVC)
  add_compile_options(/W4 /permissive- /utf-8)
else()
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

set(ODR_WEB_CORE_SOURCES
    src/cpp/odr/json_serializer.cpp
    src/cpp/odr/opendrive_parser.cpp
    src/cpp/odr/xml_lite.cpp)

add_library(odr_web_core STATIC ${ODR_WEB_CORE_SOURCES})
target_include_directories(odr_web_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

enable_testing()

add_executable(opendrive_parser_test tests/cpp/opendrive_parser_test.cpp)
target_link_libraries(opendrive_parser_test PRIVATE odr_web_core)
add_test(NAME opendrive_parser_test COMMAND opendrive_parser_test)

if(EMSCRIPTEN)
  target_compile_options(odr_web_core PUBLIC -fexceptions)

  add_executable(opendrive_wasm src/wasm/opendrive_wasm.cpp)
  target_link_libraries(opendrive_wasm PRIVATE odr_web_core)
  target_compile_options(opendrive_wasm PRIVATE -fexceptions)
  target_link_options(
    opendrive_wasm
    PRIVATE
      --bind
      -fexceptions
      -sMODULARIZE=1
      -sEXPORT_ES6=1
      -sENVIRONMENT=web
      -sALLOW_MEMORY_GROWTH=0
      -sINITIAL_MEMORY=268435456
      -sNO_EXIT_RUNTIME=1
      -sDISABLE_EXCEPTION_CATCHING=0)
  set_target_properties(
    opendrive_wasm
    PROPERTIES
      RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/wasm"
      SUFFIX ".js")
endif()
