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
    categoryCount: number;
    multipleDatesDetected: boolean;
    totalDatesInFile: number;
    rowsExcluded: number;
  } | null>(null);
  const { user, loading: authLoading } = useAuth();
  const [savedInfo, setSavedInfo] = useState<{ testDate: string; categoryCount: number } | null>(null);
  const [fileQueue, setFileQueue] = useState<File[]>([]);
  const [queueProgress, setQueueProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);

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

  // Handle multiple files — process them one by one after validation
  async function handleFiles(files: File[]) {
    if (!files.length) return;
    if (files.length === 1) {
      handleFile(files[0]);
      return;
    }
    // Validate all files first
    const validFiles: File[] = [];
    const errors: string[] = [];
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        errors.push(`${file.name}: not a CSV file`);
        continue;
      }
      if (file.size > 100 * 1024 * 1024) {
        errors.push(`${file.name}: exceeds 100MB limit`);
        continue;
      }
      validFiles.push(file);
    }
    if (errors.length) {
      setStatus("validation-error");
      setMessage(errors.join(", "));
      return;
    }
    setFileQueue(validFiles);
    // Start processing the queue
    await processFileQueue(validFiles);
  }

  async function processFileQueue(files: File[]) {
    setStatus("saving");
    let totalCategories = 0;
    let lastDate = "";
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setQueueProgress({ current: i + 1, total: files.length, fileName: file.name });
      setProgressPct(Math.floor((i / files.length) * 100));
      setProgressMsg(`Processing file ${i + 1} of ${files.length}: ${file.name}`);
      try {
        const result = await processFileDirect(file);
        if (result) { totalCategories += result.categoryCount; lastDate = result.testDate; }
      } catch (err: any) {
        setStatus("error");
        setMessage(`Failed on ${file.name}: ${err.message}`);
        setQueueProgress(null);
        return;
      }
    }
    setQueueProgress(null);
    setFileQueue([]);
    setSavedInfo({ testDate: lastDate, categoryCount: totalCategories });
    setStatus("idle");
    setProgressPct(100);
    setProgressMsg("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function processFileDirect(file: File): Promise<{ testDate: string; categoryCount: number } | null> {
    return new Promise((resolve, reject) => {
      Papa.parse<Row>(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (result) => {
          try {
            const rows = result.data;
            if (!rows.length) { reject(new Error("No rows found")); return; }
            const testDate = detectTestDate(rows);
            if (!testDate) { reject(new Error("No date column found")); return; }
            const latestRows = filterToLatestDate(rows);
            const { categories } = computeAllCategories(latestRows);
            const confusionPairs = buildConfusionPairs(latestRows);

            for (const cat of categories) {
              let snapshotId: string;
              const { data: existingSnap } = await supabase
                .from("snapshots").select("id").eq("project_id", selectedProjectId).eq("test_date", testDate).maybeSingle();
              if (existingSnap) {
                snapshotId = existingSnap.id;
              } else {
                const { data: snapRow, error: snapErr } = await supabase
                  .from("snapshots")
                  .insert({ project_id: selectedProjectId, test_date: testDate, file_name: file.name, row_count: latestRows.length })
                  .select().single();
                if (snapErr || !snapRow) { reject(new Error("Failed to create snapshot")); return; }
                snapshotId = snapRow.id;
              }
              // Purge old confusion_pairs for this category
              const { data: allSnaps } = await supabase.from("snapshots").select("id").eq("project_id", selectedProjectId);
              const allSnapIds = (allSnaps || []).map((s: any) => s.id);
              if (allSnapIds.length) {
                await supabase.from("confusion_pairs").delete().in("snapshot_id", allSnapIds).eq("category_name", cat.category_name);
              }
              await supabase.from("category_metrics").delete().eq("snapshot_id", snapshotId).eq("category_name", cat.category_name);
              await supabase.from("category_metrics").insert({
                snapshot_id: snapshotId, category_name: cat.category_name,
                total_annotations: cat.total_annotations, image_count: cat.image_count,
                gpd_accuracy: cat.gpd_accuracy, group_accuracy: cat.group_accuracy,
                class_accuracy: cat.class_accuracy, openset_accuracy: cat.openset_accuracy,
                osa_accuracy: cat.osa_accuracy, sticker_detector_accuracy: cat.sticker_detector_accuracy,
                sticker_value_accuracy: cat.sticker_value_accuracy,
              });
              const catPairs = confusionPairs.filter((p) => p.category_name === cat.category_name);
              if (catPairs.length) {
                const batchSize = 500;
                const rows2 = catPairs.map((p) => ({
                  snapshot_id: snapshotId, category_name: p.category_name, matrix_type: p.matrix_type,
                  actual_value: p.actual_value, predicted_value: p.predicted_value, count: p.count,
                  self_count: p.self_count, total_count: p.total_count, accuracy_pct: p.accuracy_pct, is_mismatch: p.is_mismatch,
                }));
                for (let i = 0; i < rows2.length; i += batchSize) {
                  await supabase.from("confusion_pairs").insert(rows2.slice(i, i + batchSize));
                }
              }
            }
            resolve({ testDate, categoryCount: categories.length });
          } catch (err: any) { reject(err); }
        },
        error: (err) => reject(new Error("CSV parse error: " + err.message)),
      });
    });
  }

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
      const { rows, fileName, testDate } = pendingData;

      setProgressMsg("Computing accuracy metrics…"); setProgressPct(15);
      const { categories } = computeAllCategories(rows);
      const confusionPairs = buildConfusionPairs(rows);

      setProgressMsg(`Processing ${categories.length} categories…`); setProgressPct(25);

      for (let ci = 0; ci < categories.length; ci++) {
        const cat = categories[ci];
        setProgressPct(25 + Math.floor((ci / categories.length) * 65));
        setProgressMsg(`Saving ${cat.category_name} (${ci + 1}/${categories.length})…`);

        // Find existing snapshot for this project+date
        let snapshotId: string;
        const { data: existingSnap } = await supabase
          .from("snapshots")
          .select("id")
          .eq("project_id", selectedProjectId)
          .eq("test_date", testDate)
          .maybeSingle();

        if (existingSnap) {
          snapshotId = existingSnap.id;
        } else {
          // Create new snapshot for this project+date
          const { data: snapRow, error: snapErr } = await supabase
            .from("snapshots")
            .insert({ project_id: selectedProjectId, test_date: testDate, file_name: fileName, row_count: rows.length, uploaded_by: supabase.auth.getUser ? (await supabase.auth.getUser()).data.user?.email || null : null })
            .select().single();
          if (snapErr || !snapRow) throw new Error("Failed to create snapshot: " + snapErr?.message);
          snapshotId = snapRow.id;
        }

        // Purge confusion_pairs for this category from ALL snapshots for this project
        // (we keep category_metrics for all dates for historical trend tracking,
        // but confusion_pairs/accuracies/issues are only needed for the latest data)
        const { data: allSnapsForProject } = await supabase
          .from("snapshots")
          .select("id")
          .eq("project_id", selectedProjectId);
        const allSnapIds = (allSnapsForProject || []).map((s: any) => s.id);
        if (allSnapIds.length) {
          await supabase.from("confusion_pairs")
            .delete().in("snapshot_id", allSnapIds).eq("category_name", cat.category_name);
        }
        // Delete same-date category_metrics for this category only (replace with fresh)
        await supabase.from("category_metrics")
          .delete().eq("snapshot_id", snapshotId).eq("category_name", cat.category_name);

        // Insert fresh category metrics
        const { error: catErr } = await supabase.from("category_metrics").insert({
          snapshot_id: snapshotId,
          category_name: cat.category_name,
          total_annotations: cat.total_annotations,
          image_count: cat.image_count,
          gpd_accuracy: cat.gpd_accuracy,
          group_accuracy: cat.group_accuracy,
          class_accuracy: cat.class_accuracy,
          openset_accuracy: cat.openset_accuracy,
          osa_accuracy: cat.osa_accuracy,
          sticker_detector_accuracy: cat.sticker_detector_accuracy,
          sticker_value_accuracy: cat.sticker_value_accuracy,
        });
        if (catErr) throw new Error(`Failed to save ${cat.category_name}: ` + catErr.message);

        // Insert confusion pairs for this category
        const catPairs = confusionPairs.filter((p) => p.category_name === cat.category_name);
        if (catPairs.length) {
          const batchSize = 500;
          const confusionRows = catPairs.map((p) => ({
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
          for (let i = 0; i < confusionRows.length; i += batchSize) {
            const { error: confErr } = await supabase.from("confusion_pairs").insert(confusionRows.slice(i, i + batchSize));
            if (confErr) throw new Error("Failed to save confusion data: " + confErr.message);
          }
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
                if (selectedProjectId) handleFiles(Array.from(e.dataTransfer.files));
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
                {selectedProjectId ? "Multiple files supported · annotation-level export · max 100MB each" : "Select a project first"}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                multiple
                style={{ display: "none" }}
                onChange={(e) => handleFiles(Array.from(e.target.files || []))}
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
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 12px" }}>Categories already in the system for this date will be silently updated.</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="primary" onClick={handleConfirmSave}>
                    "Confirm and save"
                  </button>
                  <button onClick={handleCancelConfirm} style={{ background: "transparent" }}>Cancel</button>
                </div>
              </div>
            )}

            {status === "parsing" && (
              <StatusBox color="muted" icon="ti-loader-2" spin>{progressMsg || "Parsing CSV…"}</StatusBox>
            )}
            {queueProgress && (
              <div style={{ marginTop: 20, padding: "12px 16px", borderRadius: 10, background: "var(--surface-1)", border: "0.5px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <i className="ti ti-files" aria-hidden="true" style={{ fontSize: 15, color: "var(--text-accent)" }}></i>
                  <p style={{ fontSize: 13, color: "var(--text-primary)", margin: 0, fontWeight: 500 }}>
                    Processing file {queueProgress.current} of {queueProgress.total}
                  </p>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{queueProgress.fileName}</p>
                <div style={{ display: "flex", gap: 3 }}>
                  {Array.from({ length: queueProgress.total }).map((_, i) => (
                    <div key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: i < queueProgress.current - 1 ? "var(--fill-success)" : i === queueProgress.current - 1 ? "var(--fill-accent)" : "var(--border)" }} />
                  ))}
                </div>
              </div>
            )}
            {status === "saving" && !queueProgress && (
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
