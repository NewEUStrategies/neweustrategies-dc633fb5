// Mapper partnerow z RPC panelu na model publicznego pasa poziomow.
//
// CO TU JEST PILNOWANE: podglad studia ma pokazac TE SAME grupy w TEJ SAMEJ
// kolejnosci, co strona publiczna (`ORDER BY t.rank DESC, t.sort_order, t.key`)
// - a przypiecia nieogloszone albo odsiac (domyslnie: sponsor przy sesji
// i sciezce), albo pokazac ZNACZONE (`includeDrafts`: pas i sekcja
// „Partnerzy" w podgladzie), nigdy nieoznaczone. Do tego STATUS listy:
// pusta lista w trakcie wczytywania albo po awarii to nie „brak partnerow".
import { describe, expect, it } from "vitest";
import {
  PREVIEW_SPONSORS_PENDING,
  PREVIEW_SPONSORS_READY,
  previewSponsorsStatus,
  sponsorTiersFromAdminRows,
  type PreviewSponsorsQueryState,
} from "@/lib/events/sponsorsPreview";
import type { EventSponsorRow, EventSponsorTierRow } from "@/lib/events/sponsorsApi";

function row(overrides: Partial<EventSponsorRow>): EventSponsorRow {
  return {
    id: "s-1",
    snapshot_name: "Acme",
    is_published: true,
    sort_order: 0,
    ...overrides,
  } as EventSponsorRow;
}

/** Wiersz `admin_event_sponsor_tiers_list` - tylko pola, ktore mapper czyta. */
function tierRow(overrides: Partial<EventSponsorTierRow>): EventSponsorTierRow {
  return {
    id: "t",
    description_pl: "",
    description_en: "",
    benefits: [],
    sort_order: 0,
    ...overrides,
  } as EventSponsorTierRow;
}

