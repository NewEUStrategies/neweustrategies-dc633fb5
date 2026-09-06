// RatedListEditor: kontrolki, ktore panel obiecywal, a model/renderer nie
// dowoziły.
//
// Regresje przypiete tutaj:
//  1. Reczna pozycja nie miala pola `href`, wiec cala sekcja "Read More" byla
//     martwa (przycisk jest bramkowany na href), a tytul nieklikalny.
//  2. `showRating` w trybie dynamicznym niczego nie wlaczal - wpisy nie maja
//     kolumny z ocena. Zamiast martwego przelacznika panel pokazuje wyjasnienie.
//  3. Domyslna liczba kolumn na tablecie w panelu (1) rozjezdzala sie z
//     rendererem (min(desktop, 2)).
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import { toJson, type Json, type WidgetContent } from "@/lib/builder/types";
import { RatedListEditor } from "../RatedListEditor";
import { RatedListView } from "@/components/builder/organisms/widget-view/RatedListView";

// Blok „Query Settings" trybu dynamicznego montuje `TaxonomyPicker`, ktory
// podpowiada kategorie i tagi Z BAZY. Bez atrapy lista podpowiedzi jest pusta,
// a wtedy plakietki wybranych pozycji (jedyne wyjscie z filtra bez otwierania
// warstwy rozwijanej) w ogole sie nie renderuja.
const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.current.from(table) },
}));

type Recorded = Array<[string, Json]>;

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderEditor(content: WidgetContent, lang: "pl" | "en" = "pl") {
  const calls: Recorded = [];
  const setContent = vi.fn((k: string, v: Json) => {
    calls.push([k, v]);
  });
  // Tryb dynamiczny montuje TaxonomyPicker (react-query), wiec panel zawsze
  // potrzebuje klienta.
  const view = render(
    <QueryClientProvider client={makeClient()}>
      <RatedListEditor c={content} lang={lang} setContent={setContent} />
    </QueryClientProvider>,
  );
  return { calls, setContent, ...view };
}

function itemsFrom(calls: Recorded): Array<Record<string, unknown>> {
  const last = calls.filter(([key]) => key === "items").at(-1);
  const value = last?.[1];
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

/**
 * Rozwija sekcje panelu po fragmencie jej tytulu (sekcje sa domyslnie zwiniete)
 * i zwraca jej kontener, zeby asercje nie lapaly pol z sasiednich sekcji.
 */
function openSection(match: RegExp): HTMLElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (b) => b.getAttribute("aria-expanded") !== null && match.test(b.textContent ?? ""),
  );
  expect(button, `nie znaleziono sekcji ${String(match)}`).toBeTruthy();
  fireEvent.click(button as HTMLElement);
  return (button as HTMLElement).parentElement as HTMLElement;
}

beforeEach(() => {
  db.current = supabaseFromStub();
  db.current.setResponse(
    "categories",
    ok([
      { id: "c1", slug: "gospodarka", name_pl: "Gospodarka" },
      { id: "c2", slug: "sport", name_pl: "Sport" },
    ]),
  );
  db.current.setResponse(
    "tags",
    ok([
      { id: "t1", slug: "raport", name: "Raport" },
      { id: "t2", slug: "archiwum", name: "Archiwum" },
    ]),
  );
  db.current.setResponse("post_categories", ok([]));
  db.current.setResponse("post_tags", ok([]));
});

afterEach(cleanup);

