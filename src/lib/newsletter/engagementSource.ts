// Kto ma prawo zapisać zdarzenie zaangażowania newslettera (open/click).
//
// PROBLEM, KTÓRY TEN MODUŁ ZAMYKA. Do `newsletter_campaign_events` pisały
// równolegle DWA producenty mierzące dokładnie to samo tym samym mechanizmem:
//   * tracking własny - piksel `/api/public/nl-open` i przekierowanie
//     `/api/public/nl-click` (podpis HMAC per kampania+subskrybent),
//   * webhook dostarczalności dostawcy poczty - `email.opened` / `email.clicked`.
// Każde otwarcie liczyło się dwa razy, więc wskaźnik otwarć potrafił przekroczyć
// 100% - liczba, która nie może być prawdziwa, więc unieważnia cały kafelek.
//
// Unikalny indeks w bazie (migracja 20260814150000) czyni podwójny zapis
// NIESZKODLIWYM, ale nie czyni go SENSOWNYM: dwa źródła nadal ścigałyby się
// o ten sam wiersz, a „kto pierwszy" decydowałoby o znaczniku czasu i o adresie
// docelowym kliknięcia. Dlatego dokładnie JEDNO źródło jest źródłem prawdy,
// a drugie milczy - deklaratywnie, nie przez zakomentowany kod.
//
// Moduł jest CZYSTY (bez I/O, bez importów serwerowych), więc decyzja
// „czy wolno pisać" ma test jednostkowy niezależny od bazy i od routingu.

/** Producent zdarzenia zaangażowania. */
export type EngagementSource =
  /** Piksel + przekierowanie z naszej domeny (token HMAC per kampania+subskrybent). */
  | "first_party"
  /** Webhook dostawcy poczty (Resend: email.opened / email.clicked). */
  | "provider";

export const ENGAGEMENT_SOURCES: readonly EngagementSource[] = ["first_party", "provider"];

/**
 * Domyślne źródło prawdy: tracking WŁASNY.
 *
 * Nie jest to wybór arbitralny. Piksel i przekierowanie są pod naszą kontrolą
 * (podpisany token per kampania+subskrybent, podpis per link, walidacja tenanta
 * w RPC), działają niezależnie od dostawcy poczty i nie znikają przy migracji
 * do innego ESP. Zdarzenia dostawcy niosą to samo, ale przez cudzy pomiar:
 * wymagają włączonego trackingu po stronie dostawcy, który przepisuje NASZE
 * linki `nl-click` jeszcze raz na swoje - czyli mierzy pomiar.
 */
export const DEFAULT_ENGAGEMENT_SOURCE: EngagementSource = "first_party";

/** Nazwa zmiennej środowiskowej sterującej wyborem źródła. */
export const ENGAGEMENT_SOURCE_ENV = "NEWSLETTER_ENGAGEMENT_SOURCE";

function isEngagementSource(value: string): value is EngagementSource {
  return (ENGAGEMENT_SOURCES as readonly string[]).includes(value);
}

/**
 * Odczytuje skonfigurowane źródło prawdy. Wartość nieznana albo pusta spada na
 * domyślną - literówka w konfiguracji nie może wyłączyć telemetrii w OBU
 * ścieżkach (cisza jest gorsza od inflacji: inflację widać, ciszy nie).
 */
export function resolveEngagementSource(raw: string | undefined | null): EngagementSource {
  const value = (raw ?? "").trim().toLowerCase();
  return isEngagementSource(value) ? value : DEFAULT_ENGAGEMENT_SOURCE;
}

/** Czy producent `source` jest w tej konfiguracji źródłem prawdy. */
export function isEngagementWriter(
  source: EngagementSource,
  configured: EngagementSource,
): boolean {
  return source === configured;
}
