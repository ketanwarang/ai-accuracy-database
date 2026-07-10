"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { createClient } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/auth";

export default function ChangePasswordPage() {
  const supabase = createClient();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const mandatory = user?.mustChangePassword === true;

  async function handleSave() {
    if (password.length < 8) { setErrorMsg("Password must be at least 8 characters."); return; }
    if (password !== confirmPassword) { setErrorMsg("Passwords don't match."); return; }

    setStatus("saving");
    setErrorMsg("");

    const { error } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false },
    });

    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
      return;
    }

    router.push("/");
  }

  if (authLoading) return <div style={{ minHeight: "100vh", background: "var(--surface-0)" }} />;
  if (!user) { router.push("/login"); return null; }

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--surface-0)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "var(--font-sans)",
    }}>
      <div style={{
        width: 380,
        background: "var(--surface-1)",
        borderRadius: 16,
        padding: "2rem 1.75rem",
        border: "0.5px solid var(--border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <Logo size={36} />
          <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text-primary)" }}>AI Accuracy Database</span>
        </div>

        {mandatory && (
          <div style={{ background: "var(--bg-warning)", border: "0.5px solid var(--border-warning)", borderRadius: 8, padding: "10px 12px", marginBottom: 18 }}>
            <p style={{ fontSize: 12, color: "var(--text-warning)", margin: 0 }}>
              <i className="ti ti-alert-triangle" aria-hidden="true" style={{ marginRight: 6 }}></i>
              You're using a temporary password. Set a new one to continue.
            </p>
          </div>
        )}

        <h1 style={{ fontSize: 20, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 6px" }}>
          {mandatory ? "Set a new password" : "Change password"}
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 20px" }}>
          Choose a password with at least 8 characters.
        </p>

        <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
          New password
        </label>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => { setPassword(e.target.value); setErrorMsg(""); }}
          style={{ width: "100%", marginBottom: 10 }}
        />

        <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
          Confirm new password
        </label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => { setConfirmPassword(e.target.value); setErrorMsg(""); }}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          style={{ width: "100%", marginBottom: 6 }}
        />

        {errorMsg && (
          <p style={{ fontSize: 12, color: "var(--text-danger)", margin: "10px 0" }}>{errorMsg}</p>
        )}

        <button
          onClick={handleSave}
          disabled={status === "saving"}
          className="primary"
          style={{ width: "100%", marginTop: 10 }}
        >
          {status === "saving" ? "Saving…" : "Save password"}
        </button>
      </div>
    </div>
  );
}
