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
});
