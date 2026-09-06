// Behaviour coverage for the "speakers" widget: category filter with counts,
// search + highlight, bookmark toggle persisted per-widget in localStorage,
// "saved only" filter, load-more pagination and the clear-filters empty state.
// Renders through the real WidgetView like widgetBehavior.test.tsx.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import type { WidgetNode, WidgetContent } from "@/lib/builder/types";

// Rejestr leniwych widgetow -> lustro eager. Od 2026-08-15 `speakers` jedzie
// przez React.lazy, wiec bez tej podmiany pierwszy render pokazuje fallback
// Suspense i kazda asercja o tresci widgetu pada na pustym drzewie.
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

vi.mock("@/integrations/supabase/client", () => {
  type Builder = Record<string, unknown> & { then: (r: (v: unknown) => unknown) => unknown };
  const builder = {} as Builder;
  for (const m of [
    "select",
    "eq",
    "neq",
    "is",
    "in",
    "not",
    "gte",
    "lte",
    "order",
    "range",
    "limit",
    "ilike",
  ]) {
    (builder as Record<string, unknown>)[m] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return {
    supabase: { from: vi.fn(() => builder), rpc: vi.fn(async () => ({ data: [], error: null })) },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

function speaker(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `sp-${i}`,
    photo: "",
    name: `Speaker ${i}`,
    role_pl: `Rola ${i}`,
    role_en: `Role ${i}`,
    category_pl: i % 2 === 0 ? "Nauka" : "Design",
    category_en: i % 2 === 0 ? "Science" : "Design",
    gigs: i,
    rating: 4 + (i % 2 ? 0.5 : 0),
    reviews: i * 10,
    description_pl: `Opis ${i}`,
    description_en: `Description ${i}`,
    href: "",
    ...over,
  };
}

function renderSpeakers(content: WidgetContent, nodeId = "w-speakers", lang: "pl" | "en" = "pl") {
  const node: WidgetNode = { id: nodeId, kind: "widget", type: "speakers", content };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WidgetView node={node} lang={lang} device="desktop" editable={false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("speakers widget", () => {
  it("renders heading, cards and category chips with counts", () => {
    renderSpeakers({
      heading_pl: "Prelegenci",
      speakers: [speaker(1), speaker(2), speaker(3)],
    } as unknown as WidgetContent);
    expect(screen.getByText("Prelegenci")).toBeTruthy();
    expect(screen.getByText("Speaker 1")).toBeTruthy();
    const all = screen.getByRole("tab", { name: /Wszyscy/ });
    expect(all.textContent).toContain("3");
    expect(screen.getByRole("tab", { name: /Design/ }).textContent).toContain("2");
    expect(screen.getByRole("tab", { name: /Nauka/ }).textContent).toContain("1");
  });

  it("filters by category chip and can clear filters from the empty state", () => {
    renderSpeakers({
      speakers: [speaker(1), speaker(2)],
    } as unknown as WidgetContent);
    fireEvent.click(screen.getByRole("tab", { name: /Nauka/ }));
    expect(screen.queryByText("Speaker 1")).toBeNull();
    expect(screen.getByText("Speaker 2")).toBeTruthy();

    // Search for something absent within the category → empty state + reset.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "brak-takiego" } });
    expect(screen.getByText("Brak wyników wyszukiwania.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Wyczyść filtry" }));
    expect(screen.getByText("Speaker 1")).toBeTruthy();
    expect(screen.getByText("Speaker 2")).toBeTruthy();
  });

  it("highlights the search query in matching cards", () => {
    const { container } = renderSpeakers({
      speakers: [speaker(1), speaker(2)],
    } as unknown as WidgetContent);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "speaker 1" } });
    expect(screen.queryByText("Speaker 2")).toBeNull();
    expect(container.querySelector("mark")?.textContent).toBe("Speaker 1");
  });

  it("persists bookmarks per widget node and exposes the saved-only filter", () => {
    renderSpeakers({ speakers: [speaker(1), speaker(2)] } as unknown as WidgetContent, "node-abc");
    expect(screen.queryByRole("tab", { name: /Zapisani/ })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Dodaj do zakładek" })[0]);
    expect(
      JSON.parse(window.localStorage.getItem("cms:speakers:bookmarks:node-abc") ?? "[]"),
    ).toEqual(["sp-1"]);

    fireEvent.click(screen.getByRole("tab", { name: /Zapisani/ }));
    expect(screen.getByText("Speaker 1")).toBeTruthy();
    expect(screen.queryByText("Speaker 2")).toBeNull();
  });

  it("paginates with the load-more button", () => {
    renderSpeakers({
      pageSize: 2,
      speakers: [speaker(1), speaker(2), speaker(3)],
    } as unknown as WidgetContent);
    expect(screen.getByText("Speaker 1")).toBeTruthy();
    expect(screen.queryByText("Speaker 3")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Pokaż więcej/ }));
    expect(screen.getByText("Speaker 3")).toBeTruthy();
  });

  it("shows the results counter when filtering narrows the list", () => {
    renderSpeakers({
      speakers: [speaker(1), speaker(2), speaker(3)],
    } as unknown as WidgetContent);
    expect(screen.getByText("3 prelegentów")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Design/ }));
    expect(screen.getByText("2 / 3 prelegentów")).toBeTruthy();
  });
});

