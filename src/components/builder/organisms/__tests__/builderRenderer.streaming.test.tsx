// PUBLICZNY RENDERER: STRUMIENIOWANIE, OKNO „NAD ZGIĘCIEM", GRANICE SUSPENSE
// I CO SIĘ DZIEJE PRZY BRAKU DANYCH ŹRÓDŁOWYCH.
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// * KANDYDAT LCP STRONY (P1.4) - PRZEPISANE ŚWIADOMIE. Dawniej każda z trzech
//   czołowych sekcji oznaczała swój pierwszy obraz `eager` + `high`
//   (`["eager","eager","eager","lazy","lazy"]`), co na fixture `/` dawało 9
//   obrazów High. Teraz tylko renderer-właściciel (`lcpOwner`) wyznacza
//   kandydata (`lcpCandidates`): DOKŁADNIE jeden obraz eager + high
//   + `data-lcp-candidate`, reszta leniwa; renderer bez `lcpOwner` (powłoka,
//   popup, kanwa) nie ma kandydata wcale. Okno `aboveFoldCount` (domyślnie
//   `ABOVE_FOLD_SECTION_COUNT`) zawęża skan kandydata. Dowód SSR: preload
//   z trasy (`usePreloadLcpImages`) i `<img>` kandydata dają JEDEN `<link>`.
//   Kandydat liczy reguły `advanced.access` TYM SAMYM kontekstem co renderer
//   (zalogowany - atrapa `useAuth` niżej; recenzja P1.4, B1): znacznik jest
//   zawsze na obrazie, który renderer maluje, a preload loadera (liczony dla
//   gościa) nie idzie do dokumentu zalogowanego,
// * `stream` włączone i wyłączone dla sekcji ZALEŻNEJ OD DANYCH i dla statycznej
//   - z dowodem, że na ścieżce KLIENCKIEJ treść jest identyczna,
// * brak danych źródłowych: widget listy wpisów z pustą odpowiedzią Supabase
//   nie wywraca sekcji ani strony,
// * granica `Suspense` renderera (L655) w stanie OCZEKIWANIA i po rozwiązaniu
//   - łącznie z tym, że jej `fallback={null}` NIE REZERWUJE ANI PIKSELA,
// * granica błędu wokół sekcji: uszkodzony `layout.htmlTag` wywraca render
//   JEDNEJ sekcji, a nie strony.
//
// ── TWARDE OGRANICZENIA ŚRODOWISKA (nie do obejścia, do udokumentowania) ───
// 1. `import.meta.env.SSR` jest w vitest FAŁSZEM, więc `ServerSectionGate`
//    NIGDY nie montuje się przez `<StreamingSection>` - klient dostaje dzieci
//    bez bramki. Bramka ma własny dowód, montowany BEZPOŚREDNIO, w
//    `src/lib/builder/__tests__/sectionStreaming.test.tsx:58-113`. Tutaj mierzymy
//    to, co widzi PRZEGLĄDARKA, i pilnujemy, że strumieniowanie nie zmienia
//    HTML-a na tej ścieżce.
// 2. Z punktu 1 wynika, że szkielet `SectionStreamSkeleton` (280 px `minHeight`)
//    jest z `BuilderRenderer` nieosiągalny - nic nie zawiesza granicy na
//    kliencie. Dlatego pomiar rezerwy miejsca robimy na trzech faktach:
//    szkielet strumienia rezerwuje 280 px NIEZALEŻNIE od realnej wysokości
//    sekcji (patrz `sectionStreaming.test.tsx:51-55`), granica renderera
//    rezerwuje ZERO, a na kliencie żaden z tych fallbacków się nie pokazuje.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Suspense, lazy, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  LcpCandidatesProvider,
  usePreloadLcpImages,
  type LcpImagePreload,
} from "@/lib/builder/aboveFold";
import "@/test/i18nReal";
import { ABOVE_FOLD_SECTION_COUNT } from "@/lib/builder/prefetch";
import { shouldStreamSection } from "@/lib/builder/sectionStreaming";
import { __resetBuilderDebugForTests } from "@/lib/builder/builderDebug";
import type { EmptyContainerPickerBoxProps } from "../BuilderRenderer";
import { BuilderEmptyPickerProvider, BuilderRenderer } from "../BuilderRenderer";
import {
  column,
  doc,
  gate,
  section,
  simpleSection,
  stubObservers,
  tabsConfig,
  widget,
} from "./builderRendererFixtures";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

