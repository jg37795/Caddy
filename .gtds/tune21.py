# tune21.py — collar shrink: detected ring rides the collar's outer edge;
# shrink ~1.2 m radially toward the ring centroid (the GT hugs the surface)
src = open('.gdd37.js', encoding='utf-8').read()
anchor = "  const closed = ring.concat([ring[0]]);"
probe = """  // v-r3e (collar shrink): the detected ring rides the collar's OUTER
  // edge (~1.2 m past the putting surface). Radial inset by 1.2 m per
  // vertex toward the ring centroid (floor 0.2 m to avoid collapse).
  {
    let rcx = 0, rcy = 0;
    for (const p of ring) { rcx += p[0]; rcy += p[1]; }
    rcx /= ring.length; rcy /= ring.length;
    for (const p of ring) {
      const dx = p[0] - rcx, dy = p[1] - rcy;
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.max(0.2, (d - 1.2) / d);
      p[0] = rcx + dx * k; p[1] = rcy + dy * k;
    }
  }
""" + anchor
assert anchor in src, 'anchor missing'
src = src.replace(anchor, probe, 1)
open('.gdd38.js', 'w', encoding='utf-8').write(src)
print('patched .gdd38.js')
