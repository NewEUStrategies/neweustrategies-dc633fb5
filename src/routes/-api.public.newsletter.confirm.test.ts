import { describe, it, expect } from "vitest";
import {
  isValidConfirmToken,
  resolveConfirmOutcome,
  wantsHtml,
} from "./api.public.newsletter.confirm";

describe("newsletter confirm token validation", () => {
  it("accepts valid lowercase-hex tokens", () => {
    expect(isValidConfirmToken("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isValidConfirmToken("a".repeat(32))).toBe(true);
  });

  it("rejects null and empty", () => {
    expect(isValidConfirmToken(null)).toBe(false);
    expect(isValidConfirmToken("")).toBe(false);
  });

  it("enforces the 16..128 length bounds", () => {
    expect(isValidConfirmToken("a".repeat(15))).toBe(false);
    expect(isValidConfirmToken("a".repeat(16))).toBe(true);
    expect(isValidConfirmToken("a".repeat(128))).toBe(true);
    expect(isValidConfirmToken("a".repeat(129))).toBe(false);
  });

  it("rejects non-hex characters (injection-safety)", () => {
    expect(isValidConfirmToken("g".repeat(32))).toBe(false);
    expect(isValidConfirmToken("abcdef0123456789' OR 1=1 --")).toBe(false);
    expect(isValidConfirmToken("../../etc/passwd0000")).toBe(false);
  });
});

describe("resolveConfirmOutcome (idempotent double opt-in)", () => {
  const now = new Date("2026-07-03T12:00:00Z");
  const row = (status: string, expiresAt: string | null) => ({
    id: "sub-1",
    status,
    confirmation_expires_at: expiresAt,
  });

  it("confirms a pending subscriber with a live token", () => {
    expect(resolveConfirmOutcome(row("pending", "2026-07-05T00:00:00Z"), now)).toEqual({
      kind: "confirm",
    });
    expect(resolveConfirmOutcome(row("pending", null), now)).toEqual({ kind: "confirm" });
  });

  it("re-click of a used link reports 'already', never an error", () => {
    expect(resolveConfirmOutcome(row("subscribed", null), now)).toEqual({ kind: "already" });
  });

  it("'already' wins over an expired timestamp (post-confirm re-click)", () => {
    expect(resolveConfirmOutcome(row("subscribed", "2026-01-01T00:00:00Z"), now)).toEqual({
      kind: "already",
    });
  });

  it("expired pending token reports 'expired'", () => {
    expect(resolveConfirmOutcome(row("pending", "2026-01-01T00:00:00Z"), now)).toEqual({
      kind: "expired",
    });
  });
});

describe("wantsHtml (browser clicks land on the result page, not raw JSON)", () => {
  it("detects a browser navigation", () => {
    expect(wantsHtml("text/html,application/xhtml+xml,*/*;q=0.8")).toBe(true);
  });

  it("keeps JSON for programmatic clients", () => {
    expect(wantsHtml("*/*")).toBe(false);
    expect(wantsHtml("application/json")).toBe(false);
    expect(wantsHtml(null)).toBe(false);
  });
});
