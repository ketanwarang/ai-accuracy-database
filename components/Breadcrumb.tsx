"use client";

import { useRouter } from "next/navigation";

interface Crumb {
  label: string;
  href?: string;
}

export default function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  const router = useRouter();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {i > 0 && (
              <i className="ti ti-chevron-right" aria-hidden="true" style={{ fontSize: 12, color: "var(--text-muted)" }}></i>
            )}
            {isLast ? (
              <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>{crumb.label}</span>
            ) : (
              <button
                onClick={() => crumb.href && router.push(crumb.href)}
                style={{ fontSize: 13, color: "var(--text-muted)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
              >
                {crumb.label}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
