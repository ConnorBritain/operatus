import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const CLIENT_DEVICE_COOKIE = "atelier_client_device";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ACTIVE_DEVICES = 50;

type AdminClient = ReturnType<typeof createAdminClient>;

export type ClientDeviceResolution =
  | { ok: true; deviceId: string; label: string }
  | { ok: false; error: "CONTROL_PLANE_UNAVAILABLE" | "DEVICE_REVOKED" | "DEVICE_LIMIT_REACHED"; status: 403 | 429 | 503 };

export function describeClientDevice(headers: Headers) {
  const userAgent = headers.get("user-agent") ?? "";
  const hintedPlatform = (headers.get("sec-ch-ua-platform") ?? "").replaceAll('"', "").toLowerCase();
  const combined = `${hintedPlatform} ${userAgent}`.toLowerCase();

  if (combined.includes("android")) return { label: "Android phone or tablet", platform: "android" };
  if (combined.includes("iphone")) return { label: "iPhone", platform: "ios" };
  if (combined.includes("ipad")) return { label: "iPad", platform: "ios" };
  if (combined.includes("mac")) return { label: "Mac browser", platform: "macos" };
  if (combined.includes("windows")) return { label: "Windows browser", platform: "windows" };
  if (combined.includes("linux")) return { label: "Linux browser", platform: "linux" };
  return { label: "Web browser", platform: "browser" };
}

export async function ensureClientDevice(
  request: NextRequest,
  userId: string,
  admin: AdminClient = createAdminClient(),
): Promise<ClientDeviceResolution> {
  const cookieId = request.cookies.get(CLIENT_DEVICE_COOKIE)?.value;
  const now = new Date().toISOString();

  if (cookieId && UUID_PATTERN.test(cookieId)) {
    const { data: existing, error } = await admin.from("client_devices")
      .select("id, user_id, label, revoked_at")
      .eq("id", cookieId)
      .maybeSingle();

    if (error) return { ok: false, error: "CONTROL_PLANE_UNAVAILABLE", status: 503 };
    if (existing?.user_id === userId) {
      if (existing.revoked_at) return { ok: false, error: "DEVICE_REVOKED", status: 403 };
      const { error: touchError } = await admin.from("client_devices")
        .update({ last_seen_at: now })
        .eq("id", existing.id)
        .eq("user_id", userId)
        .is("revoked_at", null);
      if (touchError) return { ok: false, error: "CONTROL_PLANE_UNAVAILABLE", status: 503 };
      return { ok: true, deviceId: existing.id, label: existing.label };
    }
  }

  const { count, error: countError } = await admin.from("client_devices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (countError) return { ok: false, error: "CONTROL_PLANE_UNAVAILABLE", status: 503 };
  if ((count ?? 0) >= MAX_ACTIVE_DEVICES) return { ok: false, error: "DEVICE_LIMIT_REACHED", status: 429 };

  const deviceId = randomUUID();
  const { label, platform } = describeClientDevice(request.headers);
  const { error: insertError } = await admin.from("client_devices").insert({
    id: deviceId,
    user_id: userId,
    label,
    platform,
    public_key: null,
    last_seen_at: now,
    revoked_at: null,
  });
  if (insertError) return { ok: false, error: "CONTROL_PLANE_UNAVAILABLE", status: 503 };

  return { ok: true, deviceId, label };
}

export function attachClientDeviceCookie<T extends NextResponse>(response: T, deviceId: string) {
  response.cookies.set(CLIENT_DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
