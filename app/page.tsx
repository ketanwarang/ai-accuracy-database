"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";
import TopNav from "@/components/TopNav";
import { useAuth } from "@/lib/auth";
import { getCached, setCached } from "@/lib/dataCache";

interface Account {
  id: string;
  name: string;
  display_name: string | null;
}

interface ProjectCount {
  account_id: string;
  count: number;
}

interface HomeCache {
  accounts: Account[];
  projectCounts: Record<string, number>;
}

const CACHE_KEY = "home";

export default function HomePage() {
  const router = useRouter();
  const supabase = createClient();
  const { user, loading: authLoading } = useAuth();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projectCounts, setProjectCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    const cached = getCached<HomeCache>(CACHE_KEY);
    if (cached) {
      setAccounts(cached.accounts);
      setProjectCounts(cached.projectCounts);
      setLoading(false);
    }
    loadData(!cached);
  }, [user, authLoading]);

  useEffect(() => {
    const handler = () => loadData(false);
    window.addEventListener("app:refresh", handler);
    return () => window.removeEventListener("app:refresh", handler);
  }, []);

  async function loadData(showSkeleton = true) {
    if (showSkeleton) setLoading(true);
    const { data: accountsData } = await supabase
      .from("accounts")
      .select("id, name, display_name")
      .eq("is_active", true)
      .order("display_name");
    const accountsResult = accountsData || [];
    setAccounts(accountsResult);

    const { data: projects } = await supabase
      .from("projects")
      .select("account_id")
      .eq("is_active", true);

    const counts: Record<string, number> = {};
    (projects || []).forEach((p: any) => {
      counts[p.account_id] = (counts[p.account_id] || 0) + 1;
    });
    setProjectCounts(counts);
    setLoading(false);
    setCached<HomeCache>(CACHE_KEY, { accounts: accountsResult, projectCounts: counts });
  }

  if (authLoading || loading) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <TopNav />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
          <p style={{ color: "var(--text-muted)" }}>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav />
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "2rem" }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 4px" }}>Accounts</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 24px" }}>{accounts.length} account{accounts.length !== 1 ? "s" : ""}</p>

        {!accounts.length ? (
          <div style={{ textAlign: "center", padding: "4rem 2rem", background: "var(--surface-1)", borderRadius: 12 }}>
            <i className="ti ti-building" aria-hidden="true" style={{ fontSize: 32, color: "var(--text-muted)", display: "block", marginBottom: 12 }}></i>
            <p style={{ color: "var(--text-muted)", fontSize: 14, margin: "0 0 12px" }}>No accounts yet. Add one via Manage accounts.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {accounts.map((account, idx) => (
              <div
                key={account.id}
                onClick={() => router.push(`/account/${account.id}`)}
                style={{
                  background: "var(--surface-1)", border: "0.5px solid var(--border)", borderRadius: 16,
                  padding: "1.5rem", cursor: "pointer", minHeight: 140, display: "flex", flexDirection: "column",
                  opacity: 0, animation: `slideUp 0.3s ease-out ${idx * 0.06}s forwards`,
                  transition: "box-shadow 0.2s, transform 0.2s, border-color 0.2s",
                }}
                onMouseOver={(e) => { e.currentTarget.style.boxShadow = "0 6px 18px rgba(0,0,0,0.1)"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = "var(--border-accent)"; }}
                onMouseOut={(e) => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = "var(--border)"; }}
              >
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "var(--bg-accent)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                  <i className="ti ti-building" aria-hidden="true" style={{ fontSize: 20, color: "var(--text-accent)" }}></i>
                </div>
                <p style={{ fontSize: 18, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 4px", letterSpacing: "-0.01em" }}>
                  {account.display_name || account.name}
                </p>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px" }}>
                  {projectCounts[account.id] || 0} project{(projectCounts[account.id] || 0) !== 1 ? "s" : ""}
                </p>
                <div style={{ flex: 1 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-accent)", fontSize: 13 }}>
                  <span>View projects</span>
                  <i className="ti ti-arrow-right" aria-hidden="true" style={{ fontSize: 14 }}></i>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
