import { describe, it, expect } from "vitest";
import { computeReceipt, isExpired, isValidMessageTtl, MESSAGE_TTL_OPTIONS } from "../receipts";
import { formatVoiceDuration } from "../voice";

const T0 = "2026-01-01T10:00:00.000Z";
const BEFORE = "2026-01-01T09:59:00.000Z";
const AFTER = "2026-01-01T10:01:00.000Z";

describe("computeReceipt", () => {
  it("reports pending for optimistic and failed rows regardless of peer state", () => {
    expect(computeReceipt({ created_at: T0, pending: true }, AFTER, AFTER)).toBe("pending");
    expect(computeReceipt({ created_at: T0, failed: true }, AFTER, AFTER)).toBe("pending");
  });

  it("caps at sent when the peer row is hidden (read receipts off => null inputs)", () => {
    expect(computeReceipt({ created_at: T0 }, null, null)).toBe("sent");
    expect(computeReceipt({ created_at: T0 }, undefined, undefined)).toBe("sent");
  });

  it("reports delivered when the peer acked delivery but has not read yet", () => {
    expect(computeReceipt({ created_at: T0 }, BEFORE, AFTER)).toBe("delivered");
    expect(computeReceipt({ created_at: T0 }, null, T0)).toBe("delivered");
  });

  it("reports read as soon as last_read_at covers the message (read wins over delivered)", () => {
    expect(computeReceipt({ created_at: T0 }, T0, null)).toBe("read");
    expect(computeReceipt({ created_at: T0 }, AFTER, BEFORE)).toBe("read");
  });

  it("does not upgrade older peer state to newer messages", () => {
    expect(computeReceipt({ created_at: AFTER }, T0, T0)).toBe("sent");
  });
});

describe("isExpired", () => {
  const nowMs = Date.parse(T0);
  it("never expires messages without a TTL stamp", () => {
    expect(isExpired({ expires_at: null }, nowMs)).toBe(false);
  });
  it("expires exactly at the boundary and beyond", () => {
    expect(isExpired({ expires_at: T0 }, nowMs)).toBe(true);
    expect(isExpired({ expires_at: BEFORE }, nowMs)).toBe(true);
    expect(isExpired({ expires_at: AFTER }, nowMs)).toBe(false);
  });
});

describe("isValidMessageTtl", () => {
  it("accepts null (off) and the whitelisted windows only", () => {
    expect(isValidMessageTtl(null)).toBe(true);
    for (const option of MESSAGE_TTL_OPTIONS) expect(isValidMessageTtl(option)).toBe(true);
    expect(isValidMessageTtl(3600)).toBe(false);
    expect(isValidMessageTtl(1)).toBe(false);
  });
});

describe("formatVoiceDuration", () => {
  it("formats mm:ss with zero-padded seconds", () => {
    expect(formatVoiceDuration(0)).toBe("0:00");
    expect(formatVoiceDuration(7)).toBe("0:07");
    expect(formatVoiceDuration(65)).toBe("1:05");
    expect(formatVoiceDuration(600)).toBe("10:00");
  });
  it("clamps negatives and truncates fractions", () => {
    expect(formatVoiceDuration(-5)).toBe("0:00");
    expect(formatVoiceDuration(12.9)).toBe("0:12");
  });
});
