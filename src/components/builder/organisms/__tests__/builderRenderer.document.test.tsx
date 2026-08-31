// PUBLICZNY RENDERER: DOKUMENT WEJŚCIOWY, NIEZNANE WIDGETY, NAKŁADKA DEBUG.
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// `BuilderRenderer` renderuje KAŻDĄ stronę publiczną tego serwisu, a do tej
// pory nie wykonał w testach ANI JEDNEJ linii: osiem plików testowych, które go
// nazywają, podmieniało go atrapą (`vi.mock`), a dwa pozostałe czytały go jako
// TEKST przez `readFileSync`. Ten plik montuje PRAWDZIWY komponent i mierzy:
//   * bramkę wejściową `safeParseBuilderDoc` - dokument `null`, bez `version`,
//     z `sections` innym niż tablica, z sekcjami-śmieciami, z kolumną bez
//     tablicy `children` i z widgetem NIEZNANEGO typu (`isKnownWidgetType`),
//   * fakt, że parsowanie jest NIEZAPAMIĘTANE (L218) - każdy render produkuje
//     nową tożsamość tablicy sekcji, więc `memo(SectionsList)` nigdy nie ucina
//     przerenderowania. To jest OPIS STANU FAKTYCZNEGO, nie życzenie: test
//     przybija zachowanie, nie naprawia go,
//   * nakładkę debug (`BuilderDebugOverlay`) - jedna na stronę, wybór instancji
//     „pierwotnej", portal do `<body>`, wstrzyknięcie CSS tylko przy włączonym
//     debugu.
//
// ── CZEGO TU ŚWIADOMIE NIE MA ──────────────────────────────────────────────
// * `import.meta.env.DEV` jest w vitest PRAWDĄ, więc nakładka debug renderuje
//   się tutaj tak jak w trybie dev. Gałąź produkcyjna (`if (!import.meta.env.DEV)
//   return null`, L313) jest w tym przebiegu NIEOSIĄGALNA - jej zmierzenie
//   wymagałoby drugiego przebiegu z `mode=production`.
// * Urządzenia, dostęp, zakładki, strumieniowanie i eksperymenty mają własne
//   pliki `builderRenderer.*.test.tsx`.
//
// ── GAŁĘZIE NIEOSIĄGALNE Z TEGO POZIOMU (zmierzone, nie zgadnięte) ─────────
// Po tych ośmiu plikach z `BuilderRenderer.tsx` zostaje NIEWYKONANYCH dziesięć
// ramion gałęzi i wszystkie mają ten sam charakter - są nieosiągalne przez
// publiczne wejście komponentu:
//   * L76 `typeof window !== "undefined" ? useLayoutEffect : useEffect` - ramię
//     serwerowe; w happy-dom `window` istnieje zawsze,
//   * L313 `if (!import.meta.env.DEV) return null` - nakładka debug w budowie
//     produkcyjnej; vitest jedzie z `DEV === true`,
//   * L351 `Array.isArray(sections) ? sections : []`, L545, L728 i L794 (te same
//     osłony dla `section.children`, `inner.columns`, `column.children`) - do
//     `SectionsList` trafia WYNIK `safeParseBuilderDoc`, który każde z tych pól
//     już skoercował do tablicy, więc ramię awaryjne jest tu podwójną osłoną
//     na wypadek wywołania z pominięciem parsera (`SectionsList` nie jest
//     eksportowany, więc z zewnątrz nie da się tego zrobić),
//   * L538-539 `ids[0] ?? ""` - „zakładki włączone, ale lista pusta"; warunek
//     `tabsEnabled` wymaga niepustej listy, więc efekt kończy się wcześniej.
// Nie ma tu żadnej gałęzi funkcjonalnej bez dowodu.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
// Prawdziwa instancja i18n: szkielet strumieniowanej sekcji woła
// `useTranslation`, a atrapa `react-i18next` wsadzona w fabrykę `vi.mock`
// zakleszcza plik (patrz nagłówek `src/test/i18nReal.ts`).
import "@/test/i18nReal";
import type { BuilderDocument } from "@/lib/builder/types";
import { __resetBuilderDebugForTests } from "@/lib/builder/builderDebug";
import { BuilderRenderer } from "../BuilderRenderer";
import {
  column,
  doc,
  section,
  simpleSection,
  stubObservers,
  widget,
} from "./builderRendererFixtures";

// Podział kodu (`React.lazy`) zamieniony na importy statyczne. To NIE jest
// atrapa warstwy pod testem - lustro eksportuje te same komponenty, tylko bez
// granicy Suspense (kontrakt pilnuje `eagerWidgetChunks.test.ts`).
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

let observers: ReturnType<typeof stubObservers>;

beforeEach(() => {
  observers = stubObservers();
  __resetBuilderDebugForTests();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  observers.restore();
  __resetBuilderDebugForTests();
  window.localStorage.clear();
});

