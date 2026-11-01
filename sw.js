/* Weekwise service worker: caches the app shell for offline use.
   Network first (so updates show up when online), cache as the offline fallback.
   Change CACHE's version number whenever you edit files, to clear old copies. */
const CACHE = 'weekwise-v3';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow('./')));
});

/* Best-effort background check (Chrome on Android, installed app). The browser chooses when it runs. */
function idb(mode, fn) {
  return new Promise(res => { try {
    const q = indexedDB.open('weekwise', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('kv');
    q.onsuccess = () => { const tx = q.result.transaction('kv', mode); const r = fn(tx.objectStore('kv')); tx.oncomplete = () => res(r && r.result); tx.onerror = tx.onabort = () => res(); };
    q.onerror = () => res();
  } catch (e) { res(); } });
}
self.addEventListener('periodicsync', e => { if (e.tag === 'weekwise-check') e.waitUntil(bgCheck()); });
async function bgCheck() {
  const d = await idb('readonly', s => s.get('snap'));
  if (!d || !d.settings || !d.settings.notify) return;
  const n = new Date(), z = x => String(x).padStart(2, '0'), today = n.getFullYear() + '-' + z(n.getMonth() + 1) + '-' + z(n.getDate());
  const sent = Object.assign({}, d.notified || {}, (await idb('readonly', s => s.get('swn'))) || {});
  for (const k in sent) if (!k.startsWith(today)) delete sent[k];
  for (const a of d.assignments || []) {
    if (a.done || a.due !== today || sent[today + ':' + a.id]) continue;
    await self.registration.showNotification('Due today: ' + a.title, { body: a.subject || 'Assignment', tag: 'as-' + a.id, icon: 'icon-192.png' });
    sent[today + ':' + a.id] = true;
  }
  const open = (d.assignments || []).filter(a => !a.done).length, hm = z(n.getHours()) + ':' + z(n.getMinutes());
  if (d.settings.satOn && n.getDay() === 6 && hm >= d.settings.satTime && open && !sent[today + ':sat']) {
    await self.registration.showNotification('Weekwise', { body: open + ' unfinished assignment' + (open > 1 ? 's' : '') + ' before Sunday', tag: 'sat', icon: 'icon-192.png' });
    sent[today + ':sat'] = true;
  }
  await idb('readwrite', s => s.put(sent, 'swn'));
}
