"use client";

import { useState } from "react";

type GoalOption = { id: string; title: string; target: number; saved: number; completed: boolean };

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

export default function GoalsPanel({
  goals,
  onChange,
}: {
  goals: GoalOption[];
  onChange?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [goalId, setGoalId] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const openGoals = goals.filter((g) => !g.completed);
  const selectedId = goalId || openGoals[0]?.id || "";

  async function createGoal(e: React.FormEvent) {
    e.preventDefault();
    const rupeeValue = Number(target);
    if (!title.trim() || !Number.isFinite(rupeeValue) || rupeeValue <= 0) {
      return setMessage({ text: "Give your goal a name and a target amount.", error: true });
    }
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), target: Math.round(rupeeValue * 100) }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMessage({ text: data?.error ?? "Couldn't create the goal.", error: true });
    setTitle("");
    setTarget("");
    setMessage({ text: "Goal created!", error: false });
    onChange?.();
  }

  async function deposit(e: React.FormEvent) {
    e.preventDefault();
    const rupeeValue = Number(amount);
    if (!selectedId || !Number.isFinite(rupeeValue) || rupeeValue <= 0) {
      return setMessage({ text: "Pick a goal and enter an amount.", error: true });
    }
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/goals/${encodeURIComponent(selectedId)}/deposit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Math.round(rupeeValue * 100), idempotencyKey: crypto.randomUUID() }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setAmount("");
      setMessage({ text: data?.goal?.completed ? "Goal complete! 🎉" : "Saved!", error: false });
    } else if (res.status === 402) {
      setMessage({ text: "You don't have enough money in your wallet for that.", error: true });
    } else if (res.status === 422 && typeof data?.remainingToTarget === "number") {
      setMessage({ text: `This goal only needs ${rupees(data.remainingToTarget)} more.`, error: true });
    } else {
      setMessage({ text: data?.error ?? "Something went wrong. Please try again.", error: true });
    }
    onChange?.();
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Save up for something</h2>

      <form onSubmit={createGoal} className="grid grid-cols-1 gap-3 rounded-xl border p-4 sm:grid-cols-3">
        <label className="text-sm font-medium sm:col-span-1">
          Goal
          <input
            className="mt-1 w-full rounded border p-2"
            value={title}
            maxLength={60}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New bicycle"
          />
        </label>
        <label className="text-sm font-medium">
          Target (₹)
          <input
            className="mt-1 w-full rounded border p-2"
            type="number"
            min="1"
            step="0.01"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="500"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="self-end rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Create goal
        </button>
      </form>

      {openGoals.length > 0 && (
        <form onSubmit={deposit} className="grid grid-cols-1 gap-3 rounded-xl border p-4 sm:grid-cols-3">
          <label className="text-sm font-medium">
            Add to
            <select
              className="mt-1 w-full rounded border p-2"
              value={selectedId}
              onChange={(e) => setGoalId(e.target.value)}
            >
              {openGoals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title} ({rupees(g.saved)} / {rupees(g.target)})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Amount (₹)
            <input
              className="mt-1 w-full rounded border p-2"
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="20"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="self-end rounded-lg bg-green-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            Save it
          </button>
        </form>
      )}

      {message && (
        <p className={`text-sm ${message.error ? "text-red-600" : "text-green-700"}`}>{message.text}</p>
      )}
    </section>
  );
}
