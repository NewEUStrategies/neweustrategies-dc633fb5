// EKRAN BŁĘDU DLA CZŁOWIEKA (`FriendlyErrorPage`) - render I KLIKNIĘCIA.
//
// PO CO TEN PLIK ISTNIEJE. Komponent był montowany ubocznie przez kilkanaście
// plików tras (`rootShellRender`, `tracker*`, `profile*`, `webStories*`), więc
// jego LINIE wyglądały na pokryte (30/34), a mimo to 4 z 9 funkcji nie
// wykonały się ani raz: `handleRetry`, `handleGoHome`, domknięcie przycisku
// „Wróć” i domknięcie `primaryAction`. Innymi słowy: platforma sprawdzała, że
// karta błędu się RYSUJE, i nie sprawdzała, że którykolwiek z jej przycisków
// COKOLWIEK robi. A to jedyne wyjście z „ślepego zaułka”, w którym stoi
// czytelnik - jeśli „Spróbuj ponownie” przestanie unieważniać loader, ekran
// błędu zamienia się w pułapkę i żaden test tego nie zauważy.
//
// CZEGO TEN PLIK DOWODZI:
//   1. oba warianty układu (`page` i `compact`) rysują te same treści
//      i te same akcje;
//   2. każdy przycisk wykonuje SWOJĄ akcję na routerze (`invalidate`,
//      `navigate({to:"/"})`, `navigate({to:"/login"})`, `history.back()`);
//   3. tryb pierwszorzędnego przycisku zależy od klasyfikacji błędu:
//      `unauthorized`/`sessionExpired` -> `Link` do logowania,
//      pozostałe -> `button` z `handleRetry`;
//   4. gałąź `kind === "degraded"` NIE zgłasza incydentu z przeglądarki -
//      asercja na LICZBIE wywołań, nie na „nie wybuchło”;
//   5. prefiks językowy skrótów ratunkowych i adresu kontaktu.
//
// CO JEST ZAATRAPOWANE I DLACZEGO (nic więcej):
//   * `@tanstack/react-router` - `useRouter` czyta kontekst, którego goły
//     render nie ma (`Cannot read properties of null (reading 'isServer')`),
//     a atrapa jest jednocześnie SONDĄ: to na niej stoi cały dowód punktu 2.
//     `Link` idzie przez wspólny helper repozytorium (`@/test/routerLinkStub`),
//     żeby markup pozostał dostępnym `<a href>`;
//   * `@/lib/platform-error-reporting` - prawdziwy `reportPlatformError`
//     wysyła beacon do sieci (`lib/observability/report.ts`), a żaden test
//     w tym repozytorium do sieci nie wychodzi. Atrapa zamienia przy tym
//     „nic nie wybuchło” na policzalny kontrakt.
// PRAWDZIWE zostają: `errorCopy`/`classifyError` (czyli mapowanie błąd ->
// scenariusz, sedno komponentu) i `lib/i18n/localeRuntime` (język ustawiany
// przez `setClientLang`, tak jak robi to przełącznik języka w aplikacji).
//
// Zero sieci, zero poczty, zero sekretów.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Język renderu - wstrzykiwany przez atrapę `localeRuntime`, patrz niżej. */
  lang: "pl" as "pl" | "en",
  invalidateCalls: 0,
  /** Argumenty każdego `router.navigate(...)` - w kolejności wywołań. */
  navigations: [] as unknown[],
  historyBackCalls: 0,
  /** Zgłoszenia incydentów - atrapa beaconu, patrz nagłówek. */
  reports: [] as { error: unknown; context: unknown }[],
}));

