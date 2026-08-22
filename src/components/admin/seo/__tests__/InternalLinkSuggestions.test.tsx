// Widget „Sugerowane linki wewnętrzne" w edytorze wpisu (panel SEO).
//
// CO TEN PLIK DOWODZI:
//   * flaga `enabled` FAKTYCZNIE wstrzymuje odczyt - przy braku kategorii,
//     tagów i tytułów dłuższych niż 3 znaki server function nie jest wołana
//     ANI RAZU (asercja na liczbie wywołań atrapy, nie na samym napisie);
//     każdy z czterech warunków włączających sprawdzony osobno, razem z
//     granicą 4 znaków, bo to ona decyduje, kiedy panel zaczyna pytać serwer,
//   * ładunek żądania jest dokładnie ten, którego oczekuje walidator server
//     function (w tym `limit: 8`),
//   * trzy różne stany pustki nie mylą się ze sobą: BRAK WARUNKÓW (`hint`),
//     ODCZYT W TOKU (`loading`) i ZERO DOPASOWAŃ (`empty`) - redakcja musi
//     wiedzieć, czy nie ma sugestii, czy jeszcze ich nie policzono,
//   * tytuł kandydata wybierany jest po języku panelu, ze spadkiem na
//     `title_pl` i dalej na `slug` - wpis bez tłumaczenia nie może zniknąć z
//     listy jako pusty wiersz bez etykiety,
//   * plakietka powodu tłumaczy `category`/`tag`, a KAŻDY inny powód wpada w
//     `reasonContent` (nie tylko literał „content" z dzisiejszego serwera),
//   * link „otwórz" prowadzi na `/<slug>` w nowej karcie z `rel="noreferrer"`,
//   * kopiowanie linku: ścieżka bogata (`ClipboardItem` + `clipboard.write` z
//     wariantem text/html i text/plain), ścieżka zapasowa (`writeText` z
//     HTML-em) oraz ODMOWA UPRAWNIENIA - awaria schowka MUSI dać komunikat
//     błędu, nie ciszę, bo inaczej redaktor wkleja stary link,
//   * kandydat wskazujący na sam edytowany wpis albo na wpis nieopublikowany
//     jest odrzucany W SERVER FUNCTION - ten plik przypina fakt, że widget
//     własnego filtra nie ma (patrz `linkSuggestions.functions.ts`:
//     `if (r.post_id === postId) continue;` w gałęziach kategorii i tagów,
//     `if (r.id === postId) continue;` w gałęzi FTS oraz
//     `.eq("status", "published")` w końcowym `select`),
//   * dostępność listy sugestii (axe) - przyciski i linki mają nazwy, choć
//     zawierają wyłącznie ikony.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   * `e2e/seo.spec.ts` → test „/admin/seo is auth-gated (redirects to /auth
//     or /login)" - to JEDYNY test panelu SEO w e2e i pilnuje wyłącznie
//     guardu autoryzacji trasy. Tutaj nie ma routingu ani auth: widget jest
//     montowany bezpośrednio, a server function jest atrapą.
//   * `e2e/seo.spec.ts` → testy publicznych powierzchni crawlera („sitemap.xml
//     is a sitemapindex...", „robots.txt comes from the ROUTE...", „head
//     contract on /...") - ten plik nie sprawdza, czy `/<slug>` istnieje ani
//     co zwraca; sprawdza tylko, JAKI adres widget układa z pola `slug`.
//   * samej server function (dobór kandydatów, tokenizacja, punktacja, filtry
//     tenanta/statusu) - to osobny plik testowy warstwy `lib/seo`.
//   * RLS i RPC - mają własne pliki pgTAP.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import type { LinkSuggestion } from "@/lib/seo/linkSuggestions.functions";

/** Ładunek, który widget składa dla server function (lustro walidatora `Input`). */
interface SuggestPayload {
  data: {
    postId: string | null;
    titlePl: string | null;
    titleEn: string | null;
    contentPl: string | null;
    contentEn: string | null;
    categoryIds: string[];
    tagIds: string[];
    limit: number;
  };
}

const h = vi.hoisted(() => ({
  lang: "pl",
  suggest: vi.fn<(args: SuggestPayload) => Promise<LinkSuggestion[]>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}));

// Atrapa i18n MUSI iść przez `@/test/i18nStub` - moduł bez zależności
// produkcyjnych, więc fabryka nie domyka cyklu na `react-i18next`.
vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

// `useServerFn` w produkcji tylko owija funkcję serwerową - oddajemy ją wprost,
// żeby asercje dotyczyły atrapy samej funkcji.
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/seo/linkSuggestions.functions", () => ({
  suggestInternalLinks: h.suggest,
}));

vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
  Toaster: () => null,
}));

import { InternalLinkSuggestions } from "@/components/admin/seo/InternalLinkSuggestions";

type WidgetProps = ComponentProps<typeof InternalLinkSuggestions>;

const POST_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";
const TAG_ID = "33333333-3333-4333-8333-333333333333";

/** Wpis bez żadnego warunku włączającego - punkt wyjścia każdego przypadku. */
const PUSTY_EDYTOR: WidgetProps = {
  postId: null,
  titlePl: null,
  titleEn: null,
  contentPl: null,
  contentEn: null,
  categoryIds: [],
  tagIds: [],
};

function sugestia(patch: Partial<LinkSuggestion> = {}): LinkSuggestion {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    slug: "reforma-wspolnej-polityki-rolnej",
    title_pl: "Reforma WPR",
    title_en: "CAP reform",
    excerpt_pl: "Lead analizy.",
    score: 7,
    reasons: ["category"],
    ...patch,
  };
}

/** Obietnica, która nigdy się nie rozstrzyga - stan „odczyt w toku" BEZ timerów. */
function nigdyNieKonczy(): Promise<LinkSuggestion[]> {
  return new Promise<LinkSuggestion[]>(() => {});
}

const przywroc: Array<() => void> = [];

/** Podmienia własność na czas jednego testu i rejestruje przywrócenie stanu. */
function podmien(target: object, name: string, value: unknown): void {
  const oryginal = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
  przywroc.push(() => {
    if (oryginal) Object.defineProperty(target, name, oryginal);
    else Reflect.deleteProperty(target, name);
  });
}

/**
 * Minimalna atrapa `ClipboardItem` - trzyma warianty MIME, żeby test mógł
 * odczytać, CO dokładnie trafiłoby do schowka (przeglądarka wkleja text/html).
 */
class ClipboardItemStub {
  readonly data: Record<string, Blob>;
  constructor(data: Record<string, Blob>) {
    this.data = data;
  }
  get types(): string[] {
    return Object.keys(this.data);
  }
  async getType(type: string): Promise<Blob> {
    const blob = this.data[type];
    if (!blob) throw new Error(`brak wariantu ${type}`);
    return blob;
  }
}

interface SchowekAtrapa {
  write: ReturnType<typeof budujWrite>;
  writeText: ReturnType<typeof budujWriteText>;
}

function budujWrite() {
  return vi.fn(async (items: ClipboardItemStub[]): Promise<void> => {
    void items;
  });
}

function budujWriteText() {
  return vi.fn(async (text: string): Promise<void> => {
    void text;
  });
}

/** Instaluje schowek z pełnym API (`ClipboardItem` obecny). */
function schowekBogaty(): SchowekAtrapa {
  const write = budujWrite();
  const writeText = budujWriteText();
  podmien(globalThis, "ClipboardItem", ClipboardItemStub);
  podmien(navigator, "clipboard", { write, writeText });
  return { write, writeText };
}

/** Instaluje schowek bez `ClipboardItem` - starsza przeglądarka / WebView. */
function schowekBezClipboardItem(): SchowekAtrapa {
  const write = budujWrite();
  const writeText = budujWriteText();
  podmien(globalThis, "ClipboardItem", undefined);
  podmien(navigator, "clipboard", { write, writeText });
  return { write, writeText };
}

const copyButton = () => screen.getByRole("button", { name: "admin.seo.linkSuggestions.copy" });

