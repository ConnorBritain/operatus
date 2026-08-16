import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { attachClientDeviceCookie, ensureClientDevice } from "@/lib/client-device";
import { createAdminClient } from "@/lib/supabase/admin";

type Context = { params: Promise<{ nodeId: string }> };

export async function DELETE(request: NextRequest, { params }: Context) {
  const { userId } = await requireUser();
  if (!userId) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const { nodeId } = await params;
  const admin = createAdminClient();
  const device = await ensureClientDevice(request, userId, admin);
  if (!device.ok) return NextResponse.json({ error: device.error }, { status: device.status });

  const { data: node, error: nodeError } = await admin.from("nodes")
    .select("id, workspace_id, revoked_at")
    .eq("id", nodeId)
    .maybeSingle();
  if (nodeError) return NextResponse.json({ error: "CONTROL_PLANE_UNAVAILABLE" }, { status: 503 });
  if (!node) return NextResponse.json({ error: "NODE_NOT_FOUND" }, { status: 404 });

  const { data: membership, error: membershipError } = await admin.from("workspace_memberships")
    .select("role, status")
    .eq("workspace_id", node.workspace_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError) return NextResponse.json({ error: "CONTROL_PLANE_UNAVAILABLE" }, { status: 503 });
  if (!membership || membership.status !== "active" || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (node.revoked_at) {
    return attachClientDeviceCookie(
      NextResponse.json({ revoked: false, alreadyRevoked: true }),
      device.deviceId,
    );
  }

  const { data, error } = await admin.rpc("revoke_operatus_node", {
    target_node_id: nodeId,
    actor_user_id: userId,
    actor_device_id: device.deviceId,
  });
  if (error) return NextResponse.json({ error: "NODE_REVOCATION_FAILED" }, { status: 500 });

  return attachClientDeviceCookie(
    NextResponse.json({ revoked: data, alreadyRevoked: !data }),
    device.deviceId,
  );
}
