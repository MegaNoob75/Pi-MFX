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
option(PIMFX_ENABLE_MULTITRACK_RECORDER "Build the Milestone 3 multitrack recorder" ON)

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
    src/transport/MusicalTransport.cpp
    src/backing/BackingTrackPlayer.cpp
    src/looper/StereoLooper.cpp
    src/recorder/MultitrackRecorder.cpp
    src/library/Tone3000.cpp
    src/library/PluginStore.cpp
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
        message(STATUS "pimfx: libcurl not found; TONE3000 and PatchStorage downloads disabled in this build")
    endif()

    pkg_check_modules(SNDFILE IMPORTED_TARGET sndfile)
    pkg_check_modules(SAMPLERATE IMPORTED_TARGET samplerate)
    if(SNDFILE_FOUND AND SAMPLERATE_FOUND)
        target_link_libraries(pimfx PRIVATE PkgConfig::SNDFILE)
        target_link_libraries(pimfx PRIVATE PkgConfig::SAMPLERATE)
        target_compile_definitions(pimfx PRIVATE PIMFX_HAVE_SNDFILE=1 PIMFX_HAVE_SAMPLERATE=1)
    else()
        message(STATUS "pimfx: libsndfile/libsamplerate not found; backing-track playback disabled")
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

set(PIMFX_GIT_SHA "$ENV{PIMFX_GIT_SHA}")
if(DEFINED PIMFX_BUILD_COMMIT AND NOT PIMFX_BUILD_COMMIT STREQUAL "")
    set(PIMFX_GIT_SHA "${PIMFX_BUILD_COMMIT}")
endif()
string(STRIP "${PIMFX_GIT_SHA}" PIMFX_GIT_SHA)
if(NOT PIMFX_GIT_SHA MATCHES "^[0-9a-fA-F]+(-local)?$")
    set(PIMFX_GIT_SHA "")
endif()
if(NOT PIMFX_GIT_SHA)
    execute_process(
        COMMAND git rev-parse --short HEAD
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.."
        OUTPUT_VARIABLE PIMFX_GIT_SHA
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
    )
    execute_process(
        COMMAND git status --porcelain --untracked-files=normal
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.."
        OUTPUT_VARIABLE PIMFX_GIT_CHANGES
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
    )
    if(PIMFX_GIT_SHA AND PIMFX_GIT_CHANGES)
        string(APPEND PIMFX_GIT_SHA "-local")
    endif()
endif()
if(NOT PIMFX_GIT_SHA)
    set(PIMFX_GIT_SHA "unknown")
endif()

target_compile_definitions(pimfx PRIVATE
    PIMFX_VERSION="${PROJECT_VERSION}"
    PIMFX_GIT_SHA="${PIMFX_GIT_SHA}"
)

if(PIMFX_ENABLE_MULTITRACK_RECORDER)
    target_compile_definitions(pimfx PRIVATE PIMFX_ENABLE_MULTITRACK_RECORDER=1)
endif()

install(TARGETS pimfx RUNTIME DESTINATION bin)

include(CTest)
if(BUILD_TESTING)
    add_executable(pimfx_transport_test
        tests/MusicalTransportTest.cpp
        src/transport/MusicalTransport.cpp
        src/core/Json.cpp
    )
    target_include_directories(pimfx_transport_test PRIVATE src)
    target_link_libraries(pimfx_transport_test PRIVATE Threads::Threads)
    add_test(NAME musical_transport COMMAND pimfx_transport_test)
    add_executable(pimfx_stereo_looper_test
        tests/StereoLooperTest.cpp
        src/looper/StereoLooper.cpp
        src/core/Json.cpp
        src/core/Paths.cpp
        src/core/Log.cpp
    )
    target_include_directories(pimfx_stereo_looper_test PRIVATE src)
    target_compile_options(pimfx_stereo_looper_test PRIVATE
        $<$<CXX_COMPILER_ID:MSVC>:/UNDEBUG>
        $<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-UNDEBUG>
    )
    target_link_libraries(pimfx_stereo_looper_test PRIVATE Threads::Threads)
    add_test(NAME stereo_looper COMMAND pimfx_stereo_looper_test)
    add_executable(pimfx_multitrack_recorder_test
        tests/MultitrackRecorderTest.cpp
        src/recorder/MultitrackRecorder.cpp
        src/core/Json.cpp
        src/core/Paths.cpp
        src/core/Log.cpp
    )
    target_include_directories(pimfx_multitrack_recorder_test PRIVATE src)
    target_compile_options(pimfx_multitrack_recorder_test PRIVATE
        $<$<CXX_COMPILER_ID:MSVC>:/UNDEBUG>
        $<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-UNDEBUG>
    )
    target_link_libraries(pimfx_multitrack_recorder_test PRIVATE Threads::Threads)
    add_test(NAME multitrack_recorder COMMAND pimfx_multitrack_recorder_test)
    if(SNDFILE_FOUND AND SAMPLERATE_FOUND)
        add_executable(pimfx_backing_track_test
            tests/BackingTrackPlayerTest.cpp
            src/backing/BackingTrackPlayer.cpp
            src/core/Json.cpp
            src/core/Paths.cpp
            src/core/Log.cpp
        )
        target_include_directories(pimfx_backing_track_test PRIVATE src)
        target_compile_definitions(pimfx_backing_track_test PRIVATE PIMFX_HAVE_SNDFILE=1 PIMFX_HAVE_SAMPLERATE=1)
        target_compile_options(pimfx_backing_track_test PRIVATE
            $<$<CXX_COMPILER_ID:MSVC>:/UNDEBUG>
            $<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-UNDEBUG>
        )
        target_link_libraries(pimfx_backing_track_test PRIVATE PkgConfig::SNDFILE PkgConfig::SAMPLERATE Threads::Threads)
        add_test(NAME backing_track_player COMMAND pimfx_backing_track_test)
    endif()
endif()
