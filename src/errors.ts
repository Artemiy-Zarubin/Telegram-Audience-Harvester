export class HarvesterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarvesterError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TelegramAuthError extends HarvesterError {
  constructor(message: string = 'Authentication failed. Invalid bot token, API ID, or API hash.') {
    super(message);
    this.name = 'TelegramAuthError';
  }
}

export class FloodWaitExceededError extends HarvesterError {
  public readonly waitSeconds: number;

  constructor(waitSeconds: number, maxWaitSeconds: number) {
    super(`Telegram FloodWait of ${waitSeconds}s exceeded maximum tolerated threshold of ${maxWaitSeconds}s.`);
    this.name = 'FloodWaitExceededError';
    this.waitSeconds = waitSeconds;
  }
}

export class PtsOutOfSyncError extends HarvesterError {
  public readonly pts: number;

  constructor(pts: number, message: string = `PTS out of sync at ${pts}`) {
    super(message);
    this.name = 'PtsOutOfSyncError';
    this.pts = pts;
  }
}