// SESJA CZYTELNIKA. Domyślnie `null` - prawdziwy `useAuth` (wartość domyślna
// kontekstu = gość, czyli stan renderu publicznego). Testy kandydata dla
// ZALOGOWANEGO ustawiają sesję; reszta pliku nie widzi żadnej zmiany.
const auth = vi.hoisted(() => ({ session: null as { user: { id: string } } | null }));
vi.mock("@/hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useAuth")>();
  return {
    ...actual,
    useAuth: () => {
      const base = actual.useAuth();
      return auth.session
        ? { ...base, session: auth.session, user: auth.session.user, loading: false }
        : base;
    },
  };
});

// GRANICA SYSTEMU, nie warstwa pod testem: widget listy wpisów czyta dane przez
// react-query z Supabase. Atrapa oddaje pusty zbiór, więc test mierzy ścieżkę
// „brak danych źródłowych" bez sieci.
vi.mock("@/integrations/supabase/client", () => {
  type Builder = Record<string, unknown> & { then: (r: (v: unknown) => unknown) => unknown };
  const builder = {} as Builder;
  for (const m of [
    "select",
    "eq",
    "neq",
    "is",
    "in",
    "not",
    "gte",
    "lte",
    "gt",
    "lt",
    "order",
    "range",
    "limit",
    "or",
    "filter",
    "contains",
    "overlaps",
    "match",
    "ilike",
  ]) {
    (builder as Record<string, unknown>)[m] = vi.fn(() => builder);
  }
  builder.single = vi.fn(async () => ({ data: null, error: null }));
  builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  const channel: Record<string, unknown> = {};
  channel.on = vi.fn(() => channel);
  channel.subscribe = vi.fn(() => channel);
  return {
    supabase: {
      from: vi.fn(() => builder),
      rpc: vi.fn(async () => ({ data: [], error: null })),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => "ok"),
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
      },
    },
  };
});

let observers: ReturnType<typeof stubObservers>;

beforeEach(() => {
  observers = stubObservers();
  __resetBuilderDebugForTests();
});

afterEach(() => {
  cleanup();
  observers.restore();
  __resetBuilderDebugForTests();
  vi.restoreAllMocks();
  auth.session = null;
});

/** Sekcja z JEDNYM obrazem - priorytet ładowania zdradza kandydata LCP. */
const sekcjaZObrazem = (id: string, src = "https://example.org/obraz.png") =>
  section(id, [
    column(`${id}-c`, [
      widget(`${id}-img`, "image", {
        content: { src, alt_pl: `Obraz ${id}` },
      }),
    ]),
  ]);

/** Sekcja zależna od danych (lista wpisów) - jedyny rodzaj, który strumieniuje. */
const sekcjaZDanymi = (id: string) =>
  section(id, [column(`${id}-c`, [widget(`${id}-lista`, "post-list", { content: {} })])]);

const priorytety = (container: HTMLElement) =>
  [...container.querySelectorAll("img")].map((img) => img.getAttribute("loading"));

const kandydaci = (root: ParentNode) => root.querySelectorAll("img[data-lcp-candidate]");

