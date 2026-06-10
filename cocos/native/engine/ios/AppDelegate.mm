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

@implementation AppDelegate
@synthesize window;
@synthesize appDelegateBridge;

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
    [[SDKWrapper shared] applicationDidReceiveMemoryWarning:application];
}

@end
