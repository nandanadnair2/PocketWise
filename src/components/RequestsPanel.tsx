"use client";

import { useCallback, useEffect, useState } from "react";

type RequestView = {
  id: string;
  amount: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
};

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

const STATUS_STYLE: Record<RequestView["status"], { label: string; cls: string }> = {
  PENDING: { label: "Waiting", cls: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Approved 🎉", cls: "bg-green-100 text-green-800" },
  REJECTED: { label: "Not this time", cls: "bg-gray-200 text-gray-700" },
};

export default function RequestsPanel({ onApproved }: { onApproved?: () => void }) {
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/requests");
    if (!res.ok) return;
    const data = await res.json();
    setRequests(data.requests ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const rupeeValue = Number(amount);
    if (!Number.isFinite(rupeeValue) || rupeeValue <= 0) {
      return setMessage({ text: "Enter how much you'd like to ask for.", error: true });
    }
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Math.round(rupeeValue * 100), reason }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return setMessage({ text: data.error ?? "Couldn't send your request.", error: true });
    }
    setAmount("");
    setReason("");
    setMessage({ text: "Request sent! Your parent will take a look.", error: false });
    load();
    onApproved?.();
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Ask for more money</h2>

      <form onSubmit={submit} className="space-y-3 rounded-xl border p-4">
        <label className="block text-sm font-medium">
          How much (₹)?
          <input
            className="mt-1 w-full rounded border p-2"
            type="number"
            min="1"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="50"
          />
        </label>
        <label className="block text-sm font-medium">
          What is it for?
          <input
            className="mt-1 w-full rounded border p-2"
            maxLength={140}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="A new book for school"
          />
        </label>
        <button
          type="submit"
          disabled={busy || reason.trim().length === 0}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send request"}
        </button>
        {message && (
          <p className={`text-sm ${message.error ? "text-red-600" : "text-green-700"}`}>{message.text}</p>
        )}
      </form>

      {requests.length > 0 && (
        <ul className="divide-y rounded-xl border">
          {requests.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 p-3">
              <span className="text-sm">
                <strong>{rupees(r.amount)}</strong> · {r.reason}
              </span>
              <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLE[r.status].cls}`}>
                {STATUS_STYLE[r.status].label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
