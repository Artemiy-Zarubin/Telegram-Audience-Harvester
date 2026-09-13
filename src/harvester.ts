import { EventEmitter } from 'node:events';
import { TelegramClient, proxyTransportFromUrl, MemoryStorage, tl } from '@mtcute/node';
import type {
  BotAudienceUser,
  HarvesterEvents,
  HarvestOptions,
  HarvestProgress,
  HarvestReport,
} from './types.js';
import { exportToCsv, exportToJson } from './exporter.js';
import {
  FloodWaitExceededError,
  HarvesterError,
  TelegramAuthError,
} from './errors.js';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new HarvesterError('Harvest operation was aborted'));
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new HarvesterError('Harvest operation was aborted'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Extracts and maps a raw MTProto User TL object to a BotAudienceUser profile.
 */
export function parseRawUser(
  u: unknown,
  activeThresholdTimestamp: number,
  activeDaysThreshold: number
): BotAudienceUser | null {
  if (!u || typeof u !== 'object') {
    return null;
  }

  const raw = u as Record<string, any>;
  if (raw._ !== 'user' || raw.bot) {
    return null;
  }

  const isDeleted = Boolean(raw.deleted);
  const statusType = raw.status?._ || 'userStatusEmpty';
  let isActive = false;
  let lastSeen: number | undefined;

  if (!isDeleted) {
    if (statusType === 'userStatusOnline' || statusType === 'userStatusRecently') {
      isActive = true;
    } else if (statusType === 'userStatusOffline' && typeof raw.status?.wasOnline === 'number') {
      const wasOnline = raw.status.wasOnline;
      lastSeen = wasOnline;
      isActive = wasOnline >= activeThresholdTimestamp;
    } else if (statusType === 'userStatusLastWeek') {
      isActive = activeDaysThreshold >= 7;
    } else if (statusType === 'userStatusLastMonth') {
      isActive = activeDaysThreshold >= 30;
    }
  }

  const usernames: string[] = [];
  if (typeof raw.username === 'string' && raw.username) {
    usernames.push(raw.username);
  }
  if (Array.isArray(raw.usernames)) {
    for (const un of raw.usernames) {
      if (un && typeof un.username === 'string' && !usernames.includes(un.username)) {
        usernames.push(un.username);
      }
    }
  }

  let photoDcId: number | undefined;
  if (raw.photo && typeof raw.photo === 'object' && 'dcId' in raw.photo && typeof raw.photo.dcId === 'number') {
    photoDcId = raw.photo.dcId;
  }

  if (typeof raw.id !== 'number' && typeof raw.id !== 'bigint') {
    return null;
  }
  const id = Number(raw.id);
  if (Number.isNaN(id) || !Number.isFinite(id)) {
    return null;
  }

  return {
    id,
    firstName: typeof raw.firstName === 'string' ? raw.firstName : '',
    lastName: typeof raw.lastName === 'string' ? raw.lastName : '',
    username: usernames[0],
    usernames,
    isPremium: Boolean(raw.premium),
    isDeleted,
    status: statusType,
    lastSeen,
    isActive,
    language: typeof raw.langCode === 'string' ? raw.langCode : undefined,
    photoDcId,
  };
}

/**
 * Binary search to find the lowest non-purged PTS slice when Telegram returns differenceTooLong.
 */
async function resolveDifferenceTooLong(
  client: any,
  lowPts: number,
  highPts: number,
  delayMs: number,
  maxFloodWaitSec: number,
  signal?: AbortSignal
): Promise<number> {
  let low = lowPts;
  let high = highPts;
  let earliestValid = highPts;

  while (low <= high) {
    if (signal?.aborted) {
      throw new HarvesterError('Harvest operation was aborted during PTS resolution');
    }

    const mid = Math.floor((low + high) / 2);

    try {
      const probe = await client.call({
        _: 'updates.getDifference',
        pts: mid,
        date: 1,
        qts: 0,
        ptsTotalLimit: 2147483647,
      });

      if (probe._ !== 'updates.differenceTooLong') {
        earliestValid = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new HarvesterError('Harvest operation was aborted during PTS resolution');
      }

      if (err instanceof tl.RpcError) {
        if (err.text.startsWith('FLOOD_WAIT_')) {
          const waitSec = parseInt(err.text.replace('FLOOD_WAIT_', ''), 10) || 1;
          if (waitSec > maxFloodWaitSec) {
            throw new FloodWaitExceededError(waitSec, maxFloodWaitSec);
          }
          await sleep((waitSec + 1) * 1000, signal);
          continue;
        }
        if (err.text === 'PERSISTENT_TIMESTAMP_INVALID' || err.text === 'PTS_INVALID') {
          low = mid + 1;
          continue;
        }
      }

      // Re-throw critical network or session exceptions rather than swallowing
      throw err;
    }

    if (delayMs > 0) {
      await sleep(delayMs, signal);
    }
  }

  return earliestValid;
}

/**
 * Class-based manager for Telegram bot audience harvesting sessions.
 * Extends EventEmitter to allow real-time telemetry, user batching, and lifecycle control.
 */
export class BotAudienceHarvester extends EventEmitter {
  private readonly options: HarvestOptions;
  private isRunning: boolean = false;
  private abortController?: AbortController;

  constructor(options: HarvestOptions) {
    super();
    this.options = options;
  }

  public override on<E extends keyof HarvesterEvents>(event: E, listener: HarvesterEvents[E]): this;
  public override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  public override once<E extends keyof HarvesterEvents>(event: E, listener: HarvesterEvents[E]): this;
  public override once(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }

  public override off<E extends keyof HarvesterEvents>(event: E, listener: HarvesterEvents[E]): this;
  public override off(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }

  public override emit<E extends keyof HarvesterEvents>(event: E, ...args: Parameters<HarvesterEvents[E]>): boolean;
  public override emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  public isHarvesting(): boolean {
    return this.isRunning;
  }

  public abort(): void {
    if (this.abortController && this.isRunning) {
      this.abortController.abort();
    }
  }

  /**
   * Executes the harvest process and returns the final aggregate report.
   */
  public async start(): Promise<HarvestReport> {
    if (this.isRunning) {
      throw new HarvesterError('Harvest is already in progress');
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    // Link external options.signal with internal abortController so abort() works in all scenarios
    let abortListener: (() => void) | undefined;
    if (this.options.signal) {
      if (this.options.signal.aborted) {
        this.abortController.abort();
      } else {
        abortListener = () => this.abortController?.abort();
        this.options.signal.addEventListener('abort', abortListener, { once: true });
      }
    }
    const signal = this.abortController.signal;

    const {
      apiId,
      apiHash,
      botToken,
      proxyUrl,
      maxIterations = 5000,
      delayMsBetweenRequests = 35,
      maxFloodWaitSec = 300,
      activeDaysThreshold = 7,
      onProgress,
      saveJsonPath,
      saveCsvPath,
      clientFactory,
    } = this.options;

    const startTime = Date.now();
    const activeThresholdTimestamp = Math.floor(Date.now() / 1000) - activeDaysThreshold * 86400;

    const client = clientFactory
      ? clientFactory(this.options)
      : new TelegramClient({
          apiId,
          apiHash,
          storage: new MemoryStorage(),
          transport: proxyUrl ? proxyTransportFromUrl(proxyUrl) : undefined,
          disableUpdates: true,
        });

    try {
      let botUser;
      try {
        botUser = await client.start({ botToken });
      } catch (authErr: any) {
        throw new TelegramAuthError(`Failed to authenticate bot token: ${authErr?.message || authErr}`);
      }

      const state = await client.call({ _: 'updates.getState' });
      const serverPts = state.pts;

      const usersMap = new Map<number, BotAudienceUser>();
      const languagesMap: Record<string, number> = {};
      const statusesMap: Record<string, number> = {};

      let curPts = 1;
      let iteration = 0;
      let hasMore = true;

      const processUsers = (rawUsers: any[] | undefined) => {
        if (!rawUsers || !Array.isArray(rawUsers)) return;
        const batch: BotAudienceUser[] = [];

        for (const raw of rawUsers) {
          const parsed = parseRawUser(raw, activeThresholdTimestamp, activeDaysThreshold);
          if (parsed && !usersMap.has(parsed.id)) {
            usersMap.set(parsed.id, parsed);
            batch.push(parsed);

            const lang = parsed.language || 'unknown';
            languagesMap[lang] = (languagesMap[lang] || 0) + 1;
            statusesMap[parsed.status] = (statusesMap[parsed.status] || 0) + 1;

            this.emit('user', parsed);
          }
        }

        if (batch.length > 0) {
          this.emit('batch', batch);
        }
      };

      while (hasMore && iteration < maxIterations) {
        if (signal.aborted) {
          throw new HarvesterError('Harvest aborted by caller');
        }

        try {
          const diff = await client.call({
            _: 'updates.getDifference',
            pts: curPts,
            date: 1,
            qts: 0,
            ptsTotalLimit: 2147483647,
          });

          iteration++;

          if ('users' in diff && Array.isArray(diff.users)) {
            processUsers(diff.users);
          }

          if (diff._ === 'updates.differenceSlice') {
            const nextPts = diff.intermediateState.pts;
            // Guard against server stalls where PTS does not advance
            if (nextPts <= curPts) {
              curPts = curPts + 1;
            } else {
              curPts = nextPts;
            }
            if (serverPts > 0 && curPts >= serverPts) {
              hasMore = false;
            }
          } else if (diff._ === 'updates.difference') {
            curPts = diff.state.pts;
            hasMore = false;
          } else if (diff._ === 'updates.differenceEmpty') {
            hasMore = false;
          } else if (diff._ === 'updates.differenceTooLong') {
            const resolvedPts = await resolveDifferenceTooLong(
              client,
              curPts + 1,
              serverPts,
              delayMsBetweenRequests,
              maxFloodWaitSec,
              signal
            );
            curPts = resolvedPts;
            if (resolvedPts >= serverPts) {
              hasMore = false;
            }
          } else {
            hasMore = false;
          }

          const pct = serverPts > 0 ? Math.min(100, Math.round((curPts / serverPts) * 100)) : 100;
          const progress: HarvestProgress = {
            iteration,
            currentPts: curPts,
            serverPts,
            percent: pct,
            uniqueUsers: usersMap.size,
          };

          this.emit('progress', progress);
          if (onProgress) {
            onProgress(progress);
          }

          if (hasMore && delayMsBetweenRequests > 0) {
            await sleep(delayMsBetweenRequests, signal);
          }
        } catch (callErr: any) {
          if (callErr instanceof tl.RpcError) {
            if (callErr.text.startsWith('FLOOD_WAIT_')) {
              const waitSec = parseInt(callErr.text.replace('FLOOD_WAIT_', ''), 10) || 1;
              if (waitSec > maxFloodWaitSec) {
                throw new FloodWaitExceededError(waitSec, maxFloodWaitSec);
              }
              this.emit('rateLimit', waitSec);
              await sleep((waitSec + 1) * 1000, signal);
              continue;
            }
            if (callErr.text === 'PERSISTENT_TIMESTAMP_INVALID' || callErr.text === 'PTS_INVALID') {
              const resolvedPts = await resolveDifferenceTooLong(
                client,
                curPts + 1,
                serverPts,
                delayMsBetweenRequests,
                maxFloodWaitSec,
                signal
              );
              curPts = resolvedPts;
              if (resolvedPts >= serverPts) {
                hasMore = false;
              }
              continue;
            }
          }
          throw callErr;
        }
      }

      const allUsers = Array.from(usersMap.values());
      const activeUsers = allUsers.filter((u) => u.isActive).length;
      const inactiveUsers = allUsers.filter((u) => !u.isActive && !u.isDeleted).length;
      const deletedUsers = allUsers.filter((u) => u.isDeleted).length;
      const premiumUsers = allUsers.filter((u) => u.isPremium).length;
      const usersWithUsername = allUsers.filter((u) => Boolean(u.username)).length;
      const durationSec = Math.round((Date.now() - startTime) / 1000);

      const report: HarvestReport = {
        botId: Number(botUser.id),
        botUsername: botUser.username || '',
        botName: botUser.displayName || botUser.firstName || '',
        serverPts,
        scannedPts: curPts,
        iterations: iteration,
        totalUsers: allUsers.length,
        activeUsers,
        inactiveUsers,
        deletedUsers,
        premiumUsers,
        activeRate: allUsers.length ? Math.round((activeUsers / allUsers.length) * 1000) / 10 : 0,
        premiumRate: allUsers.length ? Math.round((premiumUsers / allUsers.length) * 1000) / 10 : 0,
        usersWithUsername,
        languages: languagesMap,
        statuses: statusesMap,
        durationSec,
        users: allUsers,
      };

      if (saveJsonPath) {
        exportToJson(report, saveJsonPath);
      }

      if (saveCsvPath) {
        exportToCsv(allUsers, saveCsvPath);
      }

      this.emit('done', report);
      return report;
    } catch (err: any) {
      this.emit('error', err);
      throw err;
    } finally {
      this.isRunning = false;
      if (this.options.signal && abortListener) {
        this.options.signal.removeEventListener('abort', abortListener);
      }
      try {
        await client.destroy();
      } catch (_) {}
    }
  }
}

/**
 * Functional entry point to harvest Telegram bot audience.
 *
 * @param options - Configuration and authentication options
 * @returns Comprehensive report with array of unique users
 */
export async function harvestBotAudience(options: HarvestOptions): Promise<HarvestReport> {
  const harvester = new BotAudienceHarvester(options);
  return harvester.start();
}
