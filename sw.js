const CACHE_NAME = 'ai-studio-v1';
const ASSETS = [
  'index.html',
  'manifest.json',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const selfOrigin = new URL(self.location.origin).origin;

  // Completely skip any requests that aren't for our own origin's static assets
  // This prevents the Service Worker from interfering with API calls, proxies, or local servers
  if (url.origin !== selfOrigin || url.port === '8000' || url.pathname.includes('/sdapi/') || url.pathname.includes('/proxy') || url.pathname.includes('/health')) {
    return;
  }

  // Handle local assets normally
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});