// SMS jest kanałem pomocniczym - te testy pilnują dwóch rzeczy, które decydują
// o tym, czy wiadomość w ogóle dotrze: normalizacji numeru i długości treści.
import { describe, expect, it } from "vitest";
import { normalizePhone, trimSmsBody } from "@/lib/notify/sms.server";

describe("normalizePhone", () => {
  it("uzupełnia polski kierunkowy dla numeru krajowego", () => {
    expect(normalizePhone("601 234 567")).toBe("+48601234567");
  });

  it("zamienia prefiks 00 na +", () => {
    expect(normalizePhone("0049 170 1234567")).toBe("+491701234567");
  });

  it("odrzuca numer, którego dostawca i tak by nie przyjął", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("trimSmsBody", () => {
  it("nie tnie krótkiej treści", () => {
    expect(trimSmsBody("  Bilet oplacony.  ")).toBe("Bilet oplacony.");
  });

  it("skraca długą treść na granicy słowa", () => {
    const body = `${"wyraz ".repeat(80)}koniec`;
    const out = trimSmsBody(body);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("  ");
  });
});
