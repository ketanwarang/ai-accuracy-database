"use client";

import { useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import { createClient } from "@/lib/supabaseClient";

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSend() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setErrorMsg("Enter your email."); return; }
    if (!trimmed.endsWith("@paralleldots.com")) {
      setErrorMsg("Only @paralleldots.com accounts are allowed.");
      return;
    }

    setStatus("sending");
    setErrorMsg("");

    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="auth-page" style={{
      minHeight: "100vh",
      background: "var(--surface-0)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "var(--font-sans)",
    }}>
      <div className="glass-card" style={{
        width: 380,
        borderRadius: 16,
        padding: "2rem 1.75rem",
        border: "0.5px solid var(--border)",
        boxShadow: "var(--shadow-lg)",
        animation: "popIn 0.3s ease-out",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <Logo size={36} />
          <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text-primary)" }}>AI Accuracy Database</span>
        </div>

        {status === "sent" ? (
          <div style={{ textAlign: "center", padding: "1rem 0", animation: "fadeIn 0.25s ease-out" }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--bg-success)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", animation: "popIn 0.35s ease-out" }}>
              <i className="ti ti-mail" aria-hidden="true" style={{ fontSize: 22, color: "var(--text-success)" }}></i>
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 8px" }}>Check your email</h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 20px" }}>
              A password reset link was sent to<br />
              <strong style={{ color: "var(--text-primary)" }}>{email}</strong>
            </p>
            <Link href="/login" style={{ fontSize: 13 }}>Back to sign in</Link>
          </div>
        ) : (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 6px" }}>Reset password</h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 20px" }}>
              Enter your email and we'll send you a link to set a new password.
            </p>

            <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
              Email
            </label>
            <input
              type="email"
              autoFocus
              placeholder="you@paralleldots.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErrorMsg(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              style={{ width: "100%", marginBottom: 10 }}
            />

            {errorMsg && (
              <p className="flash-message" style={{ fontSize: 12, color: "var(--text-danger)", margin: "0 0 10px" }}>{errorMsg}</p>
            )}

            <button
              onClick={handleSend}
              disabled={status === "sending"}
              className="primary"
              style={{ width: "100%", marginTop: 4 }}
            >
              {status === "sending" ? "Sending…" : "Send reset link"}
            </button>

            <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", marginTop: 16 }}>
              <Link href="/login">Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
