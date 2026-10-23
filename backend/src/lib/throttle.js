import { RateLimitError, UpstreamBlockedError } from './errors.js';

/**
 * Serializes outbound requests: at most one request every `minIntervalMs`,
 * a bounded queue, a daily cap and a cooldown ("circuit breaker") after the
 * upstream blocks or rate-limits us. One instance is shared by all providers
 * that hit the same site, so switching provider never multiplies the load.
 */
export class Throttle {
  constructor({ minIntervalMs, dailyLimit, maxQueue, cooldownMinutes, now = () => Date.now() }) {
    this.minIntervalMs = minIntervalMs;
    this.dailyLimit = dailyLimit;
    this.maxQueue = maxQueue;
    this.cooldownMs = cooldownMinutes * 60_000;
    this.now = now;
    this.chain = Promise.resolve();
    this.queued = 0;
    this.lastStart = 0;
    this.day = '';
    this.usedToday = 0;
    this.blockedUntil = 0;
    this.blockReason = '';
  }

  status() {
    this.#rollDay();
    return {
      usedToday: this.usedToday,
      dailyLimit: this.dailyLimit,
      queued: this.queued,
      cooldownUntil: this.blockedUntil > this.now() ? new Date(this.blockedUntil).toISOString() : null,
      cooldownReason: this.blockedUntil > this.now() ? this.blockReason : null,
    };
  }

  /** Pause all outbound traffic, e.g. after a 403/429 or a captcha page. */
  trip(reason, ms = this.cooldownMs) {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + ms);
    this.blockReason = reason;
  }

  #rollDay() {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.usedToday = 0;
    }
  }

  #checkOpen() {
    const left = this.blockedUntil - this.now();
    if (left > 0) {
      throw new UpstreamBlockedError(
        `Внешний поиск на паузе ещё ${Math.ceil(left / 60_000)} мин (${this.blockReason})`,
      );
    }
    this.#rollDay();
    if (this.usedToday >= this.dailyLimit) {
      throw new RateLimitError(`Достигнут дневной лимит внешних запросов (${this.dailyLimit})`, 3600);
    }
  }

  /** Run `fn` when the throttle allows it. Rejects immediately when the queue is full. */
  schedule(fn) {
    this.#checkOpen();
    if (this.queued >= this.maxQueue) {
      const retry = Math.ceil((this.queued * this.minIntervalMs) / 1000) || 1;
      throw new RateLimitError('Слишком много внешних запросов в очереди, повторите позже', retry);
    }
    this.queued++;
    const run = this.chain.then(async () => {
      try {
        this.#checkOpen();
        const wait = this.lastStart + this.minIntervalMs - this.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        this.#checkOpen();
        this.lastStart = this.now();
        this.usedToday++;
        return await fn();
      } finally {
        this.queued--;
      }
    });
    // Keep the chain alive regardless of individual failures.
    this.chain = run.catch(() => {});
    return run;
  }
}
