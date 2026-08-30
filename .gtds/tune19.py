# tune19.py — the sprawl is WESTWARD (DET x reaches -41 vs GT -13): the
# west smooth/pond-adjacent apron keeps admitting. The core problem isn't
# the flank pass — it's that the CORE blob itself extends west (bbox from
# .gdd26 era was already -31..-6 before the pin-seed fix, then the whole
# component contains origin). The honest structural fix: after the flank
# pass, TRIM the mask back to the connected component that contains the
# ORIGIN CELL (the pin) — everything detached from the pin is another
# feature (apron/second green) and the pin is ground truth for which
# green we're playing.
src = open('.gdd35.js', encoding='utf-8').read()
anchor = "  const nxt = new Int32Array(W1 * (H + 1)).fill(-1);"
probe = """  // v-r3c (pin-anchored trim): keep only the connected component that
  // contains the pin. Any detached growth (aprons, neighbouring greens,
  // pond-edge smoothness) is a different feature by definition.
  {
    const comp = new Uint8Array(N);
    const oi2 = ((H / 2) | 0) * W + ((W / 2) | 0);
    if (chosen[oi2]) {
      const q2 = [oi2];
      comp[oi2] = 1;
      for (let qi = 0; qi < q2.length; qi++) {
        const i = q2[qi], x = i % W, y = (i / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (chosen[j] && !comp[j]) { comp[j] = 1; q2.push(j); }
        }
      }
      for (let i = 0; i < N; i++) if (chosen[i] && !comp[i]) chosen[i] = 0;
    }
  }
""" + anchor
assert anchor in src
src = src.replace(anchor, probe, 1)
open('.gdd36.js', 'w', encoding='utf-8').write(src)
print('patched .gdd36.js')
