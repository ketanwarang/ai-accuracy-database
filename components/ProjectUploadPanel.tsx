"use client";

import { useState, useRef } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabaseClient";
import { Row, computeAllCategories, detectTestDate, filterToLatestDate } from "@/lib/accuracy";
import { saveSnapshotData } from "@/lib/uploadProcessing";
import { formatDate } from "@/lib/format";

interface PendingData {
  rows: Row[];
  fileName: string;
  testDate: string;
  categoryCount: number;
  multipleDatesDetected: boolean;
  totalDatesInFile: number;
  rowsExcluded: number;
}

type Status =
  | "idle"
  | "parsing"
  | "confirming"
  | "confirming-queue"
  | "confirming-no-cgc"
  | "saving"
  | "done"
  | "error"
  | "validation-error";

// Project-scoped upload: same save logic as /upload, but the project is
// locked to whichever one you're currently viewing — no dropdown needed.
export default function ProjectUploadPanel({ projectId, onComplete }: { projectId: string; onComplete?: () => void }) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [progressMsg, setProgressMsg] = useState("");
  const [progressPct, setProgressPct] = useState(0);
  const [pendingData, setPendingData] = useState<PendingData | null>(null);
  const [queuedFiles, setQueuedFiles] = useState<File[] | null>(null);
  const [queueProgress, setQueueProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);

  function handlePick() {
    fileInputRef.current?.click();
  }

  async function projectHasCgcSheet(): Promise<boolean> {
    const { count } = await supabase
      .from("project_cgc_mappings")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId);
    return !!count;
  }

  function validateFiles(files: File[]): { valid: File[]; errors: string[] } {
    const valid: File[] = [];
    const errors: string[] = [];
    const maxSizeMB = 100;
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        errors.push(`${file.name}: not a CSV file`);
        continue;
      }
      if (file.size > maxSizeMB * 1024 * 1024) {
        errors.push(`${file.name}: exceeds ${maxSizeMB}MB limit`);
        continue;
      }
      valid.push(file);
    }
    return { valid, errors };
  }

  async function handleFiles(files: File[]) {
    if (!files.length) return;
    if (files.length === 1) {
      handleSingleFile(files[0]);
      return;
    }

    const { valid, errors } = validateFiles(files);
    if (errors.length) {
      setStatus("validation-error");
      setMessage(errors.join(", "));
      return;
    }

    setStatus("parsing");
    setMessage("");
    const hasCgc = await projectHasCgcSheet();
    setQueuedFiles(valid);
    if (!hasCgc) {
      setStatus("confirming-no-cgc");
    } else {
      await processFileQueue(valid);
    }
  }

  function handleSingleFile(file: File | undefined) {
    if (!file) return;
    const { valid, errors } = validateFiles([file]);
    if (errors.length) {
      setStatus("validation-error");
      setMessage(errors.join(", "));
      return;
    }

    setStatus("parsing");
    setMessage("");

    Papa.parse<Row>(valid[0], {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = result.data;
        if (!rows.length) {
          setStatus("validation-error");
          setMessage("No rows found in this file. Check it's not empty.");
          return;
        }

        const testDate = detectTestDate(rows);
        if (!testDate) {
          setStatus("validation-error");
          setMessage("Could not find a date column in this file. Check the CSV has a 'date' column with valid dates.");
          return;
        }

        const allDatesInFile = [...new Set(rows.map((r) => r["date"]).filter(Boolean))];
        const latestRows = filterToLatestDate(rows);
        const { categories } = computeAllCategories(latestRows);

        setPendingData({
          rows: latestRows,
          fileName: file.name,
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
      const uploaderEmail = (await supabase.auth.getUser()).data.user?.email || null;
      await saveSnapshotData(supabase, {
        projectId,
        testDate: pendingData.testDate,
        fileName: pendingData.fileName,
        rows: pendingData.rows,
        uploaderEmail,
        onProgress: (msg, pct) => { setProgressMsg(msg); setProgressPct(pct); },
      });
      setStatus("done");
      setPendingData(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onComplete?.();
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message || "Unexpected error");
    }
  }

  async function processFileDirect(file: File): Promise<{ testDate: string; categoryCount: number } | null> {
    return new Promise((resolve, reject) => {
      Papa.parse<Row>(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (result) => {
          try {
            const rows = result.data;
            if (!rows.length) { reject(new Error(`${file.name}: no rows found`)); return; }
            const testDate = detectTestDate(rows);
            if (!testDate) { reject(new Error(`${file.name}: no date column found`)); return; }
            const latestRows = filterToLatestDate(rows);
            const uploaderEmail = (await supabase.auth.getUser()).data.user?.email || null;
            const saved = await saveSnapshotData(supabase, {
              projectId,
              testDate,
              fileName: file.name,
              rows: latestRows,
              uploaderEmail,
            });
            resolve(saved);
          } catch (err: any) { reject(err); }
        },
        error: (err) => reject(new Error(`${file.name}: CSV parse error: ` + err.message)),
      });
    });
  }

  async function processFileQueue(files: File[]) {
    setStatus("saving");
    setMessage("");
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setQueueProgress({ current: i + 1, total: files.length, fileName: file.name });
      setProgressPct(Math.floor((i / files.length) * 100));
      setProgressMsg(`Processing file ${i + 1} of ${files.length}: ${file.name}`);
      try {
        await processFileDirect(file);
      } catch (err: any) {
        setStatus("error");
        setMessage(err.message || "Unexpected error");
        setQueueProgress(null);
        setQueuedFiles(null);
        return;
      }
    }
    setQueueProgress(null);
    setQueuedFiles(null);
    setStatus("done");
    setProgressPct(100);
    setProgressMsg("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    onComplete?.();
  }

  function handleCancel() {
    setPendingData(null);
    setQueuedFiles(null);
    setStatus("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleProceedNoCgc() {
    if (pendingData) {
      await handleConfirmSave();
      return;
    }
    if (queuedFiles) {
      await processFileQueue(queuedFiles);
    }
  }

  function reset() {
    setStatus("idle");
    setMessage("");
  }

  const noCgcWarning = (
    <p style={{ fontSize: 12, color: "var(--text-warning)", margin: "0 0 12px", display: "flex", gap: 6, background: "var(--bg-warning)", border: "0.5px solid var(--border-warning)", borderRadius: 8, padding: "8px 10px" }}>
      <i className="ti ti-alert-triangle" aria-hidden="true" style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}></i>
      <span>No CGC sheet uploaded for this project — Display Name view calculations won't be available for this data until one is added. Continue anyway?</span>
    </p>
  );

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} className="primary" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
        <i className="ti ti-upload" aria-hidden="true"></i>
        Upload data
      </button>

      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 40, width: 340,
            background: "var(--surface-popover)", border: "0.5px solid var(--border)",
            borderRadius: 12, padding: "14px 16px", boxShadow: "var(--shadow-popover)",
            animation: "popIn 0.16s cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          {status === "confirming-no-cgc" ? (
            <div>
              <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 10px" }}>
                {queuedFiles ? `Upload ${queuedFiles.length} files?` : "Confirm upload"}
              </p>
              {noCgcWarning}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="primary" onClick={handleProceedNoCgc} style={{ flex: 1, fontSize: 13 }}>Continue anyway</button>
                <button onClick={handleCancel} style={{ fontSize: 13, background: "transparent" }}>Cancel</button>
              </div>
            </div>
          ) : status === "confirming" && pendingData ? (
            <div>
              <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 10px" }}>Confirm upload</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10, fontSize: 12 }}>
                <div><span style={{ color: "var(--text-muted)" }}>Test date</span><div style={{ color: "var(--text-primary)", fontWeight: 500 }}>{formatDate(pendingData.testDate)}</div></div>
                <div><span style={{ color: "var(--text-muted)" }}>Categories</span><div style={{ color: "var(--text-primary)", fontWeight: 500 }}>{pendingData.categoryCount}</div></div>
                <div><span style={{ color: "var(--text-muted)" }}>Rows used</span><div style={{ color: "var(--text-primary)", fontWeight: 500 }}>{pendingData.rows.length.toLocaleString()}</div></div>
              </div>
              {pendingData.multipleDatesDetected && (
                <p style={{ fontSize: 12, color: "var(--text-accent)", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
                  <i className="ti ti-info-circle" aria-hidden="true" style={{ fontSize: 13 }}></i>
                  File has {pendingData.totalDatesInFile} dates — only the latest ({formatDate(pendingData.testDate)}) is used, {pendingData.rowsExcluded.toLocaleString()} row(s) excluded.
                </p>
              )}
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 12px" }}>Existing data for this date, if any, will be replaced.</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="primary"
                  onClick={async () => {
                    const hasCgc = await projectHasCgcSheet();
                    if (!hasCgc) setStatus("confirming-no-cgc");
                    else await handleConfirmSave();
                  }}
                  style={{ flex: 1, fontSize: 13 }}
                >
                  Confirm and save
                </button>
                <button onClick={handleCancel} style={{ fontSize: 13, background: "transparent" }}>Cancel</button>
              </div>
            </div>
          ) : status === "saving" ? (
            <div>
              {queueProgress && (
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 6px", fontWeight: 500 }}>
                  File {queueProgress.current} of {queueProgress.total}
                </p>
              )}
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{progressMsg || "Saving…"}</p>
              <div style={{ height: 5, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 3, background: "var(--fill-accent)", width: `${progressPct}%`, transition: "width 0.3s ease-out" }} />
              </div>
            </div>
          ) : status === "done" ? (
            <div>
              <div className="flash-message" style={{ background: "var(--bg-success)", border: "0.5px solid var(--border-success)", borderRadius: 8, padding: "10px 12px", marginBottom: 10, fontSize: 12, color: "var(--text-success)", display: "flex", alignItems: "center", gap: 6 }}>
                <i className="ti ti-circle-check" aria-hidden="true"></i> Upload complete
              </div>
              <button onClick={reset} style={{ width: "100%", fontSize: 13 }}>Upload another</button>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 6px" }}>Upload data for this project</p>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>Drop one or more df_out CSV exports — they're saved against this project automatically.</p>

              <div
                onClick={handlePick}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => { e.preventDefault(); setDragActive(false); handleFiles(Array.from(e.dataTransfer.files)); }}
                style={{
                  border: `1.5px dashed ${dragActive ? "var(--fill-accent)" : "var(--border-strong)"}`,
                  borderRadius: 10, padding: "1.5rem 1rem", textAlign: "center", cursor: "pointer",
                  background: dragActive ? "var(--bg-accent)" : "var(--surface-1)",
                  transition: "border-color 0.15s ease, background 0.15s ease",
                }}
              >
                <i className="ti ti-cloud-upload" aria-hidden="true" style={{ fontSize: 22, color: dragActive ? "var(--text-accent)" : "var(--text-muted)", display: "block", marginBottom: 6 }}></i>
                <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>
                  {status === "parsing" ? "Reading file…" : "Drop CSV(s) here, or click to browse — multiple files supported"}
                </p>
                <input ref={fileInputRef} type="file" accept=".csv" multiple style={{ display: "none" }} onChange={(e) => handleFiles(Array.from(e.target.files || []))} />
              </div>

              {(status === "error" || status === "validation-error") && (
                <p className="flash-message" style={{ fontSize: 12, color: "var(--text-danger)", margin: "10px 0 0" }}>{message}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