describe("sponsorTiersFromAdminRows", () => {
  it("grupuje po poziomie i ustawia rangi malejaco, grupe bez poziomu na koncu", () => {
    const tiers = sponsorTiersFromAdminRows([
      row({ id: "a", snapshot_name: "Bez poziomu", tier_id: undefined }),
      row({ id: "b", snapshot_name: "Srebro", tier_id: "t-silver", tier_rank: 10 }),
      row({ id: "c", snapshot_name: "Zloto", tier_id: "t-gold", tier_rank: 30 }),
    ]);

    expect(tiers.map((tier) => tier.tierId)).toEqual(["t-gold", "t-silver", null]);
    expect(tiers[0].sponsors[0].name).toBe("Zloto");
  });

  it("DOMYSLNIE odsiewa przypiecia nieogloszone i pozycje bez nazwy", () => {
    const tiers = sponsorTiersFromAdminRows([
      row({ id: "a", is_published: false }),
      row({ id: "b", snapshot_name: undefined, crm_name: undefined }),
      row({ id: "c", snapshot_name: "Widoczny" }),
    ]);

    expect(tiers).toHaveLength(1);
    expect(tiers[0].sponsors.map((sponsor) => sponsor.name)).toEqual(["Widoczny"]);
    // Ogloszony partner NIE jest szkicem - plakietka sie przy nim nie pojawi.
    expect(tiers[0].sponsors[0].isDraft).toBe(false);
  });

  it("`includeDrafts: false` to ten sam filtr, co brak opcji", () => {
    const tiers = sponsorTiersFromAdminRows([row({ id: "a", is_published: false })], {
      includeDrafts: false,
    });
    expect(tiers).toEqual([]);
  });

  // Tablica „Sponsorzy i reklama" zapisuje nowe logo jako nieogloszone. Podglad
  // bez tej opcji pokazywal pustke w miejscu logotypow, ktore organizator
  // widzial na tablicy.
  it("z `includeDrafts` nieogloszony partner WCHODZI - i jest ZNACZONY", () => {
    const tiers = sponsorTiersFromAdminRows(
      [
        row({ id: "a", snapshot_name: "Szkic", tier_id: "t", is_published: false, sort_order: 1 }),
        row({ id: "b", snapshot_name: "Ogloszony", tier_id: "t", sort_order: 2 }),
        // Brak wartosci to NIE ogloszenie - baza oddaje boolean, a niepewnosc
        // ma sie skonczyc plakietka, nie obietnica.
        row({ id: "c", snapshot_name: "Bez pola", tier_id: "t", is_published: undefined }),
      ],
      { includeDrafts: true },
    );

    expect(tiers[0].sponsors.map((sponsor) => [sponsor.name, sponsor.isDraft])).toEqual([
      ["Bez pola", true],
      ["Szkic", true],
      ["Ogloszony", false],
    ]);
  });

  it("opis i korzysci poziomu przychodza z listy poziomow, a nie sa zgadywane", () => {
    const tiers = sponsorTiersFromAdminRows(
      [
        row({ id: "a", tier_id: "t-gold", tier_rank: 30 }),
        row({ id: "b", tier_id: "t-silver", tier_rank: 20 }),
        row({ id: "c", tier_id: undefined }),
      ],
      {
        tiers: [
          tierRow({
            id: "t-gold",
            description_pl: "Najwyzszy pakiet",
            description_en: "Top package",
            benefits: [
              { id: "b1", label_pl: "Stoisko", label_en: "Booth", sort_order: 1 },
              // Pozycja bez identyfikatora wypada - bez klucza React zgubi ja
              // przy pierwszym przerysowaniu.
              { label_pl: "Bez id" },
            ],
          }),
        ],
      },
    );

    const [gold, silver, noTier] = tiers;
    expect(gold.descriptionPl).toBe("Najwyzszy pakiet");
    expect(gold.descriptionEn).toBe("Top package");
    expect(gold.benefits).toEqual([{ id: "b1", labelPl: "Stoisko", labelEn: "Booth" }]);
    // Poziom spoza listy poziomow (zapytanie w locie albo usuniety w miedzyczasie)
    // i grupa bez poziomu nie dostaja cudzego opisu - zostaja puste.
    for (const tier of [silver, noTier]) {
      expect(tier.descriptionPl).toBeNull();
      expect(tier.descriptionEn).toBeNull();
      expect(tier.benefits).toEqual([]);
    }
  });

  it("przy rownej randze decyduje `sort_order` poziomu, dopiero potem klucz - jak w RPC", () => {
    const tiers = sponsorTiersFromAdminRows(
      [
        row({ id: "a", tier_id: "t-a", tier_key: "alfa", tier_rank: 10 }),
        row({ id: "b", tier_id: "t-b", tier_key: "beta", tier_rank: 10 }),
        row({ id: "c", tier_id: "t-c", tier_key: "gamma", tier_rank: 10 }),
        row({ id: "d", tier_id: "t-d", tier_key: "delta", tier_rank: 10 }),
        row({ id: "e", tier_id: "t-e", tier_rank: 10 }),
      ],
      {
        tiers: [
          tierRow({ id: "t-a", sort_order: 30 }),
          tierRow({ id: "t-b", sort_order: 10 }),
          tierRow({ id: "t-c", sort_order: 20 }),
        ],
      },
    );

    // Alfabet dalby alfa, beta, delta, gamma. Poziomy spoza listy (t-d, t-e)
    // ida za znanymi (`NULLS LAST`), a miedzy soba po kluczu - brak klucza
    // przed kluczem, jak pusty napis przed litera.
    expect(tiers.map((tier) => tier.tierId)).toEqual(["t-b", "t-c", "t-a", "t-e", "t-d"]);
  });

  it("w grupie sortuje po sort_order, a przy remisie po nazwie", () => {
    const tiers = sponsorTiersFromAdminRows([
      row({ id: "a", snapshot_name: "Zeta", tier_id: "t", sort_order: 1 }),
      row({ id: "b", snapshot_name: "Alfa", tier_id: "t", sort_order: 1 }),
      row({ id: "c", snapshot_name: "Omega", tier_id: "t", sort_order: 0 }),
    ]);

    expect(tiers[0].sponsors.map((sponsor) => sponsor.name)).toEqual(["Omega", "Alfa", "Zeta"]);
  });

  it("bierze dane z migawki, a z CRM dopiero w jej braku", () => {
    const [tier] = sponsorTiersFromAdminRows([
      row({
        id: "a",
        snapshot_name: "Migawka",
        snapshot_logo_url: undefined,
        crm_logo_url: "https://example.com/logo.svg",
        snapshot_website: "https://migawka.example",
        crm_website: "https://crm.example",
      }),
    ]);

    expect(tier.sponsors[0].logoUrl).toBe("https://example.com/logo.svg");
    expect(tier.sponsors[0].websiteUrl).toBe("https://migawka.example");
  });

  it("brak klucza poziomu przy remisie stoi przed kluczem - niezaleznie od kolejnosci wierszy", () => {
    const zKluczem = row({ id: "a", tier_id: "t-k", tier_key: "k", tier_rank: 5 });
    const bezKlucza = row({ id: "b", tier_id: "t-0", tier_rank: 5 });

    const tam = sponsorTiersFromAdminRows([zKluczem, bezKlucza]).map((tier) => tier.tierId);
    const zPowrotem = sponsorTiersFromAdminRows([bezKlucza, zKluczem]).map((tier) => tier.tierId);
    expect(tam).toEqual(["t-0", "t-k"]);
    expect(zPowrotem).toEqual(tam);
  });

  it("rola i rozmiar logotypu ida z wiersza, a nieznane wartosci spadaja na domyslne", () => {
    const [znane] = sponsorTiersFromAdminRows([
      row({ id: "a", tier_id: "t", role: "media_partner", tier_logo_size: "lg" }),
    ]);
    expect(znane.sponsors[0].role).toBe("media_partner");
    expect(znane.logoSize).toBe("lg");

    const [nieznane] = sponsorTiersFromAdminRows([
      row({ id: "b", tier_id: "t", role: "mecenas", tier_logo_size: "xl" }),
    ]);
    expect(nieznane.sponsors[0].role).toBe("sponsor");
    expect(nieznane.logoSize).toBe("md");
  });

  it("wiersz bez `sort_order` staje na swojej pozycji w grupie", () => {
    const [tier] = sponsorTiersFromAdminRows([
      row({ id: "a", snapshot_name: "Pierwszy", tier_id: "t", sort_order: undefined }),
      row({ id: "b", snapshot_name: "Drugi", tier_id: "t", sort_order: undefined }),
    ]);
    expect(tier.sponsors.map((sponsor) => [sponsor.name, sponsor.sortOrder])).toEqual([
      ["Pierwszy", 0],
      ["Drugi", 1],
    ]);
  });

  it("pusta lista i brak danych nie wywracaja pasa", () => {
    expect(sponsorTiersFromAdminRows([])).toEqual([]);
    expect(sponsorTiersFromAdminRows(null)).toEqual([]);
    expect(sponsorTiersFromAdminRows(undefined, { includeDrafts: true })).toEqual([]);
  });
});

