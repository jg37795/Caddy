// sugar_probe.js — reproduce the wrong-green bug at Sugar Creek
const lat = 41.5950676, lng = -93.8829368;   // Sugar Creek GC, IA
const q = '[out:json][timeout:15];(way["golf"="green"](around:120,' + lat + ',' + lng + '););out geom;';
(async () => {
  const r = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q));
  const j = await r.json();
  console.log('greens found:', (j.elements || []).length);
  for (const e of (j.elements || [])) {
    const lats = e.geometry.map(p => p.lat), lngs = e.geometry.map(p => p.lon);
    const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const d = Math.hypot((cLat - lat) * 111320, (cLng - lng) * 111320 * 0.75);
    console.log('way', e.id, 'centre dist', Math.round(d), 'm, pts', e.geometry.length);
  }
})();
