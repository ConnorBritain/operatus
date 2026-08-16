"use client";

import { useEffect } from "react";

export function DeviceRegistrar() {
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/client-device", {
      method: "POST",
      signal: controller.signal,
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  return null;
}
