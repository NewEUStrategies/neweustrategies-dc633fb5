// Widget „Podgląd Google Index" (URL Inspection API z Google Search Console).
//
// CO TEN PLIK DOWODZI:
//   1. WIDGET NIE PYTA GOOGLE Z WŁASNEJ INICJATYWY. Po wczytaniu listy
//      właściwości stoi na podpowiedzi `admin.seo.gsc.hint` i `inspectGscUrl`
//      ma ZERO wywołań - inspekcja to płatny, limitowany zasób dostawcy, więc
//      auto-strzał przy każdym wejściu do panelu wypaliłby dobową kwotę.
//   2. KAŻDY STAN BRAKU MA WŁASNY, ODRĘBNY KOMUNIKAT: ładowanie listy
//      (`loading`), brak konfiguracji connectora (`notConfigured`) i brak
//      zweryfikowanych właściwości (`noSites`). Przy braku konfiguracji
//      degradacja jest JAWNA - nie ma ani selecta, ani przycisku inspekcji,
//      czyli redakcja nie klika w martwy przycisk i nie czeka na wynik,
//      którego nigdy nie będzie.
//   3. ODCZYT ODPOWIEDZI GOOGLE: wszystkie cztery ramiona `VerdictBadge`
//      (PASS / PARTIAL / FAIL / neutral, z małym rejestrem włącznie, bo kod
//      robi `toUpperCase()`), `coverageState` jako detal wiersza indeksowania,
//      pierwszy problem mobilny, złączone typy rich-results wraz z gałęzią
//      `|| undefined` (pusta lista i puste `richResultType`), data ostatniego
//      crawla i link do GSC.
//   4. SKŁADANIE ADRESU INSPEKCJI (`normalizeSiteBase` + prefiks języka).
//      Właściwość domenowa `sc-domain:` staje się `https://…/`, adres bez
//      slasha dostaje slash, adres ze slashem NIE dostaje drugiego, a ścieżka
//      z wiodącym slashem nie daje `//`. Zły adres to nie literówka na ekranie:
//      GSC odpowiada wtedy o INNYM URL-u niż ten, który redakcja diagnozuje.
//      Funkcja nie jest eksportowana, więc jest przypięta przez wyświetlany
//      adres i przez argument wywołania server fn.
//   5. `languageCode` idzie do API zgodnie z językiem podglądu (pl-PL / en-US).
//   6. BŁĘDY NIE ZAWIESZAJĄ WIDGETU: błąd inspekcji trafia do `toastError`,
//      `running` wraca do false (przycisk znów aktywny, spinnera nie ma),
//      a wyczerpany limit dostawcy dostaje TEN SAM obiekt błędu i NIE zeruje
//      poprzedniego wyniku - operator nie traci odczytu, który dopiero zdobył.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   * NIE dotyka warstwy serwerowej `gsc.functions` (gateway, nagłówki,
//     `GSC_NOT_CONFIGURED`, rola admina) - `listGscSites`/`inspectGscUrl` są
//     tu atrapami. To kontrakt server fn, nie widgetu; ŻADNE wywołanie nie
//     wychodzi do sieci.
//   * NIE dubluje bramki autoryzacyjnej panelu SEO: to jest dokładnie zakres
//     e2e `e2e/seo.spec.ts` -> test „/admin/seo is auth-gated (redirects to
//     /auth or /login)". Ten plik zakłada, że admin JEST już w panelu, i pyta
//     wyłącznie o zachowanie widgetu.
//   * NIE dubluje żadnego z pozostałych 14 testów `e2e/seo.spec.ts` - tamte
//     stoją na trasach publicznych (sitemapy, robots.txt, llms.txt, kanały RSS,
//     JSON-LD, kontrakt <head>), a widget inspekcji nie ma tam powierzchni.
//   * NIE sprawdza otwierania listy Radixa jako takiego - tu interesuje nas
//     tylko skutek wyboru właściwości, czyli przeliczony adres inspekcji.
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import type { GscSite } from "@/lib/analytics/gsc.functions";

// Stała data crawla - test nie może zależeć od zegara. Sam NAPIS daty zależy
// od locale runtime'u (`toLocaleString`), więc asercje dotyczą klucza i faktu
// wyrenderowania czegokolwiek po nim, nie sformatowanego tekstu.
const CRAWL_ISO = "2026-02-03T10:15:00Z";

