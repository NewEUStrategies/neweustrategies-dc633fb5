// Status subskrypcji newslettera dla ZALOGOWANEGO użytkownika.
//
// PO CO. Formularz "Zapisz się do newslettera" pokazywał to samo wszystkim -
// także osobom, które są już na liście. Efekt: użytkownik wypełnia adres po raz
// drugi, dostaje "już zapisany" i nie wie, na którą listę i z jakimi tematami
// jest zapisany. Ta funkcja daje frontowi jednoznaczną odpowiedź: czy jestem
// zapisany, na jaką listę i jakie mam tematy - żeby po lewej pokazać stan, a po
// prawej wyłącznie wybór kolejnych tematów / list.
//
// BEZPIECZEŃSTWO. Wyłącznie własny rekord: czytamy po e-mailu z tokenu sesji
// (nigdy z payloadu), w obrębie tenanta rozwiązanego z hosta żądania. Odczyt
// idzie `service_role`, bo `newsletter_subscribers` nie jest wystawione do
// Data API dla `authenticated` - ale zapytanie jest zawężone do adresu
// właściciela sesji, więc nie da się nim przeczytać cudzej subskrypcji.
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

function splitList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

async function loadContext(email: string) {
  const [{ supabaseAdmin }, { resolveTenantIdForHost }, { currentTenantHost }] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    import("@/lib/server/tenant.server"),
    import("@/lib/http/requestHost"),
  ]);
  const tenantId = await resolveTenantIdForHost(await currentTenantHost());
  if (!tenantId) return null;
  const { data } = await supabaseAdmin
    .from("newsletter_subscribers")
    .select("id, status, email, source_form_name, meta, created_at, confirmed_at")
    .eq("tenant_id", tenantId)
    .eq("email", email)
    .maybeSingle();
  return { supabaseAdmin, tenantId, row: data };
}

export const getMyNewsletterStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyNewsletterStatus> => {
    const email = (context.claims?.email ?? "").toString().trim().toLowerCase();
    const empty: MyNewsletterStatus = {
      subscribed: false,
      status: null,
      email: email || null,
      listName: null,
      mailingLists: [],
      topics: [],
      since: null,
    };
    if (!email) return empty;

    const ctx = await loadContext(email);
    if (ctx === null || !ctx.row) return empty;
    const meta = (ctx.row.meta ?? {}) as Record<string, unknown>;

    return {
      subscribed: ctx.row.status === "subscribed" || ctx.row.status === "pending",
      status: ctx.row.status ?? null,
      email: ctx.row.email,
      listName: ctx.row.source_form_name ?? null,
      mailingLists: splitList(meta.mailing_lists),
      topics: splitList(meta.interests),
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
  .inputValidator((data: unknown) => TopicsInput.parse(data))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const email = (context.claims?.email ?? "").toString().trim().toLowerCase();
    if (!email) return { ok: false, error: "no_email" };

    const ctx = await loadContext(email);
    if (ctx === null) return { ok: false, error: "not_configured" };
    if (!ctx.row) return { ok: false, error: "not_subscribed" };

    const meta: Record<string, string> = {};
    for (const [key, value] of Object.entries((ctx.row.meta ?? {}) as Record<string, unknown>)) {
      if (typeof value === "string") meta[key] = value;
    }
    const mergedTopics = Array.from(new Set([...splitList(meta.interests), ...data.topics]));
    const mergedLists = Array.from(
      new Set([...splitList(meta.mailing_lists), ...data.mailingLists]),
    );
    meta.interests = mergedTopics.join(", ").slice(0, 1000);
    if (mergedLists.length > 0) meta.mailing_lists = mergedLists.join(",").slice(0, 500);

    const { error } = await ctx.supabaseAdmin
      .from("newsletter_subscribers")
      .update({ meta, updated_at: new Date().toISOString() })
      .eq("id", ctx.row.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  });
