import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canEnterStep, stepFromState } from '../../public/js/steps.js';

test('step 1 is always open; steps 2 and 3 need a picked area', () => {
  assert.equal(canEnterStep(1, false), true);
  assert.equal(canEnterStep(2, false), false);
  assert.equal(canEnterStep(3, false), false);
  assert.equal(canEnterStep(2, true), true);
  assert.equal(canEnterStep(3, true), true);
});

test('stepFromState reads the step from a history entry', () => {
  assert.equal(stepFromState({ step: 2 }), 2);
  assert.equal(stepFromState({ step: 3 }), 3);
});

test('stepFromState falls back to step 1 for missing or bad state', () => {
  assert.equal(stepFromState(null), 1);
  assert.equal(stepFromState(undefined), 1);
  assert.equal(stepFromState({}), 1);
  assert.equal(stepFromState({ step: 4 }), 1);
  assert.equal(stepFromState({ step: '2' }), 1);
});
