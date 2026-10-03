// Panel /admin/i18n - audyt tłumaczeń treści widgetów (PL -> EN).
//
// PRZEDMIOT DOWODU:
//   1. FAŁSZYWY ZIELONY WYNIK. Odczyt `pages` albo `posts`, który padł (błąd
//      sieci, odmowa RLS), NIE MOŻE wyglądać jak „Brak wykrytych braków" ani jak
//      „Znaleziono 0 problemów". Panel ma pokazać stan błędu z ponowieniem -
//      osobno dla każdej z dwóch tabel, bo każda może paść sama.
//   2. ZAKRES NAJEMCY. Polityka „Public reads published pages/posts" wpuszcza
//      KAŻDE zalogowane konto do opublikowanych treści najemcy publicznego, więc
//      bez filtra `tenant_id` administrator innego najemcy audytowałby cudze
//      strony, a przycisk „Edytuj widgety" prowadziłby do jego własnego
//      `/admin/pages/$slug` - innej strony albo żadnej. Dowód czyta ŁAŃCUCH
//      zapytania (atrapa nie wykonuje RLS i ten plik tego nie udaje).
//   3. LIMIT I JEGO WIDOCZNOŚĆ. Każdy wiersz to pełne `builder_data`, więc
//      odczyt ma górną granicę - a gdy baza ma więcej wierszy, panel mówi to
//      wprost (ta sama konwencja i ten sam komunikat co kokpit SEO).
//   4. PODPOWIEDŹ O UKRYTYCH OSTRZEŻENIACH. W trybie „Tylko błędy" panel ma
//      powiedzieć, że ostrzeżenia `same_as_pl` są ukryte - licząc je z PEŁNEGO
//      wyniku, nie z listy już przefiltrowanej do samych błędów.
//   5. Język interfejsu przez `uiLang` (jak reszta repozytorium), sortowanie po
//      liczbie problemów, deep-link do edytora strony vs wpisu, przełącznik
//      błędy/wszystko, ponowne skanowanie, `stale_default` z PRAWDZIWYCH
//      szablonów palety (`registry.tsx`).
//
// CO JEST ATRAPOWANE I DLACZEGO:
//   * klient Supabase - granica sieci; atrapa łańcucha (`supabaseFromStub`)
//     zapisuje ogniwa, więc test czyta filtr najemcy i limit;
//   * `useAuth` - jedyne źródło najemcy; prawdziwy wymaga sesji;
//   * `<Link>` - bez `RouterProvider` rzuca; zaślepka renderuje prawdziwy
//     adres docelowy (`/admin/pages/o-nas`), więc deep-link jest asertowalny.
// PRAWDZIWE biegną: `react-i18next` i słowniki (`realT`), audyt
// `widgetTranslationAudit`, rejestr widgetów, react-query (bez ponowień).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { fail, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
import { realT } from "@/test/i18nReal";
// Klucze komunikatów stanu odczytu (`adminSeoHub.*`) - asertujemy napisy ze słownika.
import "@/lib/i18n-admin-seo-hub";
import { axeViolations, summarize } from "@/test/axe";
import { WidgetI18nAuditPane } from "@/components/admin/i18n/WidgetI18nAuditPane";

const h = vi.hoisted(() => ({
  state: {
    from: (_table: string): unknown => ({}),
    tenantId: "tenant-nes" as string | null,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => h.state.from(table) },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ tenantId: h.state.tenantId }) }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

const TENANT = "tenant-nes";
const t = realT("pl");
const READ_ERROR = t("adminSeoHub.contentReadError");
const RETRY = t("adminSeoHub.contentRetry");
const NO_GAPS = "Brak wykrytych braków tłumaczeń w widgetach.";
const HIDDEN_WARNINGS_HINT =
  "Ostrzeżenia (EN identyczne z PL) są ukryte - bywają poprawne dla nazw własnych.";

interface Row {
  id: string;
  slug: string;
  title_pl: string | null;
  status: string | null;
  builder_data: unknown;
}

const row = (slug: string, builderData: unknown, over: Partial<Row> = {}): Row => ({
  id: `id-${slug}`,
  slug,
  title_pl: `Tytuł ${slug}`,
  status: "published",
  builder_data: builderData,
  ...over,
});

const heading = (id: string, textPl: string, textEn: string) => ({
  id,
  type: "heading",
  content: { text_pl: textPl, text_en: textEn },
});

const doc = (...widgets: unknown[]) => ({ sections: [{ columns: [{ widgets }] }] });

