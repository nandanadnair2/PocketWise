// Explainable, rule-based scoring for unusual purchases.
// Pure functions only (no database, no network), so the rules are easy to test and tune.
// Every rule adds a fixed weight and a plain-language reason that the parent sees.

export interface PurchaseInput {
  amount: number; // paise
  merchant: string | null;
  createdAt: Date;
}

export interface HistoryItem {
  amount: number; // paise
  merchant: string | null;
  createdAt: Date;
}

export interface ScoreResult {
  score: number; // 0 to 1
  flagged: boolean;
  reasons: string[];
}

/** A purchase is flagged for parent review at or above this score. */
export const FLAG_THRESHOLD = 0.5;

/** Weights are chosen so some signals flag alone (very large, late at night) and weaker ones must combine. */
export const WEIGHTS = {
  large: 0.5,
  night: 0.5,
  burst: 0.4,
  drain: 0.3,
  newMerchant: 0.2,
} as const;

const MIN_HISTORY = 5; // need a baseline before "larger than usual" or "new shop" mean anything
const LARGE_MULTIPLE = 3; // at least this many times the child's usual purchase
const LARGE_FLOOR = 5000; // and at least ₹50, so tiny purchases are never flagged for size
const DRAIN_SHARE = 0.8; // spends 80% or more of the wallet in one go
const DRAIN_FLOOR = 2000; // ...and at least ₹20
const BURST_COUNT = 3; // this purchase plus two earlier ones...
const BURST_WINDOW_MS = 10 * 60 * 1000; // ...within 10 minutes
const NIGHT_START = 23; // 11 pm IST
const NIGHT_END = 5; // 5 am IST
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function anomalyEnabled(): boolean {
  return process.env.ANOMALY_ENABLED !== "false";
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2).replace(/\.00$/, "")}`;
const normalise = (m: string | null) => (m ?? "").trim().toLowerCase();

function istClock(d: Date): { hour: number; label: string } {
  const local = new Date(d.getTime() + IST_OFFSET_MS);
  const hour = local.getUTCHours();
  const minute = String(local.getUTCMinutes()).padStart(2, "0");
  return { hour, label: `${hour}:${minute}` };
}

/**
 * Scores one purchase against the child's recent history.
 * @param history   the child's earlier purchases (recent ones, any order)
 * @param balanceBefore wallet balance just before this purchase, in paise
 */
export function scorePurchase(
  purchase: PurchaseInput,
  history: HistoryItem[],
  balanceBefore: number
): ScoreResult {
  const reasons: string[] = [];
  let score = 0;
  const hasBaseline = history.length >= MIN_HISTORY;

  // 1. Much larger than the child's usual purchase.
  const typical = median(history.map((h) => h.amount));
  if (hasBaseline && purchase.amount >= LARGE_FLOOR && purchase.amount >= LARGE_MULTIPLE * typical) {
    score += WEIGHTS.large;
    reasons.push(`Much bigger than usual (a usual purchase is about ${rupees(typical)})`);
  }

  // 2. Made late at night.
  const { hour, label } = istClock(purchase.createdAt);
  if (hour >= NIGHT_START || hour < NIGHT_END) {
    score += WEIGHTS.night;
    reasons.push(`Made late at night (${label})`);
  }

  // 3. Several purchases in a few minutes.
  const recent = history.filter((h) => {
    const gap = purchase.createdAt.getTime() - h.createdAt.getTime();
    return gap >= 0 && gap <= BURST_WINDOW_MS;
  }).length;
  if (recent + 1 >= BURST_COUNT) {
    score += WEIGHTS.burst;
    reasons.push(`${recent + 1} purchases within 10 minutes`);
  }

  // 4. Uses up most of the wallet at once.
  if (balanceBefore > 0 && purchase.amount >= DRAIN_FLOOR && purchase.amount >= DRAIN_SHARE * balanceBefore) {
    score += WEIGHTS.drain;
    reasons.push("Uses almost all of the money in the wallet");
  }

  // 5. First time at this shop.
  const merchant = normalise(purchase.merchant);
  if (hasBaseline && merchant !== "" && !history.some((h) => normalise(h.merchant) === merchant)) {
    score += WEIGHTS.newMerchant;
    reasons.push("First time at this shop");
  }

  const rounded = Math.round(Math.min(score, 1) * 100) / 100;
  return { score: rounded, flagged: rounded >= FLAG_THRESHOLD, reasons };
}
