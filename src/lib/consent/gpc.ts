// Global Privacy Control (GPC) - rdzeń, w 100% czysty i testowalny.
//
// CZYM JEST GPC. `Sec-GPC: 1` (nagłówek żądania) oraz `navigator.
// globalPrivacyControl === true` (właściwość DOM) to MASZYNOWY, ogólny sygnał
// sprzeciwu: "nie sprzedawaj / nie udostępniaj moich danych, nie profiluj mnie
// międzykontekstowo". Sygnał wysyła przeglądarka (Firefox, Brave, DuckDuckGo)
// albo rozszerzenie prywatnościowe - nie strona.
//
// DLACZEGO MUSIMY GO RESPEKTOWAĆ. Sygnał globalny jest ważnym sprzeciwem
// (art. 21 RODO) i ważnym wycofaniem zgody (art. 7 ust. 3 RODO): wycofanie musi
// być "tak łatwe jak wyrażenie". Pod CPRA §1798.135(b) honorowanie opt-out
// preference signal jest wprost wymagane. Do wydania 2026-08-03 platforma nie
// miała ANI JEDNEGO wystąpienia `Sec-GPC` - baner CMP pytał o zgodę osobę,
// która na poziomie przeglądarki już odmówiła. Ten moduł to zamyka.
//
// ZAKRES KLAMROWANIA. GPC dotyczy sprzedaży/udostępniania danych i profilowania
// międzykontekstowego, NIE preferencji interfejsu:
//   - `analytics`  -> KLAMROWANE (pomiar wymaga zgody; sygnał globalny jest jej
//                     ważną odmową),
//   - `marketing`  -> KLAMROWANE (rdzeń "do not sell/share"),
//   - `personalization` (klucz rejestru) -> KLAMROWANE, bo to profilowanie,
//   - `functional` -> NIE klamrowane: first-party preferencje UI (motyw, układ,
//                     tryb czytania) nie opuszczają przeglądarki, a wyłączenie
//                     ich pogorszyłoby usługę bez korzyści prywatnościowej,
//   - `necessary`  -> nigdy nie podlega zgodzie ani sygnałowi.
//
// ŚWIADOMY OVERRIDE. Spec GPC nie odbiera użytkownikowi prawa do świadomej
// zgody PO wysłaniu sygnału - odbiera stronie prawo do udawania, że sygnału nie
// widziała. Dlatego klamra jest zdejmowana WYŁĄCZNIE przez jawną decyzję
// podjętą przy AKTYWNYM sygnale i przy widocznej nocie o GPC (znacznik
// `gpcOverrideAt` w ConsentState). Stara zgoda z czasów sprzed sygnału NIGDY
// nie przebija GPC - to jest cała istota mechanizmu.
//
// Warstwa serwerowa (odczyt nagłówka, middleware, cookie transportowe) żyje w
// `gpc.server.ts`; ten plik nie importuje niczego z frameworka.

/** Nagłówek żądania wg spec GPC (case-insensitive w Headers). */
export const GPC_HEADER = "sec-gpc";

/**
 * Cookie transportowe SSR -> klient. Serwer widzi `Sec-GPC` przy nawigacji,
 * przeglądarka nie udostępnia nagłówków żądania JS-owi, a `navigator.
 * globalPrivacyControl` jest zaimplementowane WĘŻEJ niż nagłówek (część
 * rozszerzeń wysyła tylko nagłówek). To cookie jest jedynym nośnikiem, który
 * dowozi sygnał do hydratacji BEZ dodatkowego round-tripu i bez różnicowania
 * treści dokumentu (klucz NES Edge Cache zostaje jeden na ścieżkę).
 *
 * Podstawa prawna: cookie ściśle niezbędne (art. 5 ust. 3 dyrektywy ePrivacy) -
 * nośnik prawnego opt-outu, nie da się go bramkować zgodą, której właśnie
 * odmówiono. Nie zawiera identyfikatora - wyłącznie stałą "1".
 */
export const GPC_COOKIE = "nes_gpc";
/** Jedyna dopuszczalna wartość sygnału - spec zna wyłącznie "1". */
export const GPC_COOKIE_VALUE = "1";
/** Zdarzenie okna emitowane, gdy sygnał GPC zmienia stan w tej karcie. */
export const GPC_EVENT = "consent-gpc-change";
/** Ścieżka deklaracji maszynowej wg spec GPC. */
export const GPC_WELL_KNOWN_PATH = "/.well-known/gpc.json";

