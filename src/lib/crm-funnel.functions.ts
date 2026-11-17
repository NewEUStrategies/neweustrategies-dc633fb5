// CRM Marketing Funnel server functions.
//
// Ta warstwa obsługuje lejek marketingowy (subskrybenci newslettera). Widok
// `crm_funnel_view` łączy tabelę `newsletter_subscribers` z `profiles` oraz
// `crm_leads`, dodając flagi `is_registered` / `is_contact`.
//
// ODCZYT WIDOKU IDZIE SPOD SERVICE-ROLE, NIE KLIENTEM WOŁAJĄCEGO. Widok ma
// `security_invoker=on` i łączy profile warunkiem `lower(p.email) =
// lower(s.email)`. `profiles.email` nie ma grantu SELECT dla `authenticated`
// (poprawka PII 20260724090100), więc do 17.11.2026 KAŻDY odczyt widoku przez
// staff CRM - lista, karta subskrybenta i `crm_funnel_stats` (SQL SECURITY
// INVOKER nad tym widokiem) - kończył się 42501 i ekran lejka był martwy.
//
// Grantu nie otwieramy, a odczyt nie wynosi adresów z profili: widok używa
// `profiles.email` WYŁĄCZNIE w warunku złączenia, a kolumny odpowiedzi
// (`FUNNEL_COLUMNS`) to adres SUBSKRYBENTA i flagi, które ekran już pokazywał.
// Dlaczego service-role, a nie funkcja SECURITY DEFINER (migracja): widok nie
// woła `auth.uid()` ani `current_tenant_id()`, wystawia `tenant_id`, a oba
// złączenia są zakotwiczone w `s.tenant_id` - więc jawny filtr
// `.eq("tenant_id", <tenant z sesji>)` zawęża subskrybentów, profile i leady
// do najemcy wołającego dokładnie tak, jak robiło to RLS, bez przepisywania
// filtrów listy na SQL. Rola wołającego jest sprawdzana jak w polityce
// `newsletter staff read` (admin albo editor w najemcy z profilu), a nie
// szerzej niż `requireCrmStaff` - super admin bez tych ról nie widział
// subskrybentów pod RLS i nie widzi ich tutaj.
//
// Zapisy (`newsletter_subscribers`, `crm_leads`, `audit_log`) zostają przy
// kliencie wołającego - tam RLS jest jedyną bramką i działa.
import { createServerFn } from "@tanstack/react-start";
import { requireCrmStaff } from "@/integrations/supabase/require-staff";
import { funnelMarketingConsent } from "@/lib/crm/funnelConsent";
import { resolveCallerTenantId } from "@/lib/crm/callerTenant";
import { z } from "zod";
import { looseClient, looseTable, rowsOf } from "@/lib/supabase/looseQuery";

