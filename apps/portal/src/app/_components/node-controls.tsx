"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NodeControls({ nodeId, runId, runVersion }: { nodeId: string; runId?: string; runVersion?: number }) {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<string | null>(null);
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
      {status ? <span className="command-status" role="status">{status}</span> : null}
    </div>
  );
}
