// Server functions dla zgód powiadomień/RODO zalogowanego użytkownika.
//
// - list: czyta bieżący stan wszystkich zgód użytkownika (RLS - własne wpisy).
// - set: wywołuje funkcję SQL `set_user_consent`, która atomowo aktualizuje stan
//   i dopisuje niezmienny wpis do `user_consent_events` (audit RODO).
//
// IP i User-Agent czytamy z requestu po stronie serwera, żeby klient nie mógł
// ich sfałszować w logu audytowym.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CONSENT_KEYS } from "@/lib/notifications/consentCatalog";

const KeyEnum = z.enum(CONSENT_KEYS as [string, ...string[]]);

const SetConsentSchema = z.object({
  key: KeyEnum,
  given: z.boolean(),
  version: z.string().trim().min(1).max(32),
  lang: z.enum(["pl", "en"]).optional(),
  source: z.string().trim().max(64).optional(),
});

function readIp(req: Request | null): string | null {
  if (!req) return null;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || null;
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    null
  );
}
function readUserAgent(req: Request | null): string | null {
  if (!req) return null;
  const ua = req.headers.get("user-agent");
  return ua ? ua.slice(0, 500) : null;
}

export const listMyConsents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_consents")
      .select(
        "consent_key, given, version, lang, given_at, withdrawn_at, updated_at",
      )
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
    return row;
  });

export const listMyConsentEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(200).optional() }).parse(input ?? {}),
  )
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
