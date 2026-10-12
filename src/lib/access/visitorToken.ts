// Podpisany identyfikator gościa meteringu - CZYSTY kontrakt formatu
// (podpis, weryfikacja, okno ważności). Sekret podaje wołający: czyta go
// wyłącznie `src/lib/access/meteringVisitor.server.ts`, więc ten moduł nie ma
// czego wynieść do bundla przeglądarki i daje się testować bez środowiska.
//
// ── PO CO TO JEST (audyt billingowy SUB-17) ─────────────────────────────────
// Dotąd klucz gościa był uuid z localStorage podawanym przez KLIENTA do RPC
// `consume_metered_view`. Nowy uuid przy każdym żądaniu = nowy, pusty licznik,
// czyli nieograniczony darmowy dostęp. Teraz identyfikator wystawia SERWER
// jako cookie HttpOnly z HMAC-iem, a do bazy (funkcje tylko dla service_role)
// trafia wyłącznie uuid z ważnym podpisem. Podrobiony, ucięty albo przeterminowany
// token jest traktowany jak BRAK tokenu: gość dostaje świeży identyfikator,
// a nie zaufanie do tego, co przysłał.
//
// ── UCZCIWIE O GRANICACH ────────────────────────────────────────────────────
// Podpis nie zatrzyma kogoś, kto czyści cookies - serwer wystawi mu nowy
// identyfikator. Sufitem dla takiego hosta jest limit ADRESOWY w bazie
// (`_metered_view_consume`, 5 x anon_monthly_limit na solony skrót adresu).
// Podpis gwarantuje coś innego: licznik w bazie należy do identyfikatora,
// który wydał serwer, więc nie da się go "wybrać" ani podszyć pod cudzy.
//
// ── FORMAT ──────────────────────────────────────────────────────────────────
//   v1.<uuid>.<iat-epoch-sekundy>.<base64url(hmac[0..16))>
// HMAC-SHA256 kluczem pochodnym od sekretu serwera z etykietą celu
// (`nes/metering-visitor/v1`) - ten sam sekret bazowy co tokeny trackingu nie
// daje dzięki temu tokenów wymiennych między mechanikami.
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { fromBase64Url, toBase64Url } from "@/lib/http/tenantAssertion";

/** Cookie z podpisanym identyfikatorem gościa (HttpOnly - JS go nie czyta). */
export const METERING_VISITOR_COOKIE = "nes_mvid";

/**
 * Ważność identyfikatora. Licznik jest miesięczny, więc identyfikator musi
 * przeżyć co najmniej cały okres; rok jest też pod sufitem 400 dni, który
 * przeglądarki narzucają na `Max-Age`.
 */
export const VISITOR_TOKEN_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Tolerancja zegara między izolatami (token "z przyszłości"). */
const CLOCK_SKEW_SECONDS = 300;

/** Etykieta celu w wyprowadzeniu klucza - separacja domen podpisu. */
const KEY_LABEL = "nes/metering-visitor/v1";

/** Długość podpisu: 16 bajtów (128 bitów) - w zupełności wystarcza jako tag. */
const SIG_BYTES = 16;

/** Sekret krótszy niż to nie broni HMAC-a - wołający traktuje go jak brak. */
export const MIN_VISITOR_SECRET_LENGTH = 32;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IAT_RE = /^[0-9]{1,12}$/;
const MAX_TOKEN_LENGTH = 128;

export interface VerifiedVisitor {
  readonly visitorId: string;
  readonly issuedAt: number;
}

function derivedKey(secret: string): Uint8Array {
  return hmac(sha256, utf8ToBytes(secret), utf8ToBytes(KEY_LABEL));
}

function signature(secret: string, visitorId: string, issuedAt: number): string {
  const tag = hmac(sha256, derivedKey(secret), utf8ToBytes(`mv1:${visitorId}:${issuedAt}`));
  return toBase64Url(tag.slice(0, SIG_BYTES));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/** Podpisany token dla identyfikatora gościa wystawionego w chwili `issuedAt`. */
export function signVisitorToken(secret: string, visitorId: string, issuedAt: number): string {
  const id = visitorId.toLowerCase();
  if (!UUID_RE.test(id)) throw new Error("visitor_token: invalid visitor id");
  if (!Number.isInteger(issuedAt) || issuedAt < 0) throw new Error("visitor_token: invalid iat");
  return `v1.${id}.${issuedAt}.${signature(secret, id, issuedAt)}`;
}

/**
 * Identyfikator z tokenu - albo null dla wszystkiego, co nie jest ważnym,
 * niewygasłym tokenem podpisanym TYM sekretem. Nigdy nie rzuca: wejście
 * pochodzi z sieci, a "nie wiem" ma jedno znaczenie - nowy gość.
 */
export function verifyVisitorToken(
  secret: string | null | undefined,
  raw: string | null | undefined,
  nowSeconds: number,
): VerifiedVisitor | null {
  if (!secret || secret.length < MIN_VISITOR_SECRET_LENGTH) return null;
  if (!raw || raw.length > MAX_TOKEN_LENGTH) return null;
  const parts = raw.trim().split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [, visitorId, iatText, sig] = parts;
  if (!UUID_RE.test(visitorId) || !IAT_RE.test(iatText)) return null;
  const issuedAt = Number.parseInt(iatText, 10);
  if (!Number.isFinite(issuedAt)) return null;
  if (issuedAt > nowSeconds + CLOCK_SKEW_SECONDS) return null;
  if (nowSeconds - issuedAt > VISITOR_TOKEN_MAX_AGE_SECONDS) return null;
  const decoded = fromBase64Url(sig);
  if (!decoded || decoded.length !== SIG_BYTES) return null;
  if (!constantTimeEqual(sig, signature(secret, visitorId, issuedAt))) return null;
  return { visitorId, issuedAt };
}

/** Atrybuty cookie identyfikatora - jedno miejsce decyzji (HttpOnly zawsze). */
export function visitorCookieOptions(secure: boolean): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: VISITOR_TOKEN_MAX_AGE_SECONDS,
  };
}
