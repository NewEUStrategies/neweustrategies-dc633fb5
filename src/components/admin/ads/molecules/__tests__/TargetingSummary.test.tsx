// Podsumowanie targetingu w wierszu listy slotow.
//
// PO CO TEN PLIK ISTNIEJE. Ta jedna linijka tekstu jest JEDYNYM miejscem, po
// ktorym redakcja poznaje, czy kreacja leci na CALA witryne, czy tylko na
// wybrane kategorie/tagi/jezyk. Pomylka w te strone jest kosztowna dwukrotnie:
//   * slot zawezony, ktory wyglada na globalny -> reklamodawca placi za emisje,
//     ktorej nie ma, a nikt nie widzi powodu;
//   * slot globalny, ktory wyglada na zawezony -> kreacja partnera pojawia sie
//     pod tekstami, przy ktorych nie miala prawa stanac.
// Dlatego kazdy z czterech ksztaltow targetingu ma tu wlasny przypadek,
// a piaty sprawdza, ze uszkodzony jsonb czyta sie jako „wszystkie strony",
// a nie jako pusty napis (pusta komorka wyglada jak brak danych, nie jak
// brak ograniczen).
//
// Targeting NIE jest tu atrapowany: `parseAdTargeting` to sasiad z
// `@/lib/ads/types`, ktory ma biec naprawde - inaczej test dowodzilby wylacznie
// tego, ze atrapa zwraca to, co jej kazano.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { AdSlot } from "@/lib/ads/types";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import { TargetingSummary } from "../TargetingSummary";

function slot(targeting: Record<string, unknown>): AdSlot {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tenant_id: "22222222-2222-4222-8222-222222222222",
    name: "Baner glowny",
    kind: "html",
    status: "active",
    html: "<div></div>",
    script: null,
    image_url: null,
    image_link: null,
    image_alt: null,
    width: null,
    height: null,
    requires_consent: true,
    targeting,
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("TargetingSummary", () => {
  it("BRAK targetingu czyta sie jako `wszystkie strony`, nie jako pusta komorka", () => {
    render(<TargetingSummary slot={slot({})} />);
    expect(screen.getByText("adsAdmin.summaryAll")).toBeInTheDocument();
  });

  it("uszkodzony jsonb tez konczy sie `wszystkie strony`", () => {
    // Kolumna jest jsonb bez schematu - wiersz sprzed zmiany formatu albo
    // recznie poprawiony w bazie nie moze wywrocic listy slotow.
    render(<TargetingSummary slot={slot({ categorySlugs: "nie-tablica", languages: 7 })} />);
    expect(screen.getByText("adsAdmin.summaryAll")).toBeInTheDocument();
  });

  it("SAME kategorie: liczba plus etykieta ze slownika", () => {
    render(<TargetingSummary slot={slot({ categorySlugs: ["ue", "bezpieczenstwo"] })} />);
    expect(screen.getByText("2 adsAdmin.summaryCategories")).toBeInTheDocument();
  });

  it("SAME tagi", () => {
    render(<TargetingSummary slot={slot({ tagSlugs: ["nato"] })} />);
    expect(screen.getByText("1 adsAdmin.summaryTags")).toBeInTheDocument();
  });

  it("SAME jezyki - wersje wypisane wielkimi literami", () => {
    render(<TargetingSummary slot={slot({ languages: ["pl", "en"] })} />);
    expect(screen.getByText("PL/EN")).toBeInTheDocument();
  });

  it("KOMBINACJA: kategorie, tagi i jezyki rozdzielone dywizem", () => {
    render(
      <TargetingSummary
        slot={slot({ categorySlugs: ["ue", "energia"], tagSlugs: ["nato"], languages: ["pl"] })}
      />,
    );
    expect(
      screen.getByText("2 adsAdmin.summaryCategories - 1 adsAdmin.summaryTags - PL"),
    ).toBeInTheDocument();
  });

  it("puste TABLICE licza sie jak brak ograniczenia", () => {
    // `parseAdTargeting` zwija `[]` do `undefined`; podsumowanie nie moze
    // pokazywac „0 kategorii", bo to sugeruje slot, ktory nigdzie nie leci.
    render(<TargetingSummary slot={slot({ categorySlugs: [], tagSlugs: [], languages: [] })} />);
    expect(screen.getByText("adsAdmin.summaryAll")).toBeInTheDocument();
  });

  it("nieznany kod jezyka jest ODRZUCANY, nie wyswietlany", () => {
    // Do kolumny da sie wpisac dowolny napis; panel emisji zna tylko pl/en,
    // wiec podsumowanie nie moze obiecywac wersji, ktorej silnik nie obsluzy.
    render(<TargetingSummary slot={slot({ languages: ["de", "pl"] })} />);
    expect(screen.getByText("PL")).toBeInTheDocument();
    expect(screen.queryByText(/DE/)).not.toBeInTheDocument();
  });
});
