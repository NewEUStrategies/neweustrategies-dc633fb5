import { describe, it, expect } from "vitest";
import { redactPii, redactUrl, redactMeta } from "../redact";

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
