// ORGANIZM `SeoPanel` - sklejenie całego panelu SEO wpisu/strony.
//
// CO TEN PLIK DOWODZI (rzeczy, których żaden test jednostkowy warstwy niżej
// dowieść nie może, bo są kontraktem SKLEJENIA):
//   1. ZAKŁADKA STARTOWA IDZIE ZA JĘZYKIEM PANELU. Redaktor pracujący po
//      angielsku ma dostać sekcję EN od razu; wpadnięcie na PL znaczy edycję
//      niewłaściwego języka bez żadnego ostrzeżenia.
//   2. `onIssuesChange` EMITUJE ZMIANĘ ZESTAWU UWAG, A NIE KAŻDY RENDER.
//      Handler zapisu w edytorze trzyma na tym stan preflightu; emisja przy
//      każdym renderze (a panel renderuje się na każde uderzenie w klawiaturę)
//      to pętla setState w rodzicu. Dlatego liczba wywołań jest PRZYPIĘTA.
//   3. ŚCIEŻKA W PODGLĄDZIE JEST POCHODNĄ RPC `page_full_path`, a przy braku
//      strony źródłowej zapytanie NIE LECI (`enabled: false`) - panel wpisu bez
//      rodzica pokazuje `…`, a nie zmyśloną ścieżkę i nie bije w bazę.
//   4. ŁAŃCUCH OBRAZU SPOŁECZNOŚCIOWEGO (nadpisanie -> okładka -> karta ->
//      domyślna) jest tym samym łańcuchem, co w `<head>`, a etykieta źródła
//      mówi redakcji, KTÓRE ogniwo wygrało.
//   5. GENERATOR KARTY OG: wybór tytułu (nadpisanie zakładki -> tytuł tej
//      zakładki -> tytuł drugiego języka), zakaz generowania bez tytułu oraz
//      obie drogi wyjścia (sukces -> `onChange` + toast, błąd -> `toastError`
//      i przycisk znów aktywny). ZERO prawdziwego canvasu i ZERO uploadu.
//   6. `noindex`, kanoniczny URL i nadpisanie karty OG normalizują wejście do
//      `null` (puste/spacje), bo w bazie te kolumny są nullable i "  " jest
//      wartością, która przechodzi do `<link rel=canonical>`.
//   7. Uwagi o nagłówkach: drzewo bloków wygrywa nad HTML, a `rendersTitleAsH1`
//      znaczy, że H1 w treści jest DUPLIKATEM (layout rysuje własny H1) i że
//      hierarchię liczy się OD tego H1 (treść od H3 to przeskok 1 -> 3).
//      Język bez nagłówków trafia do podsumowania jako "nie sprawdzono", a
//      skan idzie per język i po NAPISACH (rodzic podaje nowy obiekt
//      `contentHtml` przy każdym renderze - skan nie może iść za nim).
//      Język BEZ ŻADNEJ treści (brak tłumaczenia EN) nie jest "niesprawdzony" -
//      chyba że żaden język nie ma treści (świeży szkic).
//   8. Przełącznik noindex ma dostępną nazwę z widocznej etykiety (axe czysty).
//   9. HOST W PODGLĄDZIE GOOGLE jest hostem TENANTA (`useTenantPublicOrigin`),
//      nie stałym hostem marki - tenant na własnej domenie widzi swój adres.
//  10. Walidacja snippetów liczy się po POLACH, które czyta `validateSeoPanel`,
//      a nie po obiekcie `value` (rodzic podaje nowy literał przy każdym
//      renderze); zestaw czytanych pól jest PRZYPIĘTY, żeby lista zależności
//      memo nie rozjechała się z walidatorem.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   - `RobotsTxtPreview.test.tsx` - polityka robots.txt (inna powierzchnia).
//   - Jednostki czyste: `lib/seo/fields`, `lib/seo/settings`, `lib/seo/serp`,
//     `lib/seo/validation`, `lib/seo/headingValidation`, `metaDescription` mają
//     własne testy tabelaryczne; tu sprawdzam wyłącznie, czy panel woła je z
//     WŁAŚCIWYMI argumentami (np. flagą `titleIsOverride`).
//   - Molekuły `SerpPreview`, `SeoTextField`, `SeoValidationSummary`, `SerpMeter`,
//     `CharCounter`, `SeverityBadge` - ich wygląd i ARIA to ich własne testy.
//   - `ImageSlot` i `UrlInspectionWidget` są ATRAPAMI (mają własnych właścicieli);
//     atrapy potwierdzają wyłącznie PRZEKAZANE PROPY.
//   - E2E `e2e/seo.spec.ts`: tamten plik dotyka wyłącznie powierzchni
//     PUBLICZNYCH i bramki auth - w szczególności testy
//     "/admin/seo is auth-gated (redirects to /auth or /login)" (jedyny test
//     e2e wchodzący w /admin, i to bez sesji, więc panelu nie renderuje),
//     "head contract on /" (kontrakt <head> na produkcyjnej trasie) oraz
//     "robots.txt comes from the ROUTE, not a static file in public/".
//     Panel SEO edytora nie jest tam montowany ANI RAZU, więc nic tu nie
//     dubluje e2e; odwrotnie też nie - żadna asercja poniżej nie dotyczy HTTP.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import { SITE_CANONICAL_ORIGIN, SITE_NAME } from "@/lib/seo/meta";
import { CANONICAL_SITE_ORIGIN } from "@/lib/http/host";
import type { SeoIssue } from "@/lib/seo/validation";
import type { SeoPanelValue } from "@/components/admin/seo/SeoPanel";

/** Propy, które panel przekazuje atrapie `ImageSlot` (nadpisanie karty OG). */
interface ImageSlotProbeProps {
  label: string;
  hint?: string;
  value: string;
  folder?: string;
  onChange: (value: string) => void;
}

/** Propy, które panel przekazuje atrapie `UrlInspectionWidget`. */
interface UrlInspectionProbeProps {
  path: string;
  lang?: "pl" | "en";
}

/** Wejście generatora karty OG - kontrakt `generateAndUploadOgCard`. */
interface OgCardProbeInput {
  title: string;
  kicker: string | null;
  siteName: string;
}

