/****************************************************************************
 Copyright (c) 2010-2013 cocos2d-x.org
 Copyright (c) 2013-2016 Chukong Technologies Inc.
 Copyright (c) 2017-2022 Xiamen Yaji Software Co., Ltd.

 http://www.cocos.com

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated engine source code (the "Software"), a limited,
 worldwide, royalty-free, non-assignable, revocable and non-exclusive license
 to use Cocos Creator solely to develop games on your target platforms. You shall
 not use Cocos Creator software for developing other software or tools that's
 used for developing games. You are not granted to publish, distribute,
 sublicense, and/or sell copies of Cocos Creator.

 The software or tools in this License Agreement are licensed, not sold.
 Xiamen Yaji Software Co., Ltd. reserves all rights not expressly granted to you.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
****************************************************************************/

#import "AppDelegate.h"
#import "ViewController.h"
#import "View.h"
#import <AVFoundation/AVFoundation.h>

#include "platform/ios/IOSPlatform.h"
#import "platform/ios/AppDelegateBridge.h"
#import "service/SDKWrapper.h"

#include "application/ApplicationManager.h"
#include "base/Scheduler.h"
#include "cocos/bindings/jswrapper/SeApi.h"

static NSString *const kOpenBlockNativeTag = @"OpenBlockNative";

#pragma mark -
#pragma mark OpenBlock iOS Taptic bridge (对齐 Capacitor @capacitor/haptics / UIImpactFeedbackGenerator)

/**
 * Cocos JSB `Device.vibrate(seconds)` 在 iOS 上走的是老式系统震动 API，短脉冲（~18ms）
 * 在现代 iPhone 上几乎无体感，且函数存在时会"成功返回"导致 JS 层永远走不到降级路径。
 * 本 Helper 供 Haptics.ts 经 `__openblockHaptic` 或 `jsb.reflection.callStaticMethod` 调用。
 */
@interface OpenBlockHapticHelper : NSObject
+ (void)impact:(NSString *)style;
@end

@implementation OpenBlockHapticHelper

+ (void)impact:(NSString *)style {
    @try {
        NSString *s = style ?: @"light";
        UIImpactFeedbackStyle feedbackStyle = UIImpactFeedbackStyleLight;
        if ([s isEqualToString:@"medium"]) {
            feedbackStyle = UIImpactFeedbackStyleMedium;
        } else if ([s isEqualToString:@"heavy"]) {
            feedbackStyle = UIImpactFeedbackStyleHeavy;
        }
        UIImpactFeedbackGenerator *generator = [[UIImpactFeedbackGenerator alloc] initWithStyle:feedbackStyle];
        [generator prepare];
        [generator impactOccurred];
    } @catch (NSException *e) {
        NSLog(@"[%@] haptic impact failed: %@", kOpenBlockNativeTag, e);
    }
}

@end

static BOOL gOpenBlockHapticBridgeInjected = NO;

static void injectOpenBlockHapticBridge() {
    if (gOpenBlockHapticBridgeInjected) return;
    @try {
        if (!CC_CURRENT_APPLICATION()) return;
        auto sche = CC_CURRENT_ENGINE()->getScheduler();
        if (!sche) return;

        sche->performFunctionInCocosThread([]() {
            se::AutoHandleScope hs;
            const char *js =
                "try{"
                " if(typeof globalThis.__openblockHaptic!=='function'){"
                "  globalThis.__openblockHaptic=function(style){"
                "   try{"
                "    if(typeof jsb!=='undefined'&&jsb.reflection){"
                "     jsb.reflection.callStaticMethod('OpenBlockHapticHelper','impact:',String(style||'light'));"
                "    }"
                "   }catch(e){}"
                "  };"
                "  console.log('[OpenBlock][Native] __openblockHaptic bridge installed');"
                " }"
                "}catch(e){ try{console.warn('[OpenBlock][Native] haptic bridge inject fail',e);}catch(_){} }";
            se::ScriptEngine::getInstance()->evalString(js);
            gOpenBlockHapticBridgeInjected = YES;
        });
    } @catch (NSException *e) {
        NSLog(@"[%@] injectOpenBlockHapticBridge failed: %@", kOpenBlockNativeTag, e);
    }
}

@implementation AppDelegate
@synthesize window;
@synthesize appDelegateBridge;

#pragma mark -
#pragma mark OpenBlock native → JS bridge (对齐 Android AppActivity.emitJsLowMemory)

