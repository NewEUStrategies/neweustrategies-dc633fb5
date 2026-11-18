// Status subskrypcji newslettera dla ZALOGOWANEGO użytkownika.
//
// PO CO. Formularz "Zapisz się do newslettera" pokazywał to samo wszystkim -
// także osobom, które są już na liście. Efekt: użytkownik wypełnia adres po raz
// drugi, dostaje "już zapisany" i nie wie, na którą listę i z jakimi tematami
// jest zapisany. Ta funkcja daje frontowi jednoznaczną odpowiedź: czy jestem
// zapisany, na jaką listę i jakie mam tematy - żeby po lewej pokazać stan, a po
// prawej wyłącznie wybór kolejnych tematów / list.
//
// BEZPIECZEŃSTWO. Wyłącznie własny rekord: czytamy po e-mailu z sesji
// (nigdy z payloadu), w obrębie tenanta rozwiązanego z hosta żądania. Odczyt
// idzie `service_role`, bo `newsletter_subscribers` nie jest wystawione do
// Data API dla `authenticated` - dlatego adres musi być POTWIERDZONY.
// Sam `email` z tokenu nie wystarcza: konto założone na cudzy adres bez
// potwierdzenia skrzynki niesie ten adres w tokenie. Adres bierzemy więc
// z serwera uwierzytelniania (`auth.getUser()`), tylko gdy ma
// `email_confirmed_at` i zgadza się z tokenem. Wiersz już przypięty do INNEGO
// konta (`user_id`) też nie jest „mój", nawet przy zgodnym adresie.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface MyNewsletterStatus {
  /** Brak sesji lub brak wiersza - formularz działa klasycznie. */
  subscribed: boolean;
  /** "subscribed" | "pending" | "unsubscribed" | null */
  status: string | null;
  email: string | null;
  /** Nazwa listy/formularza, z którego przyszedł zapis (lewa kolumna). */
  listName: string | null;
  /** Dodatkowe listy wysyłkowe zaznaczone przy zapisie. */
  mailingLists: string[];
  /** Wybrane tematy (etykiety) - prezentacja i preselekcja droplisty. */
  topics: string[];
  since: string | null;
}

const TopicsInput = z.object({
  topics: z.array(z.string().trim().min(1).max(120)).max(60).default([]),
  mailingLists: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
});

import {
  applyPreferences,
  crmCustomFromPreferences,
  readPreferences,
} from "@/lib/newsletter/preferences";

type SessionContext = {
  supabase: {
    auth: {
      getUser: () => Promise<{
        data: {
          user: { id: string; email?: string | null; email_confirmed_at?: string | null } | null;
        };
        error: unknown;
      }>;
    };
  };
  userId: string;
  claims?: { email?: unknown } | null;
};

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Adres z tokenu (do wyświetlenia) - NIE służy do wyboru wiersza. */
function claimedEmail(context: SessionContext): string {
  return normalizeEmail(context.claims?.email);
}

/**
 * Potwierdzony adres właściciela sesji albo `null`. Pyta serwer
 * uwierzytelniania, więc niepotwierdzona skrzynka (lub token z adresem, który
 * już nie należy do konta) nie otwiera cudzej subskrypcji.
 */
async function verifiedSessionEmail(context: SessionContext): Promise<string | null> {
  const claimed = claimedEmail(context);
  if (!claimed) return null;
  try {
    const { data, error } = await context.supabase.auth.getUser();
    const user = data?.user ?? null;
    if (error || user === null || user.id !== context.userId) return null;
    if (!user.email_confirmed_at) return null;
    const confirmed = normalizeEmail(user.email);
    return confirmed !== "" && confirmed === claimed ? confirmed : null;
  } catch {
    return null;
  }
}

