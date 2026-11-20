import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadSpent } from "@/lib/limits";

// ASSUMPTION: auth() returns a session with session.user.id and session.user.role.

export async function GET() {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "CHILD") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const wallet = await prisma.wallet.findUnique({
    where: { childId: user.id },
    include: { limits: true, goals: { orderBy: { createdAt: "desc" } } },
  });
  if (!wallet) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Same spending logic the limit engine uses, so the bars always match what gets blocked.
  const spent = await loadSpent(prisma, wallet.id, wallet.limits);

  const limits = wallet.limits.map((l) => {
    const used = spent[l.id] ?? 0;
    return {
      id: l.id,
      period: l.period,
      category: l.category,
      amount: l.amount,
      used,
      remaining: Math.max(l.amount - used, 0),
      ratio: Math.min(used / l.amount, 1),
    };
  });

  const unreadAlerts = await prisma.alert.count({ where: { walletId: wallet.id, read: false } });

  return NextResponse.json({
    balance: wallet.balance,
    frozen: wallet.frozen,
    mockCardLast4: wallet.mockCardLast4,
    limits,
    goals: wallet.goals.map((g) => ({
      id: g.id,
      title: g.title,
      target: g.target,
      saved: g.saved,
      completed: g.completed,
    })),
    unreadAlerts,
  });
}
