import { describe, expect, it } from "vitest";
import { evaluateLimits, periodStart, type LimitRow } from "../src/lib/limits";

const daily: LimitRow = { id: "d", period: "DAILY", category: null, amount: 10000 }; // ₹100
const foodWeekly: LimitRow = { id: "fw", period: "WEEKLY", category: "FOOD", amount: 20000 }; // ₹200

describe("periodStart (IST)", () => {
  it("daily window starts at 00:00 IST", () => {
    // 2026-11-18 20:00 UTC = 2026-11-19 01:30 IST -> window starts 2026-11-19 00:00 IST
    const start = periodStart("DAILY", new Date("2026-11-18T20:00:00Z"));
    expect(start.toISOString()).toBe("2026-11-18T18:30:00.000Z");
  });

  it("weekly window starts on Monday 00:00 IST", () => {
    // Wednesday 2026-11-18 -> Monday 2026-11-16 00:00 IST
    const start = periodStart("WEEKLY", new Date("2026-11-18T10:00:00Z"));
    expect(start.toISOString()).toBe("2026-11-15T18:30:00.000Z");
  });

  it("monthly window starts on the 1st 00:00 IST", () => {
    const start = periodStart("MONTHLY", new Date("2026-11-18T10:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-31T18:30:00.000Z");
  });
});

describe("evaluateLimits", () => {
  it("allows spending under all thresholds with no alerts", () => {
    const r = evaluateLimits([daily], { d: 0 }, "FOOD", 2000);
    expect(r.allowed).toBe(true);
    expect(r.alerts).toHaveLength(0);
  });

  it("raises LIMIT_50 when a purchase crosses 50%", () => {
    const r = evaluateLimits([daily], { d: 4000 }, "FOOD", 1500); // 4000 -> 5500
    expect(r.allowed).toBe(true);
    expect(r.alerts.map((a) => a.kind)).toEqual(["LIMIT_50"]);
  });

  it("raises both LIMIT_80 and LIMIT_95 when one purchase crosses both", () => {
    const r = evaluateLimits([daily], { d: 7000 }, "FOOD", 2600); // 7000 -> 9600
    expect(r.alerts.map((a) => a.kind)).toEqual(["LIMIT_80", "LIMIT_95"]);
  });

  it("does not repeat an alert that was already crossed", () => {
    const r = evaluateLimits([daily], { d: 5500 }, "FOOD", 500); // 55% -> 60%
    expect(r.alerts).toHaveLength(0);
  });

  it("allows landing exactly on the limit and raises LIMIT_HIT", () => {
    const r = evaluateLimits([daily], { d: 9000 }, "FOOD", 1000);
    expect(r.allowed).toBe(true);
    expect(r.alerts.map((a) => a.kind)).toContain("LIMIT_HIT");
  });

  it("blocks a purchase that would exceed the limit and reports what is left", () => {
    const r = evaluateLimits([daily], { d: 9000 }, "FOOD", 1001);
    expect(r.allowed).toBe(false);
    expect(r.blockedBy?.remaining).toBe(1000);
    expect(r.alerts[0].kind).toBe("LIMIT_HIT");
  });

  it("ignores category limits for other categories", () => {
    const r = evaluateLimits([foodWeekly], { fw: 19900 }, "GAMES", 5000);
    expect(r.allowed).toBe(true);
  });

  it("enforces a category limit for its own category", () => {
    const r = evaluateLimits([foodWeekly], { fw: 19900 }, "FOOD", 500);
    expect(r.allowed).toBe(false);
  });

  it("blocks if ANY applicable limit would be exceeded", () => {
    const r = evaluateLimits([daily, foodWeekly], { d: 9500, fw: 0 }, "FOOD", 600);
    expect(r.allowed).toBe(false);
    expect(r.blockedBy?.limitId).toBe("d");
  });
});
