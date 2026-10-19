// Deep linki huba do modułów źródłowych lądują na WŁAŚCIWEJ zakładce
// (kryterium karty S1: „linki z pulpitu lądują na właściwej zakładce").
//
// DLACZEGO TEN TEST. Hub linkuje do ekranu-właściciela bytu z
// `HUB_SYNC_MANIFEST` (`LinkedSourceHeader`, diagnostyka, kafle). Walidator
// `validateSearch` trasy docelowej odrzuca nieznaną zakładkę po cichu - ekran
// otwiera się wtedy na zakładce DOMYŚLNEJ, a operator widzi plany zamiast
// limitu odsłon, o który pytał. Literówka w manifeście albo zmiana listy
// zakładek w liściu URL nie dałaby żadnego błędu typu: `search` w manifeście
// to luźny słownik napisów. Test przepuszcza każdy link przez TEN SAM
// walidator, którego używa router.
import { describe, expect, it } from "vitest";

import { parseBillingSearch } from "@/lib/admin/billingTabs";
import { parsePaywallSearch } from "@/lib/admin/paywallTabs";
import { parseMembershipSearch, parsePricingSearch } from "@/lib/admin/pricingTabs";
import { HUB_SYNC_MANIFEST } from "@/lib/revenue/syncManifest";

/** Walidatory `validateSearch` tras S1 - te same funkcje, które biorą trasy. */
const VALIDATORS: Readonly<Record<string, (raw: Record<string, unknown>) => object>> = {
  "/admin/paywall": parsePaywallSearch,
  "/admin/pricing": parsePricingSearch,
  "/admin/membership": parseMembershipSearch,
  "/admin/billing": parseBillingSearch,
};

const links = HUB_SYNC_MANIFEST.flatMap((entity) =>
  entity.owners
    .filter((owner) => owner.to in VALIDATORS && owner.search !== undefined)
    .map((owner) => ({ entity: entity.id, to: owner.to, search: owner.search! })),
);

describe("deep linki huba → zakładki modułów S1", () => {
  it("manifest ma linki z zakładką do każdej z czterech tras (kanarek zasięgu)", () => {
    expect(new Set(links.map((link) => link.to))).toEqual(new Set(Object.keys(VALIDATORS)));
  });

  it.each(links)("$entity → $to $search: walidator trasy zachowuje parametry", (link) => {
    const parsed = VALIDATORS[link.to]({ ...link.search });
    // Każdy parametr linku przeżywa walidację bez zmian - inaczej ekran
    // otworzyłby się na zakładce domyślnej.
    expect(parsed).toEqual(expect.objectContaining(link.search));
  });
});
