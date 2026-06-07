#!/usr/bin/env python3
"""从 docs/architecture/assets/icon.png 同步 Cocos 原生客户端的应用图标与启动画面。

覆盖范围（与编辑器/构建实际消费的位置严格一致）：
  - iOS 应用图标：cocos/native/engine/ios/Images.xcassets/AppIcon.appiconset/*.png
                  （按 Contents.json 中的像素尺寸命名；App Store 要求无 alpha，故全部压到纯黑底）
  - Android 应用图标：cocos/native/engine/android/res/mipmap-*/ic_launcher.png
  - iOS 启动画面：cocos/native/engine/ios/LaunchScreenBackground{,Portrait,Landscape}.png
                  （LaunchScreen.storyboard 全屏 aspectFill：图标居中合成在深色底上）
  - 编辑器图标来源：cocos/build-assets/icon.png + icon-dark.png + android/res/mipmap-*/*
                  （Cocos「构建」面板的 Icon 选项指向 build-assets，会据此重新生成上面的原生图标。
                   必须一并同步，否则下次在编辑器内构建会用旧图标覆盖原生工程。）

Android 该原生模板使用 Theme.NoTitleBar.Fullscreen，没有图片型启动页，故不生成 Android 启动图。

注意：Cocos 3.8 原生构建插件没有「图标/启动画面」构建选项，二者完全由上述原生模板资源决定；
而 cocos/native/ 在本仓库被 .gitignore（属可再生目录）。因此本脚本即「把图标落到原生工程」的
权威方式：若日后重新生成了 native/（图标会回退为引擎默认图），重跑一次即可恢复。
编辑器内构建会读取 build-assets/ 作为图标来源，故一并同步。

用法:  python3 scripts/sync-cocos-app-icon.py        （或 npm run sync:cocos-app-icon）
依赖:  Pillow / numpy / scipy（pip install pillow numpy scipy）

说明：源图为 RGB（不透明），圆角方块本体之外被烤进了一层近白/浅灰的「透明棋盘格」。
本脚本先从四边连通地抠掉这层背景（保留方块本体与圆角），再裁剪成正方形，
最终：iOS 图标拍平到纯黑、Android 图标保留圆角透明、启动画面居中合成在深色底上。
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "docs/architecture/assets/icon.png")
COCOS = os.path.join(ROOT, "cocos")

# 启动画面深色底：贴合图标暗色本体（霓虹/彩虹边框在深底上更突出）
SPLASH_BG = (10, 12, 20)
# iOS marketing/桌面图标拍平用的底色（图标圆角会被系统裁切，纯黑最稳）
ICON_FLATTEN_BG = (0, 0, 0)
# 启动画面中图标占屏幕短边的比例
SPLASH_ICON_FRAC = 0.42

_TILE: Image.Image | None = None


def _tile() -> Image.Image:
    """抠掉源图烤死的浅色背景棋盘，裁出圆角方块本体，居中补成透明正方形。"""
    global _TILE
    if _TILE is not None:
        return _TILE
    im = Image.open(SOURCE).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    mx, mn = a.max(2), a.min(2)
    # 近白/浅灰且低饱和 = 背景棋盘；方块本体（深底 + 高饱和霓虹/彩虹）不命中
    light = (mn >= 205) & ((mx - mn) <= 28)
    lbl, _ = ndimage.label(light)
    # 只有与图像四边连通的浅色才算背景（中心星芒等内部近白区域得以保留）
    border = set(np.unique(np.concatenate([lbl[0, :], lbl[-1, :], lbl[:, 0], lbl[:, -1]])))
    border.discard(0)
    bg = np.isin(lbl, list(border))
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    rgba = Image.fromarray(np.dstack([np.asarray(im), alpha]), "RGBA")
    ys, xs = np.where(~bg)
    crop = rgba.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    side = max(crop.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(crop, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2), crop)
    _TILE = square
    return _TILE


def _scaled(size: int) -> Image.Image:
    return _tile().resize((size, size), Image.LANCZOS)


def write_icon(path: str, size: int, *, flatten: bool) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    icon = _scaled(size)
    if flatten:
        canvas = Image.new("RGB", (size, size), ICON_FLATTEN_BG)
        canvas.paste(icon, (0, 0), icon)
        canvas.save(path)
    else:
        icon.save(path)
    print(f"  icon   {os.path.relpath(path, ROOT)}  {size}x{size}")


def write_splash(path: str) -> None:
    """保持目标文件原有尺寸，把图标居中合成到深色底上（无 alpha）。"""
    w, h = Image.open(path).size
    canvas = Image.new("RGB", (w, h), SPLASH_BG)
    side = int(min(w, h) * SPLASH_ICON_FRAC)
    icon = _scaled(side)
    canvas.paste(icon, ((w - side) // 2, (h - side) // 2), icon)
    canvas.save(path)
    print(f"  splash {os.path.relpath(path, ROOT)}  {w}x{h}")


def write_tile(path: str) -> None:
    """把抠干净的正方形方块（透明圆角）写为编辑器图标来源。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    _tile().save(path)
    print(f"  tile   {os.path.relpath(path, ROOT)}  {_tile().size[0]}x{_tile().size[1]}")


# Android launcher 各 dpi 尺寸（与原生模板 res/mipmap-* 对应）
ANDROID_MIPMAP = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
# iOS AppIcon.appiconset 中按像素命名的图标尺寸（见 Contents.json）
IOS_ICON_PX = [29, 40, 57, 58, 60, 80, 87, 114, 120, 180, 1024]


def main() -> None:
    if not os.path.exists(SOURCE):
        raise SystemExit(f"[sync-cocos-app-icon] 源文件不存在: {SOURCE}")
    print(f"[sync-cocos-app-icon] 源: {os.path.relpath(SOURCE, ROOT)}")

    # ── iOS 应用图标（拍平到纯黑，满足 App Store 无 alpha 要求）──
    iconset = os.path.join(COCOS, "native/engine/ios/Images.xcassets/AppIcon.appiconset")
    for px in IOS_ICON_PX:
        write_icon(os.path.join(iconset, f"{px}.png"), px, flatten=True)

    # ── Android 应用图标（保留圆角透明，桌面更自然）──
    android_res = os.path.join(COCOS, "native/engine/android/res")
    for folder, size in ANDROID_MIPMAP.items():
        write_icon(os.path.join(android_res, folder, "ic_launcher.png"), size, flatten=False)

    # ── iOS 启动画面（全屏深色底 + 居中图标）──
    ios_dir = os.path.join(COCOS, "native/engine/ios")
    for name in (
        "LaunchScreenBackground.png",
        "LaunchScreenBackgroundPortrait.png",
        "LaunchScreenBackgroundLandscape.png",
    ):
        write_splash(os.path.join(ios_dir, name))

    # ── 编辑器图标来源（build-assets：构建面板 Icon 选项的来源，保持一致避免回退）──
    build_assets = os.path.join(COCOS, "build-assets")
    write_tile(os.path.join(build_assets, "icon.png"))
    write_tile(os.path.join(build_assets, "icon-dark.png"))
    for folder, size in ANDROID_MIPMAP.items():
        write_icon(os.path.join(build_assets, "android/res", folder, "ic_launcher.png"), size, flatten=False)
        write_icon(os.path.join(build_assets, "android/res", folder, "ic_launcher_round.png"), size, flatten=False)
    write_icon(os.path.join(build_assets, "android/res", "ic_launcher-playstore.png"), 512, flatten=True)

    print("[sync-cocos-app-icon] 完成 — Cocos iOS/Android 图标与 iOS 启动画面已同步")


if __name__ == "__main__":
    main()
