import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { attachClientDeviceCookie, ensureClientDevice } from "@/lib/client-device";
import { createAdminClient } from "@/lib/supabase/admin";
import { commandRequestSchema } from "@/lib/protocol";

type Context = { params: Promise<{ nodeId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  const { userId } = await requireUser();
  if (!userId) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const { nodeId } = await params;
  const parsed = commandRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

  const admin = createAdminClient();
  const device = await ensureClientDevice(request, userId, admin);
  if (!device.ok) return NextResponse.json({ error: device.error }, { status: device.status });
  const { data: node, error: nodeError } = await admin.from("nodes").select("id, workspace_id, revoked_at")
    .eq("id", nodeId).maybeSingle();
  if (nodeError) return NextResponse.json({ error: "CONTROL_PLANE_UNAVAILABLE" }, { status: 503 });
  if (!node || node.revoked_at) return NextResponse.json({ error: "NODE_NOT_FOUND" }, { status: 404 });

  const { data: membership, error: membershipError } = await admin.from("workspace_memberships").select("role, status")
    .eq("workspace_id", node.workspace_id).eq("user_id", userId).maybeSingle();
  if (membershipError) return NextResponse.json({ error: "CONTROL_PLANE_UNAVAILABLE" }, { status: 503 });
  if (!membership || membership.status !== "active" || !["owner", "admin", "operator"].includes(membership.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (parsed.data.runProjectionId) {
    const { data: run, error: runError } = await admin.from("run_projections").select("id")
      .eq("id", parsed.data.runProjectionId).eq("node_id", nodeId).maybeSingle();
    if (runError) return NextResponse.json({ error: "CONTROL_PLANE_UNAVAILABLE" }, { status: 503 });
    if (!run) return NextResponse.json({ error: "RUN_NOT_FOUND" }, { status: 404 });
  }

  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const { data, error } = await admin.from("commands").insert({
    workspace_id: node.workspace_id,
    node_id: nodeId,
    run_projection_id: parsed.data.runProjectionId ?? null,
    issued_by: userId,
    issued_from_device_id: device.deviceId,
    operation: parsed.data.operation,
    payload: parsed.data.payload,
    idempotency_key: parsed.data.idempotencyKey,
    expected_run_version: parsed.data.expectedRunVersion ?? null,
    expires_at: expiresAt,
  }).select("id, status, created_at").single();

  if (error?.code === "23505") return NextResponse.json({ error: "DUPLICATE_COMMAND" }, { status: 409 });
  if (error || !data) return NextResponse.json({ error: "COMMAND_CREATE_FAILED" }, { status: 500 });

  await admin.from("audit_events").insert({
    workspace_id: node.workspace_id,
    actor_kind: "device",
    actor_user_id: userId,
    actor_device_id: device.deviceId,
    actor_node_id: null,
    action: `command.${parsed.data.operation}.queued`,
    resource_kind: "command",
    resource_id: data.id,
    metadata: { node_id: nodeId, run_projection_id: parsed.data.runProjectionId ?? null },
  });

  return attachClientDeviceCookie(
    NextResponse.json({ ...data, expiresAt }, { status: 201 }),
    device.deviceId,
  );
}
