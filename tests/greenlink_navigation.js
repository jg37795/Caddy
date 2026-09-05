'use strict';
const assert=require('assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');const {test}=require('node:test');
const src=fs.readFileSync(path.join(__dirname,'../greenlink.js'),'utf8');
function boot(session){let click=null;const toast={textContent:'',classList:{add(){},remove(){}}};const host={appendChild(){}};const location={href:'https://caddy.test/Caddy/'};
 const button={id:'',className:'',innerHTML:'',setAttribute(){},addEventListener(t,f){if(t==='click')click=f;}};
 const context={window:{__rxRangePremium:true},location,localStorage:{getItem:()=>JSON.stringify(session)},setTimeout(){},document:{readyState:'complete',getElementById:()=>null,createElement:()=>button,querySelector:s=>s==='.top-right-row2'?host:s==='.rx-toast'?toast:null}};
 vm.runInNewContext(src,context);return{click:()=>click(),location,toast};}
test('Play 3D Green launches the current course/hole and exact coordinates',()=>{
 const h=boot({hole:2,course:{id:'course & test',holesCount:9,holes:[{}, {greenCenter:{lat:41.7,lng:-93.6},teePoint:{lat:41.69,lng:-93.6}}]}});
 assert.doesNotThrow(h.click);const url=new URL(h.location.href,'https://caddy.test/Caddy/');assert.equal(url.pathname,'/Caddy/greenmap.html');assert.equal(url.searchParams.get('course'),'course & test');assert.equal(url.searchParams.get('hole'),'2');assert.equal(url.searchParams.get('lat'),'41.700000');assert.equal(url.searchParams.get('pinlat'),'41.700000');
});
test('missing green does not navigate or invent coordinates',()=>{const h=boot({hole:1,course:{holes:[{}]}});h.click();assert.equal(h.location.href,'https://caddy.test/Caddy/');assert.match(h.toast.textContent,/No green marked/);});
