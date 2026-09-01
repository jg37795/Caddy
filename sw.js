/* sw.js — offline-first service worker for Caddy. */
const CACHE_VERSION = 'v1.18.1'; // SEARCH HONESTY (James: Executive mapped the 18-hole course + timeout-then-works): REAL ROOT CAUSE was a TYPE MISMATCH - Photon geocoder returns osm_type as the OSM primitive letter W/R/N but the scorecard pipeline compares 'way'/'relation', so EVERY Photon-sourced course skipped area scoping and fell to the 2.8 km point radius which vacuums whatever course (holes) is nearby - the Executive pin pulled the main 18's scorecard. FIXES: (1) osmType mapped W->way/R->relation/N->node at the Photon source; (2) area-scoped courses whose own area has NO golf=hole now answer honestly 'isn't mapped in OpenStreetMap yet' instead of importing the neighbour - radius fallback ONLY for point-tagged courses and ONLY on timeout/abort (a broken response never imports the neighbour); (3) Overpass timeouts tightened 45s->30s client / 40s->25s server so the retry ladder completes inside the UI patience window; (4) honest-unmapped surfaced on BOTH paths (Prep search message names the course; Round path binds a blank editable manual scorecard with an explanation, not a blocked failed state). E2E v181: stubbed Overpass/Photon at the network layer, drives the real prep search UI, asserts honest message + zero radius calls; new ?e2e=1 location seed seam in app.js (param-gated, no-op in production).
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
  './holeSat.js',
  './greenBriefCore.js',
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
