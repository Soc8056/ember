// Custom service worker: installable shell + offline Today (NF-3, M1) AND the web-push
// handlers (push / notificationclick / pushsubscriptionchange) for reminders + nudges (M3,
// NOTIF-1/-5/-9). Push is best-effort — if any of this is unsupported the app is unaffected.
const VERSION = 'ember-v9';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/main.js',
  './src/views.js',
  './src/store.js',
  './src/api.js',
  './src/supabase.js',
  './src/config.js',
  './src/dates.js',
  './src/streak.js',
  './src/offline.js',
  './src/photos.js',
  './src/push.js',
  './src/env.js',
  './ember-mark.svg',
  './ember-icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Never cache Supabase API/auth — always go to the network.
  if (url.hostname.endsWith('.supabase.co')) return;

  // Immutable CDN assets (esm.sh modules, Google fonts): cache-first.
  const isCDN = url.hostname === 'esm.sh' || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com');
  if (isCDN) {
    e.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(request, copy));
      return res;
    })));
    return;
  }

  // Same-origin shell: cache-first, fall back to network, then to index.html for navigations.
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(request).then((hit) => hit || fetch(request).catch(() => {
      if (request.mode === 'navigate') return caches.match('./index.html');
      return new Response('', { status: 504 });
    })));
  }
});

// ---- push (NOTIF-1) --------------------------------------------------------
// Payload shape from the server: { title, body, tag, screen: 'today'|'friends', url }.
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  const title = data.title || 'Ember';
  const options = {
    body: data.body || 'Keep your flame going 🔥',
    tag: data.tag || 'ember',              // collapses same-type repeats
    icon: './ember-icon-192.png',
    badge: './ember-mark.svg',
    data: { url: data.url || './', screen: data.screen || 'today' },
    renotify: false,
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// ---- notificationclick (NOTIF-9): focus the app and deep-link the right screen ----------
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const screen = (e.notification.data && e.notification.data.screen) || 'today';
  const target = new URL('./', self.location.href);
  target.searchParams.set('go', screen);   // main.js reads ?go= on focus/load
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.location.origin)) {
        c.postMessage({ type: 'navigate', screen });   // already-open tab: just switch screens
        return c.focus();
      }
    }
    return self.clients.openWindow(target.href);        // nothing open: launch the app
  })());
});

// ---- pushsubscriptionchange (NOTIF-5): silently re-subscribe + hand the new sub to a client
// so it can persist it. iOS can rotate subscriptions; this keeps reminders alive best-effort.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try {
      const appKey = (e.oldSubscription && e.oldSubscription.options && e.oldSubscription.options.applicationServerKey) || undefined;
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appKey,
      });
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const payload = { type: 'resubscribe', subscription: sub.toJSON() };
      all.forEach((c) => c.postMessage(payload));   // a live client writes it via the authed API
    } catch { /* best-effort; app re-validates on next open */ }
  })());
});
