import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { getPublicEnv } from "@/lib/env";

export function createClient() {
  const { url, publishableKey } = getPublicEnv();
  return createBrowserClient<Database>(url, publishableKey);
}
