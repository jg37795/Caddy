# tune20.py — pin-radius trim at 20 m (green max radius ~19 m per brief)
src = open('.gdd36.js', encoding='utf-8').read()
anchor = "  const nxt = new Int32Array(W1 * (H + 1)).fill(-1);"
probe = """  // v-r3d (pin-radius trim): the pin is ON the green; a green is
  // 300-900 m2 (max radius ~19 m). Keep only kept-cells within 20 m of
  // the pin - severs the west apron bridge that connected-trim cannot.
  for (let i = 0; i < N; i++) {
    if (!chosen[i]) continue;
    const mx = ((i % W) - W / 2) * cs, my = (H / 2 - ((i / W) | 0)) * cs;
    if (Math.hypot(mx, my) > 20) chosen[i] = 0;
  }
""" + anchor
assert anchor in src, 'anchor missing'
src = src.replace(anchor, probe, 1)
open('.gdd37.js', 'w', encoding='utf-8').write(src)
print('patched .gdd37.js')
