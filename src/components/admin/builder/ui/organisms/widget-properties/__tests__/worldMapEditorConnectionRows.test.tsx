// WorldMapEditor - wiersze połączeń: dodawanie, duplikowanie, usuwanie
// i ręczne pola punktu łuku.
//
// Przeciąganie, walidację zakresu, wybór kraju i podpięcie profilu pilnuje
// `variantDrivenEditors`. Tu - to, co redakcja robi najczęściej:
//  1. Nowe połączenie DZIEDZICZY początek po ostatnim (typowy układ „centrala
//     -> świat"), a pusta lista zaczyna od Brukseli.
//  2. Duplikat ląduje TUŻ ZA oryginałem, z nowym identyfikatorem (klucz
//     sortowania nie może się powtórzyć), usunięcie zabiera wskazany wiersz.
//  3. Pola szerokości/długości zapisują LICZBĘ (puste pole = 0, nie NaN),
//     etykiety - klucze `start*/end*` właściwego języka.
//  4. Tytuł ramki mówi „skąd → dokąd", a bez etykiet - numer pozycji.
//
// Granice: atrapy Radix Select/Switch, i18n jako echo klucza, Supabase
// (łańcuch z `@/test/supabaseChain`; profile dla trybu ekspertów).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { WorldMapEditor } from "../WorldMapEditor";

const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.current.from(table) },
}));

type Connection = Record<string, unknown>;

