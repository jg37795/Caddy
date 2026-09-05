'use strict';
const assert=require('assert/strict');const fs=require('fs');const path=require('path');const{test}=require('node:test');const{JSDOM}=require('jsdom');
test('satellite bright half is aligned with physical high-side bearing',()=>{
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://caddy.test/Caddy/',runScripts:'outside-only'});const w=dom.window;try{const polygons=[];const layer=()=>({addTo(){return this;}});w.requestAnimationFrame=()=>0;w.L={map:()=>({setView(){return this;},invalidateSize(){},fitBounds(){},on(){},remove(){},removeLayer(){}}),tileLayer:layer,polyline:layer,marker:layer,circleMarker:layer,divIcon:o=>o,latLngBounds:()=>({extend(){return this;}}),polygon:(ring,style)=>{polygons.push({ring,style});return layer();}};
 const ring=Array.from({length:16},(_,i)=>{const a=(i+0.5)*Math.PI*2/16;return[40+Math.sin(a)*8/111320,-100+Math.cos(a)*8/(111320*Math.cos(40*Math.PI/180))];});
 w.GreenBriefCore={briefFor:()=>({highSideDirDeg:90,zones:[{}, {breakIn:10,dirDeg:270}]})};w.eval(fs.readFileSync(path.join(__dirname,'../holeSat.js'),'utf8'));
 w.PrepHoleSat.open({greenLatLng:{lat:40,lng:-100},teeLatLng:{lat:39.99,lng:-100},holeData:{greenCenter:{lat:40,lng:-100},greenRingPts:ring.map(([lat,lng])=>({lat,lng})),shapes:{},pathPts:[],hazards:[]}});
 const high=polygons.find(p=>p.style.fillColor==='rgba(125,255,155,0.28)');assert.ok(high);assert.ok(high.ring.every(p=>p[1]>-100),'east high side must contain only east-side ring vertices, not the south half');
 }finally{w.close();}
});