interface ListResponse {
  sites: GscSite[];
  configured: boolean;
}

interface InspectInput {
  data: { siteUrl: string; inspectionUrl: string; languageCode: string };
}

interface InspectResponse {
  raw: string;
}

/** Kształt odpowiedzi URL Inspection API, który widget faktycznie czyta. */
interface InspectionPayload {
  inspectionResult?: {
    indexStatusResult?: {
      verdict?: string;
      coverageState?: string;
      lastCrawlTime?: string;
    };
    mobileUsabilityResult?: {
      verdict?: string;
      issues?: Array<{ severity?: string; message?: string }>;
    };
    richResultsResult?: {
      verdict?: string;
      detectedItems?: Array<{ richResultType?: string; items?: unknown[] }>;
    };
    inspectionResultLink?: string;
  };
}

const h = vi.hoisted(() => ({
  list: null as Mock<() => Promise<ListResponse>> | null,
  inspect: null as Mock<(input: InspectInput) => Promise<InspectResponse>> | null,
  toastSuccess: null as Mock<(message: string) => void> | null,
  toastError: null as Mock<(e: unknown) => void> | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

// Mock CZĘŚCIOWY: podmieniamy WYŁĄCZNIE `useServerFn` na tożsamość, żeby
// wywołanie szło prosto do atrapy. Reszta modułu musi zostać - warstwa i18n
// ciągnie stąd `createIsomorphicFn`.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@/lib/analytics/gsc.functions", async () => {
  const { vi: v } = await import("vitest");
  h.list = v.fn<() => Promise<ListResponse>>(async () => ({ sites: [], configured: true }));
  h.inspect = v.fn<(input: InspectInput) => Promise<InspectResponse>>(async () => ({ raw: "{}" }));
  return { listGscSites: h.list, inspectGscUrl: h.inspect };
});

vi.mock("sonner", async () => {
  const { vi: v } = await import("vitest");
  h.toastSuccess = v.fn<(message: string) => void>();
  return { toast: { success: h.toastSuccess, error: v.fn() }, Toaster: () => null };
});

vi.mock("@/lib/toastError", async () => {
  const { vi: v } = await import("vitest");
  h.toastError = v.fn<(e: unknown) => void>();
  return { toastError: h.toastError };
});

import { UrlInspectionWidget } from "@/components/admin/seo/UrlInspectionWidget";

function listMock(): Mock<() => Promise<ListResponse>> {
  if (!h.list) throw new Error("atrapa listGscSites nie została ustawiona");
  return h.list;
}

function inspectMock(): Mock<(input: InspectInput) => Promise<InspectResponse>> {
  if (!h.inspect) throw new Error("atrapa inspectGscUrl nie została ustawiona");
  return h.inspect;
}

function toastSuccessMock(): Mock<(message: string) => void> {
  if (!h.toastSuccess) throw new Error("atrapa toast.success nie została ustawiona");
  return h.toastSuccess;
}

function toastErrorMock(): Mock<(e: unknown) => void> {
  if (!h.toastError) throw new Error("atrapa toastError nie została ustawiona");
  return h.toastError;
}

/** Sterowana obietnica - zamiast `setTimeout` do zatrzymania stanu w połowie. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function site(siteUrl: string): GscSite {
  return { siteUrl, permissionLevel: "siteOwner" };
}

function givenSites(sites: GscSite[], configured = true): void {
  listMock().mockImplementation(async () => ({ sites, configured }));
}

function givenInspection(payload: InspectionPayload): void {
  inspectMock().mockImplementation(async () => ({ raw: JSON.stringify(payload) }));
}

/** Wynik „zaindeksowana" - baza, którą testy nadpisują punktowo. */
function indexedPayload(overrides: InspectionPayload = {}): InspectionPayload {
  return {
    inspectionResult: {
      indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed" },
      mobileUsabilityResult: { verdict: "PASS" },
      richResultsResult: { verdict: "PASS" },
      ...overrides.inspectionResult,
    },
  };
}

function inspectButton(): HTMLElement {
  return screen.getByRole("button", { name: /admin\.seo\.gsc\.inspect$/ });
}

/** Cały wiersz `Row` (etykieta + detal + plakietka) jako tekst. */
function row(label: string): HTMLElement {
  const cell = screen.getByText(label);
  const parent = cell.parentElement;
  if (!parent) throw new Error(`wiersz „${label}" nie ma elementu nadrzędnego`);
  return parent;
}

function rowDetail(label: string): string | null {
  return row(label).querySelector("[title]")?.getAttribute("title") ?? null;
}

async function renderReady(
  props: { path: string; lang?: "pl" | "en" } = { path: "analizy/example" },
): Promise<{ container: HTMLElement }> {
  const { container } = renderWithQueryClient(<UrlInspectionWidget {...props} />);
  await waitFor(() => expect(screen.getByText("admin.seo.gsc.widgetTitle")).toBeInTheDocument());
  return { container };
}

async function runInspection(): Promise<void> {
  fireEvent.click(inspectButton());
  await waitFor(() => expect(screen.getByText("admin.seo.gsc.indexing")).toBeInTheDocument());
}

beforeEach(() => {
  listMock().mockClear();
  inspectMock().mockClear();
  toastSuccessMock().mockClear();
  toastErrorMock().mockClear();
  givenSites([site("https://example.com")]);
  givenInspection(indexedPayload());
});

describe("UrlInspectionWidget - stany listy właściwości", () => {
  it("pokazuje klucz ładowania, dopóki lista właściwości nie wróci", async () => {
    // Obietnica NIE jest nigdy rozwiązywana - zapytanie zostaje w `isLoading`
    // bez udziału zegara.
    const gate = deferred<ListResponse>();
    listMock().mockImplementation(() => gate.promise);

    const { container } = renderWithQueryClient(<UrlInspectionWidget path="analizy/example" />);

    expect(await screen.findByText("admin.seo.gsc.loading")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("admin.seo.gsc.widgetTitle")).not.toBeInTheDocument();
    expect(inspectMock()).not.toHaveBeenCalled();
    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("brak konfiguracji connectora degraduje JAWNIE: sam komunikat, bez selecta i bez przycisku", async () => {
    givenSites([], false);

    const { container } = renderWithQueryClient(<UrlInspectionWidget path="analizy/example" />);

    expect(await screen.findByText("admin.seo.gsc.notConfigured")).toBeInTheDocument();
    // Degradacja jawna: nie ma czym kliknąć i nie ma czego wybrać.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("admin.seo.gsc.noSites")).not.toBeInTheDocument();
    expect(inspectMock()).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("brak zweryfikowanych właściwości daje komunikat ODRĘBNY od braku konfiguracji", async () => {
    givenSites([], true);

    const { container } = renderWithQueryClient(<UrlInspectionWidget path="analizy/example" />);

    expect(await screen.findByText("admin.seo.gsc.noSites")).toBeInTheDocument();
    // Dwa różne powody braku wyniku muszą mieć dwa różne komunikaty: „nie
    // podłączono GSC" naprawia admin platformy, „brak właściwości" - właściciel
    // domeny w GSC. Zlanie ich w jeden napis wysyła ludzi w złą stronę.
    expect(screen.queryByText("admin.seo.gsc.notConfigured")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("błąd odczytu listy właściwości też degraduje do komunikatu, a nie do pustego widgetu", async () => {
    listMock().mockImplementation(async () => {
      throw new Error("GSC 503: gateway down");
    });

    renderWithQueryClient(<UrlInspectionWidget path="analizy/example" />);

    expect(await screen.findByText("admin.seo.gsc.noSites")).toBeInTheDocument();
    expect(inspectMock()).not.toHaveBeenCalled();
  });
});

describe("UrlInspectionWidget - stan „nie sprawdzano”", () => {
  it("po wczytaniu listy pokazuje podpowiedź i NIE woła inspekcji sam z siebie", async () => {
    await renderReady();

    expect(screen.getByText("admin.seo.gsc.hint")).toBeInTheDocument();
    // Kluczowa asercja tego pliku: inspekcja jest limitowanym zasobem Google,
    // widget rusza wyłącznie na kliknięcie.
    expect(inspectMock()).not.toHaveBeenCalled();
    // Adres do sprawdzenia jest widoczny JESZCZE PRZED odpytaniem - redakcja
    // ma szansę zauważyć, że diagnozuje nie tę stronę.
    expect(screen.getByText("https://example.com/analizy/example")).toBeInTheDocument();
    expect(screen.queryByText("admin.seo.gsc.indexing")).not.toBeInTheDocument();
    expect(inspectButton()).toBeEnabled();
  });
});

describe("UrlInspectionWidget - odczyt odpowiedzi Google", () => {
  it("odpowiedź ZAINDEKSOWANA: plakietka PASS, wiersz indeksowania, coverageState jako detal i toast sukcesu", async () => {
    await renderReady();
    await runInspection();

    expect(row("admin.seo.gsc.indexing").textContent).toContain("admin.seo.gsc.verdict.pass");
    expect(rowDetail("admin.seo.gsc.indexing")).toBe("Submitted and indexed");
    expect(toastSuccessMock()).toHaveBeenCalledWith("admin.seo.gsc.inspectDone");
    expect(screen.queryByText("admin.seo.gsc.hint")).not.toBeInTheDocument();
    expect(toastErrorMock()).not.toHaveBeenCalled();
  });

  it("odpowiedź WYKLUCZONA: plakietka FAIL na wierszu indeksowania", async () => {
    givenInspection({
      inspectionResult: {
        indexStatusResult: { verdict: "FAIL", coverageState: "Excluded by ‘noindex’ tag" },
      },
    });
    await renderReady();
    await runInspection();

    expect(row("admin.seo.gsc.indexing").textContent).toContain("admin.seo.gsc.verdict.fail");
    expect(rowDetail("admin.seo.gsc.indexing")).toBe("Excluded by ‘noindex’ tag");
  });

  // Wszystkie cztery ramiona `VerdictBadge` w jednej tabeli. Mały rejestr
  // („pass") jest przypięty ŚWIADOMIE: kod robi `toUpperCase()`, a API Google
  // zwraca wielkie litery - gdyby ktoś usunął normalizację, dokładnie ten
  // wiersz zapali się jako neutralny i nikt inny tego nie złapie.
  it.each([
    { verdict: "PASS", expected: "admin.seo.gsc.verdict.pass" },
    { verdict: "pass", expected: "admin.seo.gsc.verdict.pass" },
    { verdict: "PARTIAL", expected: "admin.seo.gsc.verdict.partial" },
    { verdict: "FAIL", expected: "admin.seo.gsc.verdict.fail" },
    { verdict: "NEUTRAL", expected: "admin.seo.gsc.verdict.neutral" },
    { verdict: "VERDICT_UNSPECIFIED", expected: "admin.seo.gsc.verdict.neutral" },
    { verdict: "", expected: "admin.seo.gsc.verdict.neutral" },
    { verdict: undefined, expected: "admin.seo.gsc.verdict.neutral" },
  ])(
    "verdict $verdict daje plakietkę $expected",
    async ({ verdict, expected }: { verdict: string | undefined; expected: string }) => {
      givenInspection({ inspectionResult: { indexStatusResult: { verdict } } });
      await renderReady();
      await runInspection();

      const indexing = row("admin.seo.gsc.indexing").textContent ?? "";
      expect(indexing).toContain(expected);
      const others = [
        "admin.seo.gsc.verdict.pass",
        "admin.seo.gsc.verdict.partial",
        "admin.seo.gsc.verdict.fail",
        "admin.seo.gsc.verdict.neutral",
      ].filter((key) => key !== expected);
      for (const key of others) expect(indexing).not.toContain(key);
    },
  );

  it("detale mobile i rich-results: pierwszy problem mobilny i ZŁĄCZONE typy rich-results", async () => {
    givenInspection({
      inspectionResult: {
        indexStatusResult: { verdict: "PASS" },
        mobileUsabilityResult: {
          verdict: "FAIL",
          issues: [
            { severity: "ERROR", message: "Text too small to read" },
            { severity: "ERROR", message: "Clickable elements too close together" },
          ],
        },
        richResultsResult: {
          verdict: "PARTIAL",
          detectedItems: [
            { richResultType: "Article", items: [{}] },
            { richResultType: "Breadcrumbs", items: [] },
          ],
        },
      },
    });
    await renderReady();
    await runInspection();

    // Pokazywany jest PIERWSZY problem - wiersz ma jedną linię, nie listę.
    expect(rowDetail("admin.seo.gsc.mobile")).toBe("Text too small to read");
    expect(row("admin.seo.gsc.mobile").textContent).toContain("admin.seo.gsc.verdict.fail");
    expect(rowDetail("admin.seo.gsc.richResults")).toBe("Article, Breadcrumbs");
    expect(row("admin.seo.gsc.richResults").textContent).toContain("admin.seo.gsc.verdict.partial");
  });

  // Gałąź `|| undefined` po `join(", ")`: pusty napis NIE MOŻE wjechać do
  // atrybutu `title` jako puste dymek-nic.
  it.each([
    { nazwa: "brak pola detectedItems", detectedItems: undefined },
    { nazwa: "pusta lista detectedItems", detectedItems: [] },
    {
      nazwa: "wszystkie richResultType puste",
      detectedItems: [{ richResultType: "" }, { items: [{}] }],
    },
  ])(
    "rich-results bez typów nie renderuje detalu ($nazwa)",
    async ({
      detectedItems,
    }: {
      detectedItems?: Array<{ richResultType?: string; items?: unknown[] }>;
    }) => {
      givenInspection({
        inspectionResult: {
          indexStatusResult: { verdict: "PASS" },
          richResultsResult: { verdict: "NEUTRAL", detectedItems },
        },
      });
      await renderReady();
      await runInspection();

      expect(rowDetail("admin.seo.gsc.richResults")).toBeNull();
      expect(row("admin.seo.gsc.richResults").textContent).toContain(
        "admin.seo.gsc.verdict.neutral",
      );
    },
  );

  // Oba języki, bo formatowanie daty wybiera locale (`pl-PL` / `en-GB`).
  it.each([{ lang: "pl" as const }, { lang: "en" as const }])(
    "lastCrawlTime obecny renderuje wiersz z kluczem i sformatowaną datą (język $lang)",
    async ({ lang }) => {
      givenInspection({
        inspectionResult: {
          indexStatusResult: { verdict: "PASS", lastCrawlTime: CRAWL_ISO },
        },
      });
      const { container } = await renderReady({ path: "analizy/example", lang });
      await runInspection();

      // Sam NAPIS daty zależy od locale runtime'u, więc asercja pilnuje klucza
      // i faktu, że po nim faktycznie coś stoi (a nie „Invalid Date"/pustka).
      const crawl = Array.from(container.querySelectorAll("p")).find((p) =>
        (p.textContent ?? "").includes("admin.seo.gsc.lastCrawl"),
      );
      expect(crawl).toBeDefined();
      expect(crawl?.textContent ?? "").toMatch(/^admin\.seo\.gsc\.lastCrawl:\s.*2026/);
    },
  );

  it("brak lastCrawlTime nie renderuje wiersza o ostatnim crawlu", async () => {
    givenInspection({ inspectionResult: { indexStatusResult: { verdict: "PASS" } } });
    const { container } = await renderReady();
    await runInspection();

    expect(container.textContent ?? "").not.toContain("admin.seo.gsc.lastCrawl");
  });

  it("inspectionResultLink obecny daje link do GSC otwierany w nowej karcie", async () => {
    givenInspection({
      inspectionResult: {
        indexStatusResult: { verdict: "PASS" },
        inspectionResultLink: "https://search.google.com/search-console/inspect?resource_id=x",
      },
    });
    await renderReady();
    await runInspection();

    const link = screen.getByRole("link", { name: /admin\.seo\.gsc\.openInGsc/ });
    expect(link).toHaveAttribute(
      "href",
      "https://search.google.com/search-console/inspect?resource_id=x",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("brak inspectionResultLink nie renderuje żadnego linku", async () => {
    givenInspection({ inspectionResult: { indexStatusResult: { verdict: "PASS" } } });
    await renderReady();
    await runInspection();

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText("admin.seo.gsc.openInGsc")).not.toBeInTheDocument();
  });
});

describe("UrlInspectionWidget - składanie adresu inspekcji", () => {
  // `normalizeSiteBase` nie jest eksportowana, więc jest przypięta przez to,
  // co widget POKAZUJE, i przez to, co WYSYŁA do server fn - czyli przez
  // dokładnie te dwa miejsca, w których zły adres robi szkodę.
  it.each([
    {
      nazwa: "właściwość domenowa sc-domain",
      siteUrl: "sc-domain:example.com",
      path: "analizy/example",
      lang: "pl" as const,
      expected: "https://example.com/analizy/example",
    },
    {
      nazwa: "sc-domain z nadmiarowym slashem na końcu",
      siteUrl: "sc-domain:example.com/",
      path: "analizy/example",
      lang: "pl" as const,
      expected: "https://example.com/analizy/example",
    },
    {
      nazwa: "właściwość URL bez slasha na końcu",
      siteUrl: "https://example.com",
      path: "analizy/example",
      lang: "pl" as const,
      expected: "https://example.com/analizy/example",
    },
    {
      nazwa: "właściwość URL ze slashem na końcu (bez podwojenia)",
      siteUrl: "https://example.com/",
      path: "analizy/example",
      lang: "pl" as const,
      expected: "https://example.com/analizy/example",
    },
    {
      nazwa: "ścieżka z wiodącym slashem (bez podwójnego slasha)",
      siteUrl: "https://example.com",
      path: "/analizy/example",
      lang: "pl" as const,
      expected: "https://example.com/analizy/example",
    },
    {
      nazwa: "język en wstawia prefiks en/",
      siteUrl: "https://example.com",
      path: "analizy/example",
      lang: "en" as const,
      expected: "https://example.com/en/analizy/example",
    },
    {
      nazwa: "sc-domain + wiodący slash + prefiks en/",
      siteUrl: "sc-domain:example.com",
      path: "/analizy/example",
      lang: "en" as const,
      expected: "https://example.com/en/analizy/example",
    },
    {
      nazwa: "podstrona w podkatalogu właściwości",
      siteUrl: "https://example.com/blog",
      path: "wpis",
      lang: "pl" as const,
      expected: "https://example.com/blog/wpis",
    },
  ])(
    "$nazwa -> $expected",
    async ({
      siteUrl,
      path,
      lang,
      expected,
    }: {
      siteUrl: string;
      path: string;
      lang: "pl" | "en";
      expected: string;
    }) => {
      givenSites([site(siteUrl)]);
      await renderReady({ path, lang });

      expect(screen.getByText(expected)).toBeInTheDocument();

      fireEvent.click(inspectButton());
      await waitFor(() => expect(inspectMock()).toHaveBeenCalledTimes(1));
      expect(inspectMock().mock.calls[0][0].data.inspectionUrl).toBe(expected);
      expect(inspectMock().mock.calls[0][0].data.siteUrl).toBe(siteUrl);
    },
  );

  it.each([
    { lang: "pl" as const, languageCode: "pl-PL" },
    { lang: "en" as const, languageCode: "en-US" },
  ])("język $lang wysyła languageCode $languageCode", async ({ lang, languageCode }) => {
    await renderReady({ path: "analizy/example", lang });

    fireEvent.click(inspectButton());
    await waitFor(() => expect(inspectMock()).toHaveBeenCalledTimes(1));
    expect(inspectMock()).toHaveBeenCalledWith({
      data: {
        siteUrl: "https://example.com",
        inspectionUrl:
          lang === "en"
            ? "https://example.com/en/analizy/example"
            : "https://example.com/analizy/example",
        languageCode,
      },
    });
  });

  it("wybór innej właściwości przelicza adres inspekcji i to ON idzie do API", async () => {
    givenSites([site("https://example.com"), site("sc-domain:inna.example")]);
    await renderReady({ path: "analizy/example" });

    // Domyślnie pierwsza właściwość z listy.
    expect(screen.getByText("https://example.com/analizy/example")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    fireEvent.click(screen.getByRole("option", { name: "sc-domain:inna.example" }));

    await waitFor(() =>
      expect(screen.getByText("https://inna.example/analizy/example")).toBeInTheDocument(),
    );

    fireEvent.click(inspectButton());
    await waitFor(() => expect(inspectMock()).toHaveBeenCalledTimes(1));
    expect(inspectMock().mock.calls[0][0].data).toMatchObject({
      siteUrl: "sc-domain:inna.example",
      inspectionUrl: "https://inna.example/analizy/example",
    });
  });
});

describe("UrlInspectionWidget - błędy inspekcji", () => {
  it("błąd inspekcji trafia do toastError i ODWIESZA przycisk (bez zawieszonego spinnera)", async () => {
    const gate = deferred<InspectResponse>();
    inspectMock().mockImplementation(() => gate.promise);
    const { container } = await renderReady();

    fireEvent.click(inspectButton());

    // Stan „w toku": przycisk zablokowany, spinner widoczny.
    await waitFor(() => expect(inspectButton()).toBeDisabled());
    expect(container.querySelector(".animate-spin")).not.toBeNull();

    gate.reject(new Error("GSC 500: internal"));

    await waitFor(() => expect(toastErrorMock()).toHaveBeenCalledTimes(1));
    // `running` MUSI wrócić do false także na ścieżce błędu - inaczej widget
    // zostaje z wiecznym spinnerem i redakcja nie może ponowić próby.
    await waitFor(() => expect(inspectButton()).toBeEnabled());
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(toastSuccessMock()).not.toHaveBeenCalled();
    expect(screen.getByText("admin.seo.gsc.hint")).toBeInTheDocument();
  });

  it("wyczerpany limit dostawcy: toastError dostaje TEN błąd, a poprzedni wynik zostaje na ekranie", async () => {
    givenInspection(
      indexedPayload({
        inspectionResult: {
          indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed" },
        },
      }),
    );
    await renderReady();
    await runInspection();
    expect(rowDetail("admin.seo.gsc.indexing")).toBe("Submitted and indexed");

    const quota = new Error("RESOURCE_EXHAUSTED: quota exceeded");
    inspectMock().mockImplementation(async () => {
      throw quota;
    });

    fireEvent.click(inspectButton());
    await waitFor(() => expect(toastErrorMock()).toHaveBeenCalledTimes(1));

    // Do mapera trafia DOKŁADNIE ten obiekt błędu - inaczej komunikat o limicie
    // dostawcy zamienia się w bezużyteczne „coś poszło nie tak".
    expect(toastErrorMock()).toHaveBeenCalledWith(quota);
    // Poprzedni odczyt NIE jest zerowany: nieudane ponowienie nie może zabrać
    // operatorowi wyniku, na który wydał już jedno zapytanie z limitu.
    expect(rowDetail("admin.seo.gsc.indexing")).toBe("Submitted and indexed");
    expect(row("admin.seo.gsc.indexing").textContent).toContain("admin.seo.gsc.verdict.pass");
    expect(screen.queryByText("admin.seo.gsc.hint")).not.toBeInTheDocument();
    expect(inspectButton()).toBeEnabled();
  });
});

describe("UrlInspectionWidget - dostępność", () => {
  it("widok z wynikiem nie ma innych naruszeń axe niż nazwa przełącznika właściwości", async () => {
    givenInspection(
      indexedPayload({
        inspectionResult: {
          indexStatusResult: { verdict: "PASS", lastCrawlTime: CRAWL_ISO },
          inspectionResultLink: "https://search.google.com/search-console/inspect?resource_id=x",
        },
      }),
    );
    const { container } = await renderReady();
    await runInspection();

    // `select-name`/`button-name` na przełączniku właściwości jest osobnym,
    // udokumentowanym niżej defektem - tu pilnujemy, że nie ma NIC INNEGO
    // (nazwy przycisku i linku, kolejność nagłówków, poprawność ARIA).
    const violations = await axeViolations(container, { "button-name": { enabled: false } });
    expect(summarize(violations)).toBe("");
  });

  it.fails(
    "defekt: przełącznik właściwości GSC nie ma dostępnej nazwy (axe: button-name)",
    async () => {
      // KONSEKWENCJA: `SelectTrigger` renderuje `role=\"combobox\"`, a ta rola
      // NIE bierze nazwy z treści, więc czytnik ekranu ogłasza „pole listy"
      // bez informacji, CZEGO dotyczy wybór - operator na czytniku nie wie,
      // że przełącza właściwość Search Console, i może odpalić inspekcję dla
      // złej domeny. Naprawa to jedna linia w produkcji: `aria-label` (albo
      // powiązana etykieta) na `SelectTrigger`. Do tego czasu ten zapis trzyma
      // fakt na widoku - bez zmieniania zachowania produkcyjnego pod test.
      const { container } = await renderReady();
      expect(await axeViolations(container)).toEqual([]);
    },
  );
});
