// KONTRAKT PARAMETRÓW URL HUBA „PRZYCHÓD I LEJEK" (/admin/revenue).
//
// DLACZEGO LIŚĆ BEZ ŻADNEGO IMPORTU. `validateSearch` zostaje w powłoce trasy,
// a powłoka jedzie w chunku WEJŚCIOWYM każdej strony (splitter TanStacka wynosi
// wyłącznie `component`/`loader`; kronika `check-bundle-size.ts`). Jeden import
// stąd - choćby zod albo stała z modułu danych - wciągnąłby swoje drzewo do
// pierwszego wejścia czytelnika, który panelu nigdy nie otworzy. Test
// `search.test.ts` czyta to źródło i pilnuje zera importów.
//
// LISTY SĄ ŹRÓDŁEM, TYPY Z NICH WYNIKAJĄ. Dopisanie okresu albo zakładki
// w jednym miejscu rozszerza naraz typ, walidację wejścia i wszystko, co po
// listach iteruje (pasek zakładek, mapa nagłówków, testy) - ten sam wzorzec co
// `DASHBOARD_PERIODS` w `lib/admin/dashboard/period.ts`.

/** Zakładki huba; `inputs` to podwidok „Wskaźników" (SPEC §2.2). */
export const REVENUE_TABS = [
  "overview",
  "mrr",
  "funnel",
  "retention",
  "community",
  "diagnostics",
  "offer",
  "access",
  "journeys",
  "metrics",
  "inputs",
] as const;
export type RevenueTabId = (typeof REVENUE_TABS)[number];

/**
 * Okresy huba. Pierwsze sześć to okresy pulpitu (jedna arytmetyka kalendarza,
 * `resolveDashboardRange`), `ltm` i `custom` dokłada `lib/revenue/window.ts`.
 */
export const REVENUE_PERIODS = [
  "week",
  "month",
  "prev-month",
  "quarter",
  "half-year",
  "year",
  "ltm",
  "custom",
] as const;
export type RevenuePeriod = (typeof REVENUE_PERIODS)[number];

/**
 * Segment danych w filtrze. `all` istnieje tylko tu (filtr i dane wejściowe
 * planu) - wiersze księgi niosą jeden z segmentów danych
 * (`REVENUE_DATA_SEGMENTS` w `segments.ts`), nigdy `all`.
 */
export const REVENUE_SEGMENTS = [
  "all",
  "b2c_individual",
  "b2c_reduced",
  "b2b_institution",
] as const;
export type RevenueSegment = (typeof REVENUE_SEGMENTS)[number];

/** Tor lejka: samoobsługa, sprzedaż z historii etapów CRM, albo oba. */
export const REVENUE_TRACKS = ["self_serve", "sales", "all"] as const;
export type RevenueTrack = (typeof REVENUE_TRACKS)[number];

/** Podsekcje zakładek: Społeczność (`events|clubs`) i Oferta (`discounts`). */
export const REVENUE_SECTIONS = ["events", "clubs", "discounts"] as const;
export type RevenueSection = (typeof REVENUE_SECTIONS)[number];

/** Widok Diagnostyki: lista kart albo mapa systemu. */
export const REVENUE_VIEWS = ["list", "map"] as const;
export type RevenueView = (typeof REVENUE_VIEWS)[number];

/** Statusy ścieżki - te same wartości, co CHECK `journey_definitions.status`. */
export const JOURNEY_STATUSES = ["draft", "active", "paused", "archived"] as const;
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];

export interface RevenueHubSearch {
  w?: RevenuePeriod;
  /** `YYYY-MM-DD`, data LOKALNA admina, tylko przy `w=custom`. */
  from?: string;
  /** `YYYY-MM-DD`, data LOKALNA admina (włącznie), tylko przy `w=custom`. */
  to?: string;
  /** Kod ISO 4217; to, czy waluta występuje w danych, rozstrzyga zakładka. */
  cur?: string;
  seg?: RevenueSegment;
  metric?: string;
  /** Arkusz wskaźnika i kontekst benchmarku. */
  ctx?: string;
  finding?: string;
  /** `RevenueCheckId` albo `RevenueFixDialogId` (S7). */
  fix?: string;
  area?: string;
  view?: RevenueView;
  stage?: string;
  track?: RevenueTrack;
  sec?: RevenueSection;
  status?: JourneyStatus;
  q?: string;
  new?: "1";
  /** Klucz szablonu ścieżki z galerii. */
  template?: string;
}

/** Najdłuższa fraza wyszukiwania, jaką hub przyjmuje z adresu. */
export const REVENUE_SEARCH_QUERY_MAX = 200;

