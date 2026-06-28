import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Role = "super_admin" | "admin" | "editor" | "author" | "user";

interface AuthCtx {
  session: Session | null;
  user: User | null;
  roles: Role[];
  tenantId: string | null;
  loading: boolean;
  isStaff: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  session: null,
  user: null,
  roles: [],
  tenantId: null,
  loading: true,
  isStaff: false,
  isAdmin: false,
  isSuperAdmin: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Track the last-seen user id so we only re-gate content when identity
  // actually changes (login / logout / account switch), not on token refresh.
  const lastUidRef = useRef<string | null>(null);

  const loadContext = async (uid: string) => {
    const [{ data: rolesData }, { data: profile }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.from("profiles").select("tenant_id").eq("id", uid).maybeSingle(),
    ]);
    setRoles((rolesData ?? []).map((r) => r.role as Role));
    setTenantId(profile?.tenant_id ?? null);
  };

  // When identity changes, drop any cached gated content so it is re-fetched
  // (and re-authorized) under the new session - prevents a previously unlocked
  // body lingering after logout, or stale gating after login.
  const reauthorizeContent = (uid: string | null) => {
    if (lastUidRef.current === uid) return;
    lastUidRef.current = uid;
    void queryClient.invalidateQueries({ queryKey: ["public", "resolved"] });
    void queryClient.invalidateQueries({ queryKey: ["unlocked-body"] });
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      const uid = s?.user?.id ?? null;
      if (event === "INITIAL_SESSION") {
        // Baseline only: anon SSR data is already correct, and entitled users
        // reveal gated bodies via useUnlockedContent without a full refetch.
        lastUidRef.current = uid;
      } else {
        // SIGNED_IN / SIGNED_OUT / USER_UPDATED -> re-gate cached content.
        reauthorizeContent(uid);
      }
      if (s?.user) {
        setTimeout(() => {
          void loadContext(s.user.id);
        }, 0);
      } else {
        setRoles([]);
        setTenantId(null);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) void loadContext(data.session.user.id);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setRoles([]);
    setTenantId(null);
  };

  const isSuperAdmin = roles.includes("super_admin");
  const isAdmin = isSuperAdmin || roles.includes("admin");
  const isStaff = isAdmin || roles.includes("editor") || roles.includes("author");

  return (
    <Ctx.Provider value={{ session, user: session?.user ?? null, roles, tenantId, loading, isStaff, isAdmin, isSuperAdmin, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);

export function useRequiredTenant(): string {
  const { tenantId } = useAuth();
  if (!tenantId) {
    throw new Error("Brak kontekstu tenanta - operacja wymaga zalogowanego użytkownika.");
  }
  return tenantId;
}