/** Odpowiedź z licznością - tak jak PostgREST oddaje `count: "exact"`. */
const rows = (list: Row[], count: number | null = list.length): SupabaseResult => ({
  data: list,
  error: null,
  count,
});

const db = supabaseFromStub();

function respond(pages: SupabaseResult, posts: SupabaseResult) {
  db.setResponse("pages", pages);
  db.setResponse("posts", posts);
}

function renderPane() {
  return renderWithQueryClient(<WidgetI18nAuditPane />);
}

beforeEach(() => {
  db.reset();
  h.state.from = db.from;
  h.state.tenantId = TENANT;
});

afterEach(async () => {
  // Odmontowanie PRZED zmianą języka - inaczej `languageChanged` przerysowuje
  // zamontowany panel poza `act` (szum ostrzeżeń w każdym teście).
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("WidgetI18nAuditPane - wynik audytu", () => {
  it("listuje wpisy i strony z problemami, posortowane malejąco po ich liczbie", async () => {
    respond(
      rows([
        row("o-nas", doc(heading("w1", "Zespół", ""))),
        row("czysta", doc(heading("w2", "Kontakt", "Contact"))),
        row("kontakt", doc(heading("w3", "Adres", ""), heading("w4", "Mapa", ""))),
      ]),
      rows([
        row(
          "raport",
          doc(heading("p1", "Wnioski", ""), heading("p2", "Tło", ""), heading("p3", "Dane", "")),
        ),
      ]),
    );
    renderPane();

    // Tytuł karty (własny tekst elementu, bez dopisku ze ścieżką) w kolejności
    // dokumentu: wpis z 3 problemami, strona z 2, strona z 1. Strona bez
    // problemów nie ma karty.
    const titles = await screen.findAllByText(/^Tytuł /);
    expect(titles.map((el) => el.firstChild?.textContent?.trim())).toEqual([
      "Tytuł raport",
      "Tytuł kontakt",
      "Tytuł o-nas",
    ]);
    expect(document.body.textContent).toContain("Znaleziono 6 problemów w 3 wpisach/stronach");
  });

  it("strona linkuje do edytora strony, wpis do edytora wpisu", async () => {
    respond(
      rows([row("o-nas", doc(heading("w1", "Zespół", "")))]),
      rows([row("raport", doc(heading("p1", "Wnioski", "")))]),
    );
    renderPane();

    const links = await screen.findAllByRole("link", { name: "Edytuj widgety" });
    expect(links.map((a) => a.getAttribute("href")).sort()).toEqual([
      "/admin/pages/o-nas",
      "/admin/posts/raport",
    ]);
    // Podpowiedź adresu publicznego: strona w korzeniu, wpis pod /post/.
    expect(screen.getByText("/o-nas")).toBeInTheDocument();
    expect(screen.getByText("/post/raport")).toBeInTheDocument();
  });

  it("brak tytułu i statusu: tytułem jest slug, statusem szkic", async () => {
    respond(
      rows([row("bez-tytulu", doc(heading("w1", "Zespół", "")), { title_pl: null, status: null })]),
      rows([]),
    );
    renderPane();

    // Tytuł karty = slug; obok ścieżka publiczna z tym samym slugiem.
    expect(await screen.findByText("bez-tytulu")).toBeInTheDocument();
    expect(screen.getByText("/bez-tytulu")).toBeInTheDocument();
    expect(screen.getByText("draft")).toBeInTheDocument();
  });

  it("wiersz problemu: etykieta klasy, widget · pole, podglądy PL/EN z kreską dla pustego", async () => {
    respond(rows([row("o-nas", doc(heading("w1", "Zespół", "")))]), rows([]));
    renderPane();

    expect(await screen.findByText("Brak tłumaczenia EN")).toBeInTheDocument();
    expect(screen.getByText("heading · text")).toBeInTheDocument();
    const pl = screen.getByText("PL:").parentElement;
    const en = screen.getByText("EN:").parentElement;
    expect(pl?.textContent).toBe("PL: Zespół");
    expect(en?.textContent).toBe("EN: —");
  });

  it("stale_default liczy się z prawdziwego szablonu palety", async () => {
    // `animated-heading` z registry.tsx: textBefore_pl „Dołącz" / _en „Join".
    respond(
      rows([
        row(
          "dolacz",
          doc({
            id: "ah",
            type: "animated-heading",
            content: { textBefore_pl: "Poznaj nas", textBefore_en: "Join" },
          }),
        ),
      ]),
      rows([]),
    );
    renderPane();

    expect(await screen.findByText("Szablonowa wartość EN")).toBeInTheDocument();
    expect(screen.getByText("animated-heading · textBefore")).toBeInTheDocument();
  });

  it("bez problemów: komunikat o braku braków i zero w liczniku", async () => {
    respond(rows([row("czysta", doc(heading("w1", "Kontakt", "Contact")))]), rows([]));
    renderPane();

    expect(await screen.findByText(NO_GAPS)).toBeInTheDocument();
    expect(document.body.textContent).toContain("Znaleziono 0 problemów w 0 wpisach/stronach");
  });

  it("ponowne skanowanie wykonuje nowy odczyt i pokazuje nowy stan", async () => {
    respond(rows([row("o-nas", doc(heading("w1", "Zespół", "")))]), rows([]));
    renderPane();
    await screen.findByText("Brak tłumaczenia EN");
    expect(db.chainsFor("pages")).toHaveLength(1);

    respond(rows([row("o-nas", doc(heading("w1", "Zespół", "Team")))]), rows([]));
    fireEvent.click(screen.getByRole("button", { name: "Przeskanuj ponownie" }));

    expect(await screen.findByText(NO_GAPS)).toBeInTheDocument();
    expect(db.chainsFor("pages")).toHaveLength(2);
    expect(db.chainsFor("posts")).toHaveLength(2);
  });

  it("jest dostępny (axe)", async () => {
    respond(
      rows([
        row("o-nas", doc(heading("w1", "Zespół", ""), heading("w2", "ANALITYCY", "ANALITYCY"))),
      ]),
      rows([]),
    );
    const { container } = renderPane();
    await screen.findByText("Brak tłumaczenia EN");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("WidgetI18nAuditPane - błędy i ostrzeżenia", () => {
  const warningsOnly = rows([row("analitycy", doc(heading("w1", "ANALITYCY", "ANALITYCY")))]);
  const mixed = rows([
    row("mix", doc(heading("w1", "ANALITYCY", "ANALITYCY"), heading("w2", "Zespół", ""))),
  ]);

  it("domyślnie pokazuje tylko błędy; przełącznik dokłada ostrzeżenia i wraca", async () => {
    respond(mixed, rows([]));
    renderPane();

    expect(await screen.findByText("Brak tłumaczenia EN")).toBeInTheDocument();
    expect(screen.queryByText("EN identyczne z PL")).toBeNull();
    expect(document.body.textContent).toContain("Znaleziono 1 problemów w 1 wpisach/stronach");

    fireEvent.click(screen.getByRole("button", { name: "Tylko błędy" }));
    expect(await screen.findByText("EN identyczne z PL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Błędy i ostrzeżenia" })).toBeInTheDocument();
    expect(document.body.textContent).toContain("Znaleziono 2 problemów w 1 wpisach/stronach");

    fireEvent.click(screen.getByRole("button", { name: "Błędy i ostrzeżenia" }));
    await waitFor(() => expect(screen.queryByText("EN identyczne z PL")).toBeNull());
  });

  it("w trybie „Tylko błędy” mówi, że ukrył ostrzeżenia", async () => {
    // Wcześniej licznik ostrzeżeń brano z listy JUŻ przefiltrowanej do błędów,
    // więc warunek `warnings > 0 && errorsOnly` był niespełnialny i ta
    // podpowiedź nie pojawiała się nigdy.
    respond(warningsOnly, rows([]));
    renderPane();

    expect(await screen.findByText(HIDDEN_WARNINGS_HINT)).toBeInTheDocument();
    // Brak BŁĘDÓW jest prawdą, ale nie całą - stąd podpowiedź obok.
    expect(screen.getByText(NO_GAPS)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tylko błędy" }));
    expect(await screen.findByText("EN identyczne z PL")).toBeInTheDocument();
    expect(screen.queryByText(HIDDEN_WARNINGS_HINT)).toBeNull();
  });

  it("w trybie „Błędy i ostrzeżenia” wpis bez żadnego problemu nadal nie ma karty", async () => {
    // Domyślny tryb „Tylko błędy” sam odsiewa wpisy bez błędów, więc tylko
    // pełny tryb dowodzi, że audyt nie zwraca czystych wpisów jako pustych kart
    // (i nie dolicza ich do licznika wpisów).
    respond(
      rows([
        row("czysta", doc(heading("w1", "Kontakt", "Contact"))),
        row("mix", doc(heading("w2", "ANALITYCY", "ANALITYCY"), heading("w3", "Zespół", ""))),
      ]),
      rows([]),
    );
    renderPane();
    await screen.findByText("Brak tłumaczenia EN");

    fireEvent.click(screen.getByRole("button", { name: "Tylko błędy" }));
    expect(await screen.findByText("EN identyczne z PL")).toBeInTheDocument();
    expect(screen.queryByText("Tytuł czysta")).toBeNull();
    expect(screen.getAllByRole("link", { name: "Edytuj widgety" })).toHaveLength(1);
    expect(document.body.textContent).toContain("Znaleziono 2 problemów w 1 wpisach/stronach");
  });

  it("bez ostrzeżeń w wyniku podpowiedzi nie ma", async () => {
    respond(rows([row("o-nas", doc(heading("w1", "Zespół", "")))]), rows([]));
    renderPane();

    await screen.findByText("Brak tłumaczenia EN");
    expect(screen.queryByText(HIDDEN_WARNINGS_HINT)).toBeNull();
  });
});

describe("WidgetI18nAuditPane - odczyt, który padł (fałszywy zielony)", () => {
  it.each([
    ["pages", () => respond(fail("permission denied for table pages", "42501"), rows([]))],
    ["posts", () => respond(rows([]), fail("permission denied for table posts", "42501"))],
  ])("błąd odczytu %s to stan błędu, nie „brak braków”", async (_table, setup) => {
    setup();
    renderPane();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(READ_ERROR);
    expect(screen.queryByText(NO_GAPS)).toBeNull();
    expect(document.body.textContent).not.toContain("Znaleziono");
  });

  it("ponowienie po błędzie wczytuje wynik i chowa komunikat", async () => {
    respond(fail("fetch failed"), rows([]));
    renderPane();
    const alert = await screen.findByRole("alert");

    respond(rows([row("o-nas", doc(heading("w1", "Zespół", "")))]), rows([]));
    fireEvent.click(within(alert).getByRole("button", { name: RETRY }));

    expect(await screen.findByText("Brak tłumaczenia EN")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("nieudane ponowne skanowanie chowa poprzedni wynik zamiast udawać stan serwisu", async () => {
    // react-query po błędzie TRZYMA poprzednie dane - panel nie może ich dalej
    // pokazywać jako aktualnego audytu obok komunikatu o błędzie.
    respond(rows([row("o-nas", doc(heading("w1", "Zespół", "")))]), rows([]));
    renderPane();
    await screen.findByText("Brak tłumaczenia EN");

    respond(fail("fetch failed"), rows([]));
    fireEvent.click(screen.getByRole("button", { name: "Przeskanuj ponownie" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(READ_ERROR);
    expect(screen.queryByText("Brak tłumaczenia EN")).toBeNull();
    expect(screen.queryByText(NO_GAPS)).toBeNull();
    expect(document.body.textContent).not.toContain("Znaleziono");
  });
});

describe("WidgetI18nAuditPane - zakres najemcy i limit", () => {
  it("oba odczyty są zawężone do najemcy, edytora buildera i nieusuniętych, z limitem i licznością", async () => {
    respond(rows([]), rows([]));
    renderPane();
    await screen.findByText(NO_GAPS);

    for (const [table, limit] of [
      ["pages", 500],
      ["posts", 1000],
    ] as const) {
      const chain = db.lastChain(table);
      expect(chain, table).toBeDefined();
      const eqs = chain!.calls.filter((c) => c.method === "eq").map((c) => c.args);
      expect(eqs, table).toContainEqual(["tenant_id", TENANT]);
      expect(eqs, table).toContainEqual(["editor", "builder"]);
      expect(chain!.argsOf("is"), table).toEqual(["deleted_at", null]);
      expect(chain!.argsOf("select")?.[1], table).toEqual({ count: "exact" });
      expect(chain!.argsOf("order"), table).toEqual(["updated_at", { ascending: false }]);
      expect(chain!.argsOf("limit"), table).toEqual([limit]);
    }
  });

  it("bez najemcy nie pyta bazy i nie twierdzi, że braków nie ma", async () => {
    h.state.tenantId = null;
    respond(rows([]), rows([]));
    renderPane();

    expect(await screen.findByText("Skanowanie…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Przeskanuj ponownie" })).toBeDisabled();
    expect(db.chains).toHaveLength(0);
    expect(screen.queryByText(NO_GAPS)).toBeNull();
  });

  it("baza ma więcej wierszy niż pobrano: panel mówi o przycięciu", async () => {
    respond(
      rows([row("o-nas", doc(heading("w1", "Zespół", "")))], 700),
      rows([row("raport", doc(heading("p1", "Wnioski", "")))], 1500),
    );
    renderPane();

    expect(
      await screen.findByText(t("adminSeoHub.coverageTruncated", { shown: 2, total: 2200 })),
    ).toBeInTheDocument();
  });

  it("liczność mniejsza niż pobrane wiersze (wyścig) liczy pobrane wiersze", async () => {
    // Wiersz dodany między zliczeniem a odczytem: `count` 0 przy 1 wierszu.
    // Łączna liczba to 1 (pobrane) + 1500 (wpisy), nie 0 + 1500.
    respond(
      rows([row("o-nas", doc(heading("w1", "Zespół", "")))], 0),
      rows([row("raport", doc(heading("p1", "Wnioski", "")))], 1500),
    );
    renderPane();

    expect(
      await screen.findByText(t("adminSeoHub.coverageTruncated", { shown: 2, total: 1501 })),
    ).toBeInTheDocument();
  });

  it("zmiana najemcy to nowy odczyt w jego zakresie, nie wynik poprzedniego z pamięci", async () => {
    respond(rows([row("o-nas", doc(heading("w1", "Zespół", "")))]), rows([]));
    const { rerender, queryClient } = renderPane();
    expect(await screen.findByText("Tytuł o-nas")).toBeInTheDocument();

    h.state.tenantId = "tenant-other";
    respond(rows([row("inna", doc(heading("w9", "Kontakt", "")))]), rows([]));
    rerender(
      <QueryClientProvider client={queryClient}>
        <WidgetI18nAuditPane />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Tytuł inna")).toBeInTheDocument();
    expect(screen.queryByText("Tytuł o-nas")).toBeNull();
    const eqs = db
      .lastChain("pages")!
      .calls.filter((c) => c.method === "eq")
      .map((c) => c.args);
    expect(eqs).toContainEqual(["tenant_id", "tenant-other"]);
  });

  it("liczność nieznana: panel nie twierdzi, że lista jest pełna", async () => {
    respond(rows([row("o-nas", doc(heading("w1", "Zespół", "")))], null), rows([]));
    renderPane();

    expect(
      await screen.findByText(t("adminSeoHub.coverageUnknown", { shown: 1 })),
    ).toBeInTheDocument();
  });

  it("liczność nieznana po stronie wpisów też jest „nieznana”, a brak wierszy to pusta lista", async () => {
    // PostgREST bez wierszy i bez liczności (np. `data: null`) - panel nie
    // może z tego zrobić ani wyjątku, ani „pełnej listy".
    respond({ data: null, error: null, count: 0 }, { data: null, error: null, count: null });
    renderPane();

    expect(
      await screen.findByText(t("adminSeoHub.coverageUnknown", { shown: 0 })),
    ).toBeInTheDocument();
    expect(screen.getByText(NO_GAPS)).toBeInTheDocument();
  });

  it("komplet: bez komunikatu o pokryciu", async () => {
    respond(rows([row("o-nas", doc(heading("w1", "Zespół", "")))]), rows([]));
    renderPane();

    await screen.findByText("Brak tłumaczenia EN");
    expect(document.querySelector("[data-seo-coverage]")).toBeNull();
  });
});

describe("WidgetI18nAuditPane - język interfejsu", () => {
  it("po angielsku: etykiety panelu i klas problemów", async () => {
    await i18n.changeLanguage("en");
    respond(mixedEn(), rows([]));
    renderPane();

    expect(await screen.findByText("Missing EN translation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rescan" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit widgets" })).toBeInTheDocument();
    expect(screen.getByText(/Warnings \(EN identical to PL\) are hidden/)).toBeInTheDocument();
  });

  it("regionalny kod języka („en-GB”) też jest angielskim interfejsem", async () => {
    // Przy obecnej konfiguracji i18next (`supportedLngs: ["pl","en"]`)
    // `changeLanguage("en-GB")` i tak ustawia „en", więc to nie jest dziś żywy
    // błąd - test przypina NORMALIZACJĘ przez `uiLang`, tę samą regułę co reszta
    // repozytorium, zamiast porównania `=== "en"` wrażliwego na region.
    const previous = i18n.language;
    i18n.language = "en-GB";
    try {
      respond(mixedEn(), rows([]));
      renderPane();
      expect(await screen.findByText("Missing EN translation")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Rescan" })).toBeInTheDocument();
    } finally {
      i18n.language = previous;
    }
  });
});

function mixedEn(): SupabaseResult {
  return rows([
    row("mix", doc(heading("w1", "ANALITYCY", "ANALITYCY"), heading("w2", "Zespół", ""))),
  ]);
}
