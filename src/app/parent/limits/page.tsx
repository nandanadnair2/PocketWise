"use client";

import { useCallback, useEffect, useState } from "react";

// ASSUMPTIONS: Tailwind is set up, and GET /api/auth/child returns either
// an array of children or { children: [...] }, each with at least { id, name }.

type Child = { id: string; name: string };
type Period = "DAILY" | "WEEKLY" | "MONTHLY";
type Limit = { id: string; period: Period; category: string | null; amount: number };

const CATEGORIES = ["FOOD", "GAMES", "BOOKS", "TRANSPORT", "SHOPPING", "OTHER"];
const PERIODS: Period[] = ["DAILY", "WEEKLY", "MONTHLY"];
const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

export default function ParentLimitsPage() {
  const [children, setChildren] = useState<Child[]>([]);
  const [childId, setChildId] = useState("");
  const [limits, setLimits] = useState<Limit[]>([]);
  const [period, setPeriod] = useState<Period>("DAILY");
  const [category, setCategory] = useState(""); // "" = all spending
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadLimits = useCallback(async (id: string) => {
    if (!id) return setLimits([]);
    const res = await fetch(`/api/limits?childId=${encodeURIComponent(id)}`);
    if (!res.ok) return setMessage({ text: "Could not load limits.", error: true });
    const data = await res.json();
    setLimits(data.limits ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/auth/child");
      if (!res.ok) return setMessage({ text: "Could not load children.", error: true });
      const data = await res.json();
      const list: Child[] = Array.isArray(data) ? data : data.children ?? [];
      setChildren(list);
      if (list.length > 0) setChildId(list[0].id);
    })();
  }, []);

  useEffect(() => {
    loadLimits(childId);
  }, [childId, loadLimits]);

  async function saveLimit(e: React.FormEvent) {
    e.preventDefault();
    const rupeeValue = Number(amount);
    if (!childId || !Number.isFinite(rupeeValue) || rupeeValue <= 0) {
      return setMessage({ text: "Enter an amount greater than 0.", error: true });
    }
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/limits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        childId,
        period,
        category: category || null,
        amount: Math.round(rupeeValue * 100), // rupees -> paise
      }),
    });
    setBusy(false);
    if (!res.ok) return setMessage({ text: "Could not save the limit.", error: true });
    setAmount("");
    setMessage({ text: "Limit saved.", error: false });
    loadLimits(childId);
  }

  async function removeLimit(id: string) {
    if (!confirm("Remove this limit?")) return;
    const res = await fetch(`/api/limits?limitId=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) return setMessage({ text: "Could not remove the limit.", error: true });
    loadLimits(childId);
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Spending limits</h1>

      {children.length === 0 ? (
        <p className="text-sm text-gray-600">Add a child first to set limits.</p>
      ) : (
        <>
          <label className="block text-sm font-medium">
            Child
            <select
              className="mt-1 w-full rounded border p-2"
              value={childId}
              onChange={(e) => setChildId(e.target.value)}
            >
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <form onSubmit={saveLimit} className="grid grid-cols-1 gap-3 rounded border p-4 sm:grid-cols-4">
            <label className="text-sm font-medium">
              Period
              <select
                className="mt-1 w-full rounded border p-2"
                value={period}
                onChange={(e) => setPeriod(e.target.value as Period)}
              >
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {p.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Category
              <select
                className="mt-1 w-full rounded border p-2"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All spending</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.toLowerCase()}
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
                placeholder="100"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="self-end rounded bg-black px-4 py-2 text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Set limit"}
            </button>
          </form>

          {message && (
            <p className={`text-sm ${message.error ? "text-red-600" : "text-green-700"}`}>{message.text}</p>
          )}

          <ul className="divide-y rounded border">
            {limits.length === 0 && <li className="p-4 text-sm text-gray-600">No limits set yet.</li>}
            {limits.map((l) => (
              <li key={l.id} className="flex items-center justify-between p-4">
                <span>
                  <strong>{rupees(l.amount)}</strong> {l.period.toLowerCase()}
                  {l.category ? ` · ${l.category.toLowerCase()}` : " · all spending"}
                </span>
                <button onClick={() => removeLimit(l.id)} className="text-sm text-red-600 hover:underline">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
