import { createClient } from "@supabase/supabase-js";

function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (url.includes("/rest/v1")) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL should NOT include "/rest/v1" — found "${url}". ` +
      `Use just the bare project URL, e.g. https://YOUR_PROJECT.supabase.co`
    );
  }
  return url;
}

// Server-only client using the service_role key — bypasses RLS and can call
// supabase.auth.admin.*. Never import this from a "use client" component.
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  }
  return createClient(getSupabaseUrl(), serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
