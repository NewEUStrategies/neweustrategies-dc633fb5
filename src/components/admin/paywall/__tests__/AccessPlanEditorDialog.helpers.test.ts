// Reguły szkicu planu (`AccessPlanEditorDialog`): co trafia do patcha, jak
// cena przechodzi z jednostek głównych na grosze i jak szkic przeżywa konflikt.
//
// DLACZEGO OSOBNO OD TESTU TRASY. Test trasy dowodzi sklejenia (który zapis
// idzie do bazy po kliknięciu); tu przypinamy regułę na macierzy przypadków,
// których nie warto klikać jeden po drugim: pusty opis (`null` w bazie, `""`
// w polu) NIE jest zmianą, cena „1.299" jest odrzucana, a rebase po konflikcie
// bierze pole admina tylko wtedy, gdy admin je zmienił.
import { describe, expect, it } from "vitest";

import {
  draftFromPlan,
  emptyPlanDraft,
  planColumns,
  planPatch,
  rebaseDraft,
} from "@/components/admin/paywall/accessPlanDraft";
import type { AccessPlanRow } from "@/lib/billing/planQueries";

const row: AccessPlanRow = {
  id: "plan-1",
  tenant_id: "tenant-1",
  name_pl: "Plus",
  name_en: "Plus",
  description_pl: null,
  description_en: "Desc",
  price_cents: 4900,
  currency: "PLN",
  interval: "month",
  active: true,
  for_sale: true,
  sort_order: 2,
  features_pl: ["A", 7, "B"],
  features_en: null,
  badge_pl: null,
  badge_en: "",
  highlighted: false,
  trial_days: 0,
  tier_key: "plus",
  volume_price_cents: null,
  volume_threshold_seats: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-10-19T10:00:00.123456+00:00",
};

describe("plan draft rules", () => {
  it("an untouched draft produces an empty patch (null and empty text are the same value)", () => {
    const base = planColumns(draftFromPlan(row))!;
    expect(planPatch(planColumns(draftFromPlan(row))!, base)).toEqual({});
  });

  it("the price round-trips through main units in both separators", () => {
    expect(draftFromPlan(row, ",").price).toBe("49,00");
    expect(draftFromPlan(row, ".").price).toBe("49.00");
    expect(planColumns({ ...draftFromPlan(row), price: "1 299,50" })?.price_cents).toBe(129950);
  });

  it.each(["1.299", "12,345", "-5", "abc", ""])(
    "an ambiguous or broken price (%s) is refused",
    (price) => {
      expect(planColumns({ ...draftFromPlan(row), price })).toBeNull();
    },
  );

  it("features keep only text lines; trims and drops empty lines on save", () => {
    const draft = draftFromPlan(row);
    expect(draft.features_pl).toBe("A\nB");
    expect(draft.features_en).toBe("");
    expect(planColumns({ ...draft, features_pl: " A \n\n C " })?.features_pl).toEqual(["A", "C"]);
  });

  it("the patch never carries tier_key, identity, the token or volume columns", () => {
    const base = planColumns(draftFromPlan(row))!;
    const patch = planPatch(planColumns({ ...draftFromPlan(row), name_pl: "Plus 2" })!, base);
    expect(patch).toEqual({ name_pl: "Plus 2" });
    const all = planColumns(emptyPlanDraft())!;
    for (const column of [
      "id",
      "tenant_id",
      "tier_key",
      "updated_at",
      "created_at",
      "volume_price_cents",
    ]) {
      expect(all).not.toHaveProperty(column);
    }
  });

  it("a new plan starts at 19,00 PLN monthly, active and on sale", () => {
    expect(planColumns(emptyPlanDraft())).toMatchObject({
      price_cents: 1900,
      currency: "PLN",
      interval: "month",
      active: true,
      for_sale: true,
    });
  });

  it("rebase after a conflict keeps the admin's edits and takes everything else from the server", () => {
    const oldBase = draftFromPlan(row);
    const mine = { ...oldBase, name_pl: "Mój", for_sale: false };
    const fresh = draftFromPlan({ ...row, name_en: "Theirs", price_cents: 5900 });
    expect(rebaseDraft(mine, oldBase, fresh)).toEqual({
      ...fresh,
      name_pl: "Mój",
      for_sale: false,
    });
  });

  it("the currency is normalised to upper case", () => {
    expect(planColumns({ ...draftFromPlan(row), currency: " eur " })?.currency).toBe("EUR");
  });
});
