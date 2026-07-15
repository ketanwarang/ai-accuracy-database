"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";
import TopNav from "@/components/TopNav";
import { useAuth } from "@/lib/auth";
import { SkeletonCard } from "@/components/Skeleton";
import Breadcrumb from "@/components/Breadcrumb";
import { formatDate, formatRelativeTime, getHealthStatus, healthColor, pillColor } from "@/lib/format";
import { getCached, setCached } from "@/lib/dataCache";
import { useViewMode } from "@/lib/viewMode";
import ProjectLogo from "@/components/ProjectLogo";

interface Account { id: string; name: string; display_name: string | null; }
interface Project { id: string; name: string; display_name: string | null; account_id: string; logo_url: string | null; }
interface Snapshot { id: string; project_id: string; test_date: string; }
interface CatMetric { snapshot_id: string; category_name: string; gpd_accuracy: number | null; group_accuracy: number | null; class_accuracy: number | null; osa_accuracy: number | null; }

interface AccountCache {
  account: Account | null;
  projects: Project[];
  snapshots: Record<string, Snapshot>;
  catMetrics: Record<string, CatMetric[]>;
}

export default function AccountPage() {
  const router = useRouter();
  const { accountId } = useParams() as { accountId: string };
  const supabase = createClient();
  const { user, loading: authLoading, isSuperAdmin, isAdmin } = useAuth();
  const { viewMode } = useViewMode();
  const cacheKey = `account:${accountId}:${viewMode}`;

  const [account, setAccount] = useState<Account | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [catMetrics, setCatMetrics] = useState<Record<string, CatMetric[]>>({});
  const [loading, setLoading] = useState(true);
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    const cached = getCached<AccountCache>(cacheKey);
    if (cached) {
      setAccount(cached.account);
      setProjects(cached.projects);
      setSnapshots(cached.snapshots);
      setCatMetrics(cached.catMetrics);
      setLoading(false);
    }
    loadData(!cached);
  }, [user, authLoading, accountId, viewMode]);

  useEffect(() => {
    const handler = () => loadData(false);
    window.addEventListener("app:refresh", handler);
    return () => window.removeEventListener("app:refresh", handler);
  }, [accountId]);

  async function loadData(showSkeleton = true) {
    if (showSkeleton) setLoading(true);
    const { data: acc } = await supabase.from("accounts").select("id, name, display_name").eq("id", accountId).maybeSingle();
    setAccount(acc);

    const { data: projs } = await supabase.from("projects").select("id, name, display_name, account_id, logo_url").eq("account_id", accountId).eq("is_active", true).order("display_name");
    const projsResult = projs || [];
    setProjects(projsResult);

    const { data: snaps } = await supabase.from("current_snapshots").select("id, project_id, test_date").in("project_id", projsResult.map((p: any) => p.id));
    const snapMap: Record<string, Snapshot> = {};
    (snaps || []).forEach((s: any) => (snapMap[s.project_id] = s));
    setSnapshots(snapMap);

    let cMap: Record<string, CatMetric[]> = {};
    const snapIds = (snaps || []).map((s: any) => s.id);
    if (snapIds.length) {
      const { data: cats } = await supabase.from("category_metrics").select("snapshot_id, category_name, gpd_accuracy, group_accuracy, class_accuracy, osa_accuracy").in("snapshot_id", snapIds).eq("view_mode", viewMode);
      (cats || []).forEach((c: any) => {
        const pid = Object.keys(snapMap).find((k) => snapMap[k].id === c.snapshot_id);
        if (pid) { if (!cMap[pid]) cMap[pid] = []; cMap[pid].push(c); }
      });
      setCatMetrics(cMap);
    }
    setLoading(false);
    setCached<AccountCache>(cacheKey, { account: acc, projects: projsResult, snapshots: snapMap, catMetrics: cMap });
  }

  const isAdminUser = isSuperAdmin || isAdmin(accountId);

  if (authLoading || loading) return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav accountId={accountId} />
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "2rem" }}>
        <div style={{ height: 12, width: 180, marginBottom: 24 }} className="skeleton" />
        <div style={{ height: 28, width: 260, marginBottom: 6 }} className="skeleton" />
        <div style={{ height: 14, width: 120, marginBottom: 24 }} className="skeleton" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {[1,2,3,4].map((i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav accountId={accountId} />
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "2rem" }}>
<Breadcrumb crumbs={[{ label: "Accounts", href: "/" }, { label: account?.display_name || account?.name || "…" }]} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 500, color: "var(--text-primary)", margin: 0 }}>{account?.display_name || account?.name}</h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {!projects.length ? (
          <div className="empty-state" style={{ marginTop: 20 }}>
            <div className="empty-icon"><i className="ti ti-folder" aria-hidden="true"></i></div>
            <p className="empty-title">No projects yet</p>
            <p>Add one via Manage projects.</p>
          </div>
        ) : (
        <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {projects.map((project, idx) => {
            const snap = snapshots[project.id];
            const metrics = catMetrics[project.id];
            const status = getHealthStatus(metrics ? metrics.flatMap((m) => [m.group_accuracy, m.class_accuracy]) : []);
            const style = healthColor(status);

            return (
              <div
                key={project.id}
                style={{ position: "relative", opacity: 0, animation: `slideUp 0.3s ease-out ${idx * 0.05}s forwards` }}
                onMouseEnter={(e) => {
                  setHoveredProject(project.id);
                  const rect = e.currentTarget.getBoundingClientRect();
                  setPopoverPos({ top: rect.bottom + window.scrollY + 8, left: rect.left + window.scrollX });
                }}
                onMouseLeave={() => { setHoveredProject(null); setPopoverPos(null); }}
              >
                <div
                  onClick={() => router.push(`/account/${accountId}/project/${project.name}`)}
                  className="project-card"
                  style={{ "--status-border": style.border, "--status-glow": style.glow } as React.CSSProperties}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <ProjectLogo logoUrl={project.logo_url} name={project.display_name || project.name} size={36} />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 16, fontWeight: 500, color: "var(--text-primary)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
                        {project.display_name || project.name}
                      </p>
                      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                        {snap ? formatDate(snap.test_date) : "No data yet"}
                      </p>
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px" }}>
                    {snap ? `Last test ${formatRelativeTime(snap.test_date)}` : "No uploads yet"}
                  </p>
                  {metrics && metrics.length > 0 && <CardMetrics metrics={metrics} />}
                  <button
                    style={{ width: "100%", background: "var(--surface-2)", border: "none", fontSize: 13 }}
                    onClick={(e) => { e.stopPropagation(); router.push(`/account/${accountId}/project/${project.name}`); }}
                  >
                    View project
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* Popover rendered at document level via absolute positioning with scroll offset */}
      {hoveredProject && popoverPos && catMetrics[hoveredProject] && snapshots[hoveredProject] && (
        <CategoryPopover
          metrics={catMetrics[hoveredProject]}
          testDate={snapshots[hoveredProject].test_date}
          top={popoverPos.top}
          left={popoverPos.left}
        />
      )}

      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes popIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}

function CategoryPopover({ metrics, testDate, top, left }: { metrics: any[]; testDate: string; top: number; left: number }) {
  return (
    <div style={{
      position: "absolute", top, left, zIndex: 9999,
      background: "var(--surface-popover)",
      border: "0.5px solid var(--border)",
      borderRadius: 12, padding: "14px 16px", width: 300,
      boxShadow: "var(--shadow-popover)",
      animation: "popIn 0.16s cubic-bezier(0.16,1,0.3,1)", pointerEvents: "none",
      willChange: "opacity, transform",
    }}>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px" }}>
        Category breakdown · {formatDate(testDate)}
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", fontWeight: 500, color: "var(--text-muted)", padding: "0 0 6px" }}>Category</th>
            <th style={{ textAlign: "right", fontWeight: 500, color: "var(--text-muted)", padding: "0 0 6px" }}>Group</th>
            <th style={{ textAlign: "right", fontWeight: 500, color: "var(--text-muted)", padding: "0 0 6px" }}>Class</th>
          </tr>
        </thead>
        <tbody>
          {metrics.slice().sort((a: any, b: any) => Math.min(a.group_accuracy ?? 1, a.class_accuracy ?? 1) - Math.min(b.group_accuracy ?? 1, b.class_accuracy ?? 1)).map((m: any, i: number) => {
            const gc = pillColor(m.group_accuracy);
            const cc = pillColor(m.class_accuracy);
            return (
              <tr key={i} style={{ borderTop: "0.5px solid var(--border)" }}>
                <td style={{ padding: "6px 0", color: "var(--text-primary)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.category_name}</td>
                <td style={{ padding: "6px 0", textAlign: "right", color: gc.text }}>{m.group_accuracy != null ? (m.group_accuracy * 100).toFixed(1) + "%" : "—"}</td>
                <td style={{ padding: "6px 0", textAlign: "right", color: cc.text }}>{m.class_accuracy != null ? (m.class_accuracy * 100).toFixed(1) + "%" : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CardMetrics({ metrics }: { metrics: any[] }) {
  const avg = (field: string): number | null => {
    const vals = metrics.map((m) => m[field]).filter((v): v is number => v != null && !isNaN(v));
    return vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : null;
  };
  const fmt = (v: number | null) => v != null ? (v * 100).toFixed(1) + "%" : "N/A";
  const clr = (v: number | null) => v == null ? "var(--text-muted)" : v >= 0.95 ? "var(--text-success)" : v >= 0.85 ? "var(--text-warning)" : "var(--text-danger)";

  const entries: [string, number | null][] = [
    ["Group", avg("group_accuracy")],
    ["Class", avg("class_accuracy")],
    ["GPD", avg("gpd_accuracy")],
    ["OSA", avg("osa_accuracy")],
  ];
  const visible = entries.filter(([label, v]) => v != null || label === "Group" || label === "Class");

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(visible.length, 3)}, 1fr)`, gap: 5, marginBottom: 10 }}>
      {visible.map(([label, val]) => (
        <div key={label} style={{ background: "var(--surface-0)", borderRadius: 6, padding: "5px 7px" }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.04em", marginBottom: 1 }}>{label}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: clr(val) }}>{fmt(val)}</div>
        </div>
      ))}
    </div>
  );
}
