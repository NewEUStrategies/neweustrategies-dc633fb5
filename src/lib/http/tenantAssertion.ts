// Poświadczenie hosta wystawiane przez KRAWĘDŹ - czysty, izomorficzny kontrakt
// formatu (kodowanie, parsowanie, okna czasu, transport). Podpisywanie żyje w
// `src/lib/server/tenantAssertion.server.ts` (sekret nigdy nie dotyka bundla
// przeglądarki), weryfikacja - w bazie
// (`public.verify_tenant_host_assertion()`, migracja 20260805090000).
//
// ── PO CO TO JEST ───────────────────────────────────────────────────────────
// `x-tenant-host` jest deklaracją klienta: przez PostgREST każdy z publicznym
// kluczem anon może podać domenę innego tenanta (audyt 05.08 §4.1). Walidacja
// krawędziowa (`pickTrustedHost`) chroni tylko żądania idące przez SSR - a
// przeglądarka i skrypty wołają PostgREST wprost.
//
// Poświadczenie jest tym, czego klient NIE potrafi wytworzyć: HMAC-SHA256 nad
// `v1:<kid>:<host>:<exp>` sekretem znanym wyłącznie krawędzi (env) i bazie
// (Vault). Baza rozstrzyga tenanta ze świadomością szczebla zaufania:
// poświadczony host obowiązuje zawsze, sama deklaracja - dla anonimowego
// czytelnika, a ZALOGOWANEGO nigdy nie wyprowadzi z jego tenanta domowego.
//
// ── UCZCIWIE O GRANICACH ────────────────────────────────────────────────────
// Poświadczenie wiąże HOSTA, nie osobę: kto chce, pobierze poświadczenie
// tenanta B wchodząc na publiczną witrynę B. I dobrze - to nie jest token
// dostępu, tylko dowód „ruch przeszedł przez platformę dla hosta H". Dzięki
// niemu odróżniamy ruch platformy od surowego wywołania API, a bazie wolno
// bezpiecznie degradować ten drugi. Wartość ochronna siedzi w regule
// przypięcia zalogowanego do tenanta domowego, nie w samym podpisie.
//
// ── FORMAT ──────────────────────────────────────────────────────────────────
//   v1.<kid>.<base64url(host)>.<exp-epoch-sekundy>.<base64url(hmac)>
// Host jest zakodowany, bo kropka jest separatorem pól - domena nigdy nie
// rozjedzie parsera. Podpis obejmuje WSZYSTKIE pola, więc żadnego nie da się
// podmienić bez unieważnienia poświadczenia.

/** Nagłówek transportujący poświadczenie do PostgREST. */
export const TENANT_ASSERTION_HEADER = "x-tenant-assert";

/**
 * Cookie, którym krawędź podaje poświadczenie przeglądarce. Świadomie BEZ
 * HttpOnly: klient anon musi je przepisać do nagłówka wywołania PostgREST
 * (inny origin niż witryna, więc samo cookie tam nie dojedzie). Nie jest
 * poświadczeniem tożsamości - nie chroni niczego, co JS mógłby wykraść.
 */
export const TENANT_ASSERTION_COOKIE = "nes_tenant_assert";

/** Domyślny identyfikator klucza, gdy wdrożenie nie ustawiło własnego. */
export const DEFAULT_TENANT_ASSERTION_KID = "edge1";

/**
 * Ważność poświadczenia. Hojna świadomie: dokument SSR bywa cache'owany na
 * krawędzi, a poświadczenie w nim osadzone musi przeżyć cały czas życia wpisu
 * i sesję czytelnika. Bezpieczeństwo nie stoi na krótkim TTL (poświadczenie
 * jest publiczne), tylko na wiązaniu hosta.
 */
export const TENANT_ASSERTION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Krok kwantyzacji `exp`. Wszystkie poświadczenia dla danego hosta wystawione
 * w tym samym kroku są BAJT W BAJT identyczne - dzięki temu:
 *   * cache dokumentów i cache'e brzegowe nie mnożą wariantów odpowiedzi,
 *   * `Set-Cookie` leci najwyżej raz na krok, a nie przy każdym żądaniu,
 *   * podpis policzony podczas SSR zgadza się z tym, co ma przeglądarka.
 */
export const TENANT_ASSERTION_STEP_SECONDS = 60 * 60;

/** Rozłożone poświadczenie (po walidacji kształtu, PRZED weryfikacją podpisu). */
export interface ParsedTenantAssertion {
  readonly kid: string;
  readonly host: string;
  readonly expiresAt: number;
  /** Dokładny tekst podpisany przez krawędź - wejście weryfikatora. */
  readonly signedMessage: string;
  /** Podpis w base64url, bez dopełnienia. */
  readonly signature: string;
}

/** Górny limit długości - nagłówek jest wejściem atakującego, nie kanałem danych. */
const MAX_ASSERTION_LENGTH = 512;

