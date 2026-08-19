// Szkic warstwy członkostwa - 0 z 3 funkcji pokrytych do 18.08.2026
// (reguła mieszkała w pliku trasy `/admin/membership`, 898 linii).
//
// `features` to bramki maszynowe: to one decydują, co członek może zrobić
// w serwisie. Panel pozwala je edytować jako surowy JSON, więc walidacja tego
// tekstu jest jedyną barierą między literówką redakcji a warstwą, która nie
// otwiera nic, za co klient zapłacił.
import { describe, expect, it } from "vitest";

import {
  InvalidFeaturesJsonError,
  draftFromTier,
  parseFeaturesJson,
} from "@/lib/admin/membershipDrafts";
import type { MembershipTierRow } from "@/lib/billing/tiers";

function tierRow(overrides: Partial<MembershipTierRow> = {}): MembershipTierRow {
  return {
    id: "tier-1",
    tenant_id: "tenant-1",
    key: "member",
    name_pl: "Członek",
    name_en: "Member",
    description_pl: null,
    description_en: null,
    rank: 10,
    benefits: [{ pl: "Newsletter", en: "Newsletter" }],
    features: { briefings: true },
    active: true,
    is_default: false,
    audience_key: null,
    badge_pl: null,
    badge_en: null,
    highlight: false,
    contact_url: null,
    cta_mode: "auto",
    per_seat: false,
    price_note_pl: null,
    price_note_en: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as MembershipTierRow;
}

describe("draftFromTier - co redakcja widzi po wczytaniu warstwy", () => {
  it("puste opisy schodzą na pusty tekst, nie na napis „null”", () => {
    const draft = draftFromTier(tierRow({ description_pl: null, description_en: null }));

    expect(draft.description_pl).toBe("");
    expect(draft.description_en).toBe("");
  });

  it("możliwości pokazują się jako JEDNOLINIOWY JSON (pole tekstowe, nie edytor)", () => {
    const draft = draftFromTier(tierRow({ features: { briefings: true, expertRequests: 3 } }));

    expect(draft.features).toBe('{"briefings":true,"expertRequests":3}');
    expect(draft.features).not.toContain("\n");
  });

  it("warstwa BEZ możliwości daje pusty obiekt, a nie puste pole", () => {
    // Puste pole zapisałoby się jako `{}` i tak, ale redakcja musi widzieć
    // różnicę między „brak bramek" i „nie wczytało się".
    const draft = draftFromTier(tierRow({ features: null as never }));

    expect(draft.features).toBe("{}");
    expect(draft.rank).toBe(10);
  });

  it("benefity są listą par PL/EN, nie surowym JSON-em", () => {
    const draft = draftFromTier(tierRow());

    expect(draft.benefits).toEqual([{ pl: "Newsletter", en: "Newsletter" }]);
    expect(Array.isArray(draft.benefits)).toBe(true);
  });

  it("ranga, aktywność i flaga domyślności przechodzą bez zmiany", () => {
    const draft = draftFromTier(tierRow({ rank: 30, active: false, is_default: true }));

    expect(draft).toMatchObject({ rank: 30, active: false, is_default: true });
    expect(draft.name_pl).toBe("Członek");
  });
});

describe("parseFeaturesJson - bramka między literówką a warstwą, która nic nie otwiera", () => {
  it("poprawny JSON przechodzi jako obiekt", () => {
    expect(parseFeaturesJson('{"briefings":true}')).toEqual({ briefings: true });
  });

  it("puste pole znaczy „brak dodatkowych bramek”, nie błąd", () => {
    expect(parseFeaturesJson("")).toEqual({});
    expect(parseFeaturesJson("{}")).toEqual({});
  });

  it("NIEPOPRAWNY JSON PRZERYWA zapis własnym typem błędu", () => {
    // Bez tego rzucenia warstwa zapisałaby się z połamanymi bramkami i
    // przestałaby otwierać treści, za które klient zapłacił.
    expect(() => parseFeaturesJson("{briefings: true}")).toThrow(InvalidFeaturesJsonError);
    expect(() => parseFeaturesJson("{")).toThrow(InvalidFeaturesJsonError);
  });

  it("typ błędu daje się rozpoznać (panel tłumaczy go na komunikat)", () => {
    try {
      parseFeaturesJson("nie-json");
      expect.unreachable("powinno rzucić");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidFeaturesJsonError);
      expect((err as Error).name).toBe("InvalidFeaturesJsonError");
    }
  });

  it("liczba i napis są poprawnym JSON-em - reguła ich NIE odrzuca", () => {
    // Świadome przypięcie stanu: walidacja pilnuje wyłącznie składni. Kształt
    // (obiekt bramek) sprawdza dopiero baza i warstwa odczytu.
    expect(parseFeaturesJson("42")).toBe(42);
    expect(parseFeaturesJson('"tekst"')).toBe("tekst");
  });
});