function renderMap(initial: WidgetNode["content"], lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<WidgetNode["content"]>(initial);
    return (
      <WorldMapEditor
        c={content}
        lang={lang}
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  const view = renderWithQueryClient(<Host />);
  const connections = () =>
    (written.filter(([k]) => k === "connections").at(-1)?.[1] ?? []) as Connection[];
  return { ...view, written, connections };
}

const BRUSSELS_WARSAW: Record<string, Json> = {
  id: "wm-1",
  startLabel_pl: "Bruksela",
  startLabel_en: "Brussels",
  startLat: 50.85,
  startLng: 4.35,
  startUserId: "",
  endLabel_pl: "Warszawa",
  endLabel_en: "Warsaw",
  endLat: 52.23,
  endLng: 21.01,
  endUserId: "",
  href: "",
};

/** Ramka wiersza po jej tytule. */
const rowTitled = (title: string): HTMLElement => {
  const el = screen.getByText(title).closest<HTMLElement>("div.border");
  if (!el) throw new Error(`test: brak wiersza „${title}"`);
  return el;
};
/** Pola o danej etykiecie w obrębie wiersza (początek łuku jest pierwszy). */
const fieldsIn = (row: HTMLElement, label: string): HTMLInputElement[] =>
  within(row)
    .getAllByText(label, { selector: "label" })
    .map((el) => el.parentElement?.querySelector<HTMLInputElement>("input"))
    .filter((el): el is HTMLInputElement => !!el);

beforeEach(() => {
  db.current = supabaseFromStub();
  db.current.setResponse("profiles_public", ok([]));
});

describe("WorldMapEditor - dodawanie, duplikowanie, usuwanie", () => {
  it("sam render niczego nie zapisuje", () => {
    const { written } = renderMap({ connections: [BRUSSELS_WARSAW] });
    expect(written).toEqual([]);
  });

  it("nowe połączenie dziedziczy początek po ostatnim, koniec jest pusty", () => {
    const { connections } = renderMap({ connections: [BRUSSELS_WARSAW] });
    fireEvent.click(screen.getByRole("button", { name: /common\.add/ }));
    const added = connections()[1]!;
    expect(added).toMatchObject({
      startLabel_pl: "Bruksela",
      startLabel_en: "Brussels",
      startLat: 50.85,
      startLng: 4.35,
      startUserId: "",
      endLabel_pl: "",
      endLabel_en: "",
      endLat: 0,
      endLng: 0,
      endUserId: "",
      href: "",
    });
    expect(String(added.id)).toMatch(/^wm-/);
    expect(connections()[0]).toEqual(BRUSSELS_WARSAW);
  });

  it("pierwsze połączenie na pustej liście zaczyna od Brukseli", () => {
    const { connections } = renderMap({});
    fireEvent.click(screen.getByRole("button", { name: /common\.add/ }));
    expect(connections()).toHaveLength(1);
    expect(connections()[0]).toMatchObject({ startLabel_pl: "", startLat: 50.85, startLng: 4.35 });
  });

  it("duplikat ląduje tuż za oryginałem, z nowym identyfikatorem", () => {
    const other = { ...BRUSSELS_WARSAW, id: "wm-2", endLabel_pl: "Praga" };
    const { connections } = renderMap({ connections: [BRUSSELS_WARSAW, other] });
    fireEvent.click(screen.getAllByRole("button", { name: "Duplikuj połączenie" })[0]!);
    const list = connections();
    expect(list.map((x) => x.endLabel_pl)).toEqual(["Warszawa", "Warszawa", "Praga"]);
    const { id: copyId, ...copy } = list[1]!;
    const { id: _origId, ...orig } = BRUSSELS_WARSAW;
    expect(copy).toEqual(orig);
    expect(copyId).not.toBe("wm-1");
    expect(String(copyId)).toMatch(/^wm-/);
  });

  it("usunięcie zabiera wskazany wiersz", () => {
    const other = { ...BRUSSELS_WARSAW, id: "wm-2", endLabel_pl: "Praga" };
    const { connections } = renderMap({ connections: [BRUSSELS_WARSAW, other] });
    fireEvent.click(screen.getAllByRole("button", { name: "builder.common.delete" })[0]!);
    expect(connections().map((x) => x.id)).toEqual(["wm-2"]);
  });
});

describe("WorldMapEditor - pola punktu łuku", () => {
  it("szerokość i długość końca zapisują liczby w tym połączeniu", () => {
    const { connections } = renderMap({ connections: [BRUSSELS_WARSAW] });
    const row = rowTitled("Bruksela → Warszawa");
    fireEvent.change(fieldsIn(row, "Szerokość (lat)")[1]!, { target: { value: "48.85" } });
    fireEvent.change(fieldsIn(row, "Długość (lng)")[1]!, { target: { value: "2.35" } });
    expect(connections()[0]).toEqual({ ...BRUSSELS_WARSAW, endLat: 48.85, endLng: 2.35 });
  });

  it("wyczyszczone pole współrzędnej zapisuje 0, nie NaN", () => {
    const { connections } = renderMap({ connections: [BRUSSELS_WARSAW] });
    const row = rowTitled("Bruksela → Warszawa");
    fireEvent.change(fieldsIn(row, "Szerokość (lat)")[0]!, { target: { value: "" } });
    fireEvent.change(fieldsIn(row, "Długość (lng)")[0]!, { target: { value: "" } });
    expect(connections()[0]).toMatchObject({ startLat: 0, startLng: 0 });
  });

  it("etykiety PL/EN obu końców i link zapisują swoje klucze", () => {
    const { connections } = renderMap({ connections: [BRUSSELS_WARSAW] }, "en");
    const row = rowTitled("Brussels → Warsaw");
    fireEvent.change(fieldsIn(row, "Label PL")[0]!, { target: { value: "Bruksela-centrum" } });
    fireEvent.change(fieldsIn(row, "Label EN")[1]!, { target: { value: "Warsaw HQ" } });
    fireEvent.change(fieldsIn(row, "Link (optional)")[0]!, { target: { value: "/biura" } });
    expect(connections()[0]).toEqual({
      ...BRUSSELS_WARSAW,
      startLabel_pl: "Bruksela-centrum",
      endLabel_en: "Warsaw HQ",
      href: "/biura",
    });
  });

  it('tytuł ramki: brak etykiet = numer pozycji, jedna etykieta = „Początek → …"', () => {
    renderMap({
      connections: [{ id: "a" }, { id: "b", endLabel_pl: "Warszawa" }],
    });
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("Początek → Warszawa")).toBeInTheDocument();
  });

  it("tytuł ramki w EN spada na etykietę polską, gdy angielskiej brak", () => {
    renderMap(
      { connections: [{ id: "a", startLabel_pl: "Bruksela", endLabel_pl: "Wilno" }] },
      "en",
    );
    expect(screen.getByText("Bruksela → Wilno")).toBeInTheDocument();
  });
});

describe("WorldMapEditor - ustawienia mapy", () => {
  it('źródło etykiet zapisuje „experts" i dokłada pickery profili', () => {
    const { written } = renderMap({ connections: [BRUSSELS_WARSAW] });
    expect(screen.queryAllByPlaceholderText("Szukaj profilu…")).toHaveLength(0);
    const source = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
      s.querySelector('option[value="experts"]'),
    )!;
    fireEvent.change(source, { target: { value: "experts" } });
    expect(written).toEqual([["source", "experts"]]);
    expect(screen.getAllByPlaceholderText("Szukaj profilu…")).toHaveLength(2);
  });

  it("nieznane źródło pokazuje tryb ręczny", () => {
    renderMap({ source: "satelita", connections: [BRUSSELS_WARSAW] });
    const source = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
      s.querySelector('option[value="experts"]'),
    )!;
    expect(source.value).toBe("manual");
  });
});