/** Skąd odczytaliśmy sygnał - trafia do UI i do noty audytowej. */
export type GpcSource = "navigator" | "cookie" | "header" | "none";

export interface GpcSignal {
  /** Czy sygnał jest aktywny (użytkownik wysłał opt-out). */
  readonly active: boolean;
  /** Nośnik, z którego odczytaliśmy sygnał. */
  readonly source: GpcSource;
}

export const GPC_INACTIVE: GpcSignal = { active: false, source: "none" };

/** Kategorie CMP klamrowane sygnałem GPC (patrz nagłówek pliku). */
export const GPC_CLAMPED_CMP_CATEGORIES = ["analytics", "marketing"] as const;
export type GpcClampedCmpCategory = (typeof GPC_CLAMPED_CMP_CATEGORIES)[number];

/**
 * Klucze katalogu zgód, które sygnał GPC wymusza na "nie". Poza kategoriami
 * cookie obejmuje `personalization` - profilowanie treści na podstawie
 * aktywności jest dokładnie tym, czemu GPC się sprzeciwia.
 */
export const GPC_CLAMPED_REGISTRY_KEYS = [
  "cookies_analytics",
  "cookies_marketing",
  "personalization",
] as const;
export type GpcClampedRegistryKey = (typeof GPC_CLAMPED_REGISTRY_KEYS)[number];

const CLAMPED_CMP = new Set<string>(GPC_CLAMPED_CMP_CATEGORIES);
const CLAMPED_REGISTRY = new Set<string>(GPC_CLAMPED_REGISTRY_KEYS);

/** Czy dana kategoria CMP podlega klamrze GPC. */
export function isGpcClampedCategory(category: string): category is GpcClampedCmpCategory {
  return CLAMPED_CMP.has(category);
}

/** Czy dany klucz rejestru zgód podlega klamrze GPC. */
export function isGpcClampedRegistryKey(key: string): key is GpcClampedRegistryKey {
  return CLAMPED_REGISTRY.has(key);
}

/**
 * Parser wartości sygnału. Spec definiuje DOKŁADNIE jedną wartość znaczącą:
 * "1". Cokolwiek innego ("0", "true", "yes", pusty string, brak) to BRAK
 * sygnału - liberalne parsowanie zamieniłoby literówkę w cudzy opt-out.
 */
export function parseGpcValue(raw: string | null | undefined): boolean {
  return typeof raw === "string" && raw.trim() === GPC_COOKIE_VALUE;
}

/** Minimalny kontrakt czytany z Headers - pozwala testować bez Request. */
export interface HeaderReader {
  get(name: string): string | null;
}

/** Odczyt sygnału z nagłówków żądania (`Sec-GPC: 1`). */
export function readGpcFromHeaders(headers: HeaderReader | null | undefined): GpcSignal {
  if (!headers) return GPC_INACTIVE;
  return parseGpcValue(headers.get(GPC_HEADER)) ? { active: true, source: "header" } : GPC_INACTIVE;
}

/**
 * Odczyt cookie transportowego z surowego nagłówka `Cookie`. Własne parsowanie
 * (zamiast split(";")) chroni przed dopasowaniem sufiksu: `x_nes_gpc=1` nie
 * może udawać `nes_gpc=1`.
 */
export function readGpcCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== GPC_COOKIE) continue;
    if (parseGpcValue(decodeURIComponent(part.slice(eq + 1).trim()))) return true;
  }
  return false;
}

/** Minimalny kontrakt `navigator` - pozwala testować bez środowiska DOM. */
export interface GpcNavigatorLike {
  readonly globalPrivacyControl?: unknown;
}

/**
 * Odczyt właściwości DOM. Spec wymaga wartości boolean `true`; string "1"
 * przyjmujemy dodatkowo, bo część rozszerzeń wstrzykuje ją zamiast boolean.
 */
export function readGpcFromNavigator(nav: GpcNavigatorLike | null | undefined): GpcSignal {
  if (!nav) return GPC_INACTIVE;
  const value = nav.globalPrivacyControl;
  const active = value === true || (typeof value === "string" && parseGpcValue(value));
  return active ? { active: true, source: "navigator" } : GPC_INACTIVE;
}

/**
 * Złożenie wszystkich nośników po stronie klienta. Kolejność wynika z
 * wiarygodności, nie z wygody: `navigator` to bezpośrednia deklaracja bieżącej
 * przeglądarki, cookie to migawka z ostatniej nawigacji SSR. OR (nie AND) -
 * sygnał opt-outu z JAKIEGOKOLWIEK nośnika jest sygnałem.
 */
