"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";
import { createClient } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/auth";

function ResetPasswordContent() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    (async () => {
      const code = searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) { setInvalid(true); setReady(true); return; }
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setInvalid(true); }
      setReady(true);
    })();
  }, []);

  // Navigate home once the auth context confirms must_change_password has
  // cleared, instead of racing a redirect against that async state update.
  useEffect(() => {
    if (status === "saved" && user?.mustChangePassword !== true) router.push("/");
  }, [status, user]);

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

    setStatus("saved");
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

        {!ready ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Verifying link…</p>
        ) : invalid ? (
          <>
            <h1 style={{ fontSize: 18, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 8px" }}>Link expired</h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 20px" }}>
              This reset link is invalid or has expired. Request a new one.
            </p>
            <button className="primary" onClick={() => router.push("/forgot-password")} style={{ width: "100%" }}>
              Request new link
            </button>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 6px" }}>Set a new password</h1>
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
              <p className="flash-message" style={{ fontSize: 12, color: "var(--text-danger)", margin: "10px 0" }}>{errorMsg}</p>
            )}

            <button
              onClick={handleSave}
              disabled={status === "saving" || status === "saved"}
              className="primary"
              style={{ width: "100%", marginTop: 10 }}
            >
              {status === "saving" || status === "saved" ? "Saving…" : "Save password"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "var(--surface-0)" }} />}>
      <ResetPasswordContent />
    </Suspense>
  );
}
