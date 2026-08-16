import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { attachClientDeviceCookie, ensureClientDevice } from "@/lib/client-device";
import { createAdminClient } from "@/lib/supabase/admin";
import { invitationRequestSchema } from "@/lib/protocol";
import { newPairingCode, normalizePairingCode, secretHash } from "@/lib/node-auth";

export async function POST(request: NextRequest) {
  const { userId } = await requireUser();
  if (!userId) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const parsed = invitationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

  const admin = createAdminClient();
  const device = await ensureClientDevice(request, userId, admin);
  if (!device.ok) return NextResponse.json({ error: device.error }, { status: device.status });
  const [{ data: membership, error: membershipError }, { data: branch, error: branchError }] = await Promise.all([
    admin.from("workspace_memberships").select("role, status")
      .eq("workspace_id", parsed.data.workspaceId).eq("user_id", userId).maybeSingle(),
    admin.from("branches").select("id")
      .eq("id", parsed.data.branchId).eq("workspace_id", parsed.data.workspaceId).maybeSingle(),
  ]);

  if (membershipError || branchError) {
    return NextResponse.json({ error: "CONTROL_PLANE_UNAVAILABLE" }, { status: 503 });
  }

  if (!membership || membership.status !== "active" || !["owner", "admin", "operator"].includes(membership.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (!branch) return NextResponse.json({ error: "BRANCH_NOT_FOUND" }, { status: 404 });

  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin.from("pairing_invitations").select("id", { count: "exact", head: true })
    .eq("created_by", userId).gte("created_at", oneMinuteAgo);
  if ((count ?? 0) >= 5) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });

  const code = newPairingCode();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const { data, error } = await admin.from("pairing_invitations").insert({
    workspace_id: parsed.data.workspaceId,
    branch_id: parsed.data.branchId,
    created_by: userId,
    code_hash: secretHash(normalizePairingCode(code)),
    expires_at: expiresAt,
  }).select("id").single();

  if (error || !data) return NextResponse.json({ error: "PAIRING_CREATE_FAILED" }, { status: 500 });

  await admin.from("audit_events").insert({
    workspace_id: parsed.data.workspaceId,
    actor_kind: "device",
    actor_user_id: userId,
    actor_device_id: device.deviceId,
    actor_node_id: null,
    action: "pairing.invitation_created",
    resource_kind: "pairing_invitation",
    resource_id: data.id,
    metadata: { branch_id: parsed.data.branchId, expires_at: expiresAt },
  });

  return attachClientDeviceCookie(
    NextResponse.json({ code, expiresAt }, { status: 201 }),
    device.deviceId,
  );
}
