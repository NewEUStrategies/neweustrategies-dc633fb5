// Podgląd listy wpisów w panelu `post-list` / `carousel`.
//
// Ten fragment edytora robi coś, czego nie robi żaden inny: SAM odpytuje bazę
// tymi samymi filtrami, którymi renderer pobiera treść, i pokazuje redakcji
// wynik jeszcze przed zapisaniem strony. Dwie rzeczy muszą się więc zgadzać:
//   * FILTRY (status, usunięcie, format, autor, zakres dat) - podgląd
//     pokazujący inny zestaw niż strona jest gorszy niż brak podglądu,
//   * NADPISANIA MINIATUR - to jedyne miejsce, w którym da się podmienić
//     okładkę pojedynczego wpisu na potrzeby JEDNEJ listy.
//
// Wariant „ranking” dokłada numer pozycji (rozmiar, strona, wyrównanie) oraz
// nazwę autora dociąganą osobnym zapytaniem.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, okCount, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetNode } from "@/lib/builder/types";
import {
  CAROUSEL_AUTOPLAY_DEFAULT_MS,
  CAROUSEL_AUTOPLAY_MAX_MS,
  CAROUSEL_AUTOPLAY_MIN_MS,
} from "@/lib/builder/postListCarousel";
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
// Nadpisanie miniatury korzysta ze slotu obrazka, a ten wymaga kontekstu
// najemcy (zapis mediów jest per tenant) - bez kontekstu RZUCA.
vi.mock("@/hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRequiredTenant: () => "tenant-test",
    useCurrentTenantId: () => "tenant-test",
  };
});
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return { ...actual, ...serverFnStubModule(), useServerFn: () => async () => ({}) };
});
vi.mock("@/lib/media.functions", () => ({
  createMediaFolder: async () => ({}),
  registerMediaUpload: async () => ({}),
  updateMediaMeta: async () => ({}),
}));

const POSTS = [
  {
    id: "p1",
    slug: "pierwszy",
    title_pl: "Pierwszy wpis",
    title_en: "First post",
    cover_image_url: "https://cdn.test/p1.png",
    author_id: "u1",
  },
  {
    id: "p2",
    slug: "drugi",
    title_pl: null,
    title_en: null,
    cover_image_url: null,
    author_id: null,
  },
];

function renderEditor(
  c: WidgetNode["content"],
  lang: "pl" | "en" = "pl",
  widgetType: "post-list" | "carousel" = "post-list",
) {
  const written: Array<[string, Json]> = [];
  const view = renderWithQueryClient(
    <PostListEditor
      c={c}
      lang={lang}
      widgetType={widgetType}
      setContent={(k, v) => written.push([k, v])}
    />,
  );
  return { ...view, written, last: () => written.at(-1) };
}

/**
 * Podgląd siedzi w sekcji ZWINIĘTEJ domyślnie (`defaultOpen={false}`), a
 * zwinięta sekcja NIE MONTUJE treści - i to jest zamierzone: panel z pięcioma
 * sekcjami nie może odpytywać bazy o wszystko na wejściu. Test musi ją więc
 * najpierw otworzyć, dokładnie jak redaktor.
 */
function openPreview(ranked = false): void {
  const key = ranked
    ? "builder.postListEditor.rankPreview"
    : "builder.postListEditor.thumbOverrides";
  fireEvent.click(screen.getByRole("button", { name: new RegExp(key) }));
}

beforeEach(() => {
  db.current = supabaseFromStub();
  // Zapytanie LICZĄCE (`select("id", { head: true })`) zwraca sam licznik,
  // zapytanie podglądu - wiersze. Atrapa rozróżnia je po kształcie łańcucha.
  db.current.setResponse("posts", (chain) =>
    chain.argsOf("select")?.[1] ? okCount(2) : ok(POSTS),
  );
  db.current.setResponse("profiles", ok([{ id: "u1", display_name: "Jan Kowalski", slug: "jan" }]));
  db.current.setResponse("categories", ok([{ id: "c1" }]));
  db.current.setResponse("tags", ok([{ id: "t1" }]));
  db.current.setResponse("post_categories", ok([{ post_id: "p1" }]));
  db.current.setResponse("post_tags", ok([{ post_id: "p1" }]));
});

