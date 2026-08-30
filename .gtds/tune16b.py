# tune16b.py — fix: sx/sy are declared later in the conf block; compute
# the blob centroid from `best` cells directly (mx,my accumulate here).
src = open('.gdd33.js', encoding='utf-8').read()
old = "  const blobCx = sx / best.length, blobCy = sy / best.length;"
new = """  let bcx = 0, bcy = 0;
  for (const i of best) {
    bcx += ((i % W) - W / 2) * cs;
    bcy += (H / 2 - ((i / W) | 0)) * cs;
  }
  bcx /= best.length; bcy /= best.length;
  const blobCx = bcx, blobCy = bcy;"""
assert old in src
src = src.replace(old, new, 1)
open('.gdd33.js', 'w', encoding='utf-8').write(src)
print('fixed centroid computation')
