'use strict';
const assert=require('assert/strict');
const {test}=require('node:test');
const {boot}=require('./helpers/app-harness');
const weather={current:{temperature_2m:72,relative_humidity_2m:50,wind_speed_10m:12,wind_direction_10m:90,wind_gusts_10m:16,surface_pressure:995,wind_speed_80m:16},daily:{sunset:[1800000000]}};
test('weather query uses supported daily sunset field and unambiguous Unix time',async()=>{
 const h=boot({},['updateContext']);try{
  let queried=null;h.w.fetch=async url=>{queried=new URL(url);if(queried.searchParams.get('current').split(',').includes('sunset'))return {ok:false,status:400};return {ok:true,json:async()=>weather};};
  h.api.state.loc={lat:41.73,lng:-93.6};await h.api.updateContext();
  assert.ok(h.api.state.context.weather,'valid live response should populate weather, not neutral fallback');
  assert.equal(queried.searchParams.get('daily'),'sunset');assert.equal(queried.searchParams.get('timeformat'),'unixtime');
  assert.equal(h.api.state.context.weather.sunsetMs,1800000000000);assert.equal(h.api.state.context.weather.windMph,12);
 }finally{h.close();}
});
test('older weather response cannot repopulate context after location is cleared',async()=>{
 const h=boot({},['updateContext']);try{
  let resolve;h.w.fetch=()=>new Promise(r=>resolve=r);h.api.state.loc={lat:41.73,lng:-93.6};
  const pending=h.api.updateContext();h.api.state.loc=null;h.api.state.target=null;
  await h.api.updateContext();resolve({ok:true,json:async()=>weather});await pending;
  assert.equal(h.api.state.context.weather,null);
 }finally{h.close();}
});
test('cached elevation belongs to precise shot endpoints rather than an adjacent hole',async()=>{
 const h=boot({},['updateContext']);try{
  let elevCalls=0;h.w.fetch=async url=>String(url).includes('/elevation')
   ? {ok:true,json:async()=>({elevation:[100,101,102,103,104,105,106,107,108+elevCalls++]})}
   : {ok:true,json:async()=>weather};
  h.api.state.loc={lat:41.7301,lng:-93.6001};h.api.state.target={lat:41.7311,lng:-93.6001};
  await h.api.updateContext();h.api.state.loc={lat:41.7304,lng:-93.6001};h.api.state.target={lat:41.7314,lng:-93.6001};
  await h.api.updateContext();assert.equal(elevCalls,2,'distinct shot endpoints must not share a 110m-bucket elevation profile');
 }finally{h.close();}
});
