# tune11.py — visualise the keep mask around the pin
src = open('.gdd27.js', encoding='utf-8').read()
anchor = "  if (cn) {"
probe = """  console.error('[dbg] keep map (x -36..+36 step 6, y +30..-30 step 6; #=kept):');
  for (let my = 30; my >= -30; my -= 6) {
    let row = '[dbg] y' + String(my).padStart(4) + ' ';
    for (let mx = -36; mx <= 36; mx += 6) {
      const ix = Math.round(mx / cs + W / 2), iy = Math.round(H / 2 - my / cs);
      row += keep[iy * W + ix] ? '#' : '.';
    }
    console.error(row);
  }
  if (cn) {"""
assert anchor in src, 'anchor missing'
src = src.replace(anchor, probe, 1)
open('.gdd28.js', 'w', encoding='utf-8').write(src)
print('patched .gdd28.js')
