cmake_minimum_required(VERSION 3.16)
project(pimfx VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

# The realtime path is compiled for speed, but never with -ffast-math: denormal
# and NaN behaviour has to stay predictable when a plugin misbehaves.
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -fno-math-errno -fno-trapping-math")

option(PIMFX_NATIVE_ARCH "Tune for the build machine (leave OFF for portable builds)" OFF)

add_executable(pimfx)

target_include_directories(pimfx PRIVATE src)

target_sources(pimfx PRIVATE
    src/main.cpp
    src/Engine.cpp
    src/core/Log.cpp
    src/core/Json.cpp
    src/core/Crypto.cpp
    src/core/Paths.cpp
    src/audio/MockBackend.cpp
    src/audio/RtPriority.cpp
    src/host/UridMap.cpp
    src/host/Lv2Host.cpp
    src/model/Model.cpp
    src/model/Storage.cpp
    src/control/HttpServer.cpp
    src/control/ApiRouter.cpp
    src/midi/Mapping.cpp
    src/midi/MidiInput.cpp
    src/library/Tone3000.cpp
)

# ---------------------------------------------------------------------------
# ALSA: the realtime audio and MIDI path. Linux only; other platforms build
# against the mock backend so the API and UI can be developed off the Pi.
# ---------------------------------------------------------------------------
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(ALSA REQUIRED IMPORTED_TARGET alsa)
    target_sources(pimfx PRIVATE src/audio/AlsaBackend.cpp)
    target_link_libraries(pimfx PRIVATE PkgConfig::ALSA)
    target_compile_definitions(pimfx PRIVATE PIMFX_HAVE_ALSA=1)
else()
    message(STATUS "pimfx: no ALSA on ${CMAKE_SYSTEM_NAME}; building with the mock audio backend")
endif()

# ---------------------------------------------------------------------------
# lilv: LV2 discovery and state. Optional so the control plane can be built and
# tested on a machine with no LV2 installation.
# ---------------------------------------------------------------------------
find_package(PkgConfig QUIET)
if(PkgConfig_FOUND)
    pkg_check_modules(LILV IMPORTED_TARGET lilv-0)
    if(LILV_FOUND)
        target_link_libraries(pimfx PRIVATE PkgConfig::LILV)
        target_compile_definitions(pimfx PRIVATE PIMFX_HAVE_LILV=1)
    else()
        message(STATUS "pimfx: lilv-0 not found; plugin hosting disabled in this build")
    endif()

    pkg_check_modules(CURL IMPORTED_TARGET libcurl)
    if(CURL_FOUND)
        target_link_libraries(pimfx PRIVATE PkgConfig::CURL)
        target_compile_definitions(pimfx PRIVATE PIMFX_HAVE_CURL=1)
    else()
        message(STATUS "pimfx: libcurl not found; TONE3000 downloads disabled in this build")
    endif()

    pkg_check_modules(SNDFILE IMPORTED_TARGET sndfile)
    if(SNDFILE_FOUND)
        target_link_libraries(pimfx PRIVATE PkgConfig::SNDFILE)
        target_compile_definitions(pimfx PRIVATE PIMFX_HAVE_SNDFILE=1)
    endif()
endif()

find_package(Threads REQUIRED)
target_link_libraries(pimfx PRIVATE Threads::Threads)

if(PIMFX_NATIVE_ARCH)
    target_compile_options(pimfx PRIVATE -mcpu=native)
endif()

if(WIN32)
    target_link_libraries(pimfx PRIVATE ws2_32)
endif()

target_compile_definitions(pimfx PRIVATE PIMFX_VERSION="${PROJECT_VERSION}")

install(TARGETS pimfx RUNTIME DESTINATION bin)