describe("kandydat LCP strony (lcpOwner, P1.4)", () => {
  it("renderer BEZ lcpOwner (nagłówek, stopka, popup) nie ma kandydata - każdy obraz leniwy", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([0, 1, 2].map((i) => sekcjaZObrazem(`s${i}`)))} lang="pl" />,
    );
    expect(priorytety(container)).toEqual(["lazy", "lazy", "lazy"]);
    expect(kandydaci(container)).toHaveLength(0);
    for (const img of container.querySelectorAll("img"))
      expect(img.getAttribute("fetchpriority")).toBe("auto");
  });

  it("renderer-właściciel: DOKŁADNIE jeden obraz eager + high + data-lcp-candidate", () => {
    expect(ABOVE_FOLD_SECTION_COUNT).toBe(3);
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([0, 1, 2, 3, 4].map((i) => sekcjaZObrazem(`s${i}`)))}
        lang="pl"
        lcpOwner
      />,
    );
    // Dawniej: ["eager","eager","eager","lazy","lazy"] - trzy obrazy High.
    expect(priorytety(container)).toEqual(["eager", "lazy", "lazy", "lazy", "lazy"]);
    const [kandydat] = kandydaci(container);
    expect(kandydaci(container)).toHaveLength(1);
    expect(kandydat.getAttribute("fetchpriority")).toBe("high");
    expect(kandydat.getAttribute("alt")).toBe("Obraz s0");
  });

  it("cienka sekcja tekstowa nad hero: kandydatem jest obraz sekcji 1", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([simpleSection("tytul"), sekcjaZObrazem("hero"), sekcjaZObrazem("dalej")])}
        lang="pl"
        lcpOwner
      />,
    );
    expect(priorytety(container)).toEqual(["eager", "lazy"]);
    expect(kandydaci(container)[0]?.getAttribute("alt")).toBe("Obraz hero");
  });

  it("okno skanu: domyślnie 3 sekcje, `aboveFoldCount` je zawęża, 0 wyłącza", () => {
    const tekst = [0, 1, 2].map((i) => simpleSection(`t${i}`));
    const poza = renderWithQueryClient(
      <BuilderRenderer doc={doc([...tekst, sekcjaZObrazem("s3")])} lang="pl" lcpOwner />,
    );
    expect(kandydaci(poza.container)).toHaveLength(0);
    cleanup();
    const waskie = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([simpleSection("t"), sekcjaZObrazem("s1")])}
        lang="pl"
        lcpOwner
        aboveFoldCount={1}
      />,
    );
    expect(priorytety(waskie.container)).toEqual(["lazy"]);
    cleanup();
    const zerowe = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0")])} lang="pl" lcpOwner aboveFoldCount={0} />,
    );
    expect(priorytety(zerowe.container)).toEqual(["lazy"]);
    expect(zerowe.container.querySelector("img")?.getAttribute("fetchpriority")).toBe("auto");
  });

  it("zagnieżdżony renderer BEZ lcpOwner nie dziedziczy kandydatów rodzica", () => {
    // Kandydaci renderera-właściciela wiszą w kontekście. Renderer powłoki
    // (np. popup otwarty nad treścią) ustawia własną, pustą listę - inaczej
    // widget o tym samym id dostałby priorytet i drugi znacznik na stronie.
    const { container } = renderWithQueryClient(
      <LcpCandidatesProvider widgetIds={["s0-img"]}>
        <BuilderRenderer doc={doc([sekcjaZObrazem("s0")])} lang="pl" />
      </LcpCandidatesProvider>,
    );
    expect(kandydaci(container)).toHaveLength(0);
    expect(priorytety(container)).toEqual(["lazy"]);
  });

  it("ZALOGOWANY, sekcja 0 „tylko dla gości”: znacznik na obrazie, który renderer MALUJE (B1)", () => {
    // Dokument w przeglądarce nie jest odzierany. Bez filtra dostępu kandydatem
    // zostawał widget niemalowanej sekcji promo: hero sekcji 1 był leniwy,
    // a na stronie nie było ŻADNEGO `img[data-lcp-candidate]`.
    const dokument = doc([
      section("promo", sekcjaZObrazem("promo").children, { advanced: gate({ auth: "guest" }) }),
      sekcjaZObrazem("hero"),
    ]);
    const gosc = renderWithQueryClient(<BuilderRenderer doc={dokument} lang="pl" lcpOwner />);
    expect(kandydaci(gosc.container)[0]?.getAttribute("alt")).toBe("Obraz promo");
    cleanup();
    auth.session = { user: { id: "u-1" } };
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={dokument} lang="pl" lcpOwner />,
    );
    expect(container.querySelector('[data-sec-id="promo"]')).toBeNull();
    expect(kandydaci(container)).toHaveLength(1);
    expect(kandydaci(container)[0].getAttribute("alt")).toBe("Obraz hero");
    expect(priorytety(container)).toEqual(["eager"]);
  });

  it("ZALOGOWANY widzi hero „tylko dla zalogowanych” i to on jest kandydatem; gość - następna sekcja", () => {
    const dokument = doc([
      section("dla-czlonkow", sekcjaZObrazem("dla-czlonkow").children, {
        advanced: gate({ auth: "user" }),
      }),
      sekcjaZObrazem("dla-wszystkich"),
    ]);
    const gosc = renderWithQueryClient(<BuilderRenderer doc={dokument} lang="pl" lcpOwner />);
    expect(kandydaci(gosc.container)[0]?.getAttribute("alt")).toBe("Obraz dla-wszystkich");
    cleanup();
    auth.session = { user: { id: "u-1" } };
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={dokument} lang="pl" lcpOwner />,
    );
    expect(priorytety(container)).toEqual(["eager", "lazy"]);
    // (Nie „dla-zalogowanych”: alt z „logo” wyklucza obraz heurystyką logo.)
    expect(kandydaci(container)[0]?.getAttribute("alt")).toBe("Obraz dla-czlonkow");
  });

  it("widget z regułą dostępu nie jest kandydatem - priorytet dostaje malowany sąsiad", () => {
    const dokument = doc([
      section("s0", [
        column("s0-c", [
          widget("s0-ukryty", "image", {
            content: { src: "https://example.org/ukryty.png", alt_pl: "Ukryty" },
            advanced: gate({ auth: "user" }),
          }),
          widget("s0-widoczny", "image", {
            content: { src: "https://example.org/widoczny.png", alt_pl: "Widoczny" },
          }),
        ]),
      ]),
    ]);
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={dokument} lang="pl" lcpOwner />,
    );
    expect(kandydaci(container)).toHaveLength(1);
    expect(kandydaci(container)[0].getAttribute("alt")).toBe("Widoczny");
  });

  it("kanwa buildera (editorPreview) nie wyznacza kandydata nawet z lcpOwner", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0")])} lang="pl" lcpOwner editorPreview />,
    );
    expect(kandydaci(container)).toHaveLength(0);
  });
});

