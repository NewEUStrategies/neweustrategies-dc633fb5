// OBRAZ I ODSTĘP - pola, których zapis nie miał dowodu.
//
// PO CO. `blockEditListAndSlash.test.tsx` dowodzi dwóch powierzchni obrazu
// (pole adresu albo podgląd) i zapisu wymiarów z `onLoad`, a
// `blockEditCoercionDefects.test.tsx` - koercji wartości spoza dziedziny.
// Nikt nie sprawdzał, że podpis, źródło i adres źródła obrazu zapisują się
// pod SWOIMI kluczami (pomyłka klucza to podpis, który znika z publikacji,
// albo „źródło" wpisane jako link), ani że suwak odstępu zapisuje LICZBĘ -
// napis „120" przeszedłby przez render publiczny, ale nie przez porównania
// `===` w historii zmian.
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli, dlatego jego
// import jest PIERWSZY. i18n PRAWDZIWE.
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block } from "@/lib/blocks/types";
import { ImageBlock } from "../Image";
import { SpacerBlock } from "../Spacer";

const OBRAZ: Block = {
  id: "blk-obraz",
  type: "image",
  data: { url: "https://cdn.example.com/a.png", alt: "Wykres", width: 800, height: 600 },
};

function ostatni(changes: readonly Block[], wzor: Block): Block {
  const zapis = changes.at(-1);
  if (!zapis) throw new Error("edytor nie zapisał niczego");
  expect({ id: zapis.id, type: zapis.type }).toEqual({ id: wzor.id, type: wzor.type });
  return zapis;
}

describe("obraz - pusty blok", () => {
  const URL_PH = "Wklej URL obrazu lub ścieżkę z biblioteki mediów…";
  const PUSTY: Block = { id: "blk-pusty", type: "image", data: { url: "", alt: "" } };

  it("adres zapisuje się dopiero po opuszczeniu pola, w jednym wpisie", () => {
    // NAPRAWIONE 2026-10-19: zapis na każdym znaku przełączał blok na podgląd
    // `<img src="h">` po pierwszej literze i pole znikało razem z fokusem.
    const { changes } = renderEditor(ImageBlock, PUSTY);
    const pole = screen.getByPlaceholderText(URL_PH);
    fireEvent.change(pole, { target: { value: "h" } });
    fireEvent.change(pole, { target: { value: "https://cdn.example.com/b.png" } });
    expect(changes).toEqual([]);
    fireEvent.blur(pole);
    expect(changes).toHaveLength(1);
    expect(ostatni(changes, PUSTY).data).toEqual({ url: "https://cdn.example.com/b.png", alt: "" });
  });
});

describe("obraz - pola pod podglądem", () => {
  it.each([
    ["Podpis (opcjonalnie)…", "caption", "Rys. 1. Eksport"],
    ["Nazwa źródła (np. autor, agencja)", "source", "Eurostat"],
    ["https://…", "sourceUrl", "https://ec.europa.eu/eurostat"],
  ])("pole „%s” zapisuje się pod `%s`, zachowując adres, alt i wymiary", (ph, klucz, wpis) => {
    const { changes } = renderEditor(ImageBlock, OBRAZ);
    fireEvent.change(screen.getByPlaceholderText(ph), { target: { value: wpis } });
    expect(changes).toHaveLength(1);
    expect(ostatni(changes, OBRAZ).data).toEqual({ ...OBRAZ.data, [klucz]: wpis });
  });

  it("zapisane podpis i źródło wracają do swoich pól", () => {
    renderEditor(ImageBlock, {
      ...OBRAZ,
      data: { ...OBRAZ.data, caption: "Podpis", source: "GUS", sourceUrl: "https://stat.gov.pl" },
    });
    expect(screen.getByPlaceholderText<HTMLInputElement>("Podpis (opcjonalnie)…").value).toBe(
      "Podpis",
    );
    expect(
      screen.getByPlaceholderText<HTMLInputElement>("Nazwa źródła (np. autor, agencja)").value,
    ).toBe("GUS");
    expect(screen.getByPlaceholderText<HTMLInputElement>("https://…").value).toBe(
      "https://stat.gov.pl",
    );
  });
});

describe("odstęp - suwak wysokości", () => {
  it("suwak ma dostępną nazwę i zapisuje wysokość LICZBĄ", () => {
    const blok: Block = { id: "blk-odstep", type: "spacer", data: { height: 40 } };
    const { changes } = renderEditor(SpacerBlock, blok);
    fireEvent.change(screen.getByRole("slider", { name: "Wysokość:" }), {
      target: { value: "120" },
    });
    expect(ostatni(changes, blok).data).toEqual({ height: 120 });
  });

  it("blok bez wysokości pokazuje domyślne 40 px i nie zapisuje niczego na renderze", () => {
    const { changes, container } = renderEditor(SpacerBlock, {
      id: "blk-odstep",
      type: "spacer",
      data: {},
    });
    expect(changes).toEqual([]);
    expect(container.textContent).toContain("40px");
  });
});
