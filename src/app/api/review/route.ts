import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// ASSUMPTION: auth() returns a session with session.user.id and session.user.role.

/** Parent: flagged purchases from their own children that still need a decision. */
export async function GET() {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "PARENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const flagged = await prisma.transaction.findMany({
    where: { type: "PURCHASE", status: "FLAGGED", wallet: { child: { parentId: user.id } } },
    orderBy: { createdAt: "asc" },
    take: 20,
    include: {
      wallet: { select: { mockCardLast4: true, child: { select: { id: true, name: true } } } },
    },
  });

  return NextResponse.json({
    items: flagged.map((t) => ({
      id: t.id,
      amount: t.amount,
      merchant: t.merchant,
      category: t.category,
      createdAt: t.createdAt.toISOString(),
      reasons: t.anomalyReasons,
      childName: t.wallet.child.name,
      cardLast4: t.wallet.mockCardLast4,
    })),
  });
}
