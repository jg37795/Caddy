'use strict';
const assert=require('assert/strict');const {test}=require('node:test');const {boot,course}=require('./helpers/app-harness');
const names=['buildBackupObject','describeBackup','applyBackupObject','reloadStateFromStorage'];
const stored={
 'caddy:clubs':[{id:'d',name:'Driver',yards:240}],
 'caddy.bag.clubs.v1':[{id:'d',name:'Driver',yards:240,notes:'restore this note',loft:10.5}],
 'caddy:groupRoster:v1':[{id:'alex',name:'Alex'}],
 'caddy:courseTees':{'Fixture':'Blue'},
 'caddy.stats.roundSnapshots':[{ts:100,total:4,holes:[{hole:1,score:4}]}],
 'caddy:greenOutlines:v2':{'40,-100':{lat:40,lng:-100,chosen:'osm',osmRing:[[40,-100],[40.001,-100],[40,-99.999]]}},
 'caddy.prep.cond':{windMph:12,tempF:65},'caddy.prep.shot':{lie:'rough',shape:'fade'},
 'gm-stimp':12,'caddy:pinMemory:v1':{'a':{'1':{lat:40,lng:-100}}},
};
test('backup round-trip preserves all irreplaceable user data',()=>{
 const a=boot(stored,names);const b=boot({},names);try{const backup=a.api.buildBackupObject();b.api.applyBackupObject(backup);for(const[k,v]of Object.entries(stored))assert.deepEqual(JSON.parse(b.w.localStorage.getItem(k)),v,k+' must round trip');}finally{a.close();b.close();}
});
test('replace restore clears keys absent from backup instead of mixing unrelated rounds',()=>{
 const h=boot({'caddy:roundSession':{status:'active',course:course(),scorecard:[],groupPlayers:[]}},names);try{h.api.applyBackupObject({app:'caddy',schema:1,data:{clubs:[]}});h.api.reloadStateFromStorage();assert.equal(h.api.state.roundSession,null);assert.equal(h.w.localStorage.getItem('caddy:roundSession'),null);assert.equal(h.api.state.clubs.length,0);}finally{h.close();}
});
test('failed restore rolls back all changed keys and reports failure',()=>{
 const h=boot({'caddy:clubs':[{id:'old',name:'Old',yards:120}]},names);try{
  const before=Object.fromEntries(Object.keys(h.w.localStorage).map(k=>[k,h.w.localStorage.getItem(k)]));
  const set=h.w.Storage.prototype.setItem;let once=true;
  h.w.Storage.prototype.setItem=function(k,v){if(k==='caddy:clubs'&&once){once=false;throw new h.w.DOMException('full','QuotaExceededError');}return set.call(this,k,v);};
  assert.throws(()=>h.api.applyBackupObject({app:'caddy',schema:1,data:{prefs:{theme:'light'},clubs:[{id:'new',name:'New',yards:200}]}}),/restore|full|storage/i);
  for(const[k,v]of Object.entries(before))assert.equal(h.w.localStorage.getItem(k),v,'rollback '+k);
 }finally{h.close();}
});
test('malformed backup shape is rejected before writes',()=>{const h=boot({},names);try{for(const data of [{prefs:null},{round:[null]},{courseProfiles:'bad'},{shotLog:{d:'bad'}}]){const before=h.w.localStorage.getItem('caddy:prefs');assert.throws(()=>h.api.applyBackupObject({app:'caddy',schema:1,data}),/malformed|invalid/i);assert.equal(h.w.localStorage.getItem('caddy:prefs'),before);}}finally{h.close();}});
test('loaded Bag metadata is refreshed before observer can undo a restore',async()=>{
 const h=boot(stored,names);try{h.load('bag.js');h.w.document.dispatchEvent(new h.w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,80));
 const backup=h.api.buildBackupObject();backup.data.bagClubs[0].notes='backup replacement';backup.data.clubs[0].yards=220;
 h.api.applyBackupObject(backup);h.api.reloadStateFromStorage();await new Promise(r=>setTimeout(r,200));
 assert.equal(JSON.parse(h.w.localStorage.getItem('caddy.bag.clubs.v1'))[0].notes,'backup replacement');
 }finally{h.close();}
});
