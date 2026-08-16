import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getServerEnv } from "@/lib/env";

export function createAdminClient() {
  const { url, secretKey } = getServerEnv();
  return createClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
