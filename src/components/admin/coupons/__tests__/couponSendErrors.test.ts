// Tłumaczenie kodów błędów kampanii kuponowej (P04) na komunikaty panelu.
//
// PO CO. Serwer wysyłki zwraca błąd trybu kuponowego jako KOD maszynowy
// (`COUPON_CODES_INSUFFICIENT:120:80`). Edytor kampanii pokazywał go surowo -
// operator nie wiedział, że kody NIE poszły do całej listy ani co poprawić.
// Test przypina też KONTRAKT: kody w panelu = kody serwera (literał po obu
// stronach, więc rozjazd nie dałby błędu kompilacji).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import {
  COUPON_SEND_ERROR_CODES,
  couponSendErrorMessage,
  prepareSendErrorMessage,
} from "../couponSendErrors";

/** `t` jako echo klucza z parametrami - asercje mierzą klucz i liczby. */
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}${JSON.stringify(opts)}` : key) as unknown as TFunction;

describe("couponSendErrorMessage", () => {
  it("za mało kodów: liczby z kodu idą do komunikatu jako liczby", () => {
    expect(couponSendErrorMessage("COUPON_CODES_INSUFFICIENT:120:80", t)).toBe(
      'adminCoupons.newsletterCampaign.errors.codesInsufficient{"needed":120,"available":80}',
    );
  });

  it("zły segment, brak powiązania i niejednoznaczne powiązanie mają własne zdania", () => {
    expect(couponSendErrorMessage("COUPON_SEGMENT_INVALID", t)).toBe(
      "adminCoupons.newsletterCampaign.errors.segmentInvalid",
    );
    expect(couponSendErrorMessage("COUPON_CAMPAIGN_NOT_LINKED", t)).toBe(
      "adminCoupons.newsletterCampaign.errors.notLinked",
    );
    expect(couponSendErrorMessage("COUPON_CAMPAIGN_AMBIGUOUS", t)).toBe(
      "adminCoupons.newsletterCampaign.errors.ambiguous",
    );
  });

  it("błąd spoza trybu kuponowego zwraca null - ekran pokazuje go po staremu", () => {
    expect(couponSendErrorMessage("reputation_blocked:complaint_rate", t)).toBeNull();
    expect(couponSendErrorMessage("campaign_not_sendable", t)).toBeNull();
    // Zniekształcony kod liczb NIE udaje komunikatu z liczbami.
    expect(couponSendErrorMessage("COUPON_CODES_INSUFFICIENT:abc:1", t)).toBeNull();
  });
});

describe("prepareSendErrorMessage", () => {
  it("tłumaczy odmowy przygotowania wysyłki", () => {
    expect(prepareSendErrorMessage("coupon_campaign_not_generated", t)).toBe(
      "adminCoupons.campaignsFlow.notGenerated",
    );
    expect(prepareSendErrorMessage("campaign_not_found", t)).toBe(
      "adminCoupons.campaignsFlow.notFound",
    );
    expect(prepareSendErrorMessage("COUPON_SEGMENT_INVALID", t)).toBe(
      "adminCoupons.campaignsFlow.segmentInvalid",
    );
    expect(prepareSendErrorMessage("insert_failed", t)).toBeNull();
  });
});

describe("kontrakt z serwerem kampanii", () => {
  it("kody panelu są TYMI SAMYMI kodami, które rzuca serwer (`COUPON_SEND_ERRORS`)", () => {
    // Źródło czytane jako tekst: import modułu funkcji serwerowych ciągnąłby
    // klienta serwisowego i dostawcę poczty do testu liścia.
    const source = readFileSync("src/lib/newsletter-campaigns.functions.ts", "utf8");
    const block = source.match(/export const COUPON_SEND_ERRORS = \{([\s\S]*?)\} as const;/);
    expect(block, "brak COUPON_SEND_ERRORS w serwerze kampanii").toBeTruthy();
    const serwer = Object.fromEntries(
      [...block![1].matchAll(/(\w+):\s*"([A-Z_]+)"/g)].map((m) => [m[1], m[2]]),
    );
    expect(serwer).toEqual({ ...COUPON_SEND_ERROR_CODES });
  });
});
