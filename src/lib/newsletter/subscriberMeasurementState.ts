// Stan zgody na pomiar otwarć i kliknięć w oknie szczegółów subskrybenta
// (I9d-Y2b, R1.8; przegląd R1 - ui-r1-1) - moduł CZYSTY, bez Reacta i bez
// klienta bazy.
//
// Okno pokazuje DEKLARACJĘ z formularza (`email_measurement_declared`
// w `consents`), a deklaracja nie zmienia się po decyzji właściciela skrzynki
// ani po wygaśnięciu oferty. Stała etykieta „czeka na potwierdzenie" podawała
// więc personelowi fałszywy stan, gdy zgoda była już udzielona albo
// odrzucona. Rzeczywisty stan liczy WYŁĄCZNIE czytelnik zgody w bazie
// (`_email_measurement_consent`, D2: aktywny subskrybent, wpis „tak" związany
// z jego wierszem, z kanału udzielenia, w wersji treści pomiaru, później niż
// każde „nie") - TS go nie odtwarza. Funkcja serwerowa panelu
// (`getSubscriberMeasurementConsent`) woła `email_measurement_state` (tylko
// `service_role`) i oddaje tu surowy wynik; ten moduł zawęża kształt
// i pilnuje najemcy.
//
// NAJEMCA: identyfikator subskrybenta przychodzi z panelu (ładunek), więc
// wynik RPC dla wiersza INNEGO najemcy niż najemca sesji = `gone` - okno nie
// ujawnia stanu cudzego subskrybenta ani tego, że taki wiersz istnieje.

/**
 * Stan zgody na pomiar subskrybenta:
 *   * `ok` - wynik czytelnika zgody (`consent`) i przełącznik pomiaru
 *     najemcy (`enabled`; zgoda bez przełącznika = brak pomiaru);
 *   * `gone` - brak wiersza w najemcy sesji;
 *   * `error` - odczyt się nie udał albo kształt odpowiedzi jest nieznany
 *     (okno mówi wtedy „nie udało się odczytać", nigdy „brak zgody").
 */
export type SubscriberMeasurementConsent =
  { result: "ok"; consent: boolean; enabled: boolean } | { result: "gone" } | { result: "error" };

/** Surowa odpowiedź `email_measurement_state` -> stan dla najemcy sesji. */
export function subscriberMeasurementConsentOf(
  raw: unknown,
  sessionTenantId: string,
): SubscriberMeasurementConsent {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { result: "error" };
  const row = raw as Record<string, unknown>;
  if (row.result === "gone") return { result: "gone" };
  if (row.result !== "ok") return { result: "error" };
  if (typeof row.tenant_id !== "string" || row.tenant_id !== sessionTenantId) {
    return { result: "gone" };
  }
  if (typeof row.consent !== "boolean" || typeof row.enabled !== "boolean") {
    return { result: "error" };
  }
  return { result: "ok", consent: row.consent, enabled: row.enabled };
}

/**
 * Co okno mówi o deklaracji pomiaru:
 *   * `granted` - zgoda udzielona (właściciel skrzynki potwierdził);
 *   * `notGranted` - zgody nie ma (brak potwierdzenia, odmowa, wycofanie,
 *     wygaśnięcie oferty albo nieaktywna subskrypcja - czytelnik nie mówi,
 *     który z tych powodów);
 *   * `unknown` - stan nieodczytany (w toku, błąd, brak wiersza) - etykieta
 *     neutralna „zadeklarowana w formularzu", bez zgadywania.
 */
export type DeclaredMeasurementView = "granted" | "notGranted" | "unknown";

export function declaredMeasurementView(
  state: SubscriberMeasurementConsent | null | undefined,
): DeclaredMeasurementView {
  if (!state || state.result !== "ok") return "unknown";
  return state.consent ? "granted" : "notGranted";
}
