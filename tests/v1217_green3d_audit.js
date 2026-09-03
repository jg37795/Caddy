'use strict';
/* tests/v1217_green3d_audit.js — Grok-audit regressions for the 3D green flow
   Run: node tests/v1217_green3d_audit.js */
const fs = require('fs');
const path = require('path');
const gmSrc = fs.readFileSync(path.join(__dirname, '..', 'greenmap.js'), 'utf8');
const detectSrc = fs.readFileSync(path.join(__dirname, '..', 'green-detect.js'), 'utf8');
const coreSrc = fs.readFileSync(path.join(__dirname, '..', 'greenBriefCore.js'), 'utf8');
const linkSrc = fs.readFileSync(path.join(__dirname, '..', 'greenlink.js'), 'utf8');
const prepSrc = fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'greenmap.html'), 'utf8');
let fails = 0;
const check = (n, c, d = '') => {
  if (c) console.log('  ok  -', n);
  else { fails++; console.error('FAIL -', n, d); }
};

// F1. The 3D arrow loop must declare len BEFORE the polyLocal gate reads it
// (v1.3.2-class TDZ threw on every green-view arrow).
{
  const lenDecl = gmSrc.indexOf('const len = 9 * dpr');
  const lenUse = gmSrc.indexOf('(len * 2.6) * mPerPx');
  check('F1 3D-arrow len declared before use', lenDecl !== -1 && lenUse !== -1 &&
    lenDecl < lenUse, `decl@${lenDecl} use@${lenUse}`);
  check('F1 len declared exactly once in the arrow path',
    (gmSrc.match(/const len = 9 \* dpr;/g) || []).length === 1,
    `count=${(gmSrc.match(/const len = 9 \* dpr;/g) || []).length}`);
}

// F2. GreenDetect must initialize its namespace before assigning .detect.
check('F2 GreenDetect namespace initialized before .detect',
  /window\.GreenDetect\s*=\s*window\.GreenDetect\s*\|\|\s*\{\}/.test(detectSrc) ||
  /window\.GreenDetect\s*=\s*\{/.test(detectSrc),
  detectSrc.split('\n').slice(0, 14).join('\n'));

// F3. Auto-detect feature build must read the FRESH fetched grid (elev),
// never state.grid, which is still null at that point on first boot.
check('F3 detect features read the freshly fetched grid, not null state.grid',
  /const g2 = elev \? elev\.grid : null;/.test(gmSrc) &&
  !/const g2 = state\.grid \? state\.grid\.grid : null;/.test(gmSrc));

// F4. One brief shape on disk: map of briefs; Prep reads nearest brief.
{
  const persist = gmSrc.slice(gmSrc.indexOf('function persistGreenBrief'),
    gmSrc.indexOf('function updateQualityNote'));
  check('F4 persistGreenBrief merges into the map shape',
    /const KEY = 'caddy:greenBrief:v1';/.test(persist) &&
    /localStorage\.setItem\(KEY, JSON\.stringify\(map\)\)/.test(persist),
    persist.slice(0, 300));
  check('F4 greenBriefCore writes the map shape', /readBriefs\(\)/.test(coreSrc) &&
    /keyFor\(/.test(coreSrc));
  check('F4 prep readGreenBrief reads map shape with proximity match',
    /Object\.values\(parsed\)\.forEach\(consider\)/.test(prepSrc) &&
    /GREEN_BRIEF_MATCH_M/.test(prepSrc));
}

// F5. OSM green query must not be capped at one element.
check('F5 Overpass green query returns all candidates (no "out geom 1")',
  !/out geom 1;/.test(gmSrc), gmSrc.match(/out geom[^;]*;/)?.[0]);

// F6. buildScene(hole) must sync state.meshArrows from the hole dataset,
// not overwrite ds.arrows with the green frame's arrows.
{
  const holeBranch = gmSrc.slice(gmSrc.indexOf('function buildScene()'),
    gmSrc.indexOf('function buildScene()') + 900);
  check('F6 hole buildScene keeps hole arrows (state.meshArrows = ds.arrows)',
    /buildHoleScene\(\);[\s\S]{0,500}?state\.meshArrows = ds\.arrows \|\| \[\];/.test(holeBranch),
    holeBranch.slice(0, 320));
}

// F10. Round-mode 3D launch carries course+hole so tee edits persist.
{
  const launch = linkSrc.slice(linkSrc.indexOf('greenmap.html'));
  check('F10 round 3D pill passes course and hole',
    /course/.test(linkSrc) && /hole/.test(linkSrc) &&
    /roundSession/.test(linkSrc),
    linkSrc.slice(0, 400));
}

// F12. Landing on the 3D tool defaults to the 3D view.
{
  const boot = gmSrc.slice(gmSrc.indexOf("viewMode = '2d'") - 200,
    gmSrc.indexOf("viewMode = '2d'") + 220);
  const has2dDefault = /viewMode\s*=\s*'2d'/.test(gmSrc);
  const qsView = /qs\.get\('view'\)/.test(gmSrc) || /view=/.test(htmlSrc);
  check('F12 default view is 3D (or ?view honored)',
    (!has2dDefault && /viewMode\s*=\s*'3d'/.test(gmSrc)) || qsView,
    has2dDefault ? boot : 'no 2d default found');
}

// F16. Auto-brief fall bearing uses GreenMapCore.fallBearingDeg (same sign
// convention as the 3D arrows).
check('F16 greenBriefCore uses fallBearingDeg convention',
  /fallBearingDeg/.test(coreSrc) ||
  /atan2\(-gx,\s*gy\)/.test(coreSrc) ||
  !/Math\.atan2\(gx,\s*gy\)/.test(coreSrc),
  coreSrc.split('\n').slice(138, 148).join('\n'));

// F17. A tiny mask fails THAT RUNG (v1.23.0: no ellipse demotion exists —
// when every rung fails the honest "isn't mapped yet" card appears).
{
  const abort = gmSrc.slice(gmSrc.lastIndexOf('if (!chosenSrc) {'),
    gmSrc.lastIndexOf('if (!chosenSrc) {') + 900);
  const tryOsmBlock = gmSrc.slice(gmSrc.indexOf('osm rung failed (tiny mask)'),
    gmSrc.indexOf('osm rung failed (tiny mask)') + 600);
  check('F17 tiny mask fails the rung before the honest abort',
    /polySource = 'none'/.test(abort) &&
    /chosenSrc = null/.test(tryOsmBlock),
    abort.slice(0, 200));
}

// F20. The arrows gate is the single #gm-arrows toggle (v1.23.0): shading
// always draws in 3D/Hole; arrows obey state.arrowsOn. Gate + dock control
// must agree.
{
  const gateIdx = gmSrc.indexOf('if (state.arrowsOn && !state.__exagPreview)');
  const gate3d = gateIdx !== -1;
  const btnExists = /id="gm-arrows"/.test(htmlSrc);
  const wired = gmSrc.indexOf("getElementById('gm-arrows')") !== -1;
  const staleGate = /state\.layer\b/.test(gmSrc) ||
    /gm-layer-btn/.test(htmlSrc);
  check('F20 arrows gate (arrowsOn) and the Arrows dock toggle agree',
    gate3d && btnExists && wired && !staleGate,
    `gate=${gate3d} btn=${btnExists} wired=${wired}`);
}

if (fails) { console.log(`${fails} FAILURE(S)`); process.exit(1); }
console.log('v1.21.7 GREEN3D AUDIT PASSED'); process.exit(0);
