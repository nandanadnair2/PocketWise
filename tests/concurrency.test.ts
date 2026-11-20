import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

// Mutable session so the mocked auth() can act as the test child.
const session = vi.hoisted(() => ({ user: { id: "", role: "CHILD" } }));
vi.mock("@/auth", () => ({ auth: async () => session }));

import { POST } from "@/app/api/transactions/route";

// SAFETY: this writes real rows. Run it only against a throwaway Neon branch:
//   DATABASE_URL="<test-branch-url>" ALLOW_DB_TESTS=1 npx vitest run tests/concurrency.test.ts
const enabled = process.env.ALLOW_DB_TESTS === "1";
const prisma = new PrismaClient();

describe.skipIf(!enabled)("concurrent spending", () => {
  let parentId = "";
  let childId = "";
  let walletId = "";

  beforeAll(async () => {
    const stamp = Date.now();
    const parent = await prisma.user.create({
      data: { role: "PARENT", name: "Test Parent", email: `parent-${stamp}@test.local` },
    });
    const child = await prisma.user.create({
      data: { role: "CHILD", name: "Test Child", parentId: parent.id },
    });
    const wallet = await prisma.wallet.create({
      data: { childId: child.id, balance: 10000, mockCardLast4: "0000" }, // ₹100.00
    });
    parentId = parent.id;
    childId = child.id;
    walletId = wallet.id;
    session.user.id = child.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.alert.deleteMany({ where: { walletId } });
    await prisma.transaction.deleteMany({ where: { walletId } });
    await prisma.limit.deleteMany({ where: { walletId } });
    await prisma.wallet.deleteMany({ where: { id: walletId } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [parentId, childId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [childId, parentId] } } });
    await prisma.$disconnect();
  }, 60_000);

  // ADAPT if your route expects a different body shape (e.g. it needs walletId).
  const spend = (idempotencyKey: string, amount = 1000) =>
    POST(
      new Request("http://localhost/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "PURCHASE", amount, category: "FOOD", merchant: "Canteen", idempotencyKey }),
      }) as never
    );

  it("never overspends a limit when 20 purchases arrive at once", async () => {
    // Daily limit ₹60, balance ₹100, 20 purchases of ₹10 fired together.
    await prisma.limit.create({
      data: { walletId, period: "DAILY", category: null, amount: 6000 },
    });

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => spend(`race-${Date.now()}-${i}`))
    );

    const approvedCount = await prisma.transaction.count({ where: { walletId, status: "APPROVED" } });
    const declinedCount = await prisma.transaction.count({ where: { walletId, status: "DECLINED_LIMIT" } });
    const approvedSum = await prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { walletId, status: "APPROVED" },
    });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });

    expect(approvedCount).toBe(6);
    expect(declinedCount).toBe(14);
    expect(approvedSum._sum.amount).toBe(6000);
    expect(wallet.balance).toBe(4000);
    expect(wallet.balance).toBeGreaterThanOrEqual(0);
    expect(responses.filter((r) => r.status === 402)).toHaveLength(14);
  }, 60_000);

  it("charges once when the same idempotency key is sent 5 times at once", async () => {
    // Reset: clear history, give a roomy limit and a fresh balance.
    await prisma.transaction.deleteMany({ where: { walletId } });
    await prisma.limit.deleteMany({ where: { walletId } });
    await prisma.limit.create({
      data: { walletId, period: "DAILY", category: null, amount: 1_000_000 },
    });
    await prisma.wallet.update({ where: { id: walletId }, data: { balance: 10000 } });

    const key = `dup-${Date.now()}`;
    await Promise.all(Array.from({ length: 5 }, () => spend(key)));

    // Assert on the database truth, not on response codes: some duplicates may error out.
    const rows = await prisma.transaction.count({ where: { walletId, idempotencyKey: key } });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });

    expect(rows).toBe(1);
    expect(wallet.balance).toBe(9000);
  }, 60_000);
});
