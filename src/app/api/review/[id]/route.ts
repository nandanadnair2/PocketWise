import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { txOptions } from "@/lib/tx-options";

// ASSUMPTION: auth() returns a session with session.user.id and session.user.role.

const decisionSchema = z.object({ decision: z.enum(["CONFIRM", "DENY"]) });

type Ctx = { params: Promise<{ id: string }> | { id: string } };

/**
 * Parent decides on a flagged purchase.
 *  CONFIRM: the purchase stays (FLAGGED -> APPROVED).
 *  DENY:    the purchase is reversed (FLAGGED -> REVERSED) and the money goes back to the wallet.
 * A compare-and-set on the status means only one decision can ever win, even if several arrive at once.
 */
export async function POST(req: Request, ctx: Ctx) {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "PARENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parentId = user.id;

  const { id } = await ctx.params;
  const parsed = decisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const { decision } = parsed.data;

  // A parent may only review purchases made by their own children.
  const purchase = await prisma.transaction.findFirst({
    where: { id, type: "PURCHASE", wallet: { child: { parentId } } },
    include: { wallet: { select: { childId: true } } },
  });
  if (!purchase) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const outcome = await prisma.$transaction(async (db) => {
    const won = await db.transaction.updateMany({
      where: { id, status: "FLAGGED" },
      data: { status: decision === "CONFIRM" ? "APPROVED" : "REVERSED", reviewedAt: new Date() },
    });
    if (won.count === 0) return { kind: "already_reviewed" as const };

    if (decision === "DENY") {
      // Same wallet lock as purchases, deposits and allowance credits.
      await db.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${purchase.walletId} FOR UPDATE`;
      await db.transaction.create({
        data: {
          walletId: purchase.walletId,
          type: "REFUND",
          status: "APPROVED",
          amount: purchase.amount,
          category: purchase.category,
          merchant: purchase.merchant,
          note: "Reversed after parent review",
          idempotencyKey: `reversal-${id}`, // unique key: a second safeguard against a double refund
        },
      });
      await db.wallet.update({
        where: { id: purchase.walletId },
        data: { balance: { increment: purchase.amount }, version: { increment: 1 } },
      });
    }

    await db.auditLog.create({
      data: {
        actorId: parentId,
        action: decision === "CONFIRM" ? "PURCHASE_CONFIRMED" : "PURCHASE_REVERSED",
        detail: {
          transactionId: id,
          childId: purchase.wallet.childId,
          amount: purchase.amount,
          anomalyScore: purchase.anomalyScore,
        },
      },
    });
    return { kind: "ok" as const };
  }, txOptions);

  if (outcome.kind === "already_reviewed") {
    return NextResponse.json({ error: "This purchase was already reviewed" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, decision });
}
