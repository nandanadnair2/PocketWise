import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

// Runs with PRODUCTION timeout defaults (TX_MAX_WAIT_MS=5000, TX_TIMEOUT_MS=10000)
// via vitest.config.prod-defaults.ts. 5-way concurrency instead of 20:
//   DATABASE_URL="<test-branch-url>&connection_limit=10" ALLOW_DB_TESTS=1 \
//     node node_modules/vitest/vitest.mjs run tests/concurrency-low.test.ts \
//     --config vitest.config.prod-defaults.ts
const session = vi.hoisted(() => ({ user: { id: "", role: "CHILD" } }));
vi.mock("@/auth", () => ({ auth: async () => session }));

import { POST } from "@/app/api/transactions/route";

const enabled = process.env.ALLOW_DB_TESTS === "1";
const prisma = new PrismaClient();

describe.skipIf(!enabled)("concurrent spending at production defaults (5-way)", () => {
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
      data: { childId: child.id, balance: 10000, mockCardLast4: "0000" }, // ₹100
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

  const spend = (idempotencyKey: string, amount = 1000) =>
    POST(
      new Request("http://localhost/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "PURCHASE", amount, category: "FOOD", merchant: "Canteen", idempotencyKey }),
      }) as never
    );

  it("5 simultaneous ₹10 purchases against a ₹60 daily limit: exactly 6 would be allowed, so 5 all approve", async () => {
    await prisma.limit.create({
      data: { walletId, period: "DAILY", category: null, amount: 6000 }, // ₹60
    });

    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) => spend(`low-${Date.now()}-${i}`))
    );

    const approvedCount = await prisma.transaction.count({ where: { walletId, status: "APPROVED" } });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });

    expect(approvedCount).toBe(5);
    expect(wallet.balance).toBe(5000); // ₹100 - 5×₹10 = ₹50
    expect(wallet.balance).toBeGreaterThanOrEqual(0);
    // No request should have failed with a 500 under production timeouts at this concurrency
    expect(responses.filter((r) => r.status === 500)).toHaveLength(0);
  }, 60_000);
});
