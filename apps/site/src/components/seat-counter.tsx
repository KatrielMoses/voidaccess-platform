"use client";

import { useEffect, useState } from "react";

interface Seats {
  available: number;
  total: number;
  source: string;
}

/** Server-rendered with the static value, then refreshed from /api/founding/seats. */
export function SeatCounter({ initial, label, of, loading }: { initial: Seats; label: string; of: string; loading: string }) {
  const [seats, setSeats] = useState<Seats>(initial);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/founding/seats")
      .then((r) => (r.ok ? (r.json() as Promise<Seats>) : null))
      .then((s) => {
        if (s && !cancelled) setSeats(s);
      })
      .catch(() => {})
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <p className="font-mono" aria-live="polite" data-testid="seat-counter" data-source={seats.source}>
      <span className="text-4xl font-bold text-fg">{seats.available}</span>{" "}
      <span className="text-fg-secondary">
        {of} {seats.total} {label}
      </span>
      {!ready && <span className="sr-only"> ({loading})</span>}
    </p>
  );
}
