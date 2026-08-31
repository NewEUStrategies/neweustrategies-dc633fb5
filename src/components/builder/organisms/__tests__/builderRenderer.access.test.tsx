// PUBLICZNY RENDERER: KONTROLA DOSTĘPU I WIDOCZNOŚĆ NA URZĄDZENIU.
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// Bramka `advanced.access` jest sprawdzana na CZTERECH poziomach drzewa i każdy
// z nich ma tu własny dowód: sekcja (L359), dziecko sekcji - kolumna albo sekcja
// zagnieżdżona (L546), kolumna WEWNĄTRZ sekcji zagnieżdżonej (L729) i widget
// (L799). Ostatni z tych poziomów był kiedyś jedynym pominiętym - reguła na
// kolumnie w sekcji zagnieżdżonej nie działała po nawigacji SPA - więc test
// pilnuje wszystkich czterech naraz.
//
// Sprawdzamy też ramię „reguła nieczytelna dla tej wersji buildera" (wartość
// poza unią przyjeżdża z kolumny jsonb): taka bramka MUSI zamknąć treść, bo
// odwrotna wartość domyślna opublikowałaby dokładnie to, co ktoś próbował
// zamknąć.
//
// ── CZEGO TU ŚWIADOMIE NIE MA ──────────────────────────────────────────────
// Kontekst dostępu pochodzi z `useAuth`, którego domyślna wartość kontekstu to
// gość bez roli - i to jest DOKŁADNIE stan renderu publicznego (sesja Supabase
// siedzi w localStorage, więc SSR jest anonimowy z konstrukcji). Ścieżek
// zalogowanego użytkownika i ról nie da się tu wysterować bez postawienia
// całego `AuthProvider` z klientem Supabase; sama funkcja `evaluateAccess` ma
// pełny zestaw przypadków w `src/lib/builder/__tests__/accessControl.test.ts`.
// Renderer korzysta z niej wyłącznie jako z predykatu prawda/fałsz i OBA ramiona
// tego predykatu są tutaj wykonane.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import "@/test/i18nReal";
import { __resetBuilderDebugForTests } from "@/lib/builder/builderDebug";
import { BuilderRenderer } from "../BuilderRenderer";
import {
  column,
  doc,
  gate,
  innerSection,
  section,
  simpleSection,
  stubObservers,
  widget,
} from "./builderRendererFixtures";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

let observers: ReturnType<typeof stubObservers>;

beforeEach(() => {
  observers = stubObservers();
  __resetBuilderDebugForTests();
});

afterEach(() => {
  cleanup();
  observers.restore();
  __resetBuilderDebugForTests();
});

/** Bramka „tylko dla zalogowanych" - dla gościa (czyli renderu publicznego) zamknięta. */
const TYLKO_ZALOGOWANI = gate({ auth: "user" });
/** Bramka „tylko dla gościa" - dla renderu publicznego otwarta. */
const TYLKO_GOSC = gate({ auth: "guest" });
/** Bramka wymagająca roli - role dotyczą wyłącznie zalogowanych, więc zamknięta. */
const TYLKO_REDAKCJA = gate({ auth: "any", roles: ["editor"], rolesMode: "any" });
/** Bramka spoza unii - zapis z nowszego buildera albo ręczna edycja wiersza. */
const NIECZYTELNA = gate({ auth: "superuser" } as never);

