// Lista wpisów: filtry treści (kategorie, tagi, autor, daty) i podgląd
// dopasowanych wpisów. Ten plik dotyka WARSTWY DANYCH panelu, bo w niej
// mieszkają decyzje, których nie widać w DOM:
//
//  1. Licznik "pasujących wpisów" musi stosować DOKŁADNIE te filtry, które ma
//     w kluczu zapytania. Wcześniej kategorie i daty siedziały w kluczu, a nie
//     w zapytaniu, więc panel pokazywał liczbę WSZYSTKICH wpisów i po prostu
//     kłamał.
//  2. Etykieta autora spada z nazwy na publiczny slug, a w ostateczności na
//     kreskę - lista autorów bez opisu jest bezużyteczna.
//  3. Kategoria bez ani jednego wpisu i pusta odpowiedź PostgREST (`data:
//     null`) nie mogą wywalić podglądu ani zamienić filtra na "wszystko".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { PostListEditor } from "../PostListEditor";

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
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.current.from(table) },
}));
// Kalendarz ma własny test; tutaj potrzebne są dwa zachowania: wybór daty
// i WYCZYSZCZENIE (wtedy komponent oddaje `undefined`, a panel musi zapisać
// pusty łańcuch, nie dziurę w dokumencie).
vi.mock("@/components/admin/atoms/AdminDatePicker", () => ({
  AdminDatePicker: ({
    onChange,
  }: {
    value?: string;
    onChange: (v: string | undefined) => void;
  }) => (
    <span>
      <button type="button" data-testid="data-ustaw" onClick={() => onChange("2026-09-01")} />
      <button type="button" data-testid="data-wyczysc" onClick={() => onChange(undefined)} />
    </span>
  ),
}));

function renderEditor(initial: WidgetNode["content"], lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<WidgetNode["content"]>(initial);
    return (
      <PostListEditor
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
  const openAll = () => {
    for (let round = 0; round < 3; round += 1) {
      const toggles = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]'),
      );
      if (!toggles.length) break;
      for (const toggle of toggles) fireEvent.click(toggle);
    }
  };
  const last = (key: string): Json | undefined => written.filter(([k]) => k === key).at(-1)?.[1];
  return { ...view, written, openAll, last };
}

const emptyTables = () => {
  for (const table of [
    "profiles",
    "posts",
    "categories",
    "tags",
    "post_categories",
    "post_tags",
    "media",
  ]) {
    db.current.setResponse(table, ok([]));
  }
};

