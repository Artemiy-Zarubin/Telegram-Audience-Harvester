import * as fs from 'node:fs';
import * as path from 'node:path';
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

  const rows: string[] = new Array(users.length);

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const lastSeenStr = u.lastSeen ? new Date(u.lastSeen * 1000).toISOString() : '';
    const allUsernames = u.usernames.join(';');

    rows[i] = [
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

  // Prepend UTF-8 BOM for Microsoft Excel compatibility and use CRLF delimiters per RFC 4180
  const content = '\uFEFF' + header + '\r\n' + rows.join('\r\n') + '\r\n';
  fs.writeFileSync(filePath, content, 'utf8');
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
