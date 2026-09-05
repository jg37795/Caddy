'use strict';
const assert = require('assert/strict');
const { test } = require('node:test');
const {boot,course}=require('./helpers/app-harness');
const names=['beginRound','emptyRoundSession','getCurrentHoleNumber','getCourseHoleCount','getScorecardRows','openRoundScoreSheet','openRoundMiniSheet','saveRoundScoreDraft','saveRoundMiniDraft','closeRoundScoreSheet','migrateRoundSession','summarizeRound','roundScoreToPar','renderRound','renderStats','teardownRoundSession'];

test('9-hole start and restored current hole stay within the course',()=>{
 const h=boot({},names);try{
  const session=h.api.emptyRoundSession(course(),18);
  assert.equal(session.hole,9,'start hole must be clamped to the chosen course');
  h.api.state.roundSession=session;session.hole=18;h.api.migrateRoundSession();
  assert.equal(h.api.getCurrentHoleNumber(),9,'restored hole must not address an absent back nine');
 }finally{h.close();}
});
test('clearing a 9-hole scorecard keeps nine rows',()=>{
 const h=boot({},names);try{
  h.api.beginRound(course(),1);h.api.state.round[0].score='4';h.api.renderRound();
  h.w.document.getElementById('clearRoundBtn').click();
  assert.equal(h.api.getScorecardRows().length,9);
  assert.equal(h.api.state.roundSession.scorecard.length,9);
 }finally{h.close();}
});
test('partner draft cannot contaminate the personal quick-edit sheet',()=>{
 const h=boot({},names);try{
  const a=h.api;a.beginRound(course(),1);a.state.round[0].score='4';a.state.round[0].putts='2';
  a.state.roundSession.groupPlayers=[{id:'p1',name:'Alex'}];a.state.roundSession.groupScores={p1:['8']};
  a.openRoundScoreSheet(1);h.w.document.querySelector('#roundScoreChips [data-pid="p1"]').click();a.closeRoundScoreSheet();
  a.openRoundMiniSheet(1);
  assert.equal(a.state.roundMiniDraft.score,4,'own sheet must use own score, not the last partner');
  assert.equal(a.state.roundMiniDraft.putts,2);
  a.saveRoundMiniDraft();assert.equal(a.state.round[0].score,'4');assert.equal(a.state.round[0].putts,'2');
  assert.equal(a.state.roundSession.groupScores.p1[0],'8');
 }finally{h.close();}
});
test('partner table rejects invalid scores and preserves a saved value',()=>{
 const h=boot({},names);try{
  const a=h.api;a.beginRound(course(),1);a.state.roundSession.groupPlayers=[{id:'p1',name:'Alex'}];
  a.state.roundSession.groupScores={p1:['5']};a.renderRound();
  for(const bad of ['99','0','-1','1.5']){
   const input=h.w.document.querySelector('input[data-pid="p1"][data-i="0"]');input.value=bad;input.dispatchEvent(new h.w.Event('change'));
   assert.equal(a.state.roundSession.groupScores.p1[0],'5','invalid score '+bad+' must not enter player data');
  }
  const input=h.w.document.querySelector('input[data-pid="p1"][data-i="0"]');input.value='';input.dispatchEvent(new h.w.Event('change'));
  assert.equal(a.state.roundSession.groupScores.p1[0],'','explicit blank clears a partner score');
 }finally{h.close();}
});
test('blank, zero, invalid and null rows never count as played holes',()=>{
 const h=boot({},names);try{
  const s=h.api.summarizeRound([null,{score:null,putts:null},{score:'',putts:''},{score:'0'},{score:'-2'},{score:'1.5'},{score:'5',putts:'2'}]);
  assert.equal(s.played,1);assert.equal(s.totalScore,5);assert.equal(s.puttRows,1);assert.equal(s.totalPutts,2);
 }finally{h.close();}
});
test('malformed persisted round rows recover without changing hole positions',()=>{
 const h=boot({'caddy:roundSession':{status:'active',hole:1,course:course(),scorecard:[null,{hole:2,score:'5',putts:'2'}],shots:[],groupPlayers:[null],groupScores:{}}},names);
 try{assert.equal(h.api.state.round.length,9);assert.equal(h.api.state.round[0].score,'');assert.equal(h.api.state.round[1].score,'5');assert.deepEqual(h.errors,[]);}finally{h.close();}
});