/**
 * 把 native 内存信号桥到 JS 主线程。与 Android AppActivity.emitJsLowMemory 严格同构：
 * Cocos Creator 3.x Game.EVENT_LOW_MEMORY 字符串值 = 'game_on_low_memory'。
 * Bootstrap 已订阅，会执行 trim 粒子 + cancelActiveDrag。
 */
static void emitJsLowMemory(NSString *reason) {
    @try {
        if (!CC_CURRENT_APPLICATION()) return;
        auto sche = CC_CURRENT_ENGINE()->getScheduler();
        if (!sche) return;

        std::string reasonStr = reason ? [reason UTF8String] : "unknown";
        sche->performFunctionInCocosThread([reasonStr]() {
            se::AutoHandleScope hs;
            char js[640] = {0};
            snprintf(js, sizeof(js),
                "try{ if (typeof cc !== 'undefined' && cc) {"
                "  console.warn('[OpenBlock][Native] LOW_MEMORY from %s');"
                "  if (cc.game && cc.game.emit) cc.game.emit('game_on_low_memory');"
                "} }catch(e){ try{console.warn('[OpenBlock][Native] emit fail', e);}catch(_){} }",
                reasonStr.c_str());
            se::ScriptEngine::getInstance()->evalString(js);
        });
    } @catch (NSException *e) {
        NSLog(@"[%@] emitJsLowMemory failed: %@", kOpenBlockNativeTag, e);
    }
}

/**
 * 渲染/交互策略（对齐 Android AppActivity.applyHighRefreshRate + onResume 重应用 immersive）：
 *   - idleTimerDisabled：防自动息屏，避免 Metal surface 被系统回收后回前台黑屏；
 *   - 重刷 home indicator / 边缘手势 deferral：回前台后 reassert，避免 system gesture gate 吞触摸。
 *
 * 注：高刷/降帧由引擎内部 CADisplayLink 控制，上层经 JS 的 FrameRate（game.frameRate）统一管理
 *     （空闲 30fps / 交互 60fps，对齐 Android）。原生侧不再重复设置，避免与引擎/JS 抢帧率。
 */
- (void)applyRenderingPolicy {
    @try {
        [UIApplication sharedApplication].idleTimerDisabled = YES;
        if (_viewController) {
            [_viewController setNeedsUpdateOfHomeIndicatorAutoHidden];
            if (@available(iOS 11.0, *)) {
                [_viewController setNeedsUpdateOfScreenEdgesDeferringSystemGestures];
            }
        }
    } @catch (NSException *e) {
        NSLog(@"[%@] applyRenderingPolicy failed: %@", kOpenBlockNativeTag, e);
    }
}

#pragma mark -
#pragma mark Application lifecycle

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
    // ---------------------------------------------------------------------------
    // 已知 Cocos 3.x 引擎缺陷（不在本仓库内、需绕过）：
    //   CCMTLSwapchain::doInit 在 RenderQueue 后台线程访问 CAMetalLayer（UIView 的 layer），
    //   iOS Main Thread Checker 会刷 "Modifying properties of a view's layer off the main thread is not allowed"。
    //   iOS 17/18 上偶发可见为"页面无响应/卡死"——这是引擎层 Race，不在 JS / 本文件可修。
    //
    // 排查建议（仅当真机 hang 复现）：
    //   1) Xcode → 当前 scheme → Edit Scheme → Run → Diagnostics → 取消勾选 "Main Thread Checker"。
    //      这只关闭报告，潜在 race 仍在；但能避免被 MTC 升级为 abort。
    //   2) 升级到修复了 CCMTLSwapchain 的 Cocos Creator 版本（建议 3.8.5+ 跟踪官方 changelog）。
    //   3) 若锁竖屏，可禁用 emit('canvas-resize')；本工程 Bootstrap 已把它收敛为"viewport key 真变才 emit 一次"。
    // ---------------------------------------------------------------------------

    // 与 mobile/ios 的 Capacitor 客户端保持一致：把 AVAudioSession 切到 .playback。
    // 默认 iOS 应用走 SoloAmbient，物理静音开关打开后整个游戏都听不到 SFX——
    // 这是用户反馈"安卓正常、iOS 无声"的真实根因（Android 无静音开关语义）。
    // .mixWithOthers 让玩家同时听到 Apple Music / 后台音乐 App，避免抢占。
    NSError *audioErr = nil;
    AVAudioSession *session = [AVAudioSession sharedInstance];
    if (![session setCategory:AVAudioSessionCategoryPlayback
                         mode:AVAudioSessionModeDefault
                      options:AVAudioSessionCategoryOptionMixWithOthers
                        error:&audioErr]) {
        NSLog(@"[AppDelegate] AVAudioSession setCategory failed: %@", audioErr);
    }
    if (![session setActive:YES error:&audioErr]) {
        NSLog(@"[AppDelegate] AVAudioSession setActive failed: %@", audioErr);
    }

    [[SDKWrapper shared] application:application didFinishLaunchingWithOptions:launchOptions];
    appDelegateBridge = [[AppDelegateBridge alloc] init];

    // Add the view controller's view to the window and display.
    CGRect bounds = [[UIScreen mainScreen] bounds];
    self.window   = [[UIWindow alloc] initWithFrame:bounds];

    // Should create view controller first, cc::Application will use it.
    _viewController                           = [[ViewController alloc] init];
    _viewController.view                      = [[View alloc] initWithFrame:bounds];
    _viewController.view.contentScaleFactor   = UIScreen.mainScreen.scale;
    _viewController.view.multipleTouchEnabled = true;
    // ⭐ 让 Metal view 独占触摸：避免 UIWindow 上的系统手势识别器（SystemGestureGateGestureRecognizer 等）
    // 在 touch-start 之后 hold 住 touch-move 事件做仲裁——根因日志特征是
    // "<UISystemGestureGateGestureRecognizer> Gesture: System gesture gate timed out."，
    // 业务感受是"拖动卡顿/中段消失/抬起才更新"。配合 ViewController 的 home indicator 自动隐藏与
    // preferredScreenEdgesDeferringSystemGestures=All，可把 system gesture 完全推迟到我们处理完之后。
    _viewController.view.exclusiveTouch = YES;
    [self.window setRootViewController:_viewController];

    [self.window makeKeyAndVisible];
    [appDelegateBridge application:application didFinishLaunchingWithOptions:launchOptions];
    [self applyRenderingPolicy];
    injectOpenBlockHapticBridge();
    return YES;
}

