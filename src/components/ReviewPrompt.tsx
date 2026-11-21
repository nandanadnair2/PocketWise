"use client";

import { useCallback, useEffect, useState } from "react";
import Money from "@/components/Money";

// ASSUMPTION: Tailwind is set up. Modal layout follows the "Was this you?" reference:
// big amount, "just now at <shop>", the card used, then a pink "No" and a grey "Yes" button.

type ReviewItem = {
  id: string;
  amount: number;
  merchant: string | null;
  category: string;
  createdAt: string;
  reasons: string[];
  childName: string;
  cardLast4: string;
};

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function ReviewPrompt() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/review");
    if (!res.ok) return;
    const data = await res.json();
    setItems(data.items ?? []);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000); // check for new unusual purchases every 30 seconds
    return () => clearInterval(timer);
  }, [load]);

  const current = items[0];
  if (!current) return null;

  async function decide(decision: "CONFIRM" | "DENY") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/review/${encodeURIComponent(current.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    setBusy(false);
    // 409 means it was already decided elsewhere (another tab); either way, refresh the list.
    if (!res.ok && res.status !== 409) {
      return setError("Something went wrong. Please try again.");
    }
    load();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-title"
    >
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <div className="flex items-baseline justify-between">
          <h2 id="review-title" className="text-xl font-semibold text-gray-900">
            Was this okay?
          </h2>
          {items.length > 1 && <span className="text-sm text-gray-500">1 of {items.length}</span>}
        </div>

        <div className="mt-4 rounded-2xl border p-4">
          <Money paise={current.amount} className="text-4xl font-semibold text-gray-900" />
          <p className="mt-1 text-sm text-gray-600">
            {timeAgo(current.createdAt)} at {current.merchant ?? "a shop"}
          </p>
          <div className="mt-4 flex items-center gap-3 border-t pt-4">
            <div className="h-9 w-12 rounded-md bg-gradient-to-br from-indigo-900 to-indigo-500" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-gray-900">{current.childName}&rsquo;s card</p>
              <p className="font-mono text-xs text-gray-500">••{current.cardLast4}</p>
            </div>
          </div>
        </div>

        {current.reasons.length > 0 && (
          <div className="mt-4 text-sm text-gray-700">
            <p className="font-medium">Why we asked</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-gray-600">
              {current.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => decide("DENY")}
            disabled={busy}
            className="rounded-full bg-pink-50 px-4 py-3 font-semibold text-pink-800 transition hover:bg-pink-100 disabled:opacity-50"
          >
            No, undo it
          </button>
          <button
            type="button"
            onClick={() => decide("CONFIRM")}
            disabled={busy}
            className="rounded-full bg-gray-100 px-4 py-3 font-semibold text-gray-900 transition hover:bg-gray-200 disabled:opacity-50"
          >
            Yes, that&rsquo;s fine
          </button>
        </div>
        <p className="mt-3 text-center text-xs text-gray-500">
          &ldquo;No&rdquo; puts the money back in {current.childName}&rsquo;s wallet.
        </p>
      </div>
    </div>
  );
}
