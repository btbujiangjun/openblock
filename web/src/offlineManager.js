/**
 * OfflineManager - 离线能力管理器
 * 
 * 整合 Service Worker、离线队列、网络状态监控
 */
import { 
  queueBehavior, 
  startAutoSync, 
  stopAutoSync, 
  getQueueStatus,
  syncToBackend 
} from './offlineBehaviorQueue.js';

let _initialized = false;
let _networkStatusCallbacks = [];

/**
 * 初始化离线能力
 */
export async function initOfflineManager() {
  if (_initialized) return;
  
  console.log('[OfflineManager] Initializing...');
  
  // 启动自动同步
  startAutoSync(30000);
  
  // 监听网络状态变化
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      console.log('[OfflineManager] Online');
      _notifyNetworkChange(true);
      // 立即尝试同步
      syncToBackend();
    });
    
    window.addEventListener('offline', () => {
      console.log('[OfflineManager] Offline');
      _notifyNetworkChange(false);
    });
  }
  
  _initialized = true;
  console.log('[OfflineManager] Initialized');
}

/**
 * 通知网络状态变化
 */
function _notifyNetworkChange(online) {
  for (const cb of _networkStatusCallbacks) {
    try {
      cb(online);
    } catch (e) {
      console.warn('[OfflineManager] Callback error:', e);
    }
  }
}

/**
 * 记录行为（自动处理离线情况）
 * @param {string} eventType 事件类型
 * @param {object} data 事件数据
 * @param {object} gameState 游戏状态
 */
export async function logBehavior(eventType, data = {}, gameState = {}) {
  const behavior = {
    eventType,
    data,
    gameState,
    timestamp: Date.now()
  };
  
  // 如果在线，尝试直接发送到后端
  if (navigator.onLine) {
    try {
      const baseUrl = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:5000';
      await fetch(`${baseUrl}/api/behavior`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(behavior)
      });
      return true;
    } catch {
      // 网络错误，存入离线队列
      console.log('[OfflineManager] Network error, queueing:', eventType);
    }
  }
  
  // 离线或发送失败，存入队列
  return queueBehavior(behavior);
}

/**
 * 注册网络状态变化回调
 */
export function onNetworkStatusChange(callback) {
  _networkStatusCallbacks.push(callback);
  return () => {
    const idx = _networkStatusCallbacks.indexOf(callback);
    if (idx >= 0) _networkStatusCallbacks.splice(idx, 1);
  };
}

/**
 * 获取离线状态
 */
export async function getOfflineStatus() {
  const status = await getQueueStatus();
  return {
    ...status,
    isOffline: !navigator.onLine
  };
}

/**
 * 强制同步
 */
export async function forceSync() {
  return syncToBackend();
}

/**
 * 停止离线管理
 */
export function shutdownOfflineManager() {
  stopAutoSync();
  _initialized = false;
}

/**
 * PWA 安装处理
 */
export function initPWAInstall() {
  if (typeof window === 'undefined') return;
  
  let deferredPrompt = null;
  
  // 监听安装提示事件
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] Install prompt available');
    
    // 可以触发自定义安装按钮
    window.dispatchEvent(new CustomEvent('pwa-install-ready', { 
      detail: { prompt: e } 
    }));
  });
  
  // 监听安装完成
  window.addEventListener('appinstalled', (e) => {
    console.log('[PWA] Installed:', e);
    deferredPrompt = null;
    window.dispatchEvent(new CustomEvent('pwa-installed'));
  });
  
  // 暴露安装函数
  window.pwaInstall = async () => {
    if (!deferredPrompt) return false;
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('[PWA] Install choice:', outcome);
    deferredPrompt = null;
    return outcome === 'accepted';
  };
}