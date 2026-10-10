const CACHE = 'becs-ui-v1';
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(c => c.addAll(['/','/assets/styles.css','/assets/app.js','/assets/icon.svg','/assets/manifest.webmanifest']))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch', event => { if(event.request.method !== 'GET' || new URL(event.request.url).pathname.startsWith('/api/')) return; event.respondWith(fetch(event.request).catch(()=>caches.match(event.request))); });
