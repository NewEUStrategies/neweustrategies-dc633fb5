// EDYTOR BLOKU `link-preview` - POWTARZALNE LINKI, PRZEŁĄCZNIKI I KSZTAŁTY Z IMPORTU.
//
// PO CO TEN PLIK. `LinkPreviewBlock` to repeater: lista linków z etykietą
// PL/EN, adresem i opcjonalnym obrazkiem podglądu. Cała jego logika siedzi
// w domknięciach (`patchItem`, `addItem`, `removeItem`), które render nie
// wykonuje - a to w nich decyduje się, czy edycja drugiego linku nie nadpisze
// pierwszego i czy usunięcie nie zabierze sąsiada.
//
// CO MA TU DOWÓD (niezmienniki, nie kształt DOM-u)
//  * każde pole linku zapisuje WŁASNY klucz w TYM wierszu, który redaktor
//    ruszył; dodanie dokłada pusty wiersz na koniec, usunięcie zabiera
//    dokładnie wskazany,
//  * dwa przełączniki są powiązane z etykietami (nazwa dostępna) i zapisują
//    `preview` jako `boolean` oraz `layout` jako „list"/„inline" - te same
//    wartości, które czyta `normalizeLinkPreviewData` po stronie strony,
//  * ustawienia, których edytor nie pokazuje (rozmiar podglądu), przeżywają
//    każdy zapis, a `id` i `type` bloku zostają,
//  * dane z importu (pozycja `null`, wstęp jako obiekt, pola linku jako
//    liczby) nie wchodzą do pól jako „null" ani „[object Object]".
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli (import PIERWSZY):
// `sonner`, Radix `Select`/`Switch` (natywny `role="switch"`), `<Link>`
// routera, klient Supabase, kontekst najemcy, `fetch`. i18n PRAWDZIWE.
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";
import { LinkPreviewBlock } from "../LinkPreviewBlock";

const t = realT("pl");
const lp = (key: string) => t(`blocks.editors.linkPreview.${key}`) as string;

const LINKI: Json[] = [
  {
    labelPl: "Raport roczny",
    labelEn: "Annual report",
    url: "https://example.com/raport",
    imageSrc: "",
  },
  { labelPl: "Metodologia", labelEn: "", url: "https://example.com/metoda", imageSrc: "/m.png" },
];

function blok(data: Record<string, Json>): Block {
  return { id: "lp-1", type: "link-preview", data };
}

function ostatniZapis(changes: Block[]): Block {
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  const zapis = changes[changes.length - 1];
  expect(zapis.id).toBe("lp-1");
  expect(zapis.type).toBe("link-preview");
  return zapis;
}

const pola = (placeholder: string) =>
  screen.queryAllByPlaceholderText(placeholder) as HTMLInputElement[];