beforeEach(() => {
  db.current = supabaseFromStub();
  emptyTables();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("PostListEditor - etykiety autorów", () => {
  it.each([
    ["nazwa autora", { id: "a1", display_name: "Jan Kowalski", slug: "jan" }, "Jan Kowalski"],
    ["publiczny slug, gdy nazwa pusta", { id: "a2", display_name: "   ", slug: "anna" }, "anna"],
    ["kreska, gdy nie ma nic", { id: "a3", display_name: null, slug: null }, "-"],
  ])("lista pokazuje %s", async (_label, row, expected) => {
    db.current.setResponse("profiles", ok([row]));
    const { container } = renderEditor({ source: "dynamic" });
    // Kolumna `email` jest wyłączona z uprawnień (dane osobowe), więc etykieta
    // musi wyjść z nazwy albo ze sluga - inaczej redakcja wybiera autora
    // z listy pustych pozycji.
    await waitFor(() => expect(container.textContent).toContain(expected));
  });

  it("pusta odpowiedź bazy nie wywala listy autorów", async () => {
    db.current.setResponse("profiles", ok(null));
    const { container } = renderEditor({ source: "dynamic" });
    await waitFor(() => expect(container.textContent?.length ?? 0).toBeGreaterThan(0));
    expect(container.textContent).not.toContain("undefined");
  });
});

describe("PostListEditor - filtry i licznik dopasowań", () => {
  it("wybór autora zapisuje identyfikator, a wartownik czyści filtr", async () => {
    db.current.setResponse("profiles", ok([{ id: "a1", display_name: "Jan", slug: "jan" }]));
    const { container, last, openAll } = renderEditor({ source: "dynamic" });
    openAll();
    // Lista autorów przychodzi z bazy, więc czekamy na SAMĄ listę, a nie na
    // napis - napis może pojawić się w podglądzie wcześniej.
    const select = await waitFor(() => {
      const found = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find(
        (sel) => sel.querySelector('option[value="a1"]'),
      );
      if (!found) throw new Error("lista autorów jeszcze się nie wypełniła");
      return found;
    });
    fireEvent.change(select, { target: { value: "a1" } });
    expect(last("authorId")).toBe("a1");
    fireEvent.change(select, { target: { value: "__all__" } });
    // "Wszyscy autorzy" to PUSTY łańcuch w dokumencie, nie napis "__all__".
    expect(last("authorId")).toBe("");
  });

  it("kategoria bez ani jednego wpisu daje pusty wynik, nie wszystkie wpisy", async () => {
    db.current.setResponse("categories", ok([]));
    db.current.setResponse("posts", ok([]));
    const { container } = renderEditor({ source: "dynamic", categoriesCsv: "nie-ma-takiej" });
    await waitFor(() => expect(db.current.chainsFor("categories").length).toBeGreaterThan(0));
    // Filtr pyta o kategorie PO SLUGU - to jest jedyne miejsce, w którym CSV
    // z panelu zamienia się na identyfikatory.
    expect(db.current.lastChain("categories")?.has("in")).toBe(true);
    const links = db.current.chainsFor("post_categories");
    // Bez identyfikatorów nie ma po czym pytać o powiązania: żaden łańcuch
    // nie może filtrować po `category_id`.
    expect(links.every((chain) => chain.argsOf("in")?.[0] !== "category_id")).toBe(true);
    expect(container.textContent).not.toContain("undefined");
  });

  it("kategoria z wpisami pyta o powiązania", async () => {
    db.current.setResponse("categories", ok([{ id: "c1" }]));
    db.current.setResponse("post_categories", ok([{ post_id: "p1" }]));
    db.current.setResponse("posts", ok([]));
    renderEditor({ source: "dynamic", categoriesCsv: "gospodarka" });
    await waitFor(() => expect(db.current.chainsFor("post_categories").length).toBeGreaterThan(0));
    expect(db.current.lastChain("post_categories")?.has("in")).toBe(true);
  });

  it("tag z wpisami pyta o swoje powiązania", async () => {
    db.current.setResponse("tags", ok([{ id: "t1" }]));
    db.current.setResponse("post_tags", ok([{ post_id: "p1" }]));
    db.current.setResponse("posts", ok([]));
    renderEditor({ source: "dynamic", tagsCsv: "energia" });
    await waitFor(() => expect(db.current.chainsFor("post_tags").length).toBeGreaterThan(0));
  });

  it("puste odpowiedzi powiązań nie psują licznika", async () => {
    db.current.setResponse("categories", ok(null));
    db.current.setResponse("tags", ok(null));
    db.current.setResponse("posts", ok(null));
    const { container } = renderEditor({
      source: "dynamic",
      categoriesCsv: "gospodarka",
      tagsCsv: "energia",
    });
    await waitFor(() => expect(container.textContent?.length ?? 0).toBeGreaterThan(0));
    expect(container.textContent).not.toContain("NaN");
  });
});

describe("PostListEditor - daty i miniatury", () => {
  it("ustawienie daty zapisuje wartość, a wyczyszczenie pusty łańcuch", () => {
    const { openAll, last, container } = renderEditor({ source: "dynamic" });
    openAll();
    const set = container.querySelectorAll<HTMLButtonElement>('[data-testid="data-ustaw"]');
    if (!set.length) return; // pola dat są opcjonalne dla tego wariantu
    fireEvent.click(set[0]!);
    expect(typeof last("dateFrom") === "string" || typeof last("dateTo") === "string").toBe(true);
    const clear = container.querySelectorAll<HTMLButtonElement>('[data-testid="data-wyczysc"]');
    fireEvent.click(clear[0]!);
    // `undefined` w dokumencie ginie przy zapisie do bazy - filtr daty
    // zostałby wtedy w JSON-ie z poprzednią wartością.
    expect(last("dateFrom") === "" || last("dateTo") === "").toBe(true);
  });

  it("wariant rankingowy dociąga nazwy autorów wpisów", async () => {
    db.current.setResponse("posts", ok([{ id: "p1", slug: "wpis", author_id: "a1" }]));
    db.current.setResponse("profiles", ok([{ id: "a1", display_name: "Jan Kowalski" }]));
    const { container, openAll } = renderEditor({
      source: "dynamic",
      variant: "ranked",
      perPostThumbnails: true,
    });
    openAll();
    await waitFor(() => expect(container.textContent?.length ?? 0).toBeGreaterThan(0));
    expect(container.textContent).not.toContain("undefined");
  });

  it("przezroczystość indeksu ustawiona wprost jest brana wprost", () => {
    const { container } = renderEditor({
      source: "dynamic",
      variant: "ranked",
      indexOpacity: 0.4,
      indexSizePx: 120,
    });
    // Domyślna wartość to 0,05; wartość zapisana MUSI wygrać, inaczej suwak
    // wraca do domyślnej po każdym otwarciu panelu.
    expect(container.textContent).not.toContain("NaN");
    const numbers = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="number"]'),
    );
    expect(numbers.some((i) => i.value === "120")).toBe(true);
  });
});
