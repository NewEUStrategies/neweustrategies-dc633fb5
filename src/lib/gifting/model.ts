// "Udostepnij pelny artykul" - czysta, framework-free logika domeny.
// Wspoldzielona przez komponenty UI, hooki i testy: budowa URL-i, parsowanie
// kodu z adresu, arytmetyka budzetu klikniec, macierz stanow popovera,
// mapowanie bledow RPC i powodow odmowy na warianty banera odbiorcy.
// Zero zaleznosci od Reacta/Supabase - wszystko unit-testowalne.
//
// Mechanika w jednym zdaniu: zalogowany czytelnik generuje JEDEN idempotentny
// link per artykul, ktory otwiera pelna tresc pierwszym N odbiorcom
// (domyslnie 5); egzekwuje to wylacznie serwer (redeem_gift_link).

/** Parametr zapytania niosacy kod podarunkowy w URL wpisu. */
export const GIFT_QUERY_PARAM = "gift";

/** Kod z migracji: base64url z gen_random_bytes - [A-Za-z0-9_-], 8..64 znakow. */
const CODE_RE = /^[A-Za-z0-9_-]{8,64}$/;

export type GiftLang = "pl" | "en";

/** Waliduje ksztalt kodu (obrona przed smieciem z reki / obcietym linkiem). */
export function isValidGiftCode(value: string | null | undefined): value is string {
  return typeof value === "string" && CODE_RE.test(value);
}

/**
 * Wyciaga kod podarunkowy z `location.search`. Zwraca null dla braku
 * parametru lub kodu o nieprawidlowym ksztalcie (nie odpytujemy wtedy RPC).
 */
