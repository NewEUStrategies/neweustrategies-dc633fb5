// Molekuły wierszy tabel panelu reklam: CO administrator widzi na liście.
//
// CO TEN PLIK DOWODZI.
//   1. WIERSZ NIE ROZMAWIA Z BAZĄ. Kosz i „Edytuj" oddają zdarzenie wołającemu
//      (z identyfikatorem wiersza, nie z indeksem), więc dowód „usunięcie pyta
//      o potwierdzenie" może stać w organizmie i nie da się go przypadkiem
//      obejść nowym wierszem.
//   2. RODZAJ, POZYCJA I TYP STRONY JADĄ PRZEZ MAPY KLUCZY. Twardy napis w tym
//      miejscu przechodzi przez tsc i recenzję bez śladu - łapie go dopiero
//      asercja na kluczu i18n.
//   3. POZYCJA WSKAZUJĄCA NIEISTNIEJĄCY SLOT POKAZUJE KRESKĘ, a nie znika
//      z tabeli i nie renderuje pustej komórki: pozycja-widmo dalej zajmuje
//      miejsce w `ad_placements` i dalej jest pobierana przez renderery.
//   4. AKTYWNOŚĆ POZYCJI TO ZNAK „✓" ALBO „-", i to JEDYNA informacja o niej
//      w tabeli - więc oba warianty mają dowód (pusta komórka czytałaby się
//      jak „nie wiem").
//   5. PUSTA TABELA MA WIERSZ Z `colSpan` DOPASOWANYM DO LICZBY KOLUMN (6 dla
//      slotów, 5 dla pozycji). Zły `colSpan` rozjeżdża tabelę i tego nie widać
//      w żadnym teście jednostkowym poza tym.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Atomów statusu, zgody, CTR i podsumowania
// targetingu - `adsAtoms.test.tsx`. (2) Ładunków zapisu i dialogów - testy
// organizmów `AdSlotsPanel` / `AdPlacementsPanel`. (3) Kompletności słownika -
// `i18nAdsAdmin.test.ts` i `adsLabelKeys.gate.test.tsx`.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-ads-admin", () => ({ ensureI18n: () => undefined }));

import { AdPlacementRow } from "@/components/admin/ads/molecules/AdPlacementRow";
import { AdSlotRow } from "@/components/admin/ads/molecules/AdSlotRow";
import { AdTableEmptyRow } from "@/components/admin/ads/molecules/AdTableEmptyRow";
import type { AdPlacement, AdSlot } from "@/lib/ads/types";

function inTable(ui: ReactNode) {
  return render(
    <table>
      <tbody>{ui}</tbody>
    </table>,
  );
}

