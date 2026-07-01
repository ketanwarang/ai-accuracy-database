"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ margin: 0, fontFamily: "-apple-system, sans-serif", background: "#0d0d0f", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ maxWidth: 420, textAlign: "center", padding: "2rem" }}>
          <p style={{ color: "#f2f2f2", fontSize: 16, fontWeight: 500, marginBottom: 8 }}>Something went wrong</p>
          <p style={{ color: "#a8a8a8", fontSize: 13, marginBottom: 20 }}>{error.message || "An unexpected error occurred."}</p>
          <button
            onClick={reset}
            style={{ background: "#2a78d6", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
