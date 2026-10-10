// POLA KOLORÓW WYKRESU W PANELU BUILDERA (`chartSeriesColors`, `chartAccent`).
//
// Zastępują zaślepki P0a (pole tekstowe „3;4;8" i pole liczby indeksu).
// Kontrakt zapisu zostaje ten sam - napis POZYCYJNY slotów i indeks liczony
// od zera - ale autor widzi serie z danych widgetu:
//   * próbka przy serii to kolor NARYSOWANY; pod paletą ról pierwsze serie
//     mają etykietę roli zamiast próbnika i zdanie „Kolory własne działają
//     w palecie kategorialnej";
//   * pod paletą kategorialną próbnik zapisuje napis pozycyjny pod kluczem
//     pola (`setContent`), bez kolorów domyślnych;
//   * seria i wycinek wyróżniony wybiera się z NAZW; wybór domyślny zapisuje
//     `null`.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n-chart-data-editor";
import i18n from "@/lib/i18n";
import type { Json } from "@/lib/builder/types";
import type { SchemaField } from "@/lib/builder/schemas";
import { SchemaFieldControl } from "@/components/admin/builder/ui/molecules/SchemaFieldControl";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

type Written = Array<[string, Json]>;

const DANE = "; Eksport; Import; Saldo\n2023; 1; 2; 3\n2024; 4; 5; 6";

function renderField(field: SchemaField, content: Record<string, unknown>) {
  const written: Written = [];
  const setContentPatch = vi.fn();
  render(
    <SchemaFieldControl
      field={field}
      lang="pl"
      content={content}
      setContent={(key, value) => written.push([key, value])}
      setContentPatch={setContentPatch}
    />,
  );
  return { written, setContentPatch };
}

const KOLORY: SchemaField = { key: "seriesColors", type: "chartSeriesColors", label: "Kolory" };
const AKCENT: SchemaField = { key: "accentSeries", type: "chartAccent", label: "Akcent" };
const WYCINEK: SchemaField = { key: "accentCategory", type: "chartAccent", label: "Wycinek" };

describe("chartSeriesColors - próbki serii z danych widgetu", () => {
  it("pod paletą ról: etykiety ról zamiast próbnika i zdanie o palecie kategorialnej", () => {
    renderField(KOLORY, { data: DANE, kind: "bar" });
    expect(screen.getByText("Eksport")).toBeInTheDocument();
    expect(screen.getByText("Akcent")).toBeInTheDocument();
    expect(screen.getByText("Tło 2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kolor serii/ })).toBeNull();
    expect(screen.getByText("Kolory własne działają w palecie kategorialnej")).toBeInTheDocument();
  });

  it("seria wyróżniona ma akcent niezależnie od pozycji", () => {
    renderField(KOLORY, { data: DANE, kind: "bar", accentSeries: 2 });
    const wiersze = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(wiersze[2]).toContain("Akcent");
    expect(wiersze[0]).toContain("Tło 1");
  });

  it("pod paletą kategorialną próbnik zapisuje napis POZYCYJNY pod kluczem pola", () => {
    const { written, setContentPatch } = renderField(KOLORY, {
      data: DANE,
      kind: "bar",
      palette: "categorical",
      seriesColors: "12",
    });
    fireEvent.click(screen.getByRole("button", { name: "Kolor serii Saldo" }));
    fireEvent.click(
      screen.getByRole("radio", { name: String(i18n.t("chartEditor.colors.slots.bordo")) }),
    );
    expect(written).toEqual([["seriesColors", "12;;16"]]);
    expect(setContentPatch).not.toHaveBeenCalled();
  });

  it("widget bez danych mówi, skąd wziąć serie", () => {
    renderField(KOLORY, { data: "" });
    expect(screen.getByText("Najpierw dodaj serie w arkuszu danych.")).toBeInTheDocument();
  });
});

describe("chartAccent - wybór z nazw, zapis indeksu", () => {
  it("seria: lista nazw serii, pierwsza seria zapisuje brak wyboru", () => {
    const { written } = renderField(AKCENT, { data: DANE, accentSeries: 2 });
    const lista = screen.getByRole("combobox", { name: "Akcent" }) as HTMLSelectElement;
    expect(lista.value).toBe("2");
    expect(Array.from(lista.options).map((o) => o.textContent)).toEqual([
      "Eksport",
      "Import",
      "Saldo",
    ]);
    fireEvent.change(lista, { target: { value: "1" } });
    fireEvent.change(lista, { target: { value: "0" } });
    expect(written).toEqual([
      ["accentSeries", 1],
      ["accentSeries", null],
    ]);
  });

  it("wycinek: kategorie i pozycja „największy wycinek”", () => {
    const { written } = renderField(WYCINEK, { data: DANE });
    const lista = screen.getByRole("combobox", { name: "Wycinek" }) as HTMLSelectElement;
    expect(Array.from(lista.options).map((o) => o.textContent)).toEqual([
      "Największy wycinek (domyślnie)",
      "2023",
      "2024",
    ]);
    fireEvent.change(lista, { target: { value: "1" } });
    expect(written).toEqual([["accentCategory", 1]]);
  });

  it("indeks spoza danych pokazuje się jako wybór domyślny", () => {
    renderField(AKCENT, { data: DANE, accentSeries: 9 });
    expect((screen.getByRole("combobox", { name: "Akcent" }) as HTMLSelectElement).value).toBe("0");
  });
});
