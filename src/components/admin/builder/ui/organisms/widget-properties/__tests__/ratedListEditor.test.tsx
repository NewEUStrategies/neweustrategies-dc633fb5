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
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toJson, type Json, type WidgetContent } from "@/lib/builder/types";
import { RatedListEditor } from "../RatedListEditor";
import { RatedListView } from "@/components/builder/organisms/widget-view/RatedListView";

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
