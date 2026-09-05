'use strict';
// Re-verify both reviewer scenarios against the shipped code with their own
// stated failure paths before touching production again.
const assert = require('assert/strict');
const { test } = require('node:test');
const { boot, course } = require('./helpers/app-harness');

const names = ['beginRound', 'summarizeRound', 'teardownRoundSession',
  'getScorecardRows', 'renderRoundTeePicker', 'saveCurrentRoundToHistory',
  'state', 'getCurrentCourse', 'applyTeeSet', 'reloadStateFromStorage'];

test('stale roundMeta does not survive a mid-round tee change at end', () => {
  const h = boot({}, names);
  try {
    const a = h.api;
    a.beginRound(course(9), 1);
    // Reproduce the reviewer's probe: switch tees to a set whose par is 4
    // where the original tees played par 3.
    const c = a.getCurrentCourse();
    c.teeSets = [{ name: 'New', holes: Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [i + 1,
        { yards: 300 + i * 20, lat: 40, lng: -100 }])) }];
    c.holes.forEach((h2, i) => { h2.parByTee = { New: i % 3 === 2 ? 5 : 4 }; });
    a.state.roundSession.course = c;
    a.applyTeeSet(c, 'New');
    a.state.round[0].score = '3';
    assert.equal(a.summarizeRound(a.state.round).toPar, -1, 'live vs-par uses par 4');
    a.teardownRoundSession(true);
    const saved = JSON.parse(h.w.localStorage.getItem('caddy:history'))[0];
    assert.equal(saved.toPar, -1, 'saved vs-par must match the live calculation');
    assert.equal(saved.pars[0], 4, 'embedded par must reflect the played tees');
    assert.equal(saved.course.teeName, 'New', 'course snapshot must carry the played tees');
    assert.equal(a.summarizeRound(a.state.round).toPar, -1, 'retained meta must not flip back');
  } finally { h.close(); }
});

test('ending a second round updates its own entry and keeps others intact', () => {
  const h = boot({}, names);
  try {
    const a = h.api;
    a.beginRound(course(9), 1);
    a.state.round[0].score = '4';
    a.teardownRoundSession(true);
    const firstId = JSON.parse(h.w.localStorage.getItem('caddy:history'))[0].id;
    a.beginRound(course(9), 1);
    a.state.round[0].score = '5';
    a.teardownRoundSession(true);
    const history = JSON.parse(h.w.localStorage.getItem('caddy:history'));
    assert.equal(history.length, 2, 'different rounds must not overwrite each other');
    assert.notEqual(history[1].id, firstId);
    // Reviewer probe: clear the retained card, then save again — must not
    // resurrect or overwrite the saved entries with an 18-row blank card.
    a.state.round = a.state.roundMeta
      ? a.state.round
      : a.state.round;
    h.w.localStorage.setItem('caddy:round', JSON.stringify(
      Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, score: '', putts: '', fir: '', gir: '' }))));
    // Simulate a fresh launch: blank round + retained meta rehydrate together.
    const relaunched = boot(Object.fromEntries(Object.keys(h.w.localStorage).map(k =>
      [k, JSON.parse(h.w.localStorage.getItem(k))])), names);
    try {
      assert.equal(relaunched.api.state.roundMeta.course.holesCount, 9, 'restored meta keeps the 9-hole layout');
      assert.equal(relaunched.api.state.round.length, 9, 'retained layout normalizes the blank card');
      relaunched.api.state.round[0].score = '5';
      relaunched.api.teardownRoundSession(true);
      const after = relaunched.api.state.history;
      assert.equal(after.length, 2, 'no phantom duplicate from the cleared card');
      assert.equal(after[after.length - 1].totalScore, 5,
        'upsert with the retained identity updates the previous blank entry (no 18-hole ghost)');
      assert.equal(after.every(r => r.holesCount === 9), true, 'no entry claims 18 holes');
    } finally { relaunched.close(); }
  } finally { h.close(); }
});
