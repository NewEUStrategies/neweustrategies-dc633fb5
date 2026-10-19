// LINKI LEJKA CZYTELNIKA: logowanie z powrotem na treść (P15).
//
// DEFEKT. Paywall, licznik i bramka klubu prowadziły do `/login` bez adresu
// powrotu, a portal po zalogowaniu robił `navigate("/")`: czytelnik, który
// założył konto, żeby przeczytać artykuł, lądował na stronie głównej
// i musiał szukać tekstu od nowa. Powrót do artykułu istniał tylko dla kasy
// (`sessionStorage`).
//
// ZMIANA. `/login` przyjmuje `next` (ścieżka powrotu), `intent` (skąd przyszedł
// - źródło rejestracji i kontekst komunikatu) i `plan` (plan wybrany przed
// logowaniem). Ten moduł jest JEDYNYM miejscem, które buduje i czyta te
// parametry: paywall, licznik, bramka klubu, cennik, trasa `/login`, portal
// i `/auth/callback` mówią tym samym językiem.
//
// BEZPIECZEŃSTWO (open redirect). `next` przechodzi przez `safeReturnPath`
// (jedna sanitizacja ścieżek powrotu w repo, K-14) i dodatkowo przez
// odkodowanie: `%2F%2Fevil.com` po jednym dekodowaniu to `//evil.com`, a część
// serwerów i proxy normalizuje ścieżkę przed przekierowaniem. Odrzucamy też
// cele, które zapętlałyby logowanie (`/login`, `/auth/*`).
//
// Moduł czysty i mały - jedzie w bundlu `public` (paywall, licznik, cennik).
import { safeReturnPath } from "@/lib/billing/returnPath";

/** Skąd czytelnik przyszedł do logowania. */
export const LOGIN_INTENTS = ["paywall", "meter", "club", "pricing", "checkout"] as const;
export type LoginIntent = (typeof LOGIN_INTENTS)[number];

export type LoginMode = "signin" | "signup";

/** Parametry `/login` po walidacji - kształt `validateSearch` trasy. */
export interface LoginSearch {
  mode?: "signin" | "signup" | "reset";
  next?: string;
  intent?: LoginIntent;
  plan?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Cele, które zapętlałyby logowanie albo wracały na trasę bez treści. */
const LOOP_PREFIXES = ["/login", "/auth/", "/reset-password"];
const MISSING = "\u0000";

function decodeOnce(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Bezpieczna ścieżka powrotu albo `null`. Wpuszcza WYŁĄCZNIE ścieżkę względną
 * w obrębie serwisu (`/artykul?x=1#sekcja`); `//host`, `https://…`, `/\host`,
 * zakodowane `%2F%2F` i `%5C`, znaki sterujące i pętle logowania - nie.
 */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = safeReturnPath(raw, MISSING);
  if (clean === MISSING) return null;
  // Dwa poziomy kodowania wystarczą na każdy realny wektor (`%252F` -> `%2F`
  // -> `/`); każdy poziom musi nadal być bezpieczną ścieżką.
  let probe = clean;
  for (let i = 0; i < 2; i += 1) {
    const decoded = decodeOnce(probe);
    if (decoded === null) return null;
    if (decoded === probe) break;
    if (safeReturnPath(decoded, MISSING) === MISSING || decoded.includes("\\")) return null;
    probe = decoded;
  }
  if (clean.includes("\\")) return null;
  const path = probe.split(/[?#]/, 1)[0];
  if (
    LOOP_PREFIXES.some((prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix))
  ) {
    return null;
  }
  return clean;
}

export function isLoginIntent(raw: unknown): raw is LoginIntent {
  return (LOGIN_INTENTS as readonly unknown[]).includes(raw);
}

/** Walidacja `?mode&next&intent&plan` trasy `/login` (nieznane - odrzucone). */
export function parseLoginSearch(search: Record<string, unknown>): LoginSearch {
  const out: LoginSearch = {};
  const mode = search.mode;
  if (mode === "signin" || mode === "signup" || mode === "reset") out.mode = mode;
  const next = safeNextPath(search.next);
  if (next) out.next = next;
  if (isLoginIntent(search.intent)) out.intent = search.intent;
  if (typeof search.plan === "string" && UUID.test(search.plan))
    out.plan = search.plan.toLowerCase();
  return out;
}

/** Bieżąca ścieżka strony jako cel powrotu (tylko w przeglądarce). */
export function currentReturnPath(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const { pathname, search, hash } = window.location;
  return safeNextPath(`${pathname}${search}${hash}`) ?? undefined;
}

/**
 * Parametry linku do `/login` - obiekt `search` routera. Puste pola są
 * pomijane, żeby adres nie niósł `?next=undefined`.
 */
export function loginSearch(input: {
  mode: LoginMode;
  next?: string | null;
  intent?: LoginIntent;
  planId?: string | null;
}): LoginSearch {
  const out: LoginSearch = { mode: input.mode };
  const next = safeNextPath(input.next);
  if (next) out.next = next;
  if (input.intent) out.intent = input.intent;
  if (input.planId && UUID.test(input.planId)) out.plan = input.planId.toLowerCase();
  return out;
}

/** To samo jako adres (np. `emailRedirectTo`, `href` w e-mailu). */
export function loginHref(
  mode: LoginMode,
  next?: string | null,
  intent?: LoginIntent,
  planId?: string | null,
): string {
  const search = loginSearch({ mode, next, intent, planId });
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value) params.set(key, value);
  }
  return `/login?${params.toString()}`;
}

/**
 * Cel po zalogowaniu: bezpieczny `next`, potem kasa wybranego planu, potem
 * strona główna. Plan bez `next` to czytelnik z cennika - wraca do kasy tego
 * planu, a nie na stronę główną.
 */
export function postLoginTarget(search: LoginSearch, fallback = "/"): string {
  const next = safeNextPath(search.next);
  if (next) return next;
  if (search.plan && UUID.test(search.plan)) return `/checkout/${search.plan.toLowerCase()}`;
  return fallback;
}

/** Źródło rejestracji (`signup_source`) z intencji - biała lista SQL. */
export function signupSourceForIntent(intent: LoginIntent | undefined): string {
  if (intent === "paywall" || intent === "meter") return "paywall";
  if (intent === "pricing") return "pricing";
  if (intent === "checkout") return "checkout";
  if (intent === "club") return "club_gate";
  return "auth_page";
}

/**
 * `emailRedirectTo` rejestracji: link z e-maila wraca przez `/auth/callback`
 * z `next`, więc nowe konto po potwierdzeniu adresu ląduje na treści, przez
 * którą się zarejestrowało (bez `next` - jak dotąd).
 */
export function signupRedirectPath(next: string | null | undefined, fallback: string): string {
  const safe = safeNextPath(next);
  return safe ? `/auth/callback?next=${encodeURIComponent(safe)}` : fallback;
}