const h = vi.hoisted(() => ({
  /** Język panelu (czytany getterem, jak realna instancja i18next). */
  language: "pl",
  /** Surowa odpowiedź RPC `page_full_path` - celowo `unknown`. */
  pageFullPath: "blog" as unknown,
  rpc: vi.fn<(fn: string, params: Record<string, unknown>) => Promise<{ data: unknown }>>(),
  generateOgCard:
    vi.fn<(kind: "post" | "page", id: string, input: OgCardProbeInput) => Promise<string>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastErrorToast: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(error: unknown) => void>(),
  imageSlot: null as ImageSlotProbeProps | null,
  inspection: null as UrlInspectionProbeProps | null,
  /** Każde wywołanie skanera nagłówków: język i HTML, który dostał. */
  headingScans: [] as Array<{ lang: string; html: string | null | undefined }>,
  /** Origin zwracany przez `useTenantPublicOrigin` (null = tenant bez adresu publicznego). */
  tenantOrigin: "https://neweuropeanstrategies.com" as string | null,
  /** Liczba wywołań `validateSeoPanel` (dowód memoizacji po polach). */
  seoValidations: 0,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);

// Atrapa klienta: panel czyta z bazy DOKŁADNIE jedną rzecz - ścieżkę strony
// źródłowej przez RPC. `from()` celowo nie istnieje: gdyby panel kiedyś
// dorobił własny select, test wywali się od razu, zamiast cicho wyjść do sieci.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc } }));

// Ustawienia serwisu: zwracamy WARTOŚCI DOMYŚLNE (to tańsze niż atrapa
// łańcucha `site_settings` i to jest kontrakt, na którym stoi sufiks tytułu:
// `title_suffix_enabled: true` + pusty `title_suffix` => sufiks = nazwa marki).
vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: <T extends object>(_key: string, defaults: T): T => defaults,
}));

// Generator karty OG: ZERO canvasu, ZERO uploadu do Storage.
vi.mock("@/lib/seo/ogCardCanvas", () => ({ generateAndUploadOgCard: h.generateOgCard }));

vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastErrorToast },
  Toaster: () => null,
}));

vi.mock("@/lib/toastError", () => ({ toastError: h.toastError }));

// Skaner nagłówków zostaje PRAWDZIWY - podsłuchujemy tylko, ILE razy i z
// czym panel go woła (dowód memoizacji per język).
vi.mock("@/lib/seo/headingValidation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/seo/headingValidation")>();
  return {
    ...actual,
    analyzeHeadings: (...args: Parameters<typeof actual.analyzeHeadings>) => {
      h.headingScans.push({ lang: args[0], html: args[1].html });
      return actual.analyzeHeadings(...args);
    },
  };
});

// Walidator snippetów zostaje PRAWDZIWY - liczymy tylko wywołania.
vi.mock("@/lib/seo/validation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/seo/validation")>();
  return {
    ...actual,
    validateSeoPanel: (...args: Parameters<typeof actual.validateSeoPanel>) => {
      h.seoValidations += 1;
      return actual.validateSeoPanel(...args);
    },
  };
});

// Origin tenanta: atrapa HOOKA. Reguła originu i odczyt `tenants.domain` mają
// własne testy (`lib/seo/__tests__/tenantPublicOrigin.test.ts`,
// `useTenantPublicOrigin.test.tsx`); tu dowodzę tylko, że panel z nim jedzie.
vi.mock("@/lib/seo/useTenantPublicOrigin", () => ({
  useTenantPublicOrigin: () => h.tenantOrigin,
}));

// Atrapa `ImageSlot`: pole tekstowe zamiast całego uploadera - potwierdza
// przekazane propy i pozwala dowieść normalizacji wartości do `null`.
vi.mock("@/components/admin/ImageSlot", () => ({
  ImageSlot: (props: ImageSlotProbeProps) => {
    h.imageSlot = props;
    return (
      <label>
        {props.label}
        <input
          data-testid="og-override"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
      </label>
    );
  },
}));

vi.mock("@/components/admin/seo/UrlInspectionWidget", () => ({
  UrlInspectionWidget: (props: UrlInspectionProbeProps) => {
    h.inspection = props;
    return <div data-testid="url-inspection" data-path={props.path} data-lang={props.lang ?? ""} />;
  },
}));

import { SeoPanel } from "@/components/admin/seo/SeoPanel";

const EMPTY_VALUE: SeoPanelValue = {
  seo_title_pl: null,
  seo_title_en: null,
  seo_description_pl: null,
  seo_description_en: null,
  seo_canonical_url: null,
  seo_noindex: false,
  seo_og_image_url: null,
  og_image_generated_url: null,
};

interface PanelOverrides {
  value?: Partial<SeoPanelValue>;
  onChange?: (patch: Partial<SeoPanelValue>) => void;
  entity?: { kind: "post" | "page"; id: string };
  slug?: string;
  pathSourcePageId?: string | null;
  fallbackTitle?: { pl: string; en: string };
  fallbackDescription?: { pl: string | null; en: string | null };
  coverImageUrl?: string | null;
  ogKicker?: string | null;
  contentHtml?: { pl: string | null; en: string | null };
  contentBlocks?: unknown;
  onIssuesChange?: (issues: SeoIssue[]) => void;
}

function panel(o: PanelOverrides) {
  return (
    <SeoPanel
      value={{ ...EMPTY_VALUE, ...o.value }}
      onChange={o.onChange ?? (() => {})}
      entity={o.entity ?? { kind: "post", id: "post-1" }}
      slug={o.slug ?? "moj-wpis"}
      pathSourcePageId={o.pathSourcePageId === undefined ? "page-1" : o.pathSourcePageId}
      fallbackTitle={o.fallbackTitle ?? { pl: "Tytul PL", en: "Title EN" }}
      fallbackDescription={o.fallbackDescription ?? { pl: "Opis PL", en: "Description EN" }}
      coverImageUrl={o.coverImageUrl ?? null}
      ogKicker={o.ogKicker}
      contentHtml={o.contentHtml}
      contentBlocks={o.contentBlocks}
      onIssuesChange={o.onIssuesChange}
    />
  );
}

function renderPanel(o: PanelOverrides = {}) {
  const onChange = o.onChange ?? vi.fn<(patch: Partial<SeoPanelValue>) => void>();
  const rendered = renderWithQueryClient(panel({ ...o, onChange }));
  return {
    ...rendered,
    onChange,
    /** Ponowny render TEGO SAMEGO klienta zapytań - stan panelu zostaje. */
    rerenderPanel: (next: PanelOverrides) =>
      rendered.rerender(
        <QueryClientProvider client={rendered.queryClient}>{panel(next)}</QueryClientProvider>,
      ),
  };
}

/** Ścieżka przekazana widgetowi inspekcji URL - jedyne wyjście `previewPath`. */
const inspectionPath = () => h.inspection?.path;

/** Kontener podsumowania walidacji (panel ma też inne regiony `status`). */
const summaryBox = () =>
  screen.getByText("admin.seo.validation.ok").closest<HTMLElement>("[data-state]");

