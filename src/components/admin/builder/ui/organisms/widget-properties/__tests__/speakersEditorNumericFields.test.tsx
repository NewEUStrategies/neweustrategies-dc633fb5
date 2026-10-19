// SpeakersEditor: pola liczbowe ustawień listy i wiersza prelegenta.
//
// Defekty przypięte tutaj:
//  1. „Limit profili" klampował w KAŻDYM `onChange` (`Number(v) || 24`), więc
//     wyczyszczenie pola od razu wstawiało 24 - „150" wpisywane od zera dawało
//     „24150" i zapis 200. Paginacja zapisywała ułamki, które renderer
//     zaokrągla. Oba pola idą teraz przez wspólny atom `ClampedNumberInput`
//     z zakresami renderera (`speakersQuery`: limit 1-200 po zaokrągleniu,
//     `SpeakersWidget`: paginacja >= 0 po zaokrągleniu).
//  2. Liczniki i ocena wiersza mogły zapisać liczbę NIESKOŃCZONĄ („1e999") -
//     JSON zapisuje ją jako `null`. Walidacja oceny 0-5 (komunikat przy polu
//     i zapis mimo błędu) to decyzja produktowa i ZOSTAJE bez zmian.
//  3. Podpowiedzi kategorii: jedna lista na język dla całego panelu, a nie
//     jedna na wiersz i język (N wierszy = 2N identycznych list w DOM).
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Json, WidgetContent } from "@/lib/builder/types";
import { SpeakersEditor } from "../SpeakersEditor";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

type Row = Record<string, Json>;

function renderEditor(initial: WidgetContent) {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<WidgetContent>(initial);
    return (
      <SpeakersEditor
        c={content}
        lang="pl"
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  render(<Host />);
  const writesOf = (key: string): Json[] => written.filter(([k]) => k === key).map(([, v]) => v);
  return { written, writesOf };
}

function fieldUnder(label: string, index = 0): HTMLInputElement {
  const node = screen.getAllByText(label, { selector: "label" })[index];
  const input = node?.parentElement?.querySelector("input");
  if (!input) throw new Error(`test: brak pola pod „${label}" (#${index})`);
  return input;
}

const speaker = (over: Row = {}): Row => ({
  id: "sp-1",
  name: "Anna Nowak",
  category_pl: "",
  category_en: "",
  gigs: 0,
  rating: 0,
  reviews: 0,
  ...over,
});

afterEach(cleanup);

describe("SpeakersEditor - limit profili i paginacja", () => {
  it("wyczyszczenie limitu nie wstawia 24 - „150” da się wpisać od zera", () => {
    const { writesOf } = renderEditor({ source: "directory", limit: 24 });
    const limit = fieldUnder("Limit profili");
    fireEvent.focus(limit);
    fireEvent.change(limit, { target: { value: "" } });
    expect(limit.value).toBe("");
    for (const typed of ["1", "15", "150"]) {
      fireEvent.change(limit, { target: { value: typed } });
      expect(limit.value).toBe(typed);
    }
    expect(writesOf("limit")).toEqual([1, 15, 150]);
  });

  it("limit zapisany poza zakresem pokazuje to, co pobiera zapytanie", () => {
    const { written } = renderEditor({ source: "directory", limit: 900 });
    expect(fieldUnder("Limit profili").value).toBe("200");
    expect(written).toEqual([]);
  });

  it("paginacja zapisana ułamkiem pokazuje liczbę po zaokrągleniu renderera", () => {
    const { written } = renderEditor({ pageSize: 6.6 });
    expect(fieldUnder("Paginacja (0 = wyłączona)").value).toBe("7");
    expect(written).toEqual([]);
  });

  it("paginacja ujemna jest domykana do zera dopiero przy wyjściu z pola", () => {
    const { writesOf } = renderEditor({ pageSize: 6 });
    const pageSize = fieldUnder("Paginacja (0 = wyłączona)");
    fireEvent.focus(pageSize);
    fireEvent.change(pageSize, { target: { value: "-5" } });
    expect(writesOf("pageSize")).toEqual([]);
    fireEvent.blur(pageSize);
    expect(writesOf("pageSize")).toEqual([0]);
  });
});

describe("SpeakersEditor - liczby wiersza nie zapisują wartości nieskończonej", () => {
  it.each([
    ["Wystąpienia", "gigs"],
    ["Ocena (0-5)", "rating"],
    ["Opinie", "reviews"],
  ])("„%s”: wpis „1e999” zapisuje zero, a nie nieskończoność", (label, key) => {
    const { writesOf } = renderEditor({ speakers: [speaker({ [key]: 2 })] });
    fireEvent.change(fieldUnder(label), { target: { value: "1e999" } });
    const rows = writesOf("speakers").at(-1) as Row[] | undefined;
    expect(rows?.[0]?.[key]).toBe(0);
  });

  it("ocena spoza 0-5 nadal zapisuje się dosłownie i pokazuje komunikat (decyzja produktowa)", () => {
    const { writesOf } = renderEditor({ speakers: [speaker()] });
    fireEvent.change(fieldUnder("Ocena (0-5)"), { target: { value: "7" } });
    expect((writesOf("speakers").at(-1) as Row[])[0]?.rating).toBe(7);
    expect(screen.getByText("Ocena musi mieścić się w zakresie 0-5")).toBeTruthy();
  });
});

describe("SpeakersEditor - podpowiedzi kategorii", () => {
  const rows = [
    speaker({ id: "a", category_pl: "Energetyka", category_en: "Energy" }),
    speaker({ id: "b", category_pl: "Finanse", category_en: "Finance" }),
    speaker({ id: "c", category_pl: "Energetyka", category_en: "" }),
  ];
  const listOf = (input: HTMLInputElement) => input.getAttribute("list") ?? "";

  it("jedna lista podpowiedzi na język dla wszystkich wierszy", () => {
    renderEditor({ speakers: rows });
    const plLists = [0, 1, 2].map((i) => listOf(fieldUnder("Kategoria PL", i)));
    const enLists = [0, 1, 2].map((i) => listOf(fieldUnder("Kategoria EN", i)));
    expect(new Set(plLists).size).toBe(1);
    expect(new Set(enLists).size).toBe(1);
    expect(plLists[0]).not.toBe(enLists[0]);
    // Dwie listy w DOM (PL i EN), a nie 2 x liczba wierszy.
    expect(document.querySelectorAll("datalist")).toHaveLength(2);
    const options = (id: string) =>
      Array.from(document.getElementById(id)?.querySelectorAll("option") ?? []).map((o) => o.value);
    expect(options(plLists[0]!)).toEqual(["Energetyka", "Finanse"]);
    expect(options(enLists[0]!)).toEqual(["Energy", "Finance"]);
  });

  it("dwa panele na jednej stronie nie dzielą identyfikatorów list", () => {
    renderEditor({ speakers: [rows[0]!] });
    renderEditor({ speakers: [rows[1]!] });
    const ids = screen
      .getAllByText("Kategoria PL", { selector: "label" })
      .map((label) => label.parentElement?.querySelector("input")?.getAttribute("list"));
    expect(new Set(ids).size).toBe(2);
  });
});
