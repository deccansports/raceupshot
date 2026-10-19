import assert from 'node:assert/strict';
import test from 'node:test';

import { boundedCourseCoordinates } from './nativeMapGeometry';

test('native course geometry is bounded while preserving endpoints', () => {
  const input = Array.from({ length: 2_000 }, (_, index) => index);
  const output = boundedCourseCoordinates(input, 600);
  assert.equal(output.length, 600);
  assert.equal(output[0], 0);
  assert.equal(output.at(-1), 1_999);
  assert.equal(new Set(output).size, output.length);
});

test('short geometry remains unchanged', () => {
  assert.deepEqual(boundedCourseCoordinates([1, 2, 3], 600), [1, 2, 3]);
});
