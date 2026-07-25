// Web Push bez zależności zewnętrznych: VAPID (RFC 8292) + szyfrowanie
// aes128gcm (RFC 8291 / RFC 8188) na wbudowanym node:crypto. Pakiet npm
// `web-push` był w repo martwą zależnością (zero importów, usunięty
// 2026-07-25): protokół jest na tyle wąski, że własna implementacja
// (ECDH P-256 + HKDF-SHA256 + AES-128-GCM) jest tańsza i łatwiejsza do
// zaudytowania niż wciąganie cudzego drzewa zależności (`web-push` ciągnął
// asn1.js, http_ece, jws, minimist i https-proxy-agent).
// Test roundtrip: src/lib/notifications/__tests__/webpush.test.ts.
//
// Ścieżka gorąca to JEDEN tick crona: do 200 zadań x N urządzeń, wszystko w
// budżecie 25 s (src/lib/server/jobsTick.server.ts). Dlatego:
//   * PRK HKDF wyciągany raz na wiadomość - CEK i nonce dzielą (salt, ikm),
//     więc jest 5 HMAC-ów zamiast 6,
//   * bufory `info` i delimiter są stałymi modułu (zero alokacji per wysyłka),
//   * ciało wiadomości powstaje w JEDNEJ alokacji (nagłówek + ciphertext + tag)
//     zamiast trzech `Buffer.concat`,
//   * JWT VAPID i KeyObject są cache'owane per audience: podpis ES256 z parsem
//     JWK to ~90 us, a cała partia idzie zwykle do 1-2 usług (FCM, Mozilla),
//   * `hkdf` zostaje na dwóch HMAC-ach - `crypto.hkdfSync` jest tu ~1,9x
//     WOLNIEJSZY (Node 22, 50k iteracji: 389 ms vs 736 ms), więc "użyj
//     natywnego HKDF" to pesymalizacja, nie optymalizacja.
import {
  createCipheriv,
  createECDH,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import type { DigestLang } from "./digestEmail";

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string; // base64url, 65 bajtów (uncompressed P-256)
  auth: string; // base64url, 16 bajtów
}

export interface VapidConfig {
  publicKey: string; // base64url, 65 bajtów (uncompressed P-256)
  privateKey: string; // base64url, 32 bajty (skalar d)
  subject: string; // mailto:... lub https://...
}

/**
 * Kontrakt payloadu uzgodniony z service workerem (`public/push-sw.js`):
 * `lang` pozwala systemowi renderować powiadomienie w języku odbiorcy
 * (PL/EN), `tag` kolapsuje kolejne powiadomienia o tym samym celu w jedno.
 */
export interface PushPayload {
  title: string;
  body: string;
  href: string;
  lang: DigestLang;
  tag?: string;
}

const P256_PUBLIC_BYTES = 65;
const P256_SCALAR_BYTES = 32;
const AUTH_SECRET_BYTES = 16;
const SALT_BYTES = 16;
const GCM_TAG_BYTES = 16;
/** Nagłówek aes128gcm (RFC 8188 sek. 2.1): salt(16) | rs(4) | idlen(1) | keyid(65). */
const AES128GCM_HEADER_BYTES = SALT_BYTES + 4 + 1 + P256_PUBLIC_BYTES;
/** RFC 8030 sek. 7.2: usługa push musi przyjąć co najmniej 4096 B ciała żądania. */
const MAX_PUSH_BODY_BYTES = 4096;
/** Budżet jawnego JSON-a: 4096 - 86 (nagłówek) - 1 (delimiter) - 16 (tag) = 3993 B. */
export const MAX_PUSH_PAYLOAD_BYTES =
  MAX_PUSH_BODY_BYTES - AES128GCM_HEADER_BYTES - 1 - GCM_TAG_BYTES;
/** Pole `rs` nagłówka: jeden rekord, więc wystarczy rs >= długość rekordu. */
const RECORD_SIZE = MAX_PUSH_BODY_BYTES;
const RECORD_DELIMITER = Buffer.from([2]);
const HKDF_COUNTER = Buffer.from([1]);
const KEY_INFO_PREFIX = Buffer.from("WebPush: info\0", "ascii");
const CEK_INFO = Buffer.from("Content-Encoding: aes128gcm\0", "ascii");
const NONCE_INFO = Buffer.from("Content-Encoding: nonce\0", "ascii");
const CEK_BYTES = 16;
const NONCE_BYTES = 12;
const IKM_BYTES = 32;
/** RFC 8292 sek. 2: `exp` nie dalej niż 24 h; 12 h daje zapas na zegar usługi. */
const VAPID_TTL_SEC = 12 * 3600;
/** JWT z cache'u odświeżamy 5 min przed wygaśnięciem (zapas na wolną wysyłkę). */
const VAPID_REFRESH_MARGIN_SEC = 300;
/** Ile wpisów trzymamy w cache'ach VAPID; realnie audiences liczą się w jednostkach. */
const VAPID_CACHE_LIMIT = 64;
/** Nagłówek `Topic` (RFC 8030 sek. 5.4): maks. 32 znaki alfabetu base64url. */
const MAX_TOPIC_CHARS = 32;
const DEFAULT_TTL_SEC = 86_400;
/** Bez timeoutu jedna zawieszona usługa push zjadałaby cały budżet ticku. */
const PUSH_TIMEOUT_MS = 10_000;
const ELLIPSIS = "…";
const ELLIPSIS_BYTES = Buffer.byteLength(ELLIPSIS, "utf8");

export function b64urlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

export function b64urlEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

/** HKDF-SHA256 extract (RFC 5869 sek. 2.2): PRK = HMAC(salt, IKM). */
function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return createHmac("sha256", salt).update(ikm).digest();
}

/**
 * HKDF-SHA256 expand (RFC 5869 sek. 2.3) dla length <= 32, czyli jeden blok
 * T(1) - web push nigdy nie potrzebuje więcej (32 B IKM, 16 B CEK, 12 B nonce).
 */
function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  return createHmac("sha256", prk).update(info).update(HKDF_COUNTER).digest().subarray(0, length);
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return hkdfExpand(hkdfExtract(salt, ikm), info, length);
}

/**
 * Skalar P-256 dokładnie 32 B. `createECDH().getPrivateKey()` zwraca liczbę
 * BEZ wiodących zer, więc mniej więcej 1 na 256 kluczy ma 31 B (zmierzone:
 * 16/4000) - JWK wymaga stałej długości, inaczej klucz z .env jest odrzucany
 * jako "invalid" przy pierwszej wysyłce.
 */
function toScalar(raw: Buffer, label: string): Buffer {
  if (raw.length === P256_SCALAR_BYTES) return raw;
  if (raw.length === 0 || raw.length > P256_SCALAR_BYTES) {
    throw new Error(`webpush: invalid ${label}`);
  }
  const padded = Buffer.alloc(P256_SCALAR_BYTES);
  raw.copy(padded, P256_SCALAR_BYTES - raw.length);
  return padded;
}

function assertUncompressedP256(pub: Buffer, label: string): Buffer {
  if (pub.length !== P256_PUBLIC_BYTES || pub[0] !== 4) {
    throw new Error(`webpush: invalid ${label}`);
  }
  return pub;
}

/**
 * Szyfruje payload dla subskrybenta wg RFC 8291 (Content-Encoding: aes128gcm).
 * Zwraca gotowe body (nagłówek aes128gcm + ciphertext + tag) - bez nagłówków
 * HTTP. Efemeryczna para kluczy jest generowana per wiadomość (wymóg RFC 8291
 * sek. 3.1 - nie da się jej cache'ować bez utraty forward secrecy).
 */
export function encryptPushPayload(
  payload: Buffer,
  receiverP256dh: Buffer,
  receiverAuth: Buffer,
  // Do testów: deterministyczne klucze/salt. Produkcyjnie losowane.
  asKeyPair?: { ecdh: ReturnType<typeof createECDH> },
  saltOverride?: Buffer,
): Buffer {
  if (receiverP256dh.length !== P256_PUBLIC_BYTES || receiverP256dh[0] !== 4) {
    throw new Error("webpush: invalid p256dh key");
  }
  if (receiverAuth.length !== AUTH_SECRET_BYTES) {
    throw new Error("webpush: invalid auth secret");
  }
  if (payload.length > MAX_PUSH_PAYLOAD_BYTES) {
    throw new Error(`webpush: payload too large (${payload.length} > ${MAX_PUSH_PAYLOAD_BYTES} B)`);
  }
  if (saltOverride && saltOverride.length !== SALT_BYTES) {
    throw new Error("webpush: invalid salt");
  }

  const ecdh = asKeyPair?.ecdh ?? createECDH("prime256v1");
  if (!asKeyPair) ecdh.generateKeys();
  // 65 B uncompressed - inwariant, na którym opiera się rozmiar nagłówka (86 B)
  // i jednorazowa alokacja ciała poniżej.
  const asPublic = assertUncompressedP256(ecdh.getPublicKey(), "server public key");
  const sharedSecret = ecdh.computeSecret(receiverP256dh);

  // IKM = HKDF(auth, ecdh_secret, "WebPush: info" || ua_public || as_public)
  const keyInfo = Buffer.concat([KEY_INFO_PREFIX, receiverP256dh, asPublic]);
  const ikm = hkdf(receiverAuth, sharedSecret, keyInfo, IKM_BYTES);

  // CEK i nonce mają tę samą sól i IKM, więc PRK wyciągamy raz.
  const salt = saltOverride ?? randomBytes(SALT_BYTES);
  const prk = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk, CEK_INFO, CEK_BYTES);
  const nonce = hkdfExpand(prk, NONCE_INFO, NONCE_BYTES);

  // Jedna alokacja na całość: AES-GCM nie zmienia długości, więc rozmiar ciała
  // znamy z góry (nagłówek + payload + delimiter 0x02 + tag).
  const body = Buffer.allocUnsafe(
    AES128GCM_HEADER_BYTES + payload.length + RECORD_DELIMITER.length + GCM_TAG_BYTES,
  );
  salt.copy(body, 0);
  body.writeUInt32BE(RECORD_SIZE, SALT_BYTES);
  body.writeUInt8(P256_PUBLIC_BYTES, SALT_BYTES + 4);
  asPublic.copy(body, SALT_BYTES + 5);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  let at = AES128GCM_HEADER_BYTES;
  at += cipher.update(payload).copy(body, at);
  at += cipher.update(RECORD_DELIMITER).copy(body, at); // RFC 8188: ostatni rekord
  at += cipher.final().copy(body, at);
  at += cipher.getAuthTag().copy(body, at);
  if (at !== body.length) {
    throw new Error("webpush: ciphertext length mismatch");
  }
  return body;
}

/** Serializuje payload do bajtów wysyłanych po zaszyfrowaniu. */
export function encodePushPayload(payload: PushPayload): Buffer {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

/**
 * Ucina tekst do `maxBytes` w UTF-8 bez rozcinania znaku - polskie diakrytyki
 * i emoji zajmują 2-4 bajty, a rozcięty punkt kodowy dałby "" w powiadomieniu.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  // Cofnij się z bajtu kontynuacji (10xxxxxx) na najbliższy bajt wiodący.
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString("utf8");
}

/**
 * Dopasowuje payload do budżetu 3993 B: najpierw skraca treść, potem tytuł.
 * Bez tego długie powiadomienie (cytat komentarza, zajawka analizy) dostaje od
 * usługi push 413 i osiem bezowocnych retry z kolejki - a odbiorca nic.
 */
export function clampPushPayload(payload: PushPayload): PushPayload {
  const overflow = (candidate: PushPayload): number =>
    encodePushPayload(candidate).length - MAX_PUSH_PAYLOAD_BYTES;

  let out = payload;
  let over = overflow(out);
  if (over <= 0) return out;

  if (out.body.length > 0) {
    const target = Buffer.byteLength(out.body, "utf8") - over - ELLIPSIS_BYTES;
    const clipped = truncateUtf8(out.body, target);
    out = { ...out, body: clipped.length > 0 ? `${clipped}${ELLIPSIS}` : "" };
    over = overflow(out);
    if (over <= 0) return out;
  }

  // Ostatnia linia obrony: patologicznie długi tytuł (albo sam href poza
  // budżetem - wtedy sendWebPush odrzuci wiadomość jako trwały błąd).
  const target = Buffer.byteLength(out.title, "utf8") - over - ELLIPSIS_BYTES;
  const clipped = truncateUtf8(out.title, target);
  return { ...out, title: clipped.length > 0 ? `${clipped}${ELLIPSIS}` : "" };
}

/**
 * Temat RFC 8030 sek. 5.4 (<= 32 znaki base64url) z dowolnych części. Skrót
 * SHA-256 zamiast surowej ścieżki, bo `Topic` leci jawnym nagłówkiem HTTP do
 * usługi push - href zdradzałby, co odbiorca czyta.
 */
export function pushTopic(...parts: readonly string[]): string {
  const digest = createHash("sha256").update(parts.join(" "), "utf8").digest();
  return b64urlEncode(digest).slice(0, MAX_TOPIC_CHARS);
}

interface CachedJwt {
  jwt: string;
  expiresAt: number;
}

// Cache per isolate: KeyObject (parsowanie JWK ~27 us) i podpisany JWT
// (~38 us za podpis ES256). Partia zadań idzie zwykle do 1-2 usług push, więc
// bez cache'u ten sam token byłby podpisywany setki razy na tick.
const vapidKeyCache = new Map<string, KeyObject>();
const vapidJwtCache = new Map<string, CachedJwt>();

/** Wstawka z twardym limitem: najstarszy wpis wypada (Map trzyma kolejność). */
function cachePut<K, V>(cache: Map<K, V>, key: K, value: V): V {
  if (cache.size >= VAPID_CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
  return value;
}

/** Test hook: czyści cache'e VAPID (podpis ES256 jest losowy, więc widoczne). */
export function resetVapidCaches(): void {
  vapidKeyCache.clear();
  vapidJwtCache.clear();
}

/** Klucz prywatny VAPID (skalar d, 32 B) jako KeyObject - przez JWK do PKCS8. */
function vapidPrivateKey(vapid: VapidConfig): KeyObject {
  const cacheKey = `${vapid.publicKey}.${vapid.privateKey}`;
  const cached = vapidKeyCache.get(cacheKey);
  if (cached) return cached;

  const d = toScalar(b64urlDecode(vapid.privateKey), "VAPID keys");
  const pub = assertUncompressedP256(b64urlDecode(vapid.publicKey), "VAPID keys");
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: b64urlEncode(d),
      x: b64urlEncode(pub.subarray(1, 33)),
      y: b64urlEncode(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
  return cachePut(vapidKeyCache, cacheKey, key);
}

/**
 * JWT ES256 dla VAPID: { aud, exp, sub } podpisany kluczem prywatnym VAPID.
 * Token jest ważny 12 h i zależy WYŁĄCZNIE od audience (origin usługi push),
 * więc jedna partia wysyłek reużywa go z cache'u zamiast podpisywać per
 * urządzenie.
 */
export function buildVapidJwt(endpointOrigin: string, vapid: VapidConfig, nowSec: number): string {
  const cacheKey = `${vapid.publicKey}|${vapid.subject}|${endpointOrigin}`;
  const cached = vapidJwtCache.get(cacheKey);
  if (cached && cached.expiresAt - VAPID_REFRESH_MARGIN_SEC > nowSec) return cached.jwt;

  const exp = nowSec + VAPID_TTL_SEC;
  const header = b64urlEncode(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64urlEncode(
    Buffer.from(JSON.stringify({ aud: endpointOrigin, exp, sub: vapid.subject })),
  );
  const signingInput = `${header}.${body}`;

  const signature = cryptoSign(null, Buffer.from(signingInput), {
    key: vapidPrivateKey(vapid),
    dsaEncoding: "ieee-p1363", // JOSE: surowe r||s, nie DER
  });
  const jwt = `${signingInput}.${b64urlEncode(signature)}`;
  cachePut(vapidJwtCache, cacheKey, { jwt, expiresAt: exp });
  return jwt;
}

export interface PushSendOptions {
  /**
   * Temat RFC 8030 sek. 5.4: nowa wiadomość ZASTĘPUJE niedoręczoną o tym samym
   * temacie. Telefon po dniu offline budzi się jednym powiadomieniem na wątek,
   * a nie serią duplikatów.
   */
  topic?: string;
  ttlSec?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
}

export interface PushSendResult {
  ok: boolean;
  /** 404/410 = subskrypcja martwa na zawsze - do oznaczenia failed_at. */
  gone: boolean;
  /** Żądanie nigdy nie przejdzie (400/413) - zadanie do dead-letter bez retry. */
  permanent: boolean;
  status: number;
  /** `Retry-After` z 429/503 w sekundach - do logu i backoffu wyżej. */
  retryAfterSec: number | null;
}

/** `Retry-After` bywa liczbą sekund albo datą HTTP (RFC 9110 sek. 10.2.3). */
function parseRetryAfter(header: string | null, nowMs: number): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds);
  const at = Date.parse(header);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((at - nowMs) / 1000));
}

/**
 * Wysyła jedno powiadomienie push (fetch bezpośrednio do usługi push
 * przeglądarki). TTL 24 h, urgency normal, twardy timeout 10 s.
 * `payload` może być gotowym buforem - dispatcher serializuje jeden raz na
 * zadanie i reużywa go dla wszystkich urządzeń odbiorcy.
 */
export async function sendWebPush(
  sub: PushSubscriptionKeys,
  payload: PushPayload | Buffer,
  vapid: VapidConfig,
  options: PushSendOptions = {},
): Promise<PushSendResult> {
  const plaintext = Buffer.isBuffer(payload) ? payload : encodePushPayload(payload);
  // Tanie odsianie przed DNS-em i krypto: usługa push i tak odpowie 413.
  if (plaintext.length > MAX_PUSH_PAYLOAD_BYTES) {
    console.error(
      `[community] push payload ${plaintext.length} B > ${MAX_PUSH_PAYLOAD_BYTES} B - dropped`,
    );
    return { ok: false, gone: false, permanent: true, status: 413, retryAfterSec: null };
  }

  // SSRF guard: refuse to POST to a user-controlled endpoint unless it is
  // https + resolves to a public IP (rejects localhost, private ranges, cloud
  // metadata, .internal / .local suffixes). Fail-closed: on any refusal we
  // report the subscription as gone so the dispatcher stops retrying it.
  const { assertPublicHttpUrl, BlockedUrlError } = await import("@/lib/http/egressGuard.server");
  let endpoint: URL;
  try {
    endpoint = await assertPublicHttpUrl(sub.endpoint);
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      // Błąd na poziomie URZĄDZENIA (nie payloadu): pozostałe urządzenia
      // odbiorcy mogą dostać to powiadomienie, więc `permanent` zostaje false.
      return { ok: false, gone: true, permanent: false, status: 0, retryAfterSec: null };
    }
    throw err;
  }

  const body = encryptPushPayload(plaintext, b64urlDecode(sub.p256dh), b64urlDecode(sub.auth));
  const jwt = buildVapidJwt(endpoint.origin, vapid, Math.floor(Date.now() / 1000));

  const headers: Record<string, string> = {
    Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(options.ttlSec ?? DEFAULT_TTL_SEC),
    Urgency: options.urgency ?? "normal",
  };
  if (options.topic) headers.Topic = options.topic.slice(0, MAX_TOPIC_CHARS);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const res = await fetch(sub.endpoint, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers,
      body: new Uint8Array(body),
    });

    // Treść odpowiedzi jest nieistotna, ale strumień trzeba domknąć, żeby
    // połączenie wróciło do puli keep-alive (partia idzie do tego samego hosta).
    await res.body?.cancel().catch(() => undefined);

    return {
      ok: res.status >= 200 && res.status < 300,
      gone: res.status === 404 || res.status === 410,
      permanent: res.status === 400 || res.status === 413,
      status: res.status,
      retryAfterSec: parseRetryAfter(res.headers.get("retry-after"), Date.now()),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Konfiguracja VAPID z env; null gdy niekompletna (push wyłączony). */
export function vapidFromEnv(): VapidConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:marketing@neweuropeanstrategies.com";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

/**
 * Pomocnik deweloperski: para kluczy VAPID (base64url) do .env.
 * Używany przez testy; można też odpalić ręcznie w bun repl.
 */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: b64urlEncode(ecdh.getPublicKey()),
    // Dopełnienie do 32 B: bez niego co 256. klucz wychodzi 31-bajtowy i jest
    // odrzucany dopiero przy pierwszej wysyłce, długo po zapisie do .env.
    privateKey: b64urlEncode(toScalar(ecdh.getPrivateKey(), "generated private key")),
  };
}

/** Weryfikacja JWT w testach - upewnia się, że podpis ES256 jest poprawny. */
export function verifyVapidJwtSignature(jwt: string, publicKey: string): boolean {
  const [h, b, s] = jwt.split(".");
  if (!h || !b || !s) return false;
  const pub = assertUncompressedP256(b64urlDecode(publicKey), "VAPID public key");
  const key = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: b64urlEncode(pub.subarray(1, 33)),
      y: b64urlEncode(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
  return cryptoVerify(
    null,
    Buffer.from(`${h}.${b}`),
    { key, dsaEncoding: "ieee-p1363" },
    b64urlDecode(s),
  );
}
