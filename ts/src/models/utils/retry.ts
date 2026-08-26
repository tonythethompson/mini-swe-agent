/** Retry utility for model queries.
 * Ported from src/minisweagent/models/utils/retry.py */
import { logger } from "../../utils/log.js";

export interface RetryOptions {
  logger?: typeof logger;
  abortExceptions: (new (...args: unknown[]) => Error)[];
}

/** Retry an async function with exponential backoff.
 * Aborts immediately on abortExceptions. */
export async function retryWithBackoff<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const log = opts.logger ?? logger;
  const maxAttempts = parseInt(process.env.MSWEA_MODEL_RETRY_STOP_AFTER_ATTEMPT ?? "10", 10);
  let wait = 4;
  const maxWait = 60;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (opts.abortExceptions.some((Exc) => e instanceof Exc)) throw e;
      if (attempt >= maxAttempts) break;
      log.warning(`Attempt ${attempt} failed, retrying in ${wait}s:`, e);
      await new Promise((r) => setTimeout(r, wait * 1000));
      wait = Math.min(wait * 2, maxWait);
    }
  }
  throw lastError;
}