const write = (
  ctx: { supabase: unknown },
  name: string,
): {
  insert: (v: unknown) => Promise<{ error: { message: string } | null }>;
  upsert: (
    v: unknown,
    o?: { onConflict?: string },
  ) => Promise<{ error: { message: string } | null }>;
} =>
  (
    ctx.supabase as {
      from: (t: string) => {
        insert: (v: unknown) => Promise<{ error: { message: string } | null }>;
        upsert: (
          v: unknown,
          o?: { onConflict?: string },
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  ).from(name);

const j = (v: unknown): string => JSON.stringify(v ?? null);

const FunnelStatus = z.enum(["subscribed", "pending", "unsubscribed", "bounced", "complained"]);
const AudienceFilter = z.enum(["all", "registered", "unregistered", "contact", "non_contact"]);

/**
 * Kolumny wiersza lejka - DOKŁADNIE to, co renderuje `/admin/crm/funnel`
 * (typ `FunnelRow` trasy). Jawna lista zamiast `*`: odczyt spod service-role
 * nie może wynosić kolumn, które widok dostanie w przyszłości, a `consents`
 * (dowód zgody), `email_norm`, `source_form_*` i `updated_at` nie mają na
 * ekranie odbiorcy. Adres to `email` SUBSKRYBENTA, nie profilu.
 */
const FUNNEL_COLUMNS =
  "id, tenant_id, email, first_name, last_name, display_name, language, source, status, confirmed_at, unsubscribed_at, created_at, user_id, profile_id, avatar_url, is_registered, contact_id, is_contact, contact_stage, contact_score";

/** Role, które polityka `newsletter staff read` wpuszcza do subskrybentów. */
const FUNNEL_READER_ROLES = ["admin", "editor"] as const;

/**
 * Najemca wołającego, któremu wolno czytać lejek - albo wyjątek.
 *
 * Najemca z profilu wołającego pod RLS (`resolveCallerTenantId`), nigdy
 * z ładunku. Rola: admin albo editor W TYM najemcy, czytana klientem
 * wołającego z `user_roles` (własne role - ten sam odczyt co `requireCrmStaff`).
 * To odtwarza warunek polityki `newsletter staff read`, który pod
 * service-role nie działa; brak roli = odmowa, nie pusta lista.
 */
async function funnelReaderTenant(context: {
  readonly supabase: unknown;
  readonly userId: string;
}): Promise<string> {
  const tenantId = await resolveCallerTenantId(context);
  const roles = await looseTable(context, "user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("tenant_id", tenantId)
    .in("role", [...FUNNEL_READER_ROLES])
    .limit(1);
  if (roles.error) throw new Error(roles.error.message);
  if (rowsOf(roles).length === 0) throw new Error("Forbidden: newsletter staff required");
  return tenantId;
}

const ListInput = z.object({
  search: z.string().trim().max(200).optional(),
  status: FunnelStatus.optional(),
  audience: AudienceFilter.default("all"),
  source: z.string().trim().max(120).optional(),
  language: z.enum(["pl", "en"]).optional(),
  created_from: z.string().datetime().optional(),
  created_to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).default(200),
});

export const listFunnelSubscribers = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const tenantId = await funnelReaderTenant(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // `tenant_id` z sesji to JEDYNA granica najemcy tego zapytania - RLS pod
    // service-role nie działa. Stoi przed każdym filtrem z ładunku.
    let q = looseClient({ supabase: supabaseAdmin })
      .from("crm_funnel_view")
      .select(FUNNEL_COLUMNS)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.search && data.search.length > 0) {
      // Strip LIKE wildcards and PostgREST .or() metacharacters so the search
      // phrase cannot inject extra filter conditions.
      const term = data.search.replace(/[%_,()"\\]/g, "");
      q = q.or(
        `email.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,display_name.ilike.%${term}%`,
      );
    }
    if (data.status) q = q.eq("status", data.status);
    if (data.source) q = q.eq("source", data.source);
    if (data.language) q = q.eq("language", data.language);
    if (data.created_from) q = q.gte("created_at", data.created_from);
    if (data.created_to) q = q.lte("created_at", data.created_to);

    switch (data.audience) {
      case "registered":
        q = q.eq("is_registered", true);
        break;
      case "unregistered":
        q = q.eq("is_registered", false);
        break;
      case "contact":
        q = q.eq("is_contact", true);
        break;
      case "non_contact":
        q = q.eq("is_contact", false);
        break;
      default:
        break;
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { json: j(rows ?? []) };
  });

export const getFunnelSubscriber = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const tenantId = await funnelReaderTenant(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Subskrybent innego najemcy niż wołający: `not_found`, jak pod RLS.
    const { data: row, error } = await looseClient({ supabase: supabaseAdmin })
      .from("crm_funnel_view")
      .select(FUNNEL_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("not_found");
    return { json: j(row) };
  });

export type FunnelStats = {
  total: number;
  subscribed: number;
  pending: number;
  unsubscribed: number;
  registered: number;
  contacts: number;
};

// Liczniki liczy baza - sześć zapytań liczących (`count: "exact", head: true`)
// nad TYM SAMYM widokiem, wierszem po wierszu tak jak `crm_funnel_stats`
// (COUNT(*) FILTER nad `crm_funnel_view`), bez ściągania wierszy.
//
// DLACZEGO NIE `crm_funnel_stats`. Funkcja jest SECURITY INVOKER nad widokiem,
// więc pod klientem staff dziedziczyła 42501 z `profiles.email` (patrz nagłówek
// pliku), a pod service-role policzyłaby WSZYSTKICH najemców - nie ma
// parametru najemcy ani filtra w ciele. Migracja 20261117014500 odbiera jej
// EXECUTE wszystkim rolom aplikacji (pgTAP `crm_funnel_stats_revoked_test`).
// Zapytania niżej niosą `.eq("tenant_id", <tenant z sesji>)` każde z osobna;
// granicę najemcy złączeń widoku przypina
// `lib/crm/__tests__/funnelViewTenantAnchors.gate.test.ts`.
export const funnelStats = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .handler(async ({ context }): Promise<FunnelStats> => {
    const tenantId = await funnelReaderTenant(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tenantCount = () =>
      looseClient({ supabase: supabaseAdmin })
        .from("crm_funnel_view")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
    const [total, subscribed, pending, unsubscribed, registered, contacts] = await Promise.all([
      tenantCount(),
      tenantCount().eq("status", "subscribed"),
      tenantCount().eq("status", "pending"),
      tenantCount().eq("status", "unsubscribed"),
      tenantCount().eq("is_registered", true),
      tenantCount().eq("is_contact", true),
    ]);
    // Licznik z odmowy to nie zero - jedna odmowa wywraca całe podsumowanie.
    for (const r of [total, subscribed, pending, unsubscribed, registered, contacts]) {
      if (r.error) throw new Error(r.error.message);
    }
    return {
      total: total.count ?? 0,
      subscribed: subscribed.count ?? 0,
      pending: pending.count ?? 0,
      unsubscribed: unsubscribed.count ?? 0,
      registered: registered.count ?? 0,
      contacts: contacts.count ?? 0,
    };
  });

const BulkInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

export const bulkUnsubscribeFunnel = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => BulkInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await looseTable(context, "newsletter_subscribers")
      .update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString() })
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return { ok: true, count: data.ids.length };
  });

const ConvertInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Konwersja zaznaczonych subskrybentów do Kontaktów CRM. Idempotentne dzięki
 * unique (tenant_id, email_norm) - nie duplikuje istniejących kontaktów.
 * Zgoda marketingowa i status newslettera są PRZEPISYWANE ze stanu
 * subskrybenta (patrz lib/crm/funnelConsent.ts), nigdy ustawiane w ciemno.
 */
export const convertFunnelToContacts = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => ConvertInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: subs, error } = await looseTable(context, "newsletter_subscribers")
      .select("id,tenant_id,email,first_name,last_name,language,status,confirmed_at,consents")
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    type Sub = {
      id: string;
      tenant_id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      language: string | null;
      status: string | null;
      confirmed_at: string | null;
      consents: unknown;
    };
    const list = (subs as Sub[] | null) ?? [];
    if (list.length === 0) return { ok: true, count: 0 };

    const now = new Date().toISOString();
    const base = (s: Sub) => ({
      tenant_id: s.tenant_id,
      email: s.email,
      email_norm: s.email.toLowerCase(),
      first_name: s.first_name,
      last_name: s.last_name,
      source_type: "newsletter" as const,
      newsletter_status: s.status,
      last_activity_at: now,
    });

    // Dwa upserty, bo PostgREST nadpisuje na konflikcie WSZYSTKIE kolumny z
    // payloadu: dla subskrybenta bez dowodu zgody `marketing_consent` musi
    // zostać poza payloadem, inaczej konwersja zdjęłaby zgodę udowodnioną z
    // innego źródła (np. formularza kontaktowego).
    const consented = list.filter((s) => funnelMarketingConsent(s));
    const unproven = list.filter((s) => !funnelMarketingConsent(s));

    if (consented.length > 0) {
      const { error: upErr } = await write(context, "crm_leads").upsert(
        consented.map((s) => ({ ...base(s), marketing_consent: true })),
        { onConflict: "tenant_id,email_norm" },
      );
      if (upErr) throw new Error(upErr.message);
    }
    if (unproven.length > 0) {
      const { error: upErr } = await write(context, "crm_leads").upsert(unproven.map(base), {
        onConflict: "tenant_id,email_norm",
      });
      if (upErr) throw new Error(upErr.message);
    }

    try {
      await write(context, "audit_log").insert({
        actor_id: (context as { userId: string }).userId,
        action: "crm.funnel.convert",
        entity_type: "crm_lead",
        entity_id: null,
        metadata: {
          count: list.length,
          with_marketing_consent: consented.length,
          without_marketing_consent: unproven.length,
          subscriber_ids: list.map((s) => s.id),
        },
      });
    } catch {
      /* audyt best-effort */
    }
    return { ok: true, count: list.length };
  });

const TagInput = z.object({
  id: z.string().uuid(),
  status: FunnelStatus,
});

export const updateFunnelStatus = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => TagInput.parse(d))
  .handler(async ({ data, context }) => {
    // `confirmed_at` to stempel POTWIERDZENIA ZAPISU przez subskrybenta
    // (double opt-in albo zapis bez DOI) - ręczna zmiana statusu przez staff go
    // nie wytwarza, bo byłby to fałszywy dowód zgody.
    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "unsubscribed") patch.unsubscribed_at = new Date().toISOString();
    const { error } = await looseTable(context, "newsletter_subscribers")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    try {
      await write(context, "audit_log").insert({
        actor_id: (context as { userId: string }).userId,
        action: "crm.funnel.status_change",
        entity_type: "newsletter_subscriber",
        entity_id: data.id,
        metadata: { status: data.status },
      });
    } catch {
      /* audyt best-effort */
    }
    return { ok: true };
  });