function slot(overrides: Partial<AdSlot> = {}): AdSlot {
  return {
    id: "slot-1",
    tenant_id: "tenant-1",
    name: "Baner nagłówka",
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
    targeting: {},
    notes: null,
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function placement(overrides: Partial<AdPlacement> = {}): AdPlacement {
  return {
    id: "pl-1",
    tenant_id: "tenant-1",
    slot_id: "slot-1",
    position: "top_of_post",
    page_type: "post",
    page_id: null,
    config: {},
    sort_order: 0,
    active: true,
    starts_at: null,
    ends_at: null,
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("wiersz tabeli slotów", () => {
  it("rodzaj kreacji jedzie z mapy kluczy, nie z twardego napisu", () => {
    inTable(
      <AdSlotRow
        slot={slot({ kind: "script" })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        editLabel="Edytuj"
      />,
    );
    expect(screen.getByText("adsAdmin.kinds.script")).toBeTruthy();
  });

  it("'Edytuj' oddaje CAŁY wiersz wołającemu (stąd bierze się ładunek edycji)", () => {
    const onEdit = vi.fn();
    const row = slot({ name: "Sidebar 300x250" });
    inTable(<AdSlotRow slot={row} onEdit={onEdit} onDelete={vi.fn()} editLabel="Edytuj" />);
    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));
    expect(onEdit).toHaveBeenCalledWith(row);
  });

  it("kosz oddaje IDENTYFIKATOR slotu, a nie indeks w tabeli", () => {
    const onDelete = vi.fn();
    inTable(
      <AdSlotRow
        slot={slot({ id: "slot-42" })}
        onEdit={vi.fn()}
        onDelete={onDelete}
        editLabel="Edytuj"
      />,
    );
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onDelete).toHaveBeenCalledWith("slot-42");
  });

  it("wiersz sam z siebie nie usuwa niczego - dopóki nikt nie kliknie, cisza", () => {
    const onDelete = vi.fn();
    const onEdit = vi.fn();
    inTable(<AdSlotRow slot={slot()} onEdit={onEdit} onDelete={onDelete} editLabel="Edytuj" />);
    expect(onDelete).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("wiersz pokazuje status, zgodę i podsumowanie targetingu w JEDNYM przebiegu", () => {
    inTable(
      <AdSlotRow
        slot={slot({ status: "paused", requires_consent: false, targeting: { languages: ["en"] } })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        editLabel="Edytuj"
      />,
    );
    expect(screen.getByText("adsAdmin.slots.statusPaused")).toBeTruthy();
    expect(screen.getByText("adsAdmin.slots.consentNotRequired")).toBeTruthy();
    expect(screen.getByText("EN")).toBeTruthy();
  });
});

describe("wiersz tabeli pozycji", () => {
  it("pozycja i typ strony jadą z map kluczy", () => {
    inTable(
      <AdPlacementRow
        placement={placement({ position: "footer_slideup", page_type: "category" })}
        slotName="Baner nagłówka"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        editLabel="Edytuj"
      />,
    );
    expect(screen.getByText("adsAdmin.positions.footerSlideup")).toBeTruthy();
    expect(screen.getByText("adsAdmin.pageTypes.category")).toBeTruthy();
  });

  it("pozycja wskazująca NIEISTNIEJĄCY slot pokazuje kreskę, a nie pustkę", () => {
    inTable(
      <AdPlacementRow
        placement={placement({ slot_id: "usuniety" })}
        slotName={undefined}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        editLabel="Edytuj"
      />,
    );
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("pozycja aktywna pokazuje '✓' - to JEDYNA informacja o aktywności w tabeli", () => {
    inTable(
      <AdPlacementRow
        placement={placement({ active: true })}
        slotName="Baner"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        editLabel="Edytuj"
      />,
    );
    expect(screen.getByText("✓")).toBeTruthy();
  });

  it("pozycja WYŁĄCZONA pokazuje kreskę, a nie puste miejsce", () => {
    inTable(
      <AdPlacementRow
        placement={placement({ active: false })}
        slotName="Baner"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        editLabel="Edytuj"
      />,
    );
    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.queryByText("✓")).toBeNull();
  });

  it("'Edytuj' oddaje CAŁY wiersz pozycji - stąd bierze się ładunek edycji", () => {
    const onEdit = vi.fn();
    const row = placement({ id: "pl-7", config: { paragraph: 5 } });
    inTable(
      <AdPlacementRow
        placement={row}
        slotName="Baner"
        onEdit={onEdit}
        onDelete={vi.fn()}
        editLabel="Edytuj"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));
    expect(onEdit).toHaveBeenCalledWith(row);
  });

  it("kosz oddaje identyfikator POZYCJI, nie slotu", () => {
    const onDelete = vi.fn();
    inTable(
      <AdPlacementRow
        placement={placement({ id: "pl-9", slot_id: "slot-1" })}
        slotName="Baner"
        onEdit={vi.fn()}
        onDelete={onDelete}
        editLabel="Edytuj"
      />,
    );
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onDelete).toHaveBeenCalledWith("pl-9");
  });
});

describe("wiersz pustej tabeli", () => {
  it("tabela slotów rozciąga komunikat na WSZYSTKIE sześć kolumn", () => {
    inTable(<AdTableEmptyRow colSpan={6}>Brak slotów. Dodaj pierwszy poniżej.</AdTableEmptyRow>);
    const cell = screen.getByText("Brak slotów. Dodaj pierwszy poniżej.");
    expect(cell.getAttribute("colspan")).toBe("6");
  });

  it("tabela pozycji ma PIĘĆ kolumn - inny colSpan rozjechałby układ", () => {
    inTable(<AdTableEmptyRow colSpan={5}>Brak pozycji.</AdTableEmptyRow>);
    expect(screen.getByText("Brak pozycji.").getAttribute("colspan")).toBe("5");
  });
});
