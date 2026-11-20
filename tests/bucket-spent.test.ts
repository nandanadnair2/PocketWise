import { describe, expect, it } from "vitest";
import { bucketSpent, periodStart, type LimitRow } from "../src/lib/limits";

// Fixed "now": Wednesday 2026-11-18 10:00 UTC = 15:30 IST
const NOW = new Date("2026-11-18T10:00:00Z");

const daily: LimitRow = { id: "d", period: "DAILY", category: null, amount: 10000 };
const weekly: LimitRow = { id: "w", period: "WEEKLY", category: null, amount: 50000 };
const monthly: LimitRow = { id: "m", period: "MONTHLY", category: null, amount: 200000 };
const foodWeekly: LimitRow = { id: "fw", period: "WEEKLY", category: "FOOD", amount: 20000 };

describe("bucketSpent window boundaries (IST)", () => {
  it("daily: purchase exactly at 00:00 IST counts, one before does not", () => {
    const start = periodStart("DAILY", NOW); // 2026-11-18T18:30:00Z (00:00 IST)
    const rows = [
      { amount: 1000, category: "FOOD" as const, createdAt: start }, // exactly at start
      { amount: 2000, category: "FOOD" as const, createdAt: new Date(start.getTime() - 1) }, // 1ms before
    ];
    const spent = bucketSpent(rows, [daily], NOW);
    expect(spent.d).toBe(1000);
  });

  it("weekly: Monday 00:00 IST boundary; a Sunday purchase belongs to the previous week", () => {
    const start = periodStart("WEEKLY", NOW); // Monday 2026-11-16 00:00 IST
    const rows = [
      { amount: 3000, category: "GAMES" as const, createdAt: start },
      { amount: 4000, category: "GAMES" as const, createdAt: new Date(start.getTime() - 1000) }, // Sunday
    ];
    expect(bucketSpent(rows, [weekly], NOW).w).toBe(3000);
  });

  it("monthly: the 1st 00:00 IST boundary", () => {
    const start = periodStart("MONTHLY", NOW); // 2026-11-01 00:00 IST
    const rows = [
      { amount: 5000, category: "BOOKS" as const, createdAt: start },
      { amount: 6000, category: "BOOKS" as const, createdAt: new Date(start.getTime() - 1) }, // Oct 31
    ];
    expect(bucketSpent(rows, [monthly], NOW).m).toBe(5000);
  });

  it("buckets the same rows independently per window", () => {
    // 2026-11-18 06:30 UTC = 12:00 IST on Nov 18: inside today + this week + this month
    const rows = [{ amount: 700, category: "FOOD" as const, createdAt: new Date("2026-11-18T06:30:00Z") }];
    const spent = bucketSpent(rows, [daily, weekly, monthly], NOW);
    expect(spent.d).toBe(700);
    expect(spent.w).toBe(700);
    expect(spent.m).toBe(700);
  });
});

describe("bucketSpent category filters", () => {
  it("a category limit only counts its own category", () => {
    const rows = [
      { amount: 1000, category: "FOOD" as const, createdAt: NOW },
      { amount: 2000, category: "GAMES" as const, createdAt: NOW },
      { amount: 500, category: "BOOKS" as const, createdAt: NOW },
    ];
    expect(bucketSpent(rows, [foodWeekly], NOW).fw).toBe(1000);
  });

  it("a null-category limit counts every category", () => {
    const rows = [
      { amount: 1000, category: "FOOD" as const, createdAt: NOW },
      { amount: 2000, category: "GAMES" as const, createdAt: NOW },
    ];
    expect(bucketSpent(rows, [weekly], NOW).w).toBe(3000);
  });

  it("category and window filters combine", () => {
    const start = periodStart("WEEKLY", NOW);
    const rows = [
      { amount: 100, category: "FOOD" as const, createdAt: start }, // this week, food
      { amount: 200, category: "FOOD" as const, createdAt: new Date(start.getTime() - 1) }, // last week, food
      { amount: 400, category: "GAMES" as const, createdAt: NOW }, // this week, not food
    ];
    expect(bucketSpent(rows, [foodWeekly], NOW).fw).toBe(100);
  });

  it("returns zeros for limits with no matching rows", () => {
    const spent = bucketSpent([], [daily, foodWeekly], NOW);
    expect(spent.d).toBe(0);
    expect(spent.fw).toBe(0);
  });
});
