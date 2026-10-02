// Measurement Protocol GA4 - ścieżka PEWNA, bez przeglądarki.
//
// PO CO DUBLOWAĆ ZAKUP. Trafienie z przeglądarki ginie, gdy odwiedzający ma
// bloker reklam, zamknie kartę po powrocie z bramki płatniczej albo zapłaci na
// innym urządzeniu. Webhook operatora płatności wie o zapłacie zawsze, więc to
// on jest źródłem prawdy dla przychodu w GA4. `transaction_id` jest ten sam co
// w przeglądarce, dlatego GA4 deduplikuje zakup i nie liczy go dwa razy.
//
// Bez `GA4_API_SECRET` funkcja milczy - analityka nigdy nie może wywrócić
// realizacji płatności.

import { asGa4MeasurementId, GA4_MEASUREMENT_ID } from "./tagIds";

const ENDPOINT = "https://www.google-analytics.com/mp/collect";
/** Webhook operatora płatności czeka na odpowiedź - Google nie może go zawiesić. */
const TIMEOUT_MS = 5_000;

export interface Ga4ServerEvent {
  name: string;
  params: Record<string, string | number | boolean | unknown[]>;
}

/**
 * Ustawienia GA4 NAJEMCY z panelu analityki (`site_settings.analytics`):
 * wyłącznik i identyfikator strumienia. Ten sam wpis czyta SSR korzenia
 * (`__root.tsx#ssrGoogleTag`) dla tagu w przeglądarce.
 */
export interface Ga4TenantSettings {
  /** `false` = administrator kliknął „Odłącz GA4" - serwer też milczy. */
  enabled: boolean;
  /** Identyfikator z panelu po filtrze kształtu `G-XXXXXXXXXX` albo `null`. */
  measurementId: string | null;
}

/**
 * Odczyt ustawień GA4 najemcy spod roli serwisowej (webhook nie ma sesji).
 *
 * BŁĄD ODCZYTU = MILCZENIE. Wyłącznik jest decyzją administratora, a nie
 * podpowiedzią: gdy nie umiemy go przeczytać, nie wysyłamy - przychód
 * i tak trafia do GA4 z przeglądarki (ten sam `transaction_id`), a zakup
 * w księgach jest nietknięty. Brak wpisu to wartości domyślne konfiguracji
 * (`ga4_enabled: true`, bez własnego identyfikatora).
 */
export async function loadTenantGa4Settings(tenantId: string): Promise<Ga4TenantSettings> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("site_settings")
      .select("value")
      .eq("tenant_id", tenantId)
      .eq("key", "analytics")
      .maybeSingle();
    if (error) throw new Error(error.message);
    const value = (data?.value ?? null) as {
      ga4_enabled?: unknown;
      ga4_measurement_id?: unknown;
    } | null;
    return {
      enabled: value?.ga4_enabled !== false,
      measurementId: asGa4MeasurementId(value?.ga4_measurement_id) || null,
    };
  } catch (error) {
    console.error("GA4 MP: tenant settings unreadable - purchase not sent", error);
    return { enabled: false, measurementId: null };
  }
}

/**
 * @param clientId identyfikator klienta GA4 z cookie `_ga`, jeśli znamy. Gdy
 * brak, budujemy stabilny zastępnik z identyfikatora transakcji - zdarzenie
 * trafia wtedy do GA4 jako nowa sesja, ale przychód jest policzony.
 * @param storedMeasurementId identyfikator strumienia z panelu najemcy -
 * ta sama kolejność źródeł co w `resolveGa4MeasurementId` (sekret projektu,
 * potem panel, potem konektor).
 */
export async function sendGa4ServerEvent(
  events: Ga4ServerEvent[],
  clientId: string | null,
  fallbackSeed: string,
  storedMeasurementId: string | null = null,
): Promise<void> {
  const apiSecret = process.env["GA4_API_SECRET"];
  if (!apiSecret || events.length === 0) return;

  // Sekret projektu wygrywa; potem strumień skonfigurowany w panelu najemcy;
  // bez obu ten sam publiczny identyfikator, którym przeglądarka wysyła zakup
  // - inaczej `transaction_id` nie miałby się z czym zdeduplikować i zakup
  // z webhooka trafiałby do innego strumienia albo nikąd.
  const { resolveGa4MeasurementId } = await import("./measurementId");
  const measurementId =
    resolveGa4MeasurementId(storedMeasurementId).measurementId ?? GA4_MEASUREMENT_ID;

  const url = `${ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId ?? syntheticClientId(fallbackSeed),
        non_personalized_ads: true,
        events,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`GA4 MP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  } catch (error) {
    console.error("GA4 MP failed", error);
  }
}

/** GA4 oczekuje formatu `<liczba>.<liczba>`; seed daje stabilność przy retry webhooka. */
export function syntheticClientId(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 0xffffffff;
  }
  return `${hash}.${1000000000}`;
}

export async function sendGa4Purchase(input: {
  transactionId: string;
  amountCents: number | null;
  currency: string | null;
  clientId?: string | null;
  /**
   * Najemca zakupu. Gdy podany, wysyłka respektuje jego panel analityki:
   * wyłącznik `ga4_enabled: false` i własny strumień `ga4_measurement_id`
   * (audyt wyd. 12: zakup z webhooka szedł do strumienia wdrożenia i mimo
   * odłączenia GA4 w panelu).
   */
  tenantId?: string | null;
}): Promise<void> {
  if (input.amountCents === null || !input.currency) return;
  let storedMeasurementId: string | null = null;
  if (input.tenantId) {
    const settings = await loadTenantGa4Settings(input.tenantId);
    if (!settings.enabled) return;
    storedMeasurementId = settings.measurementId;
  }
  await sendGa4ServerEvent(
    [
      {
        name: "purchase",
        params: {
          transaction_id: input.transactionId,
          value: Math.round(input.amountCents) / 100,
          currency: input.currency,
          items: [],
          // Bez czasu zaangażowania zdarzenie z Measurement Protocol nie zasila
          // metryk sesji/użytkowników w raportach standardowych GA4.
          engagement_time_msec: 1,
        },
      },
    ],
    input.clientId ?? null,
    input.transactionId,
    storedMeasurementId,
  );
}
