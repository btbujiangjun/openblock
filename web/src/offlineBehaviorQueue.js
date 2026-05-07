/**
 * OfflineBehaviorQueue - 离线行为队列
 * 
 * 功能：
 * 1. 离线时缓存行为数据到 IndexedDB
 * 2. 联网后自动同步到后端
 * 3. 支持批量同步
 */
// 队列只用 fetch + 项目环境变量解析 baseUrl，避免与配置层强耦合；保留注释作为后续接入提示。
import { getApiBaseUrl } from './config.js';

const DB_NAME = 'openblock-offline-queue';
const DB_VERSION = 1;
const STORE_NAME = 'behaviors';
const SYNC_BATCH_SIZE = 50;

/**
 * 打开 IndexedDB
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('synced', 'synced', { unique: false });
      }
    };
    
    request.onsuccess = () => resolve(request.result);
  });
}

/**
 * 添加行为到队列
 */
export async function queueBehavior(behavior) {
  if (!behavior || !behavior.eventType) return false;
  
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    const record = {
      eventType: behavior.eventType,
      sessionId: behavior.sessionId || null,
      userId: behavior.userId || '',
      data: behavior.data || {},
      gameState: behavior.gameState || {},
      timestamp: behavior.timestamp || Date.now(),
      synced: false,
      retryCount: 0
    };
    
    store.add(record);
    
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.warn('[OfflineQueue] Failed to add behavior:', e);
    return false;
  }
}

/**
 * 批量添加行为
 */
export async function queueBehaviors(behaviors) {
  if (!Array.isArray(behaviors) || behaviors.length === 0) return 0;
  
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    for (const behavior of behaviors) {
      if (behavior && behavior.eventType) {
        store.add({
          eventType: behavior.eventType,
          sessionId: behavior.sessionId || null,
          userId: behavior.userId || '',
          data: behavior.data || {},
          gameState: behavior.gameState || {},
          timestamp: behavior.timestamp || Date.now(),
          synced: false,
          retryCount: 0
        });
      }
    }
    
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(behaviors.length);
      tx.onerror = () => resolve(0);
    });
  } catch (e) {
    console.warn('[OfflineQueue] Failed to batch add:', e);
    return 0;
  }
}

/**
 * 获取待同步行为
 */
async function getPendingBehaviors(limit = SYNC_BATCH_SIZE) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('synced');
    
    return new Promise((resolve) => {
      const results = [];
      const request = index.openCursor(IDBKeyRange.only(false));
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      
      request.onerror = () => resolve(results);
    });
  } catch (e) {
    console.warn('[OfflineQueue] Failed to get pending:', e);
    return [];
  }
}

/**
 * 同步到后端
 */
export async function syncToBackend() {
  if (!navigator.onLine) {
    console.log('[OfflineQueue] Offline, skipping sync');
    return { synced: 0, failed: 0, queued: await getQueueCount() };
  }
  
  const baseUrl = getApiBaseUrl().replace(/\/+$/, '');
  const behaviors = await getPendingBehaviors(SYNC_BATCH_SIZE);
  
  if (behaviors.length === 0) {
    return { synced: 0, failed: 0, queued: 0 };
  }
  
  console.log('[OfflineQueue] Syncing', behaviors.length, 'behaviors...');
  
  try {
    const response = await fetch(`${baseUrl}/api/behavior/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ behaviors })
    });
    
    if (response.ok) {
      // 标记已同步
      await markSynced(behaviors.map(b => b.id));
      console.log('[OfflineQueue] Synced', behaviors.length, 'behaviors');
      return { 
        synced: behaviors.length, 
        failed: 0,
        queued: await getQueueCount()
      };
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (e) {
    console.warn('[OfflineQueue] Sync failed:', e);
    // 增加重试计数
    await incrementRetryCount(behaviors.map(b => b.id));
    return { 
      synced: 0, 
      failed: behaviors.length,
      queued: await getQueueCount(),
      error: e.message
    };
  }
}

/**
 * 标记行为已同步
 */
async function markSynced(ids) {
  if (!ids.length) return;
  
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    for (const id of ids) {
      const request = store.get(id);
      request.onsuccess = () => {
        const record = request.result;
        if (record) {
          record.synced = true;
          store.put(record);
        }
      };
    }
  } catch (e) {
    console.warn('[OfflineQueue] Failed to mark synced:', e);
  }
}

/**
 * 增加重试计数
 */
async function incrementRetryCount(ids) {
  if (!ids.length) return;
  
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    for (const id of ids) {
      const request = store.get(id);
      request.onsuccess = () => {
        const record = request.result;
        if (record && record.retryCount !== undefined) {
          record.retryCount += 1;
          // 超过 5 次重试，标记为已同步（丢弃）
          if (record.retryCount > 5) {
            record.synced = true;
          }
          store.put(record);
        }
      };
    }
  } catch (e) {
    console.warn('[OfflineQueue] Failed to increment retry:', e);
  }
}

/**
 * 获取队列数量
 */
export async function getQueueCount() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('synced');
    
    return new Promise((resolve) => {
      const request = index.count(IDBKeyRange.only(false));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

/**
 * 清空已同步数据
 */
export async function clearSynced() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('synced');
    
    const request = index.openCursor(IDBKeyRange.only(true));
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * 自动同步（定期调用）
 */
let _syncTimer = null;
let _syncInterval = 30000; // 30 秒

/**
 * 启动自动同步
 */
export function startAutoSync(interval = 30000) {
  _syncInterval = interval;
  
  if (_syncTimer) {
    clearInterval(_syncTimer);
  }
  
  // 立即同步一次
  syncToBackend();
  
  // 定期同步
  _syncTimer = setInterval(() => {
    if (navigator.onLine) {
      syncToBackend();
    }
  }, _syncInterval);
  
  // 监听网络状态变化
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      console.log('[OfflineQueue] Back online, syncing...');
      syncToBackend();
    });
  }
  
  console.log('[OfflineQueue] Auto sync started, interval:', _syncInterval);
}

/**
 * 停止自动同步
 */
export function stopAutoSync() {
  if (_syncTimer) {
    clearInterval(_syncTimer);
    _syncTimer = null;
  }
  console.log('[OfflineQueue] Auto sync stopped');
}

/**
 * 获取队列状态
 */
export async function getQueueStatus() {
  return {
    pending: await getQueueCount(),
    online: navigator.onLine,
    autoSync: _syncTimer !== null
  };
}