// TRASA IMPORTU Z WORDPRESS.COM. Do 19.08.2026 na zerze (607 instrukcji).
//
// To jedyne wejście, przez które treść z obcego systemu trafia do bazy tej
// redakcji, i jedyny ekran, który uruchamia ZADANIE W TLE. Cztery reguły:
//
//   1. PODGLĄD PRZED IMPORTEM. Import bez podglądu jest zablokowany - inaczej
//      jedno kliknięcie ściąga kilkaset cudzych wpisów, których nikt nie
//      widział.
//   2. ZAZNACZENIE ZAWĘŻA. Puste zaznaczenie znaczy „wszystko z podglądu”, a
//      niepuste - dokładnie te identyfikatory. Pomylenie tych dwóch stanów
//      importuje wszystko, gdy redaktor wybrał trzy wpisy.
//   3. ZADANIE ŻYJE W TLE. Ekran odpytuje o postęp, dopóki zadanie biegnie, i
//      PRZESTAJE po jego zakończeniu - odpytywanie bez końca to zapytanie na
//      sekundę do końca sesji.
//   4. FORMULARZ MA DZIAŁAĆ BEZ KONEKTORA. Gdy lista witryn wraca pusta (token
//      przypisany do jednej witryny), pole musi dostać wartość zastępczą,
//      inaczej ekranu nie da się w ogóle użyć.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";

const h = vi.hoisted(() => ({
  language: "pl",
  sites: [] as { id: number; name: string; url: string }[],
  sitesError: null as Error | null,
  previewResult: { posts: [] as Record<string, unknown>[], found: 0 },
  previewError: null as Error | null,
  previewCalls: [] as unknown[],
  createCalls: [] as unknown[],
  runCalls: [] as unknown[],
  cancelCalls: [] as unknown[],
  job: null as Record<string, unknown> | null,
  jobCalls: 0,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({ t: (k: string) => k, i18n: { language: h.language } }),
  };
});
vi.mock("@/lib/wordpress-import.functions", () => ({
  listWpComSites: "list",
  previewWpComPosts: "preview",
  createWpImportJob: "create",
  runWpImportJob: "run",
  getWpImportJob: "get",
  cancelWpImportJob: "cancel",
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => async (payload: unknown) => {
    switch (fn) {
      case "list":
        if (h.sitesError) throw h.sitesError;
        return { sites: h.sites };
      case "preview":
        h.previewCalls.push(payload);
        if (h.previewError) throw h.previewError;
        return h.previewResult;
      case "create":
        h.createCalls.push(payload);
        return { jobId: "job-1" };
      case "run":
        h.runCalls.push(payload);
        return { ok: true };
      case "get":
        h.jobCalls += 1;
        return h.job;
      default:
        h.cancelCalls.push(payload);
        return { ok: true };
    }
  },
}));

import { Route } from "@/routes/admin.import-wordpress";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function wpPost(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    slug: "pierwszy-wpis",
    title: "Pierwszy wpis",
    excerpt: "Krótki fragment",
    date: "2026-07-09T12:00:00+00:00",
    status: "publish",
    url: "https://example.wordpress.com/2026/07/09/pierwszy-wpis/",
    featured_image: null,
    ...overrides,
  };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    status: "running",
    total: 10,
    processed: 4,
    imported: 3,
    updated_count: 1,
    skipped: 0,
    failed: 0,
    media_imported: 2,
    log: [],
    error: null,
    finished_at: null,
    ...overrides,
  };
}

async function setup() {
  const Component = (Route as AnyRoute).options.component as () => ReactNode;
  const view = render(<Component />, { wrapper });
  await waitFor(() => expect(siteInput().value).not.toBe(""));
  return view;
}

const siteInput = () => screen.getByPlaceholderText("example.wordpress.com") as HTMLInputElement;
const previewButton = () => screen.getByRole("button", { name: /^Podgląd$/ });
const importButton = () => screen.getByRole("button", { name: /^Importuj/ });

/**
 * Uruchamia podgląd i czeka na tabelę wyników.
 *
 * Przycisk jest wyłączony, dopóki pole witryny jest puste - a wypełnia je
 * efekt po odpowiedzi konektora. Klikanie bez tego oczekiwania to wyścig:
 * kliknięcie w wyłączony przycisk nic nie robi i tabela nigdy nie wjeżdża.
 */
async function runPreview(posts = [wpPost()]) {
  h.previewResult = { posts, found: posts.length };
  const przed = h.previewCalls.length;
  await waitFor(() => expect(previewButton()).toBeEnabled());
  fireEvent.click(previewButton());
  await waitFor(() => expect(h.previewCalls.length).toBeGreaterThan(przed));
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.language = "pl";
  h.sites = [
    { id: 1, name: "Blog", url: "https://blog.example.com" },
    { id: 2, name: "NES", url: "https://www.neweuropeanstrategies.com" },
  ];
  h.sitesError = null;
  h.previewResult = { posts: [], found: 0 };
  h.previewError = null;
  h.previewCalls.length = 0;
  h.createCalls.length = 0;
  h.runCalls.length = 0;
  h.cancelCalls.length = 0;
  h.job = null;
  h.jobCalls = 0;
});

describe("import z WP - wybór witryny", () => {
  it("wypełnia pole witryny SAMO, bez klikania", async () => {
    // Pusty formularz na wejściu to trzy kroki więcej przy każdym imporcie.
    await setup();
    expect(siteInput().value).not.toBe("");
  });

  it("wybiera witrynę REDAKCJI, a nie pierwszą z brzegu", async () => {
    // Lista konektora bywa długa; domyślnie ma się trafić własna domena.
    await setup();
    expect(siteInput().value).toBe("www.neweuropeanstrategies.com");
  });

  it("gdy własnej domeny nie ma, bierze PIERWSZĄ z listy", async () => {
    h.sites = [{ id: 9, name: "Inny", url: "https://inny.example.com" }];
    await setup();

    expect(siteInput().value).toBe("inny.example.com");
  });

  it("PUSTA lista witryn i tak daje użyteczny formularz", async () => {
    // Token przypisany do jednej witryny nie zwraca `/me/sites`; bez wartości
    // zastępczej ekranu nie da się w ogóle użyć.
    h.sites = [];
    await setup();

    expect(siteInput().value).toBe("neweuropeanstrategies.com");
  });

  it("wpis o nieprawidłowym adresie nie wywraca wypełniania", async () => {
    h.sites = [{ id: 9, name: "Zły", url: "nie-adres" }];
    const Component = (Route as AnyRoute).options.component as () => ReactNode;

    expect(() => render(<Component />, { wrapper })).not.toThrow();
  });

  it("lista witryn z konektora jest do KLIKNIĘCIA", async () => {
    // Przepisywanie domeny ręcznie z pamięci to najczęstsze źródło literówek.
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /Blog/ }));

    expect(siteInput().value).toContain("blog.example.com");
  });
});

describe("import z WP - podgląd przed importem", () => {
  it("import jest ZABLOKOWANY, dopóki nie ma podglądu", async () => {
    // Bez tej blokady jedno kliknięcie ściąga kilkaset cudzych wpisów.
    await setup();
    expect(importButton()).toBeDisabled();
  });

  it("podgląd niesie WSZYSTKIE parametry zapytania", async () => {
    // Zgubiony `type` albo `status` daje podgląd wpisów, a import stron.
    await setup();
    await runPreview();

    expect(h.previewCalls[0]).toMatchObject({
      data: {
        site: "www.neweuropeanstrategies.com",
        number: 20,
        offset: 0,
        status: "publish",
        type: "post",
      },
    });
  });

  it("PRZYCINA domenę z białych znaków", async () => {
    // Spacja na końcu daje adres API, który zwraca 404.
    await setup();
    fireEvent.change(siteInput(), { target: { value: "  moja.example.com  " } });
    await runPreview();

    expect((h.previewCalls[0] as { data: { site: string } }).data.site).toBe("moja.example.com");
  });

  it("pusta domena BLOKUJE podgląd", async () => {
    await setup();
    fireEvent.change(siteInput(), { target: { value: "   " } });

    expect(previewButton()).toBeDisabled();
  });

  it("tabela podglądu pokazuje tytuł, datę, status i slug", async () => {
    // Sam tytuł nie wystarcza do rozpoznania duplikatu - slug decyduje o
    // nadpisaniu istniejącego wpisu.
    await setup();
    await runPreview();
    const wiersz = screen.getAllByRole("row")[1];

    expect(wiersz.textContent).toContain("Pierwszy wpis");
    expect(wiersz.textContent).toContain("2026-07-09");
    expect(wiersz.textContent).toContain("publish");
    expect(wiersz.textContent).toContain("pierwszy-wpis");
  });

  it("wpis bez tytułu pokazuje swój numer, nie pustkę", async () => {
    await setup();
    await runPreview([wpPost({ title: "" })]);

    expect(screen.getAllByRole("row")[1].textContent).toContain("#101");
  });

  it("odnośnik do oryginału otwiera się w NOWEJ karcie", async () => {
    // Kliknięcie w podglądzie nie może wyrzucić redaktora z panelu.
    await setup();
    await runPreview();
    const link = within(screen.getAllByRole("row")[1]).getByRole("link");

    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("PORAŻKA podglądu pokazuje powód obok przycisku", async () => {
    h.previewError = new Error("403 z konektora");
    await setup();
    fireEvent.click(previewButton());

    await waitFor(() => expect(screen.getByText(/403 z konektora/)).toBeInTheDocument());
  });

  it("liczba znalezionych wpisów jest widoczna pod tabelą", async () => {
    await setup();
    await runPreview([wpPost(), wpPost({ id: 102, slug: "drugi" })]);

    expect(screen.getByText(/Znaleziono/).textContent).toContain("2");
  });
});

describe("import z WP - zaznaczenie zawęża zakres", () => {
  const dwa = () => [wpPost(), wpPost({ id: 102, slug: "drugi", title: "Drugi" })];

  it("bez zaznaczenia importuje WSZYSTKO z podglądu", async () => {
    await setup();
    await runPreview(dwa());
    expect(importButton().textContent).toMatch(/wszystkie/i);

    fireEvent.click(importButton());
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect((h.createCalls[0] as { data: { only_ids?: number[] } }).data.only_ids).toBeUndefined();
  });

  it("zaznaczenie ogranicza import do WSKAZANYCH identyfikatorów", async () => {
    // Pomylenie tych dwóch stanów importuje wszystko, gdy redaktor wybrał trzy.
    await setup();
    await runPreview(dwa());
    fireEvent.click(within(screen.getAllByRole("row")[2]).getByRole("checkbox"));

    fireEvent.click(importButton());
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect((h.createCalls[0] as { data: { only_ids?: number[] } }).data.only_ids).toEqual([102]);
  });

  it("przycisk importu podaje LICZBĘ zaznaczonych", async () => {
    await setup();
    await runPreview(dwa());
    fireEvent.click(screen.getByLabelText("Select all"));

    expect(importButton().textContent).toContain("2");
  });

  it("„zaznacz wszystko” działa w OBIE strony", async () => {
    await setup();
    await runPreview(dwa());
    const all = screen.getByLabelText("Select all");
    fireEvent.click(all);
    expect(importButton().textContent).toContain("2");

    fireEvent.click(all);
    expect(importButton().textContent).toMatch(/wszystkie/i);
  });

  it("odznaczenie pojedynczego wiersza zdejmuje TYLKO jego", async () => {
    await setup();
    await runPreview(dwa());
    fireEvent.click(screen.getByLabelText("Select all"));
    fireEvent.click(within(screen.getAllByRole("row")[1]).getByRole("checkbox"));

    fireEvent.click(importButton());
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect((h.createCalls[0] as { data: { only_ids?: number[] } }).data.only_ids).toEqual([102]);
  });

  it("NOWY podgląd czyści wcześniejsze zaznaczenie", async () => {
    // Identyfikatory z poprzedniego zapytania celują w inne wpisy.
    await setup();
    await runPreview(dwa());
    fireEvent.click(screen.getByLabelText("Select all"));
    expect(importButton().textContent).toContain("2");

    await runPreview([wpPost({ id: 999, slug: "nowy" })]);
    expect(importButton().textContent).toMatch(/wszystkie/i);
  });
});

describe("import z WP - opcje importu", () => {
  it("przekazuje JĘZYK, synchronizację i media do zadania", async () => {
    // Import bez języka ląduje w niewłaściwej wersji językowej serwisu.
    await setup();
    await runPreview();
    fireEvent.click(importButton());

    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(h.createCalls[0]).toMatchObject({
      data: { language: "pl", sync_existing: false, import_media: true },
    });
  });

  it("przełączniki zmieniają wysyłane opcje", async () => {
    // „Synchronizuj istniejące” NADPISUJE opublikowane wpisy - musi trafiać
    // dokładnie tam, gdzie redaktor je włączył.
    await setup();
    fireEvent.click(
      screen
        .getByText(/Synchronizuj istniejące/)
        .closest("label")!
        .querySelector("input")!,
    );
    fireEvent.click(
      screen
        .getByText(/Importuj media/)
        .closest("label")!
        .querySelector("input")!,
    );
    await runPreview();
    fireEvent.click(importButton());

    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(h.createCalls[0]).toMatchObject({
      data: { sync_existing: true, import_media: false },
    });
  });

  it("zadanie jest URUCHAMIANE z tym samym zestawem parametrów", async () => {
    // Utworzenie zadania i jego uruchomienie to dwa wywołania; rozjazd
    // parametrów daje zadanie importujące co innego, niż zapowiadał podgląd.
    await setup();
    await runPreview();
    fireEvent.click(importButton());

    await waitFor(() => expect(h.runCalls).toHaveLength(1));
    const created = (h.createCalls[0] as { data: Record<string, unknown> }).data;
    expect(h.runCalls[0]).toMatchObject({ data: { ...created, jobId: "job-1" } });
  });
});

describe("import z WP - parametry zakresu", () => {
  /** Pole liczbowe po widocznej etykiecie. */
  function numberField(label: string): HTMLInputElement {
    const wrap = screen.getByText(label).closest("div");
    return wrap?.querySelector('input[type="number"]') as HTMLInputElement;
  }

  /** Lista wyboru po widocznej etykiecie. */
  function selectByLabel(label: string): HTMLElement {
    const wrap = screen.getByText(label).closest("div") as HTMLElement;
    return within(wrap).getByRole("combobox");
  }

  it.each([
    ["0", 1],
    ["-5", 1],
    ["999", 100],
    ["abc", 1],
    ["50", 50],
  ])("ilość %s ląduje w zakresie 1-100 jako %s", async (wpisane, oczekiwane) => {
    // Zero ściąga zero wpisów, a tysiąc przekracza limit REST API - w obu
    // wypadkach import kończy się bez śladu.
    await setup();
    fireEvent.change(numberField("Ilość"), { target: { value: wpisane } });
    await runPreview();

    expect((h.previewCalls[0] as { data: { number: number } }).data.number).toBe(oczekiwane);
  });

  it.each([
    ["-3", 0],
    ["abc", 0],
    ["40", 40],
  ])("pominięcie %s nie schodzi poniżej zera (%s)", async (wpisane, oczekiwane) => {
    // Ujemne przesunięcie zwraca z API błąd zamiast pustej listy.
    await setup();
    fireEvent.change(numberField("Pomiń"), { target: { value: wpisane } });
    await runPreview();

    expect((h.previewCalls[0] as { data: { offset: number } }).data.offset).toBe(oczekiwane);
  });

  it("typ treści zapisuje WARTOŚĆ, nie widoczną etykietę", async () => {
    // „Strony” zamiast „page” daje zapytanie, którego API nie rozumie.
    await setup();
    fireEvent.keyDown(selectByLabel("Typ treści"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: /^Strony$/ }));
    await runPreview();

    expect((h.previewCalls[0] as { data: { type: string } }).data.type).toBe("page");
  });

  it("status źródłowy zapisuje wartość API", async () => {
    await setup();
    fireEvent.keyDown(selectByLabel("Status"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: /^Szkice$/ }));
    await runPreview();

    expect((h.previewCalls[0] as { data: { status: string } }).data.status).toBe("draft");
  });

  it("JĘZYK docelowy trafia do zadania, nie do podglądu", async () => {
    // Podgląd czyta z WordPressa, język dotyczy dopiero zapisu u nas.
    await setup();
    fireEvent.keyDown(selectByLabel("Język"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: /^EN$/i }));
    await runPreview();
    fireEvent.click(importButton());

    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect((h.createCalls[0] as { data: { language: string } }).data.language).toBe("en");
    expect(h.previewCalls[0]).not.toHaveProperty("data.language");
  });

  it("przycisk „Moje witryny” odpytuje konektor PONOWNIE", async () => {
    // Witryna dodana w WordPressie po otwarciu ekranu nie pojawi się sama.
    await setup();
    h.sites = [{ id: 5, name: "Nowa", url: "https://nowa.example.com" }];
    fireEvent.click(screen.getByRole("button", { name: /Moje witryny/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: /Nowa/ })).toBeInTheDocument());
  });
});

