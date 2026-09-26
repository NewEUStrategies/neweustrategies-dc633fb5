// Mapy odmów naboru: głowa komunikatu plpgsql -> klucz i18n, liczby z ogona
// -> parametry. Nieznana głowa (albo śmieć) -> `unknown`, nigdy surowy tekst
// bazy przed uczestnikiem.
import { describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";
import { adminCfpErrorMessage, adminCfpFailure } from "@/lib/events/adminCfpErrors";
import {
  mapCfpFailure,
  publicCfpErrorMessage,
  publicCfpFailure,
} from "@/lib/events/publicCfpErrors";
import { ensureAdminEventCfpI18n } from "@/lib/i18n-admin-event-cfp";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";

describe("publicCfpFailure", () => {
  it("głowa -> camelCase, liczby z ogona -> count/total", () => {
    expect(publicCfpFailure(new Error("limit_reached: at most 2 submissions per person"))).toEqual({
      key: "eventCfp.errors.limitReached",
      params: { count: 2 },
    });
    expect(publicCfpFailure({ message: "invalid_score: the overall score must be 1-5" })).toEqual({
      key: "eventCfp.errors.invalidScore",
      params: { count: 1, total: 5 },
    });
    expect(publicCfpFailure("cfp_closed")).toEqual({ key: "eventCfp.errors.cfpClosed", params: {} });
  });

  it("nieznana albo nieczytelna głowa -> `unknown`", () => {
    expect(publicCfpFailure(new Error("totally_new_code: x")).key).toBe("eventCfp.errors.unknown");
    expect(publicCfpFailure(new Error("duplicate key value violates unique constraint")).key).toBe(
      "eventCfp.errors.unknown",
    );
    expect(publicCfpFailure(42).key).toBe("eventCfp.errors.unknown");
    expect(publicCfpFailure(null).key).toBe("eventCfp.errors.unknown");
  });

  it("zdanie po polsku i po angielsku z wypełnioną liczbą", async () => {
    await i18n.changeLanguage("pl");
    expect(publicCfpErrorMessage(new Error("limit_reached: at most 3 submissions"))).toBe(
      "Limit zgłoszeń na osobę w tym naborze: 3.",
    );
    await i18n.changeLanguage("en");
    expect(publicCfpErrorMessage(new Error("limit_reached: at most 3 submissions"))).toBe(
      "The per-person submission limit of this call: 3.",
    );
    await i18n.changeLanguage("pl");
  });
});

describe("adminCfpFailure", () => {
  it("przestrzeń kluczy panelu", () => {
    expect(adminCfpFailure(new Error("score_max_below_reviews: existing reviews use scores up to 7"))).toEqual({
      key: "adminEventCfp.errors.scoreMaxBelowReviews",
      params: { count: 7 },
    });
    expect(adminCfpFailure(new Error("room_conflict: taken")).key).toBe("adminEventCfp.errors.roomConflict");
    expect(adminCfpFailure(new Error("nope: x")).key).toBe("adminEventCfp.errors.unknown");
  });

  it("zdanie panelu", async () => {
    await i18n.changeLanguage("pl");
    expect(adminCfpErrorMessage(new Error("key_taken: x"))).toBe("Inne pytanie tego naboru ma już ten klucz.");
  });

  it("rdzeń mapy jest wspólny i przyjmuje dowolny prefiks", () => {
    expect(mapCfpFailure("eventCfp.errors.", new Error("not_found: x")).key).toBe("eventCfp.errors.notFound");
  });
});

describe("nakładki", () => {
  it("rejestracja jest idempotentna, a nakładka panelu rejestruje też słownik uczestnika", () => {
    ensureEventCfpI18n();
    ensureEventCfpI18n();
    ensureAdminEventCfpI18n();
    ensureAdminEventCfpI18n();
    expect(i18n.exists("eventCfp.statuses.accepted")).toBe(true);
    expect(i18n.exists("adminEventCfp.errors.unknown")).toBe(true);
  });
});
