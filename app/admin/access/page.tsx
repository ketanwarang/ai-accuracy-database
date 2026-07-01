"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";
import TopNav from "@/components/TopNav";
import { useAuth } from "@/lib/auth";

interface Account { id: string; name: string; display_name: string | null; }
interface Project { id: string; name: string; display_name: string | null; account_id: string; }
interface UserRole { id: string; user_email: string; role: string; account_id: string | null; project_id: string | null; }

export default function AccessPage() {
  const router = useRouter();
  const supabase = createClient();
  const { user, isSuperAdmin, isAdmin, loading: authLoading } = useAuth();

  const [roles, setRoles] = useState<UserRole[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("user");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [grantMode, setGrantMode] = useState<"account" | "projects">("account");
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    if (!isSuperAdmin && !isAdmin()) { router.push("/"); return; }
    loadData();
  }, [user, authLoading, isSuperAdmin]);

  async function loadData() {
    setLoading(true);
    const [{ data: r }, { data: a }, { data: p }] = await Promise.all([
      supabase.from("user_roles").select("*").order("user_email"),
      supabase.from("accounts").select("id, name, display_name").eq("is_active", true),
      supabase.from("projects").select("id, name, display_name, account_id").eq("is_active", true),
    ]);
    setRoles(r || []);
    setAccounts(a || []);
    setProjects(p || []);
    setLoading(false);
  }

  function toggleProject(id: string) {
    const next = new Set(selectedProjectIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedProjectIds(next);
  }

  async function handleGrant() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.endsWith("@paralleldots.com")) { setError("Only @paralleldots.com emails are allowed."); return; }
    setSaving(true); setError(""); setSuccess("");

    if (grantMode === "account") {
      const { error: err } = await supabase.from("user_roles").insert({
        user_email: trimmed, role, account_id: selectedAccountId || null, project_id: null, granted_by: user?.email,
      });
      if (err) { setError(err.message); setSaving(false); return; }
    } else {
      if (!selectedProjectIds.size) { setError("Select at least one project."); setSaving(false); return; }
      const inserts = Array.from(selectedProjectIds).map((pid) => ({
        user_email: trimmed, role, account_id: selectedAccountId || null, project_id: pid, granted_by: user?.email,
      }));
      const { error: err } = await supabase.from("user_roles").insert(inserts);
      if (err) { setError(err.message); setSaving(false); return; }
    }

    setSuccess(`Access granted to ${trimmed}`);
    setEmail(""); setSelectedProjectIds(new Set());
    loadData();
    setSaving(false);
  }

  async function handleRevoke(id: string) {
    await supabase.from("user_roles").delete().eq("id", id);
    loadData();
  }

  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a.display_name || a.name]));
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.display_name || p.name]));
  const filteredProjects = projects.filter((p) => !selectedAccountId || p.account_id === selectedAccountId);

  if (authLoading || loading) return <div style={{ minHeight: "100vh" }}><TopNav /></div>;

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem" }}>
        <button onClick={() => router.push("/")} style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 14, display: "flex", alignItems: "center", gap: 4 }}>
          <i className="ti ti-arrow-left" aria-hidden="true" style={{ fontSize: 14 }}></i> Back
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 4px" }}>Access and roles</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 24px" }}>Grant @paralleldots.com users access to accounts and projects.</p>

        <div style={{ background: "var(--surface-1)", borderRadius: 12, padding: "1.25rem", marginBottom: 24 }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 14px" }}>Grant access</p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Email</label>
              <input type="email" placeholder="user@paralleldots.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: "100%" }}>
                <option value="user">User — upload and view</option>
                <option value="admin">Admin — manage account</option>
                {isSuperAdmin && <option value="super_admin">Super admin</option>}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Account</label>
              <select value={selectedAccountId} onChange={(e) => { setSelectedAccountId(e.target.value); setSelectedProjectIds(new Set()); }} style={{ width: "100%" }}>
                <option value="">No specific account</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.display_name || a.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Access scope</label>
              <div style={{ display: "flex", gap: 6 }}>
                {(["account", "projects"] as const).map((m) => (
                  <button key={m} onClick={() => setGrantMode(m)} style={{ flex: 1, fontSize: 12, padding: "7px 0", background: grantMode === m ? "var(--bg-accent)" : "var(--surface-2)", color: grantMode === m ? "var(--text-accent)" : "var(--text-muted)", border: grantMode === m ? "0.5px solid var(--border-accent)" : "0.5px solid var(--border-strong)" }}>
                    {m === "account" ? "Full account" : "Specific projects"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {grantMode === "projects" && selectedAccountId && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                Select projects <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({selectedProjectIds.size} selected)</span>
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {filteredProjects.map((p) => (
                  <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, background: selectedProjectIds.has(p.id) ? "var(--bg-accent)" : "var(--surface-2)", border: `0.5px solid ${selectedProjectIds.has(p.id) ? "var(--border-accent)" : "var(--border-strong)"}`, cursor: "pointer", fontSize: 13 }}>
                    <input type="checkbox" checked={selectedProjectIds.has(p.id)} onChange={() => toggleProject(p.id)} style={{ accentColor: "var(--fill-accent)" }} />
                    <span style={{ color: selectedProjectIds.has(p.id) ? "var(--text-accent)" : "var(--text-primary)" }}>{p.display_name || p.name}</span>
                  </label>
                ))}
              </div>
              <button onClick={() => setSelectedProjectIds(new Set(filteredProjects.map((p) => p.id)))} style={{ fontSize: 12, marginTop: 8, color: "var(--text-accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>Select all</button>
            </div>
          )}

          {error && <p style={{ fontSize: 12, color: "var(--text-danger)", margin: "0 0 8px" }}>{error}</p>}
          {success && <p style={{ fontSize: 12, color: "var(--text-success)", margin: "0 0 8px" }}>{success}</p>}
          <button className="primary" onClick={handleGrant} disabled={saving}>{saving ? "Saving…" : "Grant access"}</button>
        </div>

        <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 10px" }}>Current access ({roles.length})</p>
        <div style={{ background: "var(--surface-1)", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ borderBottom: "0.5px solid var(--border)" }}>
              {["Email", "Role", "Account", "Project", ""].map((h) => <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)", fontWeight: 500, fontSize: 12 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id} style={{ borderBottom: "0.5px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px" }}>{r.user_email}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: r.role === "super_admin" ? "var(--bg-danger)" : r.role === "admin" ? "var(--bg-accent)" : "var(--surface-2)", color: r.role === "super_admin" ? "var(--text-danger)" : r.role === "admin" ? "var(--text-accent)" : "var(--text-muted)" }}>{r.role}</span>
                  </td>
                  <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{r.account_id ? (accountMap[r.account_id] || "—") : "All accounts"}</td>
                  <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{r.project_id ? (projectMap[r.project_id] || "—") : "All projects"}</td>
                  <td style={{ padding: "8px 12px" }}>
                    {r.user_email !== user?.email && <button onClick={() => handleRevoke(r.id)} style={{ fontSize: 12, color: "var(--text-danger)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>Revoke</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
