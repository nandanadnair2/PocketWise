# PocketWise 🪙

A parent-controlled virtual card and wallet for kids — a money-learning app with a mock ledger.

> ⚠️ **MOCK LEDGER ONLY.** No real money moves. No real card numbers are used. No real children's data is collected. All transactions are simulated for learning and demo purposes.

## What it does

- **Parents** create child accounts, set spending limits (daily/weekly/per-category), approve allowance requests, and monitor activity.
- **Kids** get a playful wallet UI with savings goals, badges, progress bars, and small money lessons.
- A **limit engine** with hard stops prevents overspending — enforced safely with database row-level locking.
- **Fraud/anomaly detection** flags unusual transactions (Week 4).
- A **guarded AI savings coach** gives age-appropriate education only (Week 5).

## Tech stack

- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind CSS
- **Database:** PostgreSQL (hosted from day one) + Prisma ORM
- **Auth:** NextAuth.js with parent/child roles (bcrypt-hashed passwords)
- **Fraud/AI services:** FastAPI + scikit-learn + local Llama 3 via Ollama (Weeks 4–5)

## Key design decisions

| Decision | Why |
|---|---|
| Money stored as integer **paise** | No float rounding errors |
| `idempotencyKey` on every transaction | Retried requests can't double-charge |
| `SELECT ... FOR UPDATE` row locking | Two simultaneous purchases can't overspend the limit |
| Declined/flagged transactions are recorded | Fraud model and parent dashboard have full data |
| AuditLog for all parent actions | Privacy-by-design and accountability |
| Passwords/PINs stored as hashes only | Never store raw credentials |

## Getting started (Week 1)

```bash
# 1. Install dependencies
npm install

# 2. Set up your database
# Edit .env and set DATABASE_URL to your Postgres connection string
# (e.g. Neon, Supabase, or local Postgres)

# 3. Run migrations
npx prisma migrate dev --name init

# 4. Add the balance constraint (run in your DB):
#    ALTER TABLE "Wallet" ADD CONSTRAINT balance_non_negative CHECK (balance >= 0);

# 5. Start the dev server
npm run dev
```

## Project structure

```
src/
  app/
    api/
      auth/[...nextauth]/   # NextAuth handler
      auth/register/        # Parent registration
      auth/child/           # Create/list child accounts
      wallet/               # Wallet balance + details
      transactions/         # Ledger: create/list transactions
    login/                  # Login page
    register/               # Parent signup page
    dashboard/              # Role-based dashboard
    parent/children/        # Parent: manage kids
  lib/prisma.ts             # Prisma client singleton
  auth.ts                   # NextAuth config
prisma/schema.prisma        # Data model
```

## Week-by-week plan

- **Week 1:** ✅ Data model, auth (parent/child roles), basic ledger with concurrency-safe spending
- **Week 2:** Limit engine with alerts (50/80/95%) and hard stop + parent dashboard
- **Week 3:** Kid UI (goals, badges, lessons) + allowance-request flow
- **Week 4:** Fraud/anomaly detection on simulated transactions + evaluation metrics
- **Week 5:** Guarded AI coach + jailbreak testing + deploy + demo video

## Known limitations

- **No login rate limiting yet.** Kid login is name + PIN (4–6 digits), so a guessed name plus a brute-forced PIN is possible in theory. Planned: login attempt limits and lockout.
- Child names must be unique across all families (case-insensitive), because name + PIN is the login.
- Mock ledger only: no real money, no real card numbers, no real children's data.
