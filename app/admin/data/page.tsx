"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";
import TopNav from "@/components/TopNav";
import { useAuth } from "@/lib/auth";
import { formatDate, formatNumber } from "@/lib/format";

interface Account { id: string; name: string; display_name: string | null; }
interface Project { id: string; name: string; display_name: string | null; account_id: string; }
interface SnapshotRow {
  id: string;
  test_date: string;
  row_count: number;
  file_name: string | null;
  category_count: number;
}
interface CategoryEntry {
  snapshot_id: string;
  test_date: string;
  category_name: string;
  total_annotations: number | null;
}

export default function DataManagementPage() {
  const router = useRouter();
  const supabase = createClient();
  const { user, isSuperAdmin, isAdmin, loading: authLoading } = useAuth();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [categories, setCategories] = useState<CategoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState("");
  const [deleteError, setDeleteError] = useState("");

  // Selection state
  const [selectedSnapIds, setSelectedSnapIds] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [filterCategory, setFilterCategory] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    if (!isSuperAdmin && !isAdmin()) { router.push("/"); return; }
    loadAccounts();
  }, [user, authLoading, isSuperAdmin]);

  async function loadAccounts() {
    const { data: a } = await supabase.from("accounts").select("id, name, display_name").eq("is_active", true);
    setAccounts(a || []);
    const { data: p } = await supabase.from("projects").select("id, name, display_name, account_id").eq("is_active", true);
    setProjects(p || []);
  }

  async function loadProjectData(projectId: string) {
    setLoading(true);
    setSnapshots([]);
    setCategories([]);
    setSelectedSnapIds(new Set());
    setSelectedCategories(new Set());

    const { data: snaps } = await supabase
      .from("snapshots")
      .select("id, test_date, row_count, file_name")
      .eq("project_id", projectId)
      .order("test_date", { ascending: false });

    if (!snaps || !snaps.length) { setLoading(false); return; }

    const snapIds = snaps.map((s) => s.id);
    const { data: cats } = await supabase
      .from("category_metrics")
      .select("snapshot_id, category_name, total_annotations")
      .in("snapshot_id", snapIds);

    // Build enriched snapshot list with category counts
    const catsBySnap: Record<string, number> = {};
    (cats || []).forEach((c: any) => {
      catsBySnap[c.snapshot_id] = (catsBySnap[c.snapshot_id] || 0) + 1;
    });

    setSnapshots(snaps.map((s) => ({ ...s, category_count: catsBySnap[s.id] || 0 })));

    // Build category entries with test_date for display
    const snapDateMap = Object.fromEntries(snaps.map((s) => [s.id, s.test_date]));
    setCategories((cats || []).map((c: any) => ({
      snapshot_id: c.snapshot_id,
      test_date: snapDateMap[c.snapshot_id],
      category_name: c.category_name,
      total_annotations: c.total_annotations,
    })));

    setLoading(false);
  }

  useEffect(() => {
    if (selectedProjectId) loadProjectData(selectedProjectId);
  }, [selectedProjectId]);

  const uniqueCategories = useMemo(() =>
    [...new Set(categories.map((c) => c.category_name))].sort(),
    [categories]
  );

  const filteredCategories = useMemo(() => {
    let list = categories;
    if (filterCategory !== "ALL") list = list.filter((c) => c.category_name === filterCategory);
    if (dateFrom) list = list.filter((c) => c.test_date >= dateFrom);
    if (dateTo) list = list.filter((c) => c.test_date <= dateTo);
    return list;
  }, [categories, filterCategory, dateFrom, dateTo]);

  // Group filtered entries by snapshot for display
  const groupedBySnap = useMemo(() => {
    const groups: Record<string, CategoryEntry[]> = {};
    filteredCategories.forEach((c) => {
      if (!groups[c.snapshot_id]) groups[c.snapshot_id] = [];
      groups[c.snapshot_id].push(c);
    });
    return groups;
  }, [filteredCategories]);

  function toggleSnapSelection(snapId: string) {
    const next = new Set(selectedSnapIds);
    const snapCats = (groupedBySnap[snapId] || []).map((c) => `${snapId}::${c.category_name}`);
    if (next.has(snapId)) {
      next.delete(snapId);
      const nextCats = new Set(selectedCategories);
      snapCats.forEach((k) => nextCats.delete(k));
      setSelectedCategories(nextCats);
    } else {
      next.add(snapId);
      const nextCats = new Set(selectedCategories);
      snapCats.forEach((k) => nextCats.add(k));
      setSelectedCategories(nextCats);
    }
    setSelectedSnapIds(next);
  }

  function toggleCategoryEntry(snapId: string, categoryName: string) {
    const key = `${snapId}::${categoryName}`;
    const next = new Set(selectedCategories);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelectedCategories(next);
  }

  function selectAll() {
    const newSnapIds = new Set(Object.keys(groupedBySnap));
    const newCatKeys = new Set(filteredCategories.map((c) => `${c.snapshot_id}::${c.category_name}`));
    setSelectedSnapIds(newSnapIds);
    setSelectedCategories(newCatKeys);
  }

  function clearSelection() {
    setSelectedSnapIds(new Set());
    setSelectedCategories(new Set());
  }

  async function handleDelete() {
    if (!selectedCategories.size) return;

    const confirmed = confirm(
      `Delete ${selectedCategories.size} category-date combination(s)? This removes their metrics, accuracies, and issues data. Historical trend data for the selected dates will be removed.`
    );
    if (!confirmed) return;

    setDeleting(true);
    setDeleteMsg("");
    setDeleteError("");

    try {
      // Parse selected entries: { snapId -> [categoryNames] }
      const toDelete: Record<string, string[]> = {};
      selectedCategories.forEach((key) => {
        const [snapId, ...catParts] = key.split("::");
        const cat = catParts.join("::");
        if (!toDelete[snapId]) toDelete[snapId] = [];
        toDelete[snapId].push(cat);
      });

      let deletedCount = 0;
      const entries = Object.entries(toDelete);

      for (let i = 0; i < entries.length; i++) {
        const [snapId, catNames] = entries[i];
        setDeleteMsg(`Deleting ${i + 1}/${entries.length} snapshot entries…`);

        // Delete confusion_pairs for these categories
        await supabase.from("confusion_pairs")
          .delete().eq("snapshot_id", snapId).in("category_name", catNames);

        // Delete category_metrics for these categories
        await supabase.from("category_metrics")
          .delete().eq("snapshot_id", snapId).in("category_name", catNames);

        deletedCount += catNames.length;

        // If snapshot now has no category_metrics, delete the snapshot too
        const { count } = await supabase
          .from("category_metrics")
          .select("id", { count: "exact", head: true })
          .eq("snapshot_id", snapId);
        if (!count) {
          await supabase.from("snapshots").delete().eq("id", snapId);
        }
      }

      setDeleteMsg(`✓ Deleted ${deletedCount} category-date entries.`);
      clearSelection();
      await loadProjectData(selectedProjectId);
      setTimeout(() => setDeleteMsg(""), 4000);
    } catch (err: any) {
      setDeleteError(err.message || "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  const filteredProjects = projects.filter((p) => !selectedAccountId || p.account_id === selectedAccountId);
  const totalSelected = selectedCategories.size;

  if (authLoading) return <div style={{ minHeight: "100vh" }}><TopNav /></div>;

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem" }}>
        <button onClick={() => router.push("/")} style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 14, display: "flex", alignItems: "center", gap: 4 }}>
          <i className="ti ti-arrow-left" aria-hidden="true" style={{ fontSize: 14 }}></i> Back
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 4px" }}>Data management</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 24px" }}>Select categories and dates to delete data in bulk.</p>

        {/* Filters */}
        <div style={{ background: "var(--surface-1)", borderRadius: 12, padding: "1.25rem", marginBottom: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 12px" }}>Select project</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Account</label>
              <select value={selectedAccountId} onChange={(e) => { setSelectedAccountId(e.target.value); setSelectedProjectId(""); }} style={{ width: "100%" }}>
                <option value="">All accounts</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.display_name || a.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Project</label>
              <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} style={{ width: "100%" }}>
                <option value="">Select project</option>
                {filteredProjects.map((p) => <option key={p.id} value={p.id}>{p.display_name || p.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Category filter</label>
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={{ width: "100%" }} disabled={!categories.length}>
                <option value="ALL">All categories</option>
                {uniqueCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Date range</label>
              <div style={{ display: "flex", gap: 4 }}>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ flex: 1, fontSize: 11 }} />
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ flex: 1, fontSize: 11 }} />
              </div>
            </div>
          </div>
        </div>

        {/* Data table */}
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 44, borderRadius: 10 }} />)}
          </div>
        ) : !selectedProjectId ? (
          <div className="empty-state">
            <div className="empty-icon"><i className="ti ti-folder-search" aria-hidden="true"></i></div>
            <p>Select a project to view its data.</p>
          </div>
        ) : !Object.keys(groupedBySnap).length ? (
          <div className="empty-state">
            <div className="empty-icon"><i className="ti ti-database-off" aria-hidden="true"></i></div>
            <p>No data found for the selected filters.</p>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
                {Object.keys(groupedBySnap).length} snapshot{Object.keys(groupedBySnap).length !== 1 ? "s" : ""} · {filteredCategories.length} category entries
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={selectAll} style={{ fontSize: 12, padding: "5px 10px" }}>Select all</button>
                <button onClick={clearSelection} style={{ fontSize: 12, padding: "5px 10px" }}>Clear</button>
                {totalSelected > 0 && (
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    style={{ fontSize: 12, padding: "5px 12px", background: "var(--fill-danger)", color: "#fff", border: "none" }}
                  >
                    <i className="ti ti-trash" aria-hidden="true" style={{ marginRight: 5, fontSize: 13 }}></i>
                    {deleting ? deleteMsg : `Delete ${totalSelected} selected`}
                  </button>
                )}
              </div>
            </div>

            {deleteError && <p className="flash-message" style={{ fontSize: 12, color: "var(--text-danger)", marginBottom: 8 }}>{deleteError}</p>}
            {deleteMsg && !deleting && <p className="flash-message" style={{ fontSize: 12, color: "var(--text-success)", marginBottom: 8 }}>{deleteMsg}</p>}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {Object.entries(groupedBySnap)
                .sort(([, a], [, b]) => (b[0].test_date > a[0].test_date ? 1 : -1))
                .map(([snapId, catEntries], idx) => {
                  const isSnapSelected = selectedSnapIds.has(snapId);
                  const testDate = catEntries[0].test_date;
                  const snap = snapshots.find((s) => s.id === snapId);
                  return (
                    <div key={snapId} style={{
                      background: "var(--surface-1)", borderRadius: 10, overflow: "hidden",
                      border: `0.5px solid ${isSnapSelected ? "var(--border-accent)" : "var(--border)"}`,
                      opacity: 0, animation: `fadeIn 0.25s ease-out ${Math.min(idx * 0.03, 0.3)}s forwards`,
                      transition: "border-color 0.15s ease",
                    }}>
                      {/* Snapshot header */}
                      <div
                        onClick={() => toggleSnapSelection(snapId)}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", background: isSnapSelected ? "var(--bg-accent)" : "var(--surface-2)", borderBottom: "0.5px solid var(--border)" }}
                      >
                        <input type="checkbox" checked={isSnapSelected} onChange={() => toggleSnapSelection(snapId)} onClick={(e) => e.stopPropagation()} style={{ accentColor: "var(--fill-accent)" }} />
                        <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{formatDate(testDate)}</span>
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {catEntries.length} categor{catEntries.length !== 1 ? "ies" : "y"}
                          {snap?.row_count ? ` · ${formatNumber(snap.row_count)} rows` : ""}
                          {snap?.file_name ? ` · ${snap.file_name}` : ""}
                        </span>
                      </div>

                      {/* Category rows */}
                      <div style={{ padding: "4px 0" }}>
                        {catEntries.sort((a, b) => a.category_name.localeCompare(b.category_name)).map((cat) => {
                          const key = `${snapId}::${cat.category_name}`;
                          const isCatSelected = selectedCategories.has(key);
                          return (
                            <label key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px 7px 38px", cursor: "pointer", background: isCatSelected ? "var(--bg-accent)" : "transparent" }}>
                              <input type="checkbox" checked={isCatSelected} onChange={() => toggleCategoryEntry(snapId, cat.category_name)} style={{ accentColor: "var(--fill-accent)" }} />
                              <span style={{ fontSize: 13, color: "var(--text-primary)", flex: 1 }}>{cat.category_name}</span>
                              {cat.total_annotations != null && (
                                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatNumber(cat.total_annotations)} annotations</span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