const generateButton = () => screen.getByRole("button", { name: "admin.seo.og.generate" });

/** Aktywna zakładka języka (Radix rozmontowuje nieaktywną sekcję). */
const activeTab = () =>
  screen
    .getAllByRole("tab")
    .filter((el) => el.getAttribute("data-state") === "active")
    .map((el) => el.textContent);

beforeEach(() => {
  h.language = "pl";
  h.pageFullPath = "blog";
  h.rpc.mockReset();
  h.rpc.mockImplementation(async () => ({ data: h.pageFullPath }));
  h.generateOgCard.mockReset();
  h.generateOgCard.mockResolvedValue("https://cdn.test/og/post-1.png");
  h.toastSuccess.mockReset();
  h.toastErrorToast.mockReset();
  h.toastError.mockReset();
  h.imageSlot = null;
  h.inspection = null;
  h.headingScans.length = 0;
  h.tenantOrigin = CANONICAL_SITE_ORIGIN;
  h.seoValidations = 0;
});

afterEach(cleanup);

describe("SeoPanel - zakładka startowa", () => {
  it("startuje na PL, gdy panel jedzie po polsku", async () => {
    renderPanel();
    expect(activeTab()).toEqual(["PL"]);
    // Sekcja PL renderuje podgląd z polskim fallbackiem, a nie angielskim.
    expect(screen.getByPlaceholderText("Tytul PL")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Title EN")).not.toBeInTheDocument();
    await waitFor(() => expect(inspectionPath()).toBe("blog/moj-wpis"));
    expect(h.inspection?.lang).toBe("pl");
  });

  it("startuje na EN, gdy panel jedzie po angielsku", async () => {
    h.language = "en";
    renderPanel();
    expect(activeTab()).toEqual(["EN"]);
    expect(screen.getByPlaceholderText("Title EN")).toBeInTheDocument();
    // Ścieżka widgetu jest BEZ prefiksu języka (prefiks dokłada tylko podgląd
    // SERP), więc inspekcja URL pyta Google o adres, który istnieje.
    await waitFor(() => expect(inspectionPath()).toBe("blog/moj-wpis"));
    expect(h.inspection?.lang).toBe("en");
  });

  it("nieznany kod języka traktuje jak polski (domyślna gałąź stanu)", () => {
    h.language = "de";
    renderPanel();
    expect(activeTab()).toEqual(["PL"]);
  });

  it("kliknięcie zakładki przełącza sekcję i prefiks języka w podglądzie", async () => {
    renderPanel();
    await waitFor(() => expect(inspectionPath()).toBe("blog/moj-wpis"));

    fireEvent.mouseDown(screen.getByRole("tab", { name: "EN" }));
    expect(activeTab()).toEqual(["EN"]);
    expect(screen.getByPlaceholderText("Title EN")).toBeInTheDocument();
    // Podgląd SERP sekcji EN pokazuje ścieżkę z prefiksem `en/`.
    expect(screen.getByText(/› en › blog › moj-wpis/)).toBeInTheDocument();
    await waitFor(() => expect(h.inspection?.lang).toBe("en"));

    fireEvent.mouseDown(screen.getByRole("tab", { name: "PL" }));
    expect(activeTab()).toEqual(["PL"]);
    expect(screen.getByText(/› blog › moj-wpis/)).toBeInTheDocument();
    await waitFor(() => expect(h.inspection?.lang).toBe("pl"));
  });
});

describe("SeoPanel - emisja uwag do rodzica", () => {
  /** Tytuł szerszy niż budżet 600 px Google (ostrzeżenie, nie błąd). */
  const LONG_TITLE = "a".repeat(80);

  it("woła onIssuesChange po ZMIANIE zestawu uwag i nie woła go ponownie bez zmiany", async () => {
    const onIssuesChange = vi.fn<(issues: SeoIssue[]) => void>();
    const onChange = vi.fn<(patch: Partial<SeoPanelValue>) => void>();
    const { rerenderPanel } = renderPanel({ onIssuesChange, onChange });

    await waitFor(() => expect(onIssuesChange).toHaveBeenCalledTimes(1));
    expect(onIssuesChange).toHaveBeenLastCalledWith([]);

    // Render z INNYM obiektem `value` (nowa referencja) i inną etykietą karty,
    // ale bez zmiany treści uwag: `issuesKey` się nie rusza => zero emisji.
    rerenderPanel({ onIssuesChange, onChange, ogKicker: "Analizy" });
    expect(onIssuesChange).toHaveBeenCalledTimes(1);

    // Dopiero zmiana zestawu uwag emituje nową migawkę.
    rerenderPanel({ onIssuesChange, onChange, value: { seo_title_pl: LONG_TITLE } });
    await waitFor(() => expect(onIssuesChange).toHaveBeenCalledTimes(2));
    expect(onIssuesChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ lang: "pl", kind: "title", severity: "warning", chars: 80 }),
    ]);

    // Powrót do stanu bez uwag to znowu zmiana zestawu - trzecia emisja.
    rerenderPanel({ onIssuesChange, onChange });
    await waitFor(() => expect(onIssuesChange).toHaveBeenCalledTimes(3));
    expect(onIssuesChange).toHaveBeenLastCalledWith([]);
  });

  it("pusty tytuł: fallback mieszczący się w budżecie, ale ucinany Z SUFIKSEM marki, daje uwagę i ostrzeżenie pola", async () => {
    // ~460 px samego fallbacku to „dobry" tytuł; z sufiksem marki (domyślne
    // ustawienia: włączony, = nazwa serwisu) przekracza 600 px. Panel i pole
    // mają mierzyć to, co pójdzie do Google, a nie sam fallback.
    const FALLBACK = "Polska prezydencja w Radzie Unii Europejskiej";
    const onIssuesChange = vi.fn<(issues: SeoIssue[]) => void>();
    renderPanel({ onIssuesChange, fallbackTitle: { pl: FALLBACK, en: FALLBACK } });

    await waitFor(() =>
      expect(onIssuesChange).toHaveBeenLastCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ lang: "pl", kind: "title", severity: "warning" }),
        ]),
      ),
    );
    // Pole tytułu (puste) ogłasza ostrzeżenie pikselowe dla fallbacku z sufiksem.
    expect(screen.getAllByText("admin.seo.field.warnPixel").length).toBeGreaterThan(0);
  });

  it("brak `onIssuesChange` nie wywraca panelu (opcjonalne wywołanie)", async () => {
    renderPanel({ value: { seo_title_pl: LONG_TITLE } });
    // Podsumowanie i tak pokazuje ostrzeżenie - panel działa bez rodzica.
    await waitFor(() =>
      expect(screen.getByTestId("seo-severity-badge")).toHaveAttribute("data-severity", "warning"),
    );
  });
});

