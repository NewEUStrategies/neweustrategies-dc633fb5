import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hasAnonPersonalization, mergeAnonPersonalization } from "@/lib/personalization/anonMerge";
import { AUTH_DEFAULTS, AUTH_SETTINGS_KEY } from "@/lib/authSettings";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";

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
    // The browser Supabase client throws at FIRST touch when its public config
    // cannot be resolved (see lib/supabasePublicConfig.ts) - and a throw from
    // this effect lands in the root error boundary, replacing a fully-rendered
    // anonymous page with the error screen (production incident 2026-07-16).
    // Auth is progressive enhancement on a public content site: degrade to
    // signed-out, loudly, instead of taking the whole page down.
    let sub: { subscription: { unsubscribe: () => void } } | undefined;
    // Guard przeciw podwójnemu ładowaniu kontekstu przy starcie:
    // `INITIAL_SESSION` z listenera i `getSession().then` obydwa dostarczają
    // tę samą sesję - drugie wywołanie musi być no-opem, żeby nie dublować
    // zapytań o `user_roles` i `profiles` przy każdym mount.
    let contextLoadedForUid: string | null = null;
    const ensureContext = (uid: string | null) => {
      if (uid === contextLoadedForUid) return;
      contextLoadedForUid = uid;
      if (!uid) {
        setRoles([]);
        setTenantId(null);
        return;
      }
      setTimeout(() => {
        void loadContext(uid);
      }, 0);
    };
    try {
      ({ data: sub } = supabase.auth.onAuthStateChange((event, s) => {
        // TOKEN_REFRESHED odpala się cyklicznie (co ~godzinę + focus tab) z
        // tą samą tożsamością - nie potrzebujemy wtedy nic przeładowywać
        // (bearer i tak jest odświeżany na poziomie klienta Supabase).
        if (event === "TOKEN_REFRESHED") {
          setSession(s);
          return;
        }
        setSession(s);
        const uid = s?.user?.id ?? null;
        if (event === "INITIAL_SESSION") {
          lastUidRef.current = uid;
        } else {
          // SIGNED_IN / SIGNED_OUT / USER_UPDATED -> re-gate cached content.
          reauthorizeContent(uid);
        }
        ensureContext(uid);
        if (
          s?.user &&
          (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
          hasAnonPersonalization()
        ) {
          const mergeUid = s.user.id;
          setTimeout(() => {
            void mergeAnonPersonalization(mergeUid, queryClient).catch((err) => {
              console.warn("[auth] anon personalization merge failed", err);
            });
          }, 0);
        }
      }));
      supabase.auth.getSession().then(({ data }) => {
        // Listener już obsłużył INITIAL_SESSION dla tej samej sesji - tu tylko
        // domykamy `loading`, żeby konsument (route guards, header) mógł się
        // odpalić bez dodatkowego round-tripu.
        setSession(data.session);
        ensureContext(data.session?.user?.id ?? null);
        setLoading(false);
      });
    } catch (error) {
      console.error("[auth] Supabase client unavailable - continuing signed-out", error);
      setLoading(false);
    }
    return () => sub?.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    // Resolve the admin-configured post-logout destination BEFORE clearing the
    // cache (the bulk settings map is almost always already cached, so this is
    // a cache read, not a round-trip). Only internal paths are honoured -
    // "//evil.example" style values fall back to the homepage.
    let target = "/";
    try {
      const map = await queryClient.ensureQueryData(siteSettingsQueryOptions);
      const configured = resolveSetting(map, AUTH_SETTINGS_KEY, AUTH_DEFAULTS).logout_redirect_url;
      if (configured.startsWith("/") && !configured.startsWith("//")) target = configured;
    } catch {
      /* settings unavailable - fall back to the homepage */
    }
    await supabase.auth.signOut();
    setSession(null);
    setRoles([]);
    setTenantId(null);
    // Drop every cached query so the next user (e.g. on a shared device) never
    // sees the previous account's data - billing, orders, subscription and
    // bookmarks use static, user-independent query keys.
    queryClient.clear();
    // AuthProvider mounts outside the router, so use a hard navigation - on
    // logout a full reload is even desirable: it guarantees no per-user state
    // survives in memory.
    if (typeof window !== "undefined") window.location.assign(target);
  };

  const isSuperAdmin = roles.includes("super_admin");
  const isAdmin = isSuperAdmin || roles.includes("admin");
  const isStaff = isAdmin || roles.includes("editor") || roles.includes("author");

  return (
    <Ctx.Provider
      value={{
        session,
        user: session?.user ?? null,
        roles,
        tenantId,
        loading,
        isStaff,
        isAdmin,
        isSuperAdmin,
        signOut,
      }}
    >
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