// ── STEROWALNY INTERSECTION OBSERVER ─────────────────────────────────────────
// happy-dom NIGDY nie woła callbacku obserwatora, więc tryb "infinite scroll"
// (`pageMode: "scroll"`) kończył się na samym wyrenderowaniu wartownika -
// dociąganie kolejnej strony nie miało dowodu wykonawczego.
type IOEntryLite = { isIntersecting: boolean };
type IOCallbackLite = (entries: IOEntryLite[]) => void;

const ioBus = { callbacks: [] as IOCallbackLite[], observed: 0, disconnects: 0 };

class ControlledIntersectionObserver {
  constructor(cb: IntersectionObserverCallback) {
    ioBus.callbacks.push(cb as unknown as IOCallbackLite);
  }
  observe(): void {
    ioBus.observed += 1;
  }
  unobserve(): void {}
  disconnect(): void {
    ioBus.disconnects += 1;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function installIO(): void {
  ioBus.callbacks = [];
  ioBus.observed = 0;
  ioBus.disconnects = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    ControlledIntersectionObserver as unknown as typeof IntersectionObserver,
  );
}

function intersect(isIntersecting: boolean): void {
  act(() => {
    for (const cb of [...ioBus.callbacks]) cb([{ isIntersecting }]);
  });
}

describe("speakers widget - warianty językowe i gałęzie odmowy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PUSTA lista pokazuje stan 'brak prelegentów' w obu językach", () => {
    const pl = renderSpeakers({ speakers: [] } as unknown as WidgetContent);
    expect(pl.container.textContent).toContain("Brak prelegentów w tej kategorii.");
    cleanup();
    const en = renderSpeakers({ speakers: [] } as unknown as WidgetContent, "w-empty-en", "en");
    expect(en.container.textContent).toContain("No speakers in this category.");
  });

  it("wersja EN nazywa licznik, paginację i plakietkę eksperta po angielsku", () => {
    renderSpeakers(
      {
        pageSize: 1,
        speakers: [speaker(1, { isExpert: true, rating: 4.5, reviews: 12, gigs: 7 }), speaker(2)],
      } as unknown as WidgetContent,
      "w-en",
      "en",
    );
    expect(screen.getByText("2 speakers")).toBeTruthy();
    expect(screen.getByText("Expert")).toBeTruthy();
    expect(screen.getByText(/7 gigs/)).toBeTruthy();
    expect(screen.getByText(/12 reviews/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Load more/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add bookmark" })).toBeTruthy();
  });

  it("wersja EN: brak wyników wyszukiwania i przycisk czyszczenia filtrów", () => {
    renderSpeakers(
      { speakers: [speaker(1), speaker(2)] } as unknown as WidgetContent,
      "w-en-empty",
      "en",
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "brak-takiego" } });
    expect(screen.getByText("No results.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Speaker 1")).toBeTruthy();
  });

  it("ponowne kliknięcie zakładki USUWA prelegenta z zapisanych i pokazuje pusty stan", () => {
    renderSpeakers(
      { speakers: [speaker(1), speaker(2)] } as unknown as WidgetContent,
      "node-toggle",
      "en",
    );
    const add = screen.getAllByRole("button", { name: "Add bookmark" })[0];
    fireEvent.click(add);
    fireEvent.click(screen.getByRole("tab", { name: /Saved/ }));
    expect(screen.getByText("Speaker 1")).toBeTruthy();

    // Drugie kliknięcie tej samej zakładki musi ją ZDJĄĆ - inaczej zapisu nie
    // da się cofnąć, a filtr "Zapisani" zostaje z pozycją na stałe.
    fireEvent.click(screen.getByRole("button", { name: "Remove bookmark" }));
    expect(screen.getByText("You haven't saved any speakers yet.")).toBeTruthy();
    expect(
      JSON.parse(window.localStorage.getItem("cms:speakers:bookmarks:node-toggle") ?? "[]"),
    ).toEqual([]);
  });