/**
 * Identyfikatory w adresie (wskaźnik, kontekst, diagnoza, naprawa, obszar,
 * etap, szablon). Wartości ustalają wycinki S6-S8, więc tu pilnujemy tylko
 * KSZTAŁTU: znaki, z których te identyfikatory się składają (`snake_case`,
 * `obszar.nazwa`, myślnik, dwukropek zakresu). Spacje, ukośniki i znaczniki
 * odpadają, zanim trafią do zapytania albo do `aria-label`.
 */
const URL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const CURRENCY = /^[A-Z]{3}$/;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Klucze, które hub rozumie - reszta adresu nie jest jego sprawą. */
const TOKEN_KEYS = ["metric", "ctx", "finding", "fix", "area", "stage", "template"] as const;

function oneOf<T extends string>(list: readonly T[], raw: unknown): T | undefined {
  return typeof raw === "string" && (list as readonly string[]).includes(raw)
    ? (raw as T)
    : undefined;
}

/**
 * Router parsuje adres przez `JSON.parse`, więc `?q=2026` przychodzi jako
 * LICZBA, a `?metric=true` jako wartość logiczna. Dla pól tekstowych to wciąż
 * tekst, który admin wpisał - przywracamy go, zamiast gubić.
 */
function asText(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "boolean") return String(raw);
  return undefined;
}

function token(raw: unknown): string | undefined {
  const text = asText(raw);
  return text !== undefined && URL_TOKEN.test(text) ? text : undefined;
}

/**
 * Data kalendarzowa `YYYY-MM-DD`, która ISTNIEJE w kalendarzu. Sprawdzamy ją
 * konstruktorem LOKALNYM i porównaniem pól, bo `new Date("2026-02-30")` nie
 * rzuca, tylko przeskakuje w marzec - a `Date.parse` czyta napis jako UTC
 * i potrafi przesunąć dzień (AGENTS: daty lokalne, zero przesunięć).
 */
export function isLocalIsoDay(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const m = ISO_DAY.exec(raw);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

function query(raw: unknown): string | undefined {
  const text = asText(raw)?.trim();
  // Za długa fraza jest ODRZUCANA, nie przycinana (AGENTS: limit widoczny =
  // limit zapisany). Przycięta szukałaby czegoś innego, niż admin wkleił.
  if (!text || text.length > REVENUE_SEARCH_QUERY_MAX) return undefined;
  return text;
}

export function isRevenueTab(raw: unknown): raw is RevenueTabId {
  return typeof raw === "string" && (REVENUE_TABS as readonly string[]).includes(raw);
}

/**
 * Walidator `validateSearch` układu `/admin/revenue`.
 *
 * Nieznane klucze nie trafiają do wyniku, a klucze NIEOBECNE w adresie nie
 * pojawiają się w nim wcale - wynik nie niesie śmieciowych `undefined`.
 *
 * JEDEN WYJĄTEK, wymuszony przez router: znany klucz OBECNY w adresie
 * z wartością odrzuconą wraca jako jawne `undefined`. Router składa wynik
 * walidatora z surowym adresem (`{ ...surowy, ...zwalidowany }`,
 * `router-core` `matchRoutes`), więc pominięty klucz przepuściłby surowe
 * `?w=cokolwiek` do komponentu, który ma typ `RevenuePeriod`. Ten sam wzorzec
 * opisuje trasa `admin.events_.$eventId.sponsor-report.tsx`.
 */
export function parseRevenueHubSearch(raw: Record<string, unknown>): RevenueHubSearch {
  const out: RevenueHubSearch = {};
  const put = <K extends keyof RevenueHubSearch>(key: K, value: RevenueHubSearch[K]) => {
    if (value !== undefined || key in raw) out[key] = value;
  };

  const w = oneOf(REVENUE_PERIODS, raw.w);
  put("w", w);
  // Granice własne mają sens wyłącznie przy okresie własnym; przy każdym innym
  // okresie są resztką poprzedniego wyboru i nie mogą zmieniać okna.
  put("from", w === "custom" && isLocalIsoDay(raw.from) ? raw.from : undefined);
  put("to", w === "custom" && isLocalIsoDay(raw.to) ? raw.to : undefined);
  put("cur", typeof raw.cur === "string" && CURRENCY.test(raw.cur) ? raw.cur : undefined);
  put("seg", oneOf(REVENUE_SEGMENTS, raw.seg));
  for (const key of TOKEN_KEYS) put(key, token(raw[key]));
  put("view", oneOf(REVENUE_VIEWS, raw.view));
  put("track", oneOf(REVENUE_TRACKS, raw.track));
  put("sec", oneOf(REVENUE_SECTIONS, raw.sec));
  put("status", oneOf(JOURNEY_STATUSES, raw.status));
  put("q", query(raw.q));
  put("new", raw.new === "1" || raw.new === 1 ? "1" : undefined);
  return out;
}
