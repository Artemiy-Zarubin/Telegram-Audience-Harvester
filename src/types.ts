/**
 * User profile extracted from Telegram bot update history.
 */
export interface BotAudienceUser {
  /** 64-bit Telegram user identifier */
  id: number;
  /** User first name */
  firstName: string;
  /** User last name */
  lastName: string;
  /** Primary username without leading @ symbol */
  username?: string;
  /** All usernames associated with the account, including collectible handles */
  usernames: string[];
  /** Telegram Premium subscription flag */
  isPremium: boolean;
  /** Whether the Telegram account has been deleted */
  isDeleted: boolean;
  /** MTProto status type identifier (e.g. userStatusRecently, userStatusOffline) */
  status: string;
  /** Unix timestamp of last seen online date if available */
  lastSeen?: number;
  /** Calculated activity flag based on recent activity thresholds */
  isActive: boolean;
  /** IETF language code reported by Telegram (e.g. 'ru', 'en') */
  language?: string;
  /** Datacenter ID storing the profile photo if present */
  photoDcId?: number;
}

/**
 * Progress telemetry payload emitted during PTS synchronization.
 */
export interface HarvestProgress {
  /** Current iteration index */
  iteration: number;
  /** Current PTS cursor reached in server history */
  currentPts: number;
  /** Initial or latest known server PTS boundary */
  serverPts: number;
  /** Completion percentage from 0 to 100 */
  percent: number;
  /** Count of unique users discovered so far */
  uniqueUsers: number;
}

/**
 * Configuration options for the bot audience harvester.
 */
export interface HarvestOptions {
  /** Telegram API ID from my.telegram.org */
  apiId: number;
  /** Telegram API Hash from my.telegram.org */
  apiHash: string;
  /** Telegram Bot token from @BotFather */
  botToken: string;
  /**
   * Optional proxy URL. Supported protocols:
   * socks5://, socks4://, http://, https://, mtproxy
   */
  proxyUrl?: string;
  /**
   * Maximum PTS iterations before stopping (default: 5000)
   */
  maxIterations?: number;
  /**
   * Delay in milliseconds between consecutive getDifference RPC calls (default: 35)
   */
  delayMsBetweenRequests?: number;
  /**
   * Maximum acceptable FloodWait in seconds before aborting (default: 300)
   */
  maxFloodWaitSec?: number;
  /**
   * Inactivity threshold in days for classifying offline users as active (default: 7)
   */
  activeDaysThreshold?: number;
  /**
   * Optional AbortSignal to cancel harvesting externally
   */
  signal?: AbortSignal;
  /**
   * Progress callback invoked when PTS cursor advances
   */
  onProgress?: (progress: HarvestProgress) => void;
  /**
   * Optional destination file path for JSON export
   */
  saveJsonPath?: string;
  /**
   * Optional destination file path for RFC 4180 CSV export
   */
  saveCsvPath?: string;
  /**
   * Optional custom client factory for dependency injection and testing
   */
  clientFactory?: (options: HarvestOptions) => TelegramClientLike;
}

/**
 * Structural interface for MTProto client dependency injection.
 */
export interface TelegramClientLike {
  start: (params: { botToken: string }) => Promise<any>;
  call: (req: any) => Promise<any>;
  destroy: () => Promise<void>;
}

/**
 * Summary metrics and complete user list produced by the harvester.
 */
export interface HarvestReport {
  /** Telegram bot user identifier */
  botId: number;
  /** Bot username without leading @ symbol */
  botUsername: string;
  /** Bot display name */
  botName: string;
  /** Target server PTS at initialization */
  serverPts: number;
  /** Final scanned PTS cursor reached */
  scannedPts: number;
  /** Total RPC iterations executed */
  iterations: number;
  /** Total unique users discovered */
  totalUsers: number;
  /** Count of active users */
  activeUsers: number;
  /** Count of inactive users */
  inactiveUsers: number;
  /** Count of deleted accounts */
  deletedUsers: number;
  /** Count of Telegram Premium subscribers */
  premiumUsers: number;
  /** Percentage of active users (0.0 - 100.0) */
  activeRate: number;
  /** Percentage of Telegram Premium users (0.0 - 100.0) */
  premiumRate: number;
  /** Count of users with at least one public username */
  usersWithUsername: number;
  /** Breakdown of users by reported language */
  languages: Record<string, number>;
  /** Breakdown of users by MTProto status type */
  statuses: Record<string, number>;
  /** Execution elapsed time in seconds */
  durationSec: number;
  /** Full list of collected user profiles */
  users: BotAudienceUser[];
}

/**
 * Event signatures emitted by BotAudienceHarvester during operation.
 */
export interface HarvesterEvents {
  user: (user: BotAudienceUser) => void;
  batch: (batch: BotAudienceUser[]) => void;
  progress: (progress: HarvestProgress) => void;
  rateLimit: (seconds: number) => void;
  done: (report: HarvestReport) => void;
  error: (error: Error) => void;
}

