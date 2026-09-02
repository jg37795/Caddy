/* Refetch Jester Park Executive OSM (all golf + water) for render proofs. */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'caddy-probe' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
        resolve(body);
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}
(async () => {
  const areaId = 3610543316; // relation 10543316
  const q = `[out:json][timeout:25];area(${areaId})->.a;(
  nwr["golf"](area.a);
  nwr["natural"="water"](area.a);
);out geom;`;
  const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q);
  const raw = await get(url);
  const data = JSON.parse(raw);
  const out = path.join(__dirname, 'exec_v1211.json');
  fs.writeFileSync(out, JSON.stringify(data.elements || []));
  const kinds = {};
  (data.elements || []).forEach((e) => {
    const g = (e.tags || {}).golf || (e.tags || {}).natural || '?';
    kinds[g] = (kinds[g] || 0) + 1;
  });
  console.log('saved', out, JSON.stringify(kinds));
})().catch((e) => { console.error(e); process.exit(1); });