describe("SeoPanel - ścieżka podglądu", () => {
  it("wpis: ścieżka rodzica z RPC + własny slug", async () => {
    renderPanel({ entity: { kind: "post", id: "post-1" }, pathSourcePageId: "page-7" });
    await waitFor(() => expect(inspectionPath()).toBe("blog/moj-wpis"));
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("page_full_path", { _page_id: "page-7" });
  });

  it("strona: własna ścieżka z RPC, bez doklejania sluga", async () => {
    h.pageFullPath = "o-nas/zespol";
    renderPanel({
      entity: { kind: "page", id: "page-1" },
      slug: "zespol",
      pathSourcePageId: "page-1",
    });
    await waitFor(() => expect(inspectionPath()).toBe("o-nas/zespol"));
  });

  it("strona bez rozwiązanej ścieżki spada na własny slug", async () => {
    h.pageFullPath = null;
    renderPanel({ entity: { kind: "page", id: "page-1" }, slug: "zespol" });
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
    expect(inspectionPath()).toBe("zespol");
  });

  it("RPC oddające wartość NIE-STRING (obiekt) traktujemy jak brak ścieżki", async () => {
    // Konsekwencja braku tej gałęzi: `[object Object]` w podglądzie SERP i w
    // zapytaniu do URL Inspection API.
    h.pageFullPath = { path: "blog" };
    renderPanel({ entity: { kind: "page", id: "page-1" }, slug: "zespol" });
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
    expect(inspectionPath()).toBe("zespol");
  });

  it("brak strony źródłowej: ZERO zapytań i placeholder `…` w ścieżce wpisu", async () => {
    renderPanel({ entity: { kind: "post", id: "post-1" }, pathSourcePageId: null });
    await waitFor(() => expect(inspectionPath()).toBe("…/moj-wpis"));
    expect(h.rpc).not.toHaveBeenCalled();
    expect(screen.getByText(/› … › moj-wpis/)).toBeInTheDocument();
  });
});