async function loadContext(email: string, userId: string) {
  const [{ supabaseAdmin }, { resolveTenantIdForHost }, { currentTenantHost }] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    import("@/lib/server/tenant.server"),
    import("@/lib/http/requestHost"),
  ]);
  const tenantId = await resolveTenantIdForHost(await currentTenantHost());
  if (!tenantId) return null;
  const { data } = await supabaseAdmin
    .from("newsletter_subscribers")
    .select("id, status, email, source_form_name, meta, created_at, confirmed_at, user_id")
    .eq("tenant_id", tenantId)
    .eq("email", email)
    .maybeSingle();
  // Wiersz przypięty do innego konta nie jest „mój" - nawet przy zgodnym adresie.
  const row = data && data.user_id && data.user_id !== userId ? null : data;
  return { supabaseAdmin, tenantId, row };
}

export const getMyNewsletterStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyNewsletterStatus> => {
    const claimed = claimedEmail(context);
    const empty: MyNewsletterStatus = {
      subscribed: false,
      status: null,
      email: claimed || null,
      listName: null,
      mailingLists: [],
      topics: [],
      since: null,
    };
    if (!claimed) return empty;
    const email = await verifiedSessionEmail(context);
    if (email === null) return empty;

    const ctx = await loadContext(email, context.userId);
    if (ctx === null || !ctx.row) return empty;
    const meta = (ctx.row.meta ?? {}) as Record<string, unknown>;

    return {
      subscribed: ctx.row.status === "subscribed" || ctx.row.status === "pending",
      status: ctx.row.status ?? null,
      email: ctx.row.email,
      listName: ctx.row.source_form_name ?? null,
      mailingLists: readPreferences(meta).mailingLists,
      topics: readPreferences(meta).topics,
      since: ctx.row.confirmed_at ?? ctx.row.created_at ?? null,
    };
  });

/**
 * Dopisuje tematy / listy do WŁASNEJ subskrypcji. Osobno od
 * `subscribeToNewsletter`, bo tamta ścieżka jest publiczna i celowo nie rusza
 * potwierdzonego wiersza (ochrona przed nadpisaniem cudzych preferencji przez
 * kogoś, kto zna adres). Tutaj tożsamość potwierdza sesja.
 */
export const updateMyNewsletterTopics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => TopicsInput.parse(data))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    if (!claimedEmail(context)) return { ok: false, error: "no_email" };
    const email = await verifiedSessionEmail(context);
    if (email === null) return { ok: false, error: "email_not_verified" };

    const ctx = await loadContext(email, context.userId);
    if (ctx === null) return { ok: false, error: "not_configured" };
    if (!ctx.row) return { ok: false, error: "not_subscribed" };

    const meta = applyPreferences((ctx.row.meta ?? null) as Record<string, unknown> | null, null, {
      topics: data.topics,
      mailingLists: data.mailingLists,
    });

    const { error } = await ctx.supabaseAdmin
      .from("newsletter_subscribers")
      .update({
        meta,
        // Subskrypcja należy do zalogowanej osoby - wiążemy ją z kontem, żeby
        // preferencje były widoczne w profilu także po zmianie adresu w formularzu.
        ...(ctx.row.user_id ? {} : { user_id: context.userId }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.row.id);
    if (error) return { ok: false, error: error.message };

    // Te same preferencje lądują w CRM (pola custom leada). Awaria CRM nie może
    // wywrócić zapisu preferencji - użytkownik ma je już zapisane u siebie.
    try {
      const prefs = readPreferences(meta);
      const { error: crmError } = await ctx.supabaseAdmin.rpc("crm_upsert_from_form", {
        _tenant: ctx.tenantId,
        _email: email,
        _first_name: "",
        _last_name: "",
        _phone: "",
        _company: "",
        _position: "",
        _linkedin: "",
        _country: "",
        _source: "newsletter-preferences",
        _custom: crmCustomFromPreferences(prefs),
      });
      if (crmError) console.error("[newsletter-status] crm sync failed", crmError);
    } catch (err) {
      console.error("[newsletter-status] crm sync threw", err);
    }
    return { ok: true };
  });
