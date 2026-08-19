// Przegląd ogólny wpisu (`PostGeneralOverview`, 619 linii, 0%) — ekran startowy
// kroku „Szczegóły": pola tytułu i zajawki PL/EN, pasek kompletności i siatka
// kafelków prowadzących do pozostałych zakładek.
//
// To jedyny widok, z którego redaktor ocenia stan wpisu JEDNYM spojrzeniem,
// więc liczy się tu prawdziwość podsumowań. Cztery rzeczy są warte testu:
//
//   1. LICZNIKI MÓWIĄ PRAWDĘ. Kafelek pokazujący „3 pola" tam, gdzie wypełnione
//      jest jedno, jest gorszy niż brak kafelka — redaktor przestaje sprawdzać.
//      Puste wartości NIE mogą się liczyć jako wypełnione.
//   2. PASEK KOMPLETNOŚCI ODRÓŻNIA BŁĄD OD OSTRZEŻENIA. Blokujący problem SEO
//      wstrzymuje zapis; ostrzeżenie nie. Wspólny kolor kazałby redaktorowi
//      zgadywać, czy może publikować.
//   3. KAFELEK PROWADZI DO SWOJEJ ZAKŁADKI. Pomylone przejście wysyła redaktora
//      w miejsce, w którym nie ma tego, co kliknął.
//   4. DOSTĘP CZYTANY Z BAZY, nie z formularza. Reguła dostępu żyje w osobnej
//      tabeli; pokazanie „publiczny" dla wpisu za paywallem byłoby błędną
//      informacją o tym, kto widzi treść.
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, okCount, type SupabaseFromStub } from "@/test/supabaseChain";
import { seoIssue } from "@/test/post-editor/fixtures";

const stubs = vi.hoisted(() => ({ from: null as unknown, rpc: null as unknown }));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const { vi: v } = await import("vitest");
  const from = supabaseFromStub();
  const rpc = v.fn(async () => ({ data: false, error: null }));
  stubs.from = from;
  stubs.rpc = rpc;
  return { supabase: { from: from.from, rpc } };
});

import { PostGeneralOverview } from "@/components/admin/PostGeneralOverview";

const db = stubs.from as SupabaseFromStub;
const rpc = () => stubs.rpc as ReturnType<typeof vi.fn>;

type Props = Parameters<typeof PostGeneralOverview>[0];

function renderOverview(over: Partial<Props> = {}) {
  const onNavigate = vi.fn();
  const props: Props = {
    entityId: "post-1",
    titlePl: "Polski tytuł",
    titleEn: "English title",
    onTitlePlChange: vi.fn(),
    onTitleEnChange: vi.fn(),
    excerptPl: "Zajawka",
    excerptEn: "Excerpt",
    onExcerptPlChange: vi.fn(),
    onExcerptEnChange: vi.fn(),
    status: "draft",
    slug: "moj-wpis",
    coverImageUrl: "https://cdn/cover.jpg",
    publishedAt: null,
    publishAt: null,
    seoTitlePl: null,
    seoTitleEn: null,
    seoDescriptionPl: null,
    seoDescriptionEn: null,
    seoNoindex: false,
    seoIssues: [],
    tocOverride: null,
    takeawaysPl: [],
    takeawaysEn: [],
    customMeta: null,
    relatedOverride: null,
    postFormat: "standard" as Props["postFormat"],
    layoutOverrides: null,
    selectedCatNames: [],
    selectedTagNames: [],
    onNavigate,
    ...over,
  };
  return { ...renderWithQueryClient(<PostGeneralOverview {...props} />), onNavigate, props };
}

