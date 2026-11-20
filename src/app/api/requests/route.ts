import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// ASSUMPTION: auth() returns a session with session.user.id and session.user.role.

const MAX_PENDING_PER_CHILD = 3;

const createSchema = z.object({
  amount: z.number().int().positive().max(500_000), // paise, capped at ₹5,000 per request
  reason: z.string().trim().min(1).max(140),
});

async function getUser() {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  return user?.id && user.role ? { id: user.id, role: user.role } : null;
}

/** Child: creates a request. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user || user.role !== "CHILD") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  const wallet = await prisma.wallet.findUnique({ where: { childId: user.id }, select: { id: true } });
  if (!wallet) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const pending = await prisma.allowanceRequest.count({
    where: { childId: user.id, status: "PENDING" },
  });
  if (pending >= MAX_PENDING_PER_CHILD) {
    return NextResponse.json(
      { error: "You already have requests waiting. Ask your parent to check them first." },
      { status: 409 }
    );
  }

  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.allowanceRequest.create({
      data: { childId: user.id, amount: parsed.data.amount, reason: parsed.data.reason },
    });
    await tx.alert.create({
      data: {
        walletId: wallet.id,
        kind: "REQUEST_RECEIVED",
        message: `New allowance request: ₹${(created.amount / 100).toFixed(2)} (${created.reason})`,
      },
    });
    return created;
  });

  return NextResponse.json({ request }, { status: 201 });
}

/** Child: own recent requests. Parent: pending requests from their children. */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (user.role === "CHILD") {
    const requests = await prisma.allowanceRequest.findMany({
      where: { childId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return NextResponse.json({ requests });
  }

  if (user.role === "PARENT") {
    const requests = await prisma.allowanceRequest.findMany({
      where: { status: "PENDING", child: { parentId: user.id } },
      orderBy: { createdAt: "asc" },
      include: { child: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ requests });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
