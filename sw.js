/* sw.js — offline-first service worker for Caddy. */
const CACHE_VERSION = 'v1.13.0'; // PREP HOLE VIEW ART PASS (James: 'can we make it look really good?' + 'tighten the width' + tee shortcut): (1) COMPOSED STYLIZED PALETTE - the flat sage fill replaced by data-driven art: BFS distance-to-green classifies fairway ribbon (light warm green) vs rough (cool darker + deterministic mottle), elevation banding, green zone keeps its slope ramp; stylized hillshade band deepened (0.62-1.30) since shading IS the terrain read without photo. (2) ARROWS MODE fixed on hole view - the old fill was the page background (corridor vanished, 'buttons broken'); now terrain shows dimmed at 45% brightness with arrows popping. (3) RECTANGULAR CORRIDOR - corridorBbox no longer forces width=length; length = tee->green + 30m end margins (James's 'leave room'), width = +/-50m around the axis; camera fit adapts (bbox is only the fetch envelope). Smoke section 11 rewritten for the rectangle (260 x 100). (4) TEE SHORTCUT beside 3D Green in the hole brief - deep-links Check location with &armtee=1 (tee mode pre-armed): tap Tee -> tap map -> Load.
const SHELL_CACHE = `caddy-shell-${CACHE_VERSION}`;
const TILE_CACHE = `caddy-tiles-${CACHE_VERSION}`;
const CACHE_PREFIX = 'caddy-';

const MAX_TILE_ENTRIES = 400;

const APP_SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './stats.css',
  './stats.js',
  './bag.css',
  './bag.js',
  './prep.css',
  './prep.js',
  './elev.css',
  './caddy-elev.js',
  './green-detect.js',
  './range.css',
  './range.js',
  './greenlink.js',
  './greenedit.js',
  './satview.js',
  './greenmap.html',
  './greenmap.css',
  './greenmap.js',
  './leaflet.css',
  './leaflet.js',
  './mapload.css',   // v-fix(shell) v1.5.2 (audit #11): offline styling for the mapping-loader card
];

const isTile = (url) =>
  /\/\d+\/\d+\/\d+(@2x)?\.(png|jpg|jpeg|webp)(\?|$)/i.test(url.pathname) ||
  /(tile\.|tiles\.|arcgisonline|openstreetmap|cartocdn|mapbox|maptiler|stadiamaps)/i.test(
    url.hostname
  );

const cacheable = (response) =>
  !!response && (response.ok || response.type === 'opaque');

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);

      // If a required app file is missing, keep the old worker active.
      await Promise.all(
        APP_SHELL.map(async (asset) => {
          const response = await fetch(
            new Request(asset, { cache: 'reload' })
          );

          if (!cacheable(response)) {
            throw new Error(`Unable to precache ${asset}`);
          }

          await cache.put(asset, response);
        })
      );

      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys.map((key) => {
          const oldCaddyCache =
            key.startsWith(CACHE_PREFIX) &&
            key !== SHELL_CACHE &&
            key !== TILE_CACHE;

          return oldCaddyCache ? caches.delete(key) : null;
        })
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isTile(url)) {
    event.respondWith(staleWhileRevalidate(event, request, TILE_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirstAsset(request, SHELL_CACHE));
    return;
  }

  event.respondWith(
    fetch(request).catch(async () => {
      return (await caches.match(request)) || new Response('', { status: 504 });
    })
  );
});

async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  const shellRequest = new Request('./index.html');

  try {
    // cache:'reload' bypasses the HTTP cache — python's http.server (and
    // some hosts) send no Cache-Control, and heuristic caching otherwise
    // serves stale app.js/app.css against fresh HTML after an update.
    const response = await fetch(request, { cache: 'reload' });

    // v-fix(nav-cache) v1.5.2 (Grok audit #2): cache the response under its
    // OWN url — the old code always put it under ./index.html, so loading
    // greenmap.html while online overwrote the cached app shell and an
    // offline relaunch of / served the 3D Green tool as the app.
    if (cacheable(response)) {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) {
        await cache.put(shellRequest, response.clone());
      } else {
        await cache.put(new Request(request.url), response.clone());
      }
    }

    return response;
  } catch {
    const url = new URL(request.url);
    const cached =
      (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')
        ? await cache.match(shellRequest)
        : await cache.match(request)) ||
      (await cache.match('./')) ||
      (await caches.match(request));

    if (cached) return cached;

    return new Response(
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Caddy Offline</title><body style="font-family:system-ui;padding:24px"><h1>You are offline</h1><p>Open Caddy once while online before using it offline.</p></body></html>',
      {
        status: 503,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      }
    );
  }
}

async function networkFirstAsset(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    // See handleNavigation — always revalidate shell assets from network.
    const response = await fetch(request, { cache: 'reload' });

    if (cacheable(response)) {
      await cache.put(request, response.clone());
    }

    return response;
  } catch {
    const cached = await cache.match(request, {
      ignoreSearch: true,
    });

    return cached || new Response('', { status: 504 });
  }
}

async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then(async (response) => {
      if (cacheable(response)) {
        await cache.put(request, response.clone());
        event.waitUntil(trimCache(cacheName, MAX_TILE_ENTRIES));
      }

      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }

  return (await network) || new Response('', { status: 504 });
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();

  if (keys.length <= maxEntries) return;

  await Promise.all(
    keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key))
  );
}
