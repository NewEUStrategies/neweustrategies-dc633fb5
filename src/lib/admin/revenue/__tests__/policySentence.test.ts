// Polityka dostępu w jednym zdaniu (S7, `policySentence.ts`).
//
// CO TEN PLIK DOWODZI.
//   1. Fakty z inwentarza S3: treści z progiem warstwy, warstwy do kupienia,
//      suma ślepych zaułków - bez własnych założeń.
//   2. Licznik w trzech RÓŻNYCH stanach: odczyt nieudany (`undefined`) to
//      „nie wiadomo", brak wiersza (`null`) to „serwer nie liczy", wyłączony
//      to decyzja admina - żaden z nich nie udaje drugiego.
//   3. Liczebniki odmienia i18next: „1 treść", „2 treści mają", „5 treści
//      ma" (PL), „1 item has", „2 items have" (EN) - bez ręcznej odmiany.
//   4. Każda część zdania ma napis PL i EN, różny w obu językach.
import { describe, expect, it } from "vitest";

import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-revenue-tabs";
import { ACCESS_INVENTORY, clone } from "@/components/admin/revenue/overview/__tests__/hubFixtures";
import type { MeteringSettings } from "@/lib/access/metering";
import {
  accessPolicyFacts,
  describeAccessPolicy,
  type AccessPolicyFacts,
} from "@/lib/admin/revenue/policySentence";
import type { AccessInventoryDto } from "@/lib/revenue/access/dto";

const inventory = () => clone(ACCESS_INVENTORY) as AccessInventoryDto;

const METER_ON: MeteringSettings = {
  enabled: true,
  member_monthly_limit: 5,
  anon_monthly_limit: 0,
  meter_paid: true,
  meter_members: true,
  show_counter: true,
};

function sentence(facts: AccessPolicyFacts, lang: "pl" | "en" = "pl"): string {
  const t = realT(lang);
  return describeAccessPolicy(facts)
    .map((part) => t(part.key, part.params))
    .join(" ");
}

function keysOf(facts: AccessPolicyFacts): string[] {
  return describeAccessPolicy(facts).map((part) => part.key);
}

describe("accessPolicyFacts - fakty z inwentarza i ustawień licznika", () => {
  it("liczy treści z progiem, warstwy do kupienia i ślepe zaułki", () => {
    const facts = accessPolicyFacts(inventory(), METER_ON);
    expect(facts.total).toBe(12);
    expect(facts.rankGated).toBe(3);
    expect(facts.tiersTotal).toBe(3);
    expect(facts.tiersOfferable).toBe(2);
    expect(facts.deadEnds).toBe(1);
    expect(facts.metering).toEqual({ state: "on", memberLimit: 5, anonLimit: 0 });
  });

  it("licznik: odczyt nieudany ≠ brak wiersza ≠ wyłączony", () => {
    expect(accessPolicyFacts(inventory(), undefined).metering).toEqual({ state: "unknown" });
    expect(accessPolicyFacts(inventory(), null).metering).toEqual({ state: "missing" });
    expect(accessPolicyFacts(inventory(), { ...METER_ON, enabled: false }).metering).toEqual({
      state: "off",
    });
  });
});

