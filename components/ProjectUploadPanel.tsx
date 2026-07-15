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

// Project-scoped upload: same save logic as /upload, but the project is
// locked to whichever one you're currently viewing — no dropdown needed.
export default function ProjectUploadPanel({ projectId, onComplete }: { projectId: string; onComplete?: () => void }) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "parsing" | "confirming" | "saving" | "done" | "error" | "validation-error">("idle");
  const [message, setMessage] = useState("");
  const [progressMsg, setProgressMsg] = useState("");
  const [progressPct, setProgressPct] = useState(0);
  const [pendingData, setPendingData] = useState<PendingData | null>(null);
  const [dragActive, setDragActive] = useState(false);

  function handlePick() {
    fileInputRef.current?.click();
  }

  function handleFile(file: File | undefined) {
    if (!file) return;
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

    Papa.parse<Row>(file, {
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

  function handleCancel() {
    setPendingData(null);
    setStatus("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function reset() {
    setStatus("idle");
    setMessage("");
  }

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
          {status === "confirming" && pendingData ? (
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
                <button className="primary" onClick={handleConfirmSave} style={{ flex: 1, fontSize: 13 }}>Confirm and save</button>
                <button onClick={handleCancel} style={{ fontSize: 13, background: "transparent" }}>Cancel</button>
              </div>
            </div>
          ) : status === "saving" ? (
            <div>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 6px" }}>{progressMsg || "Saving…"}</p>
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
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>Drop a df_out CSV export — it's saved against this project automatically.</p>

              <div
                onClick={handlePick}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => { e.preventDefault(); setDragActive(false); handleFile(e.dataTransfer.files?.[0]); }}
                style={{
                  border: `1.5px dashed ${dragActive ? "var(--fill-accent)" : "var(--border-strong)"}`,
                  borderRadius: 10, padding: "1.5rem 1rem", textAlign: "center", cursor: "pointer",
                  background: dragActive ? "var(--bg-accent)" : "var(--surface-1)",
                  transition: "border-color 0.15s ease, background 0.15s ease",
                }}
              >
                <i className="ti ti-cloud-upload" aria-hidden="true" style={{ fontSize: 22, color: dragActive ? "var(--text-accent)" : "var(--text-muted)", display: "block", marginBottom: 6 }}></i>
                <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>
                  {status === "parsing" ? "Reading file…" : "Drop CSV here, or click to browse"}
                </p>
                <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files?.[0])} />
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
