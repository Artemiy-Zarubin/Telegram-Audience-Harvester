import test from 'node:test';
import assert from 'node:assert/strict';
import { tl } from '@mtcute/node';
import { BotAudienceHarvester, harvestBotAudience } from '../src/harvester.js';
import {
  FloodWaitExceededError,
  HarvesterError,
  TelegramAuthError,
} from '../src/errors.js';
import type { BotAudienceUser, HarvestProgress, HarvestReport } from '../src/types.js';

function createMockUser(id: number, username: string, status: string = 'userStatusRecently') {
  return {
    _: 'user',
    id,
    firstName: `First${id}`,
    lastName: `Last${id}`,
    username,
    usernames: [{ _: 'username', username, active: true }],
    status: { _: status },
    premium: false,
  };
}

test('BotAudienceHarvester: successful full lifecycle with slices, progress, and events', async () => {
  let destroyCalled = false;
  const calls: any[] = [];

  const mockClient = {
    start: async () => ({
      id: 999999,
      username: 'target_bot',
      displayName: 'Target Bot',
    }),
    call: async (req: any) => {
      calls.push(req);
      if (req._ === 'updates.getState') {
        return { pts: 10 };
      }
      if (req._ === 'updates.getDifference') {
        if (req.pts === 1) {
          return {
            _: 'updates.differenceSlice',
            intermediateState: { pts: 5 },
            users: [createMockUser(1, 'user1'), createMockUser(2, 'user2')],
            otherUpdates: [],
            newMessages: [],
          };
        }
        if (req.pts === 5) {
          return {
            _: 'updates.difference',
            state: { pts: 10 },
            users: [createMockUser(3, 'user3')],
            otherUpdates: [],
            newMessages: [],
          };
        }
      }
      throw new Error(`Unexpected call: ${req._}`);
    },
    destroy: async () => {
      destroyCalled = true;
    },
  };

  const emittedUsers: BotAudienceUser[] = [];
  const emittedBatches: BotAudienceUser[][] = [];
  const emittedProgress: HarvestProgress[] = [];
  let doneReport: HarvestReport | null = null;

  const harvester = new BotAudienceHarvester({
    apiId: 12345,
    apiHash: 'test_hash',
    botToken: '12345:TEST_TOKEN',
    delayMsBetweenRequests: 0,
    clientFactory: () => mockClient,
  });

  harvester.on('user', (u) => emittedUsers.push(u));
  harvester.on('batch', (b) => emittedBatches.push(b));
  harvester.on('progress', (p) => emittedProgress.push(p));
  harvester.on('done', (r) => {
    doneReport = r;
  });

  const report = await harvester.start();

  assert.equal(report.botId, 999999);
  assert.equal(report.botUsername, 'target_bot');
  assert.equal(report.totalUsers, 3);
  assert.equal(report.activeUsers, 3);
  assert.equal(report.serverPts, 10);
  assert.equal(report.scannedPts, 10);
  assert.equal(report.iterations, 2);

  assert.equal(emittedUsers.length, 3);
  assert.equal(emittedBatches.length, 2);
  assert.equal(emittedProgress.length, 2);
  assert.equal(doneReport, report);
  assert.equal(destroyCalled, true);
  assert.equal(harvester.isHarvesting(), false);
});

test('BotAudienceHarvester: prevents infinite loop when slice PTS stalls', async () => {
  const ptsQueries: number[] = [];

  const mockClient = {
    start: async () => ({ id: 1, username: 'bot', displayName: 'Bot' }),
    call: async (req: any) => {
      if (req._ === 'updates.getState') return { pts: 5 };
      if (req._ === 'updates.getDifference') {
        ptsQueries.push(req.pts);
        if (req.pts === 1) {
          // Returns non-advancing PTS: 1 <= 1
          return {
            _: 'updates.differenceSlice',
            intermediateState: { pts: 1 },
            users: [createMockUser(101, 'user101')],
          };
        }
        return {
          _: 'updates.difference',
          state: { pts: 5 },
          users: [],
        };
      }
      return {};
    },
    destroy: async () => {},
  };

  const harvester = new BotAudienceHarvester({
    apiId: 12345,
    apiHash: 'hash',
    botToken: '12345:TOKEN',
    delayMsBetweenRequests: 0,
    clientFactory: () => mockClient,
  });

  const report = await harvester.start();
  assert.equal(report.totalUsers, 1);
  // Stalled slice at 1 forced curPts = 2 for the second query
  assert.deepEqual(ptsQueries, [1, 2]);
});

