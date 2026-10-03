import { describe, it, expect } from "vitest";
import { redactPii, redactUrl, redactMeta, redactQueryPii } from "../redact";

describe("redactPii", () => {
  it("redacts email addresses", () => {
    expect(redactPii("failed for jan.kowalski@example.com while saving")).toBe(
      "failed for [redacted-email] while saving",
    );
  });

  it("redacts JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.s5-abcDEF_012";
    expect(redactPii(`token=${jwt}`)).not.toContain("eyJ");
    expect(redactPii(`bare ${jwt} here`)).toBe("bare [redacted-jwt] here");
  });

  it("redacts Bearer/Basic auth headers but keeps the scheme", () => {
    expect(redactPii("Authorization: Bearer abcdef123456ghijkl")).toBe(
      "Authorization: Bearer [redacted]",
    );
  });

  it("redacts values of sensitive query/form params, keeping the key", () => {
    expect(redactPii("?code=SUPERSECRET123&page=2")).toContain("code=[redacted]");
    expect(redactPii("password=hunter2secretpwd")).toBe("password=[redacted]");
  });

  it("redacts long opaque hex/base64 blobs", () => {
    expect(redactPii("id 0123456789abcdef0123456789abcdef")).toBe("id [redacted]");
  });

  it("passes through null/undefined and short benign text", () => {
    expect(redactPii(null)).toBeNull();
    expect(redactPii(undefined)).toBeNull();
    expect(redactPii("TypeError: x is not a function")).toBe("TypeError: x is not a function");
  });
});

// Reguła telefonu doszła w 2026-10: nagłówek `api/public/track.ts` zakładał ją od
// dawna, a numer przechodził surowy do `analytics_events.entity_id` i do GA4.
describe("redactPii - numery telefonów", () => {
  it.each([
    ["+48 600 123 456", "[redacted-phone]"],
    ["+48600123456", "[redacted-phone]"],
    ["0048 600 123 456", "[redacted-phone]"],
    ["600123456", "[redacted-phone]"],
    ["600-123-456", "[redacted-phone]"],
    ["zadzwoń 600 123 456 proszę", "zadzwoń [redacted-phone] proszę"],
    ["(22) 123-45-67", "[redacted-phone]"],
    ["22 123 45 67", "[redacted-phone]"],
    ["+44 20 7946 0958", "[redacted-phone]"],
    ["+1 (555) 123-4567", "[redacted-phone]"],
    // Kod kraju bez `+`/`00` to zwykła liczba - zostaje, numer znika.
    ["48 600 123 456", "48 [redacted-phone]"],
  ])("maskuje %s", (input, output) => {
    expect(redactPii(input)).toBe(output);
  });

  it.each([
    "2026",
    "2026-10-03 12:30:00",
    "03.10.2026 12:30",
    "3f2b9c1a-7d4e-4a11-9b0c-2e5f8a6d1c93",
    "123e4567-e89b-12d3-a456-426614174000",
    "1727950000000",
    "12 999 000 zł",
    "1 299,00 zł",
    "/posts/123-456-789-raport",
    "at https://x/assets/index-B1x2.js:1:123456",
    "NIP 123-456-78-90",
    "ISBN 978-83-123-4567-8",
    "PESEL 90010112345",
    "AW-17612160320/abCdEfGhIj",
    "COVID-19 2020-2022",
  ])("nie zjada dat, UUID, lat, cen ani identyfikatorów: %s", (s) => {
    expect(redactPii(s)).toBe(s);
  });

  it("ŚWIADOMY KOSZT: liczba 3-3-3 z separatorem tysięcy wygląda jak telefon", () => {
    // Przyjęte: odróżnienie „1 200 000 000" od „600 123 456" wymagałoby
    // kontekstu, którego wyrażenie nie ma, a moduł z założenia woli zgubić
    // wartość niż wypuścić numer. Przypięte, żeby zmiana była decyzją.
    expect(redactPii("budżet 1 200 000 000 euro")).toBe("budżet 1 [redacted-phone] euro");
  });

  it("e-mail i parametr wrażliwy wygrywają z telefonem (kolejność reguł jest nośna)", () => {
    expect(redactPii("600123456@x.pl")).toBe("[redacted-email]");
    expect(redactPii("?code=600123456")).toBe("?code=[redacted]");
    expect(redactPii("192.168.13.240")).toBe("[redacted-ip]");
  });

  it("idempotencja - znaczniki nie są ponownie dopasowywane", () => {
    const x = "jan@x.pl, tel. +48 600 123 456, eyJa.b.c";
    expect(redactPii(redactPii(x))).toBe(redactPii(x));
  });
});

