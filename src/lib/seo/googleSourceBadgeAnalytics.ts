// Analityka badge „Preferowane źródło w Google” - podwójny beacon:
// analytics_events przez /api/public/track (raporty w /admin/analytics) oraz
// GA4 gtag, jeśli skrypt został wczytany po zgodzie marketingowej.
//
// NIEZALEŻNOŚĆ OBU NADAŃ JEST TU FUNKCJONALNOŚCIĄ, NIE OZDOBĄ. Każdy beacon
// idzie we WŁASNEJ granicy błędu (`fireBeacon`), bo cała wartość modułu leży
// w słowie „niezależne": awaria jednego kanału nie ma prawa zabrać drugiego,
// a żadna z nich nie ma prawa wyjść wyjątkiem do wołającego. Ta funkcja jest
// wołana WPROST z `onClick` linku wychodzącego (`GooglePreferredSourceBadge`),
// więc niewyłapany wyjątek zamienia kliknięcie w link na zgłoszenie błędu
// aplikacji (`window.onerror`, a w panelach - granica błędu).
import { track } from "@/lib/analytics/track";
import type {
  GoogleSourceBadgeDevice,
  GoogleSourceBadgeVariant,
} from "@/lib/seo/googleSourceBadge";

/** Stabilna nazwa zdarzenia - dashboardy grupują po niej bez migracji. */
export const GOOGLE_SOURCE_BADGE_EVENT = "google_preferred_source_click";

type GtagFn = (command: "event", name: string, params?: Record<string, unknown>) => void;

function gtag(): GtagFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { gtag?: GtagFn };
  return typeof w.gtag === "function" ? w.gtag : null;
}

/**
 * Jeden beacon = jedna granica błędu. Oba kanały mają WŁASNE, niezależne
 * powody padnięcia: `track()` czyta `localStorage`/`sessionStorage` (tryb
 * prywatny i polityka firmowa rzucają przy samym odczycie), transport
 * `sendBeacon` rzuca po przekroczeniu limitu ładunku, a `gtag` to CUDZY kod
 * wstrzyknięty przez CMP, który równie dobrze może rzucić w środku.
 *
 * CISZA W `catch` JEST KONWENCJĄ TEJ WARSTWY, a nie przeoczeniem. Przeglądarkowe
 * moduły telemetrii w tym repo połykają błąd bez śladu w konsoli, zostawiając
 * wyłącznie komentarz w pustym `catch` - tak robi `analytics/track.ts`
 * (`randomId`, `readSession`, `readAnonId`), `ads/consent.ts` („private mode")
 * i `observability/report.ts` (`sendBeaconPayload` zwraca `false`). `console.warn`
 * w `src/lib/analytics` występuje TYLKO w funkcjach serwerowych
 * (`audience.functions.ts`, `semantic/snapshot.functions.ts`), gdzie trafia do
 * logów workera, a nie do konsoli użytkownika; jedyny `console.debug` w repo
 * (`src/lib/webVitals.ts`) jest bramkowany `import.meta.env.DEV` i zastępuje
 * beacon w trybie developerskim, więc nie jest raportem połkniętego błędu.
 * Dokładanie tu własnego logu oznaczałoby hałas w konsoli KAŻDEGO odwiedzającego
 * z zablokowanym magazynem - i nową konwencję na jedno miejsce w repo.
 */
function fireBeacon(send: () => void): void {
  try {
    send();
  } catch {
    // Fire-and-forget: analityka nie ma prawa wywrócić nawigacji. Pusto
    // z rozmysłem - uzasadnienie ciszy w komentarzu nad funkcją.
  }
}

export interface GoogleSourceBadgeClickPayload {
  href: string;
  device: GoogleSourceBadgeDevice;
  variant: GoogleSourceBadgeVariant;
  lang: string;
  /** Kontekst osadzenia - np. id wpisu, na którym stoi badge. */
  entityId?: string | null;
}

export function trackGoogleSourceBadgeClick(payload: GoogleSourceBadgeClickPayload): void {
  const meta = {
    href: payload.href,
    device: payload.device,
    variant: payload.variant,
    lang: payload.lang,
    outbound: true,
  };
  // Dwa OSOBNE wywołania `fireBeacon`, a nie jedno wspólne `try`: wspólny blok
  // dawałby dokładnie ten defekt, który tu naprawiamy - wyjątek z pierwszego
  // nadania przeskakiwałby drugie.
  fireBeacon(() => {
    track({
      type: "cta_click",
      name: GOOGLE_SOURCE_BADGE_EVENT,
      entityType: "cta",
      entityId: payload.entityId ?? "google_preferred_source",
      meta,
    });
  });
  fireBeacon(() => {
    gtag()?.("event", GOOGLE_SOURCE_BADGE_EVENT, {
      link_url: payload.href,
      device: payload.device,
      variant: payload.variant,
      language: payload.lang,
      outbound: true,
    });
  });
}
