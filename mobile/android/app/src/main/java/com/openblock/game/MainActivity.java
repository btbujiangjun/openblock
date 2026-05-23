package com.openblock.game;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import java.io.File;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        /*
         * Android Capacitor 默认运行在 https://localhost，本地源支持 Service Worker。
         * 旧版 APK 若注册过 SW / 缓存过旧 index.html，升级后可能继续返回旧入口，
         * 导致新 APK 明明包含资源但 WebView 仍显示“游戏脚本未加载”。
         *
         * iOS 使用 capacitor:// scheme，基本不会走同一套 SW 缓存链路。
         * 因此 Android 启动时主动清理 WebView HTTP/SW 缓存，但保留 LocalStorage
         * （玩家进度与离线快照不受影响）。
         */
        clearStaleWebViewCache();
        super.onCreate(savedInstanceState);
    }

    private void clearStaleWebViewCache() {
        try {
            WebView.setWebContentsDebuggingEnabled(true);
            WebView webView = new WebView(this);
            webView.clearCache(true);
            webView.destroy();
        } catch (Throwable ignored) {
            // Cache cleanup is best-effort. Never block app startup.
        }

        File webViewRoot = new File(getApplicationInfo().dataDir, "app_webview/Default");
        deleteRecursively(new File(webViewRoot, "Service Worker"));
        deleteRecursively(new File(webViewRoot, "Cache"));
        deleteRecursively(new File(webViewRoot, "Code Cache"));
    }

    private void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) deleteRecursively(child);
            }
        }
        try {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        } catch (Throwable ignored) {
            // Best effort.
        }
    }
}
