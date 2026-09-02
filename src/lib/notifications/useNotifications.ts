// Notifications data layer - list + unread count + mutations + realtime.
// Multi-tenant: RLS in DB filters by auth.uid() AND current_tenant_id(),
// so a compromised client cannot see other tenants' rows even by guessing IDs.
import { useEffect } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { subscribeToTable } from "@/lib/realtime/tableChannelHub";
import type { Database } from "@/integrations/supabase/types";
import { invalidationKeysForNotificationKind } from "./kindInvalidation";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCE_SELECT,
  type NotificationKind,
  type NotificationPreferences,
} from "./preferences";

export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

// Model preferencji (typy + wartości domyślne + lista kolumn) mieszka w
// czystym module `./preferences`; re-eksport trzyma jedno miejsce importu dla
// konsumentów warstwy danych.
export { ALLOW_MESSAGES_FROM_LEVELS, DEFAULT_NOTIFICATION_PREFERENCES } from "./preferences";
export type {
  AllowConnectionsFrom,
  AllowMessagesFrom,
  NotificationKind,
  NotificationPreferences,
} from "./preferences";

const prefsKey = (uid: string | undefined) =>
  ["notifications", "preferences", uid ?? "anon"] as const;

const countKey = (uid: string | undefined) =>
  ["notifications", "unread-count", uid ?? "anon"] as const;

/** Rozmiar strony dla paginacji powiadomień - dzwonek pokazuje pierwszy
 *  fragment, centrum dokleja kolejne przez `fetchNextPage()`. Wspólny rozmiar
 *  ma znaczenie: dzwonek i centrum korzystają z tego samego cache'u
 *  React Query, gdy `filter` jest identyczny (patrz `normalizeFilter`), więc
 *  po zalogowaniu leci jeden request zamiast dwóch (bell + center).
 */
export const NOTIFICATIONS_PAGE_SIZE = 25;

export interface NotificationsFilter {
  onlyUnread?: boolean;
  kind?: NotificationKind | null;
  /** Rodzaje WYKLUCZONE z listy - dzwonek odcina `message`, bo powiadomienia
   *  o wiadomościach czatu mieszkają w ikonie czatu, nie w dzwonku. */
  excludeKinds?: readonly NotificationKind[];
  /** Nadpisanie rozmiaru strony wyłącznie w testach. Produkcyjnie używaj
   *  domyślnego `NOTIFICATIONS_PAGE_SIZE`, żeby zachować dedup cache. */
  pageSize?: number;
}

/** Lista rodzajów -> deterministyczny fragment `in.(...)` dla PostgREST. */
export function kindListLiteral(kinds: readonly NotificationKind[]): string {
  return `(${[...kinds].sort().join(",")})`;
}

/** Zamień filtr na deterministyczny klucz cache'u - `undefined` traktujemy
 *  tak samo jak wartości domyślne, żeby `{}` i `{ onlyUnread: false }` trafiły
 *  do jednej kolejki. */
function normalizeFilter(filter: NotificationsFilter) {
  return {
    onlyUnread: !!filter.onlyUnread,
    kind: filter.kind ?? null,
    excludeKinds: filter.excludeKinds?.length
      ? ([...filter.excludeKinds].sort() as readonly NotificationKind[])
      : null,
    pageSize: filter.pageSize ?? NOTIFICATIONS_PAGE_SIZE,
  } as const;
}


const listKey = (uid: string | undefined, filter: NotificationsFilter) =>
  ["notifications", uid ?? "anon", normalizeFilter(filter)] as const;

/** Paginowany fetch przez PostgREST `.range()` - jeden slot cache na
 *  (użytkownik, filtr, pageSize). Bell/Center konsumują ten sam query. */
