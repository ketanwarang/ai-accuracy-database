"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";
import TopNav from "@/components/TopNav";
import { useAuth } from "@/lib/auth";

interface Account { id: string; name: string; display_name: string | null; is_active: boolean; created_at: string; }

export default function ManageAccountsPage() {
  const router = useRouter();
  const supabase = createClient();
  const { user, isSuperAdmin, loading: authLoading } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", display_name: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    if (!isSuperAdmin) { router.push("/"); return; }
    loadData();
  }, [user, authLoading, isSuperAdmin]);

  async function loadData() {
    setLoading(true);
    const { data } = await supabase.from("accounts").select("*").order("display_name");
    setAccounts(data || []);
    setLoading(false);
  }

  async function handleCreate() {
    const slug = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!slug) { setError("Enter a valid account name."); return; }
    setSaving(true); setError("");
    const { error: err } = await supabase.from("accounts").insert({ name: slug, display_name: form.display_name.trim() || form.name.trim() });
    if (err) setError(err.message);
    else { setForm({ name: "", display_name: "" }); loadData(); }
    setSaving(false);
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete account "${name}" and ALL its projects and data? This cannot be undone.`)) return;
    // Cascade: delete all project data first
    const { data: projs } = await supabase.from("projects").select("id").eq("account_id", id);
    for (const proj of (projs || [])) {
      const { data: snaps } = await supabase.from("snapshots").select("id").eq("project_id", proj.id);
      const snapIds = (snaps || []).map((s: any) => s.id);
      if (snapIds.length) {
        await supabase.from("confusion_pairs").delete().in("snapshot_id", snapIds);
        await supabase.from("category_metrics").delete().in("snapshot_id", snapIds);
        await supabase.from("snapshots").delete().eq("project_id", proj.id);
      }
      await supabase.from("user_roles").delete().eq("project_id", proj.id);
      await supabase.from("projects").delete().eq("id", proj.id);
    }
    await supabase.from("user_roles").delete().eq("account_id", id);
    const { error } = await supabase.from("accounts").delete().eq("id", id);
    if (error) { alert("Delete failed: " + error.message); return; }
    loadData();
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from("accounts").update({ is_active: !current }).eq("id", id);
    loadData();
  }

  if (authLoading || loading) return <div style={{ minHeight: "100vh" }}><TopNav /></div>;

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "2rem" }}>
        <button onClick={() => router.push("/")} style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 14, display: "flex", alignItems: "center", gap: 4 }}>
          <i className="ti ti-arrow-left" aria-hidden="true" style={{ fontSize: 14 }}></i> Back
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 4px" }}>Manage accounts</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 24px" }}>Add and manage client accounts.</p>

        <div style={{ background: "var(--surface-1)", borderRadius: 12, padding: "1.25rem", marginBottom: 24 }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 12px" }}>Add account</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Display name</label>
              <input placeholder="e.g. Eciton" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Key (auto-generated)</label>
              <input placeholder="eciton" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: "100%" }} />
            </div>
          </div>
          {error && <p style={{ fontSize: 12, color: "var(--text-danger)", margin: "0 0 8px" }}>{error}</p>}
          <button className="primary" onClick={handleCreate} disabled={saving}>{saving ? "Creating…" : "Create account"}</button>
        </div>

        <div style={{ background: "var(--surface-1)", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ borderBottom: "0.5px solid var(--border)" }}>
              {["Account", "Key", "Status", ""].map((h) => <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)", fontWeight: 500, fontSize: 12 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} style={{ borderBottom: "0.5px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px", fontWeight: 500, color: "var(--text-primary)" }}>{a.display_name || a.name}</td>
                  <td style={{ padding: "8px 12px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{a.name}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: a.is_active ? "var(--bg-success)" : "var(--surface-2)", color: a.is_active ? "var(--text-success)" : "var(--text-muted)" }}>{a.is_active ? "Active" : "Inactive"}</span>
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={() => toggleActive(a.id, a.is_active)} style={{ fontSize: 12, color: a.is_active ? "var(--text-warning)" : "var(--text-success)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                      {a.is_active ? "Deactivate" : "Activate"}
                    </button>
                    {isSuperAdmin && <button onClick={() => handleDelete(a.id, a.display_name || a.name)} style={{ fontSize: 12, color: "var(--text-danger)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>Delete</button>}
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
