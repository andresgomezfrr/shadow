import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmptyPlanInDisguise } from './plan-validation.js';

test('isEmptyPlanInDisguise: empty string', () => {
  assert.equal(isEmptyPlanInDisguise(''), true);
  assert.equal(isEmptyPlanInDisguise('   \n\n  '), true);
});

test('isEmptyPlanInDisguise: short generic reply', () => {
  assert.equal(
    isEmptyPlanInDisguise('No changes needed. The code is good.'),
    true,
  );
  assert.equal(
    isEmptyPlanInDisguise('Everything looks fine. No action required.'),
    true,
  );
});

test('isEmptyPlanInDisguise: structured plan is valid even if short', () => {
  const shortStructured = '## Step 1\n- **file:** foo.ts\n- edit Bar function';
  assert.equal(isEmptyPlanInDisguise(shortStructured), false);
});

test('isEmptyPlanInDisguise: numbered list is structure', () => {
  const numbered = '1. open foo.ts\n2. change x to y';
  assert.equal(isEmptyPlanInDisguise(numbered), false);
});

test('isEmptyPlanInDisguise: long unstructured prose is valid', () => {
  const longProse =
    'The current implementation handles the common case correctly but there ' +
    'is a subtle bug around edge case X where the validation step fails to ' +
    'catch malformed input. We need to adjust the validator to handle that ' +
    'case and ensure we cover it with tests. No breaking changes expected.';
  assert.ok(longProse.length > 200);
  assert.equal(isEmptyPlanInDisguise(longProse), false);
});

test('isEmptyPlanInDisguise: file reference counts as structure', () => {
  assert.equal(
    isEmptyPlanInDisguise('Update file: src/foo.ts to return null'),
    false,
  );
});

test('isEmptyPlanInDisguise: heading + empty body is still empty', () => {
  const headingOnly = '# Plan\n\n## Summary\n\n';
  assert.equal(isEmptyPlanInDisguise(headingOnly), true);
});
