// Odmowy bazy modulu sponsorow -> komunikat i18n. Pilnujemy trzech rzeczy:
// rozpoznania klucza z glowy komunikatu, interpolacji liczb z ogona i tego, ze
// nieznany klucz spada do `unknown` (organizator nie czyta kodow SQLSTATE).
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { adminSponsorErrorMessage, adminSponsorFailure } from "@/lib/events/adminSponsorErrors";
import {
  adminEventSponsorsEn,
  adminEventSponsorsPl,
  ensureSponsorsI18n,
} from "@/lib/i18n-admin-event-sponsors";

const SQL_KEYS = [
  "invalid_names",
  "invalid_titles",
  "invalid_url",
  "invalid_key",
  "invalid_event",
  "invalid_company",
  "invalid_role",
  "invalid_payload",
  "not_found",
  "contact_not_found",
  "tier_in_use",
  "tier_full",
  "sponsor_tier_required",
] as const;

describe("adminSponsorErrors", () => {
  it("rozpoznaje kazdy klucz podnoszony przez migracje sponsorow", () => {
    ensureSponsorsI18n();
    for (const key of SQL_KEYS) {
      const failure = adminSponsorFailure(new Error(`${key}: detail`));
      expect(failure.key).not.toBe("adminEventSponsors.errors.unknown");
      expect(i18n.exists(failure.key)).toBe(true);
    }
  });

  it("wyciaga liczby z ogona komunikatu do interpolacji", () => {
    const failure = adminSponsorFailure(
      new Error("tier_full: tier allows 3 company(ies), 5 already pinned"),
    );
    expect(failure.params).toEqual({ count: 3, total: 5 });
    expect(adminSponsorErrorMessage(new Error("tier_in_use: 2 company(ies)"))).toContain("2");
  });

  it("nieznany klucz i szum sieciowy spadaja do `unknown`", () => {
    expect(adminSponsorFailure(new Error("23514: violates check constraint")).key).toBe(
      "adminEventSponsors.errors.unknown",
    );
    expect(adminSponsorFailure("Failed to fetch").key).toBe("adminEventSponsors.errors.unknown");
    expect(adminSponsorFailure(null).key).toBe("adminEventSponsors.errors.unknown");
  });
});

describe("slownik sponsorow PL/EN", () => {
  const flatten = (value: unknown, prefix = ""): string[] => {
    if (typeof value !== "object" || value === null) return [prefix];
    return Object.entries(value).flatMap(([key, child]) =>
      flatten(child, prefix === "" ? key : `${prefix}.${key}`),
    );
  };

  it("ma identyczny zestaw kluczy w obu jezykach", () => {
    expect(flatten(adminEventSponsorsPl).sort()).toEqual(flatten(adminEventSponsorsEn).sort());
  });
});
