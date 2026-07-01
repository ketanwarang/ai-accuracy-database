export function formatPct(val: number | null | undefined, decimals = 2): string {
  if (val == null || isNaN(val)) return "N/A";
  return (val * 100).toFixed(decimals) + "%";
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? "s" : ""} ago`;
  return formatDate(dateStr);
}

export function formatNumber(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "—";
  return val.toLocaleString();
}

export const HEALTHY_THRESHOLD = 0.95;
export const WARNING_THRESHOLD = 0.85;

export type HealthStatus = "healthy" | "warning" | "critical" | "no-data";

export function getHealthStatus(values: (number | null | undefined)[]): HealthStatus {
  const valid = values.filter((v): v is number => v != null && !isNaN(v));
  if (!valid.length) return "no-data";
  const worst = Math.min(...valid);
  if (worst >= HEALTHY_THRESHOLD) return "healthy";
  if (worst >= WARNING_THRESHOLD) return "warning";
  return "critical";
}

export function healthColor(status: HealthStatus) {
  switch (status) {
    case "healthy":
      return { bg: "var(--bg-success)", border: "var(--border-success)", text: "var(--text-success)", icon: "ti-check", glow: "rgba(151, 196, 89, 0.28)" };
    case "warning":
      return { bg: "var(--bg-warning)", border: "var(--border-warning)", text: "var(--text-warning)", icon: "ti-alert-triangle", glow: "rgba(239, 159, 39, 0.3)" };
    case "critical":
      return { bg: "var(--bg-danger)", border: "var(--border-danger)", text: "var(--text-danger)", icon: "ti-alert-triangle", glow: "rgba(224, 65, 63, 0.32)" };
    default:
      return { bg: "var(--surface-1)", border: "var(--border-strong)", text: "var(--text-muted)", icon: "ti-clock", glow: "rgba(120, 120, 120, 0.18)" };
  }
}

export function pillColor(val: number | null | undefined) {
  if (val == null || isNaN(val)) return { bg: "var(--surface-1)", text: "var(--text-muted)" };
  if (val >= HEALTHY_THRESHOLD) return { bg: "var(--bg-success)", text: "var(--text-success)" };
  if (val >= WARNING_THRESHOLD) return { bg: "var(--bg-warning)", text: "var(--text-warning)" };
  return { bg: "var(--bg-danger)", text: "var(--text-danger)" };
}
