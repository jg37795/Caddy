# tune6b.py — print score map (anchor on the dbg line just inserted)
src = open('.gdd20.js', encoding='utf-8').read()
anchor = '  if (maxNear < 0.36) { console.log("EXIT maxNear", maxNear.toFixed(3)); return null; }'
probe = """  console.error('[dbg] score map y=+18..-18 (rows), x=-12..+12 (cols):');
  for (let my = 18; my >= -18; my -= 6) {
    let row = '[dbg] y' + String(my).padStart(4) + ':';
    for (let mx = -12; mx <= 12; mx += 6) {
      const i = Math.round(H / 2 - my / cs) * W + Math.round(mx / cs + W / 2);
      row += String(score[i].toFixed(2)).padStart(7);
    }
    console.error(row);
  }
""" + anchor
assert anchor in src, 'anchor missing'
src = src.replace(anchor, probe, 1)
open('.gdd21.js', 'w', encoding='utf-8').write(src)
print('patched .gdd21.js')
