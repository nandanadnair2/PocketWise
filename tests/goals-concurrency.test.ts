import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const session = vi.hoisted(() => ({ user: { id: "", role: "CHILD" } }));
vi.mock("@/auth", () => ({ auth: async () => session }));

import { POST as deposit } from "@/app/api/goals/[id]/deposit/route";

// SAFETY: writes real rows. Run only against a throwaway Neon branch:
//   DATABASE_URL="<test-branch-url>" ALLOW_DB_TESTS=1 npx vitest run tests/goals-concurrency.test.ts
const enabled = process.env.ALLOW_DB_TESTS === "1";
const prisma = new PrismaClient();

describe.skipIf(!enabled)("concurrent goal deposits", () => {
  let parentId = "";
  let childId = "";
  let walletId = "";
  let goalId = "";

  beforeAll(async () => {
    const stamp = Date.now();
    const parent = await prisma.user.create({
      data: { role: "PARENT", name: "Test Parent", email: `goal-parent-${stamp}@test.local` },
    });
    const child = await prisma.user.create({
      data: { role: "CHILD", name: "Test Child", parentId: parent.id },
    });
    const wallet = await prisma.wallet.create({
      data: { childId: child.id, balance: 10000, mockCardLast4: "0000" }, // ₹100
    });
    const goal = await prisma.savingsGoal.create({
      data: { walletId: wallet.id, title: "Test goal", target: 100000 }, // ₹1000
    });
    parentId = parent.id;
    childId = child.id;
    walletId = wallet.id;
    goalId = goal.id;
    session.user.id = child.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { walletId } });
    await prisma.savingsGoal.deleteMany({ where: { walletId } });
    await prisma.wallet.deleteMany({ where: { id: walletId } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [parentId, childId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [childId, parentId] } } });
    await prisma.$disconnect();
  }, 60_000);

  const put = (idempotencyKey: string, amount = 1000) =>
    deposit(
      new Request("http://localhost/api/goals/x/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, idempotencyKey }),
      }) as never,
      { params: { id: goalId } }
    );

  it("never overdraws the wallet and never creates or loses money under 20 simultaneous deposits", async () => {
    // Balance ₹100, 20 deposits of ₹10: exactly 10 can succeed.
    const stamp = Date.now();
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => put(`goal-race-${stamp}-${i}`)));

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    const goal = await prisma.savingsGoal.findUniqueOrThrow({ where: { id: goalId } });
    const transfers = await prisma.transaction.aggregate({
      _sum: { amount: true },
      _count: true,
      where: { walletId, type: "GOAL_TRANSFER", status: "APPROVED" },
    });

    expect(transfers._count).toBe(10);
    expect(transfers._sum.amount).toBe(10000);
    expect(wallet.balance).toBe(0);
    expect(goal.saved).toBe(10000);
    expect(wallet.balance + goal.saved).toBe(10000); // conservation of money
    expect(responses.filter((r) => r.status === 201)).toHaveLength(10);
    expect(responses.filter((r) => r.status === 402)).toHaveLength(10);
  }, 90_000);

  it("deposits once when the same idempotency key is sent 5 times at once", async () => {
    await prisma.transaction.deleteMany({ where: { walletId } });
    await prisma.wallet.update({ where: { id: walletId }, data: { balance: 10000 } });
    await prisma.savingsGoal.update({ where: { id: goalId }, data: { saved: 0, completed: false } });

    const key = `goal-dup-${Date.now()}`;
    const responses = await Promise.all(Array.from({ length: 5 }, () => put(key)));

    const rows = await prisma.transaction.count({ where: { walletId, idempotencyKey: key } });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    const goal = await prisma.savingsGoal.findUniqueOrThrow({ where: { id: goalId } });

    expect(rows).toBe(1);
    expect(wallet.balance).toBe(9000);
    expect(goal.saved).toBe(1000);
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(4); // replays
  }, 90_000);

  it("rejects a deposit larger than what the goal still needs", async () => {
    await prisma.savingsGoal.update({ where: { id: goalId }, data: { target: 5000, saved: 4500 } });
    const res = await put(`goal-over-${Date.now()}`, 1000);
    expect(res.status).toBe(422);
  }, 60_000);
});
