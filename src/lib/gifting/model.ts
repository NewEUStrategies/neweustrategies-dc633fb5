// Gift Articles ("Podaruj artykul") - czysta, framework-free logika domeny.
// Wspoldzielona przez komponenty UI, hooki i testy: budowa URL-i podarunkowych,
// parsowanie kodu z adresu, macierz stanow popovera i mapowanie bledow RPC.
// Zero zaleznosci od Reacta/Supabase - wszystko unit-testowalne.

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

/** Ustawienia gifting (singleton per tenant; brak wiersza = te wartosci). */
export interface GiftSettings {
  enabled: boolean;
  monthly_limit: number;
  link_ttl_days: number;
}

export const DEFAULT_GIFT_SETTINGS: GiftSettings = {
  enabled: true,
  monthly_limit: 0,
  link_ttl_days: 0,
};

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
}

/** Wynik create_gift_link (znormalizowany). */
export interface GiftLinkResult {
  code: string;
  expiresAt: string | null;
  used: number;
  monthlyLimit: number;
  remaining: number | null;
}

/**
 * Faza UI popovera:
 *  - "disabled"             - funkcja wylaczona w tenancie,
 *  - "requiresAuth"         - gosc: CTA logowania/rejestracji,
 *  - "requiresSubscription" - zalogowany bez platnej subskrypcji: CTA planow,
 *  - "limitReached"         - subskrybent wyczerpal miesieczny limit,
 *  - "ready"                - mozna generowac/udostepniac,
 *  - "loading"              - czekamy na stan z serwera.
 */
export type GiftUiPhase =
  "loading" | "disabled" | "requiresAuth" | "requiresSubscription" | "limitReached" | "ready";

/**
 * Macierz stanow popovera - JEDYNE miejsce, ktore tlumaczy (auth, ustawienia,
 * stan RPC) na faze UI. Gosc nie wymaga zadnego RPC: werdykt wynika z samego
 * braku sesji. Istniejacy kod dla wpisu wygrywa z wyczerpanym limitem
 * (ponowne udostepnienie tego samego artykulu nie konsumuje limitu - jak NYT).
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
  if (state.existingCode) return "ready";
  if (state.monthlyLimit > 0 && (state.remaining ?? 0) <= 0) return "limitReached";
  return "ready";
}

/** Klucze bledow RPC create_gift_link -> klucze i18n / decyzje UI. */
export type GiftErrorKey =
  "authRequired" | "subscriptionRequired" | "limitReached" | "disabled" | "notFound" | "unknown";

const ERROR_PATTERNS: ReadonlyArray<readonly [string, GiftErrorKey]> = [
  ["gift_auth_required", "authRequired"],
  ["gift_subscription_required", "subscriptionRequired"],
  ["gift_limit_reached", "limitReached"],
  ["gift_disabled", "disabled"],
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
