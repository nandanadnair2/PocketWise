import type { AlertKind, Category, LimitPeriod, Prisma } from "@prisma/client";

// India has no DST, so a fixed +05:30 offset is safe for period boundaries.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Start of the current DAILY / WEEKLY (Monday) / MONTHLY window, in IST, returned as a UTC Date. */
export function periodStart(period: LimitPeriod, now: Date): Date {
  const local = new Date(now.getTime() + IST_OFFSET_MS); // UTC getters now read IST wall-clock
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  let d = local.getUTCDate();

  if (period === "WEEKLY") {
    const daysSinceMonday = (local.getUTCDay() + 6) % 7;
    d -= daysSinceMonday;
  } else if (period === "MONTHLY") {
    d = 1;
  }
  return new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
}

export interface LimitRow {
  id: string;
  period: LimitPeriod;
  category: Category | null; // null = applies to all spending
  amount: number; // paise
}

export interface PendingAlert {
  kind: AlertKind;
  message: string;
}

export interface Evaluation {
  allowed: boolean;
  blockedBy?: {
    limitId: string;
    period: LimitPeriod;
    category: Category | null;
    remaining: number; // paise left in that window
  };
  alerts: PendingAlert[];
}

const THRESHOLDS: { ratio: number; kind: AlertKind; label: string }[] = [
  { ratio: 0.5, kind: "LIMIT_50", label: "50%" },
  { ratio: 0.8, kind: "LIMIT_80", label: "80%" },
  { ratio: 0.95, kind: "LIMIT_95", label: "95%" },
];

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
const describe = (l: LimitRow) =>
  `${l.period.toLowerCase()}${l.category ? ` ${l.category.toLowerCase()}` : ""} limit`;

/**
 * Pure decision function (no DB), so it is easy to unit test.
 * - Hard stop: a purchase that would push spending OVER a limit is blocked.
 * - Alerts fire once, when a purchase crosses 50% / 80% / 95%, or lands exactly on 100%.
 */
export function evaluateLimits(
  limits: LimitRow[],
  spentByLimitId: Record<string, number>,
  category: Category,
  amount: number
): Evaluation {
  const alerts: PendingAlert[] = [];

  for (const limit of limits) {
    if (limit.category !== null && limit.category !== category) continue;

    const spent = spentByLimitId[limit.id] ?? 0;
    const after = spent + amount;

    if (after > limit.amount) {
      const remaining = Math.max(limit.amount - spent, 0);
      return {
        allowed: false,
        blockedBy: { limitId: limit.id, period: limit.period, category: limit.category, remaining },
        alerts: [
          {
            kind: "LIMIT_HIT",
            message: `Blocked: this would go over the ${describe(limit)} (${rupees(remaining)} left of ${rupees(limit.amount)}).`,
          },
        ],
      };
    }

    for (const t of THRESHOLDS) {
      const line = limit.amount * t.ratio;
      if (spent < line && after >= line) {
        alerts.push({
          kind: t.kind,
          message: `${t.label} of the ${describe(limit)} used (${rupees(after)} of ${rupees(limit.amount)}).`,
        });
      }
    }

    if (after === limit.amount) {
      alerts.push({
        kind: "LIMIT_HIT",
        message: `The ${describe(limit)} is fully used (${rupees(limit.amount)}).`,
      });
    }
  }

  return { allowed: true, alerts };
}

/** Pure in-memory bucketing: sum purchase rows into each limit's current window.
 *  Exported separately from loadSpent so window boundaries and category filters
 *  can be unit-tested without a database. */
export interface SpentRow {
  amount: number;
  category: Category;
  createdAt: Date;
}

export function bucketSpent(
  rows: SpentRow[],
  limits: LimitRow[],
  now: Date = new Date()
): Record<string, number> {
  const spent: Record<string, number> = {};
  const starts = new Map(limits.map((l) => [l.id, periodStart(l.period, now)]));
  for (const limit of limits) {
    const start = starts.get(limit.id)!;
    spent[limit.id] = rows.reduce((sum, r) => {
      if (r.createdAt < start) return sum;
      if (limit.category && r.category !== limit.category) return sum;
      return sum + r.amount;
    }, 0);
  }
  return spent;
}

/** Sum of approved purchases inside each limit's current window (and category, if the limit has one).
 *  One round trip: fetch purchases at/after the earliest window start, bucket per limit in memory. */
export async function loadSpent(
  tx: Prisma.TransactionClient,
  walletId: string,
  limits: LimitRow[],
  now: Date = new Date()
): Promise<Record<string, number>> {
  if (limits.length === 0) return {};

  const earliest = new Date(
    Math.min(...limits.map((l) => periodStart(l.period, now).getTime()))
  );

  const rows = await tx.transaction.findMany({
    where: {
      walletId,
      type: "PURCHASE",
      status: "APPROVED",
      createdAt: { gte: earliest },
    },
    select: { amount: true, category: true, createdAt: true },
  });

  return bucketSpent(rows, limits, now);
}

/**
 * Call this INSIDE the same prisma.$transaction that already holds the
 * `SELECT ... FOR UPDATE` lock on the wallet row. Because the lock serialises
 * spenders, the sums below cannot change underneath you.
 */
export async function checkLimits(
  tx: Prisma.TransactionClient,
  walletId: string,
  category: Category,
  amount: number,
  now: Date = new Date()
): Promise<Evaluation> {
  const limits = await tx.limit.findMany({ where: { walletId } });
  if (limits.length === 0) return { allowed: true, alerts: [] };
  const spent = await loadSpent(tx, walletId, limits, now);
  return evaluateLimits(limits, spent, category, amount);
}