describe("PostListEditor - podgląd wariantu kartowego", () => {
  it("pokazuje wpisy z bazy razem z ich okładkami", async () => {
    const { container } = renderEditor({ variant: "card" });
    openPreview();
    expect(await screen.findByText("Pierwszy wpis")).toBeInTheDocument();
    // Wpis bez tytułu w żadnym języku spada na slug - nigdy na „undefined”.
    expect(screen.getAllByText("drugi").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("undefined");
    expect(container.querySelector('img[src="https://cdn.test/p1.png"]')).not.toBeNull();
  });

  it("tytuł idzie za językiem panelu z zapasem na drugi język", async () => {
    renderEditor({ variant: "card" }, "en");
    openPreview();
    expect(await screen.findByText("First post")).toBeInTheDocument();
  });

  it("pyta bazę o wpisy opublikowane i nieusunięte", async () => {
    renderEditor({ variant: "card" });
    openPreview();
    await waitFor(() => expect(db.current.chainsFor("posts").length).toBeGreaterThan(0));
    const preview = db.current.chainsFor("posts").find((ch) => ch.has("range"));
    expect(preview?.argsOf("eq")).toEqual(["status", "published"]);
    expect(preview?.argsOf("is")).toEqual(["deleted_at", null]);
  });

  it("filtry treści jadą do zapytania podglądu", async () => {
    renderEditor({
      variant: "card",
      postFormat: "standard",
      authorId: "u1",
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      limit: 3,
    });
    openPreview();
    await waitFor(() =>
      expect(db.current.chainsFor("posts").some((c) => c.has("range"))).toBe(true),
    );
    const preview = db.current.chainsFor("posts").find((ch) => ch.has("range"));
    const eqCalls = (preview?.calls ?? []).filter((c) => c.method === "eq").map((c) => c.args);
    // Podgląd MUSI filtrować dokładnie tak, jak renderer - inaczej redakcja
    // akceptuje listę, której czytelnik nie zobaczy.
    expect(eqCalls).toEqual(
      expect.arrayContaining([
        ["status", "published"],
        ["post_format", "standard"],
        ["author_id", "u1"],
      ]),
    );
    expect(preview?.has("gte")).toBe(true);
    expect(preview?.has("lte")).toBe(true);
  });

  it("nadpisanie miniatury zapisuje się pod identyfikatorem wpisu", async () => {
    const { last } = renderEditor({ variant: "card" });
    openPreview();
    await screen.findByText("Pierwszy wpis");
    const fields = Array.from(document.querySelectorAll<HTMLInputElement>("input")).filter(
      (i) => i.type !== "number" && i.type !== "checkbox" && i.type !== "file",
    );
    const override = fields.at(-1);
    if (!override) throw new Error("test: brak pola nadpisania miniatury");
    fireEvent.change(override, { target: { value: "https://cdn.test/inna.png" } });
    const [key, value] = last() ?? [];
    expect(key).toBe("thumbnailOverrides");
    expect(JSON.stringify(value)).toContain("https://cdn.test/inna.png");
  });

  it("istniejące nadpisanie wygrywa z okładką wpisu", async () => {
    const { container } = renderEditor({
      variant: "card",
      thumbnailOverrides: { p1: "https://cdn.test/nadpisana.png" },
    });
    openPreview();
    await screen.findByText("Pierwszy wpis");
    expect(container.querySelector('img[src="https://cdn.test/nadpisana.png"]')).not.toBeNull();
    expect(container.querySelector('img[src="https://cdn.test/p1.png"]')).toBeNull();
  });

  it("pusta lista wyników nie wywala podglądu", async () => {
    db.current.setResponse("posts", ok([]));
    const { container } = renderEditor({ variant: "card" });
    openPreview();
    await waitFor(() => expect(db.current.chainsFor("posts").length).toBeGreaterThan(0));
    expect(container.textContent).not.toContain("undefined");
  });
});

describe("PostListEditor - podgląd wariantu ranking", () => {
  it("pokazuje numery pozycji i nazwę autora z osobnego zapytania", async () => {
    renderEditor({ variant: "ranked" });
    openPreview(true);
    expect(await screen.findByText("Pierwszy wpis")).toBeInTheDocument();
    await waitFor(() => expect(db.current.chainsFor("profiles").length).toBeGreaterThan(0));
    expect((await screen.findAllByText(/Jan Kowalski/)).length).toBeGreaterThan(0);
  });

  it.each([
    ["lewa strona, środek", { indexSide: "left", indexVAlign: "middle" }],
    ["prawa strona, dół", { indexSide: "right", indexVAlign: "bottom" }],
    ["domyślna strona i góra", {}],
    ["nierozpoznane wyrównanie spada na górę", { indexVAlign: "nie-ma" }],
  ])("numer pozycji: %s", async (_label, overlay) => {
    const { container } = renderEditor({ variant: "ranked", ...overlay });
    openPreview(true);
    await screen.findByText("Pierwszy wpis");
    expect(container.textContent).toContain("1");
    expect(container.textContent).not.toContain("NaN");
  });

  it.each([
    ["liczba", 120],
    ["napis liczbowy", "150"],
    ["śmieć", "duży"],
    ["zero", 0],
  ])("rozmiar numeru z wartości: %s", async (_label, indexSizePx) => {
    const { container } = renderEditor({ variant: "ranked", indexSizePx });
    openPreview(true);
    await screen.findByText("Pierwszy wpis");
    // Rozmiar spoza zakresu spada na domyślny, a podgląd przycina go do
    // szerokości panelu - w żadnym wypadku nie wypisuje NaN.
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).not.toContain("undefined");
  });

  it("wpis bez autora nie pokazuje pustej etykiety autora", async () => {
    db.current.setResponse("posts", (chain) =>
      chain.argsOf("select")?.[1] ? okCount(1) : ok([POSTS[1]]),
    );
    const { container } = renderEditor({ variant: "ranked" });
    openPreview(true);
    await screen.findAllByText("drugi");
    expect(container.textContent).not.toContain("undefined");
  });

  it("profil bez nazwy nie trafia do mapy autorów", async () => {
    db.current.setResponse("profiles", ok([{ id: "u1", display_name: null, slug: "jan" }]));
    const { container } = renderEditor({ variant: "ranked" });
    openPreview(true);
    await screen.findByText("Pierwszy wpis");
    await waitFor(() => expect(db.current.chainsFor("profiles").length).toBeGreaterThan(0));
    expect(container.textContent).not.toContain("null");
  });
});

