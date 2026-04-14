// Kill-switch service worker:
// 1) Immediately activates.
// 2) Deletes all old caches from previous buggy builds.
// 3) Unregisters itself so future loads are always fresh from network.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();

    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const page of pages) {
      page.navigate(page.url);
    }
  })());
});
