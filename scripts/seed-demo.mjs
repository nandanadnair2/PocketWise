// Demo seed: creates a demo parent + child with a starting balance.
// Safe to re-run: updates the existing demo child instead of duplicating.
// Run: node scripts/seed-demo.mjs   (uses DATABASE_URL from .env)
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@pocketwise.local";
const DEMO_PASSWORD = "demo1234";
const DEMO_CHILD_NAME = "Demo Kid";
const DEMO_CHILD_PIN = "1234";
const STARTING_BALANCE_PAISE = 50000; // ₹500.00

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const pinHash = await bcrypt.hash(DEMO_CHILD_PIN, 12);

  const parent = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash },
    create: { name: "Demo Parent", email: DEMO_EMAIL, passwordHash, role: "PARENT" },
  });

  let child = await prisma.user.findFirst({
    where: { parentId: parent.id, role: "CHILD", name: DEMO_CHILD_NAME },
  });
  if (child) {
    child = await prisma.user.update({
      where: { id: child.id },
      data: { pinHash },
    });
  } else {
    child = await prisma.user.create({
      data: {
        name: DEMO_CHILD_NAME,
        role: "CHILD",
        pinHash,
        parentId: parent.id,
        wallet: {
          create: {
            balance: STARTING_BALANCE_PAISE,
            mockCardLast4: "4242",
          },
        },
      },
    });
  }

  const wallet = await prisma.wallet.findUnique({ where: { childId: child.id } });
  if (wallet && wallet.balance === 0) {
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balance: STARTING_BALANCE_PAISE },
    });
  }

  // A sample daily limit so the demo shows progress bars
  if (wallet) {
    const existing = await prisma.limit.findFirst({
      where: { walletId: wallet.id, period: "DAILY", category: null },
    });
    if (!existing) {
      await prisma.limit.create({
        data: { walletId: wallet.id, period: "DAILY", category: null, amount: 20000 }, // ₹200/day
      });
    }
  }

  console.log("Demo seed ready:");
  console.log(`  Parent login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Kid login:    name "${DEMO_CHILD_NAME}" / PIN ${DEMO_CHILD_PIN}`);
  console.log(`  Starting balance: ₹${STARTING_BALANCE_PAISE / 100}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
