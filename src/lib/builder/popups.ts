// Builder popups: full builder documents (builder_popups.builder_data) shown
// in a modal on the public site, with display/trigger settings kept as typed
// JSON (builder_popups.settings). Only `active` popups are visible to anon
// visitors (RLS). The pure targeting logic lives here so it is unit-testable;
// the DOM wiring (timers, scroll, exit-intent) lives in PopupHost.
import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTenantId } from "@/lib/tenant";
import type { BuilderDocument, Device } from "./types";
import { emptyDocument, toJson } from "./types";
import { safeParseBuilderDoc } from "./schema";
import { emitWidgetCacheInvalidate } from "./widgetCacheInvalidation";

export type PopupTrigger = "immediate" | "delay" | "scroll" | "exit-intent";
export type PopupWidth = "sm" | "md" | "lg" | "xl";
export type PopupPosition = "center" | "top" | "bottom";
export type PopupAudience = "any" | "guest" | "user";
export type PopupStatus = "draft" | "active" | "archived";

export interface PopupSettings {
  trigger: PopupTrigger;
  /** Seconds before showing (trigger === "delay"). */
  delaySeconds: number;
  /** Scroll depth in percent that opens the popup (trigger === "scroll"). */
  scrollPercent: number;
  /** Days before the popup may re-appear after dismissal. 0 = every visit. */
  frequencyDays: number;
  audience: PopupAudience;
  devices: { desktop: boolean; tablet: boolean; mobile: boolean };
  /**
   * Path targeting. Empty include list = the whole site. A pattern is either
   * an exact pathname ("/pricing") or a prefix ending with "*" ("/post/*").
   * Excludes win over includes. Admin routes are always excluded.
   */
  includePaths: string[];
  excludePaths: string[];
  width: PopupWidth;
  position: PopupPosition;
  overlayColor: string;
  borderRadiusPx: number;
  closeOnOverlay: boolean;
  showCloseButton: boolean;
}

export interface BuilderPopup {
  id: string;
  name: string;
  status: PopupStatus;
  builder_data: BuilderDocument;
  settings: PopupSettings;
  created_at: string;
  updated_at: string;
}

export const defaultPopupSettings = (): PopupSettings => ({
  trigger: "delay",
  delaySeconds: 5,
  scrollPercent: 50,
  frequencyDays: 7,
  audience: "any",
  devices: { desktop: true, tablet: true, mobile: true },
  includePaths: [],
  excludePaths: [],
  width: "md",
  position: "center",
  overlayColor: "rgba(0,0,0,0.7)",
  borderRadiusPx: 12,
  closeOnOverlay: true,
  showCloseButton: true,
});

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const str = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

/** Coerce arbitrary JSON into a fully-populated PopupSettings. */
export function parsePopupSettings(raw: unknown): PopupSettings {
  const d = defaultPopupSettings();
  if (!isObject(raw)) return d;
  const devices = isObject(raw.devices) ? raw.devices : {};
  return {
    trigger: str(raw.trigger, ["immediate", "delay", "scroll", "exit-intent"] as const, d.trigger),
    delaySeconds: Math.max(0, num(raw.delaySeconds, d.delaySeconds)),
    scrollPercent: Math.min(100, Math.max(1, num(raw.scrollPercent, d.scrollPercent))),
    frequencyDays: Math.max(0, num(raw.frequencyDays, d.frequencyDays)),
    audience: str(raw.audience, ["any", "guest", "user"] as const, d.audience),
    devices: {
      desktop: bool(devices.desktop, true),
      tablet: bool(devices.tablet, true),
      mobile: bool(devices.mobile, true),
    },
    includePaths: strArr(raw.includePaths),
    excludePaths: strArr(raw.excludePaths),
    width: str(raw.width, ["sm", "md", "lg", "xl"] as const, d.width),
    position: str(raw.position, ["center", "top", "bottom"] as const, d.position),
    overlayColor:
      typeof raw.overlayColor === "string" && raw.overlayColor ? raw.overlayColor : d.overlayColor,
    borderRadiusPx: Math.max(0, num(raw.borderRadiusPx, d.borderRadiusPx)),
    closeOnOverlay: bool(raw.closeOnOverlay, d.closeOnOverlay),
    showCloseButton: bool(raw.showCloseButton, d.showCloseButton),
  };
}

// ---------- pure targeting ----------

/** Match a pathname against a pattern list (exact, or prefix with "*"). */
export function matchesPathPattern(patterns: ReadonlyArray<string>, path: string): boolean {
  return patterns.some((p) => {
    const pattern = p.trim();
    if (!pattern) return false;
    if (pattern.endsWith("*")) return path.startsWith(pattern.slice(0, -1));
    return path === pattern || path === `${pattern}/`;
  });
}

export interface PopupTargetingContext {
  path: string;
  device: Device;
  isLoggedIn: boolean;
}

/** Should this popup be considered for the current page view at all? */
export function evaluatePopupTargeting(
  settings: PopupSettings,
  ctx: PopupTargetingContext,
): boolean {
  if (ctx.path.startsWith("/admin") || ctx.path.startsWith("/login")) return false;
  if (!settings.devices[ctx.device]) return false;
  if (settings.audience === "guest" && ctx.isLoggedIn) return false;
  if (settings.audience === "user" && !ctx.isLoggedIn) return false;
  if (matchesPathPattern(settings.excludePaths, ctx.path)) return false;
  if (settings.includePaths.length > 0 && !matchesPathPattern(settings.includePaths, ctx.path))
    return false;
  return true;
}