describe("bramka dostępu na SEKCJI", () => {
  it("sekcja tylko dla zalogowanych nie trafia do HTML gościa", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          simpleSection("jawna"),
          simpleSection("zamknieta", { advanced: TYLKO_ZALOGOWANI }),
        ])}
        lang="pl"
      />,
    );
    const ids = [...container.querySelectorAll("[data-sec-id]")].map((el) =>
      el.getAttribute("data-sec-id"),
    );
    expect(ids).toEqual(["jawna"]);
    // Nie „ukryta CSS-em", a NIEOBECNA: treści za bramką nie ma w dokumencie.
    expect(container.textContent).not.toContain("T-zamknieta-w");
  });

  it("sekcja tylko dla gościa renderuje się na stronie publicznej", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([simpleSection("dla-gosci", { advanced: TYLKO_GOSC })])}
        lang="pl"
      />,
    );
    expect(container.querySelector('[data-sec-id="dla-gosci"]')).not.toBeNull();
  });

  it("sekcja wymagająca roli jest zamknięta dla anonimowego czytelnika", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([simpleSection("redakcja", { advanced: TYLKO_REDAKCJA })])}
        lang="pl"
      />,
    );
    expect(container.querySelectorAll("[data-sec-id]").length).toBe(0);
  });

  it("reguła NIECZYTELNA dla tej wersji buildera zamyka sekcję (fail closed)", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([simpleSection("nieznana-regula", { advanced: NIECZYTELNA })])}
        lang="pl"
      />,
    );
    expect(container.querySelectorAll("[data-sec-id]").length).toBe(0);
  });

  it("brak reguły = sekcja jawna (domyślnie nic nie jest zamknięte)", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([simpleSection("bez-reguly")])} lang="pl" />,
    );
    expect(container.querySelector('[data-sec-id="bez-reguly"]')).not.toBeNull();
  });
});

describe("bramka dostępu na DZIECKU sekcji", () => {
  it("zamknięta kolumna najwyższego poziomu nie trafia do HTML, sąsiednia zostaje", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s", [
            column("jawna", [widget("w-jawny")], { span: { desktop: 6 } }),
            column("zamknieta", [widget("w-tajny")], {
              span: { desktop: 6 },
              advanced: TYLKO_ZALOGOWANI,
            }),
          ]),
        ])}
        lang="pl"
        device="desktop"
      />,
    );
    expect(container.querySelector('[data-col-id="jawna"]')).not.toBeNull();
    expect(container.querySelector('[data-col-id="zamknieta"]')).toBeNull();
    expect(container.textContent).not.toContain("T-w-tajny");
  });

  it("zdjęta kolumna nie liczy się do sumy spanów siatki", () => {
    // Zamknięta kolumna 6/12 zniknęłaby z siatki, ale zostawiłaby po sobie
    // dziurę, gdyby suma liczyła się przed filtrem.
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s", [
            column("jawna", [widget("w1")], { span: { desktop: 6 } }),
            column("zamknieta", [widget("w2")], {
              span: { desktop: 6 },
              advanced: TYLKO_ZALOGOWANI,
            }),
          ]),
        ])}
        lang="pl"
        device="desktop"
      />,
    );
    const row = container.querySelector<HTMLElement>("[data-columns-row]");
    expect(row?.style.gridTemplateColumns).toBe("repeat(6, minmax(0, 1fr))");
  });

  it("zamknięta SEKCJA ZAGNIEŻDŻONA znika razem ze swoimi kolumnami", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s", [
            innerSection("tajna", [column("i-tajna", [widget("iw")])], {
              advanced: TYLKO_ZALOGOWANI,
            }),
            column("jawna", [widget("w1")]),
          ]),
        ])}
        lang="pl"
      />,
    );
    expect(container.textContent).not.toContain("T-iw");
    expect(container.querySelector('[data-col-id="jawna"]')).not.toBeNull();
  });

  it("dziecko sekcji, które nie jest obiektem, jest po prostu pomijane", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={
          {
            version: 1,
            sections: [{ id: "s", kind: "section", children: [null, column("ok", [widget("w")])] }],
          } as never
        }
        lang="pl"
      />,
    );
    expect(container.querySelectorAll("[data-column-slot]").length).toBe(1);
  });
});

