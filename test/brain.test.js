import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecision, isAddressed } from '../src/brain.js';
test('silence and malformed or low-confidence output cannot trigger speech', () => {
  for (const value of [null, {}, {speak:false,score:1,text:'hi'}, {speak:true,score:0.3,text:'hi'}, {speak:true,score:1,text:'x'.repeat(241)}, {speak:true,score:1,text:''}, {speak:true,score:'1',text:'hi'}]) assert.equal(parseDecision(value, 0.7), null);
});
test('a short confident contribution is accepted', () => assert.equal(parseDecision({speak:true,score:0.95,text:'  Grüezi!  '}), 'Grüezi!'));
test('direct address uses the latest human turn and whole names', () => {
  assert.equal(isAddressed([{speaker:'Friend',text:'Hey, Bruno!'}]), true);
  assert.equal(isAddressed([{speaker:'Friend',text:'Brunost Käse'}]), false);
  assert.equal(isAddressed([{speaker:'Friend',text:'Bruno?'},{speaker:'Friend',text:'Okay.'}]), false);
  assert.equal(isAddressed([{speaker:'Bruno',text:'Ich bin Bruno.'}]), false);
});
test('requested replies can pass while the same confidence cannot interrupt', () => {
  const result = {speak:true,score:0.6,text:'Hallo zusammen!'};
  assert.equal(parseDecision(result, 0.7), null);
  assert.equal(parseDecision(result,0.5), result.text);
});
