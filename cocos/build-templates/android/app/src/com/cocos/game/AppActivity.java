/****************************************************************************
Copyright (c) 2015-2016 Chukong Technologies Inc.
Copyright (c) 2017-2018 Xiamen Yaji Software Co., Ltd.

http://www.cocos2d-x.org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
****************************************************************************/
package com.cocos.game;

import android.os.Bundle;
import android.os.Build;
import android.content.Intent;
import android.content.ComponentCallbacks2;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import java.util.ArrayList;
import java.util.List;

import com.cocos.service.SDKWrapper;
import com.cocos.lib.CocosActivity;
import com.cocos.lib.CocosHelper;

public class AppActivity extends CocosActivity {

    private static final String TAG = "OpenBlockNative";

    /**
     * 窗口是否当前持有焦点。HOME / 最近任务 / 通知中心 下拉 / 来电浮窗 等都会令其变 false。
     *
     * 用途：installSystemUiReassertListener 和 onWindowFocusChanged 触发的 applyImmersive
     * 都要受这个开关 gate —— 失焦时还在拼命把 navbar / statusbar 藏回去，会打断系统转场，
     * 直接症状就是「按 HOME 没反应 / 没法退出到桌面」。
     */
    private volatile boolean mHasWindowFocus = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // DO OTHER INITIALIZATION BELOW
        SDKWrapper.shared().init(this);
        installSystemUiReassertListener();
    }

    /**
     * 终极兜底：状态栏每次被系统/HiTouch 召出 → 监听到 visibility 变化 → 立刻重新隐藏。
     *
     * 之前用 IMMERSIVE_STICKY 是「30 秒后自动重新隐藏」；现在升级为「毫秒级重新隐藏」，
     * 让华为 HiTouch 的下拉手势即便被识别，状态栏也只会闪一下就被打回去。
     *
     * 比起反射关 HiTouch（各机型 hwFlags 位含义不统一），这条路径用纯 AOSP API，
     * 在所有 Android 4.4+ 设备上都稳定生效。
     */
    private void installSystemUiReassertListener() {
        try {
            final View decor = getWindow().getDecorView();
            decor.setOnSystemUiVisibilityChangeListener(new View.OnSystemUiVisibilityChangeListener() {
                @Override public void onSystemUiVisibilityChange(int visibility) {
                    // 关键 gate：窗口失焦时（HOME / RECENT / 通知中心 / 来电）系统会主动
                    // 把 FULLSCREEN/HIDE_NAVIGATION 清掉以便显示系统 UI；这时我们绝不能
                    // 再 reassert immersive —— 否则会和系统的转场动画/焦点切换打架，
                    // 表现为「按 HOME 没法退出到桌面」。只有真正在前台时才补刀。
                    if (!mHasWindowFocus) return;
                    if ((visibility & View.SYSTEM_UI_FLAG_FULLSCREEN) == 0
                        || (visibility & View.SYSTEM_UI_FLAG_HIDE_NAVIGATION) == 0) {
                        // 不能在监听器里同步 set（会触发再次回调死循环），post 一次。
                        decor.post(new Runnable() {
                            @Override public void run() {
                                if (mHasWindowFocus) applyImmersive();
                            }
                        });
                    }
                }
            });
        } catch (Throwable t) {
            Log.w(TAG, "installSystemUiReassertListener failed", t);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        SDKWrapper.shared().onResume();
        // 回前台后必须重新应用 immersive，否则状态栏会持续显示。
        applyImmersive();
        // 关键：声明高帧率诉求，对抗华为 EMUI 的"前台 idle 自动降 30Hz"机制。
        // 实测现象：玩家停手 ~5s 后，EMUI 把屏幕从 60Hz 降到 30Hz 同时降低触摸采样率，
        // 导致重新触屏首点经常被丢弃 → 玩家感觉"卡死无法拖动"；15~20s 后系统判定
        // 用户活跃才恢复 60Hz。配合 FLAG_KEEP_SCREEN_ON 防自动息屏。
        applyHighRefreshRate();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // 记录当前焦点状态。失焦（HOME/RECENT/通知中心下拉 等）必须先记下来，
        // 防止 installSystemUiReassertListener 在后台还在 reassert immersive，
        // 打断系统转场，导致按 HOME 退不出去。
        mHasWindowFocus = hasFocus;
        // 关键修复 1/2：每次窗口重新拿到焦点（系统下拉抽屉关闭、弹窗关闭、回前台等）
        // 都要重新设 IMMERSIVE_STICKY。Cocos 父类的 setImmersiveMode 是 private 且只在
        // onCreate 调一次 —— 这就是华为机型「玩着玩着顶部状态栏自己滑出来」的根因。
        if (hasFocus) {
            applyImmersive();
            applyGestureExclusion();
        }
    }

    // ⚠️ 已移除 disableHuaweiHiTouch()。
    //
    // 原本试图通过反射给 LayoutParams.hwFlags 设 0x80000000 来关华为 HiTouch 手势误识别，
    // 但 ADB dumpsys 实测发现 hwFlags=#80000000 在 EMUI（至少在 game_gesture_disabled_mode=1
    // 的华为手机上）真实含义是「禁用所有系统手势」—— 不只是关 HiTouch，连 HOME 上滑、
    // 多任务上滑、侧边返回这些 OS 级手势都被屏蔽，直接症状：「按 HOME 退不出 app」。
    //
    // HiTouch 误识别的问题用 installSystemUiReassertListener + setSystemGestureExclusionRects
    // 已经够用 —— 状态栏即便被召出也会被毫秒级藏回去。0x80000000 的副作用代价远大于收益，
    // 不再启用此 hack。

    /**
     * 重设全屏 immersive sticky flags。值 0x1706 + IMMERSIVE_STICKY (0x1000) = 0x2706
     * 与 Cocos 父类 setImmersiveMode 等价（用常量而非反射，避免每次反射 Field 查找的开销）。
     */
    @SuppressWarnings("deprecation")
    private void applyImmersive() {
        try {
            final View decor = getWindow().getDecorView();
            final int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
            decor.setSystemUiVisibility(flags);
        } catch (Throwable t) {
            Log.w(TAG, "applyImmersive failed", t);
        }
    }

    /**
     * 关键修复 2/2：告诉系统屏幕顶部 ~120dp 和左右边缘 60dp 是「游戏自己的手势区」，
     * 不要识别为「下拉状态栏 / 侧边返回 / 任务切换」。Android 10+ (API 29) 才支持。
     *
     * 候选块在屏幕顶部，玩家拖拽时手指起点经常落在 [0, 120dp] 区间，原本会被 EMUI 误判为
     * 「下拉状态栏」手势导致状态栏滑出 + GL surface 短暂重建。setSystemGestureExclusionRects
     * 之后系统会让这部分手势优先给我们。
     *
     * 限制：Android 强制每条边最多 200dp 屏蔽（防止 app 完全劫持系统手势）。
     */
    /**
     * 强制高帧率 + 屏幕常亮。
     *
     * - FLAG_KEEP_SCREEN_ON: 防 EMUI 自动息屏，同时降低系统对 app 做"省电降级"的概率。
     * - WindowManager.LayoutParams.preferredRefreshRate / preferredDisplayModeId:
     *   告诉系统我们希望屏幕跑在最高刷新率。Android 11+ (API 30) 有 frameRate API 更精准，
     *   但 preferredRefreshRate 在 EMUI 10+ 上已生效。
     *
     * 注意：实际能否拿到 60Hz 取决于设备能力 + 系统省电策略 + 是否插电。
     * 即便系统拒绝，至少 app 主动表达了诉求，EMUI 不会把我们误判为"低优先级 idle app"。
     */
    private void applyHighRefreshRate() {
        try {
            final Window window = getWindow();
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // 找设备支持的最高刷新率，挂上去。
                android.view.Display display = getWindowManager().getDefaultDisplay();
                android.view.Display.Mode[] modes = display.getSupportedModes();
                android.view.Display.Mode best = display.getMode();
                for (android.view.Display.Mode m : modes) {
                    if (m.getRefreshRate() > best.getRefreshRate()
                        && m.getPhysicalWidth() == best.getPhysicalWidth()
                        && m.getPhysicalHeight() == best.getPhysicalHeight()) {
                        best = m;
                    }
                }
                WindowManager.LayoutParams lp = window.getAttributes();
                lp.preferredDisplayModeId = best.getModeId();
                lp.preferredRefreshRate = best.getRefreshRate();
                window.setAttributes(lp);
                Log.i(TAG, "applyHighRefreshRate -> modeId=" + best.getModeId()
                    + " refreshRate=" + best.getRefreshRate()
                    + " (available modes=" + modes.length + ")");
            } else {
                WindowManager.LayoutParams lp = window.getAttributes();
                lp.preferredRefreshRate = 60.0f;
                window.setAttributes(lp);
            }
        } catch (Throwable t) {
            Log.w(TAG, "applyHighRefreshRate failed", t);
        }
    }

    private void applyGestureExclusion() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
        try {
            final View decor = getWindow().getDecorView();
            final int w = decor.getWidth();
            final int h = decor.getHeight();
            if (w <= 0 || h <= 0) return;
            final float density = getResources().getDisplayMetrics().density;
            final int topBand = (int) (120 * density); // 候选区，必须保护
            final int sideBand = (int) (60 * density); // 侧边返回手势
            List<Rect> rects = new ArrayList<>(3);
            rects.add(new Rect(0, 0, w, topBand));
            rects.add(new Rect(0, 0, sideBand, h));
            rects.add(new Rect(w - sideBand, 0, w, h));
            decor.setSystemGestureExclusionRects(rects);
        } catch (Throwable t) {
            Log.w(TAG, "applyGestureExclusion failed", t);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        SDKWrapper.shared().onPause();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        // Workaround in https://stackoverflow.com/questions/16283079/re-launch-of-activity-on-home-button-but-only-the-first-time/16447508
        if (!isTaskRoot()) {
            return;
        }
        SDKWrapper.shared().onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        SDKWrapper.shared().onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        SDKWrapper.shared().onNewIntent(intent);
    }

    @Override
    protected void onRestart() {
        super.onRestart();
        SDKWrapper.shared().onRestart();
    }

    @Override
    protected void onStop() {
        super.onStop();
        SDKWrapper.shared().onStop();
    }

    @Override
    public void onBackPressed() {
        SDKWrapper.shared().onBackPressed();
        super.onBackPressed();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        SDKWrapper.shared().onConfigurationChanged(newConfig);
        super.onConfigurationChanged(newConfig);
    }

    @Override
    protected void onRestoreInstanceState(Bundle savedInstanceState) {
        SDKWrapper.shared().onRestoreInstanceState(savedInstanceState);
        super.onRestoreInstanceState(savedInstanceState);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        SDKWrapper.shared().onSaveInstanceState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onStart() {
        SDKWrapper.shared().onStart();
        super.onStart();
    }

    @Override
    public void onLowMemory() {
        Log.w(TAG, "onLowMemory()  forwarding to JS");
        SDKWrapper.shared().onLowMemory();
        // 转给 JS：让 Bootstrap.onAppLowMemory 立刻 trim 粒子 / 取消拖拽。
        // 比 Cocos 自带的 EVENT_LOW_MEMORY 链路更早一拍——在华为 EMUI
        // 决定"是否锁帧降级"之前先把内存吐出去。
        emitJsLowMemory("native-onLowMemory");
        super.onLowMemory();
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        SDKWrapper.shared().onLowMemory();
        // ComponentCallbacks2 的等级机制（数值越大越严重）：
        //   RUNNING_MODERATE=5   前台、系统开始挤别人
        //   RUNNING_LOW=10       前台、系统压力大
        //   RUNNING_CRITICAL=15  前台、再不释放就要被杀（华为 EMUI 锁帧多发生在此点之后）
        //   UI_HIDDEN=20         app 进后台、UI 已隐藏，可释放渲染资源
        //   BACKGROUND/MODERATE/COMPLETE=40/60/80  后台多级
        // 我们只在前台 ≥RUNNING_LOW 时转发给 JS：避免 RUNNING_MODERATE 太频繁打扰，
        // 也避免后台态触发 trim（后台时玩家看不到，意义不大）。
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW
            && level < ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) {
            Log.w(TAG, "onTrimMemory(level=" + level + ")  forwarding to JS");
            emitJsLowMemory("native-onTrimMemory:" + level);
        } else {
            Log.i(TAG, "onTrimMemory(level=" + level + ")  ignored (not foreground-critical)");
        }
    }

    /**
     * 把 native 内存信号桥到 JS 主线程。我们没改 cc.game 的 C++ 入口，
     * 用 CocosHelper.runOnGameThread 注入一段最小 JS：emit EVENT_LOW_MEMORY。
     * Bootstrap 已订阅，会执行 trim 粒子 + cancelActiveDrag。
     */
    private void emitJsLowMemory(String reason) {
        try {
            // Cocos Creator 3.x Game.EVENT_LOW_MEMORY 字符串值 = 'game_on_low_memory'。
            // 双发：cc.game.emit + 兼容旧版 director.emit，覆盖不同版本路径。
            final String js =
                "try{ if (typeof cc !== 'undefined' && cc) {" +
                "  console.warn('[OpenBlock][Native] LOW_MEMORY from " + reason + "');" +
                "  if (cc.game && cc.game.emit) cc.game.emit('game_on_low_memory');" +
                "} }catch(e){ try{console.warn('[OpenBlock][Native] emit fail', e);}catch(_){} }";
            CocosHelper.runOnGameThread(new Runnable() {
                @Override public void run() {
                    com.cocos.lib.CocosJavascriptJavaBridge.evalString(js);
                }
            });
        } catch (Throwable t) {
            Log.e(TAG, "emitJsLowMemory failed", t);
        }
    }
}
