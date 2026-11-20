import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { txOptions } from "@/lib/tx-options";

// ASSUMPTION: auth() returns a session with session.user.id and session.user.role.

const decideSchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]) });

type Ctx = { params: Promise<{ id: string }> | { id: string } };

export async function POST(req: Request, ctx: Ctx) {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "PARENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parentId = user.id;

  const { id } = await ctx.params;
  const parsed = decideSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const { decision } = parsed.data;

  // A parent may only decide requests from their own children.
  const request = await prisma.allowanceRequest.findFirst({
    where: { id, child: { parentId } },
    include: { child: { include: { wallet: true } } },
  });
  if (!request || !request.child.wallet) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const walletId = request.child.wallet.id;

  const outcome = await prisma.$transaction(async (tx) => {
    // Compare-and-set: only one concurrent decision can move the request out of PENDING.
    // A second one blocks on the row, then sees a non-PENDING status and matches nothing.
    const won = await tx.allowanceRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", decidedAt: new Date() },
    });
    if (won.count === 0) return { kind: "already_decided" as const };

    if (decision === "APPROVE") {
      // Same wallet lock as purchases and deposits.
      await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${walletId} FOR UPDATE`;
      await tx.transaction.create({
        data: {
          walletId,
          type: "ALLOWANCE_CREDIT",
          status: "APPROVED",
          amount: request.amount,
          category: "OTHER",
          note: `Allowance request approved: ${request.reason}`,
          idempotencyKey: `allowance-request-${id}`, // unique key = second safety net against double credit
        },
      });
      await tx.wallet.update({
        where: { id: walletId },
        data: { balance: { increment: request.amount }, version: { increment: 1 } },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: parentId,
        action: decision === "APPROVE" ? "ALLOWANCE_APPROVED" : "ALLOWANCE_REJECTED",
        detail: { requestId: id, childId: request.childId, amount: request.amount },
      },
    });
    return { kind: "ok" as const };
  }, txOptions);

  if (outcome.kind === "already_decided") {
    return NextResponse.json({ error: "This request was already decided" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, decision });
}