describe("SeoPanel - obraz społecznościowy", () => {
  const FULL = {
    seo_og_image_url: "https://cdn.test/override.jpg",
    og_image_generated_url: "https://cdn.test/karta.png",
  };

  it("nadpisanie redakcyjne bije okładkę i wygenerowaną kartę", () => {
    const { container } = renderPanel({ value: FULL, coverImageUrl: "https://cdn.test/cover.jpg" });
    expect(screen.getByText("admin.seo.og.sourceOverride")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("src", FULL.seo_og_image_url);
  });

  it("okładka bije wygenerowaną kartę", () => {
    const { container } = renderPanel({
      value: { og_image_generated_url: FULL.og_image_generated_url },
      coverImageUrl: "https://cdn.test/cover.jpg",
    });
    expect(screen.getByText("admin.seo.og.sourceCover")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn.test/cover.jpg");
  });

  it("wygenerowana karta wchodzi, gdy nie ma ani nadpisania, ani okładki", () => {
    const { container } = renderPanel({
      value: { og_image_generated_url: FULL.og_image_generated_url },
    });
    expect(screen.getByText("admin.seo.og.sourceCard")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("src", FULL.og_image_generated_url);
  });

  it("bez żadnego ogniwa łańcucha zostaje karta domyślna serwisu", () => {
    const { container } = renderPanel();
    expect(screen.getByText("admin.seo.og.sourceDefault")).toBeInTheDocument();
    // Panel nie zna originu żądania, więc pokazuje komunikat, a nie pusty <img>.
    expect(screen.getByText("admin.seo.og.empty")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("atrapa ImageSlot dostaje etykiety, wartość i folder karty OG", () => {
    renderPanel({ value: { seo_og_image_url: FULL.seo_og_image_url } });
    expect(h.imageSlot).toMatchObject({
      label: "admin.seo.og.overrideLabel",
      hint: "admin.seo.og.overrideHint",
      value: FULL.seo_og_image_url,
      folder: "og-cards",
    });
  });

  it("nadpisanie karty normalizuje puste wejście do null", () => {
    const { onChange } = renderPanel();
    // Brak wartości => pole dostaje "" (a nie `null`), inaczej React zgłasza
    // przejście na komponent niekontrolowany.
    expect(h.imageSlot?.value).toBe("");
    const input = screen.getByTestId("og-override");
    fireEvent.change(input, { target: { value: "  https://cdn.test/nowa.jpg  " } });
    expect(onChange).toHaveBeenLastCalledWith({
      seo_og_image_url: "https://cdn.test/nowa.jpg",
    });
    fireEvent.change(input, { target: { value: "   " } });
    expect(onChange).toHaveBeenLastCalledWith({ seo_og_image_url: null });
  });
});

describe("SeoPanel - generowanie karty OG", () => {
  it("bez jakiegokolwiek tytułu odmawia generowania", async () => {
    renderPanel({ fallbackTitle: { pl: "", en: "" } });
    fireEvent.click(generateButton());
    await waitFor(() => expect(h.toastErrorToast).toHaveBeenCalledWith("admin.seo.og.needTitle"));
    expect(h.generateOgCard).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("sukces zapisuje adres karty w formularzu i potwierdza toastem", async () => {
    const { onChange } = renderPanel({
      entity: { kind: "page", id: "page-9" },
      ogKicker: "Analizy",
    });
    fireEvent.click(generateButton());
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        og_image_generated_url: "https://cdn.test/og/post-1.png",
      }),
    );
    expect(h.generateOgCard).toHaveBeenCalledWith("page", "page-9", {
      title: "Tytul PL",
      kicker: "Analizy",
      siteName: SITE_NAME,
    });
    expect(h.toastSuccess).toHaveBeenCalledWith("admin.seo.og.generated");
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("brak etykiety karty przekazywany jest jako null, nie undefined", async () => {
    renderPanel();
    fireEvent.click(generateButton());
    await waitFor(() => expect(h.generateOgCard).toHaveBeenCalledTimes(1));
    expect(h.generateOgCard).toHaveBeenCalledWith("post", "post-1", {
      title: "Tytul PL",
      kicker: null,
      siteName: SITE_NAME,
    });
  });

  it("na czas generowania przycisk jest zablokowany, potem znów aktywny", async () => {
    const deferred: { resolve: (url: string) => void } = { resolve: () => {} };
    h.generateOgCard.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          deferred.resolve = resolve;
        }),
    );
    renderPanel();
    fireEvent.click(generateButton());
    await waitFor(() => expect(generateButton()).toBeDisabled());
    // Drugie kliknięcie w zablokowany przycisk nie startuje drugiego uploadu.
    fireEvent.click(generateButton());
    expect(h.generateOgCard).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve("https://cdn.test/og/gotowa.png");
    });
    expect(generateButton()).not.toBeDisabled();
  });

  it("błąd generowania idzie do toastError, a przycisk wraca do gry", async () => {
    const failure = new Error("canvas padł");
    h.generateOgCard.mockRejectedValue(failure);
    const { onChange } = renderPanel();
    fireEvent.click(generateButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(failure));
    expect(onChange).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(generateButton()).not.toBeDisabled();
  });

  describe("wybór tytułu karty", () => {
    /** Kliknij "generuj" i oddaj tytuł, z którym poszedł generator. */
    async function generatedTitle(): Promise<string | undefined> {
      fireEvent.click(generateButton());
      await waitFor(() => expect(h.generateOgCard).toHaveBeenCalledTimes(1));
      return h.generateOgCard.mock.calls[0]?.[2].title;
    }

    it("zakładka PL: nadpisanie SEO bije tytuł treści", async () => {
      renderPanel({ value: { seo_title_pl: "  Nadpisanie PL  " } });
      expect(await generatedTitle()).toBe("Nadpisanie PL");
    });

    it("zakładka PL: samo białe znaki w nadpisaniu spadają na tytuł treści", async () => {
      renderPanel({ value: { seo_title_pl: "   " } });
      expect(await generatedTitle()).toBe("Tytul PL");
    });

    it("zakładka PL: brak polskiego tytułu treści spada na angielski", async () => {
      renderPanel({ fallbackTitle: { pl: "", en: "Title EN" } });
      expect(await generatedTitle()).toBe("Title EN");
    });

    it("zakładka EN: nadpisanie EN bije wszystko", async () => {
      h.language = "en";
      renderPanel({ value: { seo_title_en: "Override EN", seo_title_pl: "Nadpisanie PL" } });
      expect(await generatedTitle()).toBe("Override EN");
    });

    it("zakładka EN: bez nadpisania EN bierze angielski tytuł treści, NIE polskie nadpisanie", async () => {
      // Nadpisania SEO nie przechodzą między językami - angielska karta z
      // polskim tytułem to błąd, który widać dopiero po udostępnieniu linku.
      h.language = "en";
      renderPanel({ value: { seo_title_pl: "Nadpisanie PL" } });
      expect(await generatedTitle()).toBe("Title EN");
    });

    it("zakładka EN: brak angielskiego tytułu treści spada na polski", async () => {
      h.language = "en";
      renderPanel({ fallbackTitle: { pl: "Tytul PL", en: "" } });
      expect(await generatedTitle()).toBe("Tytul PL");
    });

    it("po przełączeniu zakładki generator bierze tytuł NOWEJ zakładki", async () => {
      renderPanel({ value: { seo_title_pl: "Nadpisanie PL", seo_title_en: "Override EN" } });
      fireEvent.mouseDown(screen.getByRole("tab", { name: "EN" }));
      expect(await generatedTitle()).toBe("Override EN");
    });
  });
});

describe("SeoPanel - kanoniczny URL i noindex", () => {
  it("wpisany adres kanoniczny idzie do formularza po obcięciu spacji", () => {
    const { onChange } = renderPanel();
    const input = screen.getByPlaceholderText("https://…");
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "  https://nes.eu/analizy/x  " } });
    expect(onChange).toHaveBeenLastCalledWith({
      seo_canonical_url: "https://nes.eu/analizy/x",
    });
  });

  it("same spacje w polu kanonicznym zapisują null, nie pusty string", () => {
    // Konsekwencja braku tej gałęzi: `<link rel="canonical" href="">`, czyli
    // kanoniczny wskazujący sam siebie z pustym adresem.
    const { onChange } = renderPanel({ value: { seo_canonical_url: "https://nes.eu/stary" } });
    const input = screen.getByPlaceholderText("https://…");
    expect(input).toHaveValue("https://nes.eu/stary");
    fireEvent.change(input, { target: { value: "    " } });
    expect(onChange).toHaveBeenLastCalledWith({ seo_canonical_url: null });
  });

  it("przełącznik noindex działa w obie strony", () => {
    const off = renderPanel();
    fireEvent.click(screen.getByRole("switch"));
    expect(off.onChange).toHaveBeenLastCalledWith({ seo_noindex: true });
    cleanup();

    const on = renderPanel({ value: { seo_noindex: true } });
    fireEvent.click(screen.getByRole("switch"));
    expect(on.onChange).toHaveBeenLastCalledWith({ seo_noindex: false });
  });

  it("noindex zakrywa podgląd SERP nakładką", () => {
    renderPanel({ value: { seo_noindex: true } });
    expect(screen.getByText("noindex")).toBeInTheDocument();
  });

  it("bez noindex nakładki nie ma", () => {
    renderPanel();
    expect(screen.queryByText("noindex")).not.toBeInTheDocument();
  });
});

