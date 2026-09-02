// Trasa PUBLICZNA `/quiz` - landing platformy EuroChallenge. Do dziś: 0 z 35
// linii.
//
// ── DECYZJA N4 DLA TEJ TRASY: BRAK LOADERA JEST UZASADNIONY (ODRZUCENIE) ───
//
// Audyt modułu 07 wymienił `/quiz` wśród czterech tras treściowych bez
// loadera. Dla tej trasy rozstrzygnięcie brzmi ODRZUCIĆ i to nie jest unik -
// oto dowód, w kolejności wagi:
//
//   1. TA TRASA NIE MA CZEGO ROZGRZAĆ. Zero `useQuery`, zero `useSuspenseQuery`,
//      zero tabel, zero RPC. Loader istnieje po to, żeby zapytanie miało wynik
//      PRZED renderem; tutaj nie ma zapytania, więc loader byłby pustą
//      funkcją, która wydłuża nawigację i nie zmienia ani jednego bajtu HTML.
//      Blok „zero odczytów" niżej mierzy to WYKONAWCZO, a nie deklaratywnie.
//   2. CIAŁO STRONY JUŻ SCHODZI Z SERWERA. Nadtytuł, pasek powrotu, panel
//      udostępniania i stopka renderują się ze stałych (`lib/quiz/platform`),
//      więc crawler dostaje pełną treść bez ani jednego round-tripu.
//      Sprawdzone przy CAŁKOWICIE niedostępnym backendzie (blok niżej).
//   3. JEDYNA TREŚĆ, KTÓREJ NIE MA W HTML, JEST CUDZA. Sam quiz to
//      `<iframe>` na `nes-quiz.com/embed` - dokument OBCEGO pochodzenia,
//      którego żaden loader nie wyrenderuje serwerowo. Kredyt dla tej
//      platformy niesie JSON-LD (`mainEntity` -> `WebApplication`), i to jest
//      poprawna droga, bo canonical musi zostać po stronie NES.
//
// CO Z TEGO WYNIKA DLA UTRZYMANIA: gdyby ktoś dopisał tu pierwsze `useQuery`
// (np. licznik rozegranych partii z bazy), blok „zero odczytów" zrobi się
// czerwony - i wtedy ta trasa POTRZEBUJE loadera. Test jest zapadką na
// dzisiejszym uzasadnieniu, nie zgodą na jego wieczność.
//
// NAPRAWA, KTÓRA TU WESZŁA (izolacja obszarów roboczych): fallback adresu do
// udostępnienia brał twardo kanoniczny origin marki, więc HTML wyrenderowany
// na DRUGIEJ domenie niósł przyciski „udostępnij" prowadzące na domenę
// pierwszej. Teraz bierze host BIEŻĄCEGO ŻĄDANIA (`getOrigin()`).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - STATYCZNEJ BRAMKI `head()`: `src/lib/seo/__tests__/quizLanding.test.ts`
//   czyta ŹRÓDŁO trasy i pilnuje, że opis idzie za językiem, że meta powstają
//   w `buildContentHead` i że adres platformy mieszka w `lib/quiz/platform`.
//   Tutaj to samo sprawdzamy WYKONAWCZO (wołamy `head()` i czytamy wynik), bo
//   bramka tekstowa nie widzi, co funkcja naprawdę zwraca.
// - `ReadingHeader` i `Footer`: to globalna powłoka z własnymi testami
//   i własnymi zapytaniami (menu, profil, powiadomienia). Tutaj są
//   atrapami-markerami; przedmiotem dowodu jest to, CO trasa im podaje.
// - `LazyQuizIframe` i `QuizBackground` biegną PRAWDZIWE - mają własne pliki
//   testowe, ale tu są treścią, o którą cała trasa istnieje.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Etykiety WSZYSTKICH odczytów bazy - podstawa dowodu „zero zapytań". */
  reads: [] as string[],
  /** Adres żądania widziany przez `head()`. */
  requestUrl: "https://nes.example.org/quiz",
  /** Origin bieżącego żądania - źródło fallbacku adresu do udostępnienia. */
  origin: "https://nes.example.org",
  /** Komunikaty podane do `toast.*`. */
  toasts: [] as string[],
  /** Teksty przekazane do schowka. */
  copied: [] as string[],
  /** `true` = schowek przeglądarki odmawia (brak zgody, kontekst bez HTTPS). */
  clipboardBroken: false,
  /** Propsy, jakie atrapa nadtytułu dostała od trasy. */
  headerProps: {} as Record<string, unknown>,
}));

