// EDYTORY `icon-box`, `stats-counter`, `testimonials` - ZAPIS I ODCZYT.
//
// PO CO TEN PLIK. Po zdjęciu przejazdu tabeli (`blockEditMatrix.*`, PR #475)
// z rodziny `PresentationBlocks.tsx` nie zostało ani jedno wykonanie: żaden
// test nie montował tych edytorów. A to w nich mieszkają repeatery (liczniki,
// opinie), które przy każdej zmianie PRZEPISUJĄ całą listę pozycji - czyli
// miejsce, w którym zmiana jednego pola może po cichu zmienić inne.
//
// CO MA TU DOWÓD
//  * każde pole zapisuje się pod WŁASNYM kluczem, w TEJ pozycji listy,
//    z `id`/`type` bloku bez zmian; dopisanie i usunięcie trafia w TĘ pozycję,
//  * sam render niczego nie zapisuje,
//  * lista wyboru z wartością spoza opcji pokazuje to, czego UŻYJE renderer
//    publiczny (`renderIconBox`: wyrównanie inne niż „left" -> „center"),
//    a nie pierwszą opcję, którą pokazuje natywny `<select>` bez dopasowania,
//  * liczby czytane są tym samym czytnikiem co renderer (`num`): czas
//    animacji „szybko" to 1500 ms, a nie puste pole i ostrzeżenie Reacta o `NaN`,
//  * ocena opinii jest w edytorze TĄ SAMĄ liczbą, którą narysuje strona
//    (`TestimonialsView`: brak = 0, docięcie do 0-5) - edycja cytatu opinii
//    bez oceny nie może dopisać jej pięciu gwiazdek.
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli edytorów (import
// PIERWSZY). `AdminSelect` to natywny `<select>` i zostaje prawdziwy. i18n
// PRAWDZIWE (`realT`) - etykiety i placeholdery prosto ze słownika.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";
import { IconBoxBlock, StatsCounterBlock, TestimonialsBlock } from "../PresentationBlocks";

const t = realT("pl");
const pb = (key: string) => t(`blocks.editors.presentationBlocks.${key}`) as string;
const pole = (key: string) => t(`blocks.fields.${key}`) as string;

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `blk-${type}`, type, data };
}

function ostatniZapis(changes: Block[]): Block {
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  return changes[changes.length - 1];
}

function wartosci(placeholder: string): string[] {
  return screen
    .queryAllByPlaceholderText(placeholder)
    .map((el) => (el as HTMLInputElement | HTMLTextAreaElement).value);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("karta z ikoną", () => {
  const start = blok("icon-box", { icon: "zap", title: "Szybko", align: "center" });

  it.each([
    [pole("title"), "title", "Bezpiecznie"],
    [pole("description"), "description", "Dane zostają w UE."],
    [pb("buttonUrl"), "href", "/bezpieczenstwo"],
    [pb("buttonLabel"), "linkLabel", "Dowiedz się więcej"],
  ])("pole „%s” zapisuje się pod kluczem `%s`", (placeholder, klucz, wartosc) => {
    const { changes } = renderEditor(IconBoxBlock, start);
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: wartosc } });
    const zapis = ostatniZapis(changes);
    expect(zapis).toMatchObject({ id: start.id, type: "icon-box" });
    expect(zapis.data).toEqual({ ...start.data, [klucz]: wartosc });
  });

  it("lista ikon to PEŁNY zestaw ikon renderera, a wybór zapisuje nazwę ikony", () => {
    const { changes } = renderEditor(IconBoxBlock, start);
    const [ikona] = screen.getAllByRole<HTMLSelectElement>("combobox");
    expect(ikona.value).toBe("zap");
    expect(Array.from(ikona.options).map((o) => o.value)).toEqual([
      "star",
      "heart",
      "zap",
      "shield",
      "trophy",
      "rocket",
      "sparkles",
      "check",
      "clock",
      "globe",
      "users",
      "award",
      "gem",
      "flame",
      "leaf",
      "target",
    ]);
    fireEvent.change(ikona, { target: { value: "rocket" } });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, icon: "rocket" });
  });

  it("pusty blok pokazuje gwiazdkę i wyśrodkowanie - jak renderer - i niczego nie zapisuje", () => {
    const { changes } = renderEditor(IconBoxBlock, blok("icon-box", {}));
    const [ikona, wyrownanie] = screen.getAllByRole<HTMLSelectElement>("combobox");
    expect(ikona.value).toBe("star");
    expect(wyrownanie.value).toBe("center");
    expect(changes).toEqual([]);
  });

  it("wyrównanie SPOZA opcji („right”) pokazuje „Wyśrodkuj”, bo tak narysuje strona", () => {
    // `renderIconBox`: `a === "left" ? "left" : "center"`. Pierwszą opcją listy
    // jest „left" - natywny `<select>` pokazywał więc „Wyrównaj do lewej",
    // a czytelnik widział kartę wyśrodkowaną.
    const { changes } = renderEditor(IconBoxBlock, blok("icon-box", { align: "right" }));
    const wyrownanie = screen.getAllByRole<HTMLSelectElement>("combobox")[1];
    expect(wyrownanie.value).toBe("center");
    expect(changes).toEqual([]);
    fireEvent.change(wyrownanie, { target: { value: "left" } });
    expect(ostatniZapis(changes).data).toEqual({ align: "left" });
  });

  it("POPRAWNE wyrównanie „left” z danych pokazuje się bez zmian", () => {
    renderEditor(IconBoxBlock, blok("icon-box", { align: "left" }));
    expect(screen.getAllByRole<HTMLSelectElement>("combobox")[1].value).toBe("left");
  });
});

