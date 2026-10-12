import assert from 'node:assert/strict';
import test from 'node:test';

import { athleteBibLabelMetrics } from '../src/features/tracking/course-map/athleteBibLabel';

test('map bib labels retain the complete bib and expand for longer values', () => {
  const shortBib = athleteBibLabelMetrics('101');
  const longBib = athleteBibLabelMetrics('1234567890');

  assert.equal(longBib.label, '1234567890');
  assert.ok(longBib.width > shortBib.width);
  assert.ok(longBib.fontSize < shortBib.fontSize);
});
