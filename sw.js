// Приложение работает без интернета. При изменении файлов надо поднять VERSION.
const VERSION = 'poker-diary-0.2.1';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'logic.js', 'store.js',
  'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request, { ignoreSearch: true })
    .then((hit) => hit ?? fetch(event.request)));
});