const root = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-builder-renderer]");

describe("bramka wejściowa dokumentu", () => {
  it("renderuje sekcje poprawnego dokumentu w kolejności z dokumentu", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([simpleSection("a"), simpleSection("b")])} lang="pl" />,
    );
    const ids = [...container.querySelectorAll("[data-sec-id]")].map((el) =>
      el.getAttribute("data-sec-id"),
    );
    expect(ids).toEqual(["a", "b"]);
    expect(container.querySelectorAll("[data-widget-id]").length).toBe(2);
  });

  it.each([
    ["null", null],
    ["tablica zamiast obiektu", []],
    ["napis", "nie-dokument"],
    ["obiekt bez pola version", { sections: [] }],
    ["zła wersja dokumentu", { version: 2, sections: [{ id: "s" }] }],
    ["sections nie jest tablicą", { version: 1, sections: { s1: {} } }],
  ])("dokument nieczytelny (%s) daje pustą powłokę bez sekcji", (_opis, bad) => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={bad as unknown as BuilderDocument} lang="pl" />,
    );
    // Powłoka renderera istnieje (strona się nie wywraca), ale treści nie ma.
    expect(root(container)).not.toBeNull();
    expect(container.querySelectorAll("[data-sec-id]").length).toBe(0);
  });

  it("odrzuca pojedyncze sekcje-śmieci, a zdrowe obok nich renderuje", () => {
    const uszkodzony = {
      version: 1,
      sections: [null, "napis", 42, simpleSection("ok"), undefined],
    } as unknown as BuilderDocument;
    const { container } = renderWithQueryClient(<BuilderRenderer doc={uszkodzony} lang="pl" />);
    const ids = [...container.querySelectorAll("[data-sec-id]")].map((el) =>
      el.getAttribute("data-sec-id"),
    );
    expect(ids).toEqual(["ok"]);
  });

  it("sekcja bez tablicy children renderuje samą siebie, bez kolumn", () => {
    const brakDzieci = {
      version: 1,
      sections: [{ id: "s1", kind: "section", children: "nie-tablica" }],
    } as unknown as BuilderDocument;
    const { container } = renderWithQueryClient(<BuilderRenderer doc={brakDzieci} lang="pl" />);
    expect(container.querySelector('[data-sec-id="s1"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-col-id]").length).toBe(0);
  });

  it("węzeł bez id dostaje identyfikator z POZYCJI, nie losowy", () => {
    // Losowe id rozjechałoby HTML z SSR i klienta - React wyrzuciłby całe
    // zhydratowane drzewo. `takeId` liczy je z pozycji, więc dwa niezależne
    // parsowania tego samego dokumentu dają ten sam identyfikator.
    const bezId = {
      version: 1,
      sections: [{ kind: "section", children: [{ kind: "column", children: [] }] }],
    } as unknown as BuilderDocument;
    const pierwszy = renderWithQueryClient(<BuilderRenderer doc={bezId} lang="pl" />);
    const idA = pierwszy.container.querySelector("[data-sec-id]")?.getAttribute("data-sec-id");
    cleanup();
    const drugi = renderWithQueryClient(<BuilderRenderer doc={bezId} lang="pl" />);
    const idB = drugi.container.querySelector("[data-sec-id]")?.getAttribute("data-sec-id");
    expect(idA).toBe("auto-s0");
    expect(idB).toBe(idA);
  });
});

describe("widget nieznanego typu", () => {
  it("nie trafia do DOM, a znane rodzeństwo renderuje się dalej", () => {
    // Dwie bramki na tej samej regule: `coerceWidget` (schema) zdejmuje widget
    // przy parsowaniu, a `RenderColumn` filtruje `isKnownWidgetType` jeszcze
    // raz - dokument mógł przyjechać z SPA bez parsowania.
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s1", [
            column("c1", [
              widget("znany", "heading"),
              widget("obcy", "widget-z-przyszlosci"),
              widget("liczba", 7 as unknown as string),
              { id: "brak-typu", kind: "widget", content: {} } as never,
            ]),
          ]),
        ])}
        lang="pl"
      />,
    );
    const ids = [...container.querySelectorAll("[data-widget-id]")].map((el) =>
      el.getAttribute("data-widget-id"),
    );
    expect(ids).toEqual(["znany"]);
    expect(container.textContent).toContain("T-znany");
  });

  it("kolumna z WYŁĄCZNIE nieznanymi widgetami renderuje pusty slot, nie błąd", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([section("s1", [column("c1", [widget("obcy", "nie-ma-takiego")])])])}
        lang="pl"
      />,
    );
    expect(container.querySelector('[data-col-id="c1"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-widget-id]").length).toBe(0);
    // Żadna granica renderu się nie zapaliła - to nie jest awaria, to filtr.
    expect(container.querySelector("[data-render-error]")).toBeNull();
  });

  it("widget z content innego typu niż obiekt dostaje pusty content i renderuje się", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s1", [
            column("c1", [
              { id: "w1", kind: "widget", type: "heading", content: "napis" } as never,
            ]),
          ]),
        ])}
        lang="pl"
      />,
    );
    expect(container.querySelector('[data-widget-id="w1"]')).not.toBeNull();
    expect(container.querySelector("[data-render-error]")).toBeNull();
  });
});

