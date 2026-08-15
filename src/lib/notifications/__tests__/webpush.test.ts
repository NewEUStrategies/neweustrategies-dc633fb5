// Roundtrip RFC 8291: szyfrujemy jak serwer, odszyfrowujemy jak przeglądarka
// (niezależna implementacja odbiorcy poniżej). Do tego weryfikacja podpisu
// ES256 JWT-a VAPID, cache tokenów per audience, format nagłówka aes128gcm
// i budżet 4096 B usługi push.
import { beforeEach, describe, expect, it } from "vitest";
import { createECDH, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import {
  b64urlDecode,
  b64urlEncode,
  buildVapidJwt,
  clampPushPayload,
  encodePushPayload,
  encryptPushPayload,
  generateVapidKeys,
  pushTopic,
  resetVapidCaches,
  truncateUtf8,
  verifyVapidJwtSignature,
  MAX_PUSH_PAYLOAD_BYTES,
  type PushPayload,
} from "../webpush.server";

/** Nagłówek aes128gcm: salt(16) | rs(4) | idlen(1) | keyid(65). */
const HEADER_BYTES = 86;
/** RFC 8030 sek. 7.2 - usługa push musi przyjąć tyle ciała żądania. */
const MAX_BODY_BYTES = 4096;

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  const t = createHmac("sha256", prk)
    .update(info)
    .update(Buffer.from([1]))
    .digest();
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

function subscriber(): { ua: ReturnType<typeof createECDH>; auth: Buffer } {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  return { ua, auth: randomBytes(16) };
}

describe("webpush aes128gcm", () => {
  it("payload przechodzi roundtrip serwer -> przeglądarka", () => {
    const { ua, auth } = subscriber();
    const payload = Buffer.from(
      JSON.stringify({ title: "Zażółć gęślą jaźń", href: "/events/x" }),
      "utf8",
    );

    const body = encryptPushPayload(payload, ua.getPublicKey(), auth);
    const decrypted = decryptAsBrowser(body, ua, auth);

    expect(decrypted.toString("utf8")).toBe(payload.toString("utf8"));
  });

  it("każde szyfrowanie ma świeży salt/klucz (brak determinizmu)", () => {
    const { ua, auth } = subscriber();
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
      encryptPushPayload(
        Buffer.from("x"),
        Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]),
        Buffer.alloc(8),
      ),
    ).toThrow(/auth/);
  });

  it("ciało ma dokładnie nagłówek + payload + delimiter + tag, a rs >= rekord", () => {
    const { ua, auth } = subscriber();
    const payload = Buffer.from("dokładna długość");

    const body = encryptPushPayload(payload, ua.getPublicKey(), auth);

    expect(body.length).toBe(HEADER_BYTES + payload.length + 1 + 16);
    const recordSize = body.readUInt32BE(16);
    const recordLength = body.length - HEADER_BYTES;
    expect(recordSize).toBeGreaterThanOrEqual(recordLength);
    // RFC 8188 sek. 2: rs poniżej 18 jest niedozwolone.
    expect(recordSize).toBeGreaterThanOrEqual(18);
    expect(body.subarray(21, 86)[0]).toBe(4); // keyid = klucz uncompressed
  });

  it("payload na granicy budżetu przechodzi, a ciało mieści się w 4096 B", () => {
    const { ua, auth } = subscriber();
    const payload = Buffer.alloc(MAX_PUSH_PAYLOAD_BYTES, 0x61);

    const body = encryptPushPayload(payload, ua.getPublicKey(), auth);

    expect(body.length).toBe(MAX_BODY_BYTES);
    expect(decryptAsBrowser(body, ua, auth).equals(payload)).toBe(true);
  });

  it("payload ponad budżet jest odrzucany zanim poleci do usługi push", () => {
    const { ua, auth } = subscriber();
    const tooBig = Buffer.alloc(MAX_PUSH_PAYLOAD_BYTES + 1, 0x61);

    expect(() => encryptPushPayload(tooBig, ua.getPublicKey(), auth)).toThrow(/payload too large/);
  });

  it("odrzuca sól o złej długości (nagłówek ma stałe 16 B)", () => {
    const { ua, auth } = subscriber();
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();

    expect(() =>
      encryptPushPayload(Buffer.from("x"), ua.getPublicKey(), auth, { ecdh }, Buffer.alloc(8)),
    ).toThrow(/salt/);
  });
});