// ---------- frequency capping (localStorage) ----------

const dismissKey = (id: string) => `cms_popup_last:${id}`;

export function isPopupFrequencyOk(id: string, frequencyDays: number, now = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(dismissKey(id));
    if (!raw) return true;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return true;
    if (frequencyDays <= 0) return true;
    return now - ts > frequencyDays * 86_400_000;
  } catch {
    return true;
  }
}

export function markPopupDismissed(id: string): void {
  try {
    window.localStorage.setItem(dismissKey(id), String(Date.now()));
  } catch {
    /* noop */
  }
}

// ---------- data access ----------

interface RawRow {
  id: string;
  name: string;
  status: string;
  builder_data: unknown;
  settings: unknown;
  created_at: string;
  updated_at: string;
}

const toPopup = (r: RawRow): BuilderPopup => ({
  id: r.id,
  name: r.name,
  status: r.status === "active" || r.status === "archived" ? r.status : "draft",
  builder_data: safeParseBuilderDoc(r.builder_data),
  settings: parsePopupSettings(r.settings),
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const POPUP_COLUMNS = "id, name, status, builder_data, settings, created_at, updated_at";

/** Active popups for the public host (anon-readable thanks to RLS). */
export function useActivePopups(enabled: boolean) {
  return useQuery({
    queryKey: ["builder-popups-active"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BuilderPopup[]> => {
      const { data, error } = await supabase
        .from("builder_popups")
        .select(POPUP_COLUMNS)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return [];
      return ((data ?? []) as RawRow[]).map(toPopup);
    },
  });
}

/** Admin CRUD - tenant-scoped list + mutations. */
export function usePopupsAdmin() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ["builder-popups-admin", tenantId ?? ""],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<BuilderPopup[]> => {
      const { data, error } = await supabase
        .from("builder_popups")
        .select(POPUP_COLUMNS)
        .eq("tenant_id", tenantId ?? "")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return ((data ?? []) as RawRow[]).map(toPopup);
    },
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["builder-popups-admin"] });
    void queryClient.invalidateQueries({ queryKey: ["builder-popups-active"] });
    void queryClient.invalidateQueries({ queryKey: ["builder-popup"] });
    emitWidgetCacheInvalidate();
  }, [queryClient]);

  const create = useCallback(
    async (name: string): Promise<string | null> => {
      const { data: u } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("builder_popups")
        .insert({
          name,
          builder_data: toJson(emptyDocument()),
          settings: toJson(defaultPopupSettings()),
          created_by: u.user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) return null;
      invalidate();
      return data.id;
    },
    [invalidate],
  );

  const setStatus = useCallback(
    async (id: string, status: PopupStatus) => {
      await supabase.from("builder_popups").update({ status }).eq("id", id);
      invalidate();
    },
    [invalidate],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      await supabase.from("builder_popups").update({ name }).eq("id", id);
      invalidate();
    },
    [invalidate],
  );

  const remove = useCallback(
    async (id: string) => {
      await supabase.from("builder_popups").delete().eq("id", id);
      invalidate();
    },
    [invalidate],
  );

  const duplicate = useCallback(
    async (popup: BuilderPopup): Promise<string | null> => {
      const { data: u } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("builder_popups")
        .insert({
          name: `${popup.name} (kopia)`,
          builder_data: toJson(popup.builder_data),
          settings: toJson(popup.settings),
          created_by: u.user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) return null;
      invalidate();
      return data.id;
    },
    [invalidate],
  );

  return useMemo(
    () => ({
      items: q.data ?? [],
      loading: q.isLoading,
      create,
      setStatus,
      rename,
      remove,
      duplicate,
    }),
    [q.data, q.isLoading, create, setStatus, rename, remove, duplicate],
  );
}

/** Single popup for the editor route. */
export function usePopupEditor(id: string | null) {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ["builder-popup", tenantId ?? "", id ?? ""],
    enabled: Boolean(tenantId && id),
    queryFn: async (): Promise<BuilderPopup | null> => {
      const { data, error } = await supabase
        .from("builder_popups")
        .select(POPUP_COLUMNS)
        .eq("tenant_id", tenantId ?? "")
        .eq("id", id ?? "")
        .maybeSingle();
      if (error) throw error;
      return data ? toPopup(data as RawRow) : null;
    },
  });

  const save = useCallback(
    async (patch: {
      name?: string;
      status?: PopupStatus;
      builder_data?: BuilderDocument;
      settings?: PopupSettings;
    }): Promise<boolean> => {
      if (!id) return false;
      const update: Record<string, unknown> = {};
      if (patch.name !== undefined) update.name = patch.name;
      if (patch.status !== undefined) update.status = patch.status;
      if (patch.builder_data !== undefined) update.builder_data = toJson(patch.builder_data);
      if (patch.settings !== undefined) update.settings = toJson(patch.settings);
      if (Object.keys(update).length === 0) return true;
      const { error } = await supabase
        .from("builder_popups")
        .update(update as never)
        .eq("id", id);
      if (!error) {
        void queryClient.invalidateQueries({ queryKey: ["builder-popup"] });
        void queryClient.invalidateQueries({ queryKey: ["builder-popups-admin"] });
        void queryClient.invalidateQueries({ queryKey: ["builder-popups-active"] });
        emitWidgetCacheInvalidate();
      }
      return !error;
    },
    [id, queryClient],
  );

  return { popup: q.data ?? null, loading: q.isLoading, save };
}