  it("filtr 'Zapisani' bez zapisów pokazuje polski komunikat zachęty", () => {
    renderSpeakers(
      { speakers: [speaker(1), speaker(2)] } as unknown as WidgetContent,
      "node-saved-pl",
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Dodaj do zakładek" })[0]);
    fireEvent.click(screen.getByRole("tab", { name: /Zapisani/ }));
    fireEvent.click(screen.getByRole("button", { name: "Usuń z zakładek" }));
    expect(screen.getByText("Nie masz jeszcze zapisanych prelegentów.")).toBeTruthy();
  });

  it.each([
    [2, "sm:grid-cols-2"],
    [4, "sm:grid-cols-2 lg:grid-cols-4"],
  ])("liczba kolumn %s przekłada się na klasy siatki", (columns, expected) => {
    const { container } = renderSpeakers(
      { columns, speakers: [speaker(1)] } as unknown as WidgetContent,
      `w-cols-${columns}`,
    );
    const grid = container.querySelector("div.grid.grid-cols-1");
    expect(grid?.className).toContain(expected);
  });

  it("NIE-tablica w localStorage nie hydratuje zakładek ani nie wywraca widgetu", () => {
    window.localStorage.setItem("cms:speakers:bookmarks:node-bad", JSON.stringify({ a: 1 }));
    renderSpeakers({ speakers: [speaker(1)] } as unknown as WidgetContent, "node-bad");
    expect(screen.getByText("Speaker 1")).toBeTruthy();
    // Brak zakładek -> filtr "Zapisani" w ogóle się nie pojawia.
    expect(screen.queryByRole("tab", { name: /Zapisani/ })).toBeNull();
  });

  it("prelegent BEZ identyfikatora dostaje klucz zastępczy z indeksu", () => {
    renderSpeakers(
      { speakers: [{ name: "Bez ID", role_pl: "Rola" }] } as unknown as WidgetContent,
      "node-noid",
    );
    fireEvent.click(screen.getByRole("button", { name: "Dodaj do zakładek" }));
    expect(
      JSON.parse(window.localStorage.getItem("cms:speakers:bookmarks:node-noid") ?? "[]"),
    ).toEqual(["sp-0"]);
  });

  it("widget BEZ treści renderuje pusty stan zamiast się wywracać", () => {
    const node = { id: "w-nocontent", kind: "widget", type: "speakers" } as unknown as WidgetNode;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <WidgetView node={node} lang="pl" device="desktop" editable={false} />
      </QueryClientProvider>,
    );
    expect(container.textContent).toContain("Brak prelegentów w tej kategorii.");
  });

  it("wyłączona wyszukiwarka zostawia samo sortowanie i licznik", () => {
    const { container } = renderSpeakers(
      { enableSearch: false, speakers: [speaker(1), speaker(2)] } as unknown as WidgetContent,
      "w-nosearch",
    );
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(screen.getByText("2 prelegentów")).toBeTruthy();
  });

  it("zmiana filtru przy WŁĄCZONEJ paginacji wraca na pierwszą stronę", () => {
    renderSpeakers(
      {
        pageSize: 1,
        speakers: [speaker(1), speaker(2), speaker(3)],
      } as unknown as WidgetContent,
      "w-reset",
    );
    fireEvent.click(screen.getByRole("button", { name: /Pokaż więcej/ }));
    expect(screen.getByText("Speaker 2")).toBeTruthy();
    // Powrót do "Wszyscy" musi zresetować licznik widocznych do rozmiaru strony.
    fireEvent.click(screen.getByRole("tab", { name: /Design/ }));
    fireEvent.click(screen.getByRole("tab", { name: /Wszyscy/ }));
    expect(screen.queryByText("Speaker 2")).toBeNull();
  });

  it("tryb 'scroll': wejście wartownika w viewport dociąga kolejną stronę", () => {
    installIO();
    renderSpeakers(
      {
        pageSize: 1,
        pageMode: "scroll",
        speakers: [speaker(1), speaker(2)],
      } as unknown as WidgetContent,
      "w-scroll",
    );
    expect(screen.queryByText("Speaker 2")).toBeNull();
    expect(ioBus.observed).toBe(1);

    // Wartownik POZA viewportem nie dociąga niczego...
    intersect(false);
    expect(screen.queryByText("Speaker 2")).toBeNull();
    // ...a wejście w viewport tak.
    intersect(true);
    expect(screen.getByText("Speaker 2")).toBeTruthy();
  });