describe("parsowanie dokumentu jest NIEZAPAMIĘTANE (stan faktyczny, L218)", () => {
  it("każdy render tworzy nową tożsamość sekcji, więc memo(SectionsList) nie ucina", async () => {
    const schema = await import("@/lib/builder/schema");
    // Podglądacz zachowuje PRAWDZIWĄ implementację - liczy wywołania, nie
    // podmienia zachowania.
    const spy = vi.spyOn(schema, "safeParseBuilderDoc");
    const stabilny = doc([simpleSection("a")]);
    const { rerender, queryClient } = renderWithQueryClient(
      <BuilderRenderer doc={stabilny} lang="pl" />,
    );
    const poPierwszym = spy.mock.calls.length;
    expect(poPierwszym).toBeGreaterThan(0);

    // TE SAME właściwości i TEN SAM obiekt dokumentu. Dostawcę klienta
    // podajemy ponownie, bo `rerender` z RTL renderuje DOKŁADNIE przekazane
    // drzewo - bez niego `useSectionPreload` straciłby klienta zapytań.
    rerender(
      <QueryClientProvider client={queryClient}>
        <BuilderRenderer doc={stabilny} lang="pl" />
      </QueryClientProvider>,
    );
    expect(spy.mock.calls.length).toBeGreaterThan(poPierwszym);

    // I dowód na źródło problemu: wynik parsowania nigdy nie jest współdzielony.
    const raz = schema.safeParseBuilderDoc(stabilny);
    const dwa = schema.safeParseBuilderDoc(stabilny);
    expect(raz.sections).not.toBe(dwa.sections);
    expect(raz.sections[0]).not.toBe(dwa.sections[0]);
    expect(raz.sections[0].id).toBe(dwa.sections[0].id);
    spy.mockRestore();
  });
});

describe("nakładka debug", () => {
  it("domyślnie jest wyłączona: data-debug=0 i brak wstrzykniętego CSS", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([simpleSection("a")])} lang="pl" />,
    );
    expect(root(container)?.getAttribute("data-debug")).toBe("0");
    expect(document.body.querySelector("style")?.textContent ?? "").not.toContain(
      "data-builder-renderer",
    );
  });

  it("przełącznik zapala debug na WSZYSTKICH rendererach strony naraz", () => {
    const { container } = renderWithQueryClient(
      <>
        <BuilderRenderer doc={doc([simpleSection("a")])} lang="pl" />
        <BuilderRenderer doc={doc([simpleSection("b")])} lang="pl" />
      </>,
    );
    // Nakładkę renderuje DOKŁADNIE JEDNA instancja („pierwotna"), inaczej
    // strona główna dostawała trzy przyciski jeden na drugim.
    const przyciski = screen.getAllByRole("button", { name: /Debug/ });
    expect(przyciski).toHaveLength(1);

    act(() => {
      fireEvent.click(przyciski[0]);
    });

    const korzenie = [...container.querySelectorAll("[data-builder-renderer]")];
    expect(korzenie).toHaveLength(2);
    expect(korzenie.map((el) => el.getAttribute("data-debug"))).toEqual(["1", "1"]);
    expect(screen.getByRole("button", { name: "Debug: ON" })).toBeTruthy();
    expect(window.localStorage.getItem("builder-debug")).toBe("1");
  });

  it("włączony debug wstrzykuje reguły konturów sekcji, kolumn i widgetów", () => {
    window.localStorage.setItem("builder-debug", "1");
    __resetBuilderDebugForTests();
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([simpleSection("a")])} lang="pl" />,
    );
    const css = [...container.querySelectorAll("style")].map((s) => s.textContent).join("");
    expect(css).toContain("data-sec-id");
    expect(css).toContain("data-col-id");
    expect(css).toContain("data-widget-id");
  });

  it("pętla adnotacji dopisuje zmierzoną wysokość każdemu węzłowi", () => {
    window.localStorage.setItem("builder-debug", "1");
    __resetBuilderDebugForTests();
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([simpleSection("a")])} lang="pl" />,
    );
    // happy-dom nie robi layoutu, więc każda wysokość to 0 - mierzymy FAKT
    // adnotacji, nie liczbę.
    expect(container.querySelector('[data-sec-id="a"]')?.getAttribute("data-debug-h")).toBe("0");
    expect(container.querySelector("[data-widget-id]")?.getAttribute("data-debug-h")).toBe("0");
  });
});
