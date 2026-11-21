import { describe, expect, it } from "vitest";
import { scorePurchase, type HistoryItem } from "../src/lib/anomaly";

// SIMULATED DATA: there is no real child spending data in this project. The generator below describes
// how a typical child spends and how unusual purchases are injected, so these numbers show how the
// rules behave on that assumed behaviour, not how they would perform in the real world.

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(2026);
const ri = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[ri(0, arr.length - 1)];
const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

const IST_OFFSET = 5.5 * 3600_000;
const TODAY_START = Date.UTC(2026, 10, 20) - IST_OFFSET; // 2026-11-20 00:00 IST in UTC ms
const at = (daysAgo: number, hour: number, minute: number) =>
  new Date(TODAY_START - daysAgo * 86_400_000 + (hour * 60 + minute) * 60_000);

const SHOPS = ["Canteen", "Book shop", "Stationery", "Bakery", "Toy store", "Ice cream", "Game store", "Cinema", "Pharmacy", "Kiosk", "Bus pass", "Pizza place"];

interface Child {
  typical: number; // usual purchase in paise
  familiar: string[];
  history: HistoryItem[];
}

function makeChild(): Child {
  const typical = ri(10, 60) * 100;
  const shuffled = [...SHOPS].sort(() => rand() - 0.5);
  const familiar = shuffled.slice(0, 5);
  const history: HistoryItem[] = [];

  for (let i = 0; i < 40; i++) {
    const day = ri(1, 30);
    const hour = rand() < 0.95 ? ri(8, 20) : ri(21, 22);
    const minute = ri(0, 59);
    const amount = Math.max(100, Math.round((typical * Math.exp(0.5 * normal())) / 100) * 100);
    const merchant = rand() < 0.9 ? pick(familiar) : pick(shuffled.slice(5));
    const when = at(day, hour, minute);
    history.push({ amount, merchant, createdAt: when });
    if (rand() < 0.04) {
      history.push({ amount, merchant, createdAt: new Date(when.getTime() + 3 * 60_000) }); // an occasional quick second purchase
    }
  }
  return { typical, familiar, history };
}

const normalAmount = (c: Child) => Math.max(100, Math.round((c.typical * Math.exp(0.5 * normal())) / 100) * 100);

type Sample = { child: Child; amount: number; merchant: string; when: Date; balance: number; extra: HistoryItem[]; label: string; anomalous: boolean };

function normalSample(c: Child): Sample {
  const when = at(0, ri(8, 20), ri(0, 59));
  const extra: HistoryItem[] = [];
  if (rand() < 0.04) {
    extra.push({ amount: normalAmount(c), merchant: pick(c.familiar), createdAt: new Date(when.getTime() - 4 * 60_000) });
    extra.push({ amount: normalAmount(c), merchant: pick(c.familiar), createdAt: new Date(when.getTime() - 8 * 60_000) });
  }
  const merchant = rand() < 0.9 ? pick(c.familiar) : pick(SHOPS.filter((s) => !c.familiar.includes(s)));
  return { child: c, amount: normalAmount(c), merchant, when, balance: c.typical * ri(4, 25), extra, label: "normal", anomalous: false };
}

function anomalySample(c: Child, kind: string): Sample {
  const newShop = () => pick(SHOPS.filter((s) => !c.familiar.includes(s)));
  const day = (h: number) => at(0, h, ri(0, 59));
  switch (kind) {
    case "large": {
      const amount = Math.round((c.typical * (4 + 6 * rand())) / 100) * 100;
      return { child: c, amount, merchant: pick(c.familiar), when: day(ri(8, 20)), balance: amount * 2 + c.typical * 4, extra: [], label: kind, anomalous: true };
    }
    case "night":
      return { child: c, amount: normalAmount(c), merchant: rand() < 0.5 ? newShop() : pick(c.familiar), when: day(pick([23, 0, 1, 2, 3, 4])), balance: c.typical * ri(4, 25), extra: [], label: kind, anomalous: true };
    case "burst": {
      const when = day(ri(9, 19));
      const extra = [4, 8].map((m) => ({ amount: normalAmount(c), merchant: pick(c.familiar), createdAt: new Date(when.getTime() - m * 60_000) }));
      return { child: c, amount: normalAmount(c), merchant: pick(c.familiar), when, balance: c.typical * ri(4, 25), extra, label: "burst (familiar shop)", anomalous: true };
    }
    case "burst-new": {
      const when = day(ri(9, 19));
      const extra = [4, 8].map((m) => ({ amount: normalAmount(c), merchant: pick(c.familiar), createdAt: new Date(when.getTime() - m * 60_000) }));
      return { child: c, amount: normalAmount(c), merchant: newShop(), when, balance: c.typical * ri(4, 25), extra, label: "burst (new shop)", anomalous: true };
    }
    default: {
      // drain: spends 85-100% of a small wallet
      const balance = Math.max(2500, c.typical * ri(2, 6));
      const amount = Math.max(2000, Math.round((balance * (0.85 + 0.15 * rand())) / 100) * 100);
      return { child: c, amount, merchant: rand() < 0.5 ? newShop() : pick(c.familiar), when: day(ri(9, 19)), balance: Math.max(balance, amount), extra: [], label: "drain wallet", anomalous: true };
    }
  }
}

function evaluate(s: Sample) {
  return scorePurchase({ amount: s.amount, merchant: s.merchant, createdAt: s.when }, [...s.child.history, ...s.extra], s.balance).flagged;
}

describe("anomaly rules on simulated spending", () => {
  it("measures false positives and recall", () => {
    const children = Array.from({ length: 300 }, makeChild);
    const kinds = ["large", "night", "burst", "burst-new", "drain"];

    let tp = 0, fp = 0, fn = 0, tn = 0;
    const byKind: Record<string, { hit: number; total: number }> = {};

    for (const c of children) {
      for (let i = 0; i < 20; i++) {
        const s = normalSample(c);
        if (evaluate(s)) fp++; else tn++;
      }
      for (const k of kinds) {
        const s = anomalySample(c, k);
        const flagged = evaluate(s);
        byKind[s.label] ??= { hit: 0, total: 0 };
        byKind[s.label].total++;
        if (flagged) { tp++; byKind[s.label].hit++; } else fn++;
      }
    }

    const precision = tp / (tp + fp);
    const recall = tp / (tp + fn);
    const fpr = fp / (fp + tn);

    // eslint-disable-next-line no-console
    console.log(
      [
        `Simulated children: ${children.length}; normal purchases: ${fp + tn}; injected unusual purchases: ${tp + fn}`,
        `False-positive rate (normal purchases flagged): ${(fpr * 100).toFixed(1)}%`,
        `Recall (unusual purchases flagged): ${(recall * 100).toFixed(1)}%`,
        `Precision at this simulated mix: ${(precision * 100).toFixed(1)}%`,
        ...Object.entries(byKind).map(([k, v]) => `  ${k}: ${((v.hit / v.total) * 100).toFixed(0)}% flagged`),
      ].join("\n")
    );

    // Loose guard rails so a future rule change that breaks behaviour is noticed.
    expect(fpr).toBeLessThan(0.05);
    expect(recall).toBeGreaterThan(0.6);
    expect(byKind["large"].hit / byKind["large"].total).toBeGreaterThan(0.85);
    expect(byKind["night"].hit / byKind["night"].total).toBe(1);
  });
});
