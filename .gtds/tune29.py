# tune29.py — port collar shrink (0.8 m) onto .gdd45 base
src = open('.gdd45.js', encoding='utf-8').read()
anchor = "  const closed = ring.concat([ring[0]]);"
probe = """  // v-r3e2 (collar shrink 0.8 m): ring rides the collar outer edge.
  {
    let rcx = 0, rcy = 0;
    for (const p of ring) { rcx += p[0]; rcy += p[1]; }
    rcx /= ring.length; rcy /= ring.length;
    for (const p of ring) {
      const dx = p[0] - rcx, dy = p[1] - rcy;
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.max(0.2, (d - 0.8) / d);
      p[0] = rcx + dx * k; p[1] = rcy + dy * k;
    }
  }
""" + anchor
assert anchor in src, 'anchor missing'
src = src.replace(anchor, probe, 1)
open('.gdd47.js', 'w', encoding='utf-8').write(src)
print('patched .gdd47.js')
