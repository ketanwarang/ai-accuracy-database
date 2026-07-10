"use client";

import { createContext, useContext, useEffect, useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

// Routes reachable without a completed password change
const PASSWORD_CHANGE_EXEMPT_ROUTES = [
  "/login",
  "/create-account",
  "/forgot-password",
  "/reset-password",
  "/change-password",
];

export interface UserRole {
  id: string;
  user_email: string;
  role: "super_admin" | "admin" | "user";
  account_id: string | null;
  project_id: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  mustChangePassword: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  roles: UserRole[];
  loading: boolean;
  isSuperAdmin: boolean;
  isAdmin: (accountId?: string) => boolean;
  canAccessAccount: (accountId: string) => boolean;
  canAccessProject: (projectId: string, accountId: string) => boolean;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Cache session in module scope so it persists across tab switches
// without re-fetching on every mount
let cachedUser: AuthUser | null = null;
let cachedRoles: UserRole[] = [];
let sessionChecked = false;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(cachedUser);
  const [roles, setRoles] = useState<UserRole[]>(cachedRoles);
  const [loading, setLoading] = useState(!sessionChecked);
  const initialized = useRef(false);

  async function loadRoles(email: string): Promise<UserRole[]> {
    const { data } = await supabase
      .from("user_roles")
      .select("*")
      .eq("user_email", email);
    return data || [];
  }

  async function refreshRoles() {
    if (user?.email) {
      const r = await loadRoles(user.email);
      setRoles(r);
      cachedRoles = r;
    }
  }

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      // If we already have a cached session, skip the network call
      if (sessionChecked && cachedUser !== null) {
        setLoading(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      sessionChecked = true;

      if (session?.user) {
        const u = session.user;
        const authUser: AuthUser = {
          id: u.id,
          email: u.email!,
          name: u.user_metadata?.full_name || null,
          avatar_url: u.user_metadata?.avatar_url || null,
          mustChangePassword: u.user_metadata?.must_change_password === true,
        };
        const r = await loadRoles(u.email!);
        cachedUser = authUser;
        cachedRoles = r;
        setUser(authUser);
        setRoles(r);
      } else {
        cachedUser = null;
        cachedRoles = [];
        setUser(null);
        setRoles([]);
      }
      setLoading(false);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "SIGNED_OUT") {
          cachedUser = null;
          cachedRoles = [];
          sessionChecked = false;
          setUser(null);
          setRoles([]);
        } else if (session?.user && event !== "TOKEN_REFRESHED") {
          const u = session.user;
          const authUser: AuthUser = {
            id: u.id,
            email: u.email!,
            name: u.user_metadata?.full_name || null,
            avatar_url: u.user_metadata?.avatar_url || null,
            mustChangePassword: u.user_metadata?.must_change_password === true,
          };
          const r = await loadRoles(u.email!);
          cachedUser = authUser;
          cachedRoles = r;
          setUser(authUser);
          setRoles(r);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Hard-block navigation until a temporary password has been changed
  useEffect(() => {
    if (loading || !user?.mustChangePassword) return;
    if (!PASSWORD_CHANGE_EXEMPT_ROUTES.includes(pathname)) {
      router.push("/change-password");
    }
  }, [loading, user, pathname]);

  const isSuperAdmin = roles.some(
    (r) => r.role === "super_admin" && !r.account_id && !r.project_id
  );

  function isAdmin(accountId?: string): boolean {
    if (isSuperAdmin) return true;
    return roles.some(
      (r) =>
        r.role === "admin" &&
        (!accountId || r.account_id === accountId) &&
        !r.project_id
    );
  }

  function canAccessAccount(accountId: string): boolean {
    if (isSuperAdmin) return true;
    return roles.some(
      (r) => r.account_id === accountId || (!r.account_id && !r.project_id)
    );
  }

  function canAccessProject(projectId: string, accountId: string): boolean {
    if (isSuperAdmin) return true;
    return roles.some(
      (r) =>
        (r.account_id === accountId && !r.project_id) ||
        r.project_id === projectId ||
        (!r.account_id && !r.project_id)
    );
  }

  async function signOut() {
    cachedUser = null;
    cachedRoles = [];
    sessionChecked = false;
    await supabase.auth.signOut();
    setUser(null);
    setRoles([]);
    router.push("/login");
  }

  return (
    <AuthContext.Provider
      value={{ user, roles, loading, isSuperAdmin, isAdmin, canAccessAccount, canAccessProject, signOut, refreshRoles }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
