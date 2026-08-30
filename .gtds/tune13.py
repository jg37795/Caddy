# tune13.py — TWO-TIER GROWTH (core + flank)
# After the primary grow+pick, run a flank pass: from the chosen blob's
# boundary cells, admit neighbours that fail smoothness but pass
# slope+mow-texture+brightness (dome flanks). Iterate to fixpoint, then
# continue into the existing confidence scoring.
src = open('.gdd26.js', encoding='utf-8').read()

# 1) build flank-admissible mask data up front (per-cell booleans)
old = "  let hi = Math.max(0.50, maxNear * 0.70), lo = Math.max(0.33, hi * 0.58);"
new = ("  // v-tune13: flank admissibility — dome flanks fail the smoothness\n"
       "  // blend but are still green: mow-texture present, slope moderate,\n"
       "  // not water (br), not rough (slope cap).\n"
       "  const flankOk = (i) => {\n"
       "    if (!fin(br[i]) || br[i] < 60) return false;\n"
       "    if (fin(sl[i]) && sl[i] > 12) return false;\n"
       "    if (!fin(tx[i]) || tx[i] < 0.6 || tx[i] > 16) return false;\n"
       "    return true;\n"
       "  };\n"
       "  let hi = Math.max(0.50, maxNear * 0.70), lo = Math.max(0.33, hi * 0.58);")
assert old in src, 'anchor1'
src = src.replace(old, new, 1)

# 2) after 'chosen' mask is built, run flank growth to fixpoint
old2 = "  const chosen = new Uint8Array(N);\n  for (const i of best) chosen[i] = 1;"
new2 = ("  const chosen = new Uint8Array(N);\n"
        "  for (const i of best) chosen[i] = 1;\n"
        "  // v-tune13 (TWO-TIER GROWTH): flank pass — admit dome-flank cells\n"
        "  // that touch the core blob and pass slope/texture/brightness gates.\n"
        "  // Fixes under-growth on tilted greens (siteA east flank).\n"
        "  {\n"
        "    const fq = [];\n"
        "    for (let i = 0; i < N; i++) if (chosen[i]) fq.push(i);\n"
        "    let grown = 0;\n"
        "    for (let qi = 0; qi < fq.length; qi++) {\n"
        "      const i = fq[qi], x = i % W, y = (i / W) | 0;\n"
        "      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {\n"
        "        if (!dx && !dy) continue;\n"
        "        const nx = x + dx, ny = y + dy;\n"
        "        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;\n"
        "        const j = ny * W + nx;\n"
        "        if (chosen[j]) continue;\n"
        "        if (Math.hypot((nx - W / 2) * cs, (H / 2 - ny) * cs) > 60) continue;\n"
        "        if (!flankOk(j)) continue;\n"
        "        chosen[j] = 1; fq.push(j); grown++;\n"
        "      }\n"
        "    }\n"
        "  }")
assert old2 in src, 'anchor2'
src = src.replace(old2, new2, 1)
open('.gdd30.js', 'w', encoding='utf-8').write(src)
print('patched .gdd30.js')