describe("import z WP - zadanie w tle", () => {
  async function startJob(jobState = job()) {
    h.job = jobState;
    await setup();
    await runPreview();
    fireEvent.click(importButton());
    await waitFor(() => expect(screen.getByText(/\d+\/\d+/)).toBeInTheDocument());
  }

  it("pokazuje postęp z liczbami z SERWERA", async () => {
    await startJob();
    expect(screen.getByText("4/10 (40%)")).toBeInTheDocument();
  });

  it("rozbija wynik na nowe, zaktualizowane, pominięte, błędy i media", async () => {
    // Sam licznik przetworzonych nie mówi, czy import cokolwiek dodał.
    await startJob(
      job({ imported: 7, updated_count: 2, skipped: 1, failed: 3, media_imported: 9 }),
    );
    const panel = screen.getByText(/Nowe/).closest("ul") as HTMLElement;

    expect(panel.textContent).toContain("7");
    expect(panel.textContent).toContain("2");
    expect(panel.textContent).toContain("1");
    expect(panel.textContent).toContain("3");
    expect(panel.textContent).toContain("9");
  });

  it("BIEGNĄCE zadanie da się anulować", async () => {
    // Import kilkuset wpisów bez przerwania to godzina czekania.
    await startJob();
    fireEvent.click(screen.getByRole("button", { name: /^Anuluj$/ }));

    await waitFor(() => expect(h.cancelCalls).toHaveLength(1));
    expect(h.cancelCalls[0]).toMatchObject({ data: { jobId: "job-1" } });
  });

  it("ZAKOŃCZONE zadanie nie ma już czego anulować", async () => {
    await startJob(job({ status: "completed", processed: 10 }));
    expect(screen.queryByRole("button", { name: /^Anuluj$/ })).toBeNull();
  });

  it.each([
    ["completed", /zakończony/i],
    ["failed", /nieudany/i],
    ["canceled", /anulowany/i],
    ["running", /^Importowanie w tle/],
  ])("stan %s ma własny komunikat", async (status, wzorzec) => {
    // Wszystkie stany wyglądające tak samo to ekran, z którego nie wynika, czy
    // można już zamknąć kartę.
    await startJob(job({ status }));
    // Nagłówek panelu zadania, a nie opis strony - ten też mówi „w tle”.
    const naglowek = document.querySelector("strong")?.textContent ?? "";
    expect(naglowek).toMatch(wzorzec as RegExp);
  });

  it("błąd zadania jest POKAZANY, nie tylko zliczony", async () => {
    await startJob(job({ status: "failed", error: "połączenie zerwane" }));
    expect(screen.getByText("połączenie zerwane")).toBeInTheDocument();
  });

  it("dziennik pusty mówi wprost, że nic się jeszcze nie wydarzyło", async () => {
    await startJob();
    expect(screen.getByText(/Brak zdarzeń/)).toBeInTheDocument();
  });

  it("dziennik pokazuje godzinę, numer wpisu i treść zdarzenia", async () => {
    // Bez numeru wpisu nie da się dojść, który import się nie powiódł.
    await startJob(
      job({
        log: [{ ts: "2026-08-19T07:15:42.000Z", level: "error", msg: "brak obrazka", wp_id: 101 }],
      }),
    );
    const wpis = screen.getByText(/brak obrazka/).closest("div") as HTMLElement;

    expect(wpis.textContent).toContain("07:15:42");
    expect(wpis.textContent).toContain("#101");
  });
});

describe("import z WP - sklejenie trasy i język", () => {
  it("ma tytuł karty", () => {
    const head = (Route as AnyRoute).options.head as () => { meta: Record<string, unknown>[] };
    expect(head().meta).toContainEqual({ title: "Import z WordPress.com" });
  });

  it("prowadzi z powrotem do listy wpisów", async () => {
    // Import to ślepa uliczka bez drogi powrotnej do treści.
    await setup();
    expect(screen.getAllByRole("link")[0]).toHaveAttribute("href", "/admin/posts");
  });

  it("angielski interfejs nie pokazuje polskich napisów", async () => {
    // Ten ekran ma własny słownik inline - łatwo dopisać tylko jedną wersję.
    h.language = "en";
    await setup();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Import from WordPress.com");
    expect(screen.getByRole("button", { name: /^Preview$/ })).toBeInTheDocument();
  });
});
