/* ========================================================================== 
   tests/v1215_prep_audit.js — Prep audit regressions
   Run: node tests/v1215_prep_audit.js
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const prepSrc = fs.readFileSync(path.join(__dirname, '..', 'prep.js'), 'utf8');
const satSrc = fs.readFileSync(path.join(__dirname, '..', 'holeSat.js'), 'utf8');
const LAT=41.778, LNG=-93.782, LATYD=.9144/111320,
  LNGYD=.9144/(111320*Math.cos(LAT*Math.PI/180));
const ll=(n,e)=>({lat:LAT+n*LATYD,lng:LNG+e*LNGYD});
const mkHole=(number,yards,off=-(number-1)*500)=>({
  number, par:4, yards, source:'openstreetmap', strokeIndex:number,
  teePoint:ll(off,0), greenCenter:ll(off-yards,0),
  front:ll(off-yards+10,0), back:ll(off-yards-10,0),
  pathPts:[ll(off,0),ll(off-yards/2,8),ll(off-yards,0)],
  hazards:[], shapes:{fairways:[],rough:[],water:[],bunkers:[],tees:[]},
});
const course={id:'audit-course',name:'Audit GC',holesCount:9,
  teeName:'Regular tees',source:'openstreetmap',osmId:123,
  holes:[mkHole(1,387),mkHole(2,360),...Array.from({length:7},(_,i)=>mkHole(i+3,350))]};

function fakeLayer(kind, ll0) {
  return { kind, ll:ll0, addTo(){return this;}, on(){return this;},
    setLatLng(v){this.ll=v;return this;} };
}
function boot({ withCourse=true, clubs=null, url='https://caddy.local/?e2e=1' }={}) {
  const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  Object.assign(global,{window:w,document:w.document,navigator:w.navigator,
    location:w.location,localStorage:w.localStorage,HTMLElement:w.HTMLElement,
    SVGElement:w.SVGElement,Element:w.Element,Node:w.Node,
    MutationObserver:w.MutationObserver,getComputedStyle:w.getComputedStyle,
    requestAnimationFrame:f=>w.requestAnimationFrame(f),crypto:w.crypto});
  w.alert=()=>{}; w.confirm=()=>false;
  w.fetch=async()=>{throw new Error('offline fixture');}; global.fetch=w.fetch;
  const maps=[];
  w.L=global.L={
    map(){const handlers={};const m={handlers,on(k,f){handlers[k]=f;return this;},
      fire(k,e){if(handlers[k])handlers[k](e);},setView(){return this;},
      removeLayer(){},addLayer(){},remove(){},invalidateSize(){},fitBounds(){return this;},
      hasLayer(){return false;},getPane(){return {style:{}};},createPane(){return {style:{}};},
      getBounds(){return {pad(){return {};}}}};maps.push(m);return m;},
    tileLayer:()=>fakeLayer('tile'),circleMarker:(p)=>fakeLayer('circle',p),
    polyline:(p)=>fakeLayer('line',p),polygon:(p)=>fakeLayer('polygon',p),
    marker:(p)=>fakeLayer('marker',p),circle:(p)=>fakeLayer('circle',p),
    layerGroup:()=>fakeLayer('group'),divIcon:o=>o,
    latLngBounds:()=>({extend(){return this;},pad(){return this;},isValid:()=>true}),
    control:{layers:()=>({addTo(){}}),attribution:()=>({addTo(){}}),
      zoom:()=>({addTo(){}}),scale:()=>({addTo(){}})},
    DomEvent:new Proxy({}, {get:()=>()=>{}}),DomUtil:new Proxy({}, {get:()=>()=>''}),
  };
  w.localStorage.setItem('caddy:onboarded','1');
  w.localStorage.setItem('caddy:prefs',JSON.stringify({activeTab:'shot',theme:'dark'}));
  if(withCourse) w.localStorage.setItem('caddy:courseProfiles:v1',JSON.stringify([course]));
  if(clubs) w.localStorage.setItem('caddy:clubs',JSON.stringify(clubs));
  w.eval(appSrc); w.eval(prepSrc);
  return {w,maps};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0;
const check=(name,cond,detail='')=>{
  if(cond) console.log('  ok  -',name);
  else {fails++;console.error('FAIL -',name,detail);}
};

(async()=>{
  // 1. A typed name works without GPS. Photon can return global results; no
  // synthetic location should be required just to enter the search path.
  {
    const {w}=boot({withCourse:false,url:'https://caddy.local/'});
    // Global Photon lookup succeeds while no location exists.
    w.fetch=global.fetch=async(url)=>String(url).includes('photon.komoot.io')
      ? {ok:true,json:async()=>({features:[{
          properties:{name:'Pebble Beach Golf Links',osm_type:'R',osm_id:1,
            osm_key:'leisure',osm_value:'golf_course'},
          geometry:{coordinates:[-121.95,36.57]}}]})}
      : (()=>{throw new Error('unexpected network');})();
    w.document.getElementById('planCourseSearch').value='Pebble Beach';
    w.document.getElementById('planCourseSearch').dispatchEvent(new w.Event('input'));
    await wait(520);
    const txt=w.document.getElementById('planCourseSearchResults').textContent;
    check('typed course search does not block on GPS',
      !/Turn on location/i.test(txt),txt.trim());
    check('GPS-off course result uses honest location-neutral copy',
      /Name match/.test(txt) && !/away/.test(txt),txt.trim());
  }

  // 2. Opening another hole starts collapsed; expansion belongs to a hole,
  // not to the global Prep session. Buttons announce expanded state.
  {
    const {w}=boot(); await wait(40);
    const sel=w.document.getElementById('planCourseSelect');
    sel.value='audit-course';sel.dispatchEvent(new w.Event('change'));await wait(40);
    w.document.querySelectorAll('.plan-hole-row')[0].click();await wait(220);
    const first=w.document.querySelector('.prep-plan-shot');first.click();await wait(220);
    check('selected shot exposes aria-expanded=true',
      first.getAttribute('aria-expanded')==='true',first.outerHTML.slice(0,200));
    w.document.getElementById('prepStratTitle').click();await wait(30);
    w.document.querySelectorAll('.plan-hole-row')[1].click();await wait(220);
    check('new hole does not inherit prior expansion',
      w.document.querySelectorAll('.prep-plan-shot.chosen').length===0 &&
      !w.document.querySelector('.prep-num-inline'));
  }

  // 3. A per-shot row must never call the whole-hole recommendation and
  // label an already-selected Driver segment "Lay up".
  {
    const clubs=[{id:'d',name:'Driver',yards:275},{id:'g',name:'GW',yards:112}];
    const {w}=boot({clubs});await wait(40);
    const sel=w.document.getElementById('planCourseSelect');
    sel.value='audit-course';sel.dispatchEvent(new w.Event('change'));await wait(40);
    w.document.querySelector('.plan-hole-row').click();await wait(260);
    const sub=w.document.querySelector('.prep-plan-shot .prep-plan-sub').textContent;
    check('Driver segment is not mislabeled Lay up',!/Lay up/i.test(sub),sub);
    check('redundant static club-chip row is removed',
      w.document.querySelectorAll('.prep-seq-chip').length===0);
  }

  // 3b. No usable bag → no "How to play it" section, not an empty heading.
  {
    const {w}=boot({clubs:[]});await wait(40);
    const sel=w.document.getElementById('planCourseSelect');
    sel.value='audit-course';sel.dispatchEvent(new w.Event('change'));await wait(40);
    w.document.querySelector('.plan-hole-row').click();await wait(260);
    const bodyText=w.document.getElementById('prepStratBody').textContent;
    check('carry-less bag omits the shot-plan section',
      !/How to play it/.test(bodyText),bodyText.slice(0,160));
  }

  // 3c. v1.21.6: the row is a disclosure DIV (role=button) — Lie/Shape
  // buttons must not be nested inside a <button>; toggles carry aria-pressed.
  {
    const {w}=boot();await wait(40);
    const sel=w.document.getElementById('planCourseSelect');sel.value='audit-course';
    sel.dispatchEvent(new w.Event('change'));await wait(40);
    w.document.querySelector('.plan-hole-row').click();await wait(220);
    const first=w.document.querySelector('.prep-plan-shot');
    check('plan row is not a nested-button <button>',
      first.tagName==='DIV' && first.getAttribute('role')==='button' &&
      first.getAttribute('tabindex')==='0',
      first.outerHTML.slice(0,140));
    first.click();await wait(220);
    check('lie/shape toggles expose aria-pressed',
      [...w.document.querySelectorAll('.prep-lie-chip,.prep-shape-btn')]
        .every((b)=>b.getAttribute('aria-pressed')!==null),
      w.document.querySelector('.prep-lie-chip')?.outerHTML.slice(0,120));
  }

  // 4. Recommendation memo must include actual bag values, not only count.
  {
    const clubs=[{id:'a',name:'Long',yards:200},{id:'b',name:'Short',yards:100}];
    const {w}=boot({clubs});
    const before=w.CaddyPrep.recommendClub(190);
    const row=[...w.document.querySelectorAll('.club-row')].find(r=>r.dataset.id==='a');
    const input=row.querySelector('.club-yard-input');input.value='130';
    input.dispatchEvent(new w.Event('change'));
    const after=w.CaddyPrep.recommendClub(190);
    check('club recommendation refreshes when carry changes',
      before.main!==after.main || before.sub!==after.sub,
      `${before.main} -> ${after.main}`);
  }

  // 5. Hole header has one Par label; map explicitly says what tapping does.
  {
    const {w}=boot();await wait(40);
    const sel=w.document.getElementById('planCourseSelect');sel.value='audit-course';
    sel.dispatchEvent(new w.Event('change'));await wait(40);
    w.document.querySelector('.plan-hole-row').click();await wait(220);
    check('hole header has one visible Par value',
      w.document.querySelectorAll('#prepStrategyCard .prep-strat-chip').length===3,
      [...w.document.querySelectorAll('#prepStrategyCard .prep-strat-chip')]
        .map(x=>x.textContent).join('|'));
    const map=w.document.getElementById('prepHoleMapTap');
    check('cartoon visibly announces satellite action',
      !!w.document.querySelector('.prep-map-action') &&
      /satellite/i.test(w.document.querySelector('.prep-map-action').textContent) &&
      /satellite/i.test(map.getAttribute('aria-label')||''),
      map.textContent.trim());
  }

  // 6. Move tee uses the canonical manual source, refreshes the open brief,
  // and remap preservation recognizes it.
  {
    const oldYards = course.holes[0].yards;
    const {w,maps}=boot();w.eval(satSrc);await wait(40);
    const sel=w.document.getElementById('planCourseSelect');sel.value='audit-course';
    sel.dispatchEvent(new w.Event('change'));await wait(40);
    w.document.querySelector('.plan-hole-row').click();await wait(220);
    w.document.getElementById('prepHoleMapTap').click();await wait(50);
    w.document.getElementById('pshMoveTee').click();
    const newTee=ll(25,12);maps[maps.length-1].fire('click',{latlng:newTee});await wait(80);
    const saved=JSON.parse(w.localStorage.getItem('caddy:courseProfiles:v1'))[0].holes[0];
    check('Move tee stores canonical teeSource=manual',saved.teeSource==='manual',saved.teeSource);
    check('Move tee refreshes the open Prep hole',
      /Prep updated/.test(w.document.getElementById('pshTeeBanner').textContent) &&
      [...w.document.querySelectorAll('.prep-strat-chip')].some((el) =>
        /yd/.test(el.textContent) && !/^387 yd$/.test(el.textContent.trim())),
      w.document.getElementById('pshTeeBanner').textContent.trim());
    w.document.getElementById('pshDone').click();
    w.document.getElementById('prepStratTitle').click();await wait(30);
    w.document.querySelector('.plan-hole-row').click();await wait(150);
    const reopenedYards=[...w.document.querySelectorAll('.prep-strat-chip')]
      .find((el)=>/yd/.test(el.textContent));
    check('Move tee survives back-and-reopen in the same app session',
      reopenedYards && !/^387 yd$/.test(reopenedYards.textContent.trim()),
      reopenedYards ? reopenedYards.textContent : 'no yardage chip');
    check('remap preservation accepts canonical manual tee source',
      /teeSource === ['"]manual['"]/.test(appSrc.slice(
        appSrc.indexOf('async function remapPlannerCourse'),
        appSrc.indexOf('function initPlanner'))));
    course.holes[0].yards = oldYards;
  }

  // 7. Elevation may display as a best-effort badge, but it must not silently
  // enter the neutral solve/advice until the data contract is deliberate.
  {
    const fetchStart=prepSrc.indexOf('function fetchGreenDelta');
    const fetchBlock=prepSrc.slice(fetchStart);
    check('elevation fetch does not mutate neutral solve state',
      !/cond\.elevFt\s*=/.test(fetchBlock),
      'fetchGreenDelta writes cond.elevFt');
  }

  // 8. v1.21.6: satellite sheet is a real dialog; cartoon tee dot follows a
  // moved tee; unsaved-course moves report honestly instead of "Tee saved".
  {
    const {w,maps}=boot();w.eval(satSrc);await wait(40);
    const sel=w.document.getElementById('planCourseSelect');sel.value='audit-course';
    sel.dispatchEvent(new w.Event('change'));await wait(40);
    w.document.querySelector('.plan-hole-row').click();await wait(220);
    const cartoonBefore=w.document.querySelector('.prep-hm-tee');
    w.document.getElementById('prepHoleMapTap').click();await wait(50);
    const sheetEl=w.document.getElementById('prep-sat-sheet');
    check('satellite sheet is a labeled modal dialog',
      sheetEl && sheetEl.getAttribute('role')==='dialog' &&
      sheetEl.getAttribute('aria-modal')==='true' &&
      /satellite/i.test(sheetEl.getAttribute('aria-label')||''));
    w.document.getElementById('pshMoveTee').click();
    check('Move tee exposes armed state',
      w.document.getElementById('pshMoveTee').getAttribute('aria-pressed')==='true');
    // Move tee onto a clearly different point, then close.
    const moved=ll(25,30);maps[maps.length-1].fire('click',{latlng:moved});await wait(80);
    check('honest banner when persistence succeeds',/Tee saved/.test(
      w.document.getElementById('pshTeeBanner').textContent));
    w.document.getElementById('pshDone').click();await wait(50);
    // Second open: sheet tee follows the saved point, 3D Green link too.
    w.document.getElementById('prepHoleMapTap').click();await wait(50);
    // Intercept navigation through the sheet's testable seam.
    let assigned='';
    w.__pshNavigate=(url)=>{assigned=String(url);};
    w.document.getElementById('psh3d').click();
    const expectedLat=moved.lat.toFixed(6);
    check('3D Green link uses the moved tee coordinates',
      assigned.includes(`teelat=${expectedLat}`),
      assigned);
    w.document.getElementById('pshDone').click();await wait(50);
    const cartoonAfter=w.document.querySelector('.prep-hm-tee');
    check('cartoon tee dot follows the moved tee',
      cartoonBefore && cartoonAfter &&
      (cartoonAfter.getAttribute('cx')!==cartoonBefore.getAttribute('cx') ||
       cartoonAfter.getAttribute('cy')!==cartoonBefore.getAttribute('cy')),
      `${cartoonBefore?.getAttribute('cx')},${cartoonBefore?.getAttribute('cy')} -> `+
      `${cartoonAfter?.getAttribute('cx')},${cartoonAfter?.getAttribute('cy')}`);
  }

  if(fails){console.log(`${fails} FAILURE(S)`);process.exit(1);}
  console.log('v1.21.6 PREP AUDIT PASSED');process.exit(0);
})().catch(e=>{console.error(e.stack||e);process.exit(2);});