describe("describeAccessPolicy - części zdania", () => {
  it("kolejność: treści, tryby, próg, licznik, oferta, zaułki", () => {
    expect(keysOf(accessPolicyFacts(inventory(), METER_ON))).toEqual([
      "adminRevenue.accessTab.policy.rules",
      "adminRevenue.accessTab.policy.modes",
      "adminRevenue.accessTab.policy.rankGated",
      "adminRevenue.accessTab.policy.meteringMembers",
      "adminRevenue.accessTab.policy.meteringGuestsNone",
      "adminRevenue.accessTab.policy.tiersOfferable",
      "adminRevenue.accessTab.policy.deadEnds",
    ]);
  });

  it("bez reguł: jedno zdanie „wszystko publiczne”, bez trybów i progu", () => {
    const empty = { ...inventory(), total: 0, rows: [] };
    const keys = keysOf(accessPolicyFacts(empty, METER_ON));
    expect(keys[0]).toBe("adminRevenue.accessTab.policy.noRules");
    expect(keys).not.toContain("adminRevenue.accessTab.policy.modes");
  });

  it("goście z limitem > 0 dostają liczbę, a bez zaułków - „każda bramka prowadzi do oferty”", () => {
    const clean = {
      ...inventory(),
      deadEnds: { tierWithoutOffer: 0, paidWithoutOffer: 0, danglingPlans: 0, meteredTierGated: 0 },
    };
    const parts = describeAccessPolicy(
      accessPolicyFacts(clean, { ...METER_ON, anon_monthly_limit: 2 }),
    );
    expect(parts).toContainEqual({
      key: "adminRevenue.accessTab.policy.meteringGuests",
      params: { count: 2 },
    });
    expect(parts.at(-1)?.key).toBe("adminRevenue.accessTab.policy.deadEndsNone");
  });

  it("nieznany i brakujący licznik mają własne zdania", () => {
    expect(keysOf(accessPolicyFacts(inventory(), undefined))).toContain(
      "adminRevenue.accessTab.policy.meteringUnknown",
    );
    expect(keysOf(accessPolicyFacts(inventory(), null))).toContain(
      "adminRevenue.accessTab.policy.meteringMissing",
    );
  });
});

describe("zdanie po polsku i po angielsku - liczebniki i18next", () => {
  it("PL: odmiana „treść / treści”, liczby i warstwy", () => {
    const text = sentence(accessPolicyFacts(inventory(), METER_ON));
    expect(text).toContain("12 treści ma regułę dostępu");
    expect(text).toContain("płatne: 5");
    expect(text).toContain("3 z nich wymagają konkretnej warstwy.");
    expect(text).toContain("5 darmowych artykułów w miesiącu");
    expect(text).toContain("Z 3 warstw da się dziś kupić 2.");
    expect(text).toContain("1 bramka nie prowadzi do żadnej oferty.");
  });

  it("PL: jedna treść i dwie bramki", () => {
    const one = { ...inventory(), total: 1 };
    expect(sentence(accessPolicyFacts(one, null))).toContain("1 treść ma regułę dostępu");
    const two = {
      ...inventory(),
      total: 2,
      deadEnds: { tierWithoutOffer: 1, paidWithoutOffer: 1, danglingPlans: 0, meteredTierGated: 0 },
    };
    expect(sentence(accessPolicyFacts(two, null))).toContain("2 treści mają regułę dostępu");
    expect(sentence(accessPolicyFacts(two, null))).toContain(
      "2 bramki nie prowadzą do żadnej oferty.",
    );
  });

  it("EN: liczba pojedyncza i mnoga", () => {
    const text = sentence(accessPolicyFacts({ ...inventory(), total: 1 }, METER_ON), "en");
    expect(text).toContain("1 item has an access rule");
    expect(text).toContain("5 free articles a month");
    expect(text).toContain("2 of 3 tiers can be bought today.");
  });

  it("każda część ma napis PL i EN, różny w obu językach", () => {
    const variants: AccessPolicyFacts[] = [
      accessPolicyFacts(inventory(), METER_ON),
      accessPolicyFacts({ ...inventory(), total: 0, rows: [] }, undefined),
      accessPolicyFacts({ ...inventory(), tiers: [] }, null),
      accessPolicyFacts(inventory(), { ...METER_ON, enabled: false, anon_monthly_limit: 3 }),
      accessPolicyFacts(inventory(), { ...METER_ON, anon_monthly_limit: 3 }),
    ];
    const pl = realT("pl");
    const en = realT("en");
    for (const facts of variants) {
      for (const part of describeAccessPolicy(facts)) {
        const textPl = pl(part.key, part.params);
        const textEn = en(part.key, part.params);
        expect(textPl, part.key).not.toBe(part.key);
        expect(textEn, part.key).not.toBe(part.key);
        expect(textPl, part.key).not.toBe(textEn);
      }
    }
  });
});
