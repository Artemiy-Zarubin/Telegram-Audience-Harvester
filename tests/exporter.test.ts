import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { sanitizeCsvCell, exportToCsv, exportToJson } from '../src/exporter.js';
import type { BotAudienceUser, HarvestReport } from '../src/types.js';

test('sanitizeCsvCell escapes formula characters', () => {
  assert.equal(sanitizeCsvCell('=cmd|"/c calc"!A0'), '\'=cmd|""/c calc""!A0');
  assert.equal(sanitizeCsvCell('+12345'), '\'+12345');
  assert.equal(sanitizeCsvCell('-500'), '\'-500');
  assert.equal(sanitizeCsvCell('@username'), '\'@username');
  assert.equal(sanitizeCsvCell('\tmalicious'), '\'\tmalicious');
  assert.equal(sanitizeCsvCell('   =sum(A1:B2)'), '\'   =sum(A1:B2)');
  assert.equal(sanitizeCsvCell('|cmd'), '\'|cmd');
  assert.equal(sanitizeCsvCell('  \tpayload'), '\'  \tpayload');
  assert.equal(sanitizeCsvCell('  \rpayload'), '\'  \rpayload');
  assert.equal(sanitizeCsvCell('  |dde'), '\'  |dde');
});

test('sanitizeCsvCell handles normal text, null and undefined', () => {
  assert.equal(sanitizeCsvCell('John'), 'John');
  assert.equal(sanitizeCsvCell(''), '');
  assert.equal(sanitizeCsvCell(undefined), '');
  assert.equal(sanitizeCsvCell(null), '');
  assert.equal(sanitizeCsvCell(12345), '12345');
  assert.equal(sanitizeCsvCell(true), 'true');
});

test('sanitizeCsvCell escapes embedded double quotes', () => {
  assert.equal(sanitizeCsvCell('Hello "World"'), 'Hello ""World""');
  assert.equal(sanitizeCsvCell('="malicious"'), '\'=""malicious""');
});

test('exportToCsv writes valid CSV with UTF-8 BOM', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvester-test-'));
  const filePath = path.join(tmpDir, 'sub', 'users.csv');

  const users: BotAudienceUser[] = [
    {
      id: 1001,
      firstName: 'Alice',
      lastName: 'Smith',
      username: 'alicesmith',
      usernames: ['alicesmith'],
      isPremium: true,
      isDeleted: false,
      status: 'userStatusRecently',
      isActive: true,
      language: 'en',
      photoDcId: 2,
    },
    {
      id: 1002,
      firstName: '=Danger',
      lastName: 'User "Pro"',
      username: 'danger_user',
      usernames: ['danger_user', 'danger_nft'],
      isPremium: false,
      isDeleted: false,
      status: 'userStatusOffline',
      lastSeen: 1700000000,
      isActive: false,
      language: 'ru',
    },
  ];

  exportToCsv(users, filePath);

  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.startsWith('\uFEFF'), 'File must start with UTF-8 BOM');
  assert.ok(content.includes('\r\n'), 'Records must be delimited by CRLF per RFC 4180');

  const lines = content.slice(1).trim().split('\r\n');
  assert.equal(lines.length, 3, 'Header + 2 rows');

  // Verify formula character escaped in row 2
  assert.ok(lines[2].includes('\'=Danger'), 'Formula character must be escaped with single quote');
  assert.ok(lines[2].includes('User ""Pro""'), 'Embedded quotes must be doubled');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('exportToJson writes valid JSON report', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvester-test-'));
  const filePath = path.join(tmpDir, 'sub', 'report.json');

  const report: HarvestReport = {
    botId: 123456,
    botUsername: 'sample_bot',
    botName: 'Sample Bot',
    serverPts: 1000,
    scannedPts: 1000,
    iterations: 10,
    totalUsers: 1,
    activeUsers: 1,
    inactiveUsers: 0,
    deletedUsers: 0,
    premiumUsers: 0,
    activeRate: 100,
    premiumRate: 0,
    usersWithUsername: 1,
    languages: { en: 1 },
    statuses: { userStatusRecently: 1 },
    durationSec: 5,
    users: [],
  };

  exportToJson(report, filePath);

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(parsed.botId, 123456);
  assert.equal(parsed.botUsername, 'sample_bot');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
