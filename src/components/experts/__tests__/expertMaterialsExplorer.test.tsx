// Eksplorator materiałów eksperta - stan w URL, paginacja po stronie bazy.
//
// 333 linie, zero wykonanych. Ten organizm nie trzyma własnego stanu: filtry
// i numer strony żyją w search params trasy /author/$slug, a stronę wycina
// RPC. Cała jego logika to więc odpowiedź na pytanie „jaki URL zbudować" - i
// dokładnie to jest tutaj przypięte, bo trzy reguły tej budowy łamie się
// przypadkiem przy pierwszym refaktorze:
//   1. zmiana filtra WRACA na stronę 1 (inaczej czytelnik ląduje na pustej
//      stronie 7 nowego, węższego zbioru),
//   2. strona 1 i filtr pusty NIE trafiają do URL-a (kanoniczny adres profilu
//      musi być jeden - inaczej mnożą się duplikaty dla wyszukiwarki),
//   3. nawigacja idzie z `resetScroll: false`, bo kotwicą jest sekcja
//      materiałów; globalny scroll-to-top wyrzuca czytelnika do hero.
//
// PUŁAPKA HARNESSU: Radix Select nie otwiera się w happy-dom (konwencja repo
// - patrz `FormSelect.test.tsx`). Podmieniamy więc prymitywy `ui/select` na
// natywny `<select>`: przedmiotem testu jest to, CO robi zmiana filtra, a nie
// to, jak Radix rysuje listę - ta ma własne testy.
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { ensureI18n as ensureExpertsI18n } from "@/lib/i18n-experts";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { expertHub, expertMaterial } from "@/test/experts/fixtures";
import type { ExpertHubData, ExpertMaterial } from "@/lib/experts/types";
import type { AuthorHubSearch } from "@/lib/experts/materialsSearch";

const state = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
  /** Wynik zapytania o stronę - podmieniany per test (także na błąd/zawis). */
  page: (() =>
    Promise.resolve({ materials: [], total: 0, page: 1, pageSize: 9 })) as () => Promise<{
    materials: ExpertMaterial[];
    total: number;
    page: number;
    pageSize: number;
  }>,
}));

vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    Link: RouterLinkStub,
    getRouteApi: () => ({
      useParams: () => ({ slug: "anna-kowalska" }),
      useSearch: () => state.search,
      useNavigate: () => state.navigate,
    }),
  };
});

vi.mock("@/lib/experts/materials", () => ({
  expertMaterialsQueryOptions: (slug: string, opts: { page: number; filters: unknown }) => ({
    queryKey: ["expert-materials", slug, opts.page, opts.filters],
    queryFn: () => state.page(),
  }),
}));

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Props = Record<string, unknown> & { children?: React.ReactNode };
  const tag = (kind: string, Comp: (p: Props) => React.ReactNode) => Object.assign(Comp, { kind });

  const SelectItem = tag("item", ({ value, children }: Props) => (
    <option value={String(value)}>{children}</option>
  ));
  const SelectContent = tag("content", ({ children }: Props) => <>{children}</>);
  const SelectTrigger = tag("trigger", () => null);
  const SelectValue = tag("value", () => null);

  const Select = ({ value, onValueChange, children }: Props) => {
    // Etykieta siedzi na triggerze, a opcje w treści - natywny <select>
    // potrzebuje obu w jednym miejscu, więc czytamy je z drzewa dzieci.
    let label: string | undefined;
    const items: React.ReactElement[] = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const kind = (child.type as { kind?: string }).kind;
      const props = child.props as Props;
      if (kind === "trigger") label = props["aria-label"] as string;
      if (kind === "content") {
        React.Children.forEach(props.children, (item, i) => {
          if (React.isValidElement(item)) items.push(React.cloneElement(item, { key: i }));
        });
      }
    });
    return (
      <select
        aria-label={label}
        value={String(value ?? "")}
        onChange={(e) => (onValueChange as (v: string) => void)?.(e.target.value)}
      >
        {items}
      </select>
    );
  };

  return { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
});

