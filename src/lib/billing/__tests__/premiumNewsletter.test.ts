// Czysta logika zgody na newsletter premium (SUB-15).
//
// JAKIE RYZYKA PRZYBIJA TEN PLIK:
//   * ZGODA BEZ POLA. Wpis zgody powstaje wyłącznie z jawnej zgody z checkoutu
//     o znanej wersji treści - bez niej (albo z wersją spoza rejestru, zgodą
//     przeterminowaną, „z przyszłości") nie ma wpisu.
//   * DOWÓD. Wpis ma kanoniczny kształt kolumny `consents` (`text`, `version`,
//     `given`, `lang`) - ten, który czyta panel i rejestr `crm_consent_log`.
//   * SCALANIE. Istniejące dowody zostają co do bajtu; wycofanie nie jest
//     przestawiane, a nowa zgoda po nim to NOWY wpis.
import { describe, expect, it } from "vitest";
import type { Json } from "@/integrations/supabase/types";
import {
  buildPremiumNewsletterConsentEntry,
  buildPremiumNewsletterRow,
  canAutoSubscribe,
  mergeNewsletterConsents,
  normalizeNewsletterLanguage,
  PREMIUM_NEWSLETTER_CONSENT,
  PREMIUM_NEWSLETTER_CONSENT_MAX_AGE_MS,
  PREMIUM_NEWSLETTER_CONSENT_TEXTS,
  PREMIUM_NEWSLETTER_CONSENT_VERSION,
  premiumNewsletterConsentMetadata,
  premiumNewsletterConsentText,
  readPremiumNewsletterConsentMetadata,
  type PremiumNewsletterConsentGrant,
} from "@/lib/billing/premiumNewsletter";

const NOW = new Date("2026-01-01T12:00:00.000Z");
const GIVEN_AT = "2026-01-01T11:58:00.000Z";

function grant(over: Partial<PremiumNewsletterConsentGrant> = {}): PremiumNewsletterConsentGrant {
  return {
    version: PREMIUM_NEWSLETTER_CONSENT_VERSION,
    lang: "pl",
    at: GIVEN_AT,
    orderId: "order-1",
    ...over,
  };
}

function entry(over: Partial<PremiumNewsletterConsentGrant> = {}) {
  const built = buildPremiumNewsletterConsentEntry({
    grant: grant(over),
    subscriptionId: "sub_1",
    now: NOW,
  });
  if (!built) throw new Error("test: wpis zgody miał powstać");
  return built;
}

describe("premiumNewsletter - treść i wersja zgody", () => {
  it("normalizuje język do pl/en", () => {
    expect(normalizeNewsletterLanguage("en-GB")).toBe("en");
    expect(normalizeNewsletterLanguage("PL")).toBe("pl");
    expect(normalizeNewsletterLanguage(null)).toBe("pl");
  });

  it("bieżąca wersja ma pełną treść w obu językach (zakres, kanał, dobrowolność, wycofanie)", () => {
    const pl = premiumNewsletterConsentText(PREMIUM_NEWSLETTER_CONSENT_VERSION, "pl");
    const en = premiumNewsletterConsentText(PREMIUM_NEWSLETTER_CONSENT_VERSION, "en");
    expect(pl).toMatch(/drogą elektroniczną/);
    expect(pl).toMatch(/nie jest warunkiem zakupu/);
    expect(pl).toMatch(/wycofać/);
    expect(en).toMatch(/not a condition of purchase/);
    expect(en).toMatch(/withdraw/);
    expect(premiumNewsletterConsentText("1999-01-01", "pl")).toBeNull();
    // `Object.hasOwn`, nie `in`: klucz z prototypu nie jest wersją treści.
    expect(premiumNewsletterConsentText("toString", "pl")).toBeNull();
  });
});

describe("premiumNewsletter - metadane operatora", () => {
  it("zgoda przechodzi przez metadane sesji bez zmian (wersja, język, chwila, zamówienie)", () => {
    const metadata = {
      userId: "u1",
      orderId: "order-1",
      ...premiumNewsletterConsentMetadata(grant()),
    };
    // Metadane operatora mają limit 500 znaków na wartość - treść nie jedzie.
    expect(Object.values(metadata).every((v) => v.length <= 500)).toBe(true);
    expect(JSON.stringify(metadata)).not.toContain("Wyrażam zgodę");
    expect(readPremiumNewsletterConsentMetadata(metadata)).toEqual(grant());
  });

  it.each([
    ["brak metadanych", null],
    ["metadane bez zgody (pole niezaznaczone)", { userId: "u1", orderId: "o1" }],
    [
      "brak chwili",
      { newsletterConsentVersion: PREMIUM_NEWSLETTER_CONSENT_VERSION, newsletterConsentLang: "pl" },
    ],
    [
      "język spoza pl/en",
      {
        newsletterConsentVersion: PREMIUM_NEWSLETTER_CONSENT_VERSION,
        newsletterConsentLang: "de",
        newsletterConsentAt: GIVEN_AT,
      },
    ],
  ])("%s: brak zgody, a nie zgoda z wartościami domyślnymi", (_, metadata) => {
    expect(readPremiumNewsletterConsentMetadata(metadata)).toBeNull();
  });
});