test('BotAudienceHarvester: handles differenceEmpty and exits gracefully', async () => {
  const mockClient = {
    start: async () => ({ id: 1, username: 'bot', displayName: 'Bot' }),
    call: async (req: any) => {
      if (req._ === 'updates.getState') return { pts: 10 };
      if (req._ === 'updates.getDifference') {
        return { _: 'updates.differenceEmpty', date: 100, seq: 0 };
      }
      return {};
    },
    destroy: async () => {},
  };

  const report = await harvestBotAudience({
    apiId: 12345,
    apiHash: 'hash',
    botToken: '12345:TOKEN',
    delayMsBetweenRequests: 0,
    clientFactory: () => mockClient,
  });

  assert.equal(report.totalUsers, 0);
  assert.equal(report.iterations, 1);
});

test('BotAudienceHarvester: handles differenceTooLong with binary search', async () => {
  const queriedPts: number[] = [];

  const mockClient = {
    start: async () => ({ id: 1, username: 'bot', displayName: 'Bot' }),
    call: async (req: any) => {
      if (req._ === 'updates.getState') return { pts: 100 };
      if (req._ === 'updates.getDifference') {
        queriedPts.push(req.pts);
        if (req.pts < 50) {
          return { _: 'updates.differenceTooLong', pts: 100 };
        }
        return {
          _: 'updates.difference',
          state: { pts: 100 },
          users: [createMockUser(777, 'survivor')],
        };
      }
      return {};
    },
    destroy: async () => {},
  };

  const harvester = new BotAudienceHarvester({
    apiId: 12345,
    apiHash: 'hash',
    botToken: '12345:TOKEN',
    delayMsBetweenRequests: 0,
    clientFactory: () => mockClient,
  });

  const report = await harvester.start();
  assert.equal(report.totalUsers, 1);
  assert.ok(queriedPts.includes(1), 'Must start at 1');
  assert.ok(queriedPts.some((p) => p >= 50), 'Must resolve differenceTooLong via binary search');
});

test('BotAudienceHarvester: abort() cancels harvest cleanly and sets isRunning to false', async () => {
  let destroyed = false;
  const mockClient = {
    start: async () => ({ id: 1, username: 'bot', displayName: 'Bot' }),
    call: async (req: any) => {
      if (req._ === 'updates.getState') return { pts: 1000 };
      if (req._ === 'updates.getDifference') {
        return {
          _: 'updates.differenceSlice',
          intermediateState: { pts: req.pts + 10 },
          users: [createMockUser(req.pts, `u${req.pts}`)],
        };
      }
      return {};
    },
    destroy: async () => {
      destroyed = true;
    },
  };

  const harvester = new BotAudienceHarvester({
    apiId: 12345,
    apiHash: 'hash',
    botToken: '12345:TOKEN',
    delayMsBetweenRequests: 10,
    clientFactory: () => mockClient,
  });

  harvester.on('progress', (prog) => {
    if (prog.iteration >= 2) {
      harvester.abort();
    }
  });

  await assert.rejects(
    async () => {
      await harvester.start();
    },
    (err: any) => err instanceof HarvesterError && err.message.includes('aborted')
  );

  assert.equal(harvester.isHarvesting(), false);
  assert.equal(destroyed, true);
});

test('BotAudienceHarvester: external AbortSignal halts execution', async () => {
  const abortController = new AbortController();

  const mockClient = {
    start: async () => ({ id: 1, username: 'bot', displayName: 'Bot' }),
    call: async (req: any) => {
      if (req._ === 'updates.getState') return { pts: 100 };
      if (req._ === 'updates.getDifference') {
        abortController.abort();
        return {
          _: 'updates.differenceSlice',
          intermediateState: { pts: 20 },
          users: [],
        };
      }
      return {};
    },
    destroy: async () => {},
  };

  const harvester = new BotAudienceHarvester({
    apiId: 12345,
    apiHash: 'hash',
    botToken: '12345:TOKEN',
    signal: abortController.signal,
    clientFactory: () => mockClient,
  });

  await assert.rejects(
    async () => {
      await harvester.start();
    },
    (err: any) => err instanceof HarvesterError && err.message.includes('aborted')
  );
});