const { ExpertMaterialsExplorer } = await import("@/components/experts/ExpertMaterialsExplorer");

ensureExpertsI18n();
const t = realT("pl");

function hubWith(materials: ExpertMaterial[], facets?: Partial<ExpertHubData["facets"]>) {
  return expertHub({
    materials,
    facets: {
      programs: [],
      regions: [],
      categories: [],
      tags: [],
      ...facets,
    } as ExpertHubData["facets"],
  });
}

function explorer(hub: ExpertHubData, lang: "pl" | "en" = "pl") {
  return renderWithQueryClient(<ExpertMaterialsExplorer data={hub} lang={lang} />);
}

/** Search params przekazane do ostatniego `navigate` (updater rozwinięty). */
function lastSearch(): AuthorHubSearch {
  const call = state.navigate.mock.calls.at(-1)?.[0] as {
    search: (prev: AuthorHubSearch) => AuthorHubSearch;
  };
  return call.search(state.search as AuthorHubSearch);
}

const article = expertMaterial({ id: "a1", kind: "article", date: "2026-05-01" });

beforeEach(() => {
  state.search = {};
  state.navigate = vi.fn();
  state.page = () => Promise.resolve({ materials: [article], total: 1, page: 1, pageSize: 9 });
});

afterEach(async () => {
  await i18n.changeLanguage("pl");
  vi.clearAllMocks();
});