/**
 * Render SERWEROWY strony: trasa woła `usePreloadLcpImages` (jak `index.tsx`
 * i `$.tsx`), a pod nią renderuje się kanwa z kandydatem.
 */
function ssrPage(preloads: LcpImagePreload[], content: ReactElement): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Trasa() {
    usePreloadLcpImages(preloads);
    return content;
  }
  return renderToString(
    <QueryClientProvider client={qc}>
      <Trasa />
    </QueryClientProvider>,
  );
}

const imagePreloadLinks = (html: string) =>
  html.match(/<link[^>]*rel="preload"[^>]*as="image"[^>]*>/g) ?? [];

describe("SSR: jedno źródło preloadu obrazu LCP (werdykt LP-2)", () => {
  const STORAGE = "https://p.supabase.co/storage/v1/object/public/covers/hero.jpg";

  it("preload z trasy i automatyczny preload `<img>` kandydata to JEDEN `<link>`", () => {
    // Ten sam klucz zasobu (bez srcSet: `href`) - React nie emituje drugiego.
    // Dawniej trasa dokładała osobny `<link>` z `head()`, a React drugi z `<img>`.
    const src = "https://example.org/ssr-hero.png";
    const html = ssrPage(
      [{ href: src }],
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0", src)])} lang="pl" lcpOwner />,
    );
    const links = imagePreloadLinks(html);
    expect(links).toHaveLength(1);
    expect(links[0]).toContain(`href="${src}"`);
    expect(links[0]).toMatch(/fetchPriority="high"/i);
    expect(html.match(/data-lcp-candidate/g)).toHaveLength(1);
  });

  it("obraz responsywny: preload ma TEN SAM imagesrcset i imagesizes co `<img>` kandydata", () => {
    const html = ssrPage(
      [],
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0", STORAGE)])} lang="pl" lcpOwner />,
    );
    const img = /<img[^>]*data-lcp-candidate[^>]*>/.exec(html)?.[0] ?? "";
    const srcset = /srcSet="([^"]+)"/i.exec(img)?.[1];
    const sizes = /sizes="([^"]+)"/.exec(img)?.[1];
    expect(srcset).toContain("/storage/v1/render/image/public/");
    const [link] = imagePreloadLinks(html);
    expect(link).toContain(`imageSrcSet="${srcset}"`);
    expect(link).toContain(`imageSizes="${sizes}"`);
  });

  it("KONTROLA NEGATYWNA: preload o innych `sizes` niż `<img>` daje DWA linki", () => {
    // Dowód, że jedność zależy od klucza `srcSet\nsizes`, a nie od szczęścia:
    // deskryptor z innym `imageSizes` to inny zasób - przeglądarka pobrałaby
    // wtedy dwa warianty obrazu LCP.
    const html = ssrPage(
      [{ href: STORAGE, imageSrcSet: `${STORAGE}?w=1 1w`, imageSizes: "1px" }],
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0", STORAGE)])} lang="pl" lcpOwner />,
    );
    expect(imagePreloadLinks(html)).toHaveLength(2);
  });

  it("strona bez obrazu w oknie: ani kandydata, ani preloadu obrazu", () => {
    const html = ssrPage(
      [],
      <BuilderRenderer doc={doc([simpleSection("a"), simpleSection("b")])} lang="pl" lcpOwner />,
    );
    expect(html).not.toContain("data-lcp-candidate");
    expect(imagePreloadLinks(html)).toHaveLength(0);
  });

  it("dwóch kandydatów: preload każdego z `media` urządzenia, nadal JEDEN link na kandydata", () => {
    // Desktop: większa kolumna 8/12; telefon: kolumna z order.mobile 1. Preload
    // z `media` dzieli klucz zasobu z `<img>`, więc React nie dokłada drugiego.
    const maly = "https://example.org/maly.png";
    const duzy = "https://example.org/duzy.png";
    const dokument = doc([
      section("s0", [
        column("s0-maly", [widget("w-maly", "image", { content: { src: maly, alt_pl: "Mały" } })], {
          span: { desktop: 4 },
          order: { mobile: 1 },
        }),
        column("s0-duzy", [widget("w-duzy", "image", { content: { src: duzy, alt_pl: "Duży" } })], {
          span: { desktop: 8 },
          order: { mobile: 2 },
        }),
      ]),
    ]);
    const html = ssrPage(
      [
        { href: duzy, media: "(min-width: 768px)" },
        { href: maly, media: "(max-width: 767px)" },
      ],
      <BuilderRenderer doc={dokument} lang="pl" lcpOwner />,
    );
    const links = imagePreloadLinks(html);
    expect(links).toHaveLength(2);
    expect(links.find((l) => l.includes(duzy))).toContain('media="(min-width: 768px)"');
    expect(links.find((l) => l.includes(maly))).toContain('media="(max-width: 767px)"');
    expect(html.match(/data-lcp-candidate/g)).toHaveLength(2);
  });

  it("ZALOGOWANY: preload loadera (liczony dla gościa) nie trafia do dokumentu - tylko `<img>` jego kandydata", () => {
    // Loader nie zna sesji (SSR jest anonimowy, nawigacja SPA liczy dla gościa).
    // Sekcja promo jest „tylko dla gości”: dla zalogowanego preload jej obrazu
    // byłby pobraniem z High czegoś, czego renderer nie maluje.
    const promo = "https://example.org/promo.png";
    const hero = "https://example.org/hero.png";
    const dokument = doc([
      section("promo", sekcjaZObrazem("promo", promo).children, {
        advanced: gate({ auth: "guest" }),
      }),
      sekcjaZObrazem("hero", hero),
    ]);
    auth.session = { user: { id: "u-1" } };
    const html = ssrPage([{ href: promo }], <BuilderRenderer doc={dokument} lang="pl" lcpOwner />);
    const links = imagePreloadLinks(html);
    expect(links).toHaveLength(1);
    expect(links[0]).toContain(`href="${hero}"`);
    expect(html).not.toContain(promo);
  });

  it("renderer BEZ lcpOwner nie emituje preloadu obrazu (obrazy leniwe)", () => {
    const html = ssrPage(
      [],
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0", STORAGE)])} lang="pl" />,
    );
    expect(imagePreloadLinks(html)).toHaveLength(0);
    expect(html).toContain('loading="lazy"');
  });
});

