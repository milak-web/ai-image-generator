const CACHE_NAME = 'pixelforge-v1';
const ASSETS = [
  './',
  'index.html',
  'logo.svg',
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

  // For GitHub Pages: Only cache our own static assets
  // External API calls (SD, Gradio, Proxies) should ALWAYS be fetched directly
  if (url.origin !== selfOrigin) {
    return;
  }

  // Handle local assets normally
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
