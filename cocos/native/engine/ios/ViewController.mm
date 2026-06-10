/****************************************************************************
 Copyright (c) 2013 cocos2d-x.org
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

#import "ViewController.h"
#import "AppDelegate.h"
#import "platform/ios/AppDelegateBridge.h"
//#include "cocos/platform/Device.h"

namespace {
//    cc::Device::Orientation _lastOrientation;
}

@interface ViewController ()
 
@end

@implementation ViewController


- (BOOL) shouldAutorotate {
    return YES;
}

//fix not hide status on ios7
- (BOOL)prefersStatusBarHidden {
    return YES;
}

// 推迟所有边缘系统手势（Home 上滑、控制中心下拉、通知中心、左右返回）的识别，
// 让 app 优先拿到第一次 swipe。否则 iOS 的 SystemGestureGateGestureRecognizer 会在 touch-start
// 后 hold 住 touch-move 事件 ~500-1500ms 进行手势仲裁，表现是"拖动卡住一阵子才动一下"。
// 日志特征：`<UISystemGestureGateGestureRecognizer> Gesture: System gesture gate timed out.`
- (UIRectEdge)preferredScreenEdgesDeferringSystemGestures
{
    return UIRectEdgeAll;
}

// ⭐ 关键：苹果文档明确说明 ——
// "preferredScreenEdgesDeferringSystemGestures is invalidation if prefersHomeIndicatorAutoHidden is NO"
// 即 home indicator 不自动隐藏时，边缘手势 deferral 完全不生效。
// 必须返回 YES，否则上面 UIRectEdgeAll 是空设置 → 拖动事件被 gesture gate 吞掉。
// 副作用：home indicator 在游戏内会自动 dim/隐藏（约 4s 闲置后），玩家有动作时会回来——
// 这是大多数全屏游戏的标准做法（《Wordscapes》《Block Blast》等都这么做）。
- (BOOL)prefersHomeIndicatorAutoHidden {
    return YES;
}

// iPad Stage Manager / 多任务边缘手势在 viewDidAppear 后才真正生效；
// 显式触发一次更新，让上面的 prefersHomeIndicatorAutoHidden / preferredScreenEdgesDeferringSystemGestures
// 在 first-paint 之后立刻被 iOS 采纳，避免开局 1~2 秒内仍然被 system gesture gate 拦截。
- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    [self setNeedsUpdateOfHomeIndicatorAutoHidden];
    if (@available(iOS 11.0, *)) {
        [self setNeedsUpdateOfScreenEdgesDeferringSystemGestures];
    }
}

- (void)viewWillTransitionToSize:(CGSize)size withTransitionCoordinator:(id<UIViewControllerTransitionCoordinator>)coordinator {
   AppDelegate* delegate = [[UIApplication sharedApplication] delegate];
   [delegate.appDelegateBridge viewWillTransitionToSize:size withTransitionCoordinator:coordinator];
   float pixelRatio = [delegate.appDelegateBridge getPixelRatio];

   //CAMetalLayer is available on ios8.0, ios-simulator13.0.
   CAMetalLayer *layer = (CAMetalLayer *)self.view.layer;
   CGSize tsize             = CGSizeMake(static_cast<int>(size.width * pixelRatio),
                                         static_cast<int>(size.height * pixelRatio));
   layer.drawableSize = tsize;
}

@end
