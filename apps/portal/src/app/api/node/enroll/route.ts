import { NextResponse } from "next/server";
import { enrollmentSchema } from "@/lib/protocol";
import { createAdminClient } from "@/lib/supabase/admin";
import { newNodeToken, normalizePairingCode, secretHash } from "@/lib/node-auth";

export async function POST(request: Request) {
  const parsed = enrollmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

  const nodeToken = newNodeToken();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("enroll_atelier_node", {
    invitation_code_hash: secretHash(normalizePairingCode(parsed.data.code)),
    node_token_hash: secretHash(nodeToken),
    node_name: parsed.data.name,
    node_hostname: parsed.data.hostname,
    node_platform: parsed.data.platform,
    node_architecture: parsed.data.architecture,
    node_app_version: parsed.data.appVersion,
    node_capabilities: parsed.data.capabilities,
    node_public_key: parsed.data.publicKey ?? null,
  });

  if (error || !data) {
    const invalid = error?.message.includes("PAIRING_INVITATION_INVALID_OR_EXPIRED");
    return NextResponse.json({ error: invalid ? "PAIRING_INVALID_OR_EXPIRED" : "ENROLLMENT_FAILED" }, { status: invalid ? 410 : 500 });
  }

  return NextResponse.json({ nodeId: data, nodeToken }, { status: 201 });
}
