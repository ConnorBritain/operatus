import { createHmac, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env";

export function normalizePairingCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function newPairingCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(12);
  const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

export function newNodeToken() {
  return `atn_${randomBytes(32).toString("base64url")}`;
}

export function secretHash(value: string) {
  const { tokenPepper } = getServerEnv();
  return createHmac("sha256", tokenPepper).update(value).digest("hex");
}

export async function authenticateNode(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer atn_")) return null;

  const token = authorization.slice("Bearer ".length);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("nodes")
    .select("id, workspace_id, branch_id, status, revoked_at")
    .eq("token_hash", secretHash(token))
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) return null;
  return { admin, tokenHash: secretHash(token), node: data };
}
