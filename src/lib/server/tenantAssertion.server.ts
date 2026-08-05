// Podpisywanie poświadczeń hosta (server-only). Druga połowa kontraktu opisanego
// w `src/lib/http/tenantAssertion.ts`; weryfikatorem jest baza
// (`public.verify_tenant_host_assertion()`, migracja 20260805090000).
//
// Sekret (`TENANT_HOST_ASSERTION_KEY`) jest współdzielony między krawędzią i
// bazą - w bazie leży w Vault pod `kid` zarejestrowanym w
// `public.tenant_host_assertion_keys`. Ten moduł żyje w `src/lib/server/**`,
// czyli w katalogu, który import-protection Vite trzyma poza grafem klienta:
// materiał klucza nie ma fizycznej drogi do bundla przeglądarki.
//
// Brak skonfigurowanego klucza NIE jest awarią. Wszystkie funkcje zwracają
// wtedy null, żądania idą szczeblem ASSERTED, a baza degraduje w stronę
// BEZPIECZNĄ (zalogowany wołający zostaje w swoim tenancie domowym). Instalacja
// jednodomenowa działa wtedy bajt w bajt jak przed tą zmianą - patrz
// docs/WDROZENIE_IZOLACJA_TENANTA_RODO_2026-08-05.md.
import {
  DEFAULT_TENANT_ASSERTION_KID,
  formatTenantAssertion,
  tenantAssertionExpiry,
  tenantAssertionMessage,
} from "@/lib/http/tenantAssertion";
import { normalizeHost } from "@/lib/http/host";

interface AssertionKeyConfig {
  readonly kid: string;
  readonly secret: string;
}

const KID_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  const value = process.env?.[name];
  return value && value.trim() ? value.trim() : undefined;
}

/**
 * Konfiguracja klucza albo null. Sekret krótszy niż 32 znaki odrzucamy CICHO,
 * ale z ostrzeżeniem w logu: lepiej działać bez szczebla VERIFIED niż podpisywać
 * kluczem, którego HMAC nie obroni.
 */
export function tenantAssertionKey(): AssertionKeyConfig | null {
  const secret = readEnv("TENANT_HOST_ASSERTION_KEY");
  if (!secret) return null;
  if (secret.length < 32) {
    console.warn("[tenant-assert] TENANT_HOST_ASSERTION_KEY shorter than 32 chars - ignored");
    return null;
  }
  const kid = (readEnv("TENANT_HOST_ASSERTION_KID") ?? DEFAULT_TENANT_ASSERTION_KID).toLowerCase();
  if (!KID_RE.test(kid)) {
    console.warn("[tenant-assert] TENANT_HOST_ASSERTION_KID malformed - ignored");
    return null;
  }
  return { kid, secret };
}

/** Czy wdrożenie potrafi wystawiać poświadczenia (diagnostyka, testy, gate'y). */
export function tenantAssertionConfigured(): boolean {
  return tenantAssertionKey() !== null;
}

// Import klucza HMAC jest kosztowniejszy niż samo podpisanie, a klucz zmienia
// się tylko przy rotacji - trzymamy go per izolat, kluczując sekretem.
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function hmacKey(secret: string): Promise<CryptoKey> | null {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  if (cachedKey?.secret === secret) return cachedKey.key;
  const key = crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  cachedKey = { secret, key };
  return key;
}

// Poświadczenie jest deterministyczne w obrębie kroku kwantyzacji, więc pamięć
// per izolat sprowadza koszt do jednego HMAC-a na host na krok - także przy
// setkach round-tripów SSR w jednym renderze.
const tokenCache = new Map<string, { expiresAt: number; token: string }>();
const TOKEN_CACHE_LIMIT = 64;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Poświadczenie dla hosta - albo null, gdy klucza nie ma, host jest pusty lub
 * runtime nie daje Web Crypto. NIGDY nie rzuca: brak poświadczenia to poprawny
 * stan (szczebel ASSERTED), a wywalony podpis nie może zerwać renderu.
 */
export async function mintTenantHostAssertion(
  rawHost: string | null | undefined,
): Promise<string | null> {
  const host = normalizeHost(rawHost);
  if (!host) return null;
  const config = tenantAssertionKey();
  if (!config) return null;

  const now = nowSeconds();
  const cacheKey = `${config.kid}:${host}`;
  const cached = tokenCache.get(cacheKey);
  // Odświeżamy dopiero, gdy zostało mniej niż jeden krok ważności - wpis z
  // poprzedniego kroku jest wciąż w pełni użyteczny.
  if (cached && cached.expiresAt > now + 60) return cached.token;

  try {
    const key = hmacKey(config.secret);
    if (!key) return null;
    const expiresAt = tenantAssertionExpiry(now);
    const signature = await crypto.subtle.sign(
      "HMAC",
      await key,
      new TextEncoder().encode(tenantAssertionMessage(config.kid, host, expiresAt)),
    );
    const token = formatTenantAssertion(config.kid, host, expiresAt, new Uint8Array(signature));
    if (tokenCache.size >= TOKEN_CACHE_LIMIT) tokenCache.clear();
    tokenCache.set(cacheKey, { expiresAt, token });
    return token;
  } catch (e) {
    console.warn("[tenant-assert] signing failed:", e);
    return null;
  }
}

/** Hook testowy: czyści pamięć klucza i tokenów per izolat. */
export function resetTenantAssertionCache(): void {
  cachedKey = null;
  tokenCache.clear();
}
