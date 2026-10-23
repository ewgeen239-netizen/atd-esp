export class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Raised by the outbound throttle or when an upstream answers 429. */
export class RateLimitError extends AppError {
  constructor(message, retryAfterSec = 60) {
    super(429, 'RATE_LIMITED', message, { retryAfter: retryAfterSec });
    this.retryAfter = retryAfterSec;
  }
}

/** Upstream refused us (403, captcha, anti-bot page, robots.txt). Never retried automatically. */
export class UpstreamBlockedError extends AppError {
  constructor(message) {
    super(502, 'UPSTREAM_BLOCKED', message);
  }
}

export class UpstreamError extends AppError {
  constructor(message) {
    super(502, 'UPSTREAM_ERROR', message);
  }
}