beforeEach(() => {
  h.lang = "pl";
  h.suggest.mockReset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.suggest.mockResolvedValue([]);
});

afterEach(() => {
  while (przywroc.length > 0) przywroc.pop()?.();
});

describe("InternalLinkSuggestions - flaga enabled decyduje o odczycie", () => {
  it("bez kategorii, tagów i tytułów pokazuje podpowiedź i NIE woła server function", async () => {
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} />);

    await waitFor(() =>
      expect(screen.getByText("admin.seo.linkSuggestions.hint")).toBeInTheDocument(),
    );
    // Sedno flagi `enabled`: pusty edytor nie generuje ruchu do serwera.
    expect(h.suggest).toHaveBeenCalledTimes(0);
    expect(screen.queryByText("admin.seo.linkSuggestions.loading")).not.toBeInTheDocument();
    expect(screen.queryByText("admin.seo.linkSuggestions.empty")).not.toBeInTheDocument();
  });

  it.each([
    { nazwa: "sama kategoria", patch: { categoryIds: [CATEGORY_ID] } },
    { nazwa: "sam tag", patch: { tagIds: [TAG_ID] } },
    { nazwa: "sam titlePl o 4 znakach", patch: { titlePl: "Rada" } },
    { nazwa: "sam titleEn o 4 znakach", patch: { titleEn: "Fund" } },
  ])("$nazwa wystarcza, żeby odpytać serwer", async ({ patch }) => {
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} {...patch} />);

    await waitFor(() => expect(h.suggest).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("admin.seo.linkSuggestions.hint")).not.toBeInTheDocument();
  });

  it.each([
    { nazwa: "titlePl o 3 znakach", patch: { titlePl: "Rad" }, wywolania: 0 },
    { nazwa: "titlePl o 4 znakach", patch: { titlePl: "Rada" }, wywolania: 1 },
    { nazwa: "titleEn o 3 znakach", patch: { titleEn: "Aid" }, wywolania: 0 },
    { nazwa: "titleEn o 4 znakach", patch: { titleEn: "Fund" }, wywolania: 1 },
  ])("granica długości tytułu: $nazwa", async ({ patch, wywolania }) => {
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} {...patch} />);

    if (wywolania === 0) {
      await waitFor(() =>
        expect(screen.getByText("admin.seo.linkSuggestions.hint")).toBeInTheDocument(),
      );
    } else {
      await waitFor(() =>
        expect(screen.getByText("admin.seo.linkSuggestions.empty")).toBeInTheDocument(),
      );
    }
    expect(h.suggest).toHaveBeenCalledTimes(wywolania);
  });

  it("pusty napis w tytule nie włącza odczytu (nie jest traktowany jak tekst)", async () => {
    renderWithQueryClient(
      <InternalLinkSuggestions {...PUSTY_EDYTOR} titlePl="" titleEn="" contentPl="" />,
    );

    await waitFor(() =>
      expect(screen.getByText("admin.seo.linkSuggestions.hint")).toBeInTheDocument(),
    );
    expect(h.suggest).toHaveBeenCalledTimes(0);
  });

  it("wysyła cały kontekst wpisu razem z limitem 8 kandydatów", async () => {
    renderWithQueryClient(
      <InternalLinkSuggestions
        postId={POST_ID}
        titlePl="Reforma budżetu UE"
        titleEn="EU budget reform"
        contentPl="<p>Treść analizy.</p>"
        contentEn="<p>Analysis body.</p>"
        categoryIds={[CATEGORY_ID]}
        tagIds={[TAG_ID]}
      />,
    );

    await waitFor(() =>
      expect(h.suggest).toHaveBeenCalledWith({
        data: {
          postId: POST_ID,
          titlePl: "Reforma budżetu UE",
          titleEn: "EU budget reform",
          contentPl: "<p>Treść analizy.</p>",
          contentEn: "<p>Analysis body.</p>",
          categoryIds: [CATEGORY_ID],
          tagIds: [TAG_ID],
          limit: 8,
        },
      }),
    );
  });
});

