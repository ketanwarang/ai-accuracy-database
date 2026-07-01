"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";
import TopNav from "@/components/TopNav";
import { useAuth } from "@/lib/auth";

interface Account { id: string; name: string; display_name: string | null; }
interface Project { id: string; name: string; display_name: string | null; account_id: string; is_active: boolean; }

export default function ManageProjectsPage() {
  const router = useRouter();
  const supabase = createClient();
  const { user, isSuperAdmin, isAdmin, loading: authLoading } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ display_name: "", name: "", account_id: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    if (!isSuperAdmin && !isAdmin()) { router.push("/"); return; }
    loadData();
  }, [user, authLoading, isSuperAdmin]);

  async function loadData() {
    setLoading(true);
    const [{ data: a }, { data: p }] = await Promise.all([
      supabase.from("accounts").select("id, name, display_name").eq("is_active", true),
      supabase.from("projects").select("id, name, display_name, account_id, is_active").order("display_name"),
    ]);
    setAccounts(a || []);
    setProjects(p || []);
    setLoading(false);
  }

  async function handleCreate() {
    const slug = (form.name || form.display_name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!slug || !form.account_id) { setError("Fill in all fields."); return; }
    setSaving(true); setError("");
    const { error: err } = await supabase.from("projects").insert({ name: slug, display_name: form.display_name.trim(), account_id: form.account_id });
    if (err) setError(err.message);
    else { setForm({ display_name: "", name: "", account_id: "" }); loadData(); }
    setSaving(false);
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete project "${name}" and ALL its snapshots and data? This cannot be undone.`)) return;
    // Delete in cascade order (RLS may not auto-cascade from projects delete)
    const { data: snaps } = await supabase.from("snapshots").select("id").eq("project_id", id);
    const snapIds = (snaps || []).map((s: any) => s.id);
    if (snapIds.length) {
      await supabase.from("confusion_pairs").delete().in("snapshot_id", snapIds);
      await supabase.from("category_metrics").delete().in("snapshot_id", snapIds);
      await supabase.from("snapshots").delete().eq("project_id", id);
    }
    await supabase.from("user_roles").delete().eq("project_id", id);
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) { alert("Delete failed: " + error.message); return; }
    loadData();
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from("projects").update({ is_active: !current }).eq("id", id);
    loadData();
  }

  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a.display_name || a.name]));

  if (authLoading || loading) return <div style={{ minHeight: "100vh" }}><TopNav /></div>;

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem" }}>
        <button onClick={() => router.push("/")} style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 14, display: "flex", alignItems: "center", gap: 4 }}>
          <i className="ti ti-arrow-left" aria-hidden="true" style={{ fontSize: 14 }}></i> Back
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 4px" }}>Manage projects</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 24px" }}>Add and manage projects within accounts.</p>

        <div style={{ background: "var(--surface-1)", borderRadius: 12, padding: "1.25rem", marginBottom: 24 }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 12px" }}>Add project</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Account</label>
              <select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })} style={{ width: "100%" }}>
                <option value="">Select account</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.display_name || a.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Display name</label>
              <input placeholder="e.g. Sigma" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Key</label>
              <input placeholder="sigma" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: "100%" }} />
            </div>
          </div>
          {error && <p style={{ fontSize: 12, color: "var(--text-danger)", margin: "0 0 8px" }}>{error}</p>}
          <button className="primary" onClick={handleCreate} disabled={saving}>{saving ? "Creating…" : "Create project"}</button>
        </div>

        <div style={{ background: "var(--surface-1)", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ borderBottom: "0.5px solid var(--border)" }}>
              {["Project", "Key", "Account", "Status", ""].map((h) => <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)", fontWeight: 500, fontSize: 12 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} style={{ borderBottom: "0.5px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px", fontWeight: 500, color: "var(--text-primary)" }}>{p.display_name || p.name}</td>
                  <td style={{ padding: "8px 12px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{p.name}</td>
                  <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{accountMap[p.account_id] || p.account_id}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: p.is_active ? "var(--bg-success)" : "var(--surface-2)", color: p.is_active ? "var(--text-success)" : "var(--text-muted)" }}>{p.is_active ? "Active" : "Inactive"}</span>
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={() => toggleActive(p.id, p.is_active)} style={{ fontSize: 12, color: p.is_active ? "var(--text-warning)" : "var(--text-success)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                      {p.is_active ? "Deactivate" : "Activate"}
                    </button>
                    {isSuperAdmin && <button onClick={() => handleDelete(p.id, p.display_name || p.name)} style={{ fontSize: 12, color: "var(--text-danger)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>Delete</button>}
                  </div>
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
