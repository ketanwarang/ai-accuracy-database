"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";
import TopNav from "@/components/TopNav";
import Breadcrumb from "@/components/Breadcrumb";
import { useAuth } from "@/lib/auth";
import { formatDate, formatPct, formatNumber, pillColor, getHealthStatus, healthColor } from "@/lib/format";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface Project { id: string; name: string; display_name: string | null; account_id: string; }
interface Snapshot { id: string; test_date: string; row_count: number; file_name: string | null; uploaded_at: string; }
interface CategoryMetric {
  snapshot_id: string; category_name: string; total_annotations: number | null; image_count: number | null;
  gpd_accuracy: number | null; group_accuracy: number | null; class_accuracy: number | null;
  openset_accuracy: number | null; osa_accuracy: number | null;
}
interface ConfusionPair {
  snapshot_id: string; category_name: string; matrix_type: "class" | "group";
  actual_value: string; predicted_value: string; count: number;
  self_count: number; total_count: number; accuracy_pct: number;
  is_mismatch: boolean;
}

type Tab = "current" | "historical" | "comparison" | "issues";

export default function ProjectPage() {
  const router = useRouter();
  const { accountId, projectName } = useParams() as { accountId: string; projectName: string };
  const supabase = createClient();
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [showLatestOnly, setShowLatestOnly] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [categoryMetrics, setCategoryMetrics] = useState<CategoryMetric[]>([]);
  const [confusionPairs, setConfusionPairs] = useState<ConfusionPair[]>([]);
  const [tab, setTab] = useState<Tab>("current");
  const [historicalCategory, setHistoricalCategory] = useState("ALL");
  const [compareDateA, setCompareDateA] = useState("");
  const [compareDateB, setCompareDateB] = useState("");
  const [accuraciesFilter, setAccuraciesFilter] = useState<"all" | "class" | "group">("all");
  const [accuraciesSearch, setAccuraciesSearch] = useState("");
  const [issuesFilter, setIssuesFilter] = useState<"all" | "class" | "group">("all");
  const [issuesSearch, setIssuesSearch] = useState("");
  const [accuraciesSort, setAccuraciesSort] = useState<"accuracy_asc" | "accuracy_desc" | "name">("accuracy_asc");
  const [accuraciesCategory, setAccuraciesCategory] = useState<string>("ALL");
  const [issuesSort, setIssuesSort] = useState<"count_desc" | "count_asc" | "name">("count_desc");

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    loadData();
  }, [user, authLoading, projectName, accountId]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener("app:refresh", handler);
    return () => window.removeEventListener("app:refresh", handler);
  }, [projectName, accountId]);

  async function loadData() {
    setLoading(true);
    const { data: proj } = await supabase.from("projects").select("id, name, display_name, account_id").eq("name", projectName).eq("account_id", accountId).maybeSingle();
    if (!proj) { setLoading(false); return; }
    setProject(proj);

    const sixAgo = new Date(); sixAgo.setMonth(sixAgo.getMonth() - 6);
    const { data: snaps } = await supabase.from("snapshots").select("id, test_date, row_count, file_name, uploaded_at").eq("project_id", proj.id).gte("test_date", sixAgo.toISOString().slice(0, 10)).order("test_date", { ascending: true });
    const s = snaps || []; setSnapshots(s);

    const snapIds = s.map((x) => x.id);
    if (snapIds.length) {
      const { data: cats } = await supabase.from("category_metrics").select("*").in("snapshot_id", snapIds);
      setCategoryMetrics(cats || []);

      const latestId = s[s.length - 1]?.id;
      if (latestId) {
        const { data: conf } = await supabase.from("confusion_pairs").select("*").eq("snapshot_id", latestId);
        setConfusionPairs(conf || []);
        // Build issue pairs from raw confusion logic via category_metrics
      }
      setCompareDateA(s[s.length - 1]?.test_date || "");
      setCompareDateB(s.length > 1 ? s[s.length - 2].test_date : s[s.length - 1]?.test_date || "");
    }
    setLoading(false);
  }


  const latestSnap = snapshots[snapshots.length - 1];

  // Per-category latest: for each category_name, pick the row with the most recent test_date
  const perCategoryLatest = useMemo(() => {
    const byCategory: Record<string, { metric: CategoryMetric; test_date: string }> = {};
    snapshots.forEach((snap) => {
      categoryMetrics.filter((cm) => cm.snapshot_id === snap.id).forEach((cm) => {
        const existing = byCategory[cm.category_name];
        if (!existing || snap.test_date > existing.test_date) {
          byCategory[cm.category_name] = { metric: cm, test_date: snap.test_date };
        }
      });
    });
    return byCategory;
  }, [snapshots, categoryMetrics]);

  // Latest date across all categories
  const overallLatestDate = useMemo(() => {
    const dates = Object.values(perCategoryLatest).map((v) => v.test_date);
    return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
  }, [perCategoryLatest]);

  // What to show on Current tab: all categories latest OR only those matching the overall latest date
  const latestCats = useMemo(() => {
    const all = Object.values(perCategoryLatest).map((v) => v.metric);
    if (showLatestOnly && overallLatestDate) {
      return all.filter((_, i) =>
        Object.values(perCategoryLatest)[i].test_date === overallLatestDate
      );
    }
    return all;
  }, [perCategoryLatest, showLatestOnly, overallLatestDate]);
  const categories = useMemo(() => [...new Set(categoryMetrics.map((c) => c.category_name))].sort(), [categoryMetrics]);

  const historicalData = useMemo(() => snapshots.map((snap) => {
    const m = historicalCategory === "ALL" ? categoryMetrics.filter((c) => c.snapshot_id === snap.id) : categoryMetrics.filter((c) => c.snapshot_id === snap.id && c.category_name === historicalCategory);
    const avg = (f: keyof CategoryMetric) => { const v = m.map((x) => x[f]).filter((x): x is number => typeof x === "number"); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length * 100).toFixed(2) : null; };
    return { date: snap.test_date, Group: avg("group_accuracy"), Class: avg("class_accuracy"), GPD: avg("gpd_accuracy"), Openset: avg("openset_accuracy"), OSA: avg("osa_accuracy") };
  }), [snapshots, categoryMetrics, historicalCategory]);

  const snapA = snapshots.find((s) => s.test_date === compareDateA);
  const snapB = snapshots.find((s) => s.test_date === compareDateB);
  const catsA = snapA ? categoryMetrics.filter((c) => c.snapshot_id === snapA.id) : [];
  const catsB = snapB ? categoryMetrics.filter((c) => c.snapshot_id === snapB.id) : [];
  const compareCats = useMemo(() => [...new Set([...catsA.map((c) => c.category_name), ...catsB.map((c) => c.category_name)])].sort(), [catsA, catsB]);

  const filteredAccuracies = useMemo(() => {
    let list = confusionPairs.filter((p) => !p.is_mismatch);
    if (accuraciesCategory !== "ALL") list = list.filter((p) => p.category_name === accuraciesCategory);
    if (accuraciesFilter !== "all") list = list.filter((p) => p.matrix_type === accuraciesFilter);
    if (accuraciesSearch.trim()) list = list.filter((p) => p.actual_value.toLowerCase().includes(accuraciesSearch.toLowerCase()) || p.category_name.toLowerCase().includes(accuraciesSearch.toLowerCase()));
    return list.slice().sort((a, b) => {
      if (accuraciesSort === "accuracy_asc") return a.accuracy_pct - b.accuracy_pct;
      if (accuraciesSort === "accuracy_desc") return b.accuracy_pct - a.accuracy_pct;
      return a.actual_value.localeCompare(b.actual_value);
    });
  }, [confusionPairs, accuraciesFilter, accuraciesSearch, accuraciesSort, accuraciesCategory]);

  function exportCurrentCSV() {
    const header = ["Category", "GPD Acc", "Group Acc", "Class Acc", "Openset Acc", "OSA Acc", "Annotations"];
    const rows = latestCats.map((c) => [c.category_name, formatPct(c.gpd_accuracy), formatPct(c.group_accuracy), formatPct(c.class_accuracy), formatPct(c.openset_accuracy), formatPct(c.osa_accuracy), c.total_annotations ?? "—"]);
    downloadCSV([header, ...rows], `${project?.name}_current_${latestSnap?.test_date}.csv`);
  }

  function exportHistoricalCSV() {
    const header = ["Date", "Group Acc", "Class Acc", "GPD Acc", "Openset Acc", "OSA Acc"];
    const rows = historicalData.map((d) => [d.date, d.Group ?? "—", d.Class ?? "—", d.GPD ?? "—", d.Openset ?? "—", d.OSA ?? "—"]);
    downloadCSV([header, ...rows], `${project?.name}_historical.csv`);
  }

  function exportComparisonCSV() {
    const header = ["Category", `Group (${compareDateA})`, `Group (${compareDateB})`, `Class (${compareDateA})`, `Class (${compareDateB})`];
    const rows = compareCats.map((cat) => {
      const a = catsA.find((c) => c.category_name === cat); const b = catsB.find((c) => c.category_name === cat);
      const gd = a?.group_accuracy != null && b?.group_accuracy != null ? ((b.group_accuracy - a.group_accuracy) * 100).toFixed(2) + "%" : "—";
      return [cat, formatPct(a?.group_accuracy), formatPct(b?.group_accuracy), formatPct(a?.class_accuracy), formatPct(b?.class_accuracy)];
    });
    downloadCSV([header, ...rows], `${project?.name}_comparison_${compareDateA}_vs_${compareDateB}.csv`);
  }

  function exportAccuraciesCSV() {
    const header = ["Category", "Type", "Group/Class name", "Accuracy %", "Correct", "Total"];
    const rows = filteredAccuracies.map((p) => [p.category_name, p.matrix_type, p.actual_value, p.accuracy_pct.toFixed(2) + "%", p.self_count, p.total_count]);
    downloadCSV([header, ...rows], `${project?.name}_accuracies_${latestSnap?.test_date}.csv`);
  }

  function downloadCSV(rows: any[], filename: string) {
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  if (authLoading || loading) return <div style={{ minHeight: "100vh" }}><TopNav accountId={accountId} /></div>;
  if (!project) return <div style={{ minHeight: "100vh" }}><TopNav accountId={accountId} /><div style={{ padding: "2rem" }}><p style={{ color: "var(--text-muted)" }}>Project not found.</p></div></div>;

  const overallStatus = getHealthStatus(latestCats.flatMap((c) => [c.group_accuracy, c.class_accuracy]));
  const statusStyle = healthColor(overallStatus);

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav accountId={accountId} />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem" }}>
<Breadcrumb crumbs={[{ label: "Accounts", href: "/" }, { label: "Projects", href: `/account/${accountId}` }, { label: project?.display_name || project?.name || "…" }]} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 12 }}>
          <h1 style={{ fontSize: 24, fontWeight: 500, color: "var(--text-primary)", margin: 0, letterSpacing: "-0.01em" }}>{project.display_name || project.name}</h1>
          {latestSnap && <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 20, background: statusStyle.bg, color: statusStyle.text, display: "flex", alignItems: "center", gap: 5 }}>
            <i className={`ti ${statusStyle.icon}`} aria-hidden="true" style={{ fontSize: 13 }}></i>
            {overallStatus === "healthy" ? "All metrics healthy" : overallStatus === "warning" ? "Needs attention" : "Critical"}
          </span>}
        </div>
        {snapshots.length > 0 && <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 20px" }}>{snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""} · last 6 months</p>}

        <div style={{ display: "flex", gap: 4, borderBottom: "0.5px solid var(--border)", marginBottom: 20 }}>
          {(["current", "historical", "comparison", "issues"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ padding: "8px 14px", fontSize: 13, fontWeight: tab === t ? 500 : 400, color: tab === t ? "var(--text-primary)" : "var(--text-muted)", background: "transparent", border: "none", borderBottom: tab === t ? "2px solid var(--fill-accent)" : "2px solid transparent", cursor: "pointer", borderRadius: 0, textTransform: "capitalize", transition: "color 0.15s, border-color 0.2s" }}>
              {t}
            </button>
          ))}
        </div>

        {!snapshots.length ? (
          <div style={{ textAlign: "center", padding: "3rem", background: "var(--surface-1)", borderRadius: 12 }}>
            <p style={{ color: "var(--text-muted)", margin: "0 0 12px" }}>No data uploaded yet.</p>
            <button className="primary" onClick={() => router.push("/upload")}>Upload data</button>
          </div>
        ) : (
          <div key={tab} style={{ animation: "tabFadeIn 0.2s ease-out" }}>

            {tab === "current" && (
              <div>
                <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
                  <InfoChip icon="ti-calendar" label="Test date" value={formatDate(latestSnap.test_date)} />
                  <InfoChip icon="ti-photo" label="Annotations" value={formatNumber(latestSnap.row_count)} />
                  <InfoChip icon="ti-category" label="Categories" value={String(latestCats.length)} />
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", margin: 0 }}>Category metrics</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-muted)", cursor: "pointer" }}>
                      <input type="checkbox" checked={showLatestOnly} onChange={(e) => setShowLatestOnly(e.target.checked)} style={{ accentColor: "var(--fill-accent)" }} />
                      Latest date only ({overallLatestDate ? formatDate(overallLatestDate) : "—"})
                    </label>
                    <button onClick={exportCurrentCSV} style={{ fontSize: 12, padding: "5px 10px" }}><i className="ti ti-download" aria-hidden="true" style={{ marginRight: 4, fontSize: 13 }}></i>Export</button>
                  </div>
                </div>
                <div style={{ overflowX: "auto", background: "var(--surface-1)", borderRadius: 12, padding: "0.5rem", marginBottom: 28 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr style={{ borderBottom: "0.5px solid var(--border)" }}>
                      {["Category", "Date", "GPD", "Group acc.", "Class acc.", "Openset", "OSA", "Annotations"].map((h) => (
                        <th key={h} style={{ textAlign: "left", padding: "8px 10px", color: "var(--text-muted)", fontWeight: 500, fontSize: 12 }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {latestCats.slice().sort((a, b) => a.category_name.localeCompare(b.category_name)).map((c) => (
                        <tr key={c.category_name} style={{ borderBottom: "0.5px solid var(--border)" }}>
                          <td style={{ padding: "8px 10px", fontWeight: 500, color: "var(--text-primary)" }}>{c.category_name}</td>
                          <td style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 12, whiteSpace: "nowrap" }}>{formatDate(perCategoryLatest[c.category_name]?.test_date)}</td>
                          {([c.gpd_accuracy, c.group_accuracy, c.class_accuracy, c.openset_accuracy, c.osa_accuracy] as (number | null)[]).map((v, i) => <td key={i} style={{ padding: "8px 10px" }}><Pill val={v} /></td>)}
                          <td style={{ padding: "8px 10px", color: "var(--text-muted)" }}>{formatNumber(c.total_annotations)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Accuracies section (renamed, with group/class toggle) */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", margin: 0 }}>
                    Accuracies{confusionPairs.length > 0 && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> ({filteredAccuracies.length})</span>}
                  </p>
                  <div style={{ display: "flex", gap: 6 }}>
                    <select value={accuraciesCategory} onChange={(e) => setAccuraciesCategory(e.target.value)} style={{ fontSize: 12 }}>
                      <option value="ALL">All categories</option>
                      {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input type="text" placeholder="Search" value={accuraciesSearch} onChange={(e) => setAccuraciesSearch(e.target.value)} style={{ width: 140, fontSize: 12 }} />
                    <select value={accuraciesFilter} onChange={(e) => setAccuraciesFilter(e.target.value as any)} style={{ fontSize: 12 }}>
                      <option value="all">All</option>
                      <option value="group">Group</option>
                      <option value="class">Class</option>
                    </select>
                    <select value={accuraciesSort} onChange={(e) => setAccuraciesSort(e.target.value as any)} style={{ fontSize: 12 }}>
                      <option value="accuracy_asc">Sort: worst first</option>
                      <option value="accuracy_desc">Sort: best first</option>
                      <option value="name">Sort: name</option>
                    </select>
                    <button onClick={exportAccuraciesCSV} style={{ fontSize: 12, padding: "5px 10px" }}><i className="ti ti-download" aria-hidden="true" style={{ marginRight: 4, fontSize: 13 }}></i>Export</button>
                  </div>
                </div>
                {!filteredAccuracies.length ? (
                  <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{confusionPairs.length ? "No items match your filter." : "No accuracy data found for this snapshot."}</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 480, overflowY: "auto" }}>
                    {filteredAccuracies.map((p, i) => {
                      const pct = p.accuracy_pct;
                      const bc = pct >= 95 ? "var(--fill-success)" : pct >= 85 ? "var(--fill-warning)" : "var(--fill-danger)";
                      const tc = pct >= 95 ? "var(--text-success)" : pct >= 85 ? "var(--text-warning)" : "var(--text-danger)";
                      return (
                        <div key={i} style={{ background: "var(--surface-1)", borderRadius: 8, padding: "10px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 12 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                              <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "var(--bg-accent)", color: "var(--text-accent)", whiteSpace: "nowrap", letterSpacing: "0.03em" }}>{p.matrix_type}</span>
                              <span style={{ fontSize: 13, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.actual_value}>{p.actual_value}</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 4, flexShrink: 0 }}>
                              <span style={{ fontSize: 16, fontWeight: 600, color: tc }}>{pct.toFixed(2)}%</span>
                              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.self_count}/{p.total_count}</span>
                            </div>
                          </div>
                          <div style={{ height: 4, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
                            <div style={{ height: "100%", borderRadius: 4, background: bc, width: `${pct}%`, transition: "width 0.5s ease-out" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {tab === "historical" && (
              <div>
                {snapshots.length < 2 && <div style={{ background: "var(--bg-accent)", border: "0.5px solid var(--border-accent)", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}><p style={{ fontSize: 12, color: "var(--text-accent)", margin: 0 }}>Only one snapshot so far — trend lines will appear once you have more dates.</p></div>}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
                  <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""} · last 6 months</p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select value={historicalCategory} onChange={(e) => setHistoricalCategory(e.target.value)}>
                      <option value="ALL">All categories (avg)</option>
                      {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button onClick={exportHistoricalCSV} style={{ fontSize: 12, padding: "5px 10px" }}><i className="ti ti-download" aria-hidden="true" style={{ marginRight: 4, fontSize: 13 }}></i>Export</button>
                  </div>
                </div>
                <div style={{ background: "var(--surface-1)", borderRadius: 12, padding: 16 }}>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={historicalData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={12} />
                      <YAxis stroke="var(--text-muted)" fontSize={12} domain={([dataMin, dataMax]: [number,number]) => { const pad = 5; return [Math.max(0, Math.floor(dataMin - pad)), Math.min(100, Math.ceil(dataMax + pad))]; }} allowDataOverflow={false} />
                      <Tooltip contentStyle={{ background: "var(--surface-popover)", border: "0.5px solid var(--border)", borderRadius: 8, fontSize: 13 }} labelFormatter={(d) => formatDate(d as string)} />
                      <Legend />
                      <Line type="monotone" dataKey="Group" stroke="#378ADD" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="Class" stroke="#1D9E75" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="GPD" stroke="#D85A30" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="Openset" stroke="#7F77DD" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="OSA" stroke="#BA7517" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {tab === "comparison" && (
              <div>
                <div style={{ display: "flex", gap: 16, marginBottom: 20, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div><label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Date A</label><select value={compareDateA} onChange={(e) => setCompareDateA(e.target.value)}>{snapshots.map((s) => <option key={s.id} value={s.test_date}>{formatDate(s.test_date)}</option>)}</select></div>
                  <div><label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Date B</label><select value={compareDateB} onChange={(e) => setCompareDateB(e.target.value)}>{snapshots.map((s) => <option key={s.id} value={s.test_date}>{formatDate(s.test_date)}</option>)}</select></div>
                  <button onClick={exportComparisonCSV} style={{ marginLeft: "auto", fontSize: 12, padding: "7px 12px" }}><i className="ti ti-download" aria-hidden="true" style={{ marginRight: 4, fontSize: 13 }}></i>Export CSV</button>
                </div>
                <div style={{ overflowX: "auto", background: "var(--surface-1)", borderRadius: 12, padding: "0.5rem" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr style={{ borderBottom: "0.5px solid var(--border)" }}>
                      <th style={TH}>Category</th>
                      <th style={TH}>Group ({formatDate(compareDateA)})</th>
                      <th style={TH}>Group ({formatDate(compareDateB)})</th>
                      <th style={TH}>Δ Group</th>
                      <th style={TH}>Class ({formatDate(compareDateA)})</th>
                      <th style={TH}>Class ({formatDate(compareDateB)})</th>
                      <th style={TH}>Δ Class</th>
                    </tr></thead>
                    <tbody>
                      {compareCats.map((cat) => {
                        const a = catsA.find((c) => c.category_name === cat), b = catsB.find((c) => c.category_name === cat);
                        const gd = a?.group_accuracy != null && b?.group_accuracy != null ? b.group_accuracy - a.group_accuracy : null;
                        const cd = a?.class_accuracy != null && b?.class_accuracy != null ? b.class_accuracy - a.class_accuracy : null;
                        return (
                          <tr key={cat} style={{ borderBottom: "0.5px solid var(--border)" }}>
                            <td style={{ ...TD, fontWeight: 500 }}>{cat}</td>
                            <td style={TD}><Pill val={a?.group_accuracy ?? null} /></td>
                            <td style={TD}><Pill val={b?.group_accuracy ?? null} /></td>
                            <td style={TD}><Delta val={gd} /></td>
                            <td style={TD}><Pill val={a?.class_accuracy ?? null} /></td>
                            <td style={TD}><Pill val={b?.class_accuracy ?? null} /></td>
                            <td style={TD}><Delta val={cd} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === "issues" && (
              <IssuesTab
                snapId={latestSnap?.id}
                testDate={latestSnap?.test_date}
                projectId={project.id}
                issuesFilter={issuesFilter}
                setIssuesFilter={setIssuesFilter}
                issuesSort={issuesSort}
                setIssuesSort={setIssuesSort}
                issuesSearch={issuesSearch}
                setIssuesSearch={setIssuesSearch}
                projectName={project.name}
              />
            )}
          </div>
        )}
      </div>
      <style>{`@keyframes tabFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}

function IssuesTab({ snapId, testDate, issuesFilter, setIssuesFilter, issuesSort, setIssuesSort, issuesSearch, setIssuesSearch, projectName }: any) {
  const supabase = createClient();
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLatestOnly, setShowLatestOnly] = useState(false);

  useEffect(() => {
    if (!snapId) { setLoading(false); return; }
    loadIssues();
  }, [snapId]);

  async function loadIssues() {
    setLoading(true);
    const { data } = await supabase
      .from("confusion_pairs")
      .select("*")
      .eq("snapshot_id", snapId)
      .eq("is_mismatch", true);
    setIssues(data || []);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    let list = issues;
    if (issuesFilter !== "all") list = list.filter((p: any) => p.matrix_type === issuesFilter);
    if (issuesSearch.trim()) {
      const q = issuesSearch.toLowerCase();
      list = list.filter((p: any) =>
        p.actual_value.toLowerCase().includes(q) ||
        p.predicted_value.toLowerCase().includes(q) ||
        p.category_name.toLowerCase().includes(q)
      );
    }
    return list.slice().sort((a: any, b: any) => {
      if (issuesSort === "count_desc") return b.count - a.count;
      if (issuesSort === "count_asc") return a.count - b.count;
      if (issuesSort === "accuracy_asc") return a.accuracy_pct - b.accuracy_pct;
      return a.actual_value.localeCompare(b.actual_value);
    });
  }, [issues, issuesFilter, issuesSearch, issuesSort]);

  function exportIssuesCSV() {
    const header = ["Category", "Type", "Actual", "Predicted as", "Count", "Group/Class accuracy"];
    const rows = filtered.map((p: any) => [p.category_name, p.matrix_type, p.actual_value, p.predicted_value, p.count, p.accuracy_pct.toFixed(2) + "%"]);
    const csv = [header, ...rows].map((r: any[]) => r.map(String).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${projectName}_issues_${testDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", margin: 0 }}>
          Groups and classes with issues
          {filtered.length > 0 && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> ({filtered.length})</span>}
        </p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input type="text" placeholder="Search" value={issuesSearch} onChange={(e) => setIssuesSearch(e.target.value)} style={{ width: 140, fontSize: 12 }} />
          <select value={issuesFilter} onChange={(e) => setIssuesFilter(e.target.value)} style={{ fontSize: 12 }}>
            <option value="all">All</option>
            <option value="group">Group</option>
            <option value="class">Class</option>
          </select>
          <select value={issuesSort} onChange={(e) => setIssuesSort(e.target.value)} style={{ fontSize: 12 }}>
            <option value="count_desc">Sort: most occurrences</option>
            <option value="count_asc">Sort: fewest occurrences</option>
            <option value="accuracy_asc">Sort: worst accuracy</option>
            <option value="name">Sort: name</option>
          </select>
          {filtered.length > 0 && <button onClick={exportIssuesCSV} style={{ fontSize: 12, padding: "5px 10px" }}><i className="ti ti-download" aria-hidden="true" style={{ marginRight: 4, fontSize: 13 }}></i>Export</button>}
        </div>
      </div>

      {loading ? <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</p> :
        !issues.length ? (
          <div style={{ background: "var(--surface-1)", borderRadius: 12, padding: "2rem", textAlign: "center" }}>
            <i className="ti ti-circle-check" aria-hidden="true" style={{ fontSize: 24, color: "var(--text-success)", display: "block", marginBottom: 8 }}></i>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 4px" }}>No mismatches found.</p>
            <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>All predicted groups and classes match the actual values — or re-upload your data to populate this tab.</p>
          </div>
        ) : !filtered.length ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No issues match your filter.</p>
        ) : (
          <div style={{ overflowX: "auto", background: "var(--surface-1)", borderRadius: 12, padding: "0.5rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ borderBottom: "0.5px solid var(--border)" }}>
                <th style={TH}>Category</th>
                <th style={TH}>Type</th>
                <th style={TH}>Actual</th>
                <th style={TH}>Predicted as</th>
                <th style={TH}>Count</th>
                <th style={TH}>Acc. %</th>
              </tr></thead>
              <tbody>
                {filtered.map((p: any, i: number) => {
                  const tc = p.accuracy_pct >= 95 ? "var(--text-success)" : p.accuracy_pct >= 85 ? "var(--text-warning)" : "var(--text-danger)";
                  return (
                    <tr key={i} style={{ borderBottom: "0.5px solid var(--border)" }}>
                      <td style={{ ...TD, color: "var(--text-muted)", fontSize: 12 }}>{p.category_name}</td>
                      <td style={TD}><span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "var(--bg-accent)", color: "var(--text-accent)" }}>{p.matrix_type}</span></td>
                      <td style={{ ...TD, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.actual_value}>{p.actual_value}</td>
                      <td style={{ ...TD, color: "var(--text-danger)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.predicted_value}>{p.predicted_value}</td>
                      <td style={{ ...TD, color: "var(--text-muted)", fontWeight: 500 }}>{p.count}</td>
                      <td style={{ ...TD, color: tc, fontWeight: 500 }}>{p.accuracy_pct.toFixed(2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

function Pill({ val }: { val: number | null }) {
  const c = pillColor(val);
  return <span style={{ background: c.bg, color: c.text, padding: "2px 8px", borderRadius: 20, fontSize: 12, whiteSpace: "nowrap" }}>{formatPct(val, 2)}</span>;
}
function Delta({ val }: { val: number | null }) {
  if (val == null) return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>;
  const p = val * 100; const color = p > 0.05 ? "var(--text-success)" : p < -0.05 ? "var(--text-danger)" : "var(--text-muted)";
  return <span style={{ color, fontSize: 12, fontWeight: 500 }}>{p > 0 ? "+" : ""}{p.toFixed(2)}%</span>;
}
function InfoChip({ icon, label, value }: { icon: string; label: string; value: string }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-1)", borderRadius: 8, padding: "8px 12px" }}><i className={`ti ${icon}`} aria-hidden="true" style={{ fontSize: 15, color: "var(--text-muted)" }}></i><div><div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.2 }}>{label}</div><div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>{value}</div></div></div>;
}
const TH: React.CSSProperties = { textAlign: "left", padding: "8px 10px", color: "var(--text-muted)", fontWeight: 500, fontSize: 12 };
const TD: React.CSSProperties = { padding: "8px 10px", color: "var(--text-primary)" };
