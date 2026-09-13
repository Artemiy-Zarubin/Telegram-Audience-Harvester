import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HarvesterError,
  TelegramAuthError,
  FloodWaitExceededError,
  PtsOutOfSyncError,
} from '../src/errors.js';

test('HarvesterError class hierarchy is correctly preserved', () => {
  const base = new HarvesterError('base error');
  assert.ok(base instanceof Error);
  assert.ok(base instanceof HarvesterError);
  assert.equal(base.name, 'HarvesterError');

  const auth = new TelegramAuthError('invalid token');
  assert.ok(auth instanceof HarvesterError);
  assert.equal(auth.name, 'TelegramAuthError');

  const flood = new FloodWaitExceededError(500, 300);
  assert.ok(flood instanceof HarvesterError);
  assert.equal(flood.name, 'FloodWaitExceededError');
  assert.equal(flood.waitSeconds, 500);

  const pts = new PtsOutOfSyncError(12345);
  assert.ok(pts instanceof HarvesterError);
  assert.equal(pts.name, 'PtsOutOfSyncError');
  assert.equal(pts.pts, 12345);
});
