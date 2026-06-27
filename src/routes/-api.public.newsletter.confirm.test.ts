import { describe, it, expect } from "vitest";
import { isValidConfirmToken } from "./api.public.newsletter.confirm";

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
