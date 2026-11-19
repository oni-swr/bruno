import test from 'node:test';
import assert from 'node:assert/strict';
import { canConsider, canPrepare, canPlayPrepared } from '../src/timing.js';
const ready = () => ({quiet:false,busy:false,playing:false,pending:0,streams:new Map(),revision:1,considered:0,lastSpeech:10000,lastReply:0});
const direct = {gap:650,cooldown:1500};
test('transcription and quiet time overlap instead of stacking', () => {
  assert.equal(canConsider(ready(),10649,direct),false);
  assert.equal(canConsider(ready(),10650,direct),true);
  assert.equal(canConsider(ready(),11400,direct),true);
});
test('faster reply timing still respects speakers, transcription, playback and mute', () => {
  for (const state of [{quiet:true},{busy:true},{playing:true},{pending:1},{streams:new Map([['speaker',{}]])},{considered:1},{lastSpeech:11390},{lastReply:11000}]) {
    assert.equal(canConsider({...ready(),...state},11400,direct),false,JSON.stringify(state));
  }
});

test('unsolicited comments prepare while people speak, then wait for a gap', () => {
  const state = {...ready(), streams:new Map([['speaker',{}]]), pending:1};
  assert.equal(canPrepare(state,11400,direct),true);
  state.considered = state.revision;
  state.prepared = {revision:1,createdAt:11000};
  assert.equal(canPlayPrepared(state,11400,direct),false);
  state.streams.clear(); state.pending=0;
  assert.equal(canPlayPrepared(state,11400,direct),true);
});

test('nonverbal sound delays but does not discard a prepared comment', () => {
  const state = {...ready(),considered:1,prepared:{revision:1,createdAt:11000},lastSpeech:11400};
  assert.equal(canPlayPrepared(state,11500,direct),false);
  assert.equal(canPlayPrepared(state,12050,direct),true);
});

test('newer transcripts keep a prepared comment; expiry, quiet mode and playback still block it', () => {
  const state = {...ready(),prepared:{revision:1,createdAt:11000}};
  assert.equal(canPlayPrepared({...state,revision:3},11700,direct),true);
  for (const patch of [{quiet:true},{playing:true},{lastReply:11300}]) {
    assert.equal(canPlayPrepared({...state,...patch},11400,direct),false);
  }
  assert.equal(canPlayPrepared(state,11000+90000,direct),false);
  assert.equal(canPrepare({...state,revision:2},11400,direct),false, 'one held comment at a time');
  assert.equal(canPrepare({...state,revision:2},11400,{...direct,addressed:true}),true, 'direct reply may replace it');
  assert.equal(canPrepare({...state,busy:true},11400,direct),false);
  assert.equal(canPrepare({...state,considered:1},11400,direct),false);
});

test('after speaking he waits for a new human turn unless someone named him', () => {
  const state = {...ready(), revision:5, considered:4, spokeAt:5};
  assert.equal(canPrepare(state,11400,direct),false);
  assert.equal(canPrepare(state,11400,{...direct,addressed:true}),true);
  assert.equal(canPrepare({...state,revision:6},11400,direct),true);
});
