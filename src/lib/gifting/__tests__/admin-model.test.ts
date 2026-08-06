// Testy czystej logiki panelu admina Gift Articles: zakresy limitow (lustro
// CHECK-ow SQL), parsowanie inputow, walidacja draftu (puste pole != 0),
// wykrywanie zmian i semantyka capu odslon. Zero DOM/Supabase.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_GIFT_ADMIN_SETTINGS,
  GIFT_ADMIN_BOUNDS,
  GIFT_ADMIN_LIMIT_FIELDS,
  draftToGiftAdminSettings,
  giftAdminSettingsEqual,
  giftCapExhausted,
  parseGiftAdminLimitInput,
  toGiftAdminDraft,
  validateGiftAdminDraft,
  type GiftAdminSettings,
} from "@/lib/gifting/admin-model";

const SETTINGS: GiftAdminSettings = {
  enabled: true,
  monthly_limit: 10,
  link_ttl_days: 30,
  max_redemptions_per_link: 5,
  eligibility: "registered",
};

describe("GIFT_ADMIN_BOUNDS", () => {
  it("odzwierciedla CHECK-i z migracji (20260722112736, 20260724090600)", () => {
    expect(GIFT_ADMIN_BOUNDS.monthly_limit).toEqual({ min: 0, max: 1000, fallback: 10 });
    expect(GIFT_ADMIN_BOUNDS.link_ttl_days).toEqual({ min: 0, max: 365, fallback: 30 });
    // Budzet klikniec: po migracji 20260806170000 domyslne 5, nie 50.
    expect(GIFT_ADMIN_BOUNDS.max_redemptions_per_link).toEqual({
      min: 0,
      max: 100000,
      fallback: 5,
    });
  });

  it("domyslne ustawienia = fallbacki RPC (brak wiersza w gift_article_settings)", () => {
    expect(DEFAULT_GIFT_ADMIN_SETTINGS).toEqual({
      enabled: true,
      monthly_limit: 10,
      link_ttl_days: 30,
      max_redemptions_per_link: 5,
      eligibility: "registered",
    });
  });
});

describe("parseGiftAdminLimitInput", () => {
  it("puste pole i smieci daja null (nigdy NaN)", () => {
    expect(parseGiftAdminLimitInput("")).toBeNull();
    expect(parseGiftAdminLimitInput("   ")).toBeNull();
    expect(parseGiftAdminLimitInput("abc")).toBeNull();
    expect(parseGiftAdminLimitInput("Infinity")).toBeNull();
  });

  it("parsuje liczby calkowite, ulamki obcina", () => {
    expect(parseGiftAdminLimitInput("0")).toBe(0);
    expect(parseGiftAdminLimitInput("50")).toBe(50);
    expect(parseGiftAdminLimitInput(" 42 ")).toBe(42);
    expect(parseGiftAdminLimitInput("7.9")).toBe(7);
    expect(parseGiftAdminLimitInput("-3")).toBe(-3);
  });
});

describe("validateGiftAdminDraft / draftToGiftAdminSettings", () => {
  it("kompletny draft w zakresach przechodzi bez uwag", () => {
    const draft = toGiftAdminDraft(SETTINGS);
    expect(validateGiftAdminDraft(draft)).toEqual({});
    expect(draftToGiftAdminSettings(draft)).toEqual(SETTINGS);
  });

  it("puste pole to 'required' - NIE ciche zero (0 = bez limitu!)", () => {
    const draft = { ...toGiftAdminDraft(SETTINGS), max_redemptions_per_link: null };
    expect(validateGiftAdminDraft(draft)).toEqual({ max_redemptions_per_link: "required" });
    expect(draftToGiftAdminSettings(draft)).toBeNull();
  });

  it("wartosci poza zakresem to 'range' - per pole, wedlug wlasnych granic", () => {
    const draft = {
      enabled: true,
      monthly_limit: 1001,
      link_ttl_days: -1,
      max_redemptions_per_link: 100001,
      eligibility: "registered" as const,
    };
    expect(validateGiftAdminDraft(draft)).toEqual({
      monthly_limit: "range",
      link_ttl_days: "range",
      max_redemptions_per_link: "range",
    });
    expect(draftToGiftAdminSettings(draft)).toBeNull();
  });

  it("granice zakresow (min i max) sa poprawne", () => {
    for (const field of GIFT_ADMIN_LIMIT_FIELDS) {
      const { min, max } = GIFT_ADMIN_BOUNDS[field];
      expect(validateGiftAdminDraft({ ...toGiftAdminDraft(SETTINGS), [field]: min })).toEqual({});
      expect(validateGiftAdminDraft({ ...toGiftAdminDraft(SETTINGS), [field]: max })).toEqual({});
      expect(validateGiftAdminDraft({ ...toGiftAdminDraft(SETTINGS), [field]: max + 1 })).toEqual({
        [field]: "range",
      });
    }
  });
});

describe("giftAdminSettingsEqual", () => {
  it("wykrywa brak zmian i zmiane kazdego pola z osobna", () => {
    expect(giftAdminSettingsEqual(SETTINGS, { ...SETTINGS })).toBe(true);
    expect(giftAdminSettingsEqual(SETTINGS, { ...SETTINGS, enabled: false })).toBe(false);
    expect(giftAdminSettingsEqual(SETTINGS, { ...SETTINGS, monthly_limit: 11 })).toBe(false);
    expect(giftAdminSettingsEqual(SETTINGS, { ...SETTINGS, link_ttl_days: 31 })).toBe(false);
    expect(giftAdminSettingsEqual(SETTINGS, { ...SETTINGS, max_redemptions_per_link: 51 })).toBe(
      false,
    );
    // Bramka uprawnienia to tez ustawienie - zmiana musi odblokowac zapis.
    expect(giftAdminSettingsEqual(SETTINGS, { ...SETTINGS, eligibility: "subscribers" })).toBe(
      false,
    );
  });
});

describe("giftCapExhausted", () => {
  it("lustro warunku redeem_gift_link: cap > 0 AND count >= cap", () => {
    expect(giftCapExhausted(4, 5)).toBe(false);
    expect(giftCapExhausted(5, 5)).toBe(true);
    expect(giftCapExhausted(6, 5)).toBe(true);
  });

  it("cap 0 = bez limitu, nigdy nie wyczerpany", () => {
    expect(giftCapExhausted(0, 0)).toBe(false);
    expect(giftCapExhausted(1_000_000, 0)).toBe(false);
  });
});
