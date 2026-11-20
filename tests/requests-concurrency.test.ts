import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const session = vi.hoisted(() => ({ user: { id: "", role: "PARENT" } }));
vi.mock("@/auth", () => ({ auth: async () => session }));

import { POST as decide } from "@/app/api/requests/[id]/decide/route";

// SAFETY: writes real rows. Run only against a throwaway Neon branch:
//   DATABASE_URL="<test-branch-url>" ALLOW_DB_TESTS=1 npx vitest run tests/requests-concurrency.test.ts
const enabled = process.env.ALLOW_DB_TESTS === "1";
const prisma = new PrismaClient();

describe.skipIf(!enabled)("concurrent allowance decisions", () => {
  let parentId = "";
  let childId = "";
  let walletId = "";

  beforeAll(async () => {
    const stamp = Date.now();
    const parent = await prisma.user.create({
      data: { role: "PARENT", name: "Test Parent", email: `req-parent-${stamp}@test.local` },
    });
    const child = await prisma.user.create({
      data: { role: "CHILD", name: "Test Child", parentId: parent.id },
    });
    const wallet = await prisma.wallet.create({
      data: { childId: child.id, balance: 0, mockCardLast4: "0000" },
    });
    parentId = parent.id;
    childId = child.id;
    walletId = wallet.id;
    session.user.id = parent.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.alert.deleteMany({ where: { walletId } });
    await prisma.transaction.deleteMany({ where: { walletId } });
    await prisma.allowanceRequest.deleteMany({ where: { childId } });
    await prisma.wallet.deleteMany({ where: { id: walletId } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [parentId, childId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [childId, parentId] } } });
    await prisma.$disconnect();
  }, 60_000);

  const newRequest = (amount = 5000) =>
    prisma.allowanceRequest.create({ data: { childId, amount, reason: "Test request" } });

  const decideOn = (id: string, decision: "APPROVE" | "REJECT") =>
    decide(
      new Request("http://localhost/api/requests/x/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      }) as never,
      { params: { id } }
    );

  it("credits the wallet exactly once when the same request is approved 5 times at once", async () => {
    const request = await newRequest(5000);
    const responses = await Promise.all(Array.from({ length: 5 }, () => decideOn(request.id, "APPROVE")));

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    const credits = await prisma.transaction.count({
      where: { walletId, type: "ALLOWANCE_CREDIT", idempotencyKey: `allowance-request-${request.id}` },
    });

    expect(credits).toBe(1);
    expect(wallet.balance).toBe(5000);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(4);
  }, 90_000);

  it("keeps money consistent when approve and reject race on the same request", async () => {
    await prisma.wallet.update({ where: { id: walletId }, data: { balance: 0 } });
    await prisma.transaction.deleteMany({ where: { walletId } });
    const request = await newRequest(3000);

    const responses = await Promise.all([
      decideOn(request.id, "APPROVE"),
      decideOn(request.id, "REJECT"),
      decideOn(request.id, "APPROVE"),
      decideOn(request.id, "REJECT"),
    ]);

    const finalRequest = await prisma.allowanceRequest.findUniqueOrThrow({ where: { id: request.id } });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });

    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(["APPROVED", "REJECTED"]).toContain(finalRequest.status);
    // Whoever won, the wallet must match the final status.
    expect(wallet.balance).toBe(finalRequest.status === "APPROVED" ? 3000 : 0);
  }, 90_000);

  it("refuses a parent who does not own the child", async () => {
    const stranger = await prisma.user.create({
      data: { role: "PARENT", name: "Stranger", email: `stranger-${Date.now()}@test.local` },
    });
    const request = await newRequest(1000);
    const original = session.user.id;
    session.user.id = stranger.id;

    const res = await decideOn(request.id, "APPROVE");

    session.user.id = original;
    await prisma.user.delete({ where: { id: stranger.id } });
    expect(res.status).toBe(404);
  }, 60_000);
});
