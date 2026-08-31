# tune32b.py — R4 relative gates (correct anchor: .gdd50's flankOk block)
src = open('.gdd50.js', encoding='utf-8').read()
old = """  const flankOk = (i) => {
    if (!fin(br[i]) || br[i] < 85) return false;
    if (fin(sl[i]) && sl[i] > 13) return false;
    if (!fin(tx[i]) || tx[i] < 0.6 || tx[i] > 16) return false;
    if (!fin(sm[i]) || sm[i] > 0.40) return false;
    return true;
  };"""
new = """  // v-r4 (RELATIVE gates): shaded greens (728: br p10 50) and steep
  // greens (261: slope p90 16.6) break absolute thresholds. Admit flank
  // cells against the CORE's own medians within spread. tex5 gate dropped
  // (5-site census: no separation — 0.6-5.7 vs 0.4-7.7).
  let coreSm = 0.15, coreEx = 60, coreBr = 110;   // sane fallbacks
  {
    const s3v = [], exv = [], brv = [];
    for (let i = 0; i < N; i++) {
      if (!fin(sm[i])) continue;
      const mx = ((i % W) - W / 2) * cs, my = (H / 2 - ((i / W) | 0)) * cs;
      if (Math.hypot(mx, my) > 18) continue;   // near-pin core sample
      s3v.push(sm[i]);
      if (fin(ex[i])) exv.push(ex[i]);
      if (fin(br[i])) brv.push(br[i]);
    }
    const med = (a) => { a.sort((x, y) => x - y); return a.length ? a[a.length >> 1] : NaN; };
    if (s3v.length >= 5) coreSm = med(s3v);
    if (exv.length >= 5) coreEx = med(exv);
    if (brv.length >= 5) coreBr = med(brv);
  }
  const flankOk = (i) => {
    if (!fin(sm[i]) || sm[i] > coreSm + 0.25) return false;
    if (fin(ex[i]) && ex[i] < coreEx - 25) return false;
    if (fin(br[i]) && br[i] < coreBr - 35) return false;
    if (fin(sl[i]) && sl[i] > 14) return false;
    return true;
  };"""
assert old in src, 'flankOk anchor missing'
src = src.replace(old, new, 1)
old2 = "      if (depth[i] >= 3) continue;"
new2 = "      if (depth[i] >= 4) continue;"
assert old2 in src, 'depth anchor missing'
src = src.replace(old2, new2, 1)
open('.gdd59.js', 'w', encoding='utf-8').write(src)
print('patched .gdd59.js (relative gates, depth 4)')
