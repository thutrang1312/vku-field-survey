const CACHE_NAME = 'vku-survey-shell-v1';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.svg'
];

// Cài đặt Service Worker và lưu cache App Shell (HTML, CSS, JS, icons)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching App Shell');
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Kích hoạt Service Worker và dọn dẹp cache cũ
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[Service Worker] Xóa cache cũ:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Chiến lược Cache-First cho tài nguyên tĩnh để khởi động offline < 1 giây
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Chỉ xử lý các yêu cầu GET và cùng domain (hoặc tài nguyên tĩnh)
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Bỏ qua các yêu cầu chrome-extension hoặc API ngoài
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Chiến lược Cache-First: Tìm trong cache trước, nếu có trả về ngay lập tức (<1s)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Tìm thấy trong cache -> Trả về ngay lập tức
        // Có thể cập nhật nền (stale-while-revalidate) đối với các tệp build
        fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
            }
          })
          .catch(() => {
            // Không có mạng trong lúc fetch nền, dùng bản cache hoàn toàn bình thường
          });
        return cachedResponse;
      }

      // Không có trong cache -> Lấy từ mạng và lưu vào cache
      return fetch(request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });

          return networkResponse;
        })
        .catch(() => {
          // Khi offline và điều hướng trang: trả về index.html App Shell
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Offline resource not available', {
            status: 503,
            statusText: 'Offline'
          });
        });
    })
  );
});

// Xử lý Background Sync API khi mạng kết nối trở lại
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync event triggered:', event.tag);
  if (event.tag === 'sync-surveys' || event.tag === 'vku-sync-queue') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'TRIGGER_BACKGROUND_SYNC',
            tag: event.tag
          });
        });
      })
    );
  }
});

