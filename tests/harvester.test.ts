import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRawUser } from '../src/harvester.js';

test('parseRawUser ignores bots and non-user entities', () => {
  const activeThreshold = 1000000;
  assert.equal(parseRawUser(null, activeThreshold, 7), null);
  assert.equal(parseRawUser({ _: 'userEmpty', id: 1 }, activeThreshold, 7), null);
  assert.equal(parseRawUser({ _: 'user', id: 2, bot: true }, activeThreshold, 7), null);
  assert.equal(parseRawUser({ _: 'user', id: 'not_a_number' }, activeThreshold, 7), null);
  assert.equal(parseRawUser({ _: 'user', id: NaN }, activeThreshold, 7), null);
  assert.equal(parseRawUser({ _: 'user' }, activeThreshold, 7), null);
});

test('parseRawUser correctly parses active online and recently users', () => {
  const now = 1700000000;
  const threshold = now - 7 * 86400;

  const onlineUser = {
    _: 'user',
    id: 12345,
    firstName: 'John',
    lastName: 'Doe',
    username: 'johndoe',
    premium: true,
    status: { _: 'userStatusOnline', expires: now + 300 },
    langCode: 'en',
    photo: { _: 'userProfilePhoto', dcId: 4 },
  };

  const parsedOnline = parseRawUser(onlineUser, threshold, 7);
  assert.ok(parsedOnline);
  assert.equal(parsedOnline.id, 12345);
  assert.equal(parsedOnline.firstName, 'John');
  assert.equal(parsedOnline.lastName, 'Doe');
  assert.equal(parsedOnline.username, 'johndoe');
  assert.equal(parsedOnline.isPremium, true);
  assert.equal(parsedOnline.isActive, true);
  assert.equal(parsedOnline.photoDcId, 4);

  const recentlyUser = {
    _: 'user',
    id: 12346,
    firstName: 'Jane',
    status: { _: 'userStatusRecently' },
  };

  const parsedRecently = parseRawUser(recentlyUser, threshold, 7);
  assert.ok(parsedRecently);
  assert.equal(parsedRecently.isActive, true);
  assert.equal(parsedRecently.status, 'userStatusRecently');
});

test('parseRawUser calculates activity for offline users by threshold', () => {
  const now = 1700000000;
  const threshold = now - 7 * 86400;

  // Active within 7 days
  const recentOffline = {
    _: 'user',
    id: 2001,
    status: { _: 'userStatusOffline', wasOnline: now - 3 * 86400 },
  };
  const parsed1 = parseRawUser(recentOffline, threshold, 7);
  assert.ok(parsed1);
  assert.equal(parsed1.isActive, true);
  assert.equal(parsed1.lastSeen, now - 3 * 86400);

  // Inactive (older than 7 days)
  const oldOffline = {
    _: 'user',
    id: 2002,
    status: { _: 'userStatusOffline', wasOnline: now - 10 * 86400 },
  };
  const parsed2 = parseRawUser(oldOffline, threshold, 7);
  assert.ok(parsed2);
  assert.equal(parsed2.isActive, false);
});

test('parseRawUser handles userStatusLastWeek and userStatusLastMonth', () => {
  const threshold = 1700000000;

  const lastWeekUser = {
    _: 'user',
    id: 3001,
    status: { _: 'userStatusLastWeek' },
  };
  assert.equal(parseRawUser(lastWeekUser, threshold, 7)?.isActive, true);
  assert.equal(parseRawUser(lastWeekUser, threshold, 3)?.isActive, false);

  const lastMonthUser = {
    _: 'user',
    id: 3002,
    status: { _: 'userStatusLastMonth' },
  };
  assert.equal(parseRawUser(lastMonthUser, threshold, 30)?.isActive, true);
  assert.equal(parseRawUser(lastMonthUser, threshold, 7)?.isActive, false);
});

test('parseRawUser extracts multi-usernames and Fragment collectible handles', () => {
  const user = {
    _: 'user',
    id: 4001,
    username: 'primary_handle',
    usernames: [
      { _: 'username', username: 'primary_handle', active: true },
      { _: 'username', username: 'collectible_handle', active: true },
      { _: 'username', username: 'another_handle', active: false },
    ],
  };

  const parsed = parseRawUser(user, 1000, 7);
  assert.ok(parsed);
  assert.equal(parsed.username, 'primary_handle');
  assert.deepEqual(parsed.usernames, ['primary_handle', 'collectible_handle', 'another_handle']);
});

test('parseRawUser marks deleted accounts as inactive', () => {
  const user = {
    _: 'user',
    id: 5001,
    deleted: true,
    status: { _: 'userStatusRecently' },
  };

  const parsed = parseRawUser(user, 1000, 7);
  assert.ok(parsed);
  assert.equal(parsed.isDeleted, true);
  assert.equal(parsed.isActive, false);
});
