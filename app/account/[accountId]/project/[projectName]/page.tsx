"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";
import TopNav from "@/components/TopNav";
import Breadcrumb from "@/components/Breadcrumb";
import ErrorBoundary from "@/components/ErrorBoundary";
import { SkeletonTable, SkeletonText } from "@/components/Skeleton";
import { useAuth } from "@/lib/auth";
import { formatDate, formatPct, formatNumber, pillColor, getHealthStatus, healthColor } from "@/lib/format";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface Project { id: string; name: string; display_name: string | null; account_id: string; }
interface Snapshot { id: string; test_date: string; row_count: number; file_name: string | null; uploaded_at: string; uploaded_by: string | null; }
interface CategoryMetric {
  snapshot_id: string; category_name: string; total_annotations: number | null; image_count: number | null;
  gpd_accuracy: number | null; group_accuracy: number | null; class_accuracy: number | null;
  openset_accuracy: number | null; osa_accuracy: number | null;
  sticker_detector_accuracy: number | null; sticker_value_accuracy: number | null;
}
interface ConfusionPair {
  snapshot_id: string; category_name: string; matrix_type: "class" | "group";
  actual_value: string; predicted_value: string; count: number;
  self_count: number; total_count: number; accuracy_pct: number; is_mismatch: boolean;
}
interface Comment { id: string; snapshot_id: string; author_email: string; body: string; created_at: string; }
type Tab = "current" | "historical" | "comparison" | "issues" | "mistakes";

const METRICS = [
  { key: "gpd_accuracy", label: "GPD" },
  { key: "group_accuracy", label: "Group acc." },
  { key: "class_accuracy", label: "Class acc." },
  { key: "openset_accuracy", label: "Openset" },
  { key: "osa_accuracy", label: "OSA" },
  { key: "sticker_detector_accuracy", label: "Sticker Det." },
];

