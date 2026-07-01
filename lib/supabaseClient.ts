import { createBrowserClient } from "@supabase/ssr";

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

export function createClient() {
  return createBrowserClient(
    getSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
