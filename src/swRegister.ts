/**
 * Đăng ký Service Worker cho PWA
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });

      console.log('[PWA] Service Worker đăng ký thành công với scope:', registration.scope);

      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (installingWorker) {
          installingWorker.onstatechange = () => {
            if (installingWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                console.log('[PWA] Đã có phiên bản mới của ứng dụng.');
              } else {
                console.log('[PWA] Tài nguyên App Shell đã được lưu cache hoàn tất để chạy offline.');
              }
            }
          };
        }
      };

      return registration;
    } catch (error) {
      console.error('[PWA] Đăng ký Service Worker thất bại:', error);
    }
  }
  return null;
}

