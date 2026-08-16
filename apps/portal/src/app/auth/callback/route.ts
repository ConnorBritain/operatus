import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { attachClientDeviceCookie, ensureClientDevice } from "@/lib/client-device";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const requestedNext = requestUrl.searchParams.get("next") ?? "/";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data } = await supabase.auth.getClaims();
      const userId = data?.claims?.sub;
      if (!userId) return NextResponse.redirect(new URL("/auth/error", requestUrl.origin));
      const device = await ensureClientDevice(request, userId);
      if (!device.ok) return NextResponse.redirect(new URL(`/auth/error?reason=${device.error}`, requestUrl.origin));
      return attachClientDeviceCookie(
        NextResponse.redirect(new URL(next, requestUrl.origin)),
        device.deviceId,
      );
    }
  }

  return NextResponse.redirect(new URL("/auth/error", requestUrl.origin));
}