beforeEach(() => {
  db.reset();
  db.setResponse("content_access", ok(null));
  db.setResponse("content_revisions", okCount(0));
  rpc().mockReset();
  rpc().mockResolvedValue({ data: false, error: null });
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Pola tytułu i zajawki
// ---------------------------------------------------------------------------

describe("PostGeneralOverview - pola tytułu i zajawki", () => {
  it("cztery pola piszą do CZTERECH różnych callbacków", () => {
    // Pola PL i EN wyglądają identycznie; pomyłka nadpisuje treść w drugim
    // języku bez żadnego sygnału.
    const { props } = renderOverview();

    fireEvent.change(screen.getByPlaceholderText("adminPostPanes.general.titlePlPlaceholder"), {
      target: { value: "Nowy PL" },
    });
    fireEvent.change(screen.getByPlaceholderText("Title in English"), {
      target: { value: "New EN" },
    });
    fireEvent.change(screen.getByPlaceholderText("adminPostPanes.general.excerptPlPlaceholder"), {
      target: { value: "Zajawka PL" },
    });
    fireEvent.change(screen.getByPlaceholderText("Short excerpt in English"), {
      target: { value: "Excerpt EN" },
    });

    expect(props.onTitlePlChange).toHaveBeenCalledWith("Nowy PL");
    expect(props.onTitleEnChange).toHaveBeenCalledWith("New EN");
    expect(props.onExcerptPlChange).toHaveBeenCalledWith("Zajawka PL");
    expect(props.onExcerptEnChange).toHaveBeenCalledWith("Excerpt EN");
  });

  it("licznik znaków zajawki liczy DŁUGOŚĆ, nie obecność", () => {
    // Redakcja pilnuje długości zajawki pod kartę społecznościową.
    renderOverview({ excerptPl: "12345", excerptEn: "" });
    const counters = screen.getAllByText(/adminPostPanes\.general\.charsCount/);
    expect(counters[0].textContent).toContain('"n":5');
    expect(counters[1].textContent).toContain('"n":0');
  });

  it("brak tytułu jest oznaczony ostrzeżeniem przy JEGO stronie językowej", () => {
    renderOverview({ titlePl: "Jest", titleEn: "   " });
    // Jedna strona ma znacznik „brak", druga potwierdzenie.
    expect(screen.getAllByText("adminPostPanes.general.none").length).toBeGreaterThan(0);
    expect(screen.getAllByText("✓").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Pasek kompletności
// ---------------------------------------------------------------------------

describe("PostGeneralOverview - pasek kompletności", () => {
  it("oba tytuły wypełnione dają znacznik kompletu, jeden brakujący 1/2", () => {
    renderOverview({ titlePl: "PL", titleEn: "EN" });
    expect(screen.getByText(/adminPostPanes\.general\.titlesChip/).textContent).toContain("✓");
    cleanup();

    renderOverview({ titlePl: "PL", titleEn: "" });
    expect(screen.getByText(/adminPostPanes\.general\.titlesChip/).textContent).toContain("1/2");
  });

  it("BLOKUJĄCY problem SEO jest odróżniony od ostrzeżenia", () => {
    // Blokujący wstrzymuje zapis, ostrzeżenie nie - wspólny komunikat kazałby
    // redaktorowi zgadywać, czy może publikować.
    // Komunikat pada w DWOCH miejscach: w pasku kompletnosci i w kafelku SEO -
    // oba sa poprawne, wiec liczymy wystapienia zamiast zadac jednego.
    renderOverview({ seoIssues: [seoIssue({ severity: "error" })] });
    expect(screen.getAllByText(/adminPostPanes\.general\.seoErrors/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/adminPostPanes\.general\.seoWarnings/)).toHaveLength(0);
    cleanup();

    renderOverview({ seoIssues: [seoIssue({ severity: "warning" })] });
    expect(screen.getAllByText(/adminPostPanes\.general\.seoWarnings/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/adminPostPanes\.general\.seoErrors/)).toHaveLength(0);
  });

  it("błąd MA PIERWSZEŃSTWO nad ostrzeżeniem", () => {
    // Wpis z jednym błędem i pięcioma ostrzeżeniami nadal nie da się zapisać.
    renderOverview({
      seoIssues: [seoIssue({ severity: "error" }), seoIssue({ severity: "warning" })],
    });
    expect(screen.getAllByText(/adminPostPanes\.general\.seoErrors/)[0].textContent).toContain(
      '"n":1',
    );
  });

  it("brak problemów SEO pokazuje OK", () => {
    renderOverview({ seoIssues: [] });
    expect(screen.getByText(/^SEO OK$/)).toBeInTheDocument();
  });

  it("`noindex` jest wyróżniony osobno", () => {
    // Wpis wyłączony z indeksowania to decyzja, o której łatwo zapomnieć.
    renderOverview({ seoNoindex: true });
    expect(screen.getAllByText("noindex").length).toBeGreaterThan(0);
    cleanup();

    renderOverview({ seoNoindex: false });
    expect(screen.queryAllByText("noindex")).toHaveLength(0);
  });

  it("brak okładki jest widoczny w pasku", () => {
    renderOverview({ coverImageUrl: null });
    expect(screen.getByText(/^Cover adminPostPanes\.general\.none$/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Liczniki kafelków
// ---------------------------------------------------------------------------

describe("PostGeneralOverview - liczniki mówią prawdę", () => {
  it("PUSTE wartości pól meta NIE liczą się jako wypełnione", () => {
    // Kafelek „3 pola" przy jednym wypełnionym sprawia, że redaktor przestaje
    // sprawdzać zakładkę.
    renderOverview({ customMeta: { a: "wartość", b: "", c: "   " } });
    const tile = screen.getByText("adminPostPanes.general.titleMeta").closest("button")!;
    expect(tile.textContent).toContain("1");
  });

  it("brak pól meta to zero, nie pustka", () => {
    renderOverview({ customMeta: null });
    const tile = screen.getByText("adminPostPanes.general.titleMeta").closest("button")!;
    expect(tile.textContent).toContain("0");
  });

  it("wnioski są wypisane OSOBNO dla PL i EN, a brak obu jest zachętą", () => {
    // Wpis z trzema wnioskami PL i jednym EN ma dwie pozycje do przetlumaczenia -
    // wspolna liczba ukrylaby, ktora wersja jest niepelna.
    renderOverview({ takeawaysPl: ["a", "b", "c"], takeawaysEn: ["a"] });
    const counts = screen
      .getAllByText(/adminPostPanes\.general\.takeawaysCount/)
      .map((n) => n.textContent);
    expect(counts.some((c) => c?.includes('"count":3'))).toBe(true);
    expect(counts.some((c) => c?.includes('"count":1'))).toBe(true);
    // Sa wnioski - zachety nie ma.
    expect(screen.queryByText("adminPostPanes.general.takeawaysSuggestion")).toBeNull();
  });

  it("brak wniosków w OBU językach pokazuje zachętę", () => {
    renderOverview({ takeawaysPl: [], takeawaysEn: [] });
    expect(screen.getByText("adminPostPanes.general.takeawaysSuggestion")).toBeInTheDocument();
  });

  it("nadpisania layoutu liczą tylko wartości USTAWIONE", () => {
    // `undefined` znaczy „dziedzicz z ustawień globalnych" - policzenie go jako
    // nadpisania sugerowałoby, że wpis odbiega od reguły serwisu.
    renderOverview({
      layoutOverrides: {
        showAuthor: true,
        showToc: undefined,
        sidebar: null,
        layout: "",
      } as unknown as Props["layoutOverrides"],
    });
    const tile = screen.getByText("adminPostPanes.general.titleLayout").closest("button")!;
    // Liczy sie WYLACZNIE `showAuthor: true` - `undefined`, `null` i pusty
    // string to „dziedzicz", nie nadpisanie.
    expect(tile.textContent).toContain('"count":1');
  });

  it("brak nadpisan layoutu mowi wprost brak, a nie zero pol", () => {
    // „0 pol" brzmi jak wynik liczenia, „brak" jak stan - a to jest stan
    // domyslny: wpis dziedziczy caly uklad z ustawien serwisu.
    renderOverview({ layoutOverrides: null });
    const tile = screen.getByText("adminPostPanes.general.titleLayout").closest("button")!;
    expect(tile.textContent).toContain("Overrides");
    expect(tile.textContent).toContain("adminPostPanes.general.none");
    expect(tile.textContent).not.toMatch(/fieldsCount/);
  });

  it("kategorie i tagi są wypisane, gdy są wybrane", () => {
    renderOverview({
      selectedCatNames: ["Polityka spójności"],
      selectedTagNames: ["fundusze", "region"],
    });
    const tile = screen.getByText("adminPostPanes.general.titleTaxonomy").closest("button")!;
    expect(tile.textContent).toContain("Polityka spójności");
    expect(tile.textContent).toContain("fundusze");
  });
});

// ---------------------------------------------------------------------------
// Stan z bazy
// ---------------------------------------------------------------------------

describe("PostGeneralOverview - stan czytany z bazy", () => {
  it("domyślnie (brak reguły) dostęp jest PUBLICZNY", () => {
    renderOverview();
    return waitFor(() =>
      expect(screen.getByText(/adminPostPanes\.general\.accessChip/).textContent).toContain(
        "accessPublic",
      ),
    );
  });

  it("reguła płatna jest pokazana jako płatna, nie jako publiczna", async () => {
    // Pokazanie „publiczny" dla wpisu za paywallem byłoby błędną informacją
    // o tym, kto realnie widzi treść.
    db.setResponse("content_access", ok({ mode: "paid", plan_ids: ["plan-1"] }));
    renderOverview();

    await waitFor(() =>
      expect(screen.getByText(/adminPostPanes\.general\.accessChip/).textContent).toContain(
        "accessPaid",
      ),
    );
  });

  it("reguła hasłem pyta bazę o OBECNOŚĆ hasła osobnym RPC", async () => {
    // Hasło nie jest czytelne przez RLS - panel może się dowiedzieć tylko, CZY
    // jest ustawione.
    db.setResponse("content_access", ok({ mode: "password" }));
    rpc().mockResolvedValue({ data: true, error: null });
    renderOverview();

    await waitFor(() =>
      expect(rpc()).toHaveBeenCalledWith("content_access_has_password", {
        _entity_type: "post",
        _entity_id: "post-1",
      }),
    );
  });

  it("liczba rewizji jest czytana zapytaniem LICZĄCYM, bez pobierania wierszy", async () => {
    // Historia wpisu bywa gruba; pobieranie migawek tylko po to, żeby je
    // policzyć, ładowałoby megabajty do kafelka.
    db.setResponse("content_revisions", okCount(7));
    renderOverview();

    await waitFor(() => {
      const tile = screen.getByText("adminPostPanes.general.titleRevisions").closest("button")!;
      expect(tile.textContent).toContain("7");
    });
    const chain = db.lastChain("content_revisions")!;
    expect(chain.argsOf("select")?.[1]).toMatchObject({ count: "exact", head: true });
  });

  it("BEZ id wpisu nie odpytuje bazy w ogóle", () => {
    // Nowy wpis nie ma jeszcze wiersza - zapytanie o jego dostęp i rewizje
    // byłoby zapytaniem o nic.
    renderOverview({ entityId: "" });
    expect(db.chainsFor("content_access")).toHaveLength(0);
    expect(db.chainsFor("content_revisions")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Nawigacja
// ---------------------------------------------------------------------------

describe("PostGeneralOverview - kafelek prowadzi do SWOJEJ zakładki", () => {
  it("każdy kafelek wywołuje przejście z własnym identyfikatorem", () => {
    // Pomylone przejście wysyła redaktora tam, gdzie nie ma tego, co kliknął.
    const { onNavigate } = renderOverview();

    const expected: Array<[string, string]> = [
      ["adminPostPanes.general.titlePublish", "publish"],
      ["adminPostPanes.general.titleSeo", "seo"],
      ["adminPostPanes.general.titleTaxonomy", "taxonomy"],
      ["adminPostPanes.general.titleLayout", "layout"],
      ["adminPostPanes.general.titleMeta", "meta"],
      ["adminPostPanes.general.titleRelated", "related"],
      ["adminPostPanes.general.titleAccess", "access"],
      ["adminPostPanes.general.titleRevisions", "revisions"],
      ["adminPostPanes.general.titleSettings", "settings"],
    ];

    for (const [title, tab] of expected) {
      onNavigate.mockClear();
      const tile = screen.getByText(title).closest("button");
      if (!tile) continue;
      fireEvent.click(tile);
      expect(onNavigate, tab).toHaveBeenCalledWith(tab);
    }
  });

  it("kafelki są PRZYCISKAMI, nie klikalnymi diwami", () => {
    // Klikalny `div` jest nieosiągalny z klawiatury i niewidoczny dla czytnika
    // ekranu jako element interaktywny.
    renderOverview();
    const tile = screen.getByText("adminPostPanes.general.titleSeo").closest("button");
    expect(tile?.tagName).toBe("BUTTON");
    expect(tile).toHaveAttribute("type", "button");
  });
});
