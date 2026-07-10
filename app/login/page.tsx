"use client";

import { useState, Suspense } from "react";
import Logo from "@/components/Logo";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

const ERROR_MESSAGES: Record<string, string> = {
  domain_not_allowed: "Only @paralleldots.com accounts are allowed.",
  no_access: "Your account hasn't been granted access yet. Contact ketan.warang@paralleldots.com.",
  auth_failed: "Authentication failed. Please try again.",
};

function LoginPageContent() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "signing-in" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSignIn() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setErrorMsg("Enter your email."); return; }
    if (!trimmed.endsWith("@paralleldots.com")) {
      setErrorMsg("Only @paralleldots.com accounts are allowed.");
      return;
    }
    if (!password) { setErrorMsg("Enter your password."); return; }

    setStatus("signing-in");
    setErrorMsg("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email: trimmed,
      password,
    });

    if (error) {
      const friendly = /invalid login credentials/i.test(error.message)
        ? "Incorrect email or password."
        : error.message;
      setErrorMsg(friendly);
      setStatus("error");
      return;
    }

    const mustChangePassword = data.user?.user_metadata?.must_change_password === true;
    router.push(mustChangePassword ? "/change-password" : "/");
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

        <h1 style={{ fontSize: 20, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 6px" }}>Sign in</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 20px" }}>
          Enter your ParallelDots email and password.
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
          onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
          style={{ width: "100%", marginBottom: 10 }}
        />

        <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
          Password
        </label>
        <input
          type="password"
          placeholder="••••••••••••"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setErrorMsg(""); }}
          onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
          style={{ width: "100%", marginBottom: 6 }}
        />

        <div style={{ textAlign: "right", marginBottom: 10 }}>
          <Link href="/forgot-password" style={{ fontSize: 12 }}>Forgot password?</Link>
        </div>

        {errorMsg && (
          <p style={{ fontSize: 12, color: "var(--text-danger)", margin: "0 0 10px" }}>{errorMsg}</p>
        )}

        <button
          onClick={handleSignIn}
          disabled={status === "signing-in"}
          className="primary"
          style={{ width: "100%", marginTop: 4 }}
        >
          {status === "signing-in" ? "Signing in…" : "Sign in"}
        </button>

        <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", marginTop: 16 }}>
          Don't have an account yet? <Link href="/create-account">Create one</Link>
        </p>
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
