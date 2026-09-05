'use strict';
const assert=require('assert/strict');const fs=require('fs');const path=require('path');const {test}=require('node:test');const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
test('saved course outline works offline on first 3D visit with no OutlineStore record',async()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(root,'greenmap.html'),'utf8'),{url:'https://caddy.test/Caddy/greenmap.html?lat=40&lng=-100&course=saved&hole=1',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
 try{
  let calls=0;w.AbortController=AbortController;w.fetch=async()=>{calls++;throw new Error('offline fixture');};
  w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({createImageData:(W,H)=>({data:new Uint8ClampedArray(W*H*4)}),createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})}, {get(t,p){return p in t?t[p]:()=>{};},set(t,p,v){t[p]=v;return true;}});
  const ring=[[39.9999,-100.0001],[40.0001,-100.0001],[40.0001,-99.9999],[39.9999,-99.9999]];
  w.localStorage.setItem('caddy:courseProfiles:v1',JSON.stringify([{id:'saved',holes:[{greenRingPts:ring}]}]));
  w.CaddyElev={fetchElevGrid:async bbox=>({grid:new Float32Array(4096).fill(100),W:64,H:64,cellSizeM:0.625,validMask:null,bbox})};w.GreenDetect={detect:()=>null};
  w.eval(fs.readFileSync(path.join(root,'outlineStore.js'),'utf8'));w.eval(fs.readFileSync(path.join(root,'greenmap.js'),'utf8'));
  await new Promise(r=>setTimeout(r,1000));
  assert.equal(w.__gmState.polySource,'osm','saved profile ring must be adopted without prior store record');
  assert.equal(calls,0,'saved ring should avoid Overpass entirely');assert.ok(w.OutlineStore.get(40,-100).osmRing);
 }finally{w.close();}
});
