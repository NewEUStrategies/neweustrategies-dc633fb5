// Server functions dla zgód powiadomień/RODO zalogowanego użytkownika.
//
// Trzymamy tu WYŁĄCZNIE deklaracje `createServerFn` + importy. Helpery
// (schematy Zod, readIp/readUserAgent) są w `consents.server.ts`, żeby
// tss-serverfn-split nie musiał wciągać siblingów do chunków handlerów.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  SetConsentSchema,
  SetConsentsBulkSchema,
  ListEventsSchema,
  readIp,
  readUserAgent,
  resolveGpcForWrite,
} from "@/lib/consents.server";

export const listMyConsents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_consents")
      .select("consent_key, given, version, lang, gpc, given_at, withdrawn_at, updated_at")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const setMyConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SetConsentSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const req = (() => {
      try {
        return getRequest();
      } catch {
        return null;
      }
    })();
    const ip = readIp(req);
    const ua = readUserAgent(req);

    const { data: row, error } = await supabase.rpc("set_user_consent", {
      p_key: data.key,
      p_given: data.given,
      p_version: data.version,
      p_gpc: resolveGpcForWrite(req, data.gpc),
      p_lang: data.lang,
      p_ip: ip ?? undefined,
      p_user_agent: ua ?? undefined,
      p_source: data.source ?? "account",
      p_banner_version: data.bannerVersion ?? undefined,
      p_decision_id: data.decisionId ?? undefined,
      p_page_url: data.pageUrl ?? undefined,
    });
    if (error) throw new Error(error.message);
    return row ?? null;
  });

// Wariant batchowy dla mostu CMP->rejestr (registryBridge): jedna decyzja
// z banera/strony prywatności potrafi zmienić kilka kategorii cookie naraz,
// a każda z nich musi wylądować w audit-logu jako osobny wpis z tym samym
// IP/UA/źródłem.
//
// CAŁA DECYZJA IDZIE JEDNYM RPC. Wcześniej była tu pętla po osobnych
// wywołaniach `set_user_consent` - a każde z nich to WŁASNA transakcja, więc
// `throw` na którymkolwiek zostawiał wpisy wcześniejsze zatwierdzone. Atomowy
// był pojedynczy upsert plus jego zdarzenie, a nie decyzja użytkownika:
// „odrzuć wszystko" przerwane w połowie zostawiało część kategorii WŁĄCZONYCH,
// trwale i bez komunikatu (`backfillRegistryOnLogin` tego nie naprawia -
// uzupełnia wyłącznie klucze NIEOBECNE w rejestrze, a te są obecne ze starą
// wartością). `set_user_consents` (20260913170000) wykonuje całą pętlę
// w jednej transakcji: wszystko albo nic.
export const setMyConsentsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SetConsentsBulkSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const req = (() => {
      try {
        return getRequest();
      } catch {
        return null;
      }
    })();
    const ip = readIp(req);
    const ua = readUserAgent(req);

    // Sygnał rozstrzygany RAZ na całą partię: jedno żądanie = jeden stan
    // przeglądarki, więc wszystkie wpisy tej decyzji muszą nieść identyczny
    // znacznik GPC (inaczej audyt sugerowałby, że sygnał migał w trakcie).
    const gpc = resolveGpcForWrite(
      req,
      data.entries.some((e) => e.gpc === true),
    );

    // Kształt elementu odwzorowuje NAZWANE parametry `set_user_consent`
    // (snake_case), bo to ich funkcja SQL używa przy wołaniu w pętli.
    const entries = data.entries.map((entry) => ({
      key: entry.key,
      given: entry.given,
      version: entry.version,
      gpc,
      lang: entry.lang ?? null,
      ip: ip ?? null,
      user_agent: ua ?? null,
      source: entry.source ?? "account",
      banner_version: entry.bannerVersion ?? null,
      decision_id: entry.decisionId ?? null,
      page_url: entry.pageUrl ?? null,
    }));

    const { data: saved, error } = await supabase.rpc("set_user_consents", {
      p_entries: entries,
    });
    if (error) throw new Error(error.message);
    // Zwracamy to, co zapisała BAZA, a nie to, co wysłał klient: przy „wszystko
    // albo nic" te dwie listy mogą się różnić wyłącznie wtedy, gdy coś poszło
    // nie tak, i wtedy chcemy zobaczyć wersję bazy.
    return { saved: saved ?? [] };
  });

export const listMyConsentEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ListEventsSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("user_consent_events")
      .select(
        "id, consent_key, given, version, lang, source, gpc, banner_version, decision_id, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
