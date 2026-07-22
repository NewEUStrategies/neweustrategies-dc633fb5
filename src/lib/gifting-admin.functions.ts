// Gift Articles - admin/redakcja: ustawienia per tenant + audyt zdarzen.
// Wszystkie mutacje i odczyty administracyjne przechodza przez requireStaff
// (auth + rola admin/editor + aal2 gdy MFA zapisane). Odczyty pol
// audytowych i danych o linkach id/twoórcy odbywaja sie przez SECURITY DEFINER
// RPC w bazie (list_gift_links_admin, list_gift_events_admin, get_gift_stats_admin),
// ktore reweryfikuja tenant + role w srodku.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/integrations/supabase/require-staff";

const SettingsSchema = z.object({
  enabled: z.boolean(),
  monthly_limit: z.number().int().min(0).max(1000),
  link_ttl_days: z.number().int().min(0).max(365),
});
export type GiftAdminSettings = z.infer<typeof SettingsSchema>;

// -------------------- Settings --------------------

export const getGiftAdminSettings = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("gift_article_settings")
      .select("enabled, monthly_limit, link_ttl_days, updated_at, updated_by")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (
      data ?? {
        enabled: true,
        monthly_limit: 0,
        link_ttl_days: 0,
        updated_at: null,
        updated_by: null,
      }
    );
  });

export const updateGiftAdminSettings = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => SettingsSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Get tenant_id from caller's profile (RLS-safe: he can read his own row).
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
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .rpc("get_gift_stats_admin")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (
      data ?? {
        active_links: 0,
        revoked_links: 0,
        expired_links: 0,
        total_created: 0,
        total_redeemed: 0,
        created_this_month: 0,
        redeemed_this_month: 0,
        unique_gifters: 0,
      }
    );
  });

// -------------------- Links --------------------

const ListLinksInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  status: z.enum(["all", "active", "revoked", "expired"]).default("all"),
  post_id: z.string().uuid().nullish(),
});

export const listGiftLinksAdmin = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => ListLinksInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("list_gift_links_admin", {
      _limit: data.limit,
      _offset: data.offset,
      _status: data.status,
      _post_id: data.post_id ?? null,
    });
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<{ total_count: number }>;
    const total = list.length > 0 ? Number(list[0].total_count) : 0;
    return { rows: list, total };
  });

const RevokeInput = z.object({ link_id: z.string().uuid() });

export const revokeGiftLinkAdmin = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => RevokeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: ok, error } = await context.supabase.rpc("revoke_gift_link_admin", {
      _link_id: data.link_id,
    });
    if (error) throw new Error(error.message);
    return { ok: ok === true };
  });

// -------------------- Events (audit log) --------------------

const ListEventsInput = z.object({
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
  event_type: z.enum(["all", "created", "redeemed", "revoked", "expired"]).default("all"),
  link_id: z.string().uuid().nullish(),
});

export const listGiftEventsAdmin = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => ListEventsInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("list_gift_events_admin", {
      _limit: data.limit,
      _offset: data.offset,
      _event_type: data.event_type,
      _link_id: data.link_id ?? null,
    });
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<{ total_count: number }>;
    const total = list.length > 0 ? Number(list[0].total_count) : 0;
    return { rows: list, total };
  });
