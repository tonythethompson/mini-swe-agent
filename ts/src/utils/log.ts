/** Simple logger. Ported from src/minisweagent/utils/log.py */
export const logger = {
  debug: (...args: unknown[]) => {
    if (process.env.MSWEA_LOG_LEVEL === "debug") console.error("[DEBUG]", ...args);
  },
  info: (...args: unknown[]) => console.error("[INFO]", ...args),
  warning: (...args: unknown[]) => console.error("[WARN]", ...args),
  error: (...args: unknown[]) => console.error("[ERROR]", ...args),
  critical: (...args: unknown[]) => console.error("[CRITICAL]", ...args),
};