describe("ExpertMaterialsExplorer - ekspert bez dorobku", () => {
  it("pokazuje komunikat zamiast pustego zestawu filtrów", () => {
    // Filtry nad pustą siatką wyglądają jak awaria wyszukiwania. Ekspert bez
    // publikacji dostaje jedno zdanie i nagłówek sekcji.
    explorer(hubWith([]));
    expect(screen.getByText(String(t("expert.noMaterials")))).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("nagłówek sekcji zostaje - to kotwica nawigacji po stronie", () => {
    explorer(hubWith([]));
    expect(
      screen.getByRole("heading", { name: new RegExp(String(t("expert.publicationsHeading"))) }),
    ).toBeInTheDocument();
  });
});

describe("ExpertMaterialsExplorer - fasety pojawiają się tylko, gdy mają sens", () => {
  it("format pokazuje WYŁĄCZNIE typy, które ekspert naprawdę ma", () => {
    const { container } = explorer(
      hubWith([article, expertMaterial({ id: "p1", kind: "podcast" })]),
    );
    const format = screen.getByLabelText(String(t("expert.filterFormat")));
    const values = [...format.querySelectorAll("option")].map((o) => o.getAttribute("value"));
    expect(values).toContain("article");
    expect(values).toContain("podcast");
    expect(values).not.toContain("video");
    expect(container).toBeTruthy();
  });

  it("etykieta formatu niesie liczność - filtr bez liczby to filtr w ciemno", () => {
    explorer(hubWith([article, expertMaterial({ id: "a2", kind: "article" })]));
    const format = screen.getByLabelText(String(t("expert.filterFormat")));
    expect(format.textContent).toContain("(2)");
  });

  it("temat i region są WIDOCZNE nawet puste - to stały szkielet paska", () => {
    explorer(hubWith([article]));
    expect(screen.getByLabelText(String(t("expert.filterTopic")))).toBeInTheDocument();
    expect(screen.getByLabelText(String(t("expert.filterRegion")))).toBeInTheDocument();
  });

  it("program pojawia się dopiero, gdy ekspert jakiś ma", () => {
    explorer(hubWith([article]));
    expect(screen.queryByLabelText(String(t("expert.filterProgram")))).not.toBeInTheDocument();

    explorer(
      hubWith([article], {
        programs: [{ id: "p1", slug: "klimat", name_pl: "Klimat", name_en: "Climate" }] as never,
      }),
    );
    expect(screen.getByLabelText(String(t("expert.filterProgram")))).toBeInTheDocument();
  });

  it("rok pojawia się dopiero przy DWÓCH różnych latach", () => {
    // Filtr „rok" z jedną opcją niczego nie zawęża - to tylko szum.
    explorer(hubWith([article, expertMaterial({ id: "a2", date: "2026-01-01" })]));
    expect(screen.queryByLabelText(String(t("expert.filterYear")))).not.toBeInTheDocument();

    explorer(hubWith([article, expertMaterial({ id: "a3", date: "2024-01-01" })]));
    expect(screen.getByLabelText(String(t("expert.filterYear")))).toBeInTheDocument();
  });

  it("etykiety regionu i programu idą w języku strony", () => {
    explorer(
      hubWith([article], {
        regions: [{ id: "r1", slug: "eu", name_pl: "Europa", name_en: "Europe" }] as never,
      }),
      "en",
    );
    const region = screen.getByLabelText(String(realT("en")("expert.filterRegion")));
    expect(region.textContent).toContain("Europe");
    expect(region.textContent).not.toContain("Europa");
  });
});

describe("ExpertMaterialsExplorer - zmiana filtra przepisuje URL", () => {
  it("wybór formatu ustawia klucz i KASUJE numer strony", () => {
    // Bez zerowania strony czytelnik z 7. strony pełnego dorobku ląduje na
    // 7. stronie zbioru, który ma jedną.
    state.search = { page: 7 };
    explorer(hubWith([article]));
    fireEvent.change(screen.getByLabelText(String(t("expert.filterFormat"))), {
      target: { value: "article" },
    });
    expect(lastSearch()).toEqual({ page: undefined, kind: "article" });
  });

  it("wybór „wszystkie” kasuje klucz zamiast wpisywać wartość pustą", () => {
    // `?kind=` w adresie to nie to samo co brak klucza - powstaje drugi URL
    // dla tej samej treści.
    state.search = { kind: "article" };
    explorer(hubWith([article]));
    fireEvent.change(screen.getByLabelText(String(t("expert.filterFormat"))), {
      target: { value: "__all__" },
    });
    expect(lastSearch().kind).toBeUndefined();
  });

  it("rok wraca do URL-a jako LICZBA, nie napis", () => {
    explorer(hubWith([article, expertMaterial({ id: "a3", date: "2024-01-01" })]));
    fireEvent.change(screen.getByLabelText(String(t("expert.filterYear"))), {
      target: { value: "2024" },
    });
    expect(lastSearch().year).toBe(2024);
  });

  it("nawigacja NIE przewija strony na górę", () => {
    explorer(hubWith([article], { tags: [{ id: "t1", slug: "energia", name: "Energia" }] }));
    fireEvent.change(screen.getByLabelText(String(t("expert.filterTopic"))), {
      target: { value: "energia" },
    });
    expect(state.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: ".", resetScroll: false }),
    );
  });

  it("zmiana filtra NIE nadpisuje wpisu w historii", () => {
    // Wstecz po zawężeniu filtra ma wrócić do poprzedniego zestawu wyników.
    explorer(hubWith([article], { tags: [{ id: "t1", slug: "energia", name: "Energia" }] }));
    fireEvent.change(screen.getByLabelText(String(t("expert.filterTopic"))), {
      target: { value: "energia" },
    });
    expect(state.navigate).toHaveBeenCalledWith(expect.objectContaining({ replace: false }));
  });
});

describe("ExpertMaterialsExplorer - czyszczenie filtrów", () => {
  it("przycisk pojawia się dopiero przy aktywnym filtrze", () => {
    explorer(hubWith([article]));
    expect(
      screen.queryByRole("button", { name: String(t("expert.clearFilters")) }),
    ).not.toBeInTheDocument();

    state.search = { kind: "article" };
    explorer(hubWith([article]));
    expect(
      screen.getByRole("button", { name: String(t("expert.clearFilters")) }),
    ).toBeInTheDocument();
  });

  it("sam numer strony NIE jest filtrem", () => {
    state.search = { page: 3 };
    explorer(hubWith([article]));
    expect(
      screen.queryByRole("button", { name: String(t("expert.clearFilters")) }),
    ).not.toBeInTheDocument();
  });

  it("czyszczenie zeruje WSZYSTKIE wymiary naraz i wraca na stronę 1", () => {
    state.search = { kind: "article", topic: "energia", region: "eu", year: 2024, page: 4 };
    explorer(hubWith([article]));
    fireEvent.click(screen.getByRole("button", { name: String(t("expert.clearFilters")) }));
    expect(lastSearch()).toEqual({
      kind: undefined,
      topic: undefined,
      region: undefined,
      program: undefined,
      year: undefined,
      page: undefined,
    });
  });
});