  it("BEZ IntersectionObservera tryb 'scroll' zostaje na pierwszej stronie (SSR/crawler)", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    renderSpeakers(
      {
        pageSize: 1,
        pageMode: "scroll",
        speakers: [speaker(1), speaker(2)],
      } as unknown as WidgetContent,
      "w-scroll-noio",
    );
    expect(screen.getByText(/Wczytywanie/)).toBeTruthy();
    expect(screen.queryByText("Speaker 2")).toBeNull();
  });

  it("karta BEZ user_id nie otwiera dialogu profilu", () => {
    renderSpeakers({ speakers: [speaker(1)] } as unknown as WidgetContent, "w-nouser");
    fireEvent.click(screen.getByRole("button", { name: "Speaker 1" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("wyłączony dialog profilu nie otwiera go po kliknięciu karty", () => {
    renderSpeakers(
      {
        openProfile: false,
        speakers: [speaker(1, { user_id: "u-1" })],
      } as unknown as WidgetContent,
      "w-noprofile",
    );
    fireEvent.click(screen.getByRole("button", { name: "Speaker 1" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("zakładki zapisane WCZEŚNIEJ hydratują się po montażu widgetu", () => {
    window.localStorage.setItem(
      "cms:speakers:bookmarks:node-hydrate",
      JSON.stringify(["sp-2", 17]),
    );
    renderSpeakers(
      { speakers: [speaker(1), speaker(2)] } as unknown as WidgetContent,
      "node-hydrate",
    );
    // Pozycja nie-tekstowa jest odfiltrowana, zostaje jedna zakładka.
    const saved = screen.getByRole("tab", { name: /Zapisani/ });
    expect(saved.textContent).toContain("1");
    fireEvent.click(saved);
    expect(screen.getByText("Speaker 2")).toBeTruthy();
    expect(screen.queryByText("Speaker 1")).toBeNull();
  });

  it("karta ZE ZDJĘCIEM i BEZ nazwiska nie wypisuje wartości zastępczych", async () => {
    const { container } = renderSpeakers(
      {
        speakers: [
          {
            id: "sp-anon",
            user_id: "u-anon",
            photo: "https://cdn.example/portret.webp",
            name: "",
            role_pl: "",
          },
        ],
      } as unknown as WidgetContent,
      "w-anon",
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe("");
    const card = container.querySelector("div.grid > button") as HTMLButtonElement;
    expect(card.getAttribute("aria-label")).toBeNull();

    // Dialog otwiera się nawet bez danych zastępczych (nazwisko/rola/zdjęcie
    // są opcjonalne - profil dociąga je sam po `user_id`).
    fireEvent.click(card);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("dialog profilu zamyka się klawiszem Escape i znika z drzewa", async () => {
    renderSpeakers(
      { speakers: [speaker(1, { user_id: "u-1" })] } as unknown as WidgetContent,
      "w-dialog",
    );
    fireEvent.click(screen.getByRole("button", { name: "Speaker 1" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("wersja EN nazywa wartownika doczytywania po angielsku", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    renderSpeakers(
      {
        pageSize: 1,
        pageMode: "scroll",
        speakers: [speaker(1), speaker(2)],
      } as unknown as WidgetContent,
      "w-scroll-en",
      "en",
    );
    expect(screen.getByText(/Loading…/)).toBeTruthy();
  });

  // DEFEKT: KARTA PRELEGENTA Z ADRESEM NIGDY NIE JEST ODNOSNIKIEM.
  //
  // WEJSCIE: widget "speakers" z `openProfile: false` i wpisem recznym, ktory
  //   ma wypelnione pole "Adres" (`href: "/author/anna"`).
  // CO PSUJE: `SpeakersWidget` przekazuje do `SpeakerCard` prop
  //   `onOpenProfile={() => onOpenProfile(item)}` BEZWARUNKOWO (linia 443), a
  //   karta wybiera opakowanie po `if (onOpenProfile)` (linia 725). Funkcja
  //   jest zawsze przekazana, wiec galaz `if (href)` (linia 737) jest
  //   nieosiagalna. Sam handler konczy sie natychmiast na `if (!openProfile)
  //   return;` (linia 310).
  // KONSEKWENCJA: karta prelegenta z adresem renderuje sie jako <button>, ktory
  //   po kliknieciu NIE ROBI NIC - odnosnik do profilu nie powstaje w ogole.
  //   Czytelnik nie ma jak dojsc do strony prelegenta, a czytnik ekranu oglasza
  //   aktywna kontrolke bez zadnego dzialania. Pole "Adres" w panelu jest
  //   martwe dokladnie wtedy, gdy jest jedyna droga do profilu.
  // WYMAGANA POPRAWKA: przekazywac `onOpenProfile` tylko gdy `openProfile` jest
  //   wlaczone (np. `onOpenProfile={openProfile ? () => onOpenProfile(item) : undefined}`),
  //   zeby karta z adresem spadala na galaz `if (href)` i renderowala <a>.
  it.fails(
    "DEFEKT: karta z adresem i WYŁĄCZONYM dialogiem powinna być odnośnikiem do profilu",
    () => {
      const { container } = renderSpeakers(
        {
          openProfile: false,
          speakers: [speaker(1, { href: "/author/anna" })],
        } as unknown as WidgetContent,
        "w-href",
      );
      expect(container.querySelector('a[href="/author/anna"]')).not.toBeNull();
    },
  );
});