describe("strumieniowanie sekcji na ścieżce KLIENCKIEJ", () => {
  const dokument = doc([
    simpleSection("statyczna"),
    sekcjaZDanymi("dane-1"),
    sekcjaZDanymi("dane-2"),
    sekcjaZDanymi("dane-3"),
    sekcjaZDanymi("dane-4"),
  ]);

  it("decyzja eager/stream jest czystą funkcją dokumentu, nie renderu", () => {
    // Ten sam predykat, którego używa `StreamingSection`. Sekcja statyczna nie
    // strumieniuje NIGDY; każda sekcja z danymi ma bramkę przy włączonym
    // `stream`, także gdy prefetch pierwszego ekranu przekroczył budżet.
    const statyczna = dokument.sections[0];
    const zDanymi = dokument.sections[4];
    expect(shouldStreamSection(statyczna, "pl", true)).toBe(false);
    expect(shouldStreamSection(zDanymi, "pl", true)).toBe(true);
    expect(shouldStreamSection(zDanymi, "pl", false)).toBe(false);
  });

  it.each([false, true])("stream=%s daje IDENTYCZNY zestaw sekcji w DOM", (stream) => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={dokument} lang="pl" stream={stream} />,
    );
    const ids = [...container.querySelectorAll("[data-sec-id]")].map((el) =>
      el.getAttribute("data-sec-id"),
    );
    expect(ids).toEqual(["statyczna", "dane-1", "dane-2", "dane-3", "dane-4"]);
    // Na kliencie żaden szkielet strumienia się nie pokazuje: `import.meta.env.SSR`
    // jest fałszem, więc bramka serwerowa nie montuje się i nic nie zawiesza
    // granicy. To jest właśnie brak CLS na tej ścieżce.
    expect(container.querySelector("[data-section-stream-skeleton]")).toBeNull();
  });

  it("włączony stream nie gubi treści sekcji poniżej zgięcia", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={dokument} lang="pl" stream aboveFoldCount={0} />,
    );
    expect(container.querySelectorAll("[data-sec-id]").length).toBe(5);
    expect(container.querySelector('[data-sec-id="dane-4"]')).not.toBeNull();
  });
});