// Adres dla GA4 (`page_location`, `page_path`): treść odwiedzającego znika,
// parametry kampanii zostają co do bajtu - GA4 liczy z nich atrybucję.
describe("redactQueryPii", () => {
  it.each([
    ["/search?q=jan%40example.com&tab=all", "/search?q=[redacted-email]&tab=all"],
    ["/search?q=%2B48%20600%20123%20456", "/search?q=[redacted-phone]"],
    // Kształt z `URLSearchParams` (router): spacja jako `+`, plus jako `%2B`.
    ["/search?q=%2B48+600+123+456", "/search?q=[redacted-phone]"],
    ["/search?q=600+123+456", "/search?q=[redacted-phone]"],
    // Router zapisuje napis wyglądający jak JSON w cudzysłowie: `"600123456"`.
    ["/search?q=%22600123456%22", "/search?q=%22[redacted-phone]%22"],
    ["/search?q=kontakt%20600%20123%20456%20biuro", "/search?q=kontakt%20[redacted-phone]%20biuro"],
    ["https://x.pl/auth?email=jan%40example.com", "https://x.pl/auth?email=[redacted-email]"],
    ["/search?Q=jan%40example.com", "/search?Q=[redacted-email]"],
    ["/autor/jan.kowalski@example.org", "/autor/[redacted-email]"],
    ["/autor/jan.kowalski%40example.org", "/autor/[redacted-email]"],
    ["/x?jan%40example.com", "/x?[redacted-email]"],
    // Zepsuta sekwencja obok e-maila nie wyłącza redakcji całej wartości.
    ["/search?q=jan%40example.com%E0%A4%A", "/search?q=[redacted-email]%25E0%25A4%25A"],
  ])("%s -> %s", (input, output) => {
    expect(redactQueryPii(input)).toBe(output);
  });

  it.each([
    // Parametry kampanii nietknięte; telefon nie dotyczy kluczy spoza listy
    // wolnotekstowej (`gad_campaignid` ma 9 cyfr).
    "/search?q=cee&gclid=Cj0KCQjw5cOwBhCiARIsAJ5njuZ12345678901234567890abc&gad_campaignid=987654321&utm_source=google",
    "/en/tickets/transfer/[redacted]?token=[redacted]&x=1",
    "/search?q=%E0%A4%A&x=1",
    "/search?q=polityka%20sp%C3%B3jno%C5%9Bci",
    "/search?q=polityka+sp%C3%B3jno%C5%9Bci&flag",
    // Długi slug zostaje - w odróżnieniu od `redactUrl` (reguła LONG_B64).
    "/analizy/unia-europejska-wobec-chin-strategia-de-riskingu-2026",
    "",
  ])("bez zmian: %s", (s) => {
    expect(redactQueryPii(s)).toBe(s);
  });

  it("idempotencja - drugi przebieg niczego nie zmienia", () => {
    const once = redactQueryPii("/search?q=jan%40example.com+600+123+456&utm_source=x");
    expect(once).toBe("/search?q=[redacted-email]%20[redacted-phone]&utm_source=x");
    expect(redactQueryPii(once)).toBe(once);
  });
});

