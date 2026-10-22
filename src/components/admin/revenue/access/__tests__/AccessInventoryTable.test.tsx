// `AccessInventoryTable` - inwentarz reguł dostępu (S7, SPEC §6.1, §6.8).
//
// CO TEN PLIK DOWODZI.
//   1. Tabela dostępna: `caption`, nagłówki kolumn `scope="col"`, nagłówki
//      wierszy `scope="row"`, przewijany region z nazwą i `tabIndex=0`.
//   2. Każda komórka inwentarza S3 jest wierszem z napisami słownika S3
//      (rodzaj, tryb, próg, licznik) i liczbą.
//   3. Po angielsku i axe bez naruszeń.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { AccessInventoryTable } from "@/components/admin/revenue/access/AccessInventoryTable";
import type { AccessInventoryDto } from "@/lib/revenue/access/dto";
import { ACCESS_INVENTORY, clone } from "../../overview/__tests__/hubFixtures";

const inventory = () => clone(ACCESS_INVENTORY) as AccessInventoryDto;

beforeEach(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

describe("AccessInventoryTable", () => {
  it("region przewijany: nazwa, fokus z klawiatury, tabela z caption", () => {
    render(<AccessInventoryTable inventory={inventory()} />);
    const region = screen.getByRole("region", {
      name: "Inwentarz dostępu - przewiń w poziomie na wąskim ekranie",
    });
    expect(region).toHaveAttribute("tabindex", "0");
    const table = within(region).getByRole("table", {
      name: "Reguły dostępu według rodzaju treści, trybu, progu warstwy i licznika",
    });
    for (const header of within(table).getAllByRole("columnheader")) {
      expect(header).toHaveAttribute("scope", "col");
    }
    for (const header of within(table).getAllByRole("rowheader")) {
      expect(header).toHaveAttribute("scope", "row");
    }
  });

  it("wiersz na komórkę inwentarza, napisy słownika S3", () => {
    render(<AccessInventoryTable inventory={inventory()} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.textContent)).toEqual([
      "WpisyPłatneBez proguLicznik wg ustawień5",
      "WpisyDla zalogowanychRanga od 2Poza licznikiem3",
      "StronyPubliczneBez proguLicznik wg ustawień3",
      "MediaNa hasłoBez proguPoza licznikiem1",
    ]);
  });

  it("po angielsku", async () => {
    await i18n.changeLanguage("en");
    render(<AccessInventoryTable inventory={inventory()} />);
    expect(screen.getByRole("columnheader", { name: "Content type" })).toBeInTheDocument();
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = render(<AccessInventoryTable inventory={inventory()} />);
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