describe("bramka dostępu na KOLUMNIE W SEKCJI ZAGNIEŻDŻONEJ", () => {
  it("zamknięta kolumna wewnętrzna nie trafia do HTML, a rodzeństwo zostaje", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s", [
            innerSection("inner", [
              column("i-jawna", [widget("iw-jawny")], { span: { desktop: 6 } }),
              column("i-zamknieta", [widget("iw-tajny")], {
                span: { desktop: 6 },
                advanced: TYLKO_ZALOGOWANI,
              }),
            ]),
          ]),
        ])}
        lang="pl"
        device="desktop"
      />,
    );
    expect(container.querySelector('[data-col-id="i-jawna"]')).not.toBeNull();
    expect(container.querySelector('[data-col-id="i-zamknieta"]')).toBeNull();
    expect(container.textContent).not.toContain("T-iw-tajny");
  });

  it("sekcja zagnieżdżona bez tablicy `columns` renderuje pustą siatkę", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={
          {
            version: 1,
            sections: [
              {
                id: "s",
                kind: "section",
                children: [{ id: "inner", kind: "inner-section", columns: "nie-tablica" }],
              },
            ],
          } as never
        }
        lang="pl"
      />,
    );
    const wiersze = [...container.querySelectorAll<HTMLElement>("[data-columns-row]")];
    expect(wiersze).toHaveLength(2);
    expect(wiersze[1].style.gridTemplateColumns).toBe("repeat(12, minmax(0, 1fr))");
  });
});

describe("bramka dostępu na WIDGECIE", () => {
  it("zamknięty widget nie trafia do HTML, a sąsiedni zostaje", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s", [
            column("k", [
              widget("jawny"),
              widget("tajny", "heading", { advanced: { ...TYLKO_ZALOGOWANI } }),
              widget("dla-gosci", "heading", { advanced: { ...TYLKO_GOSC } }),
            ]),
          ]),
        ])}
        lang="pl"
      />,
    );
    const ids = [...container.querySelectorAll("[data-widget-id]")].map((el) =>
      el.getAttribute("data-widget-id"),
    );
    expect(ids).toEqual(["jawny", "dla-gosci"]);
  });

  it("nieczytelna reguła na widgecie zamyka widget", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s", [column("k", [widget("w", "heading", { advanced: { ...NIECZYTELNA } })])]),
        ])}
        lang="pl"
      />,
    );
    expect(container.querySelectorAll("[data-widget-id]").length).toBe(0);
  });
});

describe("LUKA: `advanced.hideOn` działa TYLKO dla widgetów", () => {
  // Panel wystawia ten sam przełącznik widoczności na TRZECH poziomach:
  //   * widget  - `AdvancedPane` widgetu -> renderer honoruje (`hiddenOnDevice`,
  //     L798 - dowód w builderRenderer.device.test.tsx),
  //   * sekcja  - `section-properties/AdvancedPane.tsx` (VisibilityControl),
  //   * kolumna - `ui/organisms/ColumnProperties.tsx` (VisibilityControl).
  // Publiczny renderer filtruje `hideOn` WYŁĄCZNIE dla widgetów. Sekcja albo
  // kolumna oznaczona w panelu jako „ukryta na telefonie" jedzie do czytelnika
  // razem z całą treścią - nie ma nawet reguły CSS, która by ją schowała.
  // To nie jest kosmetyka: tak wygląda „ukryj wersję desktopową na telefonie",
  // czyli podwójna treść i podwójny obraz LCP na łączu komórkowym.
  //
  // Zarejestrowane jako `it.fails`, bo naprawa to zmiana ZACHOWANIA produkcji
  // (nowy filtr w `SectionsList` i w `RenderSection`), a testy tego zadania
  // produkcji nie zmieniają. Gdy filtr powstanie, oba przypadki zrobią się
  // zielone i vitest sam zgłosi, że `it.fails` jest już nieprawdziwe.

  it.fails("sekcja z hideOn.mobile POWINNA zniknąć na telefonie, a nie znika", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          simpleSection("widoczna"),
          simpleSection("ukryta-na-tel", { advanced: { hideOn: { mobile: true } } }),
        ])}
        lang="pl"
        device="mobile"
      />,
    );
    expect(container.querySelector('[data-sec-id="ukryta-na-tel"]')).toBeNull();
  });

  it.fails("kolumna z hideOn.mobile POWINNA zniknąć na telefonie, a nie znika", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s", [
            column("widoczna", [widget("w1")]),
            column("ukryta-na-tel", [widget("w2")], { advanced: { hideOn: { mobile: true } } }),
          ]),
        ])}
        lang="pl"
        device="mobile"
      />,
    );
    expect(container.querySelector('[data-col-id="ukryta-na-tel"]')).toBeNull();
  });
});
