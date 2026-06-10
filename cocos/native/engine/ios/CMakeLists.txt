cmake_minimum_required(VERSION 3.8)

set(CMAKE_SYSTEM_NAME iOS)
set(APP_NAME "openblock-cocos"  CACHE STRING "Project Name")

project(${APP_NAME} CXX)

set(CC_PROJECT_DIR ${CMAKE_CURRENT_LIST_DIR})
set(CC_UI_RESOURCES)
set(CC_PROJ_SOURCES)
set(CC_ASSET_FILES)
set(CC_COMMON_SOURCES)
set(CC_ALL_SOURCES)

include(${CC_PROJECT_DIR}/../common/CMakeLists.txt)
set(EXECUTABLE_NAME ${APP_NAME}-mobile)

cc_ios_before_target(${EXECUTABLE_NAME})
add_executable(${EXECUTABLE_NAME} ${CC_ALL_SOURCES})
cc_ios_after_target(${EXECUTABLE_NAME})

# ---------------------------------------------------------------------------
# 固化 iOS 签名与 Bundle —— 避免每次 Cocos 重新生成 Xcode 工程后手动重导证书/Bundle。
# CMake 会把下列属性直接写进生成的 .xcodeproj 构建设置，重建后依旧保留。
# 改账号/证书时只需改这里（单一来源）。
# 若想改用自动签名：把 CODE_SIGN_STYLE 设为 "Automatic"，并删掉 PROVISIONING_PROFILE_SPECIFIER 一行即可。
# ---------------------------------------------------------------------------
set_target_properties(${EXECUTABLE_NAME} PROPERTIES
    XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER "com.ceshi.game.zy3"
    XCODE_ATTRIBUTE_DEVELOPMENT_TEAM "J4SK4U9Z2P"
    XCODE_ATTRIBUTE_CODE_SIGN_STYLE "Manual"
    XCODE_ATTRIBUTE_CODE_SIGN_IDENTITY "iPhone Developer"
    XCODE_ATTRIBUTE_PROVISIONING_PROFILE_SPECIFIER "gameceshi3_dev"
)
