"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LiveUpdater() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };
    const channel = supabase.channel("atelier-portal")
      .on("postgres_changes", { event: "*", schema: "public", table: "nodes" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "run_projections" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "commands" }, refresh)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