const KID_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/** Bajty -> base64url bez dopełnienia (bliźniak public.b64url_encode). */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url -> bajty; null zamiast wyjątku dla wejścia spoza alfabetu. */
export function fromBase64Url(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!normalized || !/^[A-Za-z0-9+/]+$/.test(normalized)) return null;
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    if (typeof atob === "function") {
      const binary = atob(padded);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(padded, "base64"));
  } catch {
    return null;
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Dokładny tekst objęty podpisem. Jedna definicja dla krawędzi i dla bazy. */
export function tenantAssertionMessage(kid: string, host: string, expiresAt: number): string {
  return `v1:${kid}:${host}:${expiresAt}`;
}

/**
 * `exp` skwantyzowane do kroku: ten sam host w tym samym kroku daje identyczne
 * poświadczenie. `nowSeconds` jest parametrem, żeby testy nie zależały od zegara.
 */
export function tenantAssertionExpiry(nowSeconds: number): number {
  const step = TENANT_ASSERTION_STEP_SECONDS;
  return Math.ceil(nowSeconds / step) * step + TENANT_ASSERTION_TTL_SECONDS;
}

/** Składa poświadczenie z gotowego podpisu (bajty HMAC). */
export function formatTenantAssertion(
  kid: string,
  host: string,
  expiresAt: number,
  signature: Uint8Array,
): string {
  const encodedHost = toBase64Url(textEncoder.encode(host));
  return `v1.${kid}.${encodedHost}.${expiresAt}.${toBase64Url(signature)}`;
}

/**
 * Waliduje KSZTAŁT poświadczenia i rozkłada je na pola. Nie weryfikuje podpisu
 * - to robi baza (jedyne miejsce z sekretem po stronie odczytu). Zwraca null
 * dla wszystkiego, co nie jest poprawnym poświadczeniem: brak wyjątków, bo
 * wołane jest na wejściu z sieci.
 */
export function parseTenantAssertion(raw: string | null | undefined): ParsedTenantAssertion | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value.length > MAX_ASSERTION_LENGTH) return null;

  const parts = value.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return null;

  const kid = parts[1].toLowerCase();
  if (!KID_RE.test(kid)) return null;
  if (!/^[0-9]{1,15}$/.test(parts[3])) return null;
  const expiresAt = Number.parseInt(parts[3], 10);
  if (!Number.isFinite(expiresAt)) return null;

  const hostBytes = fromBase64Url(parts[2]);
  if (!hostBytes) return null;
  let host: string;
  try {
    host = textDecoder.decode(hostBytes).trim().toLowerCase();
  } catch {
    return null;
  }
  if (!host || !/^[a-z0-9.:_\-[\]]+$/.test(host)) return null;
  if (!fromBase64Url(parts[4])) return null;

  return {
    kid,
    host,
    expiresAt,
    signedMessage: tenantAssertionMessage(kid, host, expiresAt),
    signature: parts[4].replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  };
}

/**
 * Czy poświadczenie da się jeszcze użyć dla danego hosta. `graceSeconds`
 * odrzuca takie, które wygasną w trakcie lotu żądania - lepiej odświeżyć
 * cookie o chwilę wcześniej niż wysłać do bazy martwy podpis.
 */
export function isTenantAssertionUsable(
  parsed: ParsedTenantAssertion | null,
  host: string | null,
  nowSeconds: number,
  graceSeconds = 60,
): boolean {
  if (!parsed || !host) return false;
  if (parsed.host !== host.trim().toLowerCase()) return false;
  return parsed.expiresAt > nowSeconds + graceSeconds;
}

/** Wartość cookie poświadczenia z nagłówka `Cookie` (serwer) - albo null. */
export function readTenantAssertionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const chunk of cookieHeader.split(";")) {
    const separator = chunk.indexOf("=");
    if (separator === -1) continue;
    if (chunk.slice(0, separator).trim() !== TENANT_ASSERTION_COOKIE) continue;
    const value = chunk.slice(separator + 1).trim();
    return value ? decodeURIComponent(value) : null;
  }
  return null;
}

/** To samo w przeglądarce (`document.cookie`). Null poza przeglądarką. */
export function browserTenantAssertion(): string | null {
  if (typeof document === "undefined") return null;
  return readTenantAssertionCookie(document.cookie);
}

/**
 * Nagłówek `Set-Cookie` przekazujący poświadczenie przeglądarce. `Max-Age`
 * równy krokowi kwantyzacji: przeglądarka odświeża je z tą samą częstotliwością,
 * z jaką zmienia się wartość, a wygaśnięcie samego cookie wyprzedza wygaśnięcie
 * podpisu o cały zapas TTL.
 */
export function tenantAssertionCookieHeader(assertion: string, secure: boolean): string {
  const attributes = [
    `${TENANT_ASSERTION_COOKIE}=${encodeURIComponent(assertion)}`,
    "Path=/",
    `Max-Age=${TENANT_ASSERTION_STEP_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}
