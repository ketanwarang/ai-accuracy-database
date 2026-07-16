"use client";

import { useState, useRef, useEffect } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabaseClient";
import { Row } from "@/lib/accuracy";
import { parseCgcMapping } from "@/lib/cgc";
import { recomputeDisplayViewForProject } from "@/lib/recomputeDisplay";

interface CgcStatus {
  classCount: number;
  uploadedAt: string;
}

// project_cgc_mappings.created_at is a full timestamptz string (unlike
// test_date, which is date-only) — formatRelativeTime() in lib/format.ts
// expects date-only strings, so it doesn't apply here.
function formatUploadedAt(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  const diffDays = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function CgcUploadPanel({ projectId, onComplete }: { projectId: string; onComplete?: () => void }) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [progressMsg, setProgressMsg] = useState("");
  const [progressPct, setProgressPct] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState<{ mappedClasses: number; totalClasses: number; conflicts: number; snapshotsUpdated: number; snapshotsSkipped: number } | null>(null);
  const [cgcStatus, setCgcStatus] = useState<CgcStatus | null | undefined>(undefined);

  useEffect(() => {
    if (open && cgcStatus === undefined) loadStatus();
  }, [open]);

  async function loadStatus() {
    const { count } = await supabase
      .from("project_cgc_mappings")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId);
    if (!count) { setCgcStatus(null); return; }
    const { data: latest } = await supabase
      .from("project_cgc_mappings")
      .select("created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setCgcStatus({ classCount: count, uploadedAt: latest?.created_at || "" });
  }

  async function handleDelete() {
    if (
      !confirm(
        "Delete the CGC sheet for this project? Already-computed Display Name view data stays intact and keeps showing as-is — this only stops new uploads from computing Display Name metrics until a new CGC sheet is added."
      )
    )
      return;
    setStatus("working");
    setProgressMsg("Deleting CGC mapping…");
    setProgressPct(50);
    try {
      // Only the mapping itself is removed. category_metrics/confusion_pairs
      // rows with view_mode='display' are left untouched, so existing graphs
      // and calculations are unaffected by this — they only get recomputed
      // (or added to, for future uploads) once a CGC sheet exists again.
      await supabase.from("project_cgc_mappings").delete().eq("project_id", projectId);
      setCgcStatus(null);
      setResult(null);
      setStatus("idle");
      onComplete?.();
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Failed to delete CGC sheet.");
    }
  }

  function handlePick() {
    fileInputRef.current?.click();
  }

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setStatus("error");
      setErrorMsg("Only .csv files are supported.");
      return;
    }

    setStatus("working");
    setErrorMsg("");
    setResult(null);
    setProgressMsg("Reading CGC sheet…");
    setProgressPct(5);

    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (parsed) => {
        try {
          const rows = parsed.data;
          if (!rows.length) throw new Error("No rows found in this file.");

          const { mapping, totalClasses, mappedClasses, conflicts } = parseCgcMapping(rows);
          if (!mappedClasses) {
            throw new Error("No display_name values found. Check this is the CGC export, not a raw accuracy CSV.");
          }

          setProgressMsg(`Replacing previous mapping with ${mappedClasses} new classes…`);
          setProgressPct(15);

          // Wipe the old mapping (and anything computed from it) before
          // saving the new one, so stale data never lingers.
          await supabase.from("project_cgc_mappings").delete().eq("project_id", projectId);
          const mappingRows = Object.entries(mapping).map(([class_name, display_name]) => ({
            project_id: projectId,
            class_name,
            display_name,
          }));
          const batchSize = 500;
          for (let i = 0; i < mappingRows.length; i += batchSize) {
            const { error } = await supabase.from("project_cgc_mappings").insert(mappingRows.slice(i, i + batchSize));
            if (error) throw new Error("Failed to save CGC mapping: " + error.message);
          }

          const recompute = await recomputeDisplayViewForProject(supabase, projectId, mapping, (msg, pct) => {
            setProgressMsg(msg);
            setProgressPct(15 + Math.floor(pct * 0.85));
          });

          setResult({
            mappedClasses,
            totalClasses,
            conflicts,
            snapshotsUpdated: recompute.snapshotsUpdated,
            snapshotsSkipped: recompute.snapshotsSkipped,
          });
          setCgcStatus({ classCount: mappedClasses, uploadedAt: new Date().toISOString() });
          setStatus("done");
          if (fileInputRef.current) fileInputRef.current.value = "";
          onComplete?.();
        } catch (err: any) {
          setStatus("error");
          setErrorMsg(err.message || "Something went wrong.");
        }
      },
      error: (err) => {
        setStatus("error");
        setErrorMsg("CSV parse error: " + err.message);
      },
    });
  }

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
        <i className="ti ti-file-spreadsheet" aria-hidden="true"></i>
        CGC sheet
      </button>

      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 40, width: 320,
            background: "var(--surface-popover)", border: "0.5px solid var(--border)",
            borderRadius: 12, padding: "14px 16px", boxShadow: "var(--shadow-popover)",
            animation: "popIn 0.16s cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 6px" }}>
            CGC sheet
          </p>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
            Maps this project's class names to display names for the Display Name view. Uploading always replaces the previous mapping and recalculates all snapshots — nothing old is left behind.
          </p>

          {cgcStatus !== undefined && (
            <div style={{ background: "var(--surface-2)", borderRadius: 8, padding: "8px 10px", marginBottom: 12, fontSize: 12 }}>
              {cgcStatus ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: "var(--text-primary)" }}>
                    <i className="ti ti-circle-check" aria-hidden="true" style={{ color: "var(--text-success)", marginRight: 5 }}></i>
                    {cgcStatus.classCount} classes mapped
                    {cgcStatus.uploadedAt && <span style={{ color: "var(--text-muted)" }}> · {formatUploadedAt(cgcStatus.uploadedAt)}</span>}
                  </span>
                  <button
                    onClick={handleDelete}
                    disabled={status === "working"}
                    style={{ fontSize: 12, color: "var(--text-danger)", background: "transparent", border: "none", padding: 0 }}
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <span style={{ color: "var(--text-muted)" }}>No CGC sheet uploaded yet.</span>
              )}
            </div>
          )}

          {status === "working" && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 6px" }}>{progressMsg}</p>
              <div style={{ height: 5, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 3, background: "var(--fill-accent)", width: `${progressPct}%`, transition: "width 0.3s ease-out" }} />
              </div>
            </div>
          )}

          {status === "done" && result && (
            <div className="flash-message" style={{ background: "var(--bg-success)", border: "0.5px solid var(--border-success)", borderRadius: 8, padding: "8px 10px", marginBottom: 10, fontSize: 12, color: "var(--text-success)" }}>
              Mapped {result.mappedClasses}/{result.totalClasses} classes
              {result.conflicts ? ` (${result.conflicts} resolved automatically)` : ""}. Updated {result.snapshotsUpdated} snapshot{result.snapshotsUpdated !== 1 ? "s" : ""}
              {result.snapshotsSkipped ? `; ${result.snapshotsSkipped} older snapshot${result.snapshotsSkipped !== 1 ? "s have" : " has"} no row-level data to recompute` : ""}.
            </div>
          )}

          {status === "error" && (
            <p className="flash-message" style={{ fontSize: 12, color: "var(--text-danger)", margin: "0 0 10px" }}>{errorMsg}</p>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <button className="primary" onClick={handlePick} disabled={status === "working"} style={{ width: "100%", fontSize: 13 }}>
            {status === "working" ? "Working…" : cgcStatus ? "Replace CGC sheet" : "Choose CGC CSV"}
          </button>
        </div>
      )}
    </div>
  );
}