describe("PostListEditor - filtry taksonomii", () => {
  it("filtr kategorii zawęża podgląd przez tabelę wiązań", async () => {
    renderEditor({ variant: "card", categoriesCsv: "gospodarka" });
    openPreview();
    await waitFor(() => expect(db.current.chainsFor("categories").length).toBeGreaterThan(0));
    expect(db.current.lastChain("categories")?.argsOf("in")).toEqual(["slug", ["gospodarka"]]);
    expect(db.current.chainsFor("post_categories").length).toBeGreaterThan(0);
  });

  it("filtr tagów zawęża podgląd przez własną tabelę wiązań", async () => {
    renderEditor({ variant: "card", tagsCsv: "brexit" });
    openPreview();
    await waitFor(() => expect(db.current.chainsFor("tags").length).toBeGreaterThan(0));
    expect(db.current.chainsFor("post_tags").length).toBeGreaterThan(0);
  });

  it("filtr bez trafień daje pusty podgląd, nie wszystkie wpisy", async () => {
    db.current.setResponse("post_categories", ok([]));
    renderEditor({ variant: "card", categoriesCsv: "pusta" });
    openPreview();
    await waitFor(() => expect(db.current.chainsFor("post_categories").length).toBeGreaterThan(0));
    // Zbiór dozwolonych wpisów jest PUSTY, więc podgląd nie ma czego pokazać -
    // pokazanie wszystkiego byłoby kłamstwem o zawartości listy.
    await waitFor(() => expect(screen.queryByText("Pierwszy wpis")).toBeNull());
  });
});

describe("PostListEditor - karuzela", () => {
  it("sekcja karuzeli pojawia się tylko dla widgetu karuzeli", () => {
    const list = renderEditor({ variant: "card" }, "pl", "post-list");
    const listSwitches = screen.queryAllByRole("switch").length;
    list.unmount();

    renderEditor({ variant: "card" }, "pl", "carousel");
    // Karuzela ma własne przełączniki (autoodtwarzanie, pauza na hover,
    // strzałki, kropki), więc kontrolek jest WIĘCEJ niż w zwykłej liście.
    expect(screen.queryAllByRole("switch").length).toBeGreaterThan(listSwitches);
  });
});

