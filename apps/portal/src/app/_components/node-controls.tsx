"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NodeControls({
  nodeId,
  runId,
  runVersion,
  canManageAccess,
}: {
  nodeId: string;
  runId?: string;
  runVersion?: number;
  canManageAccess: boolean;
}) {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const router = useRouter();

  async function send(operation: "message_conductor" | "cancel_run") {
    const payload = operation === "message_conductor" ? { message: message.trim() } : {};
    if (operation === "message_conductor" && !message.trim()) return;
    setStatus("Sending…");
    const response = await fetch(`/api/nodes/${nodeId}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation,
        runProjectionId: runId ?? null,
        payload,
        idempotencyKey: crypto.randomUUID(),
        expectedRunVersion: runVersion ?? null,
      }),
    });
    const body = await response.json();
    setStatus(response.ok ? "Queued for the machine" : body.error ?? "Command failed");
    if (response.ok) {
      setMessage("");
      router.refresh();
    }
  }

  async function revokeMachine() {
    if (!confirmRevoke) {
      setConfirmRevoke(true);
      setStatus("Select confirm to disconnect this machine.");
      return;
    }

    setStatus("Disconnecting…");
    const response = await fetch(`/api/nodes/${nodeId}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) {
      setStatus(body.error ?? "Machine access could not be revoked.");
      return;
    }
    setStatus("Machine access revoked");
    router.refresh();
  }

  return (
    <div className="node-controls">
      <div className="message-control">
        <input aria-label="Message the Conductor" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Message the Conductor…" />
        <button className="button tiny" onClick={() => send("message_conductor")}>Send</button>
      </div>
      {runId ? (
        <div className="command-row">
          <button className="text-button danger" onClick={() => send("cancel_run")}>Cancel run</button>
        </div>
      ) : null}
      {canManageAccess ? (
        <div className="command-row">
          <button className="text-button danger" onClick={revokeMachine}>
            {confirmRevoke ? "Confirm disconnect" : "Disconnect machine"}
          </button>
          {confirmRevoke ? (
            <button className="text-button" onClick={() => { setConfirmRevoke(false); setStatus(null); }}>Keep connected</button>
          ) : null}
        </div>
      ) : null}
      {status ? <span className="command-status" role="status">{status}</span> : null}
    </div>
  );
}
