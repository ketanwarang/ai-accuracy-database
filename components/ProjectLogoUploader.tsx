"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabaseClient";
import ProjectLogo from "@/components/ProjectLogo";

const MAX_SIZE_MB = 3;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export default function ProjectLogoUploader({
  projectId,
  name,
  logoUrl,
  onUpdate,
}: {
  projectId: string;
  name: string;
  logoUrl: string | null;
  onUpdate: (logoUrl: string | null) => void;
}) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  function handlePick() {
    fileInputRef.current?.click();
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setErrorMsg("Use a PNG, JPG, WebP, or SVG image.");
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setErrorMsg(`Image is too large (max ${MAX_SIZE_MB}MB).`);
      return;
    }

    setBusy(true);
    setErrorMsg("");
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${projectId}/logo.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("project-logos")
        .upload(path, file, { upsert: true, cacheControl: "3600" });
      if (uploadErr) throw new Error(uploadErr.message);

      const { data: pub } = supabase.storage.from("project-logos").getPublicUrl(path);
      // Cache-bust so the new image shows immediately, not a stale cached one.
      const freshUrl = `${pub.publicUrl}?v=${Date.now()}`;

      const { error: dbErr } = await supabase.from("projects").update({ logo_url: freshUrl }).eq("id", projectId);
      if (dbErr) throw new Error(dbErr.message);

      onUpdate(freshUrl);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to upload logo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Remove this project's logo? It'll go back to showing the initial letter.")) return;
    setBusy(true);
    setErrorMsg("");
    try {
      await supabase.from("projects").update({ logo_url: null }).eq("id", projectId);
      onUpdate(null);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to remove logo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <div
        onClick={handlePick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title="Click to change logo"
        style={{ position: "relative", cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1 }}
      >
        <ProjectLogo logoUrl={logoUrl} name={name} size={44} />
        {hover && !busy && (
          <div
            style={{
              position: "absolute", inset: 0, borderRadius: 12, background: "rgba(0,0,0,0.45)",
              display: "flex", alignItems: "center", justifyContent: "center", animation: "fadeIn 0.12s ease-out",
            }}
          >
            <i className="ti ti-camera" aria-hidden="true" style={{ fontSize: 16, color: "#fff" }}></i>
          </div>
        )}
      </div>

      {logoUrl && hover && !busy && (
        <button
          onClick={handleRemove}
          title="Remove logo"
          className="icon-btn"
          style={{
            position: "absolute", top: -6, right: -6, width: 18, height: 18,
            background: "var(--fill-danger)", color: "#fff", border: "1.5px solid var(--surface-1)",
          }}
        >
          <i className="ti ti-x" aria-hidden="true" style={{ fontSize: 10 }}></i>
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        style={{ display: "none" }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {errorMsg && (
        <p className="flash-message" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, width: 220, fontSize: 11, color: "var(--text-danger)", margin: 0, zIndex: 10 }}>
          {errorMsg}
        </p>
      )}
    </div>
  );
}
