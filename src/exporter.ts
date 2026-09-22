import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BotAudienceUser, HarvestReport } from './types.js';

/**
 * Characters that trigger spreadsheet formula evaluation.
 * Prepended with a single quote to prevent spreadsheet formula execution.
 */
const FORMULA_TRIGGER_REGEX = /^[=+\-@\t\r|]|^\s+[=+\-@\t\r|]/;

/**
 * Escapes cell values for RFC 4180 CSV output.
 */
export function sanitizeCsvCell(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) {
    return '';
  }
  const str = String(value);
  const safeStr = FORMULA_TRIGGER_REGEX.test(str) ? `'${str}` : str;
  return safeStr.replace(/"/g, '""');
}

/**
 * Ensures parent directory exists for the target file path.
 */
function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(path.resolve(filePath));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function formatCsvRow(u: BotAudienceUser): string {
  const lastSeenStr = u.lastSeen ? new Date(u.lastSeen * 1000).toISOString() : '';
  const allUsernames = u.usernames.join(';');
  return [
    `"${u.id}"`,
    `"${sanitizeCsvCell(u.firstName)}"`,
    `"${sanitizeCsvCell(u.lastName)}"`,
    `"${sanitizeCsvCell(u.username)}"`,
    `"${sanitizeCsvCell(allUsernames)}"`,
    `"${u.isPremium}"`,
    `"${u.isDeleted}"`,
    `"${sanitizeCsvCell(u.status)}"`,
    `"${u.isActive}"`,
    `"${lastSeenStr}"`,
    `"${sanitizeCsvCell(u.language)}"`,
    `"${u.photoDcId ?? ''}"`,
  ].join(',');
}

function isTempFileFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return ['ENOSPC', 'EDQUOT', 'EACCES', 'EPERM'].includes(String(error.code));
}

function publishCsv(tempPath: string, filePath: string): void {
  if (!fs.lstatSync(filePath, { throwIfNoEntry: false })) {
    fs.renameSync(tempPath, filePath);
    return;
  }

  const source = fs.openSync(tempPath, 'r');
  try {
    const destination = fs.openSync(filePath, 'w');
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let bytesRead: number;
      while ((bytesRead = fs.readSync(source, buffer, 0, buffer.length, null)) > 0) {
        for (let offset = 0; offset < bytesRead;) {
          const written = fs.writeSync(destination, buffer, offset, bytesRead - offset);
          if (written === 0) throw new Error('CSV publish made no progress');
          offset += written;
        }
      }
    } finally {
      fs.closeSync(destination);
    }
  } finally {
    fs.closeSync(source);
  }
}

/**
 * Exports bot audience list to an RFC 4180 CSV file with UTF-8 BOM encoding.
 *
 * @param users - Array of collected user profiles
 * @param filePath - Destination file path
 */
export function exportToCsv(users: BotAudienceUser[], filePath: string): void {
  ensureDirectoryExists(filePath);

  const header = [
    'User ID',
    'First Name',
    'Last Name',
    'Username',
    'All Usernames',
    'Is Premium',
    'Is Deleted',
    'Status',
    'Is Active',
    'Last Seen Date',
    'Language',
    'Photo DC',
  ].join(',');

  const tempPath = path.join(path.dirname(path.resolve(filePath)), `.csv-${randomUUID()}.tmp`);
  let created = false;
  try {
    const fd = fs.openSync(tempPath, 'wx');
    created = true;
    try {
      const chunkLimit = 64 * 1024;
      let parts = ['\uFEFF', header, '\r\n'];
      let chunkLength = 1 + header.length + 2;

      const flush = (): void => {
        const bytes = Buffer.from(parts.join(''), 'utf8');
        for (let offset = 0; offset < bytes.length;) {
          const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
          if (written === 0) throw new Error('CSV write made no progress');
          offset += written;
        }
        parts = [];
        chunkLength = 0;
      };

      for (const u of users) {
        const row = formatCsvRow(u) + '\r\n';
        parts.push(row);
        chunkLength += row.length;
        if (chunkLength >= chunkLimit) flush();
      }
      if (users.length === 0) parts.push('\r\n');
      if (parts.length > 0) flush();
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if (created) fs.rmSync(tempPath, { force: true });
    if (isTempFileFailure(error) && fs.lstatSync(filePath, { throwIfNoEntry: false })) {
      const rows = users.map(formatCsvRow);
      fs.writeFileSync(filePath, '\uFEFF' + header + '\r\n' + rows.join('\r\n') + '\r\n', 'utf8');
      return;
    }
    throw error;
  }

  try {
    publishCsv(tempPath, filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

/**
 * Exports complete harvest report to formatted JSON.
 *
 * @param report - Complete harvest report
 * @param filePath - Destination file path
 */
export function exportToJson(report: HarvestReport, filePath: string): void {
  ensureDirectoryExists(filePath);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');
}
