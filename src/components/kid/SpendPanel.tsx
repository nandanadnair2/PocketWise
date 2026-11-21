"use client";

import { useState } from "react";

// Demo-only purchase simulator: there is no real money or card network behind it.
// ASSUMPTION: POST /api/transactions accepts { type, amount, category, merchant, idempotencyKey }
// (the same body the concurrency tests send) and returns HTTP 402 when blocked.

const CATEGORIES = ["FOOD", "GAMES", "BOOKS", "TRANSPORT", "SHOPPING", "OTHER"];
const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

export default function SpendPanel({ onDone }: { onDone?: () => void }) {
  const [category, setCategory] = useState("FOOD");
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    const rupeeValue = Number(amount);
    if (!Number.isFinite(rupeeValue) || rupeeValue <= 0) {
      return setMessage({ text: "Enter an amount greater than 0.", error: true });
    }
    setBusy(true);
    setMessage(null);

    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "PURCHASE",
        amount: Math.round(rupeeValue * 100),
        category,
        merchant: merchant.trim() || "Demo shop",
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    setBusy(false);

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setAmount("");
      setMerchant("");
      setMessage({ text: "Payment went through.", error: false });
    } else if (res.status === 402) {
      const left = data?.blockedBy?.remaining;
      setMessage({
        text:
          typeof left === "number"
            ? `Blocked: that's over your limit. You have ${rupees(left)} left in that limit.`
            : data?.error ?? "Blocked: that's over a limit or more than your balance.",
        error: true,
      });
    } else {
      setMessage({ text: data?.error ?? "Something went wrong. Please try again.", error: true });
    }
    onDone?.();
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Try a purchase</h2>
      <p className="text-xs text-gray-500">Demo only: this uses pretend money.</p>
      <form onSubmit={pay} className="grid grid-cols-1 gap-3 rounded-xl border p-4 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Category
          <select
            className="mt-1 w-full rounded border p-2"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Shop (optional)
          <input
            className="mt-1 w-full rounded border p-2"
            value={merchant}
            maxLength={60}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="School canteen"
          />
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
          className="self-end rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Paying…" : "Pay"}
        </button>
      </form>
      {message && (
        <p className={`text-sm ${message.error ? "text-red-600" : "text-green-700"}`}>{message.text}</p>
      )}
    </section>
  );
}