describe("ExpertMaterialsExplorer - wyniki i paginacja", () => {
  it("licznik pokazuje wynik filtra na tle całego dorobku", async () => {
    state.page = () => Promise.resolve({ materials: [article], total: 1, page: 1, pageSize: 9 });
    explorer(hubWith([article, expertMaterial({ id: "a2" })]));
    expect(
      await screen.findByText(String(t("expert.resultsCount", { count: 1, total: 2 }))),
    ).toBeInTheDocument();
  });

  it("wskaźnik strony pojawia się dopiero przy więcej niż jednej stronie", async () => {
    state.page = () => Promise.resolve({ materials: [article], total: 1, page: 1, pageSize: 9 });
    const { container } = explorer(hubWith([article]));
    await screen.findByRole("link");
    expect(container.textContent).not.toContain(
      String(t("expert.pageIndicator", { page: 1, pages: 1 })),
    );
  });

  it("przy wielu stronach widać numer strony i pasek paginacji", async () => {
    state.page = () => Promise.resolve({ materials: [article], total: 25, page: 1, pageSize: 9 });
    explorer(hubWith([article]));
    expect(
      await screen.findByText(new RegExp(String(t("expert.pageIndicator", { page: 1, pages: 3 })))),
    ).toBeInTheDocument();
  });

  it("numer strony jest PRZYCINANY do realnego zakresu", async () => {
    // Zakładka do strony 9 po skasowaniu materiałów: zamiast „strona 9 z 3"
    // pokazujemy ostatnią realną i przepisujemy URL.
    state.search = { page: 9 };
    state.page = () => Promise.resolve({ materials: [], total: 25, page: 9, pageSize: 9 });
    explorer(hubWith([article]));
    await waitFor(() => expect(state.navigate).toHaveBeenCalled());
    expect(lastSearch().page).toBe(3);
    expect(state.navigate).toHaveBeenCalledWith(expect.objectContaining({ replace: true }));
  });

  it("przepisanie na stronę 1 kasuje klucz zamiast wpisywać `page=1`", async () => {
    state.search = { page: 4 };
    state.page = () => Promise.resolve({ materials: [], total: 3, page: 4, pageSize: 9 });
    explorer(hubWith([article]));
    await waitFor(() => expect(state.navigate).toHaveBeenCalled());
    expect(lastSearch().page).toBeUndefined();
  });

  it("pusty wynik NIE jest przycinany - to poprawny stan filtra", async () => {
    // total = 0 oznacza „filtr niczego nie znalazł", a nie „URL poza
    // zakresem". Przekierowanie zjadłoby wtedy komunikat o pustym wyniku.
    state.search = { page: 5, kind: "video" };
    state.page = () => Promise.resolve({ materials: [], total: 0, page: 5, pageSize: 9 });
    explorer(hubWith([article]));
    expect(await screen.findByText(String(t("expert.emptyMaterials")))).toBeInTheDocument();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("klik w paginację przechodzi na wybraną stronę", async () => {
    state.page = () => Promise.resolve({ materials: [article], total: 25, page: 1, pageSize: 9 });
    explorer(hubWith([article]));
    const two = await screen.findByRole("button", {
      name: `${String(t("archive.pageLabel"))} 2`,
    });
    fireEvent.click(two);
    expect(lastSearch().page).toBe(2);
  });
});

describe("ExpertMaterialsExplorer - stany zapytania", () => {
  it("pierwsze ładowanie pokazuje trzy szkielety kart", () => {
    state.page = () => new Promise(() => {});
    const { container } = explorer(hubWith([article]));
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(3);
  });

  it("błąd zapytania daje komunikat i przycisk ponowienia, nie pustą siatkę", async () => {
    state.page = () => Promise.reject(new Error("RPC padło"));
    explorer(hubWith([article]));
    expect(await screen.findByText(String(t("expert.materialsError")))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: String(t("expert.retry")) })).toBeInTheDocument();
  });

  it("ponowienie naprawdę odpytuje ponownie", async () => {
    const attempts = vi.fn(() => Promise.reject(new Error("RPC padło")));
    state.page = attempts;
    explorer(hubWith([article]));
    fireEvent.click(await screen.findByRole("button", { name: String(t("expert.retry")) }));
    await waitFor(() => expect(attempts.mock.calls.length).toBeGreaterThan(1));
  });

  it("karta materiału prowadzi pod jego adres", async () => {
    explorer(hubWith([article]));
    expect(await screen.findByRole("link")).toHaveAttribute("href", article.href);
  });

  it("siatka melduje zajętość na czas odświeżania", async () => {
    explorer(hubWith([article]));
    await screen.findByRole("link");
    expect(document.querySelector('[aria-busy="false"]')).toBeInTheDocument();
  });
});