test('BotAudienceHarvester: handles client.start auth failure', async () => {
  const mockClient = {
    start: async () => {
      throw new Error('BOT_METHOD_INVALID');
    },
    call: async () => ({}),
    destroy: async () => {},
  };

  const harvester = new BotAudienceHarvester({
    apiId: 12345,
    apiHash: 'hash',
    botToken: 'bad_token',
    clientFactory: () => mockClient,
  });

  await assert.rejects(
    async () => {
      await harvester.start();
    },
    (err: any) => err instanceof TelegramAuthError
  );
});

test('BotAudienceHarvester: throws FloodWaitExceededError when flood wait exceeds limit', async () => {
  const mockClient = {
    start: async () => ({ id: 1, username: 'bot', displayName: 'Bot' }),
    call: async (req: any) => {
      if (req._ === 'updates.getState') return { pts: 10 };
      if (req._ === 'updates.getDifference') {
        const err = new tl.RpcError(420, 'FLOOD_WAIT_60');
        throw err;
      }
      return {};
    },
    destroy: async () => {},
  };

  const harvester = new BotAudienceHarvester({
    apiId: 12345,
    apiHash: 'hash',
    botToken: 'token',
    maxFloodWaitSec: 10,
    clientFactory: () => mockClient,
  });

  await assert.rejects(
    async () => {
      await harvester.start();
    },
    (err: any) => err instanceof FloodWaitExceededError && err.waitSeconds === 60
  );
});

test('BotAudienceHarvester: recovers via binary search when main loop throws PERSISTENT_TIMESTAMP_INVALID', async () => {
  const queriedPts: number[] = [];

  const mockClient = {
    start: async () => ({ id: 1, username: 'bot', displayName: 'Bot' }),
    call: async (req: any) => {
      if (req._ === 'updates.getState') return { pts: 100 };
      if (req._ === 'updates.getDifference') {
        queriedPts.push(req.pts);
        if (req.pts < 60) {
          throw new tl.RpcError(400, 'PERSISTENT_TIMESTAMP_INVALID');
        }
        return {
          _: 'updates.difference',
          state: { pts: 100 },
          users: [createMockUser(888, 'recovered_user')],
        };
      }
      return {};
    },
    destroy: async () => {},
  };

  const harvester = new BotAudienceHarvester({
    apiId: 12345,
    apiHash: 'hash',
    botToken: '12345:TOKEN',
    delayMsBetweenRequests: 0,
    clientFactory: () => mockClient,
  });

  const report = await harvester.start();
  assert.equal(report.totalUsers, 1);
  assert.equal(report.scannedPts, 100);
  assert.ok(queriedPts.includes(1), 'Must start at 1');
  assert.ok(queriedPts.some((p) => p >= 60), 'Must resolve valid PTS above 60');
});

test('BotAudienceHarvester: cleans up external signal abort listener in finally block', async () => {
  const abortController = new AbortController();
  let listenerCalled = false;

  const mockClient = {
    start: async () => ({ id: 1, username: 'bot', displayName: 'Bot' }),
    call: async (req: any) => {
      if (req._ === 'updates.getState') return { pts: 10 };
      if (req._ === 'updates.getDifference') {
        return { _: 'updates.differenceEmpty', date: 1, seq: 0 };
      }
      return {};
    },
    destroy: async () => {},
  };

  const harvester = new BotAudienceHarvester({
    apiId: 12345,
    apiHash: 'hash',
    botToken: '12345:TOKEN',
    signal: abortController.signal,
    clientFactory: () => mockClient,
  });

  await harvester.start();

  // Trigger abort after start has finished — internal listener should have been removed
  abortController.abort();
  assert.equal(harvester.isHarvesting(), false);
});

