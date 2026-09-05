'use strict';
const assert=require('assert/strict');
const {test}=require('node:test');
const {boot,course}=require('./helpers/app-harness');
const names=['beginRound','summarizeRound','teardownRoundSession','getScorecardRows','renderStats','renderRound'];
function scored(h){h.api.beginRound(course(),1);h.api.state.round[0].score='3';h.api.state.round[0].putts='1';h.api.state.round[1].score='5';h.api.state.round[1].putts='2';}

test('summary-save retains exact scorecard, course pars and nine-hole context',()=>{
 const h=boot({},names);try{
  scored(h);h.api.teardownRoundSession(true);
  const saved=JSON.parse(h.w.localStorage.getItem('caddy:history'))[0];
  assert.ok(saved.id,'history needs stable round identity');
  assert.equal(saved.totalScore,8);assert.equal(saved.toPar,1);assert.equal(saved.holesCount,9);
  assert.equal(saved.course.name,'Fixture 9 GC');assert.equal(saved.scorecard[1].score,'5');assert.equal(saved.pars[0],3);
  const retained=h.api.summarizeRound(h.api.state.round);assert.equal(retained.toPar,1);assert.equal(retained.holesCount,9);
  h.api.renderStats();assert.match(h.w.document.getElementById('statsBreakdown').textContent,/2 \/ 9/);
  const seed=Object.fromEntries(Object.keys(h.w.localStorage).map(k=>[k,JSON.parse(h.w.localStorage.getItem(k))]));
  const restored=boot(seed,names);try{const s=restored.api.summarizeRound(restored.api.state.round);assert.equal(s.toPar,1);assert.equal(s.holesCount,9);}finally{restored.close();}
 }finally{h.close();}
});
test('Stats save and summary save update one round rather than duplicate it',()=>{
 const h=boot({},names);try{
  scored(h);h.w.confirm=()=>false;
  h.w.document.getElementById('saveRoundBtn').click();h.w.document.getElementById('saveRoundBtn').click();
  assert.equal(h.api.state.history.length,1,'repeated save must be idempotent');
  h.api.state.round[1].score='4';h.api.teardownRoundSession(true);
  assert.equal(h.api.state.history.length,1);assert.equal(h.api.state.history[0].totalScore,7);
 }finally{h.close();}
});
test('fresh scorecard resets both live and legacy consumers to nine rows',()=>{
 const h=boot({},names);try{
  scored(h);h.w.confirm=()=>true;h.w.document.getElementById('saveRoundBtn').click();
  assert.equal(h.api.state.round.length,9);assert.equal(h.api.getScorecardRows().length,9);
  assert.equal(h.api.getScorecardRows()[0].score,'');assert.equal(h.api.state.roundSession.scorecard,h.api.state.round);
 }finally{h.close();}
});
test('failed history persistence never tears down the live round',()=>{
 const h=boot({},names);try{
  scored(h);const session=h.api.state.roundSession;
  const set=h.w.Storage.prototype.setItem;
  h.w.Storage.prototype.setItem=function(k,v){if(k==='caddy:history')throw new h.w.DOMException('full','QuotaExceededError');return set.call(this,k,v);};
  h.api.teardownRoundSession(true);
  assert.equal(h.api.state.roundSession,session,'save failure must retain the round for retry/export');
  assert.equal(h.api.state.history.length,0,'failed write must not claim durable history');
  assert.match(h.w.document.getElementById('rangeNotice').textContent,/save|storage|full/i);
 }finally{h.close();}
});
test('dashboard uses saved per-hole data without a timing-based snapshot',()=>{
 const h=boot({},names);try{
  scored(h);h.api.teardownRoundSession(true);h.load('stats.js');
  h.w.document.body.setAttribute('data-tab','stats');
  h.w.document.dispatchEvent(new h.w.Event('DOMContentLoaded'));
  const body=h.w.document.getElementById('statsDashboard').textContent;
  assert.match(body,/Hole-by-hole from your saved scorecard/,'end-summary saves must include dashboard hole detail');
  assert.equal(h.w.document.querySelectorAll('#statsDashboard .sd-hole:not([style*="hidden"])').length,2);
  assert.equal(h.api.state.history[0].scorecard.length,9);
 }finally{h.close();}
});