export function useNotificationsInfinite(
  filter: NotificationsFilter = {},
): UseInfiniteQueryResult<InfiniteData<NotificationRow[], number>, Error> {
  const { user, loading: authLoading } = useAuth();
  const norm = normalizeFilter(filter);
  return useInfiniteQuery({
    queryKey: listKey(user?.id, filter),
    // Nie odpalaj zapytania zanim AuthProvider zamknie start-up handshake -
    // inaczej wystrzeli anonimowe fetch, które i tak od razu podmienimy po
    // odzyskaniu sesji z lokalnego cache'u (dublowanie requestów po logu).
    enabled: !!user && !authLoading,
    initialPageParam: 0,
    getNextPageParam: (lastPage: NotificationRow[], allPages: NotificationRow[][]) => {
      if (lastPage.length < norm.pageSize) return undefined;
      return allPages.length; // kolejny indeks strony (0, 1, 2, ...)
    },
    queryFn: async ({ pageParam }: { pageParam: number }): Promise<NotificationRow[]> => {
      const from = pageParam * norm.pageSize;
      const to = from + norm.pageSize - 1;
      let q = supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, to);
      if (norm.onlyUnread) q = q.is("read_at", null);
      if (norm.kind) q = q.eq("kind", norm.kind);
      if (norm.excludeKinds) q = q.not("kind", "in", kindListLiteral(norm.excludeKinds));

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 15_000,
  });
}

/** Odczyt jednorazowy pierwszej strony - kompatybilny z konsumentami, które
 *  nie potrzebują paginacji (podgląd w dropdownach itp.). Współdzieli cache
 *  z `useNotificationsInfinite`, więc nie wywołuje dodatkowego requestu. */
export function useNotifications(
  filter: NotificationsFilter = {},
): UseQueryResult<NotificationRow[]> {
  const infinite = useNotificationsInfinite(filter);
  // Rzutowanie w jedną strukturę `UseQueryResult`-owatą - to ten sam obiekt
  // React Query z pochodnym `data` (spłaszczone strony).
  const flat = infinite.data?.pages.flat() ?? undefined;
  return {
    ...infinite,
    data: flat,
  } as unknown as UseQueryResult<NotificationRow[]>;
}

export function useUnreadCount(): UseQueryResult<number> {
  const { user } = useAuth();
  return useQuery({
    queryKey: countKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<number> => {
      // Zmaterializowany licznik (user_pending_counters, utrzymywany
      // triggerami) zamiast COUNT(*) po notifications przy każdym odświeżeniu
      // badge'a. Fallback do COUNT, gdy wiersz licznika jeszcze nie istnieje
      // (konto sprzed seedu liczników).
      const { data: counter, error: counterError } = await supabase
        .from("user_pending_counters")
        .select("value")
        .eq("counter_key", "notifications_unread")
        .maybeSingle();
      if (!counterError && counter) return counter.value;
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 15_000,
  });
}

/**
 * Licznik nieprzeczytanych Z POMINIĘCIEM wybranych rodzajów.
 *
 * Zmaterializowany licznik (`user_pending_counters`) liczy WSZYSTKO, więc nie
 * da się z niego odjąć czatu - dzwonek, który nie pokazuje `message`, musi
 * policzyć swoje wiersze sam (`head: true`, więc bez transferu danych).
 */
export function useUnreadCountExcluding(
  excludeKinds: readonly NotificationKind[],
): UseQueryResult<number> {
  const { user } = useAuth();
  const literal = kindListLiteral(excludeKinds);
  return useQuery({
    queryKey: ["notifications", "unread-count", user?.id ?? "anon", "exclude", literal] as const,
    enabled: !!user,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null)
        .not("kind", "in", literal);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 15_000,
  });
}



export function useMarkNotificationRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: countKey(user?.id) });
    },
  });
}

/**
 * Batch-mark a list of notification ids as read. Ignores ids that already
 * had read_at. Used by group-level "mark whole conversation" quick actions.
 */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return 0;
      const { data, error } = await supabase.rpc("mark_notifications_read", { p_ids: ids });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: countKey(user?.id) });
    },
  });
}