describe("budżet payloadu push", () => {
  const base: PushPayload = { title: "Tytuł", body: "Treść", href: "/posts/x", lang: "pl" };

  it("zostawia payload w budżecie bez zmian", () => {
    expect(clampPushPayload(base)).toEqual(base);
  });

  it("skraca najpierw treść i mieści się w budżecie", () => {
    const clamped = clampPushPayload({ ...base, body: "ą".repeat(4000) });

    expect(encodePushPayload(clamped).length).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    expect(clamped.title).toBe(base.title);
    expect(clamped.body.endsWith("…")).toBe(true);
    expect(clamped.body.includes("�")).toBe(false); // brak rozciętego znaku
  });

  it("gdy sam tytuł nie mieści się w budżecie, skraca też tytuł", () => {
    const clamped = clampPushPayload({ ...base, title: "x".repeat(5000), body: "y".repeat(5000) });

    expect(encodePushPayload(clamped).length).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    expect(clamped.body).toBe("");
    expect(clamped.title.length).toBeLessThan(5000);
  });

  it("truncateUtf8 nie rozcina wielobajtowych znaków", () => {
    // "ż" to 2 bajty - limit 3 B mieści jeden znak, nie półtora.
    expect(truncateUtf8("żżż", 3)).toBe("ż");
    expect(truncateUtf8("żżż", 4)).toBe("żż");
    expect(truncateUtf8("abc", 10)).toBe("abc");
    expect(truncateUtf8("abc", 0)).toBe("");
  });
});