describe("blok świeżo wstawiony z palety", () => {
  it("bez linków: zero wierszy, podgląd włączony, układ w linii, nic nie zapisane", () => {
    const { changes } = renderEditor(
      LinkPreviewBlock,
      blok({ introPl: "", introEn: "", items: [], preview: true, layout: "inline" }),
    );
    expect(pola(lp("url"))).toHaveLength(0);
    expect(
      (screen.getByRole("switch", { name: lp("enablePreview") }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByRole("switch", { name: lp("layoutList") }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(screen.getByText(lp("hint"))).toBeTruthy();
    expect(changes).toEqual([]);
  });

  it("„Dodaj link” dokłada PUSTY wiersz na koniec istniejącej listy", () => {
    const { changes } = renderEditor(LinkPreviewBlock, blok({ items: LINKI }));
    fireEvent.click(screen.getByRole("button", { name: lp("addLink") }));
    expect(ostatniZapis(changes).data.items).toEqual([
      ...LINKI,
      { labelPl: "", labelEn: "", url: "", imageSrc: "" },
    ]);
  });
});

describe("wiersze linków - zapis trafia w TEN wiersz", () => {
  it.each([
    ["labelPl", lp("labelPl"), "Metodologia badań"],
    ["labelEn", lp("labelEn"), "Methodology"],
    ["url", lp("url"), "https://example.com/nowa"],
    ["imageSrc", lp("imageSrc"), "/nowy.png"],
  ])("pole `%s` drugiego wiersza zmienia tylko drugi link", (klucz, placeholder, wartosc) => {
    const { changes } = renderEditor(LinkPreviewBlock, blok({ items: LINKI }));
    fireEvent.change(pola(placeholder)[1], { target: { value: wartosc } });
    const items = ostatniZapis(changes).data.items as Json[];
    expect(items[0]).toEqual(LINKI[0]);
    expect(items[1]).toEqual({ ...(LINKI[1] as Record<string, Json>), [klucz]: wartosc });
  });

  it("usunięcie PIERWSZEGO linku zostawia drugi nietknięty", () => {
    const { changes } = renderEditor(LinkPreviewBlock, blok({ items: LINKI }));
    fireEvent.click(screen.getAllByRole("button", { name: lp("removeLink") })[0]);
    expect(ostatniZapis(changes).data.items).toEqual([LINKI[1]]);
  });

  it("ustawienia spoza formularza (rozmiar podglądu) przeżywają edycję linku", () => {
    const { changes } = renderEditor(
      LinkPreviewBlock,
      blok({ items: LINKI, width: 320, height: 200, preview: false }),
    );
    fireEvent.change(pola(lp("labelPl"))[0], { target: { value: "Raport" } });
    const { data } = ostatniZapis(changes);
    expect(data.width).toBe(320);
    expect(data.height).toBe(200);
    expect(data.preview).toBe(false);
  });
});

describe("wstęp i przełączniki", () => {
  it("wstęp PL i EN zapisują osobne klucze", () => {
    const { changes } = renderEditor(LinkPreviewBlock, blok({ items: [] }));
    fireEvent.change(pola(lp("introPl"))[0], { target: { value: "Źródła:" } });
    expect(ostatniZapis(changes).data).toEqual({ items: [], introPl: "Źródła:" });
    fireEvent.change(pola(lp("introEn"))[0], { target: { value: "Sources:" } });
    expect(ostatniZapis(changes).data).toEqual({ items: [], introEn: "Sources:" });
  });

  it("wyłączenie podglądu zapisuje `preview: false`", () => {
    const { changes } = renderEditor(LinkPreviewBlock, blok({}));
    fireEvent.click(screen.getByRole("switch", { name: lp("enablePreview") }));
    expect(ostatniZapis(changes).data).toEqual({ preview: false });
  });

  it("układ listy zapisuje „list”, a jego wyłączenie - „inline”", () => {
    const wlaczanie = renderEditor(LinkPreviewBlock, blok({ layout: "inline" }));
    fireEvent.click(screen.getByRole("switch", { name: lp("layoutList") }));
    expect(ostatniZapis(wlaczanie.changes).data.layout).toBe("list");
    wlaczanie.unmount();

    const wylaczanie = renderEditor(LinkPreviewBlock, blok({ layout: "list" }));
    fireEvent.click(screen.getByRole("switch", { name: lp("layoutList") }));
    expect(ostatniZapis(wylaczanie.changes).data.layout).toBe("inline");
  });

  it("układ spoza {list, inline} czyta się jak „inline” - tak jak na stronie", () => {
    renderEditor(LinkPreviewBlock, blok({ layout: "siatka" }));
    expect(
      (screen.getByRole("switch", { name: lp("layoutList") }) as HTMLInputElement).checked,
    ).toBe(false);
  });
});

describe("dane z importu", () => {
  it("wstęp w kształcie OBIEKTU nie wpisuje „[object Object]”", () => {
    renderEditor(LinkPreviewBlock, blok({ introPl: { tekst: "Źródła" } as Json, items: [] }));
    expect(pola(lp("introPl"))[0].value).toBe("");
  });

  it("pozycja `null` i pola-liczby dają puste pola, a nie „null” czy liczbę", () => {
    renderEditor(
      LinkPreviewBlock,
      blok({ items: [null, { labelPl: 7, url: "https://example.com/a" }] as Json }),
    );
    expect(pola(lp("labelPl")).map((el) => el.value)).toEqual(["", ""]);
    expect(pola(lp("url")).map((el) => el.value)).toEqual(["", "https://example.com/a"]);
  });

  it("`items` w kształcie innym niż tablica daje pustą listę zamiast awarii", () => {
    renderEditor(LinkPreviewBlock, blok({ items: "https://example.com" }));
    expect(pola(lp("url"))).toHaveLength(0);
    expect(screen.getByRole("button", { name: lp("addLink") })).toBeTruthy();
  });
});
