"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme, ACCENT_OPTIONS } from "@/lib/theme";
import Logo from "@/components/Logo";
import { useAuth } from "@/lib/auth";

export default function TopNav({ accountId }: { accountId?: string }) {
  const router = useRouter();
  const { user, isSuperAdmin, isAdmin, signOut } = useAuth();
  const { mode, accent, setMode, setAccent } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [themeExpanded, setThemeExpanded] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setDrawerOpen(false);
      }
    }
    if (drawerOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [drawerOpen]);

  const isAdminUser = isSuperAdmin || isAdmin(accountId);

  return (
    <>
      <div style={{
        position: "sticky", top: 0, zIndex: 40,
        background: "var(--surface-1)", borderBottom: "0.5px solid var(--border)",
      }}>
        <div style={{
          maxWidth: 1180, margin: "0 auto", padding: "0 1.5rem",
          height: 52, display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div onClick={() => router.push("/")} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <Logo size={28} />
            <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>AI Accuracy Database</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("app:refresh"))}
              aria-label="Refresh data"
              title="Refresh data"
              style={{ padding: "6px 8px", background: "transparent", border: "none", display: "flex", alignItems: "center", gap: 4 }}
            >
              <i className="ti ti-refresh" aria-hidden="true" style={{ fontSize: 17, color: "var(--text-muted)" }}></i>
            </button>
            {user && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt="" width={28} height={28} style={{ borderRadius: "50%", objectFit: "cover" }} />
                ) : (
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--bg-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, color: "var(--text-accent)" }}>
                    {user.email[0].toUpperCase()}
                  </div>
                )}
                <span style={{ fontSize: 13, color: "var(--text-muted)", display: "none" }}>{user.email}</span>
              </div>
            )}
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              style={{ padding: "6px 10px", background: "var(--surface-2)", border: "0.5px solid var(--border-strong)", borderRadius: "var(--radius)", display: "flex", alignItems: "center", gap: 6 }}
            >
              <i className="ti ti-menu-2" aria-hidden="true" style={{ fontSize: 17, color: "var(--text-primary)" }}></i>
              <span style={{ fontSize: 13, color: "var(--text-primary)" }}>Menu</span>
            </button>
          </div>
        </div>
      </div>

      {/* Backdrop */}
      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50, animation: "fadeIn 0.15s ease-out" }}
        />
      )}

      {/* Drawer */}
      <div
        ref={drawerRef}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 280,
          background: "var(--surface-1)", borderLeft: "0.5px solid var(--border)",
          zIndex: 51, display: "flex", flexDirection: "column",
          transform: drawerOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "0.5px solid var(--border)" }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>Menu</span>
          <button onClick={() => setDrawerOpen(false)} style={{ background: "transparent", border: "none", padding: 4 }}>
            <i className="ti ti-x" aria-hidden="true" style={{ fontSize: 18, color: "var(--text-muted)" }}></i>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          <DrawerSection label="Navigate">
            <DrawerItem icon="ti-home" label="All accounts" onClick={() => { router.push("/"); setDrawerOpen(false); }} />
            <DrawerItem icon="ti-upload" label="Upload data" onClick={() => { router.push("/upload"); setDrawerOpen(false); }} />
          </DrawerSection>

          {isAdminUser && (
            <DrawerSection label="Manage">
              <DrawerItem icon="ti-building" label="Manage accounts" onClick={() => { router.push("/admin/accounts"); setDrawerOpen(false); }} />
              <DrawerItem icon="ti-folder" label="Manage projects" onClick={() => { router.push("/admin/projects"); setDrawerOpen(false); }} />
              <DrawerItem icon="ti-users" label="Access & roles" onClick={() => { router.push("/admin/access"); setDrawerOpen(false); }} />
            <DrawerItem icon="ti-database" label="Data management" onClick={() => { router.push("/admin/data"); setDrawerOpen(false); }} />
            </DrawerSection>
          )}

          <DrawerSection label="Account">
            <DrawerItem icon="ti-key" label="Change password" onClick={() => { router.push("/change-password"); setDrawerOpen(false); }} />
          </DrawerSection>

          <DrawerSection label="Appearance">
            <div style={{ padding: "0 12px 8px" }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 6px", letterSpacing: "0.03em" }}>Mode</p>
              <div style={{ display: "flex", gap: 4 }}>
                {(["light", "dark", "system"] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)} style={{
                    flex: 1, fontSize: 11, padding: "5px 0", textTransform: "capitalize",
                    background: mode === m ? "var(--bg-accent)" : "var(--surface-2)",
                    color: mode === m ? "var(--text-accent)" : "var(--text-muted)",
                    border: mode === m ? "0.5px solid var(--border-accent)" : "0.5px solid var(--border-strong)",
                  }}>{m}</button>
                ))}
              </div>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "12px 0 6px", letterSpacing: "0.03em" }}>Accent</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>
                {ACCENT_OPTIONS.map((opt) => (
                  <button key={opt.value} onClick={() => setAccent(opt.value)} title={opt.label} style={{
                    width: 26, height: 26, borderRadius: "50%", background: opt.swatch, padding: 0,
                    border: accent === opt.value ? "2px solid var(--text-primary)" : "0.5px solid transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {accent === opt.value && <i className="ti ti-check" aria-hidden="true" style={{ fontSize: 12, color: "#fff" }}></i>}
                  </button>
                ))}
              </div>
            </div>
          </DrawerSection>
        </div>

        {user && (
          <div style={{ padding: "12px 16px", borderTop: "0.5px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" width={32} height={32} style={{ borderRadius: "50%", objectFit: "cover" }} />
              ) : (
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--bg-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 500, color: "var(--text-accent)" }}>
                  {user.email[0].toUpperCase()}
                </div>
              )}
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name || user.email.split("@")[0]}</p>
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</p>
              </div>
            </div>
            <button onClick={signOut} style={{ width: "100%", fontSize: 13, color: "var(--text-danger)", background: "transparent", border: "0.5px solid var(--border-danger)", padding: "7px 0" }}>
              Sign out
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </>
  );
}

function DrawerSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <p style={{ fontSize: 10, fontWeight: 500, color: "var(--text-muted)", letterSpacing: "0.05em", padding: "8px 16px 4px", textTransform: "uppercase", margin: 0 }}>{label}</p>
      {children}
    </div>
  );
}

function DrawerItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 16px",
      background: "transparent", border: "none", color: "var(--text-primary)", fontSize: 13,
      textAlign: "left", cursor: "pointer",
    }}>
      <i className={`ti ${icon}`} aria-hidden="true" style={{ fontSize: 16, color: "var(--text-muted)", flexShrink: 0 }}></i>
      {label}
    </button>
  );
}