export function parseGiftCode(search: string): string | null {
  try {
    const params = new URLSearchParams(search);
    const raw = params.get(GIFT_QUERY_PARAM);
    return isValidGiftCode(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Kanoniczny URL podarunkowy: bazowy adres wpisu + `?gift=<code>`.
 * Istniejacy parametr gift jest nadpisywany (rotacja linku), pozostale
 * parametry i hash zostaja nietkniete. Dla niepoprawnego baseUrl zwraca
 * baseUrl bez zmian (defensywnie - lepszy link bez kodu niz wyjatek w UI).
 */
export function buildGiftUrl(baseUrl: string, code: string): string {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set(GIFT_QUERY_PARAM, code);
    return url.toString();
  } catch {
    return baseUrl;
  }
}

/** Kanaly udostepniania - spojne z SocialKey panelu czytania (FloatingShareBar). */
export type GiftChannelId =
  "mail" | "facebook" | "linkedin" | "whatsapp" | "telegram" | "x" | "reddit";

export interface GiftShareTarget {
  id: GiftChannelId;
  href: string;
}

const enc = encodeURIComponent;

/**
 * Adresy intentow udostepniania dla gotowego linku podarunkowego.
 * Tresci e-maila (temat/tresc) przychodza z i18n z zewnatrz, zeby modul
 * pozostal wolny od zaleznosci od i18next.
 */
export function buildGiftShareTargets(input: {
  url: string;
  title: string;
  emailSubject: string;
  emailBody: string;
}): GiftShareTarget[] {
  const { url, title, emailSubject, emailBody } = input;
  return [
    { id: "mail", href: `mailto:?subject=${enc(emailSubject)}&body=${enc(emailBody)}` },
    { id: "facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` },
    {
      id: "linkedin",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
    },
    { id: "whatsapp", href: `https://wa.me/?text=${enc(`${title} ${url}`)}` },
    { id: "telegram", href: `https://t.me/share/url?url=${enc(url)}&text=${enc(title)}` },
    { id: "x", href: `https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(title)}` },
    { id: "reddit", href: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(title)}` },
  ];
}

/**
 * Kto moze wygenerowac link (kolumna gift_article_settings.eligibility):
 *  - "registered"  - kazda zarejestrowana osoba tego tenanta (domyslne),
 *  - "subscribers" - tylko aktywna subskrypcja / warstwa premium_content.
 */
export type GiftEligibility = "registered" | "subscribers";

/** Zawezenie surowej wartosci z bazy do unii (nieznane -> domyslne). */
export function normalizeGiftEligibility(value: string | null | undefined): GiftEligibility {
  return value === "subscribers" ? "subscribers" : "registered";
}

/** Ustawienia gifting (singleton per tenant; brak wiersza = te wartosci). */
export interface GiftSettings {
  enabled: boolean;
  monthly_limit: number;
  link_ttl_days: number;
  /** Budzet klikniec zamrazany na NOWYM linku (0 = bez limitu). */
  max_redemptions_per_link: number;
  eligibility: GiftEligibility;
}

/**
 * Lustro bezpiecznych fallbackow create_gift_link przy braku wiersza ustawien
 * (migracje 20260724090600 + 20260806170000: monthly_limit 10, link_ttl_days
 * 30, budzet 5 klikniec, bramka "registered"). UI czyta stad nie tylko
 * `enabled` - liczby musza mowic prawde o serwerowym egzekwowaniu, bo copy
 * popovera obiecuje odbiorcom konkretna liczbe otwarc.
 */
export const DEFAULT_GIFT_SETTINGS: GiftSettings = {
  enabled: true,
  monthly_limit: 10,
  link_ttl_days: 30,
  max_redemptions_per_link: 5,
  eligibility: "registered",
};

/**
 * Budzet klikniec linku: ile osob moze jeszcze otworzyc artykul.
 * `limit === 0` znaczy "bez limitu" - wtedy `remaining` jest null.
 */
export interface GiftClickBudget {
  used: number;
  limit: number;
  /** null = bez limitu. */
  remaining: number | null;
  exhausted: boolean;
  unlimited: boolean;
}

/** Czysta arytmetyka budzetu - jedno miejsce dla UI, testow i banerow. */
export function giftClickBudget(used: number, limit: number): GiftClickBudget {
  const safeLimit = Math.max(Math.trunc(limit) || 0, 0);
  const safeUsed = Math.max(Math.trunc(used) || 0, 0);
  if (safeLimit <= 0) {
    return { used: safeUsed, limit: 0, remaining: null, exhausted: false, unlimited: true };
  }
  const remaining = Math.max(safeLimit - safeUsed, 0);
  return {
    used: safeUsed,
    limit: safeLimit,
    remaining,
    exhausted: remaining <= 0,
    unlimited: false,
  };
}

/** Stan gifting zwracany przez RPC gift_article_state (znormalizowany). */
export interface GiftArticleState {
  enabled: boolean;
  canGift: boolean;
  requiresAuth: boolean;
  requiresSubscription: boolean;
  used: number;
  monthlyLimit: number;
  /** null = bez limitu (monthly_limit 0). */
  remaining: number | null;
  existingCode: string | null;
  expiresAt: string | null;
  eligibility: GiftEligibility;
  /** Budzet klikniec istniejacego linku (albo domyslny tenanta, gdy linku brak). */
  budget: GiftClickBudget;
}

/** Wynik create_gift_link (znormalizowany). */
export interface GiftLinkResult {
  code: string;
  expiresAt: string | null;
  used: number;
  monthlyLimit: number;
  remaining: number | null;
  budget: GiftClickBudget;
}

/**
 * Faza UI popovera:
 *  - "disabled"             - funkcja wylaczona w tenancie,
 *  - "requiresAuth"         - gosc (albo konto spoza tenanta): CTA logowania,
 *  - "requiresSubscription" - eligibility=subscribers bez platnej subskrypcji,
 *  - "limitReached"         - wyczerpany miesieczny limit ARTYKULOW,
 *  - "budgetExhausted"      - link dla TEGO artykulu wyczerpal budzet klikniec,
 *  - "ready"                - mozna generowac/udostepniac,
 *  - "loading"              - czekamy na stan z serwera.
 */
export type GiftUiPhase =
  | "loading"
  | "disabled"
  | "requiresAuth"
  | "requiresSubscription"
  | "limitReached"
  | "budgetExhausted"
  | "ready";

/**
 * Macierz stanow popovera - JEDYNE miejsce, ktore tlumaczy (auth, ustawienia,
 * stan RPC) na faze UI. Gosc nie wymaga zadnego RPC: werdykt wynika z samego
 * braku sesji. Istniejacy kod dla wpisu wygrywa z wyczerpanym limitem
 * miesiecznym (ponowne udostepnienie tego samego artykulu nie konsumuje
 * limitu - jak NYT), ale NIE wygrywa z wyczerpanym budzetem klikniec: kod,
 * ktory przestal odblokowywac tresc, nie moze udawac gotowego do wyslania.
 * Rotacja niczego tu nie zmienia - nowy link dziedziczy zuzycie w obrebie
 * miesiaca (create_gift_link przenosi licznik), wiec faza jest terminalna do
 * przelomu okresu.
 */
export function resolveGiftPhase(input: {
  isLoggedIn: boolean;
  settingsEnabled: boolean;
  state: GiftArticleState | null;
  stateLoading: boolean;
}): GiftUiPhase {
  const { isLoggedIn, settingsEnabled, state, stateLoading } = input;
  if (!settingsEnabled) return "disabled";
  if (!isLoggedIn) return "requiresAuth";
  if (stateLoading || !state) return "loading";
  if (!state.enabled) return "disabled";
  if (state.requiresAuth) return "requiresAuth";
  if (state.requiresSubscription) return "requiresSubscription";
  if (state.existingCode && state.budget.exhausted) return "budgetExhausted";
  if (state.existingCode) return "ready";
  if (state.monthlyLimit > 0 && (state.remaining ?? 0) <= 0) return "limitReached";
  return "ready";
}

/** Klucze bledow RPC create_gift_link -> klucze i18n / decyzje UI. */
export type GiftErrorKey =
  | "authRequired"
  | "subscriptionRequired"
  | "limitReached"
  | "disabled"
  | "notFound"
  | "notGated"
  | "unknown";

const ERROR_PATTERNS: ReadonlyArray<readonly [string, GiftErrorKey]> = [
  ["gift_auth_required", "authRequired"],
  ["gift_subscription_required", "subscriptionRequired"],
  ["gift_limit_reached", "limitReached"],
  ["gift_disabled", "disabled"],
  // Kolejnosc ma znaczenie: "gift_post_not_gated" nie moze wpasc w
  // "gift_post_not_found" (rozne prefiksy, ale trzymamy je razem swiadomie).
  ["gift_post_not_gated", "notGated"],
  ["gift_post_not_found", "notFound"],
];

/** Mapuje tresc bledu (RAISE EXCEPTION z SQL) na stabilny klucz domenowy. */
export function mapGiftError(message: string | null | undefined): GiftErrorKey {
  if (!message) return "unknown";
  for (const [needle, key] of ERROR_PATTERNS) {
    if (message.includes(needle)) return key;
  }
  return "unknown";
}

/**
 * Werdykt redeem_gift_link:
 *  - "ok"        - odbiorca zuzyl (albo juz mial) slot budzetu,
 *  - "owner"     - to darczynca oglada wlasny link (bez konsumpcji),
 *  - "entitled"  - czytelnik ma wlasne uprawnienie (bez konsumpcji),
 *  - "exhausted" - budzet klikniec wyczerpany,
 *  - "expired"   - link po terminie waznosci,
 *  - "revoked"   - link cofniety przez redakcje,
 *  - "invalid"   - kod nieznany / nie dla tego wpisu / tresc na haslo.
 */
export type GiftRedeemReason =
  "ok" | "owner" | "entitled" | "exhausted" | "expired" | "revoked" | "invalid";

const REDEEM_REASONS: ReadonlySet<string> = new Set<GiftRedeemReason>([
  "ok",
  "owner",
  "entitled",
  "exhausted",
  "expired",
  "revoked",
  "invalid",
]);

/** Zawezenie surowego `reason` z RPC (nieznany powod = "invalid"). */
export function normalizeRedeemReason(value: string | null | undefined): GiftRedeemReason {
  return value && REDEEM_REASONS.has(value) ? (value as GiftRedeemReason) : "invalid";
}

/** Wariant banera odbiorcy nad trescia wpisu. */
export type GiftBannerVariant = "gifted" | "exhausted" | "expired" | "invalid";

/**
 * Powod odmowy -> wariant banera. Odbiorca musi wiedziec, CZY link byl dobry:
 * "wszystkie 5 otwarc juz wykorzystano" i "link wygasl" to inne komunikaty niz
 * "ten link jest nieprawidlowy" - i inna sciezka wyjscia (poproszenie o nowy
 * link vs. cennik).
 */
export function giftBannerVariant(reason: GiftRedeemReason): GiftBannerVariant {
  switch (reason) {
    case "ok":
    case "owner":
    case "entitled":
      return "gifted";
    case "exhausted":
      return "exhausted";
    case "expired":
      return "expired";
    default:
      return "invalid";
  }
}
