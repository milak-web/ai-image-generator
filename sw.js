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
  const url = event.request.url;
  // Completely skip API calls and local proxy to avoid Service Worker interference
  if (url.includes('/sdapi/v1/') || url.includes('gradio.live') || url.includes(':8000') || url.includes('/proxy') || url.includes('/health')) {
    return;
  }

  // Handle local assets normally
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});