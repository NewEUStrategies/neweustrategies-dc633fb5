// Web Push bez zależności zewnętrznych: VAPID (RFC 8292) + szyfrowanie
// aes128gcm (RFC 8291 / RFC 8188) na wbudowanym node:crypto. Pakiet `web-push`
// nie jest dostępny w lustrze npm sandboksa, a protokół jest na tyle wąski,
// że własna implementacja (ECDH P-256 + HKDF-SHA256 + AES-128-GCM) jest
// bezpieczniejsza niż vendorowanie cudzego kodu. Test roundtrip:
// src/lib/notifications/__tests__/webpush.test.ts.
import {
  createECDH,
  createHmac,
  createCipheriv,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";

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

export function b64urlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

export function b64urlEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

/** HKDF-SHA256 (RFC 5869) - extract + expand w jednym kroku. */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  const t = createHmac("sha256", prk)
    .update(info)
    .update(Buffer.from([1]))
    .digest();
  return t.subarray(0, length);
}

/**
 * Szyfruje payload dla subskrybenta wg RFC 8291 (Content-Encoding: aes128gcm).
 * Zwraca gotowe body (nagłówek aes128gcm + ciphertext) - bez nagłówków HTTP.
 */
export function encryptPushPayload(
  payload: Buffer,
  receiverP256dh: Buffer,
  receiverAuth: Buffer,
  // Do testów: deterministyczne klucze/salt. Produkcyjnie losowane.
  asKeyPair?: { ecdh: ReturnType<typeof createECDH> },
  saltOverride?: Buffer,
): Buffer {
  if (receiverP256dh.length !== 65 || receiverP256dh[0] !== 4) {
    throw new Error("webpush: invalid p256dh key");
  }
  if (receiverAuth.length !== 16) {
    throw new Error("webpush: invalid auth secret");
  }

  const ecdh = asKeyPair?.ecdh ?? createECDH("prime256v1");
  if (!asKeyPair) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(); // 65 B uncompressed
  const sharedSecret = ecdh.computeSecret(receiverP256dh);

  // IKM = HKDF(auth, ecdh_secret, "WebPush: info" || ua_public || as_public)
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "ascii"),
    receiverP256dh,
    asPublic,
  ]);
  const ikm = hkdf(receiverAuth, sharedSecret, keyInfo, 32);

  const salt = saltOverride ?? randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0", "ascii"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0", "ascii"), 12);

  // RFC 8188: pojedynczy rekord, delimiter 0x02 na końcu payloadu.
  const record = Buffer.concat([payload, Buffer.from([2])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  // Nagłówek aes128gcm: salt(16) | rs(4) | idlen(1) | keyid(as_public 65)
  const header = Buffer.alloc(16 + 4 + 1 + asPublic.length);
  salt.copy(header, 0);
  header.writeUInt32BE(ciphertext.length + 16 + 65 + 21, 16); // rs >= len; jeden rekord
  header.writeUInt8(asPublic.length, 20);
  asPublic.copy(header, 21);

  return Buffer.concat([header, ciphertext]);
}

/** JWT ES256 dla VAPID: { aud, exp, sub } podpisany kluczem prywatnym VAPID. */
export function buildVapidJwt(endpointOrigin: string, vapid: VapidConfig, nowSec: number): string {
  const header = b64urlEncode(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64urlEncode(
    Buffer.from(
      JSON.stringify({
        aud: endpointOrigin,
        exp: nowSec + 12 * 3600,
        sub: vapid.subject,
      }),
    ),
  );
  const signingInput = `${header}.${body}`;

  // Klucz prywatny (skalar d, 32 B) -> PKCS8 przez JWK.
  const d = b64urlDecode(vapid.privateKey);
  const pub = b64urlDecode(vapid.publicKey);
  if (d.length !== 32 || pub.length !== 65 || pub[0] !== 4) {
    throw new Error("webpush: invalid VAPID keys");
  }
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

  const signature = cryptoSign(null, Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363", // JOSE: surowe r||s, nie DER
  });
  return `${signingInput}.${b64urlEncode(signature)}`;
}

export interface PushSendResult {
  ok: boolean;
  /** 404/410 = subskrypcja martwa na zawsze - do oznaczenia failed_at. */
  gone: boolean;
  status: number;
}

/**
 * Wysyła jedno powiadomienie push (fetch bezpośrednio do usługi push
 * przeglądarki). TTL 24 h, urgency normal.
 */
export async function sendWebPush(
  sub: PushSubscriptionKeys,
  payload: Record<string, unknown>,
  vapid: VapidConfig,
): Promise<PushSendResult> {
  const endpoint = new URL(sub.endpoint);
  const body = encryptPushPayload(
    Buffer.from(JSON.stringify(payload), "utf8"),
    b64urlDecode(sub.p256dh),
    b64urlDecode(sub.auth),
  );
  const jwt = buildVapidJwt(endpoint.origin, vapid, Math.floor(Date.now() / 1000));

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "normal",
    },
    body: new Uint8Array(body),
  });
  // Treść odpowiedzi nie jest potrzebna; niektóre usługi wysyłają puste 201.
  await res.arrayBuffer().catch(() => undefined);

  return {
    ok: res.status >= 200 && res.status < 300,
    gone: res.status === 404 || res.status === 410,
    status: res.status,
  };
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
    privateKey: b64urlEncode(ecdh.getPrivateKey()),
  };
}

/** Weryfikacja JWT w testach - upewnia się, że podpis ES256 jest poprawny. */
export function verifyVapidJwtSignature(jwt: string, publicKey: string): boolean {
  const [h, b, s] = jwt.split(".");
  if (!h || !b || !s) return false;
  const pub = b64urlDecode(publicKey);
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