// ── Baza oddaje PUSTKĘ tam, gdzie panel liczy na tablicę ────────────────────
//
// PostgREST na pustym wyniku oddaje `data: null`, nie `[]`. W warstwie
// podglądu są TRZY takie miejsca, a każde odczytuje wynik od razu przez
// `.map(...)`: wiązania kategorii, wiązania tagów i nazwy autorów wariantu
// rankingowego. Bez straży `?? []` panel przewraca się na świeżej instalacji
// (kategoria bez ani jednego wpisu, wpis bez profilu autora) - czyli u nowego
// klienta, zanim ktokolwiek zdąży cokolwiek opublikować.
describe("PostListEditor - podgląd znosi puste odpowiedzi bazy", () => {
  it("wiązania kategorii oddane jako pustka nie wywalają podglądu", async () => {
    db.current.setResponse("post_categories", ok(null));
    const { container } = renderEditor({ variant: "card", categoriesCsv: "gospodarka" });
    openPreview();
    await waitFor(() => expect(db.current.chainsFor("post_categories").length).toBeGreaterThan(0));
    // Brak wiązań to zbiór PUSTY, a nie „pokaż wszystko".
    await waitFor(() => expect(screen.queryByText("Pierwszy wpis")).toBeNull());
    expect(container.textContent).not.toContain("undefined");
  });

  it("wiązania tagów oddane jako pustka nie wywalają podglądu", async () => {
    db.current.setResponse("post_tags", ok(null));
    const { container } = renderEditor({ variant: "card", tagsCsv: "brexit" });
    openPreview();
    await waitFor(() => expect(db.current.chainsFor("post_tags").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByText("Pierwszy wpis")).toBeNull());
    expect(container.textContent).not.toContain("undefined");
  });

  it("profile autorów oddane jako pustka zostawiają ranking bez nazwisk", async () => {
    db.current.setResponse("profiles", ok(null));
    const { container } = renderEditor({ variant: "ranked" });
    openPreview(true);
    expect(await screen.findByText("Pierwszy wpis")).toBeInTheDocument();
    await waitFor(() => expect(db.current.chainsFor("profiles").length).toBeGreaterThan(0));
    // Wiersz bez nazwiska ma zostać wierszem bez nazwiska - nie „undefined"
    // ani „[object Object]" w miejscu autora.
    expect(container.textContent).not.toContain("undefined");
    expect(container.textContent).not.toContain("[object Object]");
  });
});

describe("PostListEditor - odstęp autoodtwarzania karuzeli", () => {
  it("pole odstępu pojawia się dopiero po włączeniu autoodtwarzania", () => {
    const off = renderEditor({ variant: "card", autoplay: false }, "pl", "carousel");
    expect(off.container.querySelectorAll('input[step="500"]')).toHaveLength(0);
    off.unmount();

    const on = renderEditor({ variant: "card", autoplay: true }, "pl", "carousel");
    expect(on.container.querySelectorAll('input[step="500"]')).toHaveLength(1);
  });

  it("odstęp jest przycinany do zakresu, a pustka wraca do wartości domyślnej", () => {
    const { container, written } = renderEditor(
      { variant: "card", autoplay: true, autoplayIntervalMs: 4000 },
      "pl",
      "carousel",
    );
    const field = container.querySelector<HTMLInputElement>('input[step="500"]');
    if (!field) throw new Error("test: brak pola odstępu autoodtwarzania");
    expect(field.value).toBe("4000");

    fireEvent.change(field, { target: { value: "9000" } });
    expect(written.at(-1)).toEqual(["autoplayIntervalMs", 9000]);
    // Poniżej minimum karuzela przeskakiwałaby szybciej, niż da się przeczytać.
    fireEvent.change(field, { target: { value: "200" } });
    expect(written.at(-1)).toEqual(["autoplayIntervalMs", CAROUSEL_AUTOPLAY_MIN_MS]);
    fireEvent.change(field, { target: { value: "999999" } });
    expect(written.at(-1)).toEqual(["autoplayIntervalMs", CAROUSEL_AUTOPLAY_MAX_MS]);
    // Puste pole to brak wartości, nie zero - zero zatrzymałoby karuzelę
    // w pętli bez przerwy.
    fireEvent.change(field, { target: { value: "0" } });
    expect(written.at(-1)).toEqual(["autoplayIntervalMs", CAROUSEL_AUTOPLAY_DEFAULT_MS]);
  });
});