describe("temat kolapsu (RFC 8030)", () => {
  it("jest stabilny, mieści się w 32 znakach base64url i nie zdradza ścieżki", () => {
    const topic = pushTopic("message", "/messages/conv-42");

    expect(topic).toBe(pushTopic("message", "/messages/conv-42"));
    expect(topic).toHaveLength(32);
    expect(topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(topic).not.toContain("messages");
  });

  it("różne cele dają różne tematy", () => {
    expect(pushTopic("message", "/a")).not.toBe(pushTopic("message", "/b"));
    expect(pushTopic("comment", "/a")).not.toBe(pushTopic("message", "/a"));
  });
});

describe("VAPID JWT", () => {
  beforeEach(() => {
    resetVapidCaches();
  });

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
    const jwt = buildVapidJwt(
      "https://updates.push.services.mozilla.com",
      {
        ...a,
        subject: "mailto:test@example.com",
      },
      1_700_000_000,
    );
    expect(verifyVapidJwtSignature(jwt, b.publicKey)).toBe(false);
  });

  it("base64url koduje bez paddingu i odwracalnie", () => {
    const buf = randomBytes(33);
    const enc = b64urlEncode(buf);
    expect(enc).not.toMatch(/[+/=]/);
    expect(b64urlDecode(enc).equals(buf)).toBe(true);
  });

  it("token jest reużywany per audience, a nie podpisywany per wysyłka", () => {
    const vapid = { ...generateVapidKeys(), subject: "mailto:test@example.com" };
    const now = 1_700_000_000;

    const first = buildVapidJwt("https://fcm.googleapis.com", vapid, now);
    const second = buildVapidJwt("https://fcm.googleapis.com", vapid, now + 60);
    const other = buildVapidJwt("https://updates.push.services.mozilla.com", vapid, now);

    // ECDSA jest losowe - identyczny token dowodzi trafienia w cache.
    expect(second).toBe(first);
    expect(other).not.toBe(first);
    expect(verifyVapidJwtSignature(other, vapid.publicKey)).toBe(true);
  });

  it("token wygasający jest podpisywany na nowo (świeży exp)", () => {
    const vapid = { ...generateVapidKeys(), subject: "mailto:test@example.com" };
    const now = 1_700_000_000;
    const ttl = 12 * 3600;

    const first = buildVapidJwt("https://fcm.googleapis.com", vapid, now);
    // Wewnątrz marginesu odświeżania (5 min przed exp) token musi się zmienić.
    const refreshed = buildVapidJwt("https://fcm.googleapis.com", vapid, now + ttl - 60);

    expect(refreshed).not.toBe(first);
    const claims = JSON.parse(b64urlDecode(refreshed.split(".")[1]).toString("utf8")) as Record<
      string,
      unknown
    >;
    expect(claims.exp).toBe(now + ttl - 60 + ttl);
    expect(verifyVapidJwtSignature(refreshed, vapid.publicKey)).toBe(true);
  });

  it("cache rozdziela klucze - inna para VAPID daje inny token", () => {
    const a = { ...generateVapidKeys(), subject: "mailto:a@example.com" };
    const b = { ...generateVapidKeys(), subject: "mailto:a@example.com" };

    const jwtA = buildVapidJwt("https://fcm.googleapis.com", a, 1_700_000_000);
    const jwtB = buildVapidJwt("https://fcm.googleapis.com", b, 1_700_000_000);

    expect(jwtB).not.toBe(jwtA);
    expect(verifyVapidJwtSignature(jwtB, b.publicKey)).toBe(true);
    expect(verifyVapidJwtSignature(jwtB, a.publicKey)).toBe(false);
  });

  it("generowany klucz prywatny ma zawsze 32 bajty (dopełnienie wiodących zer)", () => {
    // Node zwraca skalar bez wiodących zer: ok. 1 na 256 kluczy ma 31 B i bez
    // dopełnienia wywracał pierwszą wysyłkę na "invalid VAPID keys".
    for (let i = 0; i < 256; i += 1) {
      expect(b64urlDecode(generateVapidKeys().privateKey)).toHaveLength(32);
    }
  });

  it("podpisuje kluczem z wiodącym zerem, który Node skraca do 31 bajtów", () => {
    // Deterministyczna rekonstrukcja tego 1-na-256 przypadku: skalar z bajtem
    // 0x00 na początku. Taki klucz siedzi już w .env wdrożeń zrobionych starym
    // generatorem, więc musi działać bez rotacji.
    const ecdh = createECDH("prime256v1");
    const scalar = Buffer.alloc(32);
    randomBytes(31).copy(scalar, 1);
    scalar[31] |= 0x01; // skalar != 0
    // DOKŁADNIE jeden bajt zerowy na początku. Bez tego test był flakiem
    // 1-na-256: gdy wylosowany `scalar[1]` też wyszedł 0x00, Node ścinał DWA
    // bajty i klucz miał 30, a nie 31 - asercja padała, choć kod był w porządku.
    scalar[1] |= 0x01;
    ecdh.setPrivateKey(scalar);
    expect(ecdh.getPrivateKey()).toHaveLength(31);

    const vapid = {
      publicKey: b64urlEncode(ecdh.getPublicKey()),
      privateKey: b64urlEncode(ecdh.getPrivateKey()),
      subject: "mailto:test@example.com",
    };
    const jwt = buildVapidJwt("https://fcm.googleapis.com", vapid, 1_700_000_000);

    expect(verifyVapidJwtSignature(jwt, vapid.publicKey)).toBe(true);
  });

  it("odrzuca klucze o niepoprawnym formacie", () => {
    const keys = generateVapidKeys();
    expect(() =>
      buildVapidJwt(
        "https://fcm.googleapis.com",
        { ...keys, privateKey: b64urlEncode(randomBytes(48)), subject: "mailto:x@example.com" },
        1,
      ),
    ).toThrow(/VAPID keys/);
    expect(() =>
      buildVapidJwt(
        "https://fcm.googleapis.com",
        { ...keys, publicKey: b64urlEncode(randomBytes(64)), subject: "mailto:x@example.com" },
        1,
      ),
    ).toThrow(/VAPID keys/);
  });
});
