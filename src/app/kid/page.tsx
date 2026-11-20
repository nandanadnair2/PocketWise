"use client";

import { useCallback, useEffect, useState } from "react";
import RequestsPanel from "@/components/RequestsPanel";

// ASSUMPTION: Tailwind is set up and the child signs in through your existing login.

type LimitView = {
  id: string;
  period: "DAILY" | "WEEKLY" | "MONTHLY";
  category: string | null;
  amount: number;
  used: number;
  remaining: number;
  ratio: number;
};
type GoalView = { id: string; title: string; target: number; saved: number; completed: boolean };
type Summary = {
  balance: number;
  frozen: boolean;
  mockCardLast4: string;
  limits: LimitView[];
  goals: GoalView[];
  unreadAlerts: number;
};

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

function barColor(ratio: number) {
  if (ratio >= 0.95) return "bg-red-500";
  if (ratio >= 0.8) return "bg-amber-400";
  return "bg-green-500";
}

function limitMessage(l: LimitView) {
  const what = l.category ? `${l.category.toLowerCase()} money` : "spending money";
  const when = l.period === "DAILY" ? "today" : l.period === "WEEKLY" ? "this week" : "this month";
  if (l.remaining === 0) return `You've used all your ${what} ${when}. Ask a parent if you need more!`;
  if (l.ratio >= 0.8) return `Careful, only ${rupees(l.remaining)} of ${what} left ${when}.`;
  return `You have ${rupees(l.remaining)} of ${what} left ${when}.`;
}

export default function KidDashboard() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/wallet/summary");
    if (!res.ok) return setError("Couldn't load your wallet. Please try again.");
    setData(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <main className="p-6 text-red-600">{error}</main>;
  if (!data) return <main className="p-6">Loading…</main>;

  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <section className="rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 p-6 text-white shadow">
        <p className="text-sm opacity-80">My wallet</p>
        <p className="mt-1 text-4xl font-bold">{rupees(data.balance)}</p>
        <p className="mt-4 text-sm opacity-80">Card •••• {data.mockCardLast4}</p>
        {data.frozen && (
          <p className="mt-3 rounded bg-white/20 p-2 text-sm">
            Your card is paused right now. Ask a parent to turn it back on.
          </p>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">My spending limits</h2>
        {data.limits.length === 0 && (
          <p className="text-sm text-gray-600">No limits set yet.</p>
        )}
        {data.limits.map((l) => (
          <div key={l.id} className="space-y-1">
            <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full rounded-full transition-all ${barColor(l.ratio)}`}
                style={{ width: `${Math.round(l.ratio * 100)}%` }}
                role="progressbar"
                aria-valuenow={Math.round(l.ratio * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
            <p className="text-sm text-gray-700">{limitMessage(l)}</p>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">My savings goals</h2>
        {data.goals.length === 0 && (
          <p className="text-sm text-gray-600">Create a goal to start saving up for something!</p>
        )}
        {data.goals.map((g) => {
          const pct = Math.min(Math.round((g.saved / g.target) * 100), 100);
          return (
            <div key={g.id} className="space-y-1 rounded-xl border p-3">
              <div className="flex justify-between text-sm font-medium">
                <span>{g.completed ? "🎉 " : ""}{g.title}</span>
                <span>
                  {rupees(g.saved)} / {rupees(g.target)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </section>

      <RequestsPanel onApproved={load} />
    </main>
  );
}
