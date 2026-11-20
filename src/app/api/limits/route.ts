import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// ASSUMPTIONS (adjust to match your Week 1 code):
//  - `auth()` from "@/auth" returns a session with session.user.id and session.user.role
//  - the Prisma client is exported as `prisma` from "@/lib/prisma"

const CATEGORIES = ["FOOD", "GAMES", "BOOKS", "TRANSPORT", "SHOPPING", "OTHER"] as const;

const setLimitSchema = z.object({
  childId: z.string().min(1),
  period: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  category: z.enum(CATEGORIES).nullable().default(null),
  amount: z.number().int().positive().max(10_000_000), // paise, capped at ₹1,00,000
});

async function requireParent() {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "PARENT") return null;
  return user.id;
}

/** A parent may only touch limits of their own children. */
async function getOwnedChildWallet(parentId: string, childId: string) {
  const child = await prisma.user.findFirst({
    where: { id: childId, parentId, role: "CHILD" },
    include: { wallet: true },
  });
  return child?.wallet ?? null;
}

export async function GET(req: Request) {
  const parentId = await requireParent();
  if (!parentId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const childId = new URL(req.url).searchParams.get("childId");
  if (!childId) return NextResponse.json({ error: "childId required" }, { status: 400 });

  const wallet = await getOwnedChildWallet(parentId, childId);
  if (!wallet) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const limits = await prisma.limit.findMany({
    where: { walletId: wallet.id },
    orderBy: [{ period: "asc" }, { category: "asc" }],
  });
  return NextResponse.json({ limits });
}

export async function POST(req: Request) {
  const parentId = await requireParent();
  if (!parentId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = setLimitSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const { childId, period, category, amount } = parsed.data;

  const wallet = await getOwnedChildWallet(parentId, childId);
  if (!wallet) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Prisma's upsert can't match a compound unique key containing NULL, so find-then-write.
  const { limit, created } = await prisma.$transaction(async (tx) => {
    const existing = await tx.limit.findFirst({
      where: { walletId: wallet.id, period, category },
    });
    const saved = existing
      ? await tx.limit.update({ where: { id: existing.id }, data: { amount } })
      : await tx.limit.create({ data: { walletId: wallet.id, period, category, amount } });

    await tx.auditLog.create({
      data: {
        actorId: parentId,
        action: existing ? "LIMIT_UPDATED" : "LIMIT_CREATED",
        detail: { childId, period, category, amount, previous: existing?.amount ?? null },
      },
    });
    return { limit: saved, created: !existing };
  });

  return NextResponse.json({ limit }, { status: created ? 201 : 200 });
}

export async function DELETE(req: Request) {
  const parentId = await requireParent();
  if (!parentId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const limitId = new URL(req.url).searchParams.get("limitId");
  if (!limitId) return NextResponse.json({ error: "limitId required" }, { status: 400 });

  const limit = await prisma.limit.findUnique({
    where: { id: limitId },
    include: { wallet: { include: { child: true } } },
  });
  if (!limit || limit.wallet.child.parentId !== parentId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.limit.delete({ where: { id: limitId } }),
    prisma.auditLog.create({
      data: {
        actorId: parentId,
        action: "LIMIT_DELETED",
        detail: { childId: limit.wallet.childId, period: limit.period, category: limit.category, amount: limit.amount },
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