describe("InternalLinkSuggestions - stany odczytu", () => {
  it("odczyt w toku pokazuje `loading`, a nie `empty`", async () => {
    h.suggest.mockReturnValue(nigdyNieKonczy());
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    await waitFor(() =>
      expect(screen.getByText("admin.seo.linkSuggestions.loading")).toBeInTheDocument(),
    );
    expect(screen.queryByText("admin.seo.linkSuggestions.empty")).not.toBeInTheDocument();
    expect(screen.queryByText("admin.seo.linkSuggestions.hint")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("zero dopasowań pokazuje `empty` i przestaje pokazywać `loading`", async () => {
    h.suggest.mockResolvedValue([]);
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    await waitFor(() =>
      expect(screen.getByText("admin.seo.linkSuggestions.empty")).toBeInTheDocument(),
    );
    // Odwrotna asercja jest tu sensem testu: „nic nie znaleziono" i „jeszcze
    // szukam" to dla redakcji dwie różne informacje.
    expect(screen.queryByText("admin.seo.linkSuggestions.loading")).not.toBeInTheDocument();
  });

  it("błąd server function nie wywraca widgetu - zostaje komunikat o pustce", async () => {
    h.suggest.mockRejectedValue(new Error("brak profilu tenanta"));
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    await waitFor(() =>
      expect(screen.getByText("admin.seo.linkSuggestions.empty")).toBeInTheDocument(),
    );
    expect(screen.getByText("admin.seo.linkSuggestions.title")).toBeInTheDocument();
  });
});

describe("InternalLinkSuggestions - etykieta kandydata", () => {
  it("panel po polsku pokazuje title_pl", async () => {
    h.suggest.mockResolvedValue([sugestia()]);
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    await waitFor(() => expect(screen.getByText("Reforma WPR")).toBeInTheDocument());
    expect(screen.queryByText("CAP reform")).not.toBeInTheDocument();
  });

  it("panel po angielsku pokazuje title_en", async () => {
    h.lang = "en";
    h.suggest.mockResolvedValue([sugestia()]);
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    await waitFor(() => expect(screen.getByText("CAP reform")).toBeInTheDocument());
    expect(screen.queryByText("Reforma WPR")).not.toBeInTheDocument();
  });

  it("brak tłumaczenia EN spada na title_pl, nie na pusty wiersz", async () => {
    h.lang = "en";
    h.suggest.mockResolvedValue([sugestia({ title_en: null })]);
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    await waitFor(() => expect(screen.getByText("Reforma WPR")).toBeInTheDocument());
  });

  it("brak obu tytułów spada na slug - wiersz nadal daje się kliknąć świadomie", async () => {
    h.suggest.mockResolvedValue([sugestia({ title_pl: null, title_en: null })]);
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    // Slug występuje dwa razy: jako etykieta zastępcza i jako ścieżka „/slug".
    await waitFor(() =>
      expect(screen.getByText("reforma-wspolnej-polityki-rolnej")).toBeInTheDocument(),
    );
    expect(screen.getByText("/reforma-wspolnej-polityki-rolnej")).toBeInTheDocument();
  });
});

describe("InternalLinkSuggestions - plakietki powodu dopasowania", () => {
  it.each([
    { powod: "category", klucz: "admin.seo.linkSuggestions.reasonCategory" },
    { powod: "tag", klucz: "admin.seo.linkSuggestions.reasonTag" },
    // Dowolny inny powód (dziś serwer wysyła „content") wpada w gałąź treści -
    // test nie przypina literału, żeby nowy powód nie renderował się jako pusty.
    { powod: "fts-lead", klucz: "admin.seo.linkSuggestions.reasonContent" },
  ])("powód `$powod` renderuje klucz $klucz", async ({ powod, klucz }) => {
    h.suggest.mockResolvedValue([sugestia({ reasons: [powod] })]);
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    await waitFor(() => expect(screen.getByText(klucz)).toBeInTheDocument());
  });

  it("kandydat z kilkoma powodami dostaje plakietkę na każdy z nich", async () => {
    h.suggest.mockResolvedValue([sugestia({ reasons: ["category", "tag", "content"] })]);
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    await waitFor(() =>
      expect(screen.getByText("admin.seo.linkSuggestions.reasonCategory")).toBeInTheDocument(),
    );
    expect(screen.getByText("admin.seo.linkSuggestions.reasonTag")).toBeInTheDocument();
    expect(screen.getByText("admin.seo.linkSuggestions.reasonContent")).toBeInTheDocument();
  });
});

describe("InternalLinkSuggestions - podgląd kandydata", () => {
  it("link `otwórz` prowadzi na /<slug> w nowej karcie bez wycieku referrera", async () => {
    h.suggest.mockResolvedValue([sugestia()]);
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    const link = await waitFor(() =>
      screen.getByRole("link", { name: "admin.seo.linkSuggestions.open" }),
    );
    expect(link.getAttribute("href")).toBe("/reforma-wspolnej-polityki-rolnej");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });
});

describe("InternalLinkSuggestions - kopiowanie linku do schowka", () => {
  it("z ClipboardItem wkleja wariant HTML i zwykły adres, i potwierdza sukces", async () => {
    const schowek = schowekBogaty();
    h.suggest.mockResolvedValue([sugestia()]);
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    fireEvent.click(await waitFor(() => copyButton()));

    await waitFor(() => expect(schowek.write).toHaveBeenCalledTimes(1));
    // Ścieżka bogata NIE MOŻE dodatkowo wołać writeText - to nadpisałoby
    // wariant HTML zwykłym tekstem w edytorach, które rozumieją oba.
    expect(schowek.writeText).toHaveBeenCalledTimes(0);

    const [items] = schowek.write.mock.calls[0];
    expect(items).toHaveLength(1);
    expect(items[0].types).toEqual(["text/html", "text/plain"]);
    await expect((await items[0].getType("text/html")).text()).resolves.toBe(
      '<a href="/reforma-wspolnej-polityki-rolnej">Reforma WPR</a>',
    );
    await expect((await items[0].getType("text/plain")).text()).resolves.toBe(
      "/reforma-wspolnej-polityki-rolnej",
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("admin.seo.linkSuggestions.copied");
    expect(h.toastError).toHaveBeenCalledTimes(0);
  });

  it("etykieta w kopiowanym HTML-u idzie za językiem panelu", async () => {
    h.lang = "en";
    const schowek = schowekBogaty();
    h.suggest.mockResolvedValue([sugestia()]);
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    fireEvent.click(await waitFor(() => copyButton()));

    await waitFor(() => expect(schowek.write).toHaveBeenCalledTimes(1));
    const [items] = schowek.write.mock.calls[0];
    await expect((await items[0].getType("text/html")).text()).resolves.toBe(
      '<a href="/reforma-wspolnej-polityki-rolnej">CAP reform</a>',
    );
  });

  it("bez ClipboardItem spada na writeText z gotowym HTML-em", async () => {
    const schowek = schowekBezClipboardItem();
    h.suggest.mockResolvedValue([sugestia()]);
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    fireEvent.click(await waitFor(() => copyButton()));

    await waitFor(() =>
      expect(schowek.writeText).toHaveBeenCalledWith(
        '<a href="/reforma-wspolnej-polityki-rolnej">Reforma WPR</a>',
      ),
    );
    expect(schowek.write).toHaveBeenCalledTimes(0);
    expect(h.toastSuccess).toHaveBeenCalledWith("admin.seo.linkSuggestions.copied");
  });

  it("odmowa uprawnienia na clipboard.write daje komunikat błędu, nie ciszę", async () => {
    const schowek = schowekBogaty();
    schowek.write.mockRejectedValue(new Error("NotAllowedError: write denied"));
    h.suggest.mockResolvedValue([sugestia()]);
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    fireEvent.click(await waitFor(() => copyButton()));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("admin.seo.linkSuggestions.copyFail"),
    );
    // Fałszywe „skopiowano" byłoby gorsze niż brak akcji - redaktor wkleiłby
    // to, co miał w schowku wcześniej.
    expect(h.toastSuccess).toHaveBeenCalledTimes(0);
  });

  it("odmowa uprawnienia na writeText też daje komunikat błędu", async () => {
    const schowek = schowekBezClipboardItem();
    schowek.writeText.mockRejectedValue(new Error("NotAllowedError: writeText denied"));
    h.suggest.mockResolvedValue([sugestia()]);
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    fireEvent.click(await waitFor(() => copyButton()));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("admin.seo.linkSuggestions.copyFail"),
    );
    expect(h.toastSuccess).toHaveBeenCalledTimes(0);
  });

  it("całkowity brak API schowka kończy się komunikatem błędu, nie wyjątkiem", async () => {
    podmien(globalThis, "ClipboardItem", ClipboardItemStub);
    podmien(navigator, "clipboard", undefined);
    h.suggest.mockResolvedValue([sugestia()]);
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    fireEvent.click(await waitFor(() => copyButton()));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("admin.seo.linkSuggestions.copyFail"),
    );
    expect(h.toastSuccess).toHaveBeenCalledTimes(0);
  });
});

describe("InternalLinkSuggestions - filtrowanie kandydatów należy do serwera", () => {
  // Widget renderuje to, co dostanie: nie zna statusu wpisu (kształt
  // `LinkSuggestion` nie ma pola `status`) i nie porównuje `id` kandydata z
  // edytowanym `postId`. Oba filtry SĄ w server function - dlatego nie ma tu
  // `it.fails`: dublowanie filtra w widgecie byłoby drugą definicją polityki.
  it("wyświetla kandydata o tym samym id co edytowany wpis - filtr autolinku jest w server function", async () => {
    h.suggest.mockResolvedValue([sugestia({ id: POST_ID, slug: "edytowany-wpis" })]);
    renderWithQueryClient(
      <InternalLinkSuggestions {...PUSTY_EDYTOR} postId={POST_ID} tagIds={[TAG_ID]} />,
    );

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    // Fakt przypięty: brak własnego filtra po stronie klienta. Gwarancją jest
    // `if (r.post_id === postId) continue;` (kategorie, tagi) oraz
    // `if (r.id === postId) continue;` (FTS) w linkSuggestions.functions.ts,
    // dzięki którym taki kandydat nigdy nie trafia do odpowiedzi.
    const link = screen.getByRole("link", { name: "admin.seo.linkSuggestions.open" });
    expect(link.getAttribute("href")).toBe("/edytowany-wpis");
    expect(h.suggest).toHaveBeenCalledTimes(1);
  });

  it("wyświetla kandydata przekazanego przez serwer bez informacji o statusie publikacji", async () => {
    // `LinkSuggestion` nie przenosi statusu, więc widget nie ma czym filtrować.
    // Odrzucenie szkiców robi końcowy `select ... .eq("status", "published")`.
    h.suggest.mockResolvedValue([sugestia({ slug: "szkic-nieopublikowany", reasons: ["tag"] })]);
    renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />);

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByText("/szkic-nieopublikowany")).toBeInTheDocument();
    expect(screen.getByText("admin.seo.linkSuggestions.reasonTag")).toBeInTheDocument();
  });
});

describe("InternalLinkSuggestions - dostępność", () => {
  it("lista sugestii nie ma naruszeń axe (przyciski i linki mają nazwy)", async () => {
    h.suggest.mockResolvedValue([
      sugestia({ reasons: ["category", "tag"] }),
      sugestia({ id: "55555555-5555-4555-8555-555555555555", slug: "drugi", title_en: null }),
    ]);
    const { container } = renderWithQueryClient(
      <InternalLinkSuggestions {...PUSTY_EDYTOR} tagIds={[TAG_ID]} />,
    );

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("stan `hint` też jest dostępny (brak listy, sam komunikat)", async () => {
    const { container } = renderWithQueryClient(<InternalLinkSuggestions {...PUSTY_EDYTOR} />);

    await waitFor(() =>
      expect(screen.getByText("admin.seo.linkSuggestions.hint")).toBeInTheDocument(),
    );
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