describe("brak danych źródłowych", () => {
  it("lista wpisów z pustą odpowiedzią renderuje sekcję i nie wywraca strony", async () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZDanymi("lista"), simpleSection("sasiad")])} lang="pl" />,
    );
    // Oddaj pętlę zdarzeń zapytaniom react-query.
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[data-sec-id="lista"]')).not.toBeNull();
    expect(container.querySelector('[data-sec-id="sasiad"]')).not.toBeNull();
    expect(container.querySelector("[data-render-error]")).toBeNull();
    expect(container.textContent).toContain("T-sasiad-w");
  });

  it("sekcja z widgetem danych i BEZ kolumn nadal renderuje swoją powłokę", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("pusta", [])])} lang="pl" stream />,
    );
    expect(container.querySelector('[data-sec-id="pusta"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-widget-id]").length).toBe(0);
  });
});

describe("granica Suspense renderera (picker pustego kontenera, L655)", () => {
  /** Boks pickera podawany „z góry" - w produkcji robi to kanwa buildera. */
  function makeLazyBox() {
    let release!: (v: { default: (p: EmptyContainerPickerBoxProps) => ReactElement }) => void;
    const promise = new Promise<{ default: (p: EmptyContainerPickerBoxProps) => ReactElement }>(
      (resolve) => {
        release = resolve;
      },
    );
    const Box = lazy(() => promise);
    const Real = ({ tabsEnabled, onPick }: EmptyContainerPickerBoxProps) => (
      <button type="button" data-picker onClick={() => onPick([6, 6])}>
        {tabsEnabled ? "picker-z-zakladkami" : "picker"}
      </button>
    );
    return { Box, release: () => release({ default: Real }) };
  }

  it("stan OCZEKIWANIA: fallback={null} nie rezerwuje ANI PIKSELA", () => {
    const { Box } = makeLazyBox();
    const { container } = renderWithQueryClient(
      <BuilderEmptyPickerProvider onPick={vi.fn()} box={Box}>
        <BuilderRenderer doc={doc([section("kontener", [])])} lang="pl" />
      </BuilderEmptyPickerProvider>,
    );
    const wiersz = container.querySelector<HTMLElement>("[data-columns-row]");
    expect(wiersz).not.toBeNull();
    // Granica wisi - w wierszu kolumn nie ma NIC: ani boksu, ani zastępczej
    // wysokości. Gdy boks dojedzie, treść wskoczy i przesunie stronę.
    expect(wiersz?.childElementCount).toBe(0);
    expect(wiersz?.style.minHeight ?? "").toBe("");
    expect(container.querySelector("[data-picker]")).toBeNull();
  });

  it("po rozwiązaniu boks pojawia się i oddaje wybrane szerokości kolumn", async () => {
    const { Box, release } = makeLazyBox();
    const onPick = vi.fn();
    renderWithQueryClient(
      <BuilderEmptyPickerProvider onPick={onPick} box={Box}>
        <BuilderRenderer doc={doc([section("kontener", [])])} lang="pl" />
      </BuilderEmptyPickerProvider>,
    );
    await act(async () => {
      release();
    });
    const przycisk = await screen.findByText("picker");
    fireEvent.click(przycisk);
    // Kontener bez zakładek zgłasza `tabId === null`.
    expect(onPick).toHaveBeenCalledWith("kontener", null, [6, 6]);
  });

  it("w kontenerze z zakładkami picker zgłasza AKTYWNĄ zakładkę", async () => {
    const { Box, release } = makeLazyBox();
    const onPick = vi.fn();
    renderWithQueryClient(
      <BuilderEmptyPickerProvider onPick={onPick} box={Box}>
        <BuilderRenderer
          doc={doc([
            section("kontener", [], {
              tabs: tabsConfig([{ id: "t1" }, { id: "t2" }], { defaultTabId: "t2" }),
            }),
          ])}
          lang="pl"
        />
      </BuilderEmptyPickerProvider>,
    );
    await act(async () => {
      release();
    });
    fireEvent.click(await screen.findByText("picker-z-zakladkami"));
    expect(onPick).toHaveBeenCalledWith("kontener", "t2", [6, 6]);
  });

  it("BEZ dostawcy (strona publiczna) picker nie istnieje - pusty kontener zostaje pusty", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("kontener", [])])} lang="pl" />,
    );
    expect(container.querySelector("[data-picker]")).toBeNull();
    expect(container.querySelector<HTMLElement>("[data-columns-row]")?.childElementCount).toBe(0);
  });

  it("dostawca podany, ale kontener MA kolumny - picker się nie pokazuje", () => {
    const { Box } = makeLazyBox();
    const { container } = renderWithQueryClient(
      <BuilderEmptyPickerProvider onPick={vi.fn()} box={Box}>
        <BuilderRenderer doc={doc([simpleSection("pelna")])} lang="pl" />
      </BuilderEmptyPickerProvider>,
    );
    expect(container.querySelector("[data-picker]")).toBeNull();
    expect(container.querySelectorAll("[data-widget-id]").length).toBe(1);
  });
});

