import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { txOptions } from "@/lib/tx-options";

// ASSUMPTION: auth() returns a session with session.user.id and session.user.role.
// Moving money into a goal is a GOAL_TRANSFER: it is not "spending", so it never counts against limits.

const depositSchema = z.object({
  amount: z.number().int().positive().max(10_000_000), // paise
  idempotencyKey: z.string().min(8).max(100),
});

type Ctx = { params: Promise<{ id: string }> | { id: string } };

export async function POST(req: Request, ctx: Ctx) {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "CHILD") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: goalId } = await ctx.params;
  const parsed = depositSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const { amount, idempotencyKey } = parsed.data;

  const wallet = await prisma.wallet.findUnique({ where: { childId: user.id }, select: { id: true } });
  if (!wallet) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    // 1. Take the same wallet row lock the purchase flow uses, so deposits and purchases serialise.
    await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${wallet.id} FOR UPDATE`;

    // 2. Idempotency: a retried request returns the original result instead of charging twice.
    const duplicate = await tx.transaction.findUnique({ where: { idempotencyKey } });
    if (duplicate) {
      if (duplicate.walletId !== wallet.id || duplicate.type !== "GOAL_TRANSFER") {
        return { kind: "key_conflict" as const };
      }
      return { kind: "replay" as const, transaction: duplicate };
    }

    // 3. Read fresh state while holding the lock.
    const fresh = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    const goal = await tx.savingsGoal.findFirst({ where: { id: goalId, walletId: wallet.id } });
    if (!goal) return { kind: "goal_not_found" as const };
    if (goal.completed) return { kind: "goal_completed" as const };

    const remainingToTarget = goal.target - goal.saved;
    if (amount > remainingToTarget) return { kind: "over_target" as const, remainingToTarget };
    if (fresh.balance < amount) return { kind: "insufficient" as const, balance: fresh.balance };

    // 4. Move the money: ledger row, wallet balance, goal progress, all in one atomic unit.
    const transaction = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: "GOAL_TRANSFER",
        status: "APPROVED",
        amount,
        category: "OTHER",
        note: `Saved to goal: ${goal.title}`,
        idempotencyKey,
      },
    });
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: amount }, version: { increment: 1 } },
    });
    const updatedGoal = await tx.savingsGoal.update({
      where: { id: goal.id },
      data: { saved: { increment: amount }, completed: goal.saved + amount >= goal.target },
    });

    return { kind: "ok" as const, transaction, goal: updatedGoal };
  }, txOptions);

  switch (result.kind) {
    case "ok":
      return NextResponse.json({ transaction: result.transaction, goal: result.goal }, { status: 201 });
    case "replay":
      return NextResponse.json({ transaction: result.transaction, replayed: true }, { status: 200 });
    case "key_conflict":
      return NextResponse.json({ error: "Idempotency key already used" }, { status: 409 });
    case "goal_not_found":
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    case "goal_completed":
      return NextResponse.json({ error: "This goal is already complete" }, { status: 409 });
    case "over_target":
      return NextResponse.json(
        { error: "That's more than this goal needs", remainingToTarget: result.remainingToTarget },
        { status: 422 }
      );
    case "insufficient":
      return NextResponse.json({ error: "Not enough money in your wallet", balance: result.balance }, { status: 402 });
  }
}
