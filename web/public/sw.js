/**
 * Block Blast Service Worker
 * 完整离线支持 + 行为队列同步
 */

const CACHE_NAME = 'blockblast-v2';
const RUNTIME_CACHE = 'blockblast-runtime-v2';
const OFFLINE_QUEUE_NAME = 'blockblast-offline-queue';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/styles/main.css',
  '/manifest.json'
];

const API_PATTERN = /\/api\//;
const STATIC_ASSET_PATTERN = /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|webp)$/i;

// 缓存策略配置
const CACHE_STRATEGIES = {
  // 静态资源：Stale-While-Revalidate（快速响应，后台更新）
  STATIC: { strategy: 'staleWhileRevalidate', maxAge: 7 * 24 * 60 * 60 },
  // API 数据：Network First（优先最新数据，失败回退缓存）
  API: { strategy: 'networkFirst', maxAge: 5 * 60 },
  // HTML 页面：Network First
  HTML: { strategy: 'networkFirst', maxAge: 0 },
  // 用户数据：Cache First
  DATA: { strategy: 'cacheFirst', maxAge: 24 * 60 * 60 }
};

/**
 * 安装阶段 - 预缓存核心资源
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Precaching:', PRECACHE_URLS);
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => {
        // 立即激活，跳过等待
        return self.skipWaiting();
      })
  );
});

/**
 * 激活阶段 - 清理旧缓存 + claim 客户端
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME && name !== RUNTIME_CACHE && name !== OFFLINE_QUEUE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

/**
 * 请求拦截 - 根据类型选择策略
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 跨域请求
  if (url.origin !== location.origin) {
    // 外部资源使用默认策略
    return;
  }

  // API 请求 - Network First（实时数据）
  if (API_PATTERN.test(url.pathname)) {
    // GET 请求可以缓存（用于离线回退）
    if (request.method === 'GET') {
      event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    } else {
      // POST/PUT 等写请求，尝试在线，失败则加入离线队列
      event.respondWith(networkFirstWithQueue(request));
    }
    return;
  }

  // 导航请求 - Network First
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // 静态资源 - Stale-While-Revalidate
  if (STATIC_ASSET_PATTERN.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // 默认 - 网络优先
  event.respondWith(networkFirst(request));
});

/**
 * Stale-While-Revalidate 策略
 * 立即返回缓存，后台更新
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => {
      // 请求失败，返回缓存或错误
      return cachedResponse || new Response('Offline', { status: 503 });
    });

  // 立即返回缓存，请求在后台进行
  return cachedResponse || fetchPromise;
}

/**
 * Network First 策略
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    if (request.mode === 'navigate') {
      return caches.match('/index.html') || new Response('Offline', { status: 503 });
    }
    return new Response('Offline', { status: 503 });
  }
}

/**
 * Network First with Queue - 写请求离线队列
 */
async function networkFirstWithQueue(request) {
  try {
    return await fetch(request);
  } catch (error) {
    // 网络失败，将请求加入离线队列
    console.log('[SW] Network failed, queueing request:', request.url);
    await queueOfflineRequest(request);
    return new Response(JSON.stringify({ queued: true }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * 离线请求队列
 */
async function queueOfflineRequest(request) {
  try {
    // 读取请求体
    let body = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.clone().text();
    }

    const queueItem = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
      timestamp: Date.now()
    };

    // 存储到 IndexedDB（通过 cache API）
    const cache = await caches.open(OFFLINE_QUEUE_NAME);
    const queueKey = `/queue/${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await cache.put(queueKey, new Response(JSON.stringify(queueItem)));

    console.log('[SW] Request queued:', queueKey);
  } catch (e) {
    console.error('[SW] Failed to queue request:', e);
  }
}

/**
 * 同步离线队列中的请求
 */
async function flushOfflineQueue() {
  try {
    const cache = await caches.open(OFFLINE_QUEUE_NAME);
    const keys = await cache.keys();
    const results = [];

    for (const request of keys) {
      try {
        const response = await cache.match(request);
        const item = JSON.parse(await response.text());
        
        const fetchOptions = {
          method: item.method,
          headers: item.headers
        };
        if (item.body) {
          fetchOptions.body = item.body;
        }

        const result = await fetch(item.url, fetchOptions);
        
        if (result.ok) {
          // 成功，删除队列项
          await cache.delete(request);
          results.push({ url: item.url, success: true });
        }
      } catch (e) {
        results.push({ url: item.url, success: false, error: e.message });
      }
    }

    console.log('[SW] Queue flush results:', results);
    return results;
  } catch (e) {
    console.error('[SW] Failed to flush queue:', e);
    return [];
  }
}

/**
 * 后台同步事件
 */
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'sync-behaviors') {
    event.waitUntil(syncBehaviors());
  } else if (event.tag === 'flush-offline-queue') {
    event.waitUntil(flushOfflineQueue());
  }
});

async function syncBehaviors() {
  console.log('[SW] Syncing offline behaviors...');
  const results = await flushOfflineQueue();
  console.log('[SW] Sync complete:', results.length, 'items');
}

/**
 * 推送通知
 */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  const data = event.data.json();
  const options = {
    body: data.body || '您有新的消息',
    icon: '/assets/images/icon-192.png',
    badge: '/assets/images/icon-192.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/' },
    actions: data.actions || [],
    tag: data.tag || 'default',
    requireInteraction: data.requireInteraction || false
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Block Blast', options)
  );
});

/**
 * 通知点击
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const url = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // 焦点已有窗口或打开新窗口
        for (const client of clientList) {
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        }
        return clients.openWindow(url);
      })
  );
});

/**
 * 消息处理
 */
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'CACHE_URLS':
      cacheUrls(payload.urls);
      break;
    case 'CLEAR_CACHE':
      clearAllCaches();
      break;
    case 'FLUSH_QUEUE':
      flushOfflineQueue();
      break;
    case 'GET_QUEUE_STATUS':
      getQueueStatus().then(status => {
        event.ports[0]?.postMessage(status);
      });
      break;
    default:
      console.log('[SW] Unknown message:', type);
  }
});

async function cacheUrls(urls) {
  const cache = await caches.open(RUNTIME_CACHE);
  await Promise.all(
    urls.map(url => 
      fetch(url)
        .then(r => r.ok && cache.put(url, r))
        .catch(e => console.warn('[SW] Cache URL failed:', url, e))
    )
  );
}

async function clearAllCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.map(key => caches.delete(key)));
}

async function getQueueStatus() {
  try {
    const cache = await caches.open(OFFLINE_QUEUE_NAME);
    const keys = await cache.keys();
    return { queued: keys.length };
  } catch {
    return { queued: 0 };
  }
}

console.log('[SW] Block Blast Service Worker loaded');