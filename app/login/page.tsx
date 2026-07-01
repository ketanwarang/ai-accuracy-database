"use client";

import { useState, Suspense } from "react";
import Logo from "@/components/Logo";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

const ERROR_MESSAGES: Record<string, string> = {
  domain_not_allowed: "Only @paralleldots.com accounts are allowed.",
  no_access: "Your account hasn't been granted access yet. Contact ketan.warang@paralleldots.com.",
  auth_failed: "Authentication failed. Please try again.",
};

function LoginPageContent() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSendLink() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setErrorMsg("Enter your email."); return; }
    if (!trimmed.endsWith("@paralleldots.com")) {
      setErrorMsg("Only @paralleldots.com accounts are allowed.");
      return;
    }

    setStatus("sending");
    setErrorMsg("");

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: true,
      },
    });

    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

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

        {errorCode && ERROR_MESSAGES[errorCode] && (
          <div style={{ background: "var(--bg-danger)", border: "0.5px solid var(--border-danger)", borderRadius: 8, padding: "10px 12px", marginBottom: 16 }}>
            <p style={{ fontSize: 13, color: "var(--text-danger)", margin: 0 }}>
              <i className="ti ti-alert-triangle" aria-hidden="true" style={{ marginRight: 6 }}></i>
              {ERROR_MESSAGES[errorCode]}
            </p>
          </div>
        )}

        {status === "sent" ? (
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--bg-success)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <i className="ti ti-mail" aria-hidden="true" style={{ fontSize: 22, color: "var(--text-success)" }}></i>
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 8px" }}>Check your email</h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 20px" }}>
              A sign-in link was sent to<br />
              <strong style={{ color: "var(--text-primary)" }}>{email}</strong>
            </p>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 16px" }}>
              Click the link in the email to sign in. It expires in 1 hour.
            </p>
            <button
              onClick={() => { setStatus("idle"); setEmail(""); }}
              style={{ fontSize: 13, color: "var(--text-accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 6px" }}>Sign in</h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 20px" }}>
              Enter your ParallelDots email to receive a sign-in link.
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
              onKeyDown={(e) => e.key === "Enter" && handleSendLink()}
              style={{ width: "100%", marginBottom: 10 }}
            />

            {errorMsg && (
              <p style={{ fontSize: 12, color: "var(--text-danger)", margin: "0 0 10px" }}>{errorMsg}</p>
            )}

            <button
              onClick={handleSendLink}
              disabled={status === "sending"}
              className="primary"
              style={{ width: "100%", marginTop: 4 }}
            >
              {status === "sending" ? "Sending…" : "Send sign-in link"}
            </button>

            <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", marginTop: 16 }}>
              Only @paralleldots.com accounts have access.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "var(--surface-0)" }} />}>
      <LoginPageContent />
    </Suspense>
  );
}
