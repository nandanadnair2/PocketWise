import { prisma } from "@/lib/prisma";
import { anomalyEnabled, scorePurchase, type ScoreResult } from "@/lib/anomaly";

const HISTORY_DAYS = 30;
const HISTORY_LIMIT = 50;

/**
 * Scores a purchase that has already been approved and committed, and flags it for parent review if unusual.
 *
 * This runs AFTER the money-moving transaction has committed, so it never lengthens the time the wallet row
 * is locked. A flagged purchase keeps its money deducted and still counts toward spending limits until a
 * parent confirms or reverses it. If scoring fails, the purchase simply stays approved (fail open).
 *
 * Call it inside try/catch from the purchase route so a scoring problem can never break a purchase.
 */
export async function flagIfUnusual(transactionId: string): Promise<ScoreResult | null> {
  if (!anomalyEnabled()) return null;

  const purchase = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { wallet: { select: { balance: true } } },
  });
  if (!purchase || purchase.type !== "PURCHASE" || purchase.status !== "APPROVED") return null;

  const since = new Date(purchase.createdAt.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const history = await prisma.transaction.findMany({
    where: {
      walletId: purchase.walletId,
      type: "PURCHASE",
      status: { in: ["APPROVED", "FLAGGED"] },
      id: { not: purchase.id },
      createdAt: { gte: since, lt: purchase.createdAt },
    },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { amount: true, merchant: true, createdAt: true },
  });

  // Balance just before this purchase (close enough: scoring happens right after the purchase commits).
  const balanceBefore = purchase.wallet.balance + purchase.amount;
  const result = scorePurchase(
    { amount: purchase.amount, merchant: purchase.merchant, createdAt: purchase.createdAt },
    history,
    balanceBefore
  );

  if (!result.flagged) {
    await prisma.transaction.update({ where: { id: purchase.id }, data: { anomalyScore: result.score } });
    return result;
  }

  await prisma.$transaction([
    // Only flips APPROVED -> FLAGGED; if something else already changed the status, nothing happens.
    prisma.transaction.updateMany({
      where: { id: purchase.id, status: "APPROVED" },
      data: { status: "FLAGGED", anomalyScore: result.score, anomalyReasons: result.reasons },
    }),
    prisma.alert.create({
      data: {
        walletId: purchase.walletId,
        kind: "ANOMALY",
        message: `Unusual purchase of ₹${(purchase.amount / 100).toFixed(2)} at ${purchase.merchant ?? "a shop"} needs a parent's review.`,
      },
    }),
  ]);
  return result;
}