describe("SeoPanel - tytuł i opis w podglądzie SERP", () => {
  it("tytuł POCHODNY dostaje sufiks marki", () => {
    renderPanel();
    expect(screen.getByText(`Tytul PL - ${SITE_NAME}`)).toBeInTheDocument();
  });

  it("tytuł NADPISANY renderuje się dosłownie, bez sufiksu (semantyka Yoasta)", () => {
    renderPanel({ value: { seo_title_pl: "Dokladnie ten tytul" } });
    expect(screen.getByText("Dokladnie ten tytul")).toBeInTheDocument();
    expect(screen.queryByText(`Dokladnie ten tytul - ${SITE_NAME}`)).not.toBeInTheDocument();
  });

  it("brak tytułu treści w obu językach spada na slug", () => {
    renderPanel({ fallbackTitle: { pl: "", en: "" }, slug: "moj-wpis" });
    expect(screen.getByText(`moj-wpis - ${SITE_NAME}`)).toBeInTheDocument();
    // Placeholder pola tytułu też pokazuje slug - redakcja widzi, co pójdzie.
    expect(screen.getByPlaceholderText("moj-wpis")).toBeInTheDocument();
  });

  it("opis pochodny przechodzi przez metaDescription (HTML zostaje ścięty)", () => {
    renderPanel({
      fallbackDescription: { pl: "  <p>Opis <b>z</b> HTML-a</p>  ", en: null },
    });
    expect(screen.getByText("Opis z HTML-a")).toBeInTheDocument();
  });

  it("brak opisu w obu językach spada na tytuł", () => {
    renderPanel({ fallbackDescription: { pl: null, en: null } });
    // metaDescription(null, fallbackTitle) => tytuł; podgląd pokazuje go dwa
    // razy (nagłówek z sufiksem i opis bez), więc szukamy dokładnego opisu.
    expect(screen.getByText("Tytul PL")).toBeInTheDocument();
  });

  it("nadpisany opis wygrywa nad pochodnym", () => {
    renderPanel({ value: { seo_description_pl: "Recznie napisany opis" } });
    // `selector: "p"` celuje w akapit podglądu SERP - ten sam napis siedzi też
    // w polu formularza, a dowodzimy tu TREŚCI PODGLĄDU.
    expect(screen.getByText("Recznie napisany opis", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText("Opis PL")).not.toBeInTheDocument();
  });

  it("sekcja EN składa tytuł i opis z angielskich fallbacków", () => {
    h.language = "en";
    renderPanel();
    expect(screen.getByText(`Title EN - ${SITE_NAME}`)).toBeInTheDocument();
    expect(screen.getByText("Description EN")).toBeInTheDocument();
  });

  it("sekcja EN spada na polski opis, gdy angielskiego nie ma", () => {
    h.language = "en";
    renderPanel({ fallbackDescription: { pl: "Opis PL", en: null } });
    expect(screen.getByText("Opis PL")).toBeInTheDocument();
  });
});

describe("SeoPanel - edycja pól tytułu i opisu", () => {
  it("PL: tytuł i opis trafiają do polskich kolumn", () => {
    const { onChange } = renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Tytul PL"), {
      target: { value: "Nowy tytul PL" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ seo_title_pl: "Nowy tytul PL" });
    fireEvent.change(screen.getByPlaceholderText("Opis PL"), {
      target: { value: "Nowy opis PL" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ seo_description_pl: "Nowy opis PL" });
  });

  it("EN: tytuł i opis trafiają do angielskich kolumn", () => {
    const { onChange } = renderPanel();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "EN" }));
    fireEvent.change(screen.getByPlaceholderText("Title EN"), {
      target: { value: "New EN title" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ seo_title_en: "New EN title" });
    fireEvent.change(screen.getByPlaceholderText("Description EN"), {
      target: { value: "New EN description" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ seo_description_en: "New EN description" });
  });

  it("wyczyszczenie pola zapisuje null (kolumna nullable, nie pusty string)", () => {
    const { onChange } = renderPanel({ value: { seo_title_pl: "Cos" } });
    fireEvent.change(screen.getByPlaceholderText("Tytul PL"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ seo_title_pl: null });
  });
});

