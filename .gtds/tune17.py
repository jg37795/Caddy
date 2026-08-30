# tune17.py — chosen-mask map for .gdd33
src = open('.gdd33.js', encoding='utf-8').read()
anchor = "  const nxt = new Int32Array(W1 * (H + 1)).fill(-1);"
probe = """  console.error('[dbg] chosen (x -36..+36 step 6, y +30..-30 step 6):');
  for (let my = 30; my >= -30; my -= 6) {
    let row = '[dbg] y' + String(my).padStart(4) + ' ';
    for (let mx = -36; mx <= 36; mx += 6) {
      const ix = Math.round(mx / cs + W / 2), iy = Math.round(H / 2 - my / cs);
      row += chosen[iy * W + ix] ? '#' : '.';
    }
    console.error(row);
  }
""" + anchor
assert anchor in src
src = src.replace(anchor, probe, 1)
open('.gdd34.js', 'w', encoding='utf-8').write(src)
print('patched .gdd34.js')
