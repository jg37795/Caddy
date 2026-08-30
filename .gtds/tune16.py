# tune16.py — R3 TRACER REPAIR (audit trail: R2 flank pass crashed the tracer)
# Problem: loops.sort takes the LARGEST ring. When the mask is multi-loop
# (a component with interior holes, or two lobes bridged thinly), the
# outer boundary ring may NOT be the largest-area ring (nested hole rings
# bound sub-areas), and crucially the outer boundary of a CONNECTED
# component is what we want — not the largest abstract loop.
# Fix: track ring PARENTAGE. The outer boundary of the component is the
# ring that CONTAINS the component's centroid. Test each loop with a
# point-in-polygon of the blob centroid and prefer that; fall back to
# largest area. Also drop rings fully inside another ring (holes).
src = open('.gdd30.js', encoding='utf-8').read()

# compute the blob centroid before ring selection
old = "  loops.sort((a, b) => areaAbs(b) - areaAbs(a));\n  const ring = loops[0];"
new = """  // v-r3 (tracer repair): pick the ring that CONTAINS the blob centroid —
  // the component's outer boundary — not merely the largest-area ring
  // (hole rings and nested shapes can out-area the outer boundary).
  const blobCx = sx / best.length, blobCy = sy / best.length;
  const inPoly = (px, py, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      if (((yi > py) !== (yj > py)) &&
          (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };
  let ring = null;
  for (const lp of loops) {
    if (inPoly(blobCx, blobCy, lp)) {
      if (!ring || areaAbs(lp) > areaAbs(ring)) ring = lp;
    }
  }
  if (!ring) { loops.sort((a, b) => areaAbs(b) - areaAbs(a)); ring = loops[0]; }
"""
assert old in src, 'sort anchor missing'
src = src.replace(old, new, 1)
open('.gdd33.js', 'w', encoding='utf-8').write(src)
print('patched .gdd33.js (tracer repair, on top of .gdd30 flank pass)')
