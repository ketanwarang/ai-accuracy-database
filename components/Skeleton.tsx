"use client";

export function SkeletonLine({ width = "100%", height = 14 }: { width?: string | number; height?: number }) {
  return <div className="skeleton" style={{ width, height, borderRadius: 4 }} />;
}

export function SkeletonCard() {
  return (
    <div className="card" style={{ padding: "1.25rem", minHeight: 180 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div className="skeleton" style={{ width: 38, height: 38, borderRadius: 10 }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <SkeletonLine width="55%" height={16} />
          <SkeletonLine width="35%" height={12} />
        </div>
      </div>
      <SkeletonLine width="70%" height={12} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 14 }}>
        <div className="skeleton" style={{ height: 46, borderRadius: 8 }} />
        <div className="skeleton" style={{ height: 46, borderRadius: 8 }} />
        <div className="skeleton" style={{ height: 46, borderRadius: 8 }} />
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ background: "var(--surface-1)", borderRadius: "var(--radius-lg)", padding: "0.75rem", overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 12, padding: "8px 10px", marginBottom: 4 }}>
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="skeleton" style={{ flex: i === 0 ? 2 : 1, height: 12 }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: "flex", gap: 12, padding: "10px 10px", borderTop: "0.5px solid var(--border)" }}>
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="skeleton" style={{ flex: j === 0 ? 2 : 1, height: 12, opacity: 1 - i * 0.1 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  const widths = ["100%", "85%", "70%", "90%", "60%"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} width={widths[i % widths.length]} />
      ))}
    </div>
  );
}
