// In-memory token-bucket rate limiter for the unauthenticated public ingest
// endpoints (RUM vitals + client-error beacons). Those endpoints cannot require
// auth - the browser delivers them via navigator.sendBeacon - so a per-IP token
// bucket is the defense against a single client flooding the telemetry tables
// and skewing the admin dashboard.
//
// The limiter is per-isolate (serverless instances do not share memory), so it
// is a mitigation, not a hard global quota; that is the right trade for
// best-effort telemetry. The pure `tickBucket` core takes an injected clock so
// the refill maths is unit-testable without timers.

export interface Bucket {
  /** Tokens currently available (fractional during refill). */
  tokens: number;
  /** Epoch ms of the last update, used to compute elapsed refill. */
  updatedAt: number;
}

export interface RateLimitOptions {
  /** Max burst: tokens a fresh key starts with and can refill back up to. */
  capacity: number;
  /** Sustained rate: tokens regained per second. */
  refillPerSec: number;
}

/**
 * Pure token-bucket step. Given the prior bucket (or undefined for a new key),
 * the current time and the limit, returns the next bucket and whether this
 * request is allowed. Never mutates its input.
 */
export function tickBucket(
  bucket: Bucket | undefined,
  now: number,
  opts: RateLimitOptions,
): { bucket: Bucket; allowed: boolean } {
  const cap = Math.max(1, opts.capacity);
  if (!bucket) {
    return { bucket: { tokens: cap - 1, updatedAt: now }, allowed: true };
  }
  const elapsedSec = Math.max(0, (now - bucket.updatedAt) / 1000);
  const refilled = Math.min(cap, bucket.tokens + elapsedSec * opts.refillPerSec);
  if (refilled >= 1) {
    return { bucket: { tokens: refilled - 1, updatedAt: now }, allowed: true };
  }
  return { bucket: { tokens: refilled, updatedAt: now }, allowed: false };
}

// Bound memory: a pathological spread of distinct keys (spoofed IPs) is flushed
// wholesale rather than allowed to grow without limit. Telemetry rate-limiting
// tolerates the occasional reset.
const MAX_KEYS = 10_000;

/** Create an isolated limiter instance with its own key store. */
export function createRateLimiter(opts: RateLimitOptions) {
  const store = new Map<string, Bucket>();
  return {
    /** Returns true if the request for `key` is allowed at time `now` (ms). */
    check(key: string, now: number): boolean {
      if (store.size > MAX_KEYS) store.clear();
      const { bucket, allowed } = tickBucket(store.get(key), now, opts);
      store.set(key, bucket);
      return allowed;
    },
  };
}

/**
 * Adres dzwoniącego na potrzeby kubełka limitu - JEDYNA definicja „kto dzwoni"
 * w tym repozytorium.
 *
 * Za Cloudflare `x-forwarded-for` jest listą, do której klient dopisuje własny
 * prefiks - Cloudflare NIE zastępuje wartości klienta, tylko dokleja adres
 * połączenia na KOŃCU. Pierwszy wpis jest więc DEKLARACJĄ KLIENTA, nie adresem,
 * a kubełek po nim kluczowany rotuje się jednym nagłówkiem. Jedynym nagłówkiem,
 * którego klient nie podrobi, jest `cf-connecting-ip` (ta sama zasada, co w
 * `rateSubject.server.ts:29-31`). Ostatni wpis XFF to zapas dla wdrożeń bez
 * Cloudflare - nadal pochodzi od proxy, nie od przeglądarki. UWAGA:
 * docs/ANALIZA_MODULOW_DOGLEBNA_2026-08-12.md:5268 twierdzi, że „na Workers to
 * w porządku" - to jest nieprawda i przez to zalecenie z :5273 leżało
 * niezrealizowane.
 *
 * Puste i białoznakowe wpisy odrzucamy na KAŻDYM kroku, bo `x-forwarded-for`
 * równy " " dawał wcześniej pusty string udający adres - a ten schodził dalej
 * jako „brak adresu" i znosił kubełek IP w całości.
 *
 * UWAGA WDROŻENIOWA (jak w `api/public/fx-rate.ts:59-62`): zmiana źródła adresu
 * zmienia KLUCZ kubełka, więc jedno okno każdego limitu rusza po wdrożeniu od
 * zera. Dotyczy `rate_limits` (auth_*_ip, content_password_ip,
 * newsletter.*, contact.submit) i wszystkich limiterów in-memory.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return chain[chain.length - 1] ?? "unknown";
}

/** Osiem grup IPv6 jako liczby albo `null`, gdy napis nie jest adresem IPv6. */
function ipv6Groups(address: string): number[] | null {
  let text = address;
  // Ogon IPv4 (`::ffff:192.0.2.1`, `64:ff9b::192.0.2.1`) to dwie ostatnie grupy.
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (tail) {
    const octets = tail.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, tail.index)}${hi}:${lo}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): string[] => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

/**
 * Klucz kubełka po adresie. IPv6 sprowadzamy do prefiksu /64: tyle dostaje
 * jedno łącze (dom, VPS), więc pojedynczy host z routowaną pulą /64 losował
 * dotąd nowy adres na każde żądanie i KAŻDE dostawało świeży kubełek - sondy
 * kodów, haseł treści i formularzy publicznych nie miały sufitu. IPv4
 * zmapowane na IPv6 (`::ffff:a.b.c.d`) to ten sam host co `a.b.c.d`.
 * Wszystko, co nie jest adresem IPv6, wraca bez zmian (IPv4, "unknown").
 */
export function ipRateKey(ip: string): string {
  const value = ip.trim().toLowerCase();
  if (!value.includes(":")) return value;
  const address = value.replace(/^\[|\]$/g, "").split("%")[0];
  const groups = ipv6Groups(address);
  if (groups === null) return value;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

/**
 * Podmiot kubełka limitu: adres dzwoniącego z JEDYNEJ definicji kolejności
 * nagłówków (`clientIpFromHeaders`), ze zwiniętym IPv6 do /64 (`ipRateKey`).
 * To jest klucz LIMITU - zapisy dowodowe (zgody, audyt podszycia) biorą pełny
 * adres z `clientIpFromHeaders`.
 *
 * Gwarancja: nigdy nie zwraca wartości pustej. Żądanie „nie wiadomo od kogo"
 * dostaje wspólny, LEGALNY kubełek "unknown" - dzieli go z resztą ruchu bez
 * rozpoznawalnego adresu, zamiast wymykać się limitowi.
 *
 * UWAGA WDROŻENIOWA: dla adresów IPv6 klucz się zmienia, więc jedno okno
 * każdego limitu po adresie rusza po wdrożeniu od zera.
 */
export function rateLimitIpSubject(headers: Headers): string {
  return ipRateKey(clientIpFromHeaders(headers));
}
