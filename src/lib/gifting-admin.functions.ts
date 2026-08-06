// Gift Articles - admin/redakcja: ustawienia per tenant + audyt zdarzen.
// Caly modul jest domena admin/editor: polityka RLS "gift settings staff write"
// oraz kazde SECURITY DEFINER RPC (list_gift_links_admin, list_gift_events_admin,
// get_gift_stats_admin, revoke_gift_link_admin) re-waliduja te role i tenant
// W SRODKU bazy. Middleware requireAdminEditor (auth + rola + aal2 gdy MFA
// zapisane) jest pierwsza, tania linia - dzieki niej autor bez uprawnien dostaje
// czytelne "Forbidden" zamiast krypticznego bledu RLS z glebi handlera.
//
// Zakresy pol liczbowych ustawien pochodza z GIFT_ADMIN_BOUNDS (lustro CHECK-ow
// z bazy) - jedno zrodlo prawdy dla formularza, walidacji zod i constraintow SQL.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdminEditor } from "@/integrations/supabase/require-staff";
import {
  DEFAULT_GIFT_ADMIN_SETTINGS,
  GIFT_ADMIN_BOUNDS,
  type GiftAdminLimitField,
  type GiftAdminSettings,
} from "@/lib/gifting/admin-model";
import { normalizeGiftEligibility } from "@/lib/gifting/model";

const limitSchema = (field: GiftAdminLimitField) =>
  z.number().int().min(GIFT_ADMIN_BOUNDS[field].min).max(GIFT_ADMIN_BOUNDS[field].max);

const SettingsSchema = z.object({
  enabled: z.boolean(),
  monthly_limit: limitSchema("monthly_limit"),
  link_ttl_days: limitSchema("link_ttl_days"),
  max_redemptions_per_link: limitSchema("max_redemptions_per_link"),
  // Lustro CHECK-a z migracji 20260806170000.
  eligibility: z.enum(["registered", "subscribers"]),
});

export interface GiftAdminSettingsRow extends GiftAdminSettings {
  updated_at: string | null;
  updated_by: string | null;
  /** false = brak wiersza w tenancie; pokazujemy efektywne domyslne z bazy. */
  persisted: boolean;
}

// -------------------- Settings --------------------

export const getGiftAdminSettings = createServerFn({ method: "GET" })
  .middleware([requireAdminEditor])
  .handler(async ({ context }): Promise<GiftAdminSettingsRow> => {
    const { data, error } = await context.supabase
      .from("gift_article_settings")
      .select(
        "enabled, monthly_limit, link_ttl_days, max_redemptions_per_link, eligibility, updated_at, updated_by",
      )
      .maybeSingle();
    if (error) throw new Error(error.message);
    // Brak wiersza != "wszystko na zero": create/redeem_gift_link egzekwuja
    // wtedy bezpieczne fallbacki (10/30/5 + bramka rejestracji). Panel musi
    // pokazywac wlasnie je.
    if (!data) {
      return {
        ...DEFAULT_GIFT_ADMIN_SETTINGS,
        updated_at: null,
        updated_by: null,
        persisted: false,
      };
    }
    return {
      ...data,
      eligibility: normalizeGiftEligibility(data.eligibility),
      persisted: true,
    };
  });

export const updateGiftAdminSettings = createServerFn({ method: "POST" })
  .middleware([requireAdminEditor])
  .validator((d) => SettingsSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Tenant z profilu wywolujacego (RLS-safe: wlasny wiersz zawsze czytelny).
    const { data: profile, error: pErr } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!profile?.tenant_id) throw new Error("Forbidden: no tenant");

    const { error } = await context.supabase.from("gift_article_settings").upsert(
      {
        tenant_id: profile.tenant_id,
        enabled: data.enabled,
        monthly_limit: data.monthly_limit,
        link_ttl_days: data.link_ttl_days,
        max_redemptions_per_link: data.max_redemptions_per_link,
        eligibility: data.eligibility,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------------------- Stats --------------------

export const getGiftAdminStats = createServerFn({ method: "GET" })
  .middleware([requireAdminEditor])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("get_gift_stats_admin").maybeSingle();
    if (error) throw new Error(error.message);
    return (
      data ?? {
        active_links: 0,
        revoked_links: 0,
        expired_links: 0,
        exhausted_links: 0,
        total_created: 0,
        total_redeemed: 0,
        created_this_month: 0,
        redeemed_this_month: 0,
        unique_gifters: 0,
        unique_recipients: 0,
      }
    );
  });