/** Batch-mark a list of notification ids as unread. */
export function useMarkNotificationsUnread() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return 0;
      const { data, error } = await supabase.rpc("mark_notifications_unread", { p_ids: ids });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: countKey(user?.id) });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async () => {
      if (!user) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: countKey(user?.id) });
    },
  });
}

export function useDeleteNotification() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: countKey(user?.id) });
    },
  });
}

// Realtime subscription - scoped per user_id via a filter to avoid a fan-out
// firehose across tenants. RLS still enforces isolation; the filter is a
// bandwidth optimization. Kanał współdzielony przez tableChannelHub: dzwonek,
// centrum notyfikacji i /messages używają JEDNEJ subskrypcji websocketowej.
//
// Powiadomienie jest tu TAKŻE zdarzeniem domenowym dla innych modułów: tabele
// sieci kontaktów (wprowadzenia, rekomendacje, poparcia, wyświetlenia profilu,
// rezerwacje spotkań) mają RLS zamykający bezpośredni odczyt i zapisy wyłącznie
// przez RPC, więc nie da się ich subskrybować osobno. Reguła „co odświeżyć"
// mieszka w czystym `./kindInvalidation` (testowalna), a nie w tym efekcie.
export function useNotificationsRealtime(): void {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    return subscribeToTable({ table: "notifications", filter: `user_id=eq.${uid}` }, (payload) => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: countKey(uid) });
      // Rodzaj czytamy z wiersza (INSERT/UPDATE); przy DELETE `new` jest puste -
      // usunięcie powiadomienia nie zmienia danych modułu, więc nie ma czego
      // odświeżać.
      const kind = (payload.new as { kind?: unknown } | null)?.kind;
      if (typeof kind !== "string") return;
      for (const key of invalidationKeysForNotificationKind(kind)) {
        void qc.invalidateQueries({ queryKey: key });
      }
    });
  }, [uid, qc]);
}

/** Toggle a single notification back to unread (RPC checks auth.uid()). */
export function useMarkNotificationUnread() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mark_notification_unread", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: countKey(user?.id) });
    },
  });
}

/** Per-user notification preferences (upserted on first save). */
export function useNotificationPreferences(): UseQueryResult<NotificationPreferences> {
  const { user } = useAuth();
  return useQuery({
    queryKey: prefsKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<NotificationPreferences> => {
      // Lista kolumn wyprowadzona z DEFAULT_NOTIFICATION_PREFERENCES - ręczna
      // gubiła nowe flagi (enabled_saved_search, enabled_crm_task), przez co
      // zapisane "wyłączone" wracało do UI jako "włączone".
      const { data, error } = await supabase
        .from("notification_preferences")
        .select(NOTIFICATION_PREFERENCE_SELECT)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...((data ?? {}) as Partial<NotificationPreferences>),
      };
    },
    staleTime: 60_000,
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (patch: Partial<NotificationPreferences>) => {
      if (!user) throw new Error("Not authenticated");
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!profile?.tenant_id) throw new Error("Profile tenant not found");
      // email_digest_frequency jest nowsze niż wygenerowane typy -> cast.
      const { error } = await supabase.from("notification_preferences").upsert(
        {
          user_id: user.id,
          tenant_id: profile.tenant_id,
          ...patch,
        } as never,
        { onConflict: "user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: prefsKey(user?.id) });
    },
  });
}

/**
 * Subscribe to realtime changes on this user's notification_preferences row.
 * Ensures widgets (bell, center, chat) reflect toggles made in another tab or
 * from another device within the same session, without a manual refresh.
 */
export function useNotificationPreferencesRealtime(): void {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    return subscribeToTable(
      { table: "notification_preferences", filter: `user_id=eq.${uid}` },
      () => {
        void qc.invalidateQueries({ queryKey: prefsKey(uid) });
      },
    );
  }, [uid, qc]);
}
