"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    (async () => {
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error || !session) {
        router.push("/login?error=auth_failed");
        return;
      }

      const email = session.user.email || "";

      // Domain restriction: only @paralleldots.com accounts
      if (!email.endsWith("@paralleldots.com")) {
        await supabase.auth.signOut();
        router.push("/login?error=domain_not_allowed");
        return;
      }

      // Check if this user has any roles assigned yet
      const { data: roles } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_email", email)
        .limit(1);

      if (!roles || roles.length === 0) {
        // New user — sign them out and show "no access" message
        await supabase.auth.signOut();
        router.push("/login?error=no_access");
        return;
      }

      router.push("/");
    })();
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "var(--surface-0)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "var(--text-muted)", fontFamily: "var(--font-sans)" }}>Signing you in…</p>
    </div>
  );
}
