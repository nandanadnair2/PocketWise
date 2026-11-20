"use client";

import { useCallback, useEffect, useState } from "react";

type PendingView = {
  id: string;
  amount: number;
  reason: string;
  createdAt: string;
  child: { id: string; name: string };
};

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

export default function PendingRequests() {
  const [requests, setRequests] = useState<PendingView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/requests");
    if (res.ok) {
      const data = await res.json();
      setRequests(data.requests ?? []);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: string, decision: "APPROVE" | "REJECT") {
    setBusyId(id);
    setMessage(null);
    const res = await fetch(`/api/requests/${encodeURIComponent(id)}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    setBusyId(null);
    if (res.status === 409) {
      setMessage({ text: "That request was already decided.", error: true });
    } else if (!res.ok) {
      setMessage({ text: "Something went wrong. Please try again.", error: true });
    } else {
      setMessage({ text: decision === "APPROVE" ? "Approved and added to the wallet." : "Request declined.", error: false });
    }
    load();
  }

  if (!loaded) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">
        Allowance requests {requests.length > 0 && <span className="text-sm text-gray-500">({requests.length})</span>}
      </h2>

      {message && (
        <p className={`text-sm ${message.error ? "text-red-600" : "text-green-700"}`}>{message.text}</p>
      )}

      {requests.length === 0 ? (
        <p className="text-sm text-gray-600">No requests waiting.</p>
      ) : (
        <ul className="divide-y rounded border">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <span className="text-sm">
                <strong>{r.child.name}</strong> asks for <strong>{rupees(r.amount)}</strong>
                <span className="block text-gray-600">{r.reason}</span>
              </span>
              <span className="flex gap-2">
                <button
                  onClick={() => decide(r.id, "APPROVE")}
                  disabled={busyId === r.id}
                  className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => decide(r.id, "REJECT")}
                  disabled={busyId === r.id}
                  className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                >
                  Decline
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
