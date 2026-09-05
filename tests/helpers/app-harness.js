'use strict';
// Test-only seam into the existing IIFE; no globals are added to production.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
function boot(seed = {}, names = []) {
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html, { url:'https://caddy.test/Caddy/', runScripts:'outside-only', pretendToBeVisual:true, virtualConsole:vc });
  const w = dom.window;
  w.addEventListener('error', e => errors.push(e.error || e.message));
  w.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){} });
  w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {};
  w.fetch = async () => { throw new Error('offline fixture'); };
  w.HTMLCanvasElement.prototype.getContext = () => null;
  Object.defineProperty(w.navigator, 'geolocation', {value:{watchPosition:()=>1,clearWatch(){},getCurrentPosition(){}}});
  const layer = () => ({addTo(){return this;},on(){return this;},setLatLng(){return this;},setLatLngs(){return this;},setStyle(){return this;},addLayer(){return this;},remove(){},bindTooltip(){return this;}});
  w.L = {map(){return Object.assign(layer(),{setView(){return this;},fitBounds(){return this;},invalidateSize(){},removeLayer(){},hasLayer:()=>false,getPane:()=>({style:{}}),createPane:()=>({style:{}}),getBounds:()=>({pad(){return this;}})});},
    tileLayer:layer,layerGroup:layer,polyline:layer,polygon:layer,marker:layer,circle:layer,circleMarker:layer,
    divIcon:o=>o,latLngBounds:()=>({extend(){return this;},pad(){return this;},isValid:()=>true}),
    control:{zoom:layer,scale:layer,layers:layer,attribution:layer},DomEvent:new Proxy({},{get:()=>()=>{}}),DomUtil:new Proxy({},{get:()=>()=>{}})};
  w.localStorage.setItem('caddy:onboarded','1');
  w.localStorage.setItem('caddy:prefs',JSON.stringify({activeTab:'shot',theme:'dark',mode:'golf',gpsEnabled:false}));
  for(const [key,value] of Object.entries(seed)) w.localStorage.setItem(key,JSON.stringify(value));
  const expose = ['state',...names].join(',');
  const mark = '  bootstrap();';
  if(!source.includes(mark)) throw new Error('app bootstrap seam missing');
  try { w.eval(source.replace(mark, '  window.__test = {'+expose+'};\n'+mark)); }
  catch(e) { w.close(); throw e; }
  return {w,api:w.__test,errors,close:()=>w.close(),load(file){w.eval(fs.readFileSync(path.join(ROOT,file),'utf8'));}};
}
function course(n=9) {
  return {id:'fixture-'+n,name:'Fixture '+n+' GC',holesCount:n,teeName:'Regular',source:'manual',
    holes:Array.from({length:n},(_,i)=>({number:i+1,par:[3,4,5][i%3],yards:[145,380,490][i%3]}))};
}
module.exports={boot,course};
