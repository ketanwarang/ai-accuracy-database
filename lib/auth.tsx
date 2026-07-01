"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadRoles(email: string) {
    const { data } = await supabase
      .from("user_roles")
      .select("*")
      .eq("user_email", email);
    setRoles(data || []);
  }

  async function refreshRoles() {
    if (user?.email) await loadRoles(user.email);
  }

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const u = session.user;
        setUser({
          id: u.id,
          email: u.email!,
          name: u.user_metadata?.full_name || null,
          avatar_url: u.user_metadata?.avatar_url || null,
        });
        await loadRoles(u.email!);
      }
      setLoading(false);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const u = session.user;
        setUser({
          id: u.id,
          email: u.email!,
          name: u.user_metadata?.full_name || null,
          avatar_url: u.user_metadata?.avatar_url || null,
        });
        await loadRoles(u.email!);
      } else {
        setUser(null);
        setRoles([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

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
    await supabase.auth.signOut();
    setUser(null);
    setRoles([]);
    router.push("/login");
  }

  return (
    <AuthContext.Provider value={{ user, roles, loading, isSuperAdmin, isAdmin, canAccessAccount, canAccessProject, signOut, refreshRoles }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
