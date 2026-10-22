// ZGODA NA POMIAR W CHWILI WYSYŁKI KAMPANII (I9d-Y2) - porcja adresów ->
// zbiór adresów MIERZONYCH (zgoda osoby na pomiar ORAZ wspólny przełącznik
// najemcy `journey_settings.open_tracking_enabled`, Z-I9c-09).
//
// Regułę liczy baza (`email_measurement_status`, 20261020162300) - ta sama,
// której używa render ścieżek (`journey_contact_for_send`) i zapis zdarzeń
// (`newsletter_record_campaign_event`), więc mail z pikselem zawsze trafia do
// osoby, której otwarcie baza potem przyjmie.
//
// AWARIA = BEZ POMIARU. Błąd odczytu nie zatrzymuje kampanii (mail bez
// piksela i bez linków z identyfikatorem jest poprawnym mailem), ale nigdy
// nie daje pomiaru osobie, której zgody nie potwierdziliśmy - pomiar bez
// zgody to naruszenie, brak statystyki to tylko luka w raporcie.
//
// Moduł ładowany WYŁĄCZNIE dynamicznie (`*.server`).
import type { RpcCallable } from "@/lib/revenue/rpcCallable";

/** Limit adresów na jedno wywołanie (lustro `c_max` w `email_measurement_status`). */
export const MEASUREMENT_STATUS_BATCH = 2000;

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Adresy (znormalizowane: obcięte, małe litery), które WOLNO mierzyć.
 * Najemca pochodzi z serwera (kampania przejęta przez runner), nigdy
 * z żądania publicznego.
 */
export async function fetchMeasuredEmails(
  client: unknown,
  tenantId: string,
  emails: readonly string[],
): Promise<Set<string>> {
  const unique = [...new Set(emails.map(normalize).filter(Boolean))];
  const measured = new Set<string>();
  const rpc = client as RpcCallable;
  for (let start = 0; start < unique.length; start += MEASUREMENT_STATUS_BATCH) {
    const chunk = unique.slice(start, start + MEASUREMENT_STATUS_BATCH);
    let data: unknown;
    let error: { message: string; code?: string } | null;
    try {
      ({ data, error } = await rpc.rpc("email_measurement_status", {
        p_tenant: tenantId,
        p_emails: chunk,
      }));
    } catch {
      // Zerwane połączenie = porcja bez pomiaru, nie przerwana kampania.
      data = null;
      error = { message: "rpc_threw", code: "rpc_threw" };
    }
    if (error || (data !== null && !Array.isArray(data))) {
      // Bez adresu w logu: komunikat Postgresa może cytować parametry.
      console.error("[measurement] status read failed - porcja bez pomiaru", {
        tenantId,
        count: chunk.length,
        code: error?.code ?? "shape",
      });
      continue;
    }
    if (!Array.isArray(data)) continue;
    for (const row of data) {
      if (typeof row !== "object" || row === null) continue;
      const { email, measured: isMeasured } = row as { email?: unknown; measured?: unknown };
      if (typeof email === "string" && isMeasured === true) measured.add(normalize(email));
    }
  }
  return measured;
}