describe("granica BŁĘDU wokół sekcji", () => {
  it("uszkodzony layout.htmlTag wywraca JEDNĄ sekcję, reszta strony żyje", () => {
    // `htmlTag` jedzie z kolumny jsonb - wartość spoza zbioru znaczników HTML
    // (tu: liczba) wywraca `createElement`. Bez ziarnistej granicy padłaby
    // CAŁA strona publiczna.
    const bledy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = renderWithQueryClient(
        <BuilderRenderer
          doc={doc([
            simpleSection("zdrowa-1"),
            simpleSection("polamana", { layout: { htmlTag: 7 } as never }),
            simpleSection("zdrowa-2"),
          ])}
          lang="pl"
        />,
      );
      expect(container.querySelector('[data-sec-id="zdrowa-1"]')).not.toBeNull();
      expect(container.querySelector('[data-sec-id="zdrowa-2"]')).not.toBeNull();
      const diagnostyka = container.querySelector('[data-render-error="section:polamana"]');
      expect(diagnostyka).not.toBeNull();
      // W dev granica pokazuje zwięzły komunikat (rola alert); w produkcji
      // zostaje niewidoczny ślad w DOM - tam mierzy to RenderErrorBoundary.
      expect(diagnostyka?.getAttribute("role")).toBe("alert");
    } finally {
      bledy.mockRestore();
    }
  });

  it("granica z fallbackiem null nie rezerwuje miejsca po zepsutym węźle", () => {
    const bledy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = renderWithQueryClient(
        <Suspense fallback={null}>
          <BuilderRenderer
            doc={doc([simpleSection("polamana", { layout: { htmlTag: 7 } as never })])}
            lang="pl"
          />
        </Suspense>,
      );
      const korzen = container.querySelector<HTMLElement>("[data-builder-renderer]");
      // Jedyne, co zostaje po sekcji, to diagnostyka granicy - nie ma
      // zastępczej wysokości, która utrzymałaby układ strony.
      expect(korzen?.querySelector("[data-sec-id]")).toBeNull();
      expect(korzen?.style.minHeight ?? "").toBe("");
    } finally {
      bledy.mockRestore();
    }
  });
});
