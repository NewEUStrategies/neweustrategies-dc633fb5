// Server functions dla zgód powiadomień/RODO zalogowanego użytkownika.
//
// Trzymamy tu WYŁĄCZNIE deklaracje `createServerFn` + importy. Helpery
// (schematy Zod, readIp/readUserAgent) są w `consents.server.ts`, żeby
// tss-serverfn-split nie musiał wciągać siblingów do chunków handlerów.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SetConsentSchema, ListEventsSchema, readIp, readUserAgent } from "@/lib/consents.server";

export const listMyConsents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_consents")
      .select("consent_key, given, version, lang, given_at, withdrawn_at, updated_at")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const setMyConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SetConsentSchema.parse(input))
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
      p_lang: data.lang,
      p_ip: ip ?? undefined,
      p_user_agent: ua ?? undefined,
      p_source: data.source ?? "account",
    });
    if (error) throw new Error(error.message);
    return row ?? null;
  });

export const listMyConsentEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListEventsSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("user_consent_events")
      .select("id, consent_key, given, version, lang, source, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