- (void)applicationWillResignActive:(UIApplication *)application {
    /*
     Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
     Use this method to pause ongoing tasks, disable timers, and throttle down OpenGL ES frame rates. Games should use this method to pause the game.
     */
    [[SDKWrapper shared] applicationWillResignActive:application];
    [appDelegateBridge applicationWillResignActive:application];
}

- (void)applicationDidBecomeActive:(UIApplication *)application {
    /*
     Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
     */
    // 通话 / Siri / 闹钟打断后，AVAudioSession 可能被系统置为 inactive。
    // 切回前台立即重新激活，否则后续 SFX 会"静默"——这里幂等，已是 active 状态也无副作用。
    NSError *audioErr = nil;
    if (![[AVAudioSession sharedInstance] setActive:YES error:&audioErr]) {
        NSLog(@"[AppDelegate] AVAudioSession reactivate failed: %@", audioErr);
    }

    [[SDKWrapper shared] applicationDidBecomeActive:application];
    [appDelegateBridge applicationDidBecomeActive:application];
    // 对齐 Android onResume：回前台后重应用渲染策略（常亮 + 高刷 + 手势 deferral），
    // 降低 Metal surface 回收后 Graphics draw command 落空导致的黑屏概率。
    [self applyRenderingPolicy];
    injectOpenBlockHapticBridge();
}

- (void)applicationDidEnterBackground:(UIApplication *)application {
    /*
     Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
     If your application supports background execution, called instead of applicationWillTerminate: when the user quits.
     */
    [[SDKWrapper shared] applicationDidEnterBackground:application];
}

- (void)applicationWillEnterForeground:(UIApplication *)application {
    /*
     Called as part of  transition from the background to the inactive state: here you can undo many of the changes made on entering the background.
     */
    [[SDKWrapper shared] applicationWillEnterForeground:application];
}

- (void)applicationWillTerminate:(UIApplication *)application {
    [[SDKWrapper shared] applicationWillTerminate:application];
    [appDelegateBridge applicationWillTerminate:application];
}

#pragma mark -
#pragma mark Memory management

- (void)applicationDidReceiveMemoryWarning:(UIApplication *)application {
    NSLog(@"[%@] applicationDidReceiveMemoryWarning() forwarding to JS", kOpenBlockNativeTag);
    [[SDKWrapper shared] applicationDidReceiveMemoryWarning:application];
    // 引擎路径：cc::events::LowMemory::broadcast() → Cocos EVENT_LOW_MEMORY
    [appDelegateBridge applicationDidReceiveMemoryWarning:application];
    // 直连 JS 路径（对齐 Android emitJsLowMemory）：比引擎链路更早一拍，
    // 在系统决定挂起 app 之前先把 ambient 粒子等可重生视觉资源吐出去。
    emitJsLowMemory(@"native-didReceiveMemoryWarning");
}

@end