describe("previewSponsorsStatus - pusta lista to jeszcze nie „brak partnerow”", () => {
  const zapytanie = (patch: Partial<PreviewSponsorsQueryState>): PreviewSponsorsQueryState => ({
    isPending: false,
    isError: false,
    error: null,
    fetchStatus: "idle",
    ...patch,
  });
  const opisz = (error: unknown) => `awaria:${String(error)}`;

  it("awaria wygrywa i niesie zdanie z mapy odmow wolajacego", () => {
    expect(previewSponsorsStatus(zapytanie({ isError: true, error: "forbidden" }), opisz)).toEqual({
      state: "error",
      message: "awaria:forbidden",
    });
  });

  it("pierwsze pobranie (takze wstrzymane bez sieci) to wczytywanie", () => {
    expect(
      previewSponsorsStatus(zapytanie({ isPending: true, fetchStatus: "fetching" }), opisz),
    ).toBe(PREVIEW_SPONSORS_PENDING);
    expect(
      previewSponsorsStatus(zapytanie({ isPending: true, fetchStatus: "paused" }), opisz),
    ).toBe(PREVIEW_SPONSORS_PENDING);
  });

  it("zapytanie WYLACZONE (brak wydarzenia) nie wczytuje sie w nieskonczonosc", () => {
    // `pending` + `idle` to stan na zawsze - liczony jako wczytywanie dalby
    // szkielet, ktory nigdy nie znika.
    expect(previewSponsorsStatus(zapytanie({ isPending: true, fetchStatus: "idle" }), opisz)).toBe(
      PREVIEW_SPONSORS_READY,
    );
  });

  it("odpowiedz (takze odswiezana w tle) to gotowosc - ta sama stala, nie nowy obiekt", () => {
    expect(previewSponsorsStatus(zapytanie({}), opisz)).toBe(PREVIEW_SPONSORS_READY);
    expect(previewSponsorsStatus(zapytanie({ fetchStatus: "fetching" }), opisz)).toBe(
      PREVIEW_SPONSORS_READY,
    );
  });
});
