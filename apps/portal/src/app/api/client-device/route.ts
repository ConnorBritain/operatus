import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { attachClientDeviceCookie, ensureClientDevice } from "@/lib/client-device";

export async function POST(request: NextRequest) {
  const { userId } = await requireUser();
  if (!userId) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const device = await ensureClientDevice(request, userId);
  if (!device.ok) return NextResponse.json({ error: device.error }, { status: device.status });

  return attachClientDeviceCookie(
    NextResponse.json({ deviceId: device.deviceId, label: device.label }),
    device.deviceId,
  );
}
