import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameMatch, nameWords } from './names.js';

test('nameWords drops titles and punctuation', () => {
  assert.deepEqual(nameWords('Mr. Rahul  Kumar'), ['rahul', 'kumar']);
  assert.deepEqual(nameWords('Shri RA*** KUMAR'), ['ra***', 'kumar']);
  assert.deepEqual(nameWords('RAXXX KUMAR'), ['ra***', 'kumar']);
  assert.deepEqual(nameWords(''), []);
});

test('masked names match', () => {
  assert.equal(nameMatch('Rahul Kumar', 'RA*** KUMAR'), 'match');
  assert.equal(nameMatch('rahul kumar', 'Rahul Kumar'), 'match');
  assert.equal(nameMatch('Rahul Kumar', 'KUMAR RAHUL'), 'match');
  assert.equal(nameMatch('Rahul Kumar', 'R KUMAR'), 'match');
  assert.equal(nameMatch('Rahul Kumar Singh', 'RA*** KUMAR SI***'), 'match');
});

test('a missing middle name is partial', () => {
  assert.equal(nameMatch('Rahul Kumar Singh', 'RAHUL SINGH'), 'match');
  assert.equal(nameMatch('Rahul Kumar', 'RAHUL VERMA'), 'partial');
});

test('different names mismatch', () => {
  assert.equal(nameMatch('Rahul Kumar', 'SURESH VERMA'), 'mismatch');
  assert.equal(nameMatch('Rahul Kumar', 'SU**** VE***'), 'mismatch');
  assert.equal(nameMatch('Amit', 'SURESH VERMA'), 'mismatch');
});

test('nothing to judge', () => {
  assert.equal(nameMatch('', 'RAHUL KUMAR'), '');
  assert.equal(nameMatch('Rahul', ''), '');
});
