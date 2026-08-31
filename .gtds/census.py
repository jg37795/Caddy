# tune30.py — R4 calibration: recompute feature gates from the full
# 5-site OSM census (green GT vs fairway per site), then apply the
# consensus gates to flankOk. Also measure exg/bright percentiles which
# we never gated precisely.
import json
import math

sites = ['g320468252', 'g320468257', 'g320468261', 'g320468728', 'g321533712']
def pct(a, p):
    a = [v for v in a if v is not None]
    if not a: return float('nan')
    a = sorted(a)
    return a[min(len(a) - 1, int(p * len(a)))]

agg = {'g': {'s3': [], 'tx': [], 'sl': [], 'br': [], 'ex': []},
       'f': {'s3': [], 'tx': [], 'sl': [], 'br': [], 'ex': []}}
for sid in sites:
    pack = json.load(open(f'.gtds/{sid}_grid.json'))
    gt = pack['gt']; meta = pack['meta']
    W, cs = meta['W'], meta['cellSizeM']
    cx = (meta['bbox'][0] + meta['bbox'][2]) / 2
    cy = (meta['bbox'][1] + meta['bbox'][3]) / 2
    poly = [((p[0] - cx) * meta['mLng'], (p[1] - cy) * meta['mLat']) for p in gt['poly']]
    f = pack['features']
    for y in range(meta['H']):
        for x in range(W):
            i = y * W + x
            mx = (x - W / 2) * cs
            my = (meta['H'] / 2 - y) * cs
            inside = False
            for k in range(len(poly)):
                x1, y1 = poly[k]; x2, y2 = poly[(k + 1) % len(poly)]
                if (y1 > my) != (y2 > my) and mx < (x2 - x1) * (my - y1) / (y2 - y1) + x1:
                    inside = not inside
            b = 'g' if inside else 'f'
            for key, arr in (('s3', 'smooth3'), ('tx', 'tex5'), ('sl', 'slope'),
                             ('br', 'bright'), ('ex', 'exg')):
                v = f[arr][i]
                if v == v:
                    agg[b][key].append(v)

print('=== 5-site census (GT green vs everything else) ===')
for b, label in (('g', 'GREEN'), ('f', 'OTHER')):
    v = agg[b]
    print(f"{label}: n={len(v['s3'])}")
    print('  smooth3 p50/p75/p90:', round(pct(v['s3'], .5), 2), round(pct(v['s3'], .75), 2), round(pct(v['s3'], .9), 2))
    print('  slope   p50/p75/p90:', round(pct(v['sl'], .5), 1), round(pct(v['sl'], .75), 1), round(pct(v['sl'], .9), 1))
    print('  tex5    p10/p50/p90:', round(pct(v['tx'], .1), 1), round(pct(v['tx'], .5), 1), round(pct(v['tx'], .9), 1))
    print('  bright  p05/p10/p50:', round(pct(v['br'], .05), 0), round(pct(v['br'], .1), 0), round(pct(v['br'], .5), 0))
    print('  exg     p10/p50/p90:', round(pct(v['ex'], .1), 0), round(pct(v['ex'], .5), 0), round(pct(v['ex'], .9), 0))