describe("RatedListEditor - link recznej pozycji", () => {
  const items = [{ title_pl: "Pozycja", rating: 0 }];

  it("exposes a href field for every manual item", () => {
    const { container } = renderEditor({ source: "manual", items });
    expect(container.querySelector('input[placeholder^="/post/"]')).toBeTruthy();
  });

  it("commits the typed href into the item model", () => {
    const { calls, container } = renderEditor({ source: "manual", items });
    const input = container.querySelector('input[placeholder^="/post/"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/post/raport-2026" } });
    expect(itemsFrom(calls)[0].href).toBe("/post/raport-2026");
  });

  it("seeds a fresh item with an empty href instead of an undefined key", () => {
    const { calls } = renderEditor({ source: "manual", items: [] });
    const add = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").startsWith("+"),
    );
    fireEvent.click(add as HTMLElement);
    expect(itemsFrom(calls).at(-1)).toHaveProperty("href", "");
  });

  it("round-trips editor -> model -> renderer: the read-more button appears", () => {
    const { calls, container } = renderEditor({ source: "manual", items });
    const input = container.querySelector('input[placeholder^="/post/"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/post/raport-2026" } });
    cleanup();

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rendered = render(
      <QueryClientProvider client={qc}>
        <RatedListView
          c={{ source: "manual", items: toJson(itemsFrom(calls)), showReadMore: true }}
          lang="pl"
        />
      </QueryClientProvider>,
    );
    const more = rendered.container.querySelector(".rl-more");
    expect(more).toBeTruthy();
    expect(more?.getAttribute("href")).toBe("/post/raport-2026");
  });
});

describe("RatedListEditor - ocena tylko dla listy recznej", () => {
  const ratingCheckbox = () => {
    const labels = Array.from(document.querySelectorAll("label"));
    return labels.find(
      (l) =>
        l.querySelector('input[type="checkbox"]') && /10|ocen|rating/i.test(l.textContent ?? ""),
    );
  };

  it("offers the rating toggle for the manual source", () => {
    renderEditor({ source: "manual", items: [] });
    expect(ratingCheckbox()).toBeTruthy();
  });

  it("hides the toggle for the dynamic source and explains why", () => {
    renderEditor({ source: "dynamic" });
    expect(ratingCheckbox()).toBeUndefined();
    // Zamiast martwej kontrolki - jedno zdanie wyjasnienia.
    expect(screen.getByText(/ocen|rating/i)).toBeTruthy();
  });
});

describe("RatedListEditor - domyslne kolumny zgodne z rendererem", () => {
  /** Desktop / Tablet / Mobile - trzy pierwsze liczby w sekcji "Columns". */
  const columnInputs = (section: HTMLElement) =>
    Array.from(section.querySelectorAll('input[type="number"]'))
      .slice(0, 3)
      .map((i) => (i as HTMLInputElement).value);

  it("shows min(desktop, 2) for an unset tablet column count", () => {
    renderEditor({ source: "manual", items: [], columnsDesktop: 4 });
    const [desktop, tablet, mobile] = columnInputs(openSection(/Columns/i));
    expect(desktop).toBe("4");
    expect(tablet).toBe("2");
    expect(mobile).toBe("1");
  });

  it("keeps an explicitly stored tablet column count", () => {
    renderEditor({ source: "manual", items: [], columnsDesktop: 4, columnsTablet: 3 });
    expect(columnInputs(openSection(/Columns/i))[1]).toBe("3");
  });

  it("reads counts stored as strings by older documents", () => {
    renderEditor({ source: "manual", items: [], columnsDesktop: "3" });
    const values = columnInputs(openSection(/Columns/i));
    expect(values[0]).toBe("3");
    expect(values[1]).toBe("2");
  });
});

// ── Tryb DYNAMICZNY: cały panel zapytania ───────────────────────────────────
//
// Blok „Query Settings" renderuje się WYŁĄCZNIE dla źródła dynamicznego, więc
// dla listy recznej (domyslnej) nie istnieje w DOM ani jedno jego pole. To
// jedenaście kontrolek, ktore razem opisuja zapytanie do bazy - a kazda z nich
// zapisuje sie pod WLASNY klucz. Pomylka klucza nie wywala panelu: filtr po
// prostu przestaje dzialac, a redakcja widzi liste, ktora ignoruje ustawienia.
describe("RatedListEditor - panel zapytania zrodla dynamicznego", () => {
  const DYNAMIC: WidgetContent = {
    source: "dynamic",
    categoriesFilter: "gospodarka",
    excludeCategories: "sport",
    tagsFilter: "raport",
    excludeTags: "archiwum",
    authorFilter: "Autor Testowy",
    postIdsFilter: "11111111-1111-1111-1111-111111111111",
    excludePostIds: "22222222-2222-2222-2222-222222222222",
    numberOfPosts: 6,
    postOffset: 2,
  };

  /** Pole kontrolki spod etykiety `PropField` (etykieta i pole sa rodzenstwem). */
  const fieldUnder = (label: string, selector = "input"): HTMLInputElement => {
    const box = screen.getByText(label).parentElement;
    const field = box?.querySelector<HTMLInputElement>(selector);
    expect(field, `nie znaleziono pola pod etykieta „${label}”`).toBeTruthy();
    return field as HTMLInputElement;
  };

  it("blok zapytania pojawia sie dopiero dla zrodla dynamicznego", () => {
    const manual = renderEditor({ source: "manual", items: [] });
    expect(manual.container.textContent).not.toContain("Query Settings");
    cleanup();

    renderEditor(DYNAMIC);
    expect(screen.getByText("Query Settings")).toBeTruthy();
  });

  it.each([
    ["Categories Filter", "categoriesFilter"],
    ["Exclude Categories", "excludeCategories"],
    ["Tags Filter", "tagsFilter"],
    ["Exclude Tags", "excludeTags"],
  ])("zdjecie ostatniej pozycji z listy „%s” zapisuje PUSTY filtr", async (label, key) => {
    const { calls } = renderEditor(DYNAMIC);
    // Etykiety taksonomii przychodza z bazy - bez nich nie ma czego odznaczyc,
    // wiec plakietka pojawia sie dopiero po rozwiazaniu zapytania.
    const box = screen.getByText(label).parentElement as HTMLElement;
    const chip = await waitFor(() => {
      const found = box.querySelector<HTMLButtonElement>("span button");
      expect(found, `brak plakietki wybranej pozycji pod „${label}”`).toBeTruthy();
      return found as HTMLButtonElement;
    });
    fireEvent.click(chip);
    // Pusty lancuch to „bez filtra". `undefined` zniknelby przy zapisie,
    // a dokument zostalby ze starym filtrem.
    expect(calls.filter(([k]) => k === key).at(-1)?.[1]).toBe("");
  });

  it.each([
    ["Author Filter (nazwy autorów, csv)", "authorFilter", "Nowa Osoba"],
    ["Post IDs Filter (UUID, csv)", "postIdsFilter", "33333333-3333-3333-3333-333333333333"],
    ["Exclude Post IDs (UUID, csv)", "excludePostIds", "44444444-4444-4444-4444-444444444444"],
  ])("pole „%s” zapisuje sie pod klucz %s", (label, key, value) => {
    const { calls } = renderEditor(DYNAMIC);
    fireEvent.change(fieldUnder(label), { target: { value } });
    expect(calls.at(-1)).toEqual([key, value]);
  });

  it("liczba wpisow i przesuniecie maja WLASNE wartosci zapasowe", () => {
    const { calls } = renderEditor(DYNAMIC);
    const count = fieldUnder("Number of Posts");
    const offset = fieldUnder("Post Offset");
    expect(count.value).toBe("6");
    expect(offset.value).toBe("2");

    fireEvent.change(count, { target: { value: "9" } });
    expect(calls.at(-1)).toEqual(["numberOfPosts", 9]);
    // Zero wpisow to nie jest lista - pole oddaje minimum, ktore zapytanie
    // umie zrealizowac.
    fireEvent.change(count, { target: { value: "0" } });
    expect(calls.at(-1)).toEqual(["numberOfPosts", 1]);

    fireEvent.change(offset, { target: { value: "5" } });
    expect(calls.at(-1)).toEqual(["postOffset", 5]);
    // Przesuniecie zero jest POPRAWNE (pierwsza strona) - nie wolno go
    // podmienic na wartosc domyslna.
    fireEvent.change(offset, { target: { value: "0" } });
    expect(calls.at(-1)).toEqual(["postOffset", 0]);
  });
});

// ── Brzegi kontrolek liczbowych i suwakow ───────────────────────────────────
//
// Panel liczy wszedzie `Number(pole) || wartosc-domyslna`. Zero jest przy tym
// zapisie POPRAWNA wartoscia dla polowy tych pol (odstep 0 px, wypelnienie
// 0 px, przezroczystosc 0) i BLEDNA dla drugiej (0 pozycji na strone). Ten
// blok pilnuje, ktore pole jest po ktorej stronie.
describe("RatedListEditor - wartosci graniczne suwakow i pol liczbowych", () => {
  it("przezroczystosc numeru zjechana do zera zapisuje ZERO", () => {
    const { calls, container } = renderEditor({ source: "manual", items: [], numberOpacity: 0.4 });
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error("test: brak suwaka przezroczystosci");
    expect(slider.value).toBe("0.4");
    fireEvent.change(slider, { target: { value: "0" } });
    // Numer niewidoczny to swiadomy wybor redakcji - podmiana na 0,18
    // przywracalaby ustawienie, ktore wlasnie zostalo zdjete.
    expect(calls.at(-1)).toEqual(["numberOpacity", 0]);
  });

  it("odstep i wypelnienie pozycji zjechane do zera zapisuja ZERO", () => {
    // Wypelnienie ma zapisana wartosc niezerowa - inaczej suwak juz stoi na
    // zerze i zdarzenie zmiany w ogole nie dochodzi do panelu.
    const { calls } = renderEditor({ source: "manual", items: [], itemPaddingPx: 12 });
    const section = openSection(/Spacing/i);
    const sliders = Array.from(section.querySelectorAll<HTMLInputElement>('input[type="range"]'));
    expect(sliders).toHaveLength(2);
    fireEvent.change(sliders[0], { target: { value: "0" } });
    expect(calls.at(-1)).toEqual(["itemSpacingPx", 0]);
    fireEvent.change(sliders[1], { target: { value: "0" } });
    expect(calls.at(-1)).toEqual(["itemPaddingPx", 0]);
  });

  it("ocena recznej pozycji wyzerowana zapisuje ZERO, nie dziure", () => {
    const { calls, container } = renderEditor({
      source: "manual",
      items: [{ title_pl: "Pozycja", rating: 4.5 }],
    });
    const rating = container.querySelector<HTMLInputElement>('input[step="0.1"]');
    if (!rating) throw new Error("test: brak pola oceny");
    expect(rating.value).toBe("4.5");
    fireEvent.change(rating, { target: { value: "0" } });
    expect(itemsFrom(calls)[0].rating).toBe(0);
  });
});

// ── Tryb przewijania: pola zalezne od wybranego trybu ───────────────────────
//
// Sekcja „Scrolling Mode" pokazuje ROZNE pole dla kazdego trybu: wysokosc
// ramki dla przewijania, rozmiar strony dla doladowania, a dla karuzeli
// i trybu wylaczonego - zadnego. Pole widoczne w zlym trybie zapisuje
// ustawienie, ktorego renderer w tym trybie nie czyta.
describe("RatedListEditor - tryb przewijania listy", () => {
  const numbersIn = (section: HTMLElement) =>
    Array.from(section.querySelectorAll<HTMLInputElement>('input[type="number"]'));

  it.each([
    ["none", 0],
    ["carousel", 0],
    ["scroll", 1],
    ["loadmore", 1],
  ])("tryb „%s” pokazuje %i pol dodatkowych", (mode, count) => {
    renderEditor({ source: "manual", items: [], scrollingMode: mode });
    expect(numbersIn(openSection(/Scrolling Mode/i))).toHaveLength(count);
  });

  it("tryb przewijania zapisuje maksymalna wysokosc, a pustka wraca do 400 px", () => {
    const { calls } = renderEditor({
      source: "manual",
      items: [],
      scrollingMode: "scroll",
      scrollMaxHeightPx: 500,
    });
    const [height] = numbersIn(openSection(/Scrolling Mode/i));
    expect(height.value).toBe("500");
    fireEvent.change(height, { target: { value: "720" } });
    expect(calls.at(-1)).toEqual(["scrollMaxHeightPx", 720]);
    // Ramka o zerowej wysokosci schowalaby cala liste - pole oddaje wartosc
    // domyslna, a nie zero.
    fireEvent.change(height, { target: { value: "0" } });
    expect(calls.at(-1)).toEqual(["scrollMaxHeightPx", 400]);
  });

  it("tryb doladowania zapisuje rozmiar strony, a pustka wraca do 4", () => {
    const { calls } = renderEditor({
      source: "manual",
      items: [],
      scrollingMode: "loadmore",
      pageSize: 8,
    });
    const [size] = numbersIn(openSection(/Scrolling Mode/i));
    expect(size.value).toBe("8");
    fireEvent.change(size, { target: { value: "12" } });
    expect(calls.at(-1)).toEqual(["pageSize", 12]);
    fireEvent.change(size, { target: { value: "0" } });
    expect(calls.at(-1)).toEqual(["pageSize", 4]);
  });
});
