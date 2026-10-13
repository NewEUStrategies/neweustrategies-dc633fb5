// Metering gościa po stronie SERWERA (server-only) - druga połowa kontraktu
// z `src/lib/access/visitorToken.ts` (format tokenu) i migracji
// 20261013090400_metering_signed_visitor_ip_limit.sql (funkcje tylko dla
// `service_role`).
//
// SKĄD TOŻSAMOŚĆ (żadna z wartości nie pochodzi z ładunku klienta):
//   * gość - uuid z cookie HttpOnly `nes_mvid` z WAŻNYM podpisem HMAC; brak,
//     podróbka albo przeterminowanie = nowy identyfikator wystawiony tutaj
//     (tylko przy konsumpcji - sam odczyt stanu niczego nie wystawia);
//   * najemca - zaufany host żądania (`requestProbeIdentity` ->
//     `currentTenantHost` -> `resolveTenantIdForHost`), ta sama reguła co
//     sondy kodów `*_for_user` i odsłanianie biletów;
//   * adres - solony skrót z JEDYNEJ definicji „kto dzwoni"
//     (`requestRateSubject` -> `rateLimitIpSubject`), nigdy surowy adres -
//     baza i tak odrzuci wszystko poza `ip:<32 hex>` (CHECK).
//
// SEKRET: klucz pochodny (etykieta celu w `visitorToken.ts`) od istniejącego
// sekretu serwera - `SESSION_SECRET`, a bez niego `SUPABASE_SERVICE_ROLE_KEY`
// (ten sam łańcuch co tokeny trackingu newslettera). Nowej zmiennej
// środowiskowej nie ma. Bez użytecznego sekretu metering gościa degraduje się
// w stronę BEZPIECZNĄ: ściana rejestracji zamiast liczenia "w ciemno".
import { getCookie, getRequest, setCookie } from "@tanstack/react-start/server";

import type { Json } from "@/integrations/supabase/types";
import {
  METERING_VISITOR_COOKIE,
  MIN_VISITOR_SECRET_LENGTH,
  signVisitorToken,
  verifyVisitorToken,
  visitorCookieOptions,
} from "@/lib/access/visitorToken";
import { requestProbeIdentity } from "@/lib/billing/couponRpc.server";

/**
 * Wiersz werdyktu konsumpcji - ten sam kształt co `consume_metered_view` konta
 * (body puste przy każdej odmowie, stąd `| null`).
 */
export interface VisitorConsumeRow {
  granted: boolean;
  consumed: boolean;
  used: number;
  monthly_limit: number;
  remaining: number;
  requires_registration: boolean;
  show_counter: boolean;
  content_pl: string | null;
  content_en: string | null;
  builder_data: Json | null;
  blocks_data: Json | null;
}

/** Wiersz stanu miesiąca gościa - ten sam kształt co `metering_state` konta. */
export interface VisitorQuotaRow {
  enabled: boolean;
  monthly_limit: number;
  used: number;
  remaining: number;
  requires_registration: boolean;
  show_counter: boolean;
}

/**
 * Werdykt "ściana rejestracji" bez konsumpcji - dla stanu, w którym serwer nie
 * potrafi wystawić ani zweryfikować tożsamości gościa. Klient pokazuje wtedy
 * wariant "register", jak przy anon_monthly_limit = 0.
 */
const REGISTRATION_WALL: VisitorConsumeRow = {
  granted: false,
  consumed: false,
  used: 0,
  monthly_limit: 0,
  remaining: 0,
  requires_registration: true,
  show_counter: false,
  content_pl: null,
  content_en: null,
  builder_data: null,
  blocks_data: null,
};

/** Pierwszy sekret serwera, który obroni HMAC - albo null. */
export function meteringVisitorSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  for (const candidate of [env.SESSION_SECRET, env.SUPABASE_SERVICE_ROLE_KEY]) {
    const value = candidate?.trim();
    if (value && value.length >= MIN_VISITOR_SECRET_LENGTH) return value;
  }
  return null;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** https za proxy (`x-forwarded-proto`) albo wprost z adresu żądania. */
function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwarded) return forwarded === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Identyfikator gościa bieżącego żądania. `mint` = wolno wystawić nowy (tylko
 * konsumpcja - odczyt stanu nie zakłada tożsamości, żeby dwa równoległe
 * zapytania bez cookie nie rozdały dwóch różnych identyfikatorów).
 */
export function resolveMeteringVisitor(mint: boolean): string | null {
  const secret = meteringVisitorSecret();
  if (!secret) return null;
  const now = nowSeconds();
  const verified = verifyVisitorToken(secret, getCookie(METERING_VISITOR_COOKIE), now);
  if (verified) return verified.visitorId;
  if (!mint) return null;
  const visitorId = crypto.randomUUID().toLowerCase();
  setCookie(
    METERING_VISITOR_COOKIE,
    signVisitorToken(secret, visitorId, now),
    visitorCookieOptions(isSecureRequest(getRequest())),
  );
  return visitorId;
}

/** Konsumpcja slotu gościa (albo werdykt odmowy) dla bytu `post`/`page`. */
export async function consumeVisitorView(
  entityType: "post" | "page",
  entityId: string,
): Promise<VisitorConsumeRow | null> {
  const visitorId = resolveMeteringVisitor(true);
  if (!visitorId) return REGISTRATION_WALL;
  const { tenantId, probeSubject } = await requestProbeIdentity();
  // Bez najemcy hosta nie ma w czym liczyć - brak werdyktu, nie odmowa.
  if (!tenantId) return null;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("consume_metered_view_visitor", {
    _tenant: tenantId,
    _entity_type: entityType,
    _entity_id: entityId,
    _visitor_id: visitorId,
    _ip_subject: probeSubject,
  });
  if (error) throw new Error(error.message);
  return (data ?? [])[0] ?? null;
}

/** Stan miesiąca gościa bez konsumpcji (bez cookie: sam sufit adresu). */
export async function visitorQuota(): Promise<VisitorQuotaRow | null> {
  const visitorId = resolveMeteringVisitor(false);
  const { tenantId, probeSubject } = await requestProbeIdentity();
  if (!tenantId) return null;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("metering_state_visitor", {
    _tenant: tenantId,
    _ip_subject: probeSubject,
    // Bez cookie: `undefined` znika z JSON-a, a baza liczy sam sufit adresu.
    _visitor_id: visitorId ?? undefined,
  });
  if (error) throw new Error(error.message);
  return (data ?? [])[0] ?? null;
}
