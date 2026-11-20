// Shared interactive-transaction settings for every money-moving route.
// Production defaults are tight so a stuck transaction can't hold a wallet
// row lock for long; tests override via env (vitest.config.ts sets 30s/60s).
export const txOptions = {
  maxWait: Number(process.env.TX_MAX_WAIT_MS ?? 5000),
  timeout: Number(process.env.TX_TIMEOUT_MS ?? 15000),
} as const;
