import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRequire, syncBuiltinESMExports } from 'node:module';
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

test('exportToCsv preserves the previous output byte for byte across chunk boundaries', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvester-csv-equivalence-'));
  const filePath = path.join(tmpDir, 'users.csv');
  const header = 'User ID,First Name,Last Name,Username,All Usernames,Is Premium,Is Deleted,Status,Is Active,Last Seen Date,Language,Photo DC';
  fs.writeFileSync(filePath, 'pre-existing file');
  const baseUser: BotAudienceUser = {
    id: 1,
    firstName: 'Имя 😀',
    lastName: '"Quoted",\r\nnext line',
    username: '=SUM(A1:A2)',
    usernames: ['user', '+formula'],
    isPremium: true,
    isDeleted: false,
    status: 'userStatusRecently',
    isActive: true,
    lastSeen: 1700000000,
    language: '日本語',
    photoDcId: 3,
  };
  const largeUsers = Array.from({ length: 750 }, (_, i): BotAudienceUser => ({
    ...baseUser,
    id: i + 1,
  }));
  largeUsers.push({ ...baseUser, id: 751, firstName: 'Ж'.repeat(70000) });

  const legacyBytes = (users: BotAudienceUser[]): Buffer => {
    const rows = users.map((u) => [
      `"${u.id}"`,
      `"${sanitizeCsvCell(u.firstName)}"`,
      `"${sanitizeCsvCell(u.lastName)}"`,
      `"${sanitizeCsvCell(u.username)}"`,
      `"${sanitizeCsvCell(u.usernames.join(';'))}"`,
      `"${u.isPremium}"`,
      `"${u.isDeleted}"`,
      `"${sanitizeCsvCell(u.status)}"`,
      `"${u.isActive}"`,
      `"${u.lastSeen ? new Date(u.lastSeen * 1000).toISOString() : ''}"`,
      `"${sanitizeCsvCell(u.language)}"`,
      `"${u.photoDcId ?? ''}"`,
    ].join(','));
    return Buffer.from('\uFEFF' + header + '\r\n' + rows.join('\r\n') + '\r\n', 'utf8');
  };

  try {
    for (const users of [[], [baseUser], largeUsers]) {
      exportToCsv(users, filePath);
      assert.deepEqual(fs.readFileSync(filePath), legacyBytes(users));
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('exportToCsv supports a valid filename near the component length limit', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvester-csv-name-'));
  const filePath = path.join(tmpDir, `${'x'.repeat(236)}.csv`);
  try {
    exportToCsv([], filePath);
    assert.ok(fs.readFileSync(filePath).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
    assert.deepEqual(fs.readdirSync(tmpDir), [path.basename(filePath)]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('exportToCsv preserves an existing hardlink target', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvester-csv-hardlink-'));
  const filePath = path.join(tmpDir, 'users.csv');
  const linkedPath = path.join(tmpDir, 'linked.csv');
  try {
    fs.writeFileSync(filePath, 'old content');
    fs.linkSync(filePath, linkedPath);
    exportToCsv([], filePath);
    assert.deepEqual(fs.readFileSync(linkedPath), fs.readFileSync(filePath));
    assert.equal(fs.statSync(filePath).ino, fs.statSync(linkedPath).ino);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('exportToCsv preserves an existing symbolic link target', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvester-csv-symlink-'));
  const targetPath = path.join(tmpDir, 'target.csv');
  const filePath = path.join(tmpDir, 'users.csv');
  try {
    fs.writeFileSync(targetPath, 'old content');
    try {
      fs.symlinkSync(targetPath, filePath, 'file');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error &&
        ['EPERM', 'EACCES', 'ENOTSUP'].includes(String(error.code))) {
        t.skip('Symbolic links are unavailable on this host');
        return;
      }
      throw error;
    }
    exportToCsv([], filePath);
    assert.ok(fs.lstatSync(filePath).isSymbolicLink());
    assert.deepEqual(fs.readFileSync(targetPath), fs.readFileSync(filePath));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('exportToCsv falls back to the legacy writer when temp creation or writing fails', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvester-csv-fallback-'));
  const filePath = path.join(tmpDir, 'users.csv');
  const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
  const originalOpenSync = mutableFs.openSync;
  const originalWriteSync = mutableFs.writeSync;
  const user: BotAudienceUser = {
    id: 1,
    firstName: 'Имя "quoted"',
    lastName: '',
    usernames: [],
    isPremium: false,
    isDeleted: false,
    status: 'userStatusRecently',
    isActive: true,
  };

  try {
    fs.writeFileSync(filePath, 'old content');
    mutableFs.openSync = ((...args: unknown[]) => {
      if (String(args[0]).endsWith('.tmp')) {
        throw Object.assign(new Error('Synthetic temp create failure'), { code: 'EACCES' });
      }
      return Reflect.apply(originalOpenSync, mutableFs, args);
    }) as typeof fs.openSync;
    syncBuiltinESMExports();
    exportToCsv([user], filePath);
    const expected = fs.readFileSync(filePath);

    mutableFs.openSync = originalOpenSync;
    let tempFd = -1;
    mutableFs.openSync = ((...args: unknown[]) => {
      const fd = Reflect.apply(originalOpenSync, mutableFs, args) as number;
      if (String(args[0]).endsWith('.tmp')) tempFd = fd;
      return fd;
    }) as typeof fs.openSync;
    mutableFs.writeSync = ((...args: unknown[]) => {
      if (args[0] === tempFd) {
        tempFd = -1;
        throw Object.assign(new Error('Synthetic temp write failure'), { code: 'ENOSPC' });
      }
      return Reflect.apply(originalWriteSync, mutableFs, args);
    }) as typeof fs.writeSync;
    syncBuiltinESMExports();
    exportToCsv([user], filePath);
    assert.deepEqual(fs.readFileSync(filePath), expected);
    assert.deepEqual(fs.readdirSync(tmpDir), ['users.csv']);
  } finally {
    mutableFs.openSync = originalOpenSync;
    mutableFs.writeSync = originalWriteSync;
    syncBuiltinESMExports();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('exportToCsv leaves destination unchanged when a late row cannot be serialized', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvester-csv-error-'));
  const filePath = path.join(tmpDir, 'users.csv');
  const original = Buffer.from('existing contents\r\n', 'utf8');
  fs.writeFileSync(filePath, original);
  const validUser: BotAudienceUser = {
    id: 1,
    firstName: 'Ж'.repeat(70000),
    lastName: '',
    usernames: [],
    isPremium: false,
    isDeleted: false,
    status: 'userStatusRecently',
    isActive: true,
  };

  try {
    assert.throws(() => exportToCsv([validUser, { ...validUser, id: 2, lastSeen: Infinity }], filePath), RangeError);
    assert.deepEqual(fs.readFileSync(filePath), original);
    assert.deepEqual(fs.readdirSync(tmpDir), ['users.csv']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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
