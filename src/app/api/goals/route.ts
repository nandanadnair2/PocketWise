import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Child-only goal creation. Max 10 active (non-completed) goals per child.
const createGoalSchema = z.object({
  title: z.string().min(1).max(60),
  target: z.number().int().positive().max(100_000_000), // paise, capped at ₹10,00,000
});

const MAX_ACTIVE_GOALS = 10;

export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "CHILD") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = createGoalSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const { title, target } = parsed.data;

  const wallet = await prisma.wallet.findUnique({
    where: { childId: user.id },
    select: { id: true },
  });
  if (!wallet) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const activeCount = await prisma.savingsGoal.count({
    where: { walletId: wallet.id, completed: false },
  });
  if (activeCount >= MAX_ACTIVE_GOALS) {
    return NextResponse.json(
      { error: `You can have at most ${MAX_ACTIVE_GOALS} active goals. Complete or remove one first.` },
      { status: 409 }
    );
  }

  const goal = await prisma.savingsGoal.create({
    data: { walletId: wallet.id, title, target },
  });
  return NextResponse.json({ goal }, { status: 201 });
}