describe("liczniki / statystyki", () => {
  const trzy: Json = [
    { value: "100", suffix: "+", label: "Klientów" },
    { value: "50", suffix: "K", label: "Pobrań" },
    { value: "99", suffix: "%", label: "Dostępności" },
  ];

  it("edycja wartości, sufiksu i etykiety trafia w TEN licznik, reszta zostaje", () => {
    const { changes } = renderEditor(StatsCounterBlock, blok("stats-counter", { items: trzy }));
    fireEvent.change(screen.getAllByPlaceholderText(pb("statValue"))[1], {
      target: { value: "75" },
    });
    expect(ostatniZapis(changes).data.items).toEqual([
      { value: "100", suffix: "+", label: "Klientów" },
      { value: "75", suffix: "K", label: "Pobrań" },
      { value: "99", suffix: "%", label: "Dostępności" },
    ]);
    fireEvent.change(screen.getAllByPlaceholderText(pb("statSuffix"))[2], {
      target: { value: " pkt" },
    });
    expect((ostatniZapis(changes).data.items as Json[])[2]).toEqual({
      value: "99",
      suffix: " pkt",
      label: "Dostępności",
    });
    fireEvent.change(screen.getAllByPlaceholderText(pole("label"))[0], {
      target: { value: "Firm" },
    });
    expect((ostatniZapis(changes).data.items as Json[])[0]).toEqual({
      value: "100",
      suffix: "+",
      label: "Firm",
    });
  });

  it("usunięcie zabiera TEN licznik, a dopisanie dokłada pusty na końcu", () => {
    const { changes } = renderEditor(StatsCounterBlock, blok("stats-counter", { items: trzy }));
    const usun = screen.getAllByRole("button", { name: pb("remove") });
    expect(usun).toHaveLength(3);
    fireEvent.click(usun[0]);
    expect((ostatniZapis(changes).data.items as { label: string }[]).map((i) => i.label)).toEqual([
      "Pobrań",
      "Dostępności",
    ]);

    fireEvent.click(screen.getByRole("button", { name: pb("addStat") }));
    const items = ostatniZapis(changes).data.items as Json[];
    expect(items).toHaveLength(4);
    expect(items[3]).toEqual({ value: "", label: "", suffix: "" });
  });

  it("czas animacji zapisuje LICZBĘ pod `duration`, nie ruszając liczników", () => {
    const { changes } = renderEditor(StatsCounterBlock, blok("stats-counter", { items: trzy }));
    const pole = screen.getByRole<HTMLInputElement>("spinbutton", { name: pb("animDuration") });
    expect(pole.value).toBe("1500");
    fireEvent.change(pole, { target: { value: "2500" } });
    expect(ostatniZapis(changes).data).toEqual({ items: trzy, duration: 2500 });
  });

  it("czas animacji „szybko” pokazuje 1500 ms - wartość, z którą animuje renderer", () => {
    // Renderer czyta `num(data, "duration", 1500)`. Edytor robił `Number(…)`,
    // czyli `NaN`: puste pole i ostrzeżenie Reacta o `NaN` w atrybucie `value`.
    const blad = vi.spyOn(console, "error").mockImplementation(() => {});
    const { changes } = renderEditor(
      StatsCounterBlock,
      blok("stats-counter", { duration: "szybko" }),
    );
    expect(
      screen.getByRole<HTMLInputElement>("spinbutton", { name: pb("animDuration") }).value,
    ).toBe("1500");
    expect(blad.mock.calls.flat().join(" ")).not.toContain("NaN");
    expect(changes).toEqual([]);
  });

  it("licznik `null` z importu i licznik bez pól pokazują puste pola, nie „null”", () => {
    const { container } = renderEditor(
      StatsCounterBlock,
      blok("stats-counter", { items: [null, { value: 7 }] as unknown as Json }),
    );
    expect(wartosci(pb("statValue"))).toEqual(["", "7"]);
    expect(wartosci(pb("statSuffix"))).toEqual(["", ""]);
    expect(container.textContent).not.toContain("null");
  });
});