describe("premiumNewsletter - wpis zgody", () => {
  it("buduje wpis w kanonicznym kształcie z dowodem pochodzenia", () => {
    expect(entry()).toEqual({
      key: PREMIUM_NEWSLETTER_CONSENT,
      text: PREMIUM_NEWSLETTER_CONSENT_TEXTS[PREMIUM_NEWSLETTER_CONSENT_VERSION]?.pl,
      version: PREMIUM_NEWSLETTER_CONSENT_VERSION,
      given: true,
      lang: "pl",
      timestamp: GIVEN_AT,
      received_at: NOW.toISOString(),
      source: "subscription_checkout",
      subscription_id: "sub_1",
      order_id: "order-1",
    });
    expect(entry({ lang: "en" }).text).toBe(
      PREMIUM_NEWSLETTER_CONSENT_TEXTS[PREMIUM_NEWSLETTER_CONSENT_VERSION]?.en,
    );
  });

  it.each([
    ["brak zgody", null],
    ["nieznana wersja treści", grant({ version: "2020-01-01" })],
    ["nieczytelna chwila", grant({ at: "wczoraj" })],
    [
      "zgoda starsza niż okno ponowień",
      grant({
        at: new Date(NOW.getTime() - PREMIUM_NEWSLETTER_CONSENT_MAX_AGE_MS - 1).toISOString(),
      }),
    ],
    ["zgoda „z przyszłości”", grant({ at: "2026-01-02T12:00:00.000Z" })],
  ])("%s: wpis nie powstaje", (_, value) => {
    expect(
      buildPremiumNewsletterConsentEntry({ grant: value, subscriptionId: "sub_1", now: NOW }),
    ).toBeNull();
  });

  it("nowy wiersz: potwierdzony zgodą, w języku zgody, z adresem znormalizowanym", () => {
    const consent = entry({ lang: "en" });
    const row = buildPremiumNewsletterRow({
      tenantId: "t1",
      userId: "u1",
      email: "  Office@NES.com ",
      firstName: "Anna",
      lastName: "Nowak",
      tierKey: "pro",
      subscriptionId: "sub_1",
      consent,
    });

    expect(row.email).toBe("office@nes.com");
    expect(row.language).toBe("en");
    expect(row.status).toBe("subscribed");
    expect(row.confirmed_at).toBe(NOW.toISOString());
    expect(row.consents).toEqual([consent]);
    expect(row.meta).toEqual({ tier: "pro", subscription_id: "sub_1" });
  });
});

describe("premiumNewsletter - scalanie dowodów", () => {
  const formConsent = {
    key: "newsletter",
    text: "Wyrażam zgodę na otrzymywanie newslettera.",
    given: true,
    lang: "pl",
    received_at: "2025-05-01T10:00:00.000Z",
  };

  it("dopisuje zgodę obok istniejących dowodów, niczego nie ruszając", () => {
    const existing: Json = [formConsent, "obcy-wpis-integracji", { key: "rodo", given: true }];
    const snapshot = JSON.stringify(existing);

    const merged = mergeNewsletterConsents(existing, entry());

    expect(merged?.appended).toBe(true);
    expect(merged?.consents.slice(0, 3)).toEqual(existing);
    expect(merged?.consents.at(-1)).toEqual(entry());
    // Wejście nie jest mutowane - odczyt zostaje dowodem stanu sprzed zapisu.
    expect(JSON.stringify(existing)).toBe(snapshot);
  });

  it("pusta albo brakująca kolumna dostaje jeden wpis", () => {
    expect(mergeNewsletterConsents([], entry())?.consents).toEqual([entry()]);
    expect(mergeNewsletterConsents(null, entry())?.consents).toEqual([entry()]);
  });

  it("ponowione zdarzenie nie dubluje zgody - zostaje najwcześniejszy dowód", () => {
    const first = entry({ at: "2026-01-01T11:00:00.000Z" });
    const merged = mergeNewsletterConsents([formConsent, first], entry());

    expect(merged).toEqual({ consents: [formConsent, first], appended: false });
  });

  it("wycofanie zostaje w historii, a nowa jawna zgoda jest NOWYM wpisem", () => {
    const withdrawn = { ...entry({ at: "2025-12-20T10:00:00.000Z" }), given: false };
    const merged = mergeNewsletterConsents([withdrawn], entry());

    expect(merged?.appended).toBe(true);
    expect(merged?.consents).toEqual([withdrawn, entry()]);
  });

  it("dawny wpis `granted: true` bez treści nie jest dowodem - prawdziwa zgoda dopisuje się obok", () => {
    const fabricated = {
      key: PREMIUM_NEWSLETTER_CONSENT,
      granted: true,
      granted_at: "2025-11-01T10:00:00.000Z",
      source: "subscription_checkout",
    };
    const merged = mergeNewsletterConsents([fabricated], entry());

    expect(merged?.consents).toEqual([fabricated, entry()]);
  });

  it("kolumna, która nie jest tablicą, nie jest scalana (nic nie ginie)", () => {
    expect(mergeNewsletterConsents({ newsletter: true }, entry())).toBeNull();
    expect(mergeNewsletterConsents("tak", entry())).toBeNull();
  });
});

describe("premiumNewsletter - kto może zostać zapisany", () => {
  it("nie reaktywuje osoby, która się wypisała, i nie zgaduje nieznanego stanu", () => {
    expect(canAutoSubscribe(null)).toBe(true);
    expect(canAutoSubscribe({ status: "subscribed" })).toBe(true);
    expect(canAutoSubscribe({ status: "pending" })).toBe(true);
    expect(canAutoSubscribe({ status: "unsubscribed" })).toBe(false);
    expect(canAutoSubscribe({ status: "subscribed", unsubscribed_at: "2026-01-01" })).toBe(false);
    expect(canAutoSubscribe({ status: "blocked" })).toBe(false);
  });
});
