"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";

export default function CreateAccountPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "creating" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setErrorMsg("Enter your email."); return; }
    if (!trimmed.endsWith("@paralleldots.com")) {
      setErrorMsg("Only @paralleldots.com accounts are allowed.");
      return;
    }

    setStatus("creating");
    setErrorMsg("");

    try {
      const res = await fetch("/api/create-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.message || data.error || "Something went wrong.");
        setStatus("error");
        return;
      }
      setTempPassword(data.tempPassword);
      setStatus("done");
    } catch {
      setErrorMsg("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable — user can still select the text manually
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

        {status === "done" ? (
          <div>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--bg-success)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <i className="ti ti-check" aria-hidden="true" style={{ fontSize: 22, color: "var(--text-success)" }}></i>
            </div>
            <h1 style={{ fontSize: 18, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 6px", textAlign: "center" }}>Account created</h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 18px", textAlign: "center" }}>
              This temporary password is shown once — copy it now.
            </p>

            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
              background: "var(--surface-2)", border: "0.5px solid var(--border-strong)",
              borderRadius: 8, padding: "10px 12px",
            }}>
              <code style={{ flex: 1, fontSize: 14, letterSpacing: "0.02em", color: "var(--text-primary)", wordBreak: "break-all" }}>
                {tempPassword}
              </code>
              <button onClick={handleCopy} style={{ flexShrink: 0, padding: "5px 8px", fontSize: 12 }}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <div style={{ background: "var(--bg-warning)", border: "0.5px solid var(--border-warning)", borderRadius: 8, padding: "10px 12px", marginBottom: 20 }}>
              <p style={{ fontSize: 12, color: "var(--text-warning)", margin: 0 }}>
                <i className="ti ti-alert-triangle" aria-hidden="true" style={{ marginRight: 6 }}></i>
                Sign in with this password, then change it right away — you'll be asked automatically.
              </p>
            </div>

            <button className="primary" onClick={() => router.push("/login")} style={{ width: "100%" }}>
              Continue to sign in
            </button>
          </div>
        ) : (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 6px" }}>Create account</h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 20px" }}>
              Enter your ParallelDots email. You'll only be able to create an account if a super admin has already granted you access.
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
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              style={{ width: "100%", marginBottom: 10 }}
            />

            {errorMsg && (
              <p style={{ fontSize: 12, color: "var(--text-danger)", margin: "0 0 10px" }}>{errorMsg}</p>
            )}

            <button
              onClick={handleCreate}
              disabled={status === "creating"}
              className="primary"
              style={{ width: "100%", marginTop: 4 }}
            >
              {status === "creating" ? "Creating…" : "Create account"}
            </button>

            <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", marginTop: 16 }}>
              Already have an account? <Link href="/login">Sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
