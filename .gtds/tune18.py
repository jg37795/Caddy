# tune18.py — R3 flank gates recalibrated from the GT/fairway census:
#   green GT:  smooth3 p50 0.10 / p90 0.31 | slope p50 2.9 / p90 12.0 | br p10 111
#   fairway:   smooth3 p50 0.20 / p90 0.52 | slope p50 7.4 / p90 20.7 | br p10 43
# Overlap is in smooth3 (0.2-0.3 both) but SLOPE separates tails (12 vs 20.7)
# and BRIGHTNESS separates floor (111 vs 43). New flankOk:
#   smooth3 <= 0.40, slope <= 13, br >= 85, tex5 0.6..16  +  max 3-cell
#   growth depth from the core (BFS depth-limited, not unlimited flood).
src = open('.gdd33.js', encoding='utf-8').read()

old = """  const flankOk = (i) => {
    if (!fin(br[i]) || br[i] < 60) return false;
    if (fin(sl[i]) && sl[i] > 12) return false;
    if (!fin(tx[i]) || tx[i] < 0.6 || tx[i] > 16) return false;
    return true;
  };"""
new = """  // v-r3b (GT/fairway census): green p90 slope 12.0, fairway p90 20.7;
  // green br p10 111, fairway p10 43; smooth3 overlaps (0.31 vs 0.52 p90)
  // so cap at 0.40. Depth-limited BFS (3 cells) stops fairway leaks.
  const flankOk = (i) => {
    if (!fin(br[i]) || br[i] < 85) return false;
    if (fin(sl[i]) && sl[i] > 13) return false;
    if (!fin(tx[i]) || tx[i] < 0.6 || tx[i] > 16) return false;
    if (!fin(sm[i]) || sm[i] > 0.40) return false;
    return true;
  };"""
assert old in src, 'flankOk anchor'
src = src.replace(old, new, 1)

old2 = """  {
    const fq = [];
    for (let i = 0; i < N; i++) if (chosen[i]) fq.push(i);
    let grown = 0;
    for (let qi = 0; qi < fq.length; qi++) {
      const i = fq[qi], x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
        const j = ny * W + nx;
        if (chosen[j]) continue;
        if (Math.hypot((nx - W / 2) * cs, (H / 2 - ny) * cs) > 60) continue;
        if (!flankOk(j)) continue;
        chosen[j] = 1; fq.push(j); grown++;
      }
    }
  }"""
new2 = """  {
    // v-r3b: BFS with per-cell depth (max 3 cells from the core) — admits
    // the dome flank while capping any fairway leak to a 3-cell skirt.
    const depth = new Int16Array(N).fill(-1);
    const fq = [];
    for (let i = 0; i < N; i++) if (chosen[i]) { depth[i] = 0; fq.push(i); }
    for (let qi = 0; qi < fq.length; qi++) {
      const i = fq[qi], x = i % W, y = (i / W) | 0;
      if (depth[i] >= 3) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
        const j = ny * W + nx;
        if (chosen[j] || depth[j] >= 0) continue;
        if (Math.hypot((nx - W / 2) * cs, (H / 2 - ny) * cs) > 60) continue;
        if (!flankOk(j)) continue;
        chosen[j] = 1; depth[j] = depth[i] + 1; fq.push(j);
      }
    }
  }"""
assert old2 in src, 'flank pass anchor'
src = src.replace(old2, new2, 1)
open('.gdd35.js', 'w', encoding='utf-8').write(src)
print('patched .gdd35.js')
