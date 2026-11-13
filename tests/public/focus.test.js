import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusIndexAfterRemove, stepHeadingId } from '../../public/js/focus.js';

test('step heading ids', () => {
  assert.equal(stepHeadingId(1), 'step-1-title');
  assert.equal(stepHeadingId(3), 'step-3-title');
});

test('after removing a chip, focus goes to the chip now in its place, else the one before', () => {
  assert.equal(focusIndexAfterRemove(2, 5), 2); // 6 chips, removed #2, 5 left: next chip slides into #2
  assert.equal(focusIndexAfterRemove(5, 5), 4); // removed the last one: focus the new last
  assert.equal(focusIndexAfterRemove(0, 0), -1); // none left
});
