// DEKLARACJA OSOBNEGO POLA POMIARU PRZY ZAPISIE -> PROŚBA DO WŁAŚCICIELA
// SKRZYNKI (I9d-Y2b; decyzje właściciela 2026-10-23: D1 wariant (b) - każda
// zgoda ma osobne pole; D2 - pomiar tylko dla skrzynki potwierdzonej przez jej
// właściciela).
//
// Zaznaczone pole pomiaru to DEKLARACJA (`email_measurement_declared`
// w `newsletter_subscribers.consents`), nie zgoda. Zgodę zapisuje wyłącznie
// baza (`_email_measurement_grant`) po kliknięciu właściciela skrzynki:
//   * z double opt-in - karta na stronie potwierdzenia zapisu (token DOI);
//   * bez double opt-in i przy adresie już zapisanym - mail z prośbą
//     (`newsletter_measurement_request_signup`, prośba `origin = 'signup'`,
//     stała treść `NEWSLETTER_MEASUREMENT_SIGNUP_COPY`), potem strona
//     `/newsletter/measurement`.
// O tym, czy prośba powstaje (deklaracja świeższa niż odmowa, subskrybent
// aktywny, brak zgody), rozstrzyga SQL (`_newsletter_measurement_offer_state`)
// - tu tylko wołamy RPC i NIGDY nie psujemy zapisu formularza: błąd idzie do
// logu (bez adresu e-mail), odpowiedź formularza zostaje bez zmian.
//
// Wspólne dla `newsletter.functions.ts` i `contact.functions.ts` (te same
// reguły w obu formularzach). Ładowany WYŁĄCZNIE dynamicznie z handlerów.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import { EMAIL_MEASUREMENT_DECLARED_KEY, normalizeConsentKey } from "./measurementConsentText";

type DbClient = SupabaseClient<Database>;

/**
 * Wyniki `newsletter_measurement_request_signup` (rpc-shape: result):
 * `requested` - prośba założona; `exists` - prośba w tej wersji treści już
 * jest; pozostałe - stan oferty, w którym prośby nie zakłada się
 * (`granted`/`declined`/`none`/`inactive`/`gone`) albo zły argument.
 */
export const MEASUREMENT_SIGNUP_REQUEST_RESULTS = [
  "requested",
  "exists",
  "granted",
  "declined",
  "none",
  "inactive",
  "gone",
  "invalid",
] as const;
export type MeasurementSignupRequestResult = (typeof MEASUREMENT_SIGNUP_REQUEST_RESULTS)[number];

/** Wynik RPC -> znany wynik albo `null` (rozjazd kontraktu). */
export function measurementSignupRequestResultOf(
  data: unknown,
): MeasurementSignupRequestResult | null {
  const value =
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>).result
      : null;
  return (MEASUREMENT_SIGNUP_REQUEST_RESULTS as readonly unknown[]).includes(value)
    ? (value as MeasurementSignupRequestResult)
    : null;
}

/**
 * Prośba o potwierdzenie zgody na pomiar po zapisie z zaznaczonym polem.
 * Fail-soft: zwraca wynik albo `null` (błąd, brak id, nieznany kształt) -
 * nigdy nie rzuca. Wynik `none` przy deklaracji przyjętej przez sanitizer
 * TS oznacza rozjazd rozpoznania deklaracji TS <-> SQL - ostrzeżenie w logu
 * zamiast ciszy (bez prośby osoba nie dostałaby żadnej drogi do zgody).
 */
export async function requestMeasurementAfterSignup(
  admin: unknown,
  subscriberId: string | null | undefined,
  scope: string,
): Promise<MeasurementSignupRequestResult | null> {
  if (!subscriberId) {
    console.error(`[${scope}] measurement request skipped: subscriber id missing`);
    return null;
  }
  try {
    // RPC spoza wygenerowanych typów do czasu regeneracji `types.ts` - nazwa
    // zostaje LITERAŁEM (bramka `generate:ts-sql-contract`).
    const { data, error } = await (admin as RpcCallable).rpc(
      "newsletter_measurement_request_signup",
      { p_subscriber: subscriberId },
    );
    if (error) {
      console.error(`[${scope}] measurement request failed`, error.message);
      return null;
    }
    const result = measurementSignupRequestResultOf(data);
    if (result === null) {
      console.error(`[${scope}] measurement request: unexpected result shape`);
      return null;
    }
    if (result === "none") {
      console.warn(`[${scope}] measurement declaration not recognised by the database`);
    }
    return result;
  } catch (err) {
    console.error(
      `[${scope}] measurement request threw`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * `consents` istniejącego subskrybenta z NOWĄ deklaracją pola pomiaru:
 * wcześniejsze deklaracje znikają (rozpoznanie w SQL liczy najświeższą
 * `received_at`, a ponowne zapisy nie mogą rozdmuchać tablicy), reszta
 * pozycji zostaje bez zmian i w tej samej kolejności. Pozycja niebędąca
 * obiektem zostaje (nie naprawiamy cudzych danych przy okazji).
 */
export function withMeasurementDeclaration(
  current: unknown,
  declaration: Record<string, unknown>,
): unknown[] {
  const prior = Array.isArray(current) ? current : [];
  const kept = prior.filter((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return true;
    const key = (entry as Record<string, unknown>).key;
    return !(
      typeof key === "string" && normalizeConsentKey(key) === EMAIL_MEASUREMENT_DECLARED_KEY
    );
  });
  return [...kept, declaration];
}

/**
 * Adres JUŻ zapisany (gałąź `exists`) zaznaczył pole pomiaru: deklaracja
 * trafia do `consents` (wyzwalacz rejestru zgód jej nie loguje - to nie jest
 * zgoda), a baza zakłada prośbę do właściciela skrzynki. Najemca z wiersza
 * (zapytanie przypięte do najemcy hosta), nigdy z ładunku. Fail-soft.
 */
export async function declareMeasurementForExisting(
  admin: DbClient,
  subscriber: { id: string; tenantId: string; consents: unknown },
  declaration: Record<string, unknown>,
  scope: string,
): Promise<MeasurementSignupRequestResult | null> {
  try {
    const { error } = await admin
      .from("newsletter_subscribers")
      .update({
        consents: withMeasurementDeclaration(subscriber.consents, declaration) as Json,
      })
      .eq("id", subscriber.id)
      .eq("tenant_id", subscriber.tenantId);
    if (error) {
      console.error(`[${scope}] measurement declaration failed`, error.message);
      return null;
    }
  } catch (err) {
    console.error(
      `[${scope}] measurement declaration threw`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
  return requestMeasurementAfterSignup(admin, subscriber.id, scope);
}
