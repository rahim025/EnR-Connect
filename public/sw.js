// Cache hors ligne : la page se charge d'abord depuis le réseau (donc toujours la dernière version),
// et depuis la mémoire du téléphone quand il n'y a pas de réseau. Les fichiers à nom unique sont gardés.
const CACHE = 'enr-connect';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

async function garder(req, res) {
  if (!res || !res.ok) return res;
  const c = await caches.open(CACHE);
  await c.put(req, res.clone());
  const cles = await c.keys();
  if (cles.length > 60) await c.delete(cles[0]); // le cache ne grossit pas indéfiniment
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;            // Firebase, Google… : jamais touchés
  if (url.pathname.endsWith('version.json')) return;     // toujours directement le réseau

  const page = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  if (page) {
    e.respondWith(
      fetch(req).then(res => garder(req, res))
        .catch(() => caches.match(req).then(r => r || caches.match(self.registration.scope)))
    );
  } else {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => garder(req, res))));
  }
});