export function resolveClientGpc(
  nav: GpcNavigatorLike | null | undefined,
  cookieHeader: string | null | undefined,
): GpcSignal {
  const fromNavigator = readGpcFromNavigator(nav);
  if (fromNavigator.active) return fromNavigator;
  return readGpcCookie(cookieHeader) ? { active: true, source: "cookie" } : GPC_INACTIVE;
}

// -------------------- Klamra na kategoriach --------------------

/**
 * Nakłada klamrę GPC na mapę kategorii. Czysta funkcja: ta sama logika obsługuje
 * stan trwały, tryb podglądu i odczyt poza Reactem, więc bramkowanie skryptów
 * nie może się rozjechać z tym, co pokazuje UI.
 *
 * @param honored `false` = użytkownik świadomie nadpisał sygnał (patrz
 *   `isGpcOverrideValid`), wtedy zwracamy wejście bez zmian.
 */
export function clampCategoriesForGpc<T extends Record<string, boolean>>(
  categories: T,
  honored: boolean,
): T {
  if (!honored) return categories;
  let changed = false;
  const next = { ...categories };
  for (const cat of GPC_CLAMPED_CMP_CATEGORIES) {
    if (next[cat]) {
      (next as Record<string, boolean>)[cat] = false;
      changed = true;
    }
  }
  return changed ? next : categories;
}

/** Klamra dla pojedynczego klucza rejestru zgód (katalog RODO). */
export function clampRegistryValueForGpc(key: string, given: boolean, honored: boolean): boolean {
  if (!honored || !given) return given;
  return isGpcClampedRegistryKey(key) ? false : given;
}

// -------------------- Świadomy override --------------------

/** Minimalny kształt stanu CMP potrzebny do oceny override'u. */
export interface GpcOverridable {
  /** Znacznik czasu jawnej zgody udzielonej przy WIDOCZNEJ nocie o GPC. */
  readonly gpcOverrideAt?: number;
}

/**
 * Czy override jest ważny. Wymóg jest jeden, ale twardy: override musi być
 * ZNANY (znacznik istnieje i jest sensowną datą). Znacznik zapisujemy wyłącznie
 * w momencie decyzji podjętej przy aktywnym sygnale, więc jego obecność sama
 * dowodzi, że użytkownik widział notę o GPC. Zgody sprzed sygnału znacznika nie
 * mają - i dlatego GPC nad nimi wygrywa.
 */
export function isGpcOverrideValid(state: GpcOverridable | null | undefined): boolean {
  const at = state?.gpcOverrideAt;
  return typeof at === "number" && Number.isFinite(at) && at > 0;
}

/**
 * Czy sygnał ma być HONOROWANY w runtime: aktywny i nienadpisany świadomą
 * decyzją. Jedno miejsce prawdy dla bramkowania, UI i rejestru.
 */
export function isGpcHonored(signal: GpcSignal, state: GpcOverridable | null | undefined): boolean {
  return signal.active && !isGpcOverrideValid(state);
}

// -------------------- Deklaracja /.well-known/gpc.json --------------------

/** Kształt odpowiedzi wg spec GPC (globalprivacycontrol.github.io/gpc-spec). */
export interface GpcDeclaration {
  /** Zawsze `true` - deklarujemy, że serwis honoruje sygnał. */
  readonly gpc: true;
  /** Data ostatniej aktualizacji deklaracji, format ISO `YYYY-MM-DD`. */
  readonly lastUpdate: string;
}

/**
 * Data wdrożenia obsługi GPC. Bump WYŁĄCZNIE przy realnej zmianie zakresu
 * honorowania sygnału - spec traktuje `lastUpdate` jako oświadczenie prawne,
 * nie jako znacznik builda (dlatego jest stałą, a nie `Date.now()`; deklaracja
 * musi też być bit-w-bit identyczna dla cache'a brzegowego).
 */
export const GPC_DECLARATION_LAST_UPDATE = "2026-08-03";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Buduje deklarację; waliduje format daty, żeby literówka nie poszła na produkcję. */
export function buildGpcDeclaration(
  lastUpdate: string = GPC_DECLARATION_LAST_UPDATE,
): GpcDeclaration {
  if (!ISO_DATE_RE.test(lastUpdate)) {
    throw new Error(`gpc.json: lastUpdate musi mieć format YYYY-MM-DD (dostano "${lastUpdate}")`);
  }
  return { gpc: true, lastUpdate };
}
