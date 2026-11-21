import { describe, expect, it } from "vitest";
import { median, scorePurchase, FLAG_THRESHOLD, type HistoryItem } from "../src/lib/anomaly";

// 2026-11-20 14:00 IST (daytime) and 03:00 IST (night), expressed in UTC.
const DAY = new Date("2026-11-20T08:30:00Z");
const NIGHT = new Date("2026-11-19T21:30:00Z");
const minutesBefore = (d: Date, m: number) => new Date(d.getTime() - m * 60_000);

// A child who usually spends about ₹20 at the canteen or the book shop, spread over earlier days.
const history: HistoryItem[] = [1500, 2000, 2000, 2500, 1800, 2200].map((amount, i) => ({
  amount,
  merchant: i % 2 === 0 ? "Canteen" : "Book shop",
  createdAt: new Date(DAY.getTime() - (i + 1) * 24 * 3600_000),
}));

describe("median", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("scorePurchase", () => {
  it("does not flag an ordinary daytime purchase at a familiar shop", () => {
    const r = scorePurchase({ amount: 2200, merchant: "Canteen", createdAt: DAY }, history, 20000);
    expect(r).toEqual({ score: 0, flagged: false, reasons: [] });
  });

  it("flags a purchase much larger than usual, and says why", () => {
    const r = scorePurchase({ amount: 15000, merchant: "Canteen", createdAt: DAY }, history, 60000);
    expect(r.flagged).toBe(true);
    expect(r.reasons[0]).toContain("Much bigger than usual");
    expect(r.reasons[0]).toContain("₹20");
  });

  it("ignores size when the amount is below the ₹50 floor", () => {
    // 4x the usual ₹20 would normally count, but ₹40 is under the floor.
    const r = scorePurchase({ amount: 4000, merchant: "Canteen", createdAt: DAY }, history, 60000);
    expect(r.flagged).toBe(false);
  });

  it("flags a late-night purchase on its own, using IST", () => {
    const r = scorePurchase({ amount: 2000, merchant: "Canteen", createdAt: NIGHT }, history, 20000);
    expect(r.flagged).toBe(true);
    expect(r.reasons[0]).toContain("late at night");
    expect(r.reasons[0]).toContain("3:00");
  });

  it("does not flag a burst of purchases on its own", () => {
    const burst: HistoryItem[] = [
      ...history,
      { amount: 2000, merchant: "Canteen", createdAt: minutesBefore(DAY, 3) },
      { amount: 2000, merchant: "Canteen", createdAt: minutesBefore(DAY, 7) },
    ];
    const r = scorePurchase({ amount: 2000, merchant: "Canteen", createdAt: DAY }, burst, 20000);
    expect(r.flagged).toBe(false);
    expect(r.score).toBe(0.4);
    expect(r.reasons[0]).toContain("3 purchases within 10 minutes");
  });

  it("flags a burst at a shop the child has never used", () => {
    const burst: HistoryItem[] = [
      ...history,
      { amount: 2000, merchant: "Canteen", createdAt: minutesBefore(DAY, 3) },
      { amount: 2000, merchant: "Canteen", createdAt: minutesBefore(DAY, 7) },
    ];
    const r = scorePurchase({ amount: 2000, merchant: "Game store", createdAt: DAY }, burst, 20000);
    expect(r.flagged).toBe(true);
    expect(r.reasons).toContain("First time at this shop");
  });

  it("flags draining the wallet at a new shop, but not at a familiar one", () => {
    // ₹50 out of a ₹60 wallet: under the "much bigger than usual" line (₹60), but most of the wallet.
    const familiar = scorePurchase({ amount: 5000, merchant: "Canteen", createdAt: DAY }, history, 6000);
    const unfamiliar = scorePurchase({ amount: 5000, merchant: "Game store", createdAt: DAY }, history, 6000);
    expect(familiar.reasons.some((r) => r.includes("almost all"))).toBe(true);
    expect(familiar.score).toBeLessThan(FLAG_THRESHOLD);
    expect(unfamiliar.flagged).toBe(true);
  });

  it("does not judge size or new shops without a baseline, but still catches night purchases", () => {
    const fewHistory = history.slice(0, 3);
    const big = scorePurchase({ amount: 90000, merchant: "Game store", createdAt: DAY }, fewHistory, 200000);
    expect(big.flagged).toBe(false);
    const night = scorePurchase({ amount: 2000, merchant: "Game store", createdAt: NIGHT }, fewHistory, 200000);
    expect(night.flagged).toBe(true);
  });

  it("matches shop names without regard to case or spaces", () => {
    const r = scorePurchase({ amount: 2000, merchant: "  canteen ", createdAt: DAY }, history, 20000);
    expect(r.reasons).not.toContain("First time at this shop");
  });

  it("caps the score at 1", () => {
    const burst: HistoryItem[] = [
      ...history,
      { amount: 2000, merchant: "Canteen", createdAt: minutesBefore(NIGHT, 3) },
      { amount: 2000, merchant: "Canteen", createdAt: minutesBefore(NIGHT, 7) },
    ];
    const r = scorePurchase({ amount: 90000, merchant: "Game store", createdAt: NIGHT }, burst, 95000);
    expect(r.score).toBe(1);
    expect(r.flagged).toBe(true);
  });
});