describe("SeoPanel - uwagi o strukturze nagłówków", () => {
  it("H1 w treści to DUPLIKAT, nie brak (layout rysuje własny H1)", () => {
    renderPanel({ contentHtml: { pl: "<h1>Tytul w tresci</h1>", en: null } });
    expect(
      screen.getByText(
        'PL - admin.seo.validation.headingLabel: admin.seo.validation.extraH1(pos= (#1),snip= - "Tytul w tresci")',
      ),
    ).toBeInTheDocument();
    // Gdyby panel nie ustawiał `rendersTitleAsH1`, ten sam dokument dostałby
    // uwagę "brak H1" - dokładnie odwrotną radę dla redakcji.
    expect(screen.queryByText(/admin\.seo\.validation\.missingH1/)).not.toBeInTheDocument();
  });

  it("treść z samym H2 nie generuje uwagi o braku H1", () => {
    renderPanel({ contentHtml: { pl: "<h2>Sekcja</h2>", en: null } });
    expect(screen.getByText("admin.seo.validation.ok")).toBeInTheDocument();
  });

  it("drzewo bloków wygrywa nad HTML-em", () => {
    renderPanel({
      contentHtml: { pl: "<h1>Duplikat z HTML-a</h1>", en: null },
      contentBlocks: [
        { type: "heading", data: { level: 2, text: "Sekcja" } },
        { type: "heading", data: { level: 4, text: "Podsekcja" } },
      ],
    });
    // Bloki nie są per-język, więc ta sama uwaga leci dla PL i EN.
    expect(
      screen.getAllByText(
        /admin\.seo\.validation\.skippedLevel\(from=2,pos= \(#2\),snip= - "Podsekcja",to=4\)/,
      ),
    ).toHaveLength(2);
    expect(screen.queryByText(/admin\.seo\.validation\.extraH1/)).not.toBeInTheDocument();
  });

  it("bez treści w obu językach nie ma żadnych uwag o nagłówkach", () => {
    renderPanel();
    expect(screen.getByText("admin.seo.validation.ok")).toBeInTheDocument();
    expect(screen.queryByText(/admin\.seo\.validation\.headingLabel/)).not.toBeInTheDocument();
  });

  it("treść od H3 to przeskok od H1 UKŁADU (rendersTitleAsH1 uczestniczy w hierarchii)", () => {
    // Dawny martwy punkt: panel woła walidator z `rendersTitleAsH1: true`,
    // a dziura H1 (układ) -> H3 (treść) przechodziła jako "brak uwag".
    renderPanel({ contentHtml: { pl: "<h3>Start</h3><h4>Dalej</h4>", en: null } });
    expect(
      screen.getByText(
        'PL - admin.seo.validation.headingLabel: admin.seo.validation.skippedLevel(from=1,pos= (#1),snip= - "Start",to=3)',
      ),
    ).toBeInTheDocument();
  });

  it("nagłówek z treści zastępczej <iframe> nie robi przeskoku w panelu", () => {
    renderPanel({
      contentHtml: { pl: "<h2>Sekcja</h2><iframe><h5>Widget</h5></iframe>", en: "<h2>S</h2>" },
    });
    expect(screen.queryByText(/admin\.seo\.validation\.skippedLevel/)).not.toBeInTheDocument();
    expect(screen.getByText("admin.seo.validation.ok")).toBeInTheDocument();
  });

  it("bez nagłówków w obu językach podsumowanie mówi „nie sprawdzono (PL, EN)”, nie zielone ok", () => {
    renderPanel();
    expect(summaryBox()).toHaveAttribute("data-state", "unchecked");
    expect(
      screen.getByText("admin.seo.validation.headingsUnchecked(langs=PL, EN)"),
    ).toBeInTheDocument();
  });

  it("nagłówki tylko po polsku: niesprawdzony jest WYŁĄCZNIE angielski", () => {
    renderPanel({ contentHtml: { pl: "<h2>Sekcja</h2>", en: "<p>Bez nagłówków</p>" } });
    expect(
      screen.getByText("admin.seo.validation.headingsUnchecked(langs=EN)"),
    ).toBeInTheDocument();
  });

  it("brak tłumaczenia EN (null) to NIE „nie sprawdzono” - wpis tylko po polsku dostaje zielone ok", () => {
    // STRAŻNIK: wcześniej każdy wpis bez wersji EN stał na stałe w stanie
    // "nie sprawdzono (EN)", choć sprawdzać nie było czego.
    renderPanel({ contentHtml: { pl: "<h2>Sekcja</h2>", en: null } });
    expect(summaryBox()).toHaveAttribute("data-state", "ok");
    expect(screen.queryByText(/admin\.seo\.validation\.headingsUnchecked/)).not.toBeInTheDocument();
  });

  it.each([
    { opis: "pusty napis", en: "" },
    { opis: "pusty akapit edytora", en: "<p></p>" },
    { opis: "sam &nbsp;", en: "<p>&nbsp;</p>" },
  ])("EN = $opis to też brak treści, nie niesprawdzona kontrola", ({ en }) => {
    renderPanel({ contentHtml: { pl: "<h2>Sekcja</h2>", en } });
    expect(summaryBox()).toHaveAttribute("data-state", "ok");
  });

  it("PL z tekstem bez nagłówków i bez EN: niesprawdzony jest WYŁĄCZNIE PL", () => {
    renderPanel({ contentHtml: { pl: "<p>Sam akapit</p>", en: null } });
    expect(
      screen.getByText("admin.seo.validation.headingsUnchecked(langs=PL)"),
    ).toBeInTheDocument();
  });

  it("świeży szkic (żaden język nie ma treści): oba języki „nie sprawdzono”", () => {
    renderPanel({ contentHtml: { pl: "<p></p>", en: null } });
    expect(summaryBox()).toHaveAttribute("data-state", "unchecked");
    expect(
      screen.getByText("admin.seo.validation.headingsUnchecked(langs=PL, EN)"),
    ).toBeInTheDocument();
  });

  it("drzewo bloków z nagłówkami sprawdza OBA języki - zielone ok bez notatki (negatywny)", () => {
    renderPanel({ contentBlocks: [{ type: "heading", data: { level: 2, text: "Sekcja" } }] });
    expect(summaryBox()).toHaveAttribute("data-state", "ok");
    expect(screen.queryByText(/admin\.seo\.validation\.headingsUnchecked/)).not.toBeInTheDocument();
  });

  it("skan nagłówków idzie per język i po NAPISACH, nie po obiekcie `contentHtml`", () => {
    // Edytory podają `contentHtml={{ pl, en }}` - nowy obiekt przy KAŻDYM
    // renderze. Zależność od obiektu skanowała obie treści przy każdym
    // uderzeniu w klawiaturę w dowolnym polu formularza.
    const { rerenderPanel } = renderPanel({
      contentHtml: { pl: "<h2>A</h2>", en: "<h2>B</h2>" },
    });
    expect(h.headingScans).toEqual([
      { lang: "pl", html: "<h2>A</h2>" },
      { lang: "en", html: "<h2>B</h2>" },
    ]);

    h.headingScans.length = 0;
    // Nowy obiekt, te same napisy, inna niezwiązana zmiana => ZERO skanów.
    rerenderPanel({ contentHtml: { pl: "<h2>A</h2>", en: "<h2>B</h2>" }, ogKicker: "Analizy" });
    expect(h.headingScans).toEqual([]);

    // Zmiana treści PL => skan WYŁĄCZNIE PL.
    rerenderPanel({ contentHtml: { pl: "<h2>A2</h2>", en: "<h2>B</h2>" } });
    expect(h.headingScans).toEqual([{ lang: "pl", html: "<h2>A2</h2>" }]);

    h.headingScans.length = 0;
    rerenderPanel({ contentHtml: { pl: "<h2>A2</h2>", en: "<h2>B2</h2>" } });
    expect(h.headingScans).toEqual([{ lang: "en", html: "<h2>B2</h2>" }]);
  });

  it("zmiana drzewa bloków skanuje OBA języki (bloki nie są per język)", () => {
    const html = { pl: "<h2>A</h2>", en: "<h2>B</h2>" };
    const { rerenderPanel } = renderPanel({ contentHtml: html, contentBlocks: [] });
    h.headingScans.length = 0;
    rerenderPanel({
      contentHtml: { ...html },
      contentBlocks: [{ type: "heading", data: { level: 2, text: "Blok" } }],
    });
    expect(h.headingScans.map((c) => c.lang)).toEqual(["pl", "en"]);
  });

  it("uwagi o nagłówkach jadą razem z uwagami o snippetach", () => {
    renderPanel({
      value: { seo_title_pl: "a".repeat(80) },
      contentHtml: { pl: "<h1>Duplikat</h1>", en: null },
    });
    expect(screen.getByTestId("seo-severity-badge")).toHaveAttribute("data-severity", "warning");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("SeoPanel - host w podglądzie Google", () => {
  const BRAND_HOST = SITE_CANONICAL_ORIGIN.replace(/^https?:\/\//, "");

  it("tenant na własnej domenie widzi SWÓJ host, nie host marki", async () => {
    // STRAŻNIK: panel renderował `<SerpPreview>` bez `host`, więc tenant z
    // własną domeną oglądał nad swoim wpisem adres marki.
    h.tenantOrigin = "https://analizy.example.org";
    renderPanel();
    expect(await screen.findByText("analizy.example.org › blog › moj-wpis")).toBeInTheDocument();
    expect(screen.queryByText(`${BRAND_HOST} › blog › moj-wpis`)).not.toBeInTheDocument();
  });

  it("zakładka EN ma ten sam host tenanta z prefiksem `en`", async () => {
    h.language = "en";
    h.tenantOrigin = "https://analizy.example.org";
    renderPanel();
    expect(
      await screen.findByText("analizy.example.org › en › blog › moj-wpis"),
    ).toBeInTheDocument();
  });

  it("marka / tenant bez własnej domeny: host kanoniczny marki", async () => {
    h.tenantOrigin = CANONICAL_SITE_ORIGIN;
    renderPanel();
    expect(await screen.findByText(`${BRAND_HOST} › blog › moj-wpis`)).toBeInTheDocument();
  });

  it("tenant bez publicznego adresu (null) NIE dostaje hosta marki (negatywny)", async () => {
    h.tenantOrigin = null;
    renderPanel();
    await waitFor(() => expect(inspectionPath()).toBe("blog/moj-wpis"));
    expect(screen.getByText("› blog › moj-wpis")).toBeInTheDocument();
    expect(
      screen.queryByText(new RegExp(BRAND_HOST.replace(/\./g, "\\."))),
    ).not.toBeInTheDocument();
  });
});

describe("SeoPanel - walidacja snippetów po polach, nie po obiekcie", () => {
  /** Pola `value`, od których zależy memo walidacji w panelu. */
  const SLEDZONE_POLA = [
    "seo_description_en",
    "seo_description_pl",
    "seo_title_en",
    "seo_title_pl",
  ];

  it("validateSeoPanel czyta z `value` DOKŁADNIE pola śledzone przez memo panelu", async () => {
    // STRAŻNIK dryfu: gdy walidator zacznie czytać inne pole (np. noindex),
    // memo panelu by go nie śledziło - ten test pada pierwszy.
    const { validateSeoPanel } =
      await vi.importActual<typeof import("@/lib/seo/validation")>("@/lib/seo/validation");
    const czytane = new Set<string>();
    const sonda = (value: SeoPanelValue) =>
      new Proxy(value, {
        get(target, key, receiver) {
          if (typeof key === "string") czytane.add(key);
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
    const reszta = {
      fallbackTitle: { pl: "Tytul", en: "Title" },
      fallbackDescription: { pl: null, en: null },
      slug: "s",
      titleCharLimit: 160,
      descriptionCharLimit: 320,
    };
    validateSeoPanel({ ...reszta, value: sonda(EMPTY_VALUE) });
    validateSeoPanel({
      ...reszta,
      value: sonda({
        ...EMPTY_VALUE,
        seo_title_pl: "a",
        seo_title_en: "b",
        seo_description_pl: "c",
        seo_description_en: "d",
        seo_canonical_url: "https://x.test/",
        seo_noindex: true,
        seo_og_image_url: "https://x.test/a.png",
        og_image_generated_url: "https://x.test/b.png",
      }),
    });
    expect([...czytane].sort()).toEqual(SLEDZONE_POLA);
  });

  it("nowy obiekt `value` z tymi samymi polami NIE przelicza walidacji", () => {
    const { rerenderPanel } = renderPanel({ value: { seo_title_pl: "A" } });
    expect(h.seoValidations).toBeGreaterThan(0);
    h.seoValidations = 0;

    // Nowy literał, te same napisy + niezwiązana zmiana => ZERO przeliczeń.
    rerenderPanel({ value: { seo_title_pl: "A" }, ogKicker: "Analizy" });
    expect(h.seoValidations).toBe(0);

    // Pola, których walidator nie czyta, też nie przeliczają.
    rerenderPanel({
      value: {
        seo_title_pl: "A",
        seo_canonical_url: "https://x.test/",
        seo_og_image_url: "https://x.test/a.png",
      },
    });
    expect(h.seoValidations).toBe(0);

    // Zmiana śledzonego pola => dokładnie jedno przeliczenie.
    rerenderPanel({ value: { seo_title_pl: "B" } });
    expect(h.seoValidations).toBe(1);

    // Zmiana tytułu zastępczego też przelicza (fallbacki są w zależnościach).
    rerenderPanel({ value: { seo_title_pl: "B" }, fallbackTitle: { pl: "Inny", en: "Title EN" } });
    expect(h.seoValidations).toBe(2);
  });

  it("wynik walidacji jest ten sam co dla pełnego `value` (negatywny dla zawężenia)", async () => {
    const { validateSeoPanel } =
      await vi.importActual<typeof import("@/lib/seo/validation")>("@/lib/seo/validation");
    const onIssuesChange = vi.fn<(issues: SeoIssue[]) => void>();
    const value: Partial<SeoPanelValue> = {
      seo_title_pl: "a".repeat(80),
      seo_description_en: "d".repeat(330),
      seo_noindex: true,
      seo_canonical_url: "https://x.test/",
    };
    renderPanel({ value, onIssuesChange });
    await waitFor(() => expect(onIssuesChange).toHaveBeenCalled());
    expect(onIssuesChange).toHaveBeenLastCalledWith(
      validateSeoPanel({
        value: { ...EMPTY_VALUE, ...value },
        fallbackTitle: { pl: "Tytul PL", en: "Title EN" },
        fallbackDescription: { pl: "Opis PL", en: "Description EN" },
        slug: "moj-wpis",
        titleCharLimit: 160,
        descriptionCharLimit: 320,
      }),
    );
  });
});

describe("SeoPanel - dostępność", () => {
  it("panel nie ma ŻADNYCH naruszeń axe (przełącznik noindex ma dostępną nazwę)", async () => {
    // STRAŻNIK dawnego defektu: `Switch` z Radiksa renderuje
    // `<button role="switch">`, a stojąca obok `<Label>` nie była z nim
    // powiązana. KONSEKWENCJA regresji: czytnik ekranu czyta "przełącznik,
    // niezaznaczony" BEZ NAZWY - przy najbardziej niszczącym przełączniku w
    // całym panelu (noindex wypisuje stronę z Google). Żadna reguła axe nie
    // jest wyłączona ponad wspólne minimum z `@/test/axe`.
    const { container } = renderPanel();
    await waitFor(() => expect(inspectionPath()).toBe("blog/moj-wpis"));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("nazwa przełącznika to WIDOCZNA etykieta, a opis to podpowiedź pod nią", () => {
    // Nazwa wiązana z widoczną etykietą (a nie osobny `aria-label`), więc
    // zmiana tłumaczenia etykiety nie rozjedzie tego, co widać, z tym, co słychać.
    renderPanel();
    const toggle = screen.getByRole("switch", { name: "admin.seo.noindexLabel" });
    expect(toggle).toHaveAccessibleDescription("admin.seo.noindexHint");
    expect(toggle).not.toHaveAttribute("aria-label");
  });

  it("dwa panele na jednej stronie nie dzielą identyfikatorów etykiety (negatywny)", () => {
    // `useId` daje unikalne id per instancja - stałe id sprawiłoby, że drugi
    // przełącznik czytałby etykietę pierwszego.
    renderWithQueryClient(
      <>
        {panel({})}
        {panel({ entity: { kind: "page", id: "page-2" } })}
      </>,
    );
    const toggles = screen.getAllByRole("switch", { name: "admin.seo.noindexLabel" });
    expect(toggles).toHaveLength(2);
    expect(toggles[0].id).not.toBe(toggles[1].id);
    expect(toggles[0].getAttribute("aria-labelledby")).not.toBe(
      toggles[1].getAttribute("aria-labelledby"),
    );
  });
});
