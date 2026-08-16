"use client";

import { useState } from "react";

export function PairingPanel({ workspaceId, branchId }: { workspaceId: string; branchId: string }) {
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createInvitation() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/pairing/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, branchId }),
    });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? "Pairing could not start.");
    else setPairing(body);
    setBusy(false);
  }

  if (pairing) {
    return (
      <div className="pairing-ticket" role="status">
        <span className="eyebrow">One-time machine code</span>
        <strong>{pairing.code}</strong>
        <p>Enter this in Atelier on the machine. It expires at {new Date(pairing.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p>
        <button className="text-button" onClick={() => setPairing(null)}>Done</button>
      </div>
    );
  }

  return (
    <div className="pair-action">
      <button className="button secondary" disabled={busy} onClick={createInvitation}>Pair a machine</button>
      {error ? <span className="inline-error">{error}</span> : null}
    </div>
  );
}