describe("opinie", () => {
  const dwie: Json = [
    { quote: "Świetna analiza.", author: "Anna", role: "CEO", avatar: "", rating: 5 },
    { quote: "Konkretnie.", author: "Jan", role: "", avatar: "", rating: 4 },
  ];

  it.each([
    [pb("quote"), "quote", "Polecam każdemu."],
    [pb("author"), "author", "Janina"],
    [pb("role"), "role", "Dyrektorka"],
    [pb("avatarUrl"), "avatar", "https://cdn.example.com/j.png"],
  ])("pole „%s” drugiej opinii zapisuje `%s` TYLKO w niej", (placeholder, klucz, wartosc) => {
    const { changes } = renderEditor(TestimonialsBlock, blok("testimonials", { items: dwie }));
    fireEvent.change(screen.getAllByPlaceholderText(placeholder)[1], {
      target: { value: wartosc },
    });
    const items = ostatniZapis(changes).data.items as Json[];
    expect(items[0]).toEqual((dwie as Json[])[0]);
    expect(items[1]).toEqual({ ...((dwie as Json[])[1] as object), [klucz]: wartosc });
  });

  it("układ zapisuje się pod `layout`; pusty blok pokazuje siatkę jak renderer", () => {
    const { changes } = renderEditor(TestimonialsBlock, blok("testimonials", {}));
    const uklad = screen.getByRole<HTMLSelectElement>("combobox");
    expect(uklad.value).toBe("grid");
    expect(changes).toEqual([]);
    fireEvent.change(uklad, { target: { value: "slider" } });
    expect(ostatniZapis(changes).data).toEqual({ layout: "slider" });
  });

  it("ocena zapisuje LICZBĘ, a nowa opinia dostaje domyślnie 5 gwiazdek", () => {
    const { changes } = renderEditor(TestimonialsBlock, blok("testimonials", { items: dwie }));
    fireEvent.change(screen.getAllByRole("spinbutton")[1], { target: { value: "3" } });
    expect((ostatniZapis(changes).data.items as { rating: Json }[])[1].rating).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: pb("addTestimonial") }));
    const items = ostatniZapis(changes).data.items as Json[];
    expect(items[2]).toEqual({ quote: "", author: "", role: "", avatar: "", rating: 5 });
  });

  it("usunięcie zabiera TĘ opinię", () => {
    const { changes } = renderEditor(TestimonialsBlock, blok("testimonials", { items: dwie }));
    fireEvent.click(screen.getAllByRole("button", { name: pb("removeTestimonial") })[0]);
    expect((ostatniZapis(changes).data.items as { author: string }[]).map((i) => i.author)).toEqual(
      ["Jan"],
    );
  });

  it("opinia BEZ oceny pokazuje 0, a edycja jej cytatu NIE dopisuje pięciu gwiazdek", () => {
    // Renderer (`TestimonialsView`) czyta brak oceny jako 0 i nie rysuje gwiazdek.
    // Edytor zakładał 5 - redaktor poprawiał literówkę w cytacie, a zapis
    // dopisywał `rating: 5` i na stronie pojawiało się pięć gwiazdek, których
    // nikt nie ustawił.
    const { changes } = renderEditor(
      TestimonialsBlock,
      blok("testimonials", { items: [{ quote: "Dobra robota", author: "Ola" }] as Json }),
    );
    expect(screen.getByRole<HTMLInputElement>("spinbutton").value).toBe("0");
    fireEvent.change(screen.getByPlaceholderText(pb("quote")), {
      target: { value: "Dobra robota!" },
    });
    expect((ostatniZapis(changes).data.items as { rating: Json }[])[0].rating).toBe(0);
  });

  it.each([
    [1e9, "5"],
    [-7, "0"],
    ["pięć", "0"],
    ["4", "4"],
  ] as const)("ocena %j pokazuje %s - tyle gwiazdek narysuje strona", (rating, widac) => {
    const blad = vi.spyOn(console, "error").mockImplementation(() => {});
    renderEditor(
      TestimonialsBlock,
      blok("testimonials", { items: [{ quote: "Q", rating: rating as Json }] as Json }),
    );
    const pole = screen.getByRole<HTMLInputElement>("spinbutton");
    expect(pole.value).toBe(widac);
    expect(Number(pole.value)).toBeGreaterThanOrEqual(Number(pole.min));
    expect(Number(pole.value)).toBeLessThanOrEqual(Number(pole.max));
    expect(blad.mock.calls.flat().join(" ")).not.toContain("NaN");
  });

  it("opinia `null` z importu i opinia bez pól pokazują puste pola, nie „null”", () => {
    const { container } = renderEditor(
      TestimonialsBlock,
      blok("testimonials", { items: [null, { author: "Ola" }] as unknown as Json }),
    );
    expect(wartosci(pb("quote"))).toEqual(["", ""]);
    expect(wartosci(pb("author"))).toEqual(["", "Ola"]);
    expect(container.textContent).not.toContain("null");
  });

  it("wpisana ocena spoza 0-5 zapisuje się DOCIĘTA do granic pola", () => {
    const { changes } = renderEditor(TestimonialsBlock, blok("testimonials", { items: dwie }));
    const oceny = screen.getAllByRole("spinbutton");
    fireEvent.change(oceny[0], { target: { value: "9" } });
    expect((ostatniZapis(changes).data.items as { rating: Json }[])[0].rating).toBe(5);
    fireEvent.change(oceny[1], { target: { value: "-2" } });
    expect((ostatniZapis(changes).data.items as { rating: Json }[])[1].rating).toBe(0);
  });
});