// KAŻDY odczyt bazy jest tu rejestrowany i ŻADEN nie jest zaplanowany:
// zapytanie z tej trasy ma być błędem testu, nie cichym `null`.
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, fail } = await import("@/test/supabase/chain");
  const { supabaseRpcStub } = await import("@/test/supabase/rpc");
  const stub = supabaseFromStub();
  const rpc = supabaseRpcStub();
  return {
    supabase: {
      from: (table: string) => {
        h.reads.push(`from:${table}`);
        stub.setResponse(table, () => fail(`test: trasa /quiz nie ma prawa czytac ${table}`));
        return stub.from(table);
      },
      rpc: (name: string, args?: Record<string, unknown>) => {
        h.reads.push(`rpc:${name}`);
        rpc.setResponse(name, () => fail(`test: trasa /quiz nie ma prawa wolac ${name}`));
        return rpc.rpc(name, args);
      },
    },
  };
});

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => h.origin,
}));

vi.mock("sonner", () => ({
  toast: {
    info: (message: string) => void h.toasts.push(message),
    error: (message: string) => void h.toasts.push(message),
    success: (message: string) => void h.toasts.push(message),
  },
}));

// Globalna powłoka: własne testy, własne zapytania (menu, profil, dzwonki).
vi.mock("@/components/share/ReadingHeader", () => ({
  ReadingHeader: (props: Record<string, unknown>) => {
    h.headerProps = props;
    return <div data-testid="reading-header">{String(props.title)}</div>;
  },
}));
vi.mock("@/components/Footer", () => ({
  Footer: () => <div data-testid="footer" />,
}));
// `BrandIcon` czyta bibliotekę ikon (`icon_library`) JEDNYM globalnym kluczem
// dla całej aplikacji - to nie treść tej trasy i nie da się tego rozgrzać
// per-trasa, więc atrapujemy sam atom (ma własne testy). Dzięki temu pomiar
// „zero odczytów" niżej mierzy odczyty TREŚCI, a nie współdzielony cache ikon.
vi.mock("@/components/atoms/BrandIcon", () => ({
  BrandIcon: () => <span data-testid="brand-icon" aria-hidden="true" />,
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { QUIZ_EMBED_URL, QUIZ_PLATFORM_URL, QUIZ_TITLE } from "@/lib/quiz/platform";
import { renderRoute, routeHead, type RouteHeadResult } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as QuizRoute } from "@/routes/quiz";

const PATH = "/quiz";

async function mount(entry = PATH) {
  return renderRoute({ route: QuizRoute, path: PATH, initialEntry: entry });
}

/** Wartość `content` wpisu meta - z twardym błędem, gdy wpisu nie ma. */
function metaContent(
  head: RouteHeadResult,
  key: "name" | "property" | "httpEquiv",
  value: string,
): string {
  const found = (head.meta ?? []).find((entry) => entry[key] === value);
  const content = found?.content;
  if (typeof content !== "string") throw new Error(`test: brak meta ${key}="${value}"`);
  return content;
}

/** Tytuł dokumentu z `head()` - z twardym błędem, gdy go nie ma. */
function headTitle(head: RouteHeadResult): string {
  const found = (head.meta ?? []).find((entry) => typeof entry.title === "string");
  if (typeof found?.title !== "string") throw new Error("test: head() nie niesie tytulu");
  return found.title;
}

/** Sparsowany węzeł JSON-LD - z twardym błędem, gdy go nie ma. */
function jsonLd(head: RouteHeadResult): Record<string, unknown> {
  const script = (head.scripts ?? []).find((entry) => entry.type === "application/ld+json");
  const parsed: unknown = JSON.parse(script?.children ?? "null");
  if (!parsed || typeof parsed !== "object") throw new Error("test: brak wezla JSON-LD");
  return parsed as Record<string, unknown>;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.reads = [];
  h.requestUrl = "https://nes.example.org/quiz";
  h.origin = "https://nes.example.org";
  h.toasts = [];
  h.copied = [];
  h.clipboardBroken = false;
  h.headerProps = {};
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        if (h.clipboardBroken) throw new Error("test: schowek odmowil");
        h.copied.push(text);
      },
    },
  });
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /quiz - treść landingu bez ani jednego zapytania", () => {
  it("montuje quiz z adresu ze STAŁEJ, nie z bazy", async () => {
    // Adres platformy przeniesiono do `lib/quiz/platform`, bo stała w pliku
    // trasy wywracała bundle kliencki (rozdzielacz tras re-eksportuje wartości
    // modułowe używane po obu stronach granicy `head()`/komponent). Tu
    // pilnujemy końca WYKONAWCZEGO: iframe naprawdę dostaje ten adres.
    await mount();

    const frame = await screen.findByTitle(QUIZ_TITLE);
    expect(frame).toHaveAttribute("src", QUIZ_EMBED_URL);
  });

  it("nadtytuł i pasek powrotu schodzą razem z treścią, bez round-tripu", async () => {
    // Landing jest jednoekranowy, więc powłoka nie może dojeżdżać później -
    // czytelnik zobaczyłby przeskok układu na całej wysokości ekranu.
    await mount();

    expect(screen.getByTestId("reading-header")).toHaveTextContent(QUIZ_TITLE);
    expect(h.headerProps.pinned).toBe(true);
    expect(screen.getByRole("link", { name: /Wróć|Powrót/ })).toHaveAttribute("href", "/");
    expect(screen.getByTestId("footer")).toBeInTheDocument();
  });

  it("rysuje WŁASNĄ powłokę - `staticData.ownChrome` jest tego jedyną deklaracją", async () => {
    // Bez tej flagi globalny layout dorysowałby drugi nagłówek i drugą stopkę
    // nad tymi, które strona rysuje sama.
    expect(QuizRoute.options.staticData).toEqual({ ownChrome: true });
  });

  it("ZERO odczytów bazy - i to jest cały dowód, że loader nie ma czego robić", async () => {
    // ZAPADKA NA UZASADNIENIU ODRZUCENIA N4. Atrapa klienta nie ma ZAPLANOWANEJ
    // odpowiedzi na nic: pierwsze `useQuery` dopisane do tej trasy pojawi się
    // tu jako odczyt i wywali ten test. Wtedy trasa POTRZEBUJE loadera.
    await mount();
    await screen.findByTitle(QUIZ_TITLE);

    expect(h.reads, `odczyty tresci: ${h.reads.join(", ")}`).toEqual([]);
  });

  it("trasa NIE MA loadera - to stan zamierzony, nie przeoczenie", async () => {
    // Asercja na BRAKU, świadoma jak asercja na obecności: dopisanie tu pustego
    // loadera „dla spójności" wydłuża każdą nawigację i nie zmienia HTML.
    expect(QuizRoute.options.loader).toBeUndefined();
  });

  it("nie zostawia landingu z wadami dostępności", async () => {
    const view = await mount();
    await screen.findByTitle(QUIZ_TITLE);

    // axe wchodzi do RAMEK, a ta ramka jest dokumentem OBCEGO POCHODZENIA -
    // axe-core przerywa wtedy z „Respondable target must be a frame in the
    // current window", bo nie ma jak wstrzyknąć się do cudzego dokumentu.
    // Nazwę dostępną samej ramki (`title`) sprawdza przypadek wyżej; audyt
    // strukturalny dotyczy NASZEGO dokumentu, więc ramkę wyjmujemy z poddrzewa.
    for (const frame of [...view.container.querySelectorAll("iframe")]) frame.remove();

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /quiz - panel udostępniania", () => {
  it("każdy kanał ma etykietę tekstową, nie samą ikonę", async () => {
    // Ikona bez nazwy dostępnej to dla czytnika ekranu przycisk „button".
    // Panel udostępniania złożony z sześciu takich jest nieużywalny.
    await mount();

    for (const label of [
      "Kopiuj link",
      "LinkedIn",
      "Facebook",
      "Messenger",
      "WhatsApp",
      "E-mail",
    ]) {
      expect(screen.getAllByLabelText(label).length).toBeGreaterThan(0);
    }
  });

  it("kopiowanie wkłada adres do schowka i potwierdza to czytelnikowi", async () => {
    await mount();

    fireEvent.click(screen.getAllByLabelText("Kopiuj link")[0]);

    await waitFor(() => expect(h.copied).toHaveLength(1));
    expect(h.toasts).toContain("Link skopiowany do schowka");
  });

  it("odmowa schowka daje komunikat, a nie cichy brak reakcji", async () => {
    // Schowek odmawia w realnych warunkach (brak zgody, kontekst bez HTTPS).
    // Przycisk, który wtedy milczy, wygląda dla czytelnika na zepsuty.
    h.clipboardBroken = true;
    await mount();

    fireEvent.click(screen.getAllByLabelText("Kopiuj link")[0]);

    await waitFor(() => expect(h.toasts.length).toBeGreaterThan(0));
    expect(h.copied).toEqual([]);
  });

  it("po angielsku etykiety panelu są angielskie", async () => {
    await i18n.changeLanguage("en");
    await mount();

    expect(screen.getAllByLabelText("Copy link").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Kopiuj link")).not.toBeInTheDocument();
  });

  it("panel mobilny rozwija się i zwija, a stan mówi o tym czytnikowi", async () => {
    // `aria-expanded` jest jedyną informacją dla czytnika ekranu o tym, czy
    // panel jest otwarty; sam obrót ikony nie znaczy dla niego nic.
    await mount();

    const toggle = screen.getByLabelText("Rozwiń panel udostępniania");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    const collapse = screen.getByLabelText("Zwiń panel udostępniania");
    expect(collapse).toHaveAttribute("aria-expanded", "true");
  });
});

describe("trasa /quiz - nagłówek dokumentu i kredyt platformy", () => {
  it("po polsku tytuł karty niesie markę, a og:title zostaje krótki", async () => {
    // Rozdzielenie jest zamierzone: `og:site_name` i tak niesie brand w karcie
    // społecznościowej, więc powtarzanie go w `og:title` zjada limit znaków.
    const head = routeHead(QuizRoute);

    expect(headTitle(head)).toBe(`${QUIZ_TITLE} - New European Strategies`);
    expect(metaContent(head, "property", "og:title")).toBe(QUIZ_TITLE);
    expect(metaContent(head, "name", "description")).toContain("Sprawdź swoją wiedzę");
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("pl");
  });

  it("prefiks /en w ADRESIE daje angielski opis i angielski język treści", async () => {
    // Finding „head() zahardkodowany po polsku" wracał w trzech wydaniach
    // audytu: odwiedzający /en/quiz dostawał polski snippet w podglądzie linku.
    h.requestUrl = "https://nes.example.org/en/quiz";
    const head = routeHead(QuizRoute);

    expect(metaContent(head, "name", "description")).toContain("Test your knowledge");
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
    expect(metaContent(head, "name", "description")).not.toContain("Sprawdź");
  });

  it("nadpisuje globalny viewport, bo strona rysuje się pod notchem", async () => {
    // `viewport-fit=cover` musi być PIERWSZY na liście - wpis z root head
    // wygrałby przy odwrotnej kolejności i `env(safe-area-inset-*)` w komponencie
    // przestałoby mieć znaczenie.
    const head = routeHead(QuizRoute);
    const viewport = (head.meta ?? []).findIndex((entry) => entry.name === "viewport");

    expect(viewport).toBe(0);
    expect(String((head.meta ?? [])[viewport].content)).toContain("viewport-fit=cover");
  });

  it("canonical zostaje na NES, a platformę kredytuje mainEntity", async () => {
    // Gdyby canonical wskazywał nes-quiz.com, cała wartość SEO tego landingu
    // przeszłaby na obcą domenę - a to strona z własną treścią i celem
    // własnych przycisków „udostępnij".
    const head = routeHead(QuizRoute);
    const canonical = (head.links ?? []).find((link) => link.rel === "canonical");
    const graph = jsonLd(head);
    const app = graph.mainEntity as Record<string, unknown>;

    expect(canonical?.href).toBe("https://nes.example.org/quiz");
    expect(graph.url).toBe("https://nes.example.org/quiz");
    expect(app["@type"]).toBe("WebApplication");
    expect(app.url).toBe(QUIZ_PLATFORM_URL);
  });

  it("deklaruje klaster hreflang PL/EN i preload tła", async () => {
    // Preload tła jest tu treścią LCP: tło zajmuje cały ekran, więc jego
    // pobranie musi ruszyć z `<head>`, zanim parser dojdzie do obrazka.
    const head = routeHead(QuizRoute);

    expect(
      (head.links ?? [])
        .filter((link) => link.rel === "alternate")
        .map((link) => link.hrefLang)
        .sort(),
    ).toEqual(["en", "pl", "x-default"]);
    expect((head.links ?? []).some((link) => link.rel === "preload")).toBe(true);
  });

  it("NIE wyłącza się z indeksu - to landing kampanijny", async () => {
    const head = routeHead(QuizRoute);
    expect((head.meta ?? []).filter((entry) => entry.name === "robots")).toEqual([]);
  });
});

// ── IZOLACJA OBSZARÓW ROBOCZYCH NA TRASIE BEZ BAZY ─────────────────────────
//
// Ta trasa nie czyta ŻADNEJ tabeli, więc polityka `public_tenant_id()` nie ma
// tu czego odsiewać - i właśnie dlatego jedyne miejsce, w którym mogła wyciec
// cudza domena, to ADRESY GENEROWANE PO STRONIE SERWERA. Blok pilnuje obu:
// kanonicznego (z `head()`) i adresu do udostępnienia (z komponentu).

describe("trasa /quiz - adresy generowane serwerowo trzymają host żądania", () => {
  it("kanoniczny i og:url biorą host BIEŻĄCEGO żądania, nie stałą marki", async () => {
    // Kanoniczny wskazujący domenę pierwszego obszaru roboczego zlałby oba
    // hosty w jeden wynik wyszukiwania - i to ten cudzy.
    h.requestUrl = "https://inny-obszar.example.org/quiz";
    const head = routeHead(QuizRoute);

    expect(metaContent(head, "property", "og:url")).toBe("https://inny-obszar.example.org/quiz");
    expect((head.links ?? []).find((link) => link.rel === "canonical")?.href).toBe(
      "https://inny-obszar.example.org/quiz",
    );
  });

  it("adres do udostępnienia bierze się z hosta żądania, gdy nie ma window", async () => {
    // SEDNO NAPRAWY. Wcześniej fallback wpisywał twardo kanoniczny origin
    // marki, więc na drugiej domenie przyciski „udostępnij" prowadziły na
    // pierwszą. `getOrigin()` jest izomorficzny i na serwerze czyta host
    // bieżącego żądania. Dowód idzie po ŹRÓDLE, z którego trasa bierze origin -
    // pod happy-dom `window` istnieje zawsze, więc gałąź serwerowa nie da się
    // wywołać renderem, a asercja na `window.location` dowodziłaby drugiej
    // gałęzi tego samego wyrażenia.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/routes/quiz.tsx", "utf8"),
    );

    expect(source).toContain("getOrigin() || SITE_CANONICAL_ORIGIN");
    expect(source).not.toMatch(/`\$\{SITE_CANONICAL_ORIGIN\}\$\{localizedPath/);
  });

  it("po hydratacji adres do udostępnienia jest adresem OTWARTEJ strony", async () => {
    // Druga gałąź tego samego wyrażenia: w przeglądarce autorytetem jest
    // `window.location.href`, bo czytelnik mógł dojść tu z parametrami kampanii,
    // które powinny pojechać w udostępnionym linku.
    await mount();

    const linkedin = screen.getAllByLabelText("LinkedIn")[0];
    expect(linkedin).toHaveAttribute(
      "href",
      expect.stringContaining(encodeURIComponent(window.location.href)),
    );
  });
});