export default function ProjectPage() {
  const router = useRouter();
  const { accountId, projectName } = useParams() as { accountId: string; projectName: string };
  const supabase = createClient();
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [categoryMetrics, setCategoryMetrics] = useState<CategoryMetric[]>([]);
  const [confusionPairs, setConfusionPairs] = useState<ConfusionPair[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [tab, setTab] = useState<Tab>("current");
  const [historicalCategory, setHistoricalCategory] = useState("ALL");
  const [chartMetrics, setChartMetrics] = useState(["group_accuracy", "class_accuracy", "gpd_accuracy"]);
  const [compareDateA, setCompareDateA] = useState("");
  const [compareDateB, setCompareDateB] = useState("");
  const [accuraciesFilter, setAccuraciesFilter] = useState<"all" | "class" | "group">("all");
  const [accuraciesSearch, setAccuraciesSearch] = useState("");
  const [accuraciesSort, setAccuraciesSort] = useState<"accuracy_asc" | "accuracy_desc" | "name">("accuracy_asc");
  const [accuraciesCategory, setAccuraciesCategory] = useState("ALL");
  const [accuraciesThreshold, setAccuraciesThreshold] = useState(100);
  const [accuraciesPage, setAccuraciesPage] = useState(1);
  const PAGE_SIZE = 50;
  const [issuesFilter, setIssuesFilter] = useState<"all" | "class" | "group">("all");
  const [issuesSort, setIssuesSort] = useState<"count_desc" | "count_asc" | "accuracy_asc" | "name">("count_desc");
  const [issuesSearch, setIssuesSearch] = useState("");
  const [mistakesCategory, setMistakesCategory] = useState("ALL");
  const [mistakesType, setMistakesType] = useState<"all" | "class" | "group">("all");
  const [showLatestOnly, setShowLatestOnly] = useState(false);
  const [showComments, setShowComments] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError(null);
    try {
      const { data: proj } = await supabase.from("projects").select("id, name, display_name, account_id").eq("name", projectName).eq("account_id", accountId).maybeSingle();
      if (!proj) { setLoading(false); return; }
      setProject(proj);

      const sixAgo = new Date(); sixAgo.setMonth(sixAgo.getMonth() - 6);
      const { data: snaps } = await supabase.from("snapshots").select("id, test_date, row_count, file_name, uploaded_at, uploaded_by").eq("project_id", proj.id).gte("test_date", sixAgo.toISOString().slice(0, 10)).order("test_date", { ascending: true });
      const s = snaps || []; setSnapshots(s);

      const snapIds = s.map((x) => x.id);
      if (snapIds.length) {
        const { data: cats } = await supabase.from("category_metrics").select("*").in("snapshot_id", snapIds);
        setCategoryMetrics(cats || []);

        // Fetch confusion_pairs from ALL snapshots — with the per-category system,
        // pairs may be stored in any snapshot (whichever was current at upload time).
        const { data: conf } = await supabase.from("confusion_pairs").select("*").in("snapshot_id", snapIds);
        setConfusionPairs(conf || []);

        const latestId = s[s.length - 1]?.id;
        if (latestId) {
          // Load comments for latest snapshot
          try {
            const { data: comms } = await supabase.from("snapshot_comments").select("*").eq("snapshot_id", latestId).order("created_at", { ascending: true });
            setComments(comms || []);
          } catch { setComments([]); }
        }
        setCompareDateA(s[s.length - 1]?.test_date || "");
        setCompareDateB(s.length > 1 ? s[s.length - 2].test_date : s[s.length - 1]?.test_date || "");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load project data");
    } finally {
      setLoading(false);
    }
  }, [user, projectName, accountId]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    loadData();
  }, [user, authLoading]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener("app:refresh", handler);
    return () => window.removeEventListener("app:refresh", handler);
  }, [loadData]);

  // Per-category latest
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

  const overallLatestDate = useMemo(() => {
    const dates = Object.values(perCategoryLatest).map((v) => v.test_date);
    return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
  }, [perCategoryLatest]);

  const latestCats = useMemo(() => {
    const all = Object.values(perCategoryLatest).map((v) => v.metric);
    if (showLatestOnly && overallLatestDate) {
      return all.filter((_, i) => Object.values(perCategoryLatest)[i].test_date === overallLatestDate);
    }
    return all;
  }, [perCategoryLatest, showLatestOnly, overallLatestDate]);

  const latestSnap = snapshots[snapshots.length - 1];
  const categories = useMemo(() => [...new Set(categoryMetrics.map((c) => c.category_name))].sort(), [categoryMetrics]);

  const historicalData = useMemo(() => snapshots.map((snap) => {
    const m = historicalCategory === "ALL"
      ? categoryMetrics.filter((c) => c.snapshot_id === snap.id)
      : categoryMetrics.filter((c) => c.snapshot_id === snap.id && c.category_name === historicalCategory);
    const avg = (f: keyof CategoryMetric) => { const v = m.map((x) => x[f]).filter((x): x is number => typeof x === "number"); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length * 100).toFixed(2) : null; };
    return { date: snap.test_date, group_accuracy: avg("group_accuracy"), class_accuracy: avg("class_accuracy"), gpd_accuracy: avg("gpd_accuracy"), openset_accuracy: avg("openset_accuracy"), osa_accuracy: avg("osa_accuracy"), sticker_detector_accuracy: avg("sticker_detector_accuracy") };
  }), [snapshots, categoryMetrics, historicalCategory]);

  const snapA = snapshots.find((s) => s.test_date === compareDateA);
  const snapB = snapshots.find((s) => s.test_date === compareDateB);
  const catsA = snapA ? categoryMetrics.filter((c) => c.snapshot_id === snapA.id) : [];
  const catsB = snapB ? categoryMetrics.filter((c) => c.snapshot_id === snapB.id) : [];
  const compareCats = useMemo(() => [...new Set([...catsA.map((c) => c.category_name), ...catsB.map((c) => c.category_name)])].sort(), [catsA, catsB]);

  // Comparison delta summary
  const comparisonSummary = useMemo(() => {
    if (!catsA.length || !catsB.length) return null;
    let improved = 0, declined = 0, unchanged = 0;
    compareCats.forEach((cat) => {
      const a = catsA.find((c) => c.category_name === cat);
      const b = catsB.find((c) => c.category_name === cat);
      if (!a?.group_accuracy || !b?.group_accuracy) return;
      const d = b.group_accuracy - a.group_accuracy;
      if (d > 0.001) improved++; else if (d < -0.001) declined++; else unchanged++;
    });
    return { improved, declined, unchanged };
  }, [catsA, catsB, compareCats]);

  const filteredAccuracies = useMemo(() => {
    let list = confusionPairs.filter((p) => !p.is_mismatch);
    if (accuraciesCategory !== "ALL") list = list.filter((p) => p.category_name === accuraciesCategory);
    if (accuraciesFilter !== "all") list = list.filter((p) => p.matrix_type === accuraciesFilter);
    if (accuraciesThreshold < 100) list = list.filter((p) => p.accuracy_pct < accuraciesThreshold);
    if (accuraciesSearch.trim()) list = list.filter((p) => p.actual_value.toLowerCase().includes(accuraciesSearch.toLowerCase()) || p.category_name.toLowerCase().includes(accuraciesSearch.toLowerCase()));
    return list.sort((a, b) => {
      if (accuraciesSort === "accuracy_asc") return a.accuracy_pct - b.accuracy_pct;
      if (accuraciesSort === "accuracy_desc") return b.accuracy_pct - a.accuracy_pct;
      return a.actual_value.localeCompare(b.actual_value);
    });
  }, [confusionPairs, accuraciesCategory, accuraciesFilter, accuraciesThreshold, accuraciesSearch, accuraciesSort]);

  const paginatedAccuracies = useMemo(() => filteredAccuracies.slice((accuraciesPage - 1) * PAGE_SIZE, accuraciesPage * PAGE_SIZE), [filteredAccuracies, accuraciesPage]);
  const totalPages = Math.ceil(filteredAccuracies.length / PAGE_SIZE);
  const at100Count = confusionPairs.filter((p) => !p.is_mismatch && p.accuracy_pct >= 100).length;

  const mistakesData = useMemo(() => {
    let list = confusionPairs.filter((p) => p.is_mismatch);
    if (mistakesCategory !== "ALL") list = list.filter((p) => p.category_name === mistakesCategory);
    if (mistakesType !== "all") list = list.filter((p) => p.matrix_type === mistakesType);
    return list.sort((a, b) => b.count - a.count);
  }, [confusionPairs, mistakesCategory, mistakesType]);

  const overallStatus = getHealthStatus(latestCats.flatMap((c) => [c.group_accuracy, c.class_accuracy]));
  const statusStyle = healthColor(overallStatus);

  function downloadCSV(rows: any[][], filename: string) {
    const csv = rows.map((r) => r.map(String).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function exportCurrentCSV() {
    const header = ["Category", "Date", "GPD", "Group acc", "Class acc", "Openset", "OSA", "Sticker Det.", "Annotations", "Images"];
    const rows = latestCats.map((c) => [c.category_name, perCategoryLatest[c.category_name]?.test_date || "", formatPct(c.gpd_accuracy), formatPct(c.group_accuracy), formatPct(c.class_accuracy), formatPct(c.openset_accuracy), formatPct(c.osa_accuracy), formatPct(c.sticker_detector_accuracy), c.total_annotations ?? "", c.image_count ?? ""]);
    downloadCSV([header, ...rows], `${project?.name}_current.csv`);
  }
  function exportHistoricalCSV() {
    const header = ["Date", ...chartMetrics.map((k) => METRICS.find((m) => m.key === k)?.label || k)];
    const rows = historicalData.map((d) => [d.date, ...chartMetrics.map((k) => d[k as keyof typeof d] ?? "—")]);
    downloadCSV([header, ...rows], `${project?.name}_historical.csv`);
  }
  function exportComparisonCSV() {
    const header = ["Category", `Group (${compareDateA})`, `Group (${compareDateB})`, "Δ Group", `Class (${compareDateA})`, `Class (${compareDateB})`, "Δ Class"];
    const rows = compareCats.map((cat) => {
      const a = catsA.find((c) => c.category_name === cat), b = catsB.find((c) => c.category_name === cat);
      const gd = a?.group_accuracy != null && b?.group_accuracy != null ? ((b.group_accuracy - a.group_accuracy) * 100).toFixed(2) + "%" : "—";
      const cd = a?.class_accuracy != null && b?.class_accuracy != null ? ((b.class_accuracy - a.class_accuracy) * 100).toFixed(2) + "%" : "—";
      return [cat, formatPct(a?.group_accuracy), formatPct(b?.group_accuracy), gd, formatPct(a?.class_accuracy), formatPct(b?.class_accuracy), cd];
    });
    downloadCSV([header, ...rows], `${project?.name}_comparison.csv`);
  }
  function exportAccuraciesCSV() {
    const header = ["Category", "Type", "Name", "Accuracy %", "Correct", "Total"];
    downloadCSV([header, ...filteredAccuracies.map((p) => [p.category_name, p.matrix_type, p.actual_value, p.accuracy_pct.toFixed(2) + "%", p.self_count, p.total_count])], `${project?.name}_accuracies.csv`);
  }
  function exportMistakesCSV() {
    const header = ["Category", "Type", "Actual", "Predicted as", "Count"];
    downloadCSV([header, ...mistakesData.map((p) => [p.category_name, p.matrix_type, p.actual_value, p.predicted_value, p.count])], `${project?.name}_mistakes.csv`);
  }

  async function postComment() {
    if (!newComment.trim() || !latestSnap) return;
    setPostingComment(true);
    try {
      const { data } = await supabase.from("snapshot_comments").insert({ snapshot_id: latestSnap.id, author_email: user?.email, body: newComment.trim() }).select().single();
      if (data) setComments((prev) => [...prev, data]);
      setNewComment("");
    } catch {}
    setPostingComment(false);
  }

  const CHART_COLORS: Record<string, string> = {
    group_accuracy: "#378ADD", class_accuracy: "#1D9E75", gpd_accuracy: "#D85A30",
    openset_accuracy: "#7F77DD", osa_accuracy: "#BA7517", sticker_detector_accuracy: "#993556",
  };

  if (authLoading || loading) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <TopNav accountId={accountId} />
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem" }}>
          <div style={{ height: 12, width: 200, marginBottom: 24 }} className="skeleton" />
          <div style={{ height: 28, width: 300, marginBottom: 8 }} className="skeleton" />
          <div style={{ height: 14, width: 180, marginBottom: 24 }} className="skeleton" />
          <SkeletonTable rows={4} cols={6} />
        </div>
      </div>
    );
  }

  if (error) return (
    <div style={{ minHeight: "100vh" }}><TopNav accountId={accountId} />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem" }}>
        <div style={{ background: "var(--bg-danger)", border: "0.5px solid var(--border-danger)", borderRadius: "var(--radius-lg)", padding: "1.25rem" }}>
          <p style={{ color: "var(--text-danger)", fontWeight: 500 }}>Failed to load project</p>
          <p style={{ color: "var(--text-danger)", fontSize: 13, opacity: 0.8, margin: "4px 0 12px" }}>{error}</p>
          <button onClick={loadData}>Try again</button>
        </div>
      </div>
    </div>
  );
  if (!project) return <div style={{ minHeight: "100vh" }}><TopNav accountId={accountId} /><div style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem" }}><p style={{ color: "var(--text-muted)" }}>Project not found.</p></div></div>;

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav accountId={accountId} />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem" }}>
        <Breadcrumb crumbs={[{ label: "Accounts", href: "/" }, { label: "Projects", href: `/account/${accountId}` }, { label: project.display_name || project.name }]} />

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 26, letterSpacing: "-0.02em", marginBottom: 4 }}>{project.display_name || project.name}</h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""} · last 6 months</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {latestSnap && <span className="pill" style={{ background: statusStyle.bg, color: statusStyle.text }}>
              <i className={`ti ${statusStyle.icon}`} aria-hidden="true" style={{ fontSize: 12 }}></i>
              {overallStatus === "healthy" ? "Healthy" : overallStatus === "warning" ? "Needs attention" : "Critical"}
            </span>}
            <button onClick={() => setShowComments(!showComments)} style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
              <i className="ti ti-message-circle" aria-hidden="true" style={{ fontSize: 14 }}></i>
              Notes {comments.length > 0 && `(${comments.length})`}
            </button>
          </div>
        </div>

        {/* Comments panel */}
        {showComments && (
          <div style={{ background: "var(--surface-1)", border: "0.5px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1rem", marginBottom: 20, animation: "slideUp 0.2s ease-out" }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 10px" }}>Notes for {formatDate(latestSnap?.test_date)}</p>
            {!comments.length ? <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>No notes yet. Add context about this snapshot — e.g. "T_7 low due to lighting issues."</p>
              : <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                  {comments.map((c) => (
                    <div key={c.id} style={{ background: "var(--surface-2)", borderRadius: "var(--radius)", padding: "8px 12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-accent)" }}>{c.author_email.split("@")[0]}</span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{new Date(c.created_at).toLocaleDateString()}</span>
                      </div>
                      <p style={{ fontSize: 13, color: "var(--text-primary)" }}>{c.body}</p>
                    </div>
                  ))}
                </div>}
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" placeholder="Add a note…" value={newComment} onChange={(e) => setNewComment(e.target.value)} onKeyDown={(e) => e.key === "Enter" && postComment()} style={{ flex: 1 }} />
              <button className="primary" onClick={postComment} disabled={postingComment || !newComment.trim()}>{postingComment ? "Posting…" : "Add"}</button>
            </div>
          </div>
        )}

        <div className="tab-bar" style={{ marginBottom: 24 }}>
          {(["current", "historical", "comparison", "issues", "mistakes"] as Tab[]).map((t) => (
            <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {t === "mistakes" ? "AI Mistakes" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {!snapshots.length ? (
          <div style={{ textAlign: "center", padding: "4rem 2rem", background: "var(--surface-1)", borderRadius: "var(--radius-xl)", border: "0.5px solid var(--border)" }}>
            <i className="ti ti-cloud-upload" aria-hidden="true" style={{ fontSize: 36, color: "var(--text-muted)", display: "block", marginBottom: 12 }}></i>
            <p style={{ fontSize: 16, fontWeight: 500, color: "var(--text-primary)", marginBottom: 6 }}>No data uploaded yet</p>
            <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>Upload a df_out CSV to start tracking accuracy for this project.</p>
            <button className="primary" onClick={() => router.push("/upload")}><i className="ti ti-upload" aria-hidden="true" style={{ marginRight: 6 }}></i>Upload data</button>
          </div>
        ) : (
          <div key={tab} style={{ animation: "tabFadeIn 0.2s ease-out" }}>

            {/* ===== CURRENT TAB ===== */}
            {tab === "current" && (
              <ErrorBoundary label="Category metrics failed to load" onRetry={loadData}>
                <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
                  <InfoChip icon="ti-calendar" label="Latest date" value={formatDate(overallLatestDate)} />
                  <InfoChip icon="ti-photo" label="Annotations" value={formatNumber(latestSnap?.row_count)} />
                  <InfoChip icon="ti-category" label="Categories" value={String(latestCats.length)} />
                  <InfoChip icon="ti-images" label="Images" value={formatNumber(latestCats.reduce((a, c) => a + (c.image_count || 0), 0))} />
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Category metrics</p>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-muted)", cursor: "pointer" }}>
                      <input type="checkbox" checked={showLatestOnly} onChange={(e) => setShowLatestOnly(e.target.checked)} style={{ accentColor: "var(--fill-accent)" }} />
                      Latest date only
                    </label>
                    <button onClick={exportCurrentCSV} style={{ fontSize: 12, padding: "5px 10px" }}><i className="ti ti-download" aria-hidden="true" style={{ marginRight: 4 }}></i>Export</button>
                  </div>
                </div>

                <div style={{ overflowX: "auto", background: "var(--surface-1)", borderRadius: "var(--radius-lg)", marginBottom: 28, boxShadow: "var(--shadow-sm)" }}>
                  <table>
                    <thead>
                      <tr style={{ borderBottom: "0.5px solid var(--border)" }}>
                        {["Category", "Date", "GPD", "Group acc.", "Class acc.", "Openset", "OSA", "Sticker Det.", "Annotations", "Images"].map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: "var(--text-muted)", fontWeight: 500, fontSize: 12, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {latestCats.slice().sort((a, b) => a.category_name.localeCompare(b.category_name)).map((c) => (
                        <tr key={c.category_name} style={{ borderBottom: "0.5px solid var(--border)" }}>
                          <td style={{ padding: "10px 12px", fontWeight: 500, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{c.category_name}</td>
                          <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontSize: 12, whiteSpace: "nowrap" }}>{formatDate(perCategoryLatest[c.category_name]?.test_date)}</td>
                          {([c.gpd_accuracy, c.group_accuracy, c.class_accuracy, c.openset_accuracy, c.osa_accuracy, c.sticker_detector_accuracy] as (number | null)[]).map((v, i) => (
                            <td key={i} style={{ padding: "10px 12px" }}><Pill val={v} /></td>
                          ))}
                          <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontSize: 13 }}>{formatNumber(c.total_annotations)}</td>
                          <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontSize: 13 }}>{formatNumber(c.image_count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Accuracies section */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 2px" }}>
                      Accuracies <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 13 }}>({filteredAccuracies.length})</span>
                    </p>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                      {at100Count} at 100% · {confusionPairs.filter((p) => !p.is_mismatch && p.accuracy_pct < 100).length} below 100%
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <select value={accuraciesCategory} onChange={(e) => { setAccuraciesCategory(e.target.value); setAccuraciesPage(1); }} style={{ fontSize: 12 }}>
                      <option value="ALL">All categories</option>
                      {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select value={accuraciesFilter} onChange={(e) => { setAccuraciesFilter(e.target.value as any); setAccuraciesPage(1); }} style={{ fontSize: 12 }}>
                      <option value="all">All</option>
                      <option value="group">Group</option>
                      <option value="class">Class</option>
                    </select>
                    <select value={accuraciesThreshold} onChange={(e) => { setAccuraciesThreshold(Number(e.target.value)); setAccuraciesPage(1); }} style={{ fontSize: 12 }}>
                      <option value={100}>All</option>
                      <option value={95}>Below 95%</option>
                      <option value={85}>Below 85%</option>
                      <option value={75}>Below 75%</option>
                    </select>
                    <select value={accuraciesSort} onChange={(e) => setAccuraciesSort(e.target.value as any)} style={{ fontSize: 12 }}>
                      <option value="accuracy_asc">Worst first</option>
                      <option value="accuracy_desc">Best first</option>
                      <option value="name">Name</option>
                    </select>
                    <input type="text" placeholder="Search" value={accuraciesSearch} onChange={(e) => { setAccuraciesSearch(e.target.value); setAccuraciesPage(1); }} style={{ width: 130, fontSize: 12 }} />
                    <button onClick={exportAccuraciesCSV} style={{ fontSize: 12, padding: "5px 10px" }}><i className="ti ti-download" aria-hidden="true" style={{ marginRight: 4 }}></i>Export</button>
                  </div>
                </div>

                {!filteredAccuracies.length ? (
                  <div style={{ textAlign: "center", padding: "2rem", background: "var(--surface-1)", borderRadius: "var(--radius-lg)" }}>
                    <i className="ti ti-circle-check" aria-hidden="true" style={{ fontSize: 24, color: "var(--text-success)", display: "block", marginBottom: 8 }}></i>
                    <p style={{ color: "var(--text-muted)", fontSize: 14 }}>No items match your filter.</p>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                      {paginatedAccuracies.map((p, i) => {
                        const pct = p.accuracy_pct;
                        const bc = pct >= 95 ? "var(--fill-success)" : pct >= 85 ? "var(--fill-warning)" : "var(--fill-danger)";
                        const tc = pct >= 95 ? "var(--text-success)" : pct >= 85 ? "var(--text-warning)" : "var(--text-danger)";
                        return (
                          <div key={i} style={{ background: "var(--surface-1)", borderRadius: "var(--radius)", padding: "10px 14px", boxShadow: "var(--shadow-sm)" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 12 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                <span className="pill" style={{ background: "var(--bg-accent)", color: "var(--text-accent)", fontSize: 10 }}>{p.matrix_type}</span>
                                <span style={{ fontSize: 13, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.actual_value}>{p.actual_value}</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexShrink: 0 }}>
                                <span style={{ fontSize: 15, fontWeight: 600, color: tc }}>{pct.toFixed(2)}%</span>
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
                    {totalPages > 1 && (
                      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
                        <button onClick={() => setAccuraciesPage((p) => Math.max(1, p - 1))} disabled={accuraciesPage === 1} style={{ fontSize: 12, padding: "5px 10px" }}>← Prev</button>
                        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Page {accuraciesPage} of {totalPages}</span>
                        <button onClick={() => setAccuraciesPage((p) => Math.min(totalPages, p + 1))} disabled={accuraciesPage === totalPages} style={{ fontSize: 12, padding: "5px 10px" }}>Next →</button>
                      </div>
                    )}
                  </>
                )}
              </ErrorBoundary>
            )}

            {/* ===== HISTORICAL TAB ===== */}
            {tab === "historical" && (
              <ErrorBoundary label="Historical chart failed" onRetry={loadData}>
                {snapshots.length < 2 && (
                  <div style={{ background: "var(--bg-accent)", border: "0.5px solid var(--border-accent)", borderRadius: "var(--radius)", padding: "10px 14px", marginBottom: 16 }}>
                    <p style={{ fontSize: 13, color: "var(--text-accent)", margin: 0 }}>Only one snapshot so far — trend lines appear once you upload more dates.</p>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
                  <select value={historicalCategory} onChange={(e) => setHistoricalCategory(e.target.value)}>
                    <option value="ALL">All categories (avg)</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {METRICS.map((m) => (
                        <label key={m.key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: chartMetrics.includes(m.key) ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer" }}>
                          <input type="checkbox" checked={chartMetrics.includes(m.key)} onChange={(e) => setChartMetrics((prev) => e.target.checked ? [...prev, m.key] : prev.filter((k) => k !== m.key))} style={{ accentColor: CHART_COLORS[m.key] }} />
                          {m.label}
                        </label>
                      ))}
                    </div>
                    <button onClick={exportHistoricalCSV} style={{ fontSize: 12, padding: "5px 10px" }}><i className="ti ti-download" aria-hidden="true" style={{ marginRight: 4 }}></i>Export</button>
                  </div>
                </div>
                <div style={{ background: "var(--surface-1)", borderRadius: "var(--radius-lg)", padding: 16, boxShadow: "var(--shadow-sm)" }}>
                  <ResponsiveContainer width="100%" height={340}>
                    <LineChart data={historicalData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={12} tickFormatter={(d) => formatDate(d)} />
                      <YAxis stroke="var(--text-muted)" fontSize={12} domain={([dataMin, dataMax]: [number, number]) => [Math.max(0, Math.floor(dataMin - 5)), Math.min(100, Math.ceil(dataMax + 5))]} />
                      <Tooltip contentStyle={{ background: "var(--surface-popover)", border: "0.5px solid var(--border)", borderRadius: 8, fontSize: 13, boxShadow: "var(--shadow-md)" }} labelFormatter={(d) => formatDate(d as string)} />
                      <Legend />
                      {chartMetrics.map((k) => (
                        <Line key={k} type="monotone" dataKey={k} name={METRICS.find((m) => m.key === k)?.label || k} stroke={CHART_COLORS[k]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </ErrorBoundary>
            )}

            {/* ===== COMPARISON TAB ===== */}
            {tab === "comparison" && (
              <ErrorBoundary label="Comparison failed" onRetry={loadData}>
                <div style={{ display: "flex", gap: 16, marginBottom: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div><label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Date A</label>
                    <select value={compareDateA} onChange={(e) => setCompareDateA(e.target.value)}>{snapshots.map((s) => <option key={s.id} value={s.test_date}>{formatDate(s.test_date)}</option>)}</select></div>
                  <div><label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Date B</label>
                    <select value={compareDateB} onChange={(e) => setCompareDateB(e.target.value)}>{snapshots.map((s) => <option key={s.id} value={s.test_date}>{formatDate(s.test_date)}</option>)}</select></div>
                  <button onClick={exportComparisonCSV} style={{ marginLeft: "auto", fontSize: 12, padding: "7px 12px" }}><i className="ti ti-download" aria-hidden="true" style={{ marginRight: 4 }}></i>Export</button>
                </div>

                {comparisonSummary && compareDateA !== compareDateB && (
                  <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                    {comparisonSummary.improved > 0 && <span className="pill" style={{ background: "var(--bg-success)", color: "var(--text-success)" }}><i className="ti ti-trending-up" aria-hidden="true" style={{ fontSize: 12 }}></i>{comparisonSummary.improved} improved</span>}
                    {comparisonSummary.declined > 0 && <span className="pill" style={{ background: "var(--bg-danger)", color: "var(--text-danger)" }}><i className="ti ti-trending-down" aria-hidden="true" style={{ fontSize: 12 }}></i>{comparisonSummary.declined} declined</span>}
                    {comparisonSummary.unchanged > 0 && <span className="pill" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>{comparisonSummary.unchanged} unchanged</span>}
                  </div>
                )}

                <div style={{ overflowX: "auto", background: "var(--surface-1)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)" }}>
                  <table>
                    <thead><tr style={{ borderBottom: "0.5px solid var(--border)" }}>
                      {["Category", `Group (${formatDate(compareDateA)})`, `Group (${formatDate(compareDateB)})`, "Δ", `Class (${formatDate(compareDateA)})`, `Class (${formatDate(compareDateB)})`, "Δ"].map((h, i) => (
                        <th key={i} style={{ textAlign: "left", padding: "10px 12px", color: "var(--text-muted)", fontWeight: 500, fontSize: 12 }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {compareCats.map((cat) => {
                        const a = catsA.find((c) => c.category_name === cat), b = catsB.find((c) => c.category_name === cat);
                        const gd = a?.group_accuracy != null && b?.group_accuracy != null ? b.group_accuracy - a.group_accuracy : null;
                        const cd = a?.class_accuracy != null && b?.class_accuracy != null ? b.class_accuracy - a.class_accuracy : null;
                        return (
                          <tr key={cat} style={{ borderBottom: "0.5px solid var(--border)" }}>
                            <td style={{ padding: "10px 12px", fontWeight: 500, color: "var(--text-primary)" }}>{cat}</td>
                            <td style={{ padding: "10px 12px" }}><Pill val={a?.group_accuracy ?? null} /></td>
                            <td style={{ padding: "10px 12px" }}><Pill val={b?.group_accuracy ?? null} /></td>
                            <td style={{ padding: "10px 12px" }}><Delta val={gd} /></td>
                            <td style={{ padding: "10px 12px" }}><Pill val={a?.class_accuracy ?? null} /></td>
                            <td style={{ padding: "10px 12px" }}><Pill val={b?.class_accuracy ?? null} /></td>
                            <td style={{ padding: "10px 12px" }}><Delta val={cd} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </ErrorBoundary>
            )}

            {/* ===== ISSUES TAB ===== */}
            {tab === "issues" && <IssuesTab snapId={latestSnap?.id} testDate={latestSnap?.test_date} issuesFilter={issuesFilter} setIssuesFilter={setIssuesFilter} issuesSort={issuesSort} setIssuesSort={setIssuesSort} issuesSearch={issuesSearch} setIssuesSearch={setIssuesSearch} projectName={project.name} onRetry={loadData} confusionPairs={confusionPairs} />}

            {/* ===== AI MISTAKES TAB ===== */}
            {tab === "mistakes" && (
              <ErrorBoundary label="AI Mistakes failed to load" onRetry={loadData}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 2px" }}>AI Mistakes <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 13 }}>({mistakesData.length})</span></p>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>All cases where actual ≠ predicted, sorted by frequency</p>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <select value={mistakesCategory} onChange={(e) => setMistakesCategory(e.target.value)} style={{ fontSize: 12 }}>
                      <option value="ALL">All categories</option>
                      {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select value={mistakesType} onChange={(e) => setMistakesType(e.target.value as any)} style={{ fontSize: 12 }}>
                      <option value="all">All</option>
                      <option value="group">Group</option>
                      <option value="class">Class</option>
                    </select>
                    <button onClick={exportMistakesCSV} style={{ fontSize: 12, padding: "5px 10px" }}><i className="ti ti-download" aria-hidden="true" style={{ marginRight: 4 }}></i>Export</button>
                  </div>
                </div>
                {!mistakesData.length ? (
                  <div style={{ textAlign: "center", padding: "2.5rem", background: "var(--surface-1)", borderRadius: "var(--radius-lg)", border: "0.5px solid var(--border)" }}>
                    <i className="ti ti-circle-check" aria-hidden="true" style={{ fontSize: 28, color: "var(--text-success)", display: "block", marginBottom: 10 }}></i>
                    <p style={{ color: "var(--text-muted)", fontSize: 14, margin: "0 0 4px" }}>No mistakes found.</p>
                    <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Either all predictions are correct, or re-upload your data to populate this tab.</p>
                  </div>
                ) : (
                  <div style={{ overflowX: "auto", background: "var(--surface-1)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)" }}>
                    <table>
                      <thead><tr style={{ borderBottom: "0.5px solid var(--border)" }}>
                        {["Category", "Type", "Actual (ground truth)", "Predicted as", "Occurrences", "Acc. %"].map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: "var(--text-muted)", fontWeight: 500, fontSize: 12 }}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {mistakesData.slice(0, 200).map((p, i) => {
                          const tc = p.accuracy_pct >= 85 ? "var(--text-warning)" : "var(--text-danger)";
                          return (
                            <tr key={i} style={{ borderBottom: "0.5px solid var(--border)" }}>
                              <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontSize: 12 }}>{p.category_name}</td>
                              <td style={{ padding: "10px 12px" }}>
                                <span className="pill" style={{ background: "var(--bg-accent)", color: "var(--text-accent)", fontSize: 10 }}>{p.matrix_type}</span>
                              </td>
                              <td style={{ padding: "10px 12px", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.actual_value}>{p.actual_value}</td>
                              <td style={{ padding: "10px 12px", color: "var(--text-danger)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.predicted_value}>{p.predicted_value}</td>
                              <td style={{ padding: "10px 12px", fontWeight: 600, color: "var(--text-primary)" }}>{p.count}</td>
                              <td style={{ padding: "10px 12px", fontWeight: 600, color: tc }}>{p.accuracy_pct.toFixed(2)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {mistakesData.length > 200 && <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: 10 }}>Showing 200 of {mistakesData.length}. Export for full data.</p>}
                  </div>
                )}
              </ErrorBoundary>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function IssuesTab({ snapId, testDate, issuesFilter, setIssuesFilter, issuesSort, setIssuesSort, issuesSearch, setIssuesSearch, projectName, onRetry, confusionPairs }: any) {
  const filtered = useMemo(() => {
    let list = confusionPairs.filter((p: any) => p.is_mismatch);
    if (issuesFilter !== "all") list = list.filter((p: any) => p.matrix_type === issuesFilter);
    if (issuesSearch.trim()) { const q = issuesSearch.toLowerCase(); list = list.filter((p: any) => p.actual_value.toLowerCase().includes(q) || p.predicted_value.toLowerCase().includes(q) || p.category_name.toLowerCase().includes(q)); }
    return list.sort((a: any, b: any) => {
      if (issuesSort === "count_desc") return b.count - a.count;
      if (issuesSort === "count_asc") return a.count - b.count;
      if (issuesSort === "accuracy_asc") return a.accuracy_pct - b.accuracy_pct;
      return a.actual_value.localeCompare(b.actual_value);
    });
  }, [confusionPairs, issuesFilter, issuesSearch, issuesSort]);

  function exportCSV() {
    const csv = [["Category","Type","Actual","Predicted as","Count","Acc. %"], ...filtered.map((p: any) => [p.category_name, p.matrix_type, p.actual_value, p.predicted_value, p.count, p.accuracy_pct.toFixed(2)+"%"])].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${projectName}_issues.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <ErrorBoundary label="Issues tab failed to load" onRetry={onRetry}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Groups and classes with issues <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 13 }}>({filtered.length})</span></p>
        <div style={{ display: "flex", gap: 6 }}>
          <input type="text" placeholder="Search" value={issuesSearch} onChange={(e) => setIssuesSearch(e.target.value)} style={{ width: 140, fontSize: 12 }} />
          <select value={issuesFilter} onChange={(e) => setIssuesFilter(e.target.value)} style={{ fontSize: 12 }}><option value="all">All</option><option value="group">Group</option><option value="class">Class</option></select>
          <select value={issuesSort} onChange={(e) => setIssuesSort(e.target.value)} style={{ fontSize: 12 }}>
            <option value="count_desc">Most occurrences</option>
            <option value="count_asc">Fewest occurrences</option>
            <option value="accuracy_asc">Worst accuracy</option>
            <option value="name">Name</option>
          </select>
          {filtered.length > 0 && <button onClick={exportCSV} style={{ fontSize: 12, padding: "5px 10px" }}><i className="ti ti-download" aria-hidden="true" style={{ marginRight: 4 }}></i>Export</button>}
        </div>
      </div>
      {!filtered.length ? (
        <div style={{ textAlign: "center", padding: "2.5rem", background: "var(--surface-1)", borderRadius: "var(--radius-lg)", border: "0.5px solid var(--border)" }}>
          <i className="ti ti-circle-check" aria-hidden="true" style={{ fontSize: 28, color: "var(--text-success)", display: "block", marginBottom: 10 }}></i>
          <p style={{ color: "var(--text-muted)", fontSize: 14, margin: "0 0 4px" }}>No issues found.</p>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Re-upload your data to populate this section.</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto", background: "var(--surface-1)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)" }}>
          <table>
            <thead><tr style={{ borderBottom: "0.5px solid var(--border)" }}>
              {["Category","Type","Actual","Predicted as","Count","Acc. %"].map((h) => <th key={h} style={{ textAlign:"left", padding:"10px 12px", color:"var(--text-muted)", fontWeight:500, fontSize:12 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filtered.map((p: any, i: number) => (
                <tr key={i} style={{ borderBottom: "0.5px solid var(--border)" }}>
                  <td style={{ padding:"10px 12px", color:"var(--text-muted)", fontSize:12 }}>{p.category_name}</td>
                  <td style={{ padding:"10px 12px" }}><span className="pill" style={{ background:"var(--bg-accent)", color:"var(--text-accent)", fontSize:10 }}>{p.matrix_type}</span></td>
                  <td style={{ padding:"10px 12px", maxWidth:220, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={p.actual_value}>{p.actual_value}</td>
                  <td style={{ padding:"10px 12px", color:"var(--text-danger)", maxWidth:220, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={p.predicted_value}>{p.predicted_value}</td>
                  <td style={{ padding:"10px 12px", fontWeight:600 }}>{p.count}</td>
                  <td style={{ padding:"10px 12px", fontWeight:600, color: p.accuracy_pct>=85?"var(--text-warning)":"var(--text-danger)" }}>{p.accuracy_pct.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ErrorBoundary>
  );
}

function Pill({ val }: { val: number | null }) {
  const c = pillColor(val);
  return <span className="pill" style={{ background: c.bg, color: c.text, fontSize: 12 }}>{formatPct(val, 2)}</span>;
}
function Delta({ val }: { val: number | null }) {
  if (val == null) return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>;
  const p = val * 100;
  const color = p > 0.05 ? "var(--text-success)" : p < -0.05 ? "var(--text-danger)" : "var(--text-muted)";
  return <span style={{ color, fontSize: 12, fontWeight: 600 }}>{p > 0 ? "+" : ""}{p.toFixed(2)}%</span>;
}
function InfoChip({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-1)", borderRadius: "var(--radius)", padding: "8px 14px", boxShadow: "var(--shadow-sm)" }}>
      <i className={`ti ${icon}`} aria-hidden="true" style={{ fontSize: 15, color: "var(--text-muted)" }}></i>
      <div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.03em", textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 600 }}>{value}</div>
      </div>
    </div>
  );
}
