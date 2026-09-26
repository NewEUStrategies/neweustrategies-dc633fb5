// Słownik POMIARU EKSPOZYCJI SPONSORÓW - wspólny dla przeglądarki (śledzenie
// na stronie wydarzenia), endpointu `/api/public/sponsor-event`, raportu
// w studiu i raportu dla sponsora.
//
// LISTY SĄ LUSTREM CHECK-ÓW Z BAZY. `event_sponsor_exposures_placement_values`
// i `..._kind_values` (migracja 20260926140000) są jedynym źródłem prawdy;
// test parytetu (`sponsorExposureDbEnumParity.test.ts`) czyta tekst migracji
// i czerwieni się, gdy jedna strona dostanie wartość, której druga nie zna.
// Wartość spoza listy i tak odrzuci baza - tutaj chodzi o to, żeby przeglądarka
// nie wysyłała rzeczy, których serwer nigdy nie przyjmie.
//
// PLIK JEST LEKKI Z ZAMIARU: jedzie w publicznym chunku strony wydarzenia, więc
// nie importuje niczego poza typami (bez Reacta, i18n i klienta bazy).

/** Miejsca na stronie wydarzenia, w których sponsor jest widoczny. */
export const SPONSOR_PLACEMENTS = [
  "home_strip",
  "partners_section",
  "partners_tab",
  "agenda_session",
  "agenda_track",
  "materials",
  "home_ad",
] as const;
export type SponsorPlacement = (typeof SPONSOR_PLACEMENTS)[number];

/** Rodzaje ekspozycji: wyświetlenie, kliknięcie, otwarcie materiału. */
export const SPONSOR_EXPOSURE_KINDS = ["view", "click", "material_open"] as const;
export type SponsorExposureKind = (typeof SPONSOR_EXPOSURE_KINDS)[number];

/** Endpoint przyjmujący paczki ekspozycji (zawsze 204). */
export const SPONSOR_EVENT_ENDPOINT = "/api/public/sponsor-event";

/** Kształt identyfikatora sesji pomiaru (ten sam wzorzec sprawdza baza). */
export const SPONSOR_SESSION_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** Najwięcej pozycji w jednej paczce - nadmiar baza i tak obetnie. */
export const SPONSOR_BATCH_MAX = 40;

/** Kształt uuid (identyfikatory sponsora, materiału i reklamy). */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSponsorPlacement(value: unknown): value is SponsorPlacement {
  return typeof value === "string" && (SPONSOR_PLACEMENTS as readonly string[]).includes(value);
}

export function isSponsorExposureKind(value: unknown): value is SponsorExposureKind {
  return typeof value === "string" && (SPONSOR_EXPOSURE_KINDS as readonly string[]).includes(value);
}

/**
 * Jedna ekspozycja w paczce. `sponsorId` może być pusty WYŁĄCZNIE dla reklamy
 * strony głównej (sponsora reklamy baza bierze z wiersza reklamy, nie od
 * klienta).
 */
export interface SponsorExposureItem {
  sponsorId: string | null;
  placement: SponsorPlacement;
  kind: SponsorExposureKind;
  materialId?: string | null;
  homeAdId?: string | null;
}

/**
 * Czy pozycję w ogóle warto wysłać. To ta sama macierz, którą egzekwuje baza
 * (`event_sponsor_exposure_ingest` + CHECK-i tabeli), zapisana raz, żeby
 * endpoint i przeglądarka nie niosły rzeczy skazanych na odrzucenie.
 */
export function isAcceptableExposure(item: SponsorExposureItem): boolean {
  const material = item.materialId ?? null;
  const ad = item.homeAdId ?? null;
  if (item.placement === "home_ad") {
    return ad !== null && material === null && item.kind !== "material_open";
  }
  if (ad !== null || item.sponsorId === null) return false;
  if (item.kind === "material_open") return item.placement === "materials" && material !== null;
  if (material !== null) return false;
  if (item.placement === "agenda_session" || item.placement === "agenda_track") {
    return item.kind === "view";
  }
  if (item.placement === "materials") return item.kind === "view";
  return true;
}

/** Pozycja w kształcie, który przyjmuje baza (snake_case, bez pustych pól). */
export function exposureToWire(item: SponsorExposureItem): Record<string, string> {
  const out: Record<string, string> = { placement: item.placement, kind: item.kind };
  if (item.sponsorId !== null) out.sponsor_id = item.sponsorId;
  if (item.materialId) out.material_id = item.materialId;
  if (item.homeAdId) out.home_ad_id = item.homeAdId;
  return out;
}