describe("redactUrl", () => {
  it("keeps origin + path, drops the query string", () => {
    expect(redactUrl("https://site.example/post/hello?token=abc&code=xyz")).toBe(
      "https://site.example/post/hello?[redacted]",
    );
  });

  it("keeps a clean path untouched", () => {
    expect(redactUrl("https://site.example/blog")).toBe("https://site.example/blog");
  });

  it("handles root-relative urls", () => {
    expect(redactUrl("/search?q=jan@example.com")).toBe("/search?[redacted]");
  });

  it("redacts a fragment too", () => {
    expect(redactUrl("https://s.example/reset#access_token=eyJx.y.z")).toBe(
      "https://s.example/reset?[redacted]",
    );
  });

  it("passes through null", () => {
    expect(redactUrl(null)).toBeNull();
  });

  // Tokeny w ŚCIEŻCE mają 32 znaki - LONG_B64 (>= 40) ich nie łapie, więc
  // `redactUrl` maskuje znane segmenty sekretu wspólną regułą z analityką.
  it.each([
    [
      "https://site.example/tickets/transfer/AbCdEfGhIjKlMnOpQrStUvWxYz012345",
      "https://site.example/tickets/transfer/[redacted]",
    ],
    ["/en/certificates/ABCD-EFGH-JKMN-PQRS", "/en/certificates/[redacted]"],
    [
      "/api/public/calendar/AbCdEfGhIjKlMnOpQrStUvWxYz012345/plan.ics?x=1",
      "/api/public/calendar/[redacted]/plan.ics?[redacted]",
    ],
  ])("masks the credential segment of %s", (input, output) => {
    expect(redactUrl(input)).toBe(output);
  });

  it("falls back to text redaction for an unparseable url", () => {
    expect(redactUrl("http://[bad/tickets/x?token=abc")).toBe("http://[bad/tickets/x?[redacted]");
    expect(redactUrl("http://[bad/plain")).toBe("http://[bad/plain");
  });
});

describe("redactMeta", () => {
  it("deep-scrubs string values in nested structures", () => {
    const input = {
      boundary: "PostEditor",
      user: "admin@example.com",
      nested: { note: "token=deadbeefdeadbeefdeadbeef", count: 3 },
      tags: ["ok", "mail me at a@b.co"],
    };
    const out = redactMeta(input);
    expect(out.boundary).toBe("PostEditor");
    expect(out.user).toBe("[redacted-email]");
    expect(out.nested.note).toContain("token=[redacted]");
    expect(out.nested.count).toBe(3);
    expect(out.tags[1]).toContain("[redacted-email]");
  });

  it("POZA limitem głębokości poddrzewo NIE przechodzi surowe", () => {
    // REGRESJA. `depth > 6` oddawało resztę struktury NIETKNIĘTĄ, czyli
    // odwrotnie, niż limit sugeruje: ładunek zagnieżdżony głębiej niż siedem
    // poziomów wjeżdżał do `analytics_events` w całości - obok `anon_id`,
    // który nie wygasa. `safeMeta` w /api/public/track pilnuje tylko ROZMIARU
    // serializacji, nie zagnieżdżenia, więc ten limit był jedyną zaporą.
    const gleboko = { a: { b: { c: { d: { e: { f: { g: { mail: "jan@example.com" } } } } } } } };

    const json = JSON.stringify(redactMeta(gleboko));

    expect(json).not.toContain("jan@example.com");
    expect(json).toContain("[redacted-depth]");
  });

  it("napis NA granicy głębokości nadal jest skrubowany, a liczba zostaje", () => {
    // Znacznik zastępuje wyłącznie to, w co nie da się już wejść. Napis i tak
    // przechodzi przez `redactPii`, bo to tanie, a zachowuje tekst bez PII.
    const naGranicy = {
      a: { b: { c: { d: { e: { f: { g: "pisz na jan@example.com", n: 7 } } } } } },
    };

    const json = JSON.stringify(redactMeta(naGranicy));

    expect(json).not.toContain("jan@example.com");
    expect(json).toContain("[redacted-email]");
    expect(json).toContain("7");
  });
});
