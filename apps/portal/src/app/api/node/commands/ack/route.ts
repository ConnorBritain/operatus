import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateNode } from "@/lib/node-auth";
import { commandAcknowledgmentSchema } from "@/lib/protocol";

export async function POST(request: NextRequest) {
  const identity = await authenticateNode(request);
  if (!identity) return NextResponse.json({ error: "NODE_UNAUTHENTICATED" }, { status: 401 });

  const parsed = commandAcknowledgmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

  const now = new Date().toISOString();
  const { data, error } = await identity.admin.from("commands").update({
    status: parsed.data.status,
    acknowledged_at: now,
    acknowledgment: parsed.data.acknowledgment,
  }).eq("id", parsed.data.commandId).eq("node_id", identity.node.id)
    .eq("status", "delivered").select("id, workspace_id").maybeSingle();

  if (error) return NextResponse.json({ error: "ACKNOWLEDGMENT_FAILED" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "COMMAND_INVALID_OR_STALE" }, { status: 409 });

  await identity.admin.from("audit_events").insert({
    workspace_id: data.workspace_id,
    actor_kind: "node",
    actor_user_id: null,
    actor_device_id: null,
    actor_node_id: identity.node.id,
    action: `command.${parsed.data.status}`,
    resource_kind: "command",
    resource_id: data.id,
    metadata: {},
  });

  return NextResponse.json({ acknowledgedAt: now });
}