describe("ExpertMaterialsExplorer - każdy wymiar trafia pod WŁASNY klucz", () => {
  it.each([
    ["filterTopic", "topic", { tags: [{ id: "t1", slug: "energia", name: "Energia" }] }],
    [
      "filterRegion",
      "region",
      { regions: [{ id: "r1", slug: "eu", name_pl: "Europa", name_en: "Europe" }] },
    ],
    [
      "filterProgram",
      "program",
      { programs: [{ id: "p1", slug: "klimat", name_pl: "Klimat", name_en: "Climate" }] },
    ],
  ])("wymiar %s zapisuje się jako %s", (label, key, facets) => {
    // Przestawienie dwóch wymiarów miejscami jest niewidoczne w typach (oba
    // to `string`), a rozjeżdża deep-linki: adres z regionem filtruje temat.
    explorer(hubWith([article], facets as never));
    const slug = key === "region" ? "eu" : key === "program" ? "klimat" : "energia";
    fireEvent.change(screen.getByLabelText(String(t(`expert.${label}`))), {
      target: { value: slug },
    });
    expect(lastSearch()).toEqual({ [key]: slug, page: undefined });
  });
});

describe("ExpertMaterialsExplorer - przewijanie do sekcji", () => {
  const scrollIntoView = vi.fn();
  const original = Element.prototype.scrollIntoView;

  beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = original;
    vi.unstubAllGlobals();
  });

  /** Ponowny render z tym samym klientem - `state.search` jest źródłem prawdy. */
  function rerenderWith(
    view: ReturnType<typeof renderWithQueryClient>,
    hub: ExpertHubData,
    search: Record<string, unknown>,
  ) {
    state.search = search;
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <ExpertMaterialsExplorer data={hub} lang="pl" />
      </QueryClientProvider>,
    );
  }

  it("pierwsze wejście NIE przewija - czytelnik ma zobaczyć hero profilu", () => {
    explorer(hubWith([article]));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("zmiana strony przewija do początku sekcji materiałów", () => {
    // Paginacja wisi POD siatką: bez przewinięcia czytelnik po kliknięciu
    // „2" patrzy na stopkę nowej strony, nie na jej pierwsze wyniki.
    const hub = hubWith([article]);
    const view = explorer(hub);
    rerenderWith(view, hub, { page: 2 });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("zmiana samego filtra NIE przewija - pasek filtrów jest już w widoku", () => {
    const hub = hubWith([article]);
    const view = explorer(hub);
    rerenderWith(view, hub, { kind: "article" });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("użytkownik z wyłączoną animacją dostaje skok, nie płynne przewijanie", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const hub = hubWith([article]);
    const view = explorer(hub);
    rerenderWith(view, hub, { page: 2 });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });
});