// JĘZYK RENDERU JAKO WSTRZYKIWANE WEJŚCIE - i to nie jest wygoda.
// PRAWDZIWY `currentLang` jest `createIsomorphicFn()` (`localeRuntime.ts:44`),
// a w środowisku testowym rozstrzyga się on na gałąź SERWEROWĄ: `getRequest()`
// rzuca poza zasięgiem żądania h3, `catch` zwraca `DEFAULT_LANG`. ZMIERZONE:
// po `setClientLang("en")` `currentLang()` nadal zwraca "pl", więc asercja
// „wersja angielska" postawiona na prawdziwym module byłaby PUSTA - mierzyłaby
// polski render pod nazwą angielskiego (to ta sama pułapka, którą opisuje
// `src/test/i18nReal.ts`). Atrapa idzie więc wzorcem z `src/__tests__/router.test.tsx`
// i jest CZĄSTKOWA: podmienia wyłącznie `currentLang`, z którego korzystają
// zarówno `FriendlyErrorPage`, jak i `errorCopy` - a samo mapowanie
// język -> słownik i język -> prefiks trasy zostaje prawdziwe.
vi.mock("@/lib/i18n/localeRuntime", () => ({ currentLang: () => h.lang }));

vi.mock("@/lib/platform-error-reporting", () => ({
  reportPlatformError: (error: unknown, context: unknown) => {
    h.reports.push({ error, context });
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...actual,
    Link: RouterLinkStub,
    useRouter: () => ({
      invalidate: () => {
        h.invalidateCalls += 1;
        return Promise.resolve();
      },
      navigate: (options: unknown) => {
        h.navigations.push(options);
        return Promise.resolve();
      },
      history: {
        back: () => {
          h.historyBackCalls += 1;
        },
      },
    }),
  };
});

import { FriendlyErrorPage } from "../FriendlyErrorPage";
import { DEGRADED_ERROR, errorCopy } from "@/lib/errorCopy";

/** Błąd 401 - `classifyError` mapuje go na scenariusz `unauthorized`. */
const UNAUTHORIZED = { status: 401 };
/** Przekierowanie 302 - scenariusz `sessionExpired`. */
const SESSION_EXPIRED = { status: 302 };
/** Komunikat `fetch` - scenariusz `network`. */
const NETWORK = new TypeError("Failed to fetch");
/** Cokolwiek innego - scenariusz `generic`. */
const GENERIC = new Error("boom in loader");

/**
 * Podmienia `window.history.length` na czas jednego przypadku. Bez tego
 * gałąź „głęboka historia vs. wejście z zewnątrz” w przycisku „Wróć” byłaby
 * ZALEŻNA OD KOLEJNOŚCI testów: happy-dom trzyma jedno `window` na plik,
 * a `pushState` długości nie cofa.
 */
function stubHistoryLength(length: number): () => void {
  const original = Object.getOwnPropertyDescriptor(window.history, "length");
  Object.defineProperty(window.history, "length", { configurable: true, get: () => length });
  return () => {
    if (original) Object.defineProperty(window.history, "length", original);
    else Reflect.deleteProperty(window.history, "length");
  };
}

beforeEach(() => {
  h.invalidateCalls = 0;
  h.navigations = [];
  h.historyBackCalls = 0;
  h.reports = [];
  h.lang = "pl";
});

afterEach(() => {
  // Język wraca do domyślnego, żeby kolejność przypadków nie miała znaczenia.
  h.lang = "pl";
});

describe("FriendlyErrorPage - wariant `page`", () => {
  it("rysuje kod, nadlinię, tytuł, treść, kroki i skróty ratunkowe scenariusza ogólnego", () => {
    const copy = errorCopy();
    render(<FriendlyErrorPage error={GENERIC} />);

    // Błąd ogólny nie ma kodu technicznego, więc na pasku statusu stoi
    // ludzki okrzyk ze słownika (`genericCode`) - i to on musi się pokazać,
    // a nie „ERR” ani surowy `error.message` (tego czytelnik nigdy nie widzi).
    expect(screen.getAllByText(copy.genericCode).length).toBeGreaterThan(0);
    // W polskim słowniku nadlinia (`errorTitle`) i tytuł scenariusza ogólnego
    // (`generic.title`) to TEN SAM napis, więc wystąpień jest dwa i oba są
    // oczekiwane: nadlinia w pasku statusu (`<span>`) i nagłówek (`<h1>`).
    // Rozróżnienie idzie po elemencie, nie po treści.
    const titleNodes = screen.getAllByText(copy.errorTitle).map((el) => el.tagName);
    expect(titleNodes).toContain("SPAN");
    expect(titleNodes).toContain("H1");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(copy.generic.title);
    expect(screen.getByText(copy.generic.body)).toBeTruthy();
    expect(screen.queryByText(GENERIC.message)).toBeNull();

    // Trzy kroki „co zrobić”, każdy z numerem - lista jest instrukcją, nie ozdobą.
    for (const step of copy.generic.steps) expect(screen.getByText(step)).toBeTruthy();
    expect(screen.getByText(copy.generic.stepsTitle)).toBeTruthy();

    // Skróty ratunkowe - realne wyjścia z ekranu błędu, bez prefiksu (PL).
    const hrefs = ["/analizy", "/pricing", "/quiz", "/kontakt"];
    for (const href of hrefs) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
    expect(screen.getByText(copy.contactLink)).toHaveAttribute("href", "/kontakt");
  });

  it("„Spróbuj ponownie” unieważnia loader routera I woła `reset` granicy błędu", () => {
    // `handleRetry` ma DWA skutki i oba są potrzebne: `router.invalidate()`
    // każe pobrać dane od nowa, a `reset()` zdejmuje stan błędu z granicy
    // TanStacka. Bez `invalidate` przycisk odrysowuje ten sam nieświeży błąd;
    // bez `reset()` granica zostaje w stanie błędu i nowe dane nie mają gdzie
    // się pokazać. Dlatego asercja jest na obu, nie na jednym.
    const reset = vi.fn();
    const copy = errorCopy();
    render(<FriendlyErrorPage error={GENERIC} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: copy.generic.primaryAction }));

    expect(h.invalidateCalls).toBe(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(h.navigations).toEqual([]);
  });

  it("„Spróbuj ponownie” działa bez `reset` - opcjonalne wywołanie nie wywraca ekranu", () => {
    // Granicę błędu z `reset` daje TanStack Router; `FriendlyErrorPage` jest
    // renderowany także ręcznie (panel admina, sekcje zdegradowane), gdzie
    // `reset` nie istnieje. Wtedy przycisk MUSI dalej działać - a nie rzucać
    // „reset is not a function” na ekranie, który jest ostatnią deską ratunku.
    const copy = errorCopy();
    render(<FriendlyErrorPage error={GENERIC} />);

    fireEvent.click(screen.getByRole("button", { name: copy.generic.primaryAction }));

    expect(h.invalidateCalls).toBe(1);
  });

  it("„Strona główna” nawiguje na `/`", () => {
    const copy = errorCopy();
    render(<FriendlyErrorPage error={GENERIC} />);

    fireEvent.click(screen.getByRole("button", { name: copy.generic.secondaryAction }));

    expect(h.navigations).toEqual([{ to: "/" }]);
    expect(h.invalidateCalls).toBe(0);
  });

  it("„Wróć” cofa historię, gdy czytelnik przyszedł z innej strony serwisu", () => {
    const restore = stubHistoryLength(3);
    try {
      const copy = errorCopy();
      render(<FriendlyErrorPage error={GENERIC} />);

      fireEvent.click(screen.getByRole("button", { name: copy.goBack }));

      expect(h.historyBackCalls).toBe(1);
      expect(h.navigations).toEqual([]);
    } finally {
      restore();
    }
  });

  it("„Wróć” idzie na stronę główną, gdy nie ma do czego wracać", () => {
    // Wejście wprost z wyszukiwarki albo z linku zewnętrznego: `history.back()`
    // wyprowadziłoby czytelnika Z SERWISU (albo nic nie zrobiło). Ta gałąź
    // zamienia „Wróć” w realne wyjście, a nie w martwy przycisk.
    const restore = stubHistoryLength(1);
    try {
      const copy = errorCopy();
      render(<FriendlyErrorPage error={GENERIC} />);

      fireEvent.click(screen.getByRole("button", { name: copy.goBack }));

      expect(h.historyBackCalls).toBe(0);
      expect(h.navigations).toEqual([{ to: "/" }]);
    } finally {
      restore();
    }
  });

  it("nadpisuje tytuł i dokleja stopkę, gdy wywołujący je poda", () => {
    render(<FriendlyErrorPage error={GENERIC} title="Nie wczytano dossier" footer="ID: 42" />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Nie wczytano dossier");
    expect(screen.getByText("ID: 42")).toBeTruthy();
    // Domyślny tytuł scenariusza NIE może przy tym zostać w nagłówku. Asercja
    // celuje w `<h1>`, a nie w cały dokument, bo `generic.title` żyje w PL
    // także jako nadlinia paska statusu (`errorTitle`) - i tam zostać MA.
    expect(heading).not.toHaveTextContent(errorCopy().generic.title);
  });
});

describe("FriendlyErrorPage - tryb przycisku pierwszorzędnego", () => {
  it("`unauthorized` (401) daje LINK do logowania, nie przycisk ponowienia", () => {
    // Ponowienie żądania bez sesji zwróciłoby to samo 401 - pętla. Dlatego
    // przy braku autoryzacji akcją pierwszorzędną jest PRZEJŚCIE na logowanie,
    // i to jako prawdziwy `<a href>` (działa w nowej karcie, widzi go czytnik
    // ekranu, nie wymaga JS-a).
    const copy = errorCopy();
    render(<FriendlyErrorPage error={UNAUTHORIZED} />);

    expect(screen.getAllByText("401").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(copy.unauthorized.title);

    const primary = screen.getByRole("link", { name: copy.unauthorized.primaryAction });
    expect(primary).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: copy.unauthorized.primaryAction })).toBeNull();
  });

  it("`sessionExpired` (302) też daje LINK do logowania, z własnym tytułem i kodem", () => {
    const copy = errorCopy();
    render(<FriendlyErrorPage error={SESSION_EXPIRED} />);

    expect(screen.getAllByText("302").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(copy.sessionExpired.title);
    expect(screen.getByRole("link", { name: copy.sessionExpired.primaryAction })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("`network` (NET) daje PRZYCISK ponowienia - łącze mogło już wrócić", () => {
    const copy = errorCopy();
    render(<FriendlyErrorPage error={NETWORK} />);

    expect(screen.getAllByText("NET").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(copy.network.title);

    fireEvent.click(screen.getByRole("button", { name: copy.network.primaryAction }));
    expect(h.invalidateCalls).toBe(1);
    expect(screen.queryByRole("link", { name: copy.network.primaryAction })).toBeNull();
  });

  it.fails("DEFEKT: domknięcie `primaryAction` dla trybu logowania jest KODEM MARTWYM", () => {
    // `primaryAction` (`FriendlyErrorPage.tsx:102`) jest ternarnym wyborem:
    // dla `primaryIsLogin === true` powstaje domknięcie
    // `() => void router.navigate({ to: "/login" })`. Ale render (`:146-163`)
    // rozgałęzia się na TYM SAMYM `primaryIsLogin` i w gałęzi logowania
    // stawia `<Link to="/login">`, a `onClick={primaryAction}` żyje wyłącznie
    // w gałęzi `<button>`. Ta funkcja nie ma więc ŻADNEJ ścieżki wywołania:
    // powstaje przy każdym renderze 401/302 i nigdy nie jest wołana.
    //
    // KONSEKWENCJA POMIAROWA, zmierzona na tym HEAD. Raport V8 zgłasza
    // w tym pliku dokładnie DWA braki i oba siedzą na linii 102:
    //   * `f` -> `(anonymous_5)`, `decl` 102:41 (ciało domknięcia),
    //   * `b` -> gałąź `cond-expr` 102:24 z licznikami `[0, 15]` (strona
    //     `primaryIsLogin === true` nigdy nie policzona, bo V8 liczy tu
    //     wykonanie BLOKU, a blokiem jest ciało tej strzałki).
    // Sufit pokrycia tego pliku to więc 8/9 funkcji (88,89%) i 38/39 gałęzi
    // (97,43%) - niezależnie od liczby dopisanych testów. Bramka 90% funkcji
    // jest nieosiągalna bez zmiany KODU PRODUKCYJNEGO, czego zlecenie
    // zabrania. Poprawka to jedna linia (`const primaryAction = handleRetry;`),
    // bo nawigację do logowania realizuje `<Link to="/login">`; zamyka ona
    // OBA braki naraz. Ta sama linia 101 ma zresztą drugą, nieszkodliwą
    // usterkę: `primaryIsLogin ? scenario.primaryAction : scenario.primaryAction`
    // to ternarny wybór między dwiema identycznymi wartościami.
    //
    // Test jest zapisany jako oczekiwana porażka: kliknięcie akcji
    // pierwszorzędnej w trybie logowania NIE przechodzi przez router
    // (`<Link>` jest w teście zwykłym `<a href>`), więc `navigate` nie
    // dostaje `/login`. Gdy defekt zostanie naprawiony i `primaryAction`
    // zniknie, ten `it.fails` zacznie przechodzić - i wtedy należy go usunąć.
    const copy = errorCopy();
    render(<FriendlyErrorPage error={UNAUTHORIZED} />);

    fireEvent.click(screen.getByRole("link", { name: copy.unauthorized.primaryAction }));

    expect(h.navigations).toEqual([{ to: "/login" }]);
  });
});

describe("FriendlyErrorPage - zgłaszanie incydentów", () => {
  it("zgłasza błąd RAZ, z granicą i klasyfikacją w kontekście", () => {
    render(<FriendlyErrorPage error={GENERIC} />);

    expect(h.reports).toHaveLength(1);
    expect(h.reports[0].error).toBe(GENERIC);
    expect(h.reports[0].context).toEqual({ boundary: "friendly_error_page", kind: "generic" });
  });

  it("owija błąd NIE-Error w `Error`, zachowując treść", () => {
    // `reportPlatformError` oczekuje `Error` (czyta `stack`/`name`). Serwerowe
    // funkcje potrafią odrzucić obietnicę napisem, a wtedy bez owinięcia
    // zgłoszenie poleciałoby z `undefined` w każdym polu.
    render(<FriendlyErrorPage error="loader rejected with a string" />);

    expect(h.reports).toHaveLength(1);
    expect(h.reports[0].error).toBeInstanceOf(Error);
    expect((h.reports[0].error as Error).message).toBe("loader rejected with a string");
  });

  it("NIE zgłasza nic, gdy nie ma błędu (ekran użyty jako pusty stan)", () => {
    render(<FriendlyErrorPage />);

    expect(h.reports).toHaveLength(0);
    // Bez błędu klasyfikacja daje `generic`, więc treść jest ogólna.
    expect(screen.getAllByText(errorCopy().genericCode).length).toBeGreaterThan(0);
  });

  it("NIE zgłasza degradacji - serwer zalogował ją już przy zasiewie fallbacku", () => {
    // TO JEST ASERCJA O LICZBIE, nie o braku wyjątku. Render zdegradowany
    // wychodzi z HTTP 200 i jest logowany po stronie serwera (`[ssr-resilient]`).
    // Raport z przeglądarki dublowałby ten sam incydent RAZ NA KAŻDĄ ODSŁONĘ
    // zdegradowanej strony - czyli przy popularnym wpisie zalałby kanał
    // obserwowalności setkami zgłoszeń o czymś, co już jest zapisane, i utopił
    // w nich prawdziwe awarie klienta. Odwrócenie warunku `kind !== "degraded"`
    // jest jednoznakową zmianą i bez tej asercji przeszłoby na zielono.
    const copy = errorCopy();
    render(<FriendlyErrorPage error={DEGRADED_ERROR} />);

    expect(h.reports).toHaveLength(0);

    // Przy okazji: nadlinia i kod NIE mogą sugerować awarii - odpowiedź ma 200.
    expect(screen.getAllByText("200").length).toBeGreaterThan(0);
    expect(screen.getByText(copy.degradedEyebrow)).toBeTruthy();
    expect(screen.queryByText(copy.errorTitle)).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(copy.degraded.title);

    // Degradacja NIE jest brakiem sesji, więc akcją pierwszorzędną jest
    // ponowienie, nie logowanie.
    fireEvent.click(screen.getByRole("button", { name: copy.degraded.primaryAction }));
    expect(h.invalidateCalls).toBe(1);
  });
});

describe("FriendlyErrorPage - wariant `compact`", () => {
  it("rysuje kod, tytuł, kroki i stopkę bez przycisku „Wróć”", () => {
    // Wariant `compact` wchodzi WEWNĄTRZ istniejącego układu (panel admina,
    // sekcja strony), gdzie nawigacja wsteczna należy do powłoki - dlatego
    // „Wróć” go nie dotyczy, a reszta kontraktu jest ta sama co w `page`.
    const copy = errorCopy();
    render(<FriendlyErrorPage error={NETWORK} variant="compact" footer="Sekcja: analizy" />);

    expect(screen.getByText("NET")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(copy.network.title);
    expect(screen.getByText("Sekcja: analizy")).toBeTruthy();
    for (const step of copy.network.steps) expect(screen.getByText(step)).toBeTruthy();
    expect(screen.queryByRole("button", { name: copy.goBack })).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("oba przyciski `compact` działają na routerze", () => {
    const reset = vi.fn();
    const copy = errorCopy();
    render(<FriendlyErrorPage error={NETWORK} variant="compact" reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: copy.network.primaryAction }));
    expect(h.invalidateCalls).toBe(1);
    expect(reset).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: copy.network.secondaryAction }));
    expect(h.navigations).toEqual([{ to: "/" }]);
  });

  it("`compact` przy 401 również daje LINK do logowania i nadpisany tytuł", () => {
    const copy = errorCopy();
    render(
      <FriendlyErrorPage error={UNAUTHORIZED} variant="compact" title="Panel wymaga logowania" />,
    );

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Panel wymaga logowania");
    expect(screen.getByRole("link", { name: copy.unauthorized.primaryAction })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});

describe("FriendlyErrorPage - prefiks językowy", () => {
  it("po przełączeniu na EN skróty i kontakt dostają prefiks `/en`, a treść jest angielska", () => {
    // Ekran błędu renderuje się POZA dostawcą i18next (granica błędu korzenia),
    // więc język czyta wprost z `localeRuntime`. Gdyby prefiks się rozjechał,
    // czytelnik anglojęzyczny z karty błędu trafiałby na polskie trasy - czyli
    // ekran ratunkowy sam wyprowadzałby go z jego wersji serwisu.
    h.lang = "en";
    const copy = errorCopy();
    expect(copy.genericCode).toBe("OOPS...");

    render(<FriendlyErrorPage error={GENERIC} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(copy.generic.title);
    for (const href of ["/en/analizy", "/en/pricing", "/en/kontakt"]) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
    // `/quiz` jest jednojęzyczny (bez prefiksu) - to część kontraktu, nie luka.
    expect(document.querySelector('a[href="/quiz"]')).not.toBeNull();
    expect(screen.getByText(copy.contactLink)).toHaveAttribute("href", "/en/kontakt");
  });
});
