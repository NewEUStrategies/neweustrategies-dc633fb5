// Roundtrip RFC 8291: szyfrujemy jak serwer, odszyfrowujemy jak przeglądarka
// (niezależna implementacja odbiorcy poniżej). Do tego weryfikacja podpisu
// ES256 JWT-a VAPID i format nagłówka aes128gcm.
import { describe, expect, it } from "vitest";
import { createECDH, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import {
  b64urlDecode,
  b64urlEncode,
  buildVapidJwt,
  encryptPushPayload,
  generateVapidKeys,
  verifyVapidJwtSignature,
} from "../webpush.server";

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  const t = createHmac("sha256", prk).update(info).update(Buffer.from([1])).digest();
  return t.subarray(0, length);
}

/** Odbiorca wg RFC 8291 - celowo niezależny od implementacji serwera. */
function decryptAsBrowser(body: Buffer, ua: ReturnType<typeof createECDH>, auth: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  expect(idlen).toBe(65);
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);

  const uaPublic = ua.getPublicKey();
  const sharedSecret = ua.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "ascii"), uaPublic, asPublic]);
  const ikm = hkdf(auth, sharedSecret, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0", "ascii"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0", "ascii"), 12);

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(tag);
  const record = Buffer.concat([decipher.update(data), decipher.final()]);
  // Delimiter ostatniego rekordu: 0x02.
  expect(record[record.length - 1]).toBe(2);
  return record.subarray(0, record.length - 1);
}

describe("webpush aes128gcm", () => {
  it("payload przechodzi roundtrip serwer -> przeglądarka", () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = randomBytes(16);
    const payload = Buffer.from(
      JSON.stringify({ title: "Zażółć gęślą jaźń", href: "/events/x" }),
      "utf8",
    );

    const body = encryptPushPayload(payload, ua.getPublicKey(), auth);
    const decrypted = decryptAsBrowser(body, ua, auth);

    expect(decrypted.toString("utf8")).toBe(payload.toString("utf8"));
  });

  it("każde szyfrowanie ma świeży salt/klucz (brak determinizmu)", () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = randomBytes(16);
    const payload = Buffer.from("x");
    const a = encryptPushPayload(payload, ua.getPublicKey(), auth);
    const b = encryptPushPayload(payload, ua.getPublicKey(), auth);
    expect(a.equals(b)).toBe(false);
  });

  it("odrzuca zdeformowane klucze subskrypcji", () => {
    expect(() => encryptPushPayload(Buffer.from("x"), Buffer.alloc(64), Buffer.alloc(16))).toThrow(
      /p256dh/,
    );
    expect(() =>
      encryptPushPayload(Buffer.from("x"), Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]), Buffer.alloc(8)),
    ).toThrow(/auth/);
  });
});

describe("VAPID JWT", () => {
  it("podpis ES256 weryfikuje się kluczem publicznym", () => {
    const keys = generateVapidKeys();
    const jwt = buildVapidJwt(
      "https://fcm.googleapis.com",
      { ...keys, subject: "mailto:test@example.com" },
      1_700_000_000,
    );
    expect(verifyVapidJwtSignature(jwt, keys.publicKey)).toBe(true);

    const [, payload] = jwt.split(".");
    const claims = JSON.parse(b64urlDecode(payload).toString("utf8")) as Record<string, unknown>;
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:test@example.com");
    expect(claims.exp).toBe(1_700_000_000 + 12 * 3600);
  });

  it("obcy klucz nie weryfikuje podpisu", () => {
    const a = generateVapidKeys();
    const b = generateVapidKeys();
    const jwt = buildVapidJwt("https://updates.push.services.mozilla.com", {
      ...a,
      subject: "mailto:test@example.com",
    }, 1_700_000_000);
    expect(verifyVapidJwtSignature(jwt, b.publicKey)).toBe(false);
  });

  it("base64url koduje bez paddingu i odwracalnie", () => {
    const buf = randomBytes(33);
    const enc = b64urlEncode(buf);
    expect(enc).not.toMatch(/[+/=]/);
    expect(b64urlDecode(enc).equals(buf)).toBe(true);
  });
});
