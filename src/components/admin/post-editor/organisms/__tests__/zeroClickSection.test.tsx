// CO DOWODZI TEN PLIK: zakładka „Zero-click" ma dwa zobowiązania, których nie
// pilnują ani typy, ani pozostałe testy edytora.
//
//   1. MIERZY TEN wpis, i to OSOBNO dla PL i EN. Wersja angielska bywa
//      tłumaczeniem, które zgubiło nagłówki-pytania albo blok FAQ - jeden
//      wspólny wynik ukryłby dokładnie ten przypadek. Sekcja musi też czytać
//      właściwą gałąź drzewa bloków dla właściwego języka; podmiana `pl`/`en`
//      jest niewidoczna w typach (obie gałęzie mają ten sam kształt).
//   2. NIE WYCIEKA POZA EDYTOR WPISU. Wymóg brzmiał: ściągawka pokazuje się
//      przy tworzeniu i edytowaniu WPISÓW. Edytor stron dzieli z edytorem wpisu
//      panel SEO i kilka molekuł, więc „przy okazji" dołożona ściągawka
//      pojawiłaby się i tam - stąd bramka na źródłach.
import { describe, expect, it, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, cleanup, within } from "@testing-library/react";
import { vi } from "vitest";
import { postEditorFormApi, postForm } from "@/test/post-editor/fixtures";

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-zero-click", () => ({ ensureI18n: () => {} }));

import { ZeroClickSection } from "../ZeroClickSection";
import type { PostEditorFormApi } from "../../hooks";

afterEach(cleanup);

/** Akapit definicyjny o zadanej liczbie słów (budżet leadu to 40-70). */
function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `słowo${i + 1}`).join(" ");
}

function mount(overrides: Parameters<typeof postForm>[0] = {}) {
  const api = postEditorFormApi() as unknown as PostEditorFormApi;
  const formApi = {
    ...api,
    form: postForm(overrides),
  } as unknown as PostEditorFormApi;
  return render(<ZeroClickSection formApi={formApi} />);
}

/** Lista reguł dla jednej kolumny językowej (PL = pierwsza, EN = druga). */
function columnRows(index: 0 | 1): string[] {
  const lists = screen.getAllByRole("list");
  return within(lists[index])
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "");
}

describe("ZeroClickSection", () => {
  it("nie renderuje się, dopóki formularz jest `null` (wiersz wpisu się wczytuje)", () => {
    const formApi = { ...postEditorFormApi(), form: null } as unknown as PostEditorFormApi;
    const { container } = render(<ZeroClickSection formApi={formApi} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("pokazuje komplet reguł dla OBU języków - dwie niezależne kolumny", () => {
    mount();
    // Sześć reguł razy dwa języki. Gdyby sekcja liczyła jeden wspólny wynik,
    // angielska kolumna by nie istniała.
    expect(columnRows(0)).toHaveLength(6);
    expect(columnRows(1)).toHaveLength(6);
    expect(screen.getByText("adminZeroClick.checklist.langPl")).toBeInTheDocument();
    expect(screen.getByText("adminZeroClick.checklist.langEn")).toBeInTheDocument();
  });

  it("liczy wynik OSOBNO per język - polska wersja gotowa, angielska nie", () => {
    mount({
      content_pl: `<p>${words(50)}</p><ul><li>Krok</li></ul>`,
      content_en: "<p>Short.</p>",
      takeaways_pl: ["Raz", "Dwa", "Trzy"],
      takeaways_en: [],
    });
    const [plScore, enScore] = screen
      .getAllByText(/adminZeroClick\.checklist\.score/)
      .map((el) => el.textContent ?? "");
    // Wynik jedzie w parametrach klucza (stub i18n serializuje je do JSON-a).
    expect(plScore).toContain('"passed":3');
    expect(enScore).toContain('"passed":0');
  });

  it("czyta gałąź bloków ODPOWIADAJĄCĄ językowi kolumny", () => {
    // Lista tylko po angielsku: zamiana gałęzi pl/en przestawiłaby zielony
    // wiersz „skanowalność" na niewłaściwą kolumnę i nikt by tego nie zauważył.
    mount({
      content_pl: null,
      content_en: null,
      blocks_data: {
        pl: { version: 1, blocks: [] },
        en: { version: 1, blocks: [{ id: "b1", type: "list", data: { items: ["Step"] } }] },
      },
    } as Parameters<typeof postForm>[0]);
    expect(columnRows(0).join(" ")).toContain("adminZeroClick.rules.scannable.todo");
    expect(columnRows(1).join(" ")).toContain("adminZeroClick.rules.scannable.ok");
  });

  it("status niesie tekstową etykietę, nie tylko kolor ikony", () => {
    // Sam kolor nie istnieje dla czytnika ekranu ani dla osoby
    // nierozróżniającej barw - wiersz musi mówić, co znaczy.
    mount();
    expect(screen.getAllByText(/adminZeroClick\.checklist\.status/).length).toBeGreaterThan(0);
  });

  it("ściągawka jest zwinięta, ale jej sekcje są dostępne jako przyciski", () => {
    mount();
    const triggers = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(triggers).toContain("adminZeroClick.skeleton.title");
    expect(triggers).toContain("adminZeroClick.breadcrumbs.title");
    expect(triggers).toContain("adminZeroClick.balance.title");
    expect(triggers).toContain("adminZeroClick.metrics.title");
    // Reguła po regule - te same identyfikatory, co w checkliście.
    expect(triggers).toContain("adminZeroClick.rules.lead.title");
    expect(triggers).toContain("adminZeroClick.rules.faqAnswerLength.title");
  });
});

describe("zasięg ściągawki", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("montuje ją WYŁĄCZNIE panel szczegółów wpisu", () => {
    expect(read("src/components/admin/post-editor/organisms/PostDetailsPanel.tsx")).toContain(
      "<ZeroClickSection",
    );
  });

  it("edytor STRON jej nie widzi", () => {
    // Strony i wpisy dzielą panel SEO; ściągawka ma zostać po stronie wpisów.
    const pagesEditor = read("src/routes/admin.pages.$slug.tsx");
    expect(pagesEditor).not.toContain("ZeroClick");
    expect(pagesEditor).not.toContain("i18n-admin-zero-click");
  });

  it("wspólny panel SEO jej nie wciąga (inaczej trafiłaby do stron tylnymi drzwiami)", () => {
    expect(read("src/components/admin/seo/SeoPanel.tsx")).not.toContain("ZeroClick");
  });
});