// -------------------- Links --------------------

/**
 * Wiersz z list_gift_links_admin. Generowane typy RETURNS TABLE klamia o
 * nullowalnosci (wszystko non-null), wiec utrzymujemy uczciwy ksztalt tutaj -
 * route importuje ten typ zamiast rzutowac przez `as unknown as`.
 */
export interface GiftLinkAdminRow {
  id: string;
  post_id: string;
  post_title: string;
  post_slug: string | null;
  created_by: string;
  creator_name: string | null;
  creator_email: string | null;
  code: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  redemption_count: number;
  /** Budzet klikniec zamrozony na linku (0 = bez limitu). */
  max_redemptions: number;
  /** Liczba UNIKALNYCH odbiorcow (rejestr post_gift_redemptions). */
  unique_recipients: number;
  last_redeemed_at: string | null;
  total_count: number;
}

const ListLinksInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  status: z.enum(["all", "active", "revoked", "expired"]).default("all"),
  post_id: z.string().uuid().nullish(),
});

export const listGiftLinksAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminEditor])
  .validator((d) => ListLinksInput.parse(d))
  .handler(async ({ data, context }): Promise<{ rows: GiftLinkAdminRow[]; total: number }> => {
    const { data: rows, error } = await context.supabase.rpc("list_gift_links_admin", {
      _limit: data.limit,
      _offset: data.offset,
      _status: data.status,
      _post_id: data.post_id ?? undefined,
    });
    if (error) throw new Error(error.message);
    const list: GiftLinkAdminRow[] = rows ?? [];
    return { rows: list, total: list.length > 0 ? Number(list[0].total_count) : 0 };
  });

const RevokeInput = z.object({ link_id: z.string().uuid() });

export const revokeGiftLinkAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminEditor])
  .validator((d) => RevokeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: ok, error } = await context.supabase.rpc("revoke_gift_link_admin", {
      _link_id: data.link_id,
    });
    if (error) throw new Error(error.message);
    return { ok: ok === true };
  });

// -------------------- Events (audit log) --------------------

/** Znane typy zdarzen audytu (trigger gift_links_audit_tg). */
export type GiftEventType = "created" | "redeemed" | "revoked" | "expired" | "exhausted";

/**
 * Wiersz z list_gift_events_admin - jak wyzej, uczciwa nullowalnosc.
 * event_type celowo pozostaje otwartym stringiem: audyt ma pokazywac takze
 * zdarzenia, ktorych ten build jeszcze nie zna, zamiast je przeklamywac.
 */
export interface GiftEventAdminRow {
  id: string;
  event_type: string;
  post_id: string | null;
  post_title: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  code: string;
  created_at: string;
  total_count: number;
}

const ListEventsInput = z.object({
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
  event_type: z
    .enum(["all", "created", "redeemed", "revoked", "expired", "exhausted"])
    .default("all"),
  link_id: z.string().uuid().nullish(),
});

export const listGiftEventsAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminEditor])
  .validator((d) => ListEventsInput.parse(d))
  .handler(async ({ data, context }): Promise<{ rows: GiftEventAdminRow[]; total: number }> => {
    const { data: rows, error } = await context.supabase.rpc("list_gift_events_admin", {
      _limit: data.limit,
      _offset: data.offset,
      _event_type: data.event_type,
      _link_id: data.link_id ?? undefined,
    });
    if (error) throw new Error(error.message);
    const list: GiftEventAdminRow[] = rows ?? [];
    return { rows: list, total: list.length > 0 ? Number(list[0].total_count) : 0 };
  });
