// Displays a project's brand logo, falling back to a colored circle with
// the project's initial letter (capitalized) when no logo is set.

export default function ProjectLogo({
  logoUrl,
  name,
  size = 36,
  radius,
}: {
  logoUrl?: string | null;
  name: string;
  size?: number;
  radius?: number;
}) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  const r = radius ?? Math.round(size * 0.28);

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={`${name} logo`}
        width={size}
        height={size}
        style={{ borderRadius: r, objectFit: "cover", flexShrink: 0, border: "0.5px solid var(--border)" }}
      />
    );
  }

  return (
    <div
      style={{
        width: size, height: size, borderRadius: r, flexShrink: 0,
        background: "var(--bg-accent)", display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: Math.round(size * 0.44), fontWeight: 600, color: "var(--text-accent)",
      }}
    >
      {initial}
    </div>
  );
}
