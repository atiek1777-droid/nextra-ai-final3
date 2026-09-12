// sw.js — Service Worker بسيط لـ Nextra AI
// يسمح بتثبيت الموقع كتطبيق (PWA) على أندرويد وآيفون.
// لا يخزن مؤقتاً محادثات أو استدعاءات API — فقط يحقق شرط "قابل للتثبيت".

const CACHE_NAME = 'nextra-shell-v1';
const SHELL_FILES = ['/', '/nextra-logo.png', '/nextra-mark.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // لا نتدخل أبداً بطلبات API — تبقى دائماً مباشرة وحية
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
