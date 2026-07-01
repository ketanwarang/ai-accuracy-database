"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { createClient } from "@/lib/supabaseClient";
import TopNav from "@/components/TopNav";
import { formatDate, formatNumber } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import {
  Row,
  col,
  computeAllCategories,
  buildConfusionPairs,
  detectTestDate,
  filterToLatestDate,
} from "@/lib/accuracy";

interface Project {
  id: string;
  name: string;
  display_name: string | null;
  account_id: string;
  account_name?: string;
}

interface RecentUpload {
  test_date: string;
  project_name: string;
  row_count: number;
}

export default function UploadPage() {
  const router = useRouter();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [recentUploads, setRecentUploads] = useState<RecentUpload[]>([]);
  const [status, setStatus] = useState<"idle" | "parsing" | "confirming" | "saving" | "error" | "validation-error">("idle");
  const [message, setMessage] = useState("");
  const [progressMsg, setProgressMsg] = useState("");
  const [progressPct, setProgressPct] = useState(0);
  const [pendingData, setPendingData] = useState<{
    rows: Row[];
    fileName: string;
    fileSizeKB: number;
    testDate: string | null;
    existingSnapshotId: string | null;
    categoryCount: number;
    multipleDatesDetected: boolean;
    totalDatesInFile: number;
    rowsExcluded: number;
  } | null>(null);
  const { user, loading: authLoading } = useAuth();
  const [savedInfo, setSavedInfo] = useState<{ testDate: string; categoryCount: number } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    loadProjects();
  }, [user, authLoading]);

  async function loadProjects() {
    const { data } = await supabase
      .from("projects")
      .select("id, name, display_name, account_id, accounts(display_name, name)")
      .eq("is_active", true)
      .order("display_name");
    if (data) {
      setProjects(data.map((p: any) => ({
        ...p,
        account_name: p.accounts?.display_name || p.accounts?.name || "",
      })));
    }
  }

  useEffect(() => {
    if (!selectedProjectId) {
      setRecentUploads([]);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("snapshots")
        .select("test_date, row_count, project_id")
        .eq("project_id", selectedProjectId)
        .order("test_date", { ascending: false })
        .limit(5);
      const proj = projects.find((p) => p.id === selectedProjectId);
      setRecentUploads((data || []).map((d: any) => ({ test_date: d.test_date, row_count: d.row_count, project_name: proj?.display_name || proj?.name || "" })));
    })();
  }, [selectedProjectId, projects]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!selectedProjectId) {
      setStatus("error");
      setMessage("Pick a project first.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setStatus("validation-error");
      setMessage("Only .csv files are supported.");
      return;
    }
    const maxSizeMB = 100;
    if (file.size > maxSizeMB * 1024 * 1024) {
      setStatus("validation-error");
      setMessage(`File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max supported is ${maxSizeMB}MB.`);
      return;
    }

    setStatus("parsing");
    setMessage("");
    setProgressMsg("Reading file…");

    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        const rows = result.data;
        if (!rows.length) {
          setStatus("validation-error");
          setMessage("No rows found in this file. Check it's not empty.");
          return;
        }

        const requiredColumns = ["category_name"];
        const sampleRow = rows[0];
        const availableKeys = Object.keys(sampleRow).map((k) => k.toLowerCase().replace(/[_\s]/g, ""));
        const missing = requiredColumns.filter((col) => !availableKeys.includes(col.replace(/[_\s]/g, "")));
        if (missing.length) {
          setStatus("validation-error");
          setMessage(`This file is missing expected column(s): ${missing.join(", ")}. Check it's a df_out export.`);
          return;
        }

        const testDate = detectTestDate(rows);
        if (!testDate) {
          setStatus("validation-error");
          setMessage("Could not find a date column in this file. Check the CSV has a 'date' column with valid dates.");
          return;
        }

        const allDatesInFile = [...new Set(rows.map((r) => col(r, "date")).filter(Boolean))];
        const latestRows = filterToLatestDate(rows);

        setProgressMsg("Checking for existing data…");
        const { data: existing } = await supabase
          .from("snapshots")
          .select("id")
          .eq("project_id", selectedProjectId)
          .eq("test_date", testDate)
          .maybeSingle();

        const { categories } = computeAllCategories(latestRows);

        setPendingData({
          rows: latestRows,
          fileName: file.name,
          fileSizeKB: Math.round(file.size / 1024),
          testDate,
          existingSnapshotId: existing?.id || null,
          categoryCount: categories.length,
          multipleDatesDetected: allDatesInFile.length > 1,
          totalDatesInFile: allDatesInFile.length,
          rowsExcluded: rows.length - latestRows.length,
        });
        setStatus("confirming");
      },
      error: (err) => {
        setStatus("error");
        setMessage("CSV parse error: " + err.message);
      },
    });
  }

  async function handleConfirmSave() {
    if (!pendingData) return;
    setStatus("saving");
    try {
      const { rows, fileName, testDate, existingSnapshotId } = pendingData;

      if (existingSnapshotId) {
        setProgressMsg("Replacing existing snapshot…"); setProgressPct(5);
        const { error: delErr } = await supabase.from("snapshots").delete().eq("id", existingSnapshotId);
        if (delErr) throw new Error("Failed to replace existing snapshot: " + delErr.message);
      }

      setProgressMsg("Computing accuracy metrics…"); setProgressPct(20);
      const { overall, categories } = computeAllCategories(rows);
      const confusionPairs = buildConfusionPairs(rows);

      setProgressMsg("Saving snapshot…"); setProgressPct(35);
      const { data: snapRow, error: snapErr } = await supabase
        .from("snapshots")
        .insert({
          project_id: selectedProjectId,
          test_date: testDate,
          file_name: fileName,
          row_count: rows.length,
        })
        .select()
        .single();
      if (snapErr || !snapRow) throw new Error("Failed to create snapshot: " + snapErr?.message);

      const snapshotId = snapRow.id;

      setProgressMsg(`Saving ${categories.length} category metrics…`); setProgressPct(55);
      const categoryRows = categories.map((c) => ({
        snapshot_id: snapshotId,
        category_name: c.category_name,
        total_annotations: c.total_annotations,
        image_count: c.image_count,
        gpd_accuracy: c.gpd_accuracy,
        group_accuracy: c.group_accuracy,
        class_accuracy: c.class_accuracy,
        openset_accuracy: c.openset_accuracy,
        osa_accuracy: c.osa_accuracy,
        sticker_detector_accuracy: c.sticker_detector_accuracy,
        sticker_value_accuracy: c.sticker_value_accuracy,
      }));
      const { error: catErr } = await supabase.from("category_metrics").insert(categoryRows);
      if (catErr) throw new Error("Failed to save category metrics: " + catErr.message);

      if (confusionPairs.length) {
        setProgressMsg(`Saving ${confusionPairs.length.toLocaleString()} issue items…`); setProgressPct(70);
        const confusionRows = confusionPairs.map((p) => ({
          snapshot_id: snapshotId,
          category_name: p.category_name,
          matrix_type: p.matrix_type,
          actual_value: p.actual_value,
          predicted_value: p.predicted_value,
          count: p.count,
          self_count: p.self_count,
          total_count: p.total_count,
          accuracy_pct: p.accuracy_pct,
          is_mismatch: p.is_mismatch,
        }));
        const batchSize = 500;
        for (let i = 0; i < confusionRows.length; i += batchSize) {
          const batch = confusionRows.slice(i, i + batchSize);
setProgressPct(70 + Math.floor((Math.min(i + batchSize, confusionRows.length) / confusionRows.length) * 25));
          setProgressMsg(`Saving confusion pairs (${Math.min(i + batchSize, confusionRows.length)}/${confusionRows.length})…`);
          const { error: confErr } = await supabase.from("confusion_pairs").insert(batch);
          if (confErr) throw new Error("Failed to save confusion data: " + confErr.message);
        }
      }

      setSavedInfo({ testDate: testDate!, categoryCount: categories.length });
      setPendingData(null);
      setStatus("idle");
      setProgressPct(100);
      setProgressMsg("");
      if (fileInputRef.current) fileInputRef.current.value = "";

      const { data } = await supabase
        .from("snapshots")
        .select("test_date, row_count, project_id")
        .eq("project_id", selectedProjectId)
        .order("test_date", { ascending: false })
        .limit(5);
      const proj = projects.find((p) => p.id === selectedProjectId);
      setRecentUploads((data || []).map((d: any) => ({ test_date: d.test_date, row_count: d.row_count, project_name: proj?.display_name || proj?.name || "" })));
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message || "Unexpected error");
      setProgressMsg("");
      setProgressPct(0);
    }
  }

  function handleCancelConfirm() {
    setPendingData(null);
    setStatus("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem" }}>
        <button
          onClick={() => router.push("/")}
          style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", marginBottom: 14, padding: 0, display: "flex", alignItems: "center", gap: 4 }}
        >
          <i className="ti ti-arrow-left" aria-hidden="true" style={{ fontSize: 14 }}></i>
          All projects
        </button>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 6px" }}>Upload data</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 24px" }}>
          Drop a df_out CSV export. Metrics are computed and saved — the file itself is discarded after processing.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 24, alignItems: "start" }}>
          <div>
            <label style={{ fontSize: 13, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>Project</label>
            <select
              value={selectedProjectId}
              onChange={(e) => {
                setSelectedProjectId(e.target.value);
                setStatus("idle");
                setSavedInfo(null);
              }}
              style={{ width: "100%", marginBottom: 20 }}
            >
              <option value="">Select a project</option>
              {Array.from(new Set(projects.map((p) => p.account_id))).map((accId) => {
                const acctProjects = projects.filter((p) => p.account_id === accId);
                const accName = acctProjects[0]?.account_name || "";
                return (
                  <optgroup key={accId} label={accName}>
                    {acctProjects.map((p) => (
                      <option key={p.id} value={p.id}>{p.display_name || p.name}</option>
                    ))}
                  </optgroup>
                );
              })}
            </select>

            <div
              onClick={() => selectedProjectId && fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (selectedProjectId) handleFile(e.dataTransfer.files[0]);
              }}
              style={{
                border: `1.5px dashed var(--border-strong)`,
                borderRadius: 12,
                padding: "3rem 2rem",
                textAlign: "center",
                cursor: selectedProjectId ? "pointer" : "not-allowed",
                background: "var(--surface-1)",
                opacity: selectedProjectId ? 1 : 0.5,
              }}
            >
              <i className="ti ti-cloud-upload" aria-hidden="true" style={{ fontSize: 28, color: "var(--text-muted)", display: "block", marginBottom: 10 }}></i>
              <p style={{ color: "var(--text-secondary)", fontSize: 15, margin: "0 0 4px" }}>
                Drop df_out.csv here, or click to browse
              </p>
              <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
                {selectedProjectId ? "Annotation-level export with a date column · max 100MB" : "Select a project first"}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                style={{ display: "none" }}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>

            {status === "confirming" && pendingData && (
              <div style={{ marginTop: 20, padding: 16, borderRadius: 10, background: "var(--bg-warning)", border: "0.5px solid var(--border-warning)" }}>
                <div style={{ display: "flex", gap: 16, marginBottom: 10, flexWrap: "wrap" }}>
                  <SmallStat label="Rows used" value={pendingData.rows.length.toLocaleString()} />
                  <SmallStat label="Categories" value={String(pendingData.categoryCount)} />
                  <SmallStat label="Test date" value={formatDate(pendingData.testDate)} />
                  <SmallStat label="File size" value={`${pendingData.fileSizeKB} KB`} />
                </div>
                {pendingData.multipleDatesDetected && (
                  <p style={{ fontSize: 13, color: "var(--text-accent)", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
                    <i className="ti ti-info-circle" aria-hidden="true" style={{ fontSize: 14 }}></i>
                    This file contains {pendingData.totalDatesInFile} different dates. Only rows from the latest date ({formatDate(pendingData.testDate)}) are used — {pendingData.rowsExcluded.toLocaleString()} row{pendingData.rowsExcluded !== 1 ? "s" : ""} from earlier dates were excluded.
                  </p>
                )}
                {pendingData.existingSnapshotId ? (
                  <p style={{ fontSize: 13, color: "var(--text-warning)", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 6 }}>
                    <i className="ti ti-alert-triangle" aria-hidden="true" style={{ fontSize: 14 }}></i>
                    Data already exists for {formatDate(pendingData.testDate)} in this project. Uploading will replace it.
                  </p>
                ) : (
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 12px" }}>
                    This will be added as a new snapshot.
                  </p>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="primary" onClick={handleConfirmSave}>
                    {pendingData.existingSnapshotId ? "Replace and save" : "Confirm and save"}
                  </button>
                  <button onClick={handleCancelConfirm} style={{ background: "transparent" }}>Cancel</button>
                </div>
              </div>
            )}

            {status === "parsing" && (
              <StatusBox color="muted" icon="ti-loader-2" spin>{progressMsg || "Parsing CSV…"}</StatusBox>
            )}
            {status === "saving" && (
              <div style={{ marginTop: 20, padding: "12px 16px", borderRadius: 10, background: "var(--surface-1)", border: "0.5px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <i className="ti ti-loader-2" aria-hidden="true" style={{ fontSize: 15, color: "var(--text-muted)", animation: "spin 1s linear infinite" }}></i>
                  <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>{progressMsg || "Saving…"}</p>
                  <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "var(--text-accent)" }}>{progressPct}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 4, background: "var(--fill-accent)", width: `${progressPct}%`, transition: "width 0.4s ease-out" }} />
                </div>
              </div>
            )}
            {status === "validation-error" && (
              <StatusBox color="warning" icon="ti-alert-triangle">{message}</StatusBox>
            )}
            {status === "error" && (
              <StatusBox color="danger" icon="ti-x">{message}</StatusBox>
            )}
            {savedInfo && status === "idle" && (
              <div style={{ marginTop: 20, padding: "16px", borderRadius: 10, background: "var(--bg-success)", border: "0.5px solid var(--border-success)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <i className="ti ti-circle-check" aria-hidden="true" style={{ fontSize: 18, color: "var(--text-success)" }}></i>
                  <p style={{ color: "var(--text-success)", fontSize: 14, fontWeight: 500, margin: 0 }}>Upload complete</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                  <SmallStat label="Test date" value={formatDate(savedInfo.testDate)} />
                  <SmallStat label="Categories saved" value={String(savedInfo.categoryCount)} />
                </div>
                <div style={{ height: 6, borderRadius: 4, background: "var(--border-success)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 4, background: "var(--fill-success)", width: "100%" }} />
                </div>
              </div>
            )}
          </div>

          <div style={{ background: "var(--surface-1)", borderRadius: 12, padding: "1rem" }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", margin: "0 0 10px", textTransform: "uppercase", letterSpacing: 0.3 }}>
              Recent uploads
            </p>
            {!selectedProjectId ? (
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Select a project to see its upload history.</p>
            ) : !recentUploads.length ? (
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No uploads yet for this project.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {recentUploads.map((u, i) => (
                  <div key={i} style={{ fontSize: 12, paddingBottom: 8, borderBottom: i < recentUploads.length - 1 ? "0.5px solid var(--border)" : "none" }}>
                    <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>{formatDate(u.test_date)}</div>
                    <div style={{ color: "var(--text-muted)" }}>{formatNumber(u.row_count)} rows</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

function StatusBox({
  children,
  color,
  icon,
  spin,
}: {
  children: React.ReactNode;
  color: "muted" | "warning" | "danger" | "success";
  icon: string;
  spin?: boolean;
}) {
  const colorMap = {
    muted: { bg: "var(--surface-1)", text: "var(--text-muted)" },
    warning: { bg: "var(--bg-warning)", text: "var(--text-warning)" },
    danger: { bg: "var(--bg-danger)", text: "var(--text-danger)" },
    success: { bg: "var(--bg-success)", text: "var(--text-success)" },
  }[color];
  return (
    <div style={{ marginTop: 20, padding: "12px 16px", borderRadius: 10, background: colorMap.bg, display: "flex", alignItems: "center", gap: 8 }}>
      <i className={`ti ${icon}`} aria-hidden="true" style={{ fontSize: 15, color: colorMap.text, animation: spin ? "spin 1s linear infinite" : undefined }}></i>
      <p style={{ color: colorMap.text, fontSize: 13, margin: 0 }}>{children}</p>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
