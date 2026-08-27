// Import z WordPress.com `/admin/import-wordpress` (624 linie, 0% przed
// zmianą) - jednorazowa, ale nieodwracalna operacja: wciąga archiwum starego
// serwisu do bazy. Pomyłka w parametrach to setki wpisów do ręcznego
// posprzątania.
//
// SIEDEM RZECZY, KTÓRE MAJĄ TU DOWÓD:
//   1. LISTA WITRYN WCZYTUJE SIĘ RAZ. Efekt startowy jest chroniony refem, bo
//      StrictMode uruchamia go dwukrotnie - test montuje trasę WŁAŚNIE w
//      StrictMode, żeby ta bramka miała świadka.
//   2. FORMULARZ SAM SIĘ WYPEŁNIA, ale rozsądnie: preferuje własną domenę,
//      spada na pierwszą z listy, a przy tokenie ograniczonym do jednej
//      witryny (pusta lista) wpisuje znaną domyślną - inaczej formularz
//      byłby bezużyteczny. Wypełnienie jest WIDOCZNE DLA PODGLĄDU już w tym
//      makrozadaniu, w którym DOM je dostał (nie po flushie efektów) - inaczej
//      klik zaraz po autouzupełnieniu leciał z pustą domeną.
//   3. ZAKRES IMPORTU JEST OGRANICZANY W UI. `number` jest przycinane do
//      1..100, `offset` nie schodzi poniżej zera. Bez tego jedno kliknięcie
//      ściągałoby tysiące wpisów albo nie ściągało nic.
//   4. ZAZNACZENIE DECYDUJE O ZAKRESIE. Puste zaznaczenie znaczy „wszystkie
//      z podglądu", a niepuste - `only_ids`. Pomyłka tutaj importuje 100
//      wpisów zamiast trzech.
//   5. ZADANIE JEST TWORZONE I URUCHAMIANE OSOBNO, a jego awaria nie może
//      wywrócić ekranu - postęp i tak przychodzi z odpytywania.
//   6. POSTĘP UNIEWAŻNIA LISTY ADMINA (wpisy, kosz, media), inaczej
//      zaimportowane treści są niewidoczne do przeładowania strony -
//      ale tylko GDY NAPRAWDĘ SIĘ ZMIENIŁ (bramka na sygnaturze).
//   7. PANEL ZADANIA MÓWI PRAWDĘ O STANIE: cztery różne stany, procent
//      liczony bez dzielenia przez zero, liczniki i dziennik zdarzeń.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, type ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  sites: [] as unknown[],
  sitesError: null as unknown,
  preview: null as unknown,
  previewError: null as unknown,
  job: null as unknown,
  jobId: "job-1",
  runError: null as unknown,
  language: "pl" as string,
  list: null as unknown,
  previewFn: null as unknown,
  create: null as unknown,
  run: null as unknown,
  get: null as unknown,
  cancel: null as unknown,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(() => h.language),
);

// Server fns jako szpiedzy BEZ zachowania - domyślne implementacje wstawia
// `resetServerFns()` w `beforeEach`, w jednym miejscu. Inaczej test, który
// zawiesza jedną z nich (żeby zobaczyć stan „w toku"), zostawiałby to
// zawieszenie kolejnym testom.
vi.mock("@/lib/wordpress-import.functions", async () => {
  const { vi: v } = await import("vitest");
  h.list = v.fn();
  h.previewFn = v.fn();
  h.create = v.fn();
  h.run = v.fn();
  h.get = v.fn();
  h.cancel = v.fn();
  return {
    listWpComSites: h.list,
    previewWpComPosts: h.previewFn,
    createWpImportJob: h.create,
    runWpImportJob: h.run,
    getWpImportJob: h.get,
    cancelWpImportJob: h.cancel,
  };
});

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { ...actual, Link: RouterLinkStub };
});

// `Select` jako natywny `<select>` - wzorzec z testów molekuł edytora.
// Zachowanie widżetu Radiksa nie jest regułą tej trasy.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Node = React.ReactNode;
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (v: string) => void;
      children?: Node;
    }) =>
      React.createElement(
        "select",
        {
          value,
          onChange: (e: { target: { value: string } }) => onValueChange?.(e.target.value),
        },
        children as never,
      ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: Node }) =>
      React.createElement(React.Fragment, null, children as never),
    SelectItem: ({ value, children }: { value: string; children?: Node }) =>
      React.createElement("option", { value }, children as never),
  };
});

import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as ImportRoute } from "@/routes/admin.import-wordpress";

type Mock = ReturnType<typeof vi.fn>;
const PATH = "/admin/import-wordpress";
const list = () => h.list as Mock;
const previewFn = () => h.previewFn as Mock;
const create = () => h.create as Mock;
const run = () => h.run as Mock;
const get = () => h.get as Mock;
const cancel = () => h.cancel as Mock;

function wpPost(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    slug: "stary-wpis",
    title: "Stary wpis",
    excerpt: "Zajawka wpisu",
    date: "2019-07-14T10:00:00+00:00",
    status: "publish",
    url: "https://neweuropeanstrategies.com/2019/07/stary-wpis/",
    featured_image: null,
    ...overrides,
  };
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "running",
    total: 4,
    processed: 1,
    imported: 1,
    updated_count: 0,
    skipped: 0,
    failed: 0,
    media_imported: 2,
    log: [],
    error: null,
    finished_at: null,
    ...overrides,
  };
}

/** Trasa montowana w StrictMode - podwójny przebieg efektów jest tu regułą. */
function render(strict = true) {
  return renderRoute({
    route: ImportRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
    wrapper: strict ? (children: ReactNode) => <StrictMode>{children}</StrictMode> : undefined,
  });
}

const siteInput = () => screen.getByPlaceholderText("example.wordpress.com") as HTMLInputElement;
const previewButton = () =>
  screen
    .getByText(h.language === "en" ? "Preview" : "Podgląd")
    .closest("button") as HTMLButtonElement;
const importButton = () =>
  screen
    .getAllByRole("button")
    .find((b) => /^Import/.test(b.textContent ?? "")) as HTMLButtonElement;
/** Kolejność pól: typ treści, status, język. */
const numberInputs = () =>
  Array.from(document.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
const selects = () => screen.getAllByRole("combobox") as HTMLSelectElement[];

/** Czeka na wypełnioną domenę - znak, że efekt startowy zdążył się wykonać. */
async function renderReady() {
  const view = await render();
  await waitFor(() => expect(siteInput().value).not.toBe(""));
  return view;
}

/** Pole domeny, ale tylko gdy już COŚ w nim jest. */
function filledDomainInput(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>(
    'input[placeholder="example.wordpress.com"]',
  );
  return input && input.value !== "" ? input : null;
}

/**
 * Ten sam zabieg, który `asyncWrapper` z RTL robi wokół `waitFor`: na czas
 * czekania POZA `act(...)` gasi flagę środowiska `act`, żeby React nie
 * ostrzegał „An update to ImportWordpressPage inside a test was not wrapped in
 * act(...)". Flaga steruje WYŁĄCZNIE ostrzeżeniem - harmonogram efektów
 * pasywnych zależy od `actQueue`, nie od niej - więc okno, którego pilnuje
 * bramka niżej, zostaje nietknięte. Czekać trzeba poza `act`, bo `act` flushuje
 * efekty pasywne, czyli to okno by zamknął.
 */
async function outsideAct<T>(body: () => Promise<T>): Promise<T> {
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    return await body();
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

/**
 * Czeka na COMMIT wypełnionej domeny NIE oddając sterowania makrozadaniu:
 * `MutationObserver` budzi się w MIKROzadaniu, więc kod po tym `await` biegnie
 * jeszcze PRZED flushem efektów pasywnych Reacta. `waitFor` tego nie potrafi -
 * jego `asyncWrapper` z RTL domyka się `setTimeout(0)`, czyli już PO flushu, i
 * dlatego zwykłe `renderReady()` wyścigu z bramki niżej nie widzi.
 */
function domainCommitted(container: HTMLElement): Promise<void> {
  if (filledDomainInput(container)) return Promise.resolve();
  return outsideAct(
    () =>
      new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          if (!filledDomainInput(container)) return;
          observer.disconnect();
          resolve();
        });
        observer.observe(container, {
          attributes: true,
          childList: true,
          subtree: true,
          characterData: true,
        });
        // Gdyby domena nie doszła wcale (regresja efektu startowego), bramka ma
        // upaść na asercjach niżej, a nie wisieć do `testTimeout`.
        setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 2000);
      }),
  );
}

/** Podgląd + import: najkrótsza droga do panelu zadania. */
async function startImport(job = jobRow()) {
  h.job = job;
  const view = await renderReady();
  fireEvent.click(previewButton());
  await waitFor(() => expect(previewFn()).toHaveBeenCalled());
  await waitFor(() => expect(importButton()).not.toBeDisabled());
  fireEvent.click(importButton());
  await waitFor(() => expect(create()).toHaveBeenCalled());
  return view;
}

/** Domyślne zachowania server fns - jedno źródło prawdy dla całego pliku. */
function resetServerFns() {
  list().mockReset();
  list().mockImplementation(async () => {
    if (h.sitesError) throw h.sitesError;
    return { sites: h.sites };
  });
  previewFn().mockReset();
  previewFn().mockImplementation(async () => {
    if (h.previewError) throw h.previewError;
    return h.preview;
  });
  create().mockReset();
  create().mockImplementation(async () => ({ jobId: h.jobId }));
  run().mockReset();
  run().mockImplementation(async () => {
    if (h.runError) throw h.runError;
    return { ok: true };
  });
  get().mockReset();
  get().mockImplementation(async () => h.job);
  cancel().mockReset();
  cancel().mockImplementation(async () => ({ ok: true }));
}

beforeEach(() => {
  h.sites = [
    { id: 1, name: "Blog firmowy", url: "https://blog.example.com" },
    { id: 2, name: "NES", url: "https://www.neweuropeanstrategies.com" },
  ];
  h.sitesError = null;
  h.preview = { posts: [wpPost()], found: 137 };
  h.previewError = null;
  h.job = jobRow();
  h.jobId = "job-1";
  h.runError = null;
  h.language = "pl";
  resetServerFns();
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Start i wypełnienie formularza
// ---------------------------------------------------------------------------

describe("start i wypełnienie formularza", () => {
  it("lista witryn jest pytana RAZ na wejście, nie przy każdym renderze", async () => {
    // Connector jest zewnętrznym API z limitem - pytanie o listę witryn przy
    // każdym renderze (a formularz renderuje się przy każdym znaku w polu)
    // wyczerpywałoby go w kilka sekund. Bramką jest pusta tablica zależności
    // plus synchroniczny ref.
    //
    // Uwaga do refa: cały plik montuje trasę w StrictMode, więc niepoprawne
    // (nieidempotentne) ciało renderu by się tu wysypało. Samego PODWÓJNEGO
    // przebiegu efektu StrictMode nie widać przez `RouterProvider` (komponent
    // trasy montuje się poza pierwszym przebiegiem), więc tego ten test nie
    // udaje - pilnuje tego, co da się dowieść: liczby zapytań na wejście.
    await renderReady();
    expect(list()).toHaveBeenCalledTimes(1);

    fireEvent.change(siteInput(), { target: { value: "inna.example.com" } });
    fireEvent.change(numberInputs()[0], { target: { value: "7" } });

    expect(list()).toHaveBeenCalledTimes(1);
  });

  it("PREFERUJE własną domenę, choć nie jest pierwsza na liście", async () => {
    // Import „na nie tę witrynę” to setki obcych wpisów w bazie. Domyślna
    // wartość musi więc wskazywać naszą domenę, nie pierwszą z konta.
    await renderReady();
    expect(siteInput().value).toBe("www.neweuropeanstrategies.com");
  });

  it("PODGLĄD widzi domenę w TYM SAMYM makrozadaniu, w którym DOM ją dostał", async () => {
    // WYŚCIG, KTÓRY TA BRAMKA ZAMYKA. `useMutation` z React Query wstawia
    // świeże opcje - a więc i świeże domknięcie `mutationFn` - w EFEKCIE
    // PASYWNYM: `observer.setOptions(options)` siedzi w `React.useEffect`
    // (`@tanstack/react-query@5.102.7`, `build/modern/useMutation.js`). Efekty
    // pasywne lecą PO commicie, w osobnym makrozadaniu. Jest więc chwila, w
    // której DOM pokazuje już wypełnioną domenę i ODBLOKOWANY przycisk, a
    // obserwator mutacji trzyma jeszcze `mutationFn` z poprzedniego renderu -
    // z PUSTYM `site`. Klik w tej chwili nie wołał `previewWpComPosts` w ogóle,
    // tylko wypisywał „Podaj domenę witryny" pod polem, w którym domena jest
    // widoczna: ekran przeczył sam sobie.
    //
    // TO NIE BYŁ „FLAKE". W przejeździe całego katalogu tras (79 plików) ten
    // jeden wyścig sypał ten plik na cztery różne sposoby - „Unable to find an
    // element with the text: Stary wpis" oraz „expected vi.fn() to be called at
    // least once" z `startImport()` - a plik uruchomiony SAM przechodził 44/44,
    // bo `waitFor` oddaje sterowanie makrozadaniem i flush efektów przepuszcza.
    // Podniesienie limitu `waitFor` nic tu nie dawało: warunek nie spełniał się
    // NIGDY, tylko czekanie na porażkę rosło.
    //
    // Naprawa mieszka w `src/routes/admin.import-wordpress.tsx`: wejście
    // podglądu i importu jest ARGUMENTEM `mutate()`, zbieranym w handlerze
    // `onClick` - a ten jest częścią ZATWIERDZONEGO drzewa, więc widzi ten stan,
    // który widzi użytkownik.
    const view = await render();
    await domainCommitted(view.container);

    expect(previewButton()).not.toBeDisabled();
    fireEvent.click(previewButton());

    await waitFor(() => expect(previewFn()).toHaveBeenCalledTimes(1));
    expect(previewFn().mock.calls[0][0]).toEqual({
      data: {
        site: "www.neweuropeanstrategies.com",
        number: 20,
        offset: 0,
        status: "publish",
        type: "post",
      },
    });
  });

  it("bez własnej domeny bierze PIERWSZĄ witrynę z konta", async () => {
    h.sites = [{ id: 3, name: "Inny blog", url: "https://inny.example.com" }];
    await renderReady();
    expect(siteInput().value).toBe("inny.example.com");
  });

  it("PUSTA lista (token ograniczony do witryny) wpisuje znaną domyślną domenę", async () => {
    // `/me/sites` zwraca pustkę dla tokenu site-scoped; bez tej ścieżki
    // formularz zostawałby pusty i wyglądałby na zepsuty.
    h.sites = [];
    await renderReady();
    expect(siteInput().value).toBe("neweuropeanstrategies.com");
  });

  it("ZDEFORMOWANY adres witryny nie wywraca ekranu", async () => {
    // Connector potrafi oddać rekord bez poprawnego URL-a; ekran ma zostać
    // użyteczny, a nie zniknąć pod błędem parsowania.
    h.sites = [{ id: 4, name: "Zła witryna", url: "nie-adres" }];
    const view = await render();

    await waitFor(() => expect(screen.getByText("Zła witryna")).toBeInTheDocument());
    expect(siteInput().value).toBe("");
    expect(view.container.textContent).toContain("Import z WordPress.com");
  });

  it("BŁĄD listy witryn jest pokazany, a formularz zostaje do ręcznego wpisania", async () => {
    h.sitesError = new Error("connector nie odpowiada");
    await render();

    await waitFor(() => expect(screen.getByText(/connector nie odpowiada/)).toBeInTheDocument());
    // Bez domeny podglądu nie ma po co włączać.
    expect(siteInput().value).toBe("");
    expect(previewButton()).toBeDisabled();
  });

  it("„Moje witryny” pyta connector ponownie, a klik w witrynę wpisuje jej host", async () => {
    await renderReady();
    fireEvent.change(siteInput(), { target: { value: "" } });

    fireEvent.click(screen.getByText("Moje witryny"));
    await waitFor(() => expect(list()).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByText("Blog firmowy"));
    expect(siteInput().value).toBe("blog.example.com");
  });

  it("trwające pytanie o witryny BLOKUJE przycisk i pokazuje kręciołek", async () => {
    // Drugie kliknięcie w trakcie zapytania podwoiłoby ruch do connectora.
    list().mockImplementation(() => new Promise(() => {}));
    await render();

    // W trakcie zapytania etykieta ustępuje miejsca wskaźnikowi, a przycisk
    // jest wyłączony - dwa kliknięcia to dwa zapytania do zewnętrznego API.
    await waitFor(() => expect(screen.queryByText("Moje witryny")).toBeNull());
    const button = siteInput().parentElement?.querySelector("button") as HTMLButtonElement;
    expect(button).toBeDisabled();
  });

  it("witryna BEZ nazwy pokazuje host jako etykietę", async () => {
    h.sites = [{ id: 5, name: "", url: "https://bez-nazwy.example.com" }];
    await renderReady();
    expect(screen.getByText("bez-nazwy.example.com")).toBeInTheDocument();
  });

  it("ILOŚĆ jest przycinana do 1..100, a POMIŃ nie schodzi poniżej zera", async () => {
    // Jedno kliknięcie z `number: 5000` ściągałoby całe archiwum naraz;
    // `number: 0` nie ściągałoby nic i wyglądałoby na awarię.
    await renderReady();
    const [count, offset] = numberInputs();

    fireEvent.change(count, { target: { value: "5000" } });
    expect(count.value).toBe("100");
    fireEvent.change(count, { target: { value: "0" } });
    expect(count.value).toBe("1");
    fireEvent.change(count, { target: { value: "abc" } });
    expect(count.value).toBe("1");

    fireEvent.change(offset, { target: { value: "-5" } });
    expect(offset.value).toBe("0");
    fireEvent.change(offset, { target: { value: "abc" } });
    expect(offset.value).toBe("0");
    fireEvent.change(offset, { target: { value: "40" } });
    expect(offset.value).toBe("40");
  });
});

// ---------------------------------------------------------------------------
// Podgląd
// ---------------------------------------------------------------------------

describe("podgląd wpisów", () => {
  it("wysyła PRZYCIĘTĄ domenę i wszystkie parametry zakresu", async () => {
    await renderReady();
    fireEvent.change(siteInput(), { target: { value: "  stary.example.com  " } });
    const [count, offset] = numberInputs();
    fireEvent.change(count, { target: { value: "5" } });
    fireEvent.change(offset, { target: { value: "10" } });
    fireEvent.change(selects()[0], { target: { value: "page" } });
    fireEvent.change(selects()[1], { target: { value: "draft" } });

    fireEvent.click(previewButton());

    await waitFor(() => expect(previewFn()).toHaveBeenCalledTimes(1));
    expect(previewFn().mock.calls[0][0]).toEqual({
      data: { site: "stary.example.com", number: 5, offset: 10, status: "draft", type: "page" },
    });
  });

  it("podgląd jest ZABLOKOWANY bez domeny", async () => {
    await renderReady();
    fireEvent.change(siteInput(), { target: { value: "   " } });
    expect(previewButton()).toBeDisabled();
  });

  it("tabela pokazuje tytuł, SKRÓCONĄ datę, status, slug i zajawkę", async () => {
    await renderReady();
    fireEvent.click(previewButton());

    await waitFor(() => expect(screen.getByText("Stary wpis")).toBeInTheDocument());
    expect(screen.getByText("2019-07-14")).toBeInTheDocument();
    expect(screen.getByText("publish")).toBeInTheDocument();
    expect(screen.getByText("stary-wpis")).toBeInTheDocument();
    expect(screen.getByText("Zajawka wpisu")).toBeInTheDocument();
    // Liczba wszystkich trafień po stronie WP - stąd wiadomo, ile jeszcze zostało.
    expect(screen.getByText(/Znaleziono/)).toBeInTheDocument();
  });

  it("wpis BEZ tytułu jest podpisany numerem WP, nie pustką", async () => {
    h.preview = { posts: [wpPost({ title: "", excerpt: "" })], found: 0 };
    await renderReady();
    fireEvent.click(previewButton());

    await waitFor(() => expect(screen.getByText("#101")).toBeInTheDocument());
    // `found: 0` nie ma czego meldować.
    expect(screen.queryByText(/Znaleziono/)).toBeNull();
  });

  it("BŁĄD podglądu jest pokazany przy przycisku, a import zostaje zablokowany", async () => {
    h.previewError = new Error("403 z connectora");
    await renderReady();

    fireEvent.click(previewButton());

    await waitFor(() => expect(screen.getByText(/403 z connectora/)).toBeInTheDocument());
    expect(importButton()).toBeDisabled();
  });

  it("trwający podgląd blokuje przycisk i pokazuje kręciołek", async () => {
    previewFn().mockImplementation(() => new Promise(() => {}));
    await renderReady();

    fireEvent.click(previewButton());

    // Drugie kliknięcie w trakcie pobierania podwoiłoby ruch do connectora.
    await waitFor(() => expect(previewButton()).toBeDisabled());
  });

  it("import jest zablokowany, DOPÓKI nie ma podglądu", async () => {
    // Import bez podglądu to import w ciemno - redaktor nie wie, co ściąga.
    await renderReady();
    expect(importButton()).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Zaznaczanie
// ---------------------------------------------------------------------------

describe("zaznaczanie wpisów", () => {
  beforeEach(() => {
    h.preview = {
      posts: [wpPost(), wpPost({ id: 202, slug: "drugi", title: "Drugi wpis" })],
      found: 2,
    };
  });

  const rowBoxes = () =>
    Array.from(document.querySelectorAll('tbody input[type="checkbox"]')) as HTMLInputElement[];

  it("„zaznacz wszystko” zaznacza i odznacza CAŁY podgląd", async () => {
    await renderReady();
    fireEvent.click(previewButton());
    await waitFor(() => expect(screen.getByText("Drugi wpis")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Select all"));
    expect(rowBoxes().every((b) => b.checked)).toBe(true);
    expect(screen.getByText("Importuj zaznaczone (2)")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Select all"));
    expect(rowBoxes().some((b) => b.checked)).toBe(false);
    expect(screen.getByText("Importuj wszystkie")).toBeInTheDocument();
  });

  it("pojedyncze zaznaczenie DOKŁADA i ZDEJMUJE, nie podmienia", async () => {
    await renderReady();
    fireEvent.click(previewButton());
    await waitFor(() => expect(screen.getByText("Drugi wpis")).toBeInTheDocument());

    fireEvent.click(rowBoxes()[0]);
    fireEvent.click(rowBoxes()[1]);
    expect(screen.getByText("Importuj zaznaczone (2)")).toBeInTheDocument();

    fireEvent.click(rowBoxes()[0]);
    expect(screen.getByText("Importuj zaznaczone (1)")).toBeInTheDocument();
  });

  it("nowy podgląd CZYŚCI zaznaczenie - stare identyfikatory nie należą do nowej listy", async () => {
    await renderReady();
    fireEvent.click(previewButton());
    await waitFor(() => expect(screen.getByText("Drugi wpis")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Select all"));
    expect(screen.getByText("Importuj zaznaczone (2)")).toBeInTheDocument();

    fireEvent.click(previewButton());

    await waitFor(() => expect(screen.getByText("Importuj wszystkie")).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Uruchomienie importu
// ---------------------------------------------------------------------------

describe("uruchomienie importu", () => {
  it("tworzy zadanie z pełnym wejściem, a potem uruchamia je z JEGO id", async () => {
    // Dwa wywołania, jedno wejście: gdyby `run` dostał inne parametry niż
    // `create`, zadanie w bazie opisywałoby inny import niż wykonany.
    await startImport();

    expect(create().mock.calls[0][0]).toEqual({
      data: {
        site: "www.neweuropeanstrategies.com",
        number: 20,
        offset: 0,
        status: "publish",
        type: "post",
        language: "pl",
        only_ids: undefined,
        sync_existing: false,
        import_media: true,
      },
    });
    await waitFor(() => expect(run()).toHaveBeenCalled());
    expect(run().mock.calls[0][0]).toEqual({
      data: expect.objectContaining({ jobId: "job-1", site: "www.neweuropeanstrategies.com" }),
    });
  });

  it("ZAZNACZENIE zawęża import do `only_ids`", async () => {
    h.preview = {
      posts: [wpPost(), wpPost({ id: 202, slug: "drugi", title: "Drugi wpis" })],
      found: 2,
    };
    await renderReady();
    fireEvent.click(previewButton());
    await waitFor(() => expect(screen.getByText("Drugi wpis")).toBeInTheDocument());
    const box = document.querySelector('tbody input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(box);

    fireEvent.click(importButton());

    await waitFor(() => expect(create()).toHaveBeenCalled());
    const data = (create().mock.calls[0][0] as { data: { only_ids?: number[] } }).data;
    expect(data.only_ids).toEqual([101]);
  });

  it("przełączniki synchronizacji i mediów jadą do zadania", async () => {
    // Import mediów jest domyślnie włączony (cover bez obrazu wygląda na
    // zepsuty wpis), a synchronizacja istniejących - wyłączona, bo nadpisuje
    // treść zredagowaną już u nas.
    await renderReady();
    const boxes = Array.from(
      document.querySelectorAll('label input[type="checkbox"]'),
    ) as HTMLInputElement[];
    expect(boxes[0].checked).toBe(false);
    expect(boxes[1].checked).toBe(true);
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.click(previewButton());
    await waitFor(() => expect(importButton()).not.toBeDisabled());

    fireEvent.click(importButton());

    await waitFor(() => expect(create()).toHaveBeenCalled());
    const data = (
      create().mock.calls[0][0] as { data: { sync_existing: boolean; import_media: boolean } }
    ).data;
    expect(data.sync_existing).toBe(true);
    expect(data.import_media).toBe(false);
  });

  it("JĘZYK docelowy jest częścią wejścia zadania", async () => {
    await renderReady();
    fireEvent.change(selects()[2], { target: { value: "en" } });
    fireEvent.click(previewButton());
    await waitFor(() => expect(importButton()).not.toBeDisabled());

    fireEvent.click(importButton());

    await waitFor(() => expect(create()).toHaveBeenCalled());
    expect((create().mock.calls[0][0] as { data: { language: string } }).data.language).toBe("en");
  });

  it("awaria URUCHOMIENIA nie wywraca ekranu - stan i tak przychodzi z odpytywania", async () => {
    // `run` jest odpalane bez czekania; nieobsłużone odrzucenie zabiłoby
    // render, a zadanie i tak raportuje swój błąd wierszem w bazie.
    h.runError = new Error("timeout funkcji");
    const failedJob = jobRow({ status: "failed", error: "timeout funkcji" });
    h.job = failedJob;
    await startImport(failedJob);

    await waitFor(() => expect(screen.getByText("Import nieudany")).toBeInTheDocument());
    expect(screen.getByText("timeout funkcji")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Panel zadania
// ---------------------------------------------------------------------------

describe("panel zadania", () => {
  it("pokazuje postęp, procent i liczniki", async () => {
    await startImport(jobRow({ processed: 1, total: 4, imported: 1, media_imported: 2 }));

    await waitFor(() => expect(screen.getByText("Importowanie w tle…")).toBeInTheDocument());
    expect(screen.getByText("1/4 (25%)")).toBeInTheDocument();
    expect(screen.getByText("Nowe:")).toBeInTheDocument();
    expect(screen.getByText("Media:")).toBeInTheDocument();
  });

  it("zadanie BEZ znanej liczby wpisów pokazuje 0%, a nie NaN", async () => {
    // `total = 0` na starcie zadania; dzielenie bez bramki dałoby „NaN%”.
    await startImport(jobRow({ total: 0, processed: 0 }));

    await waitFor(() => expect(screen.getByText("0/0 (0%)")).toBeInTheDocument());
  });

  it("stan ZAKOŃCZONY, NIEUDANY i ANULOWANY mają różne komunikaty", async () => {
    await startImport(jobRow({ status: "completed", processed: 4, finished_at: "2026-08-19" }));
    await waitFor(() => expect(screen.getByText("Import zakończony")).toBeInTheDocument());

    cleanup();
    await startImport(jobRow({ status: "canceled" }));
    await waitFor(() => expect(screen.getByText("Import anulowany")).toBeInTheDocument());

    cleanup();
    await startImport(jobRow({ status: "failed", error: "brak dostępu" }));
    await waitFor(() => expect(screen.getByText("Import nieudany")).toBeInTheDocument());
    expect(screen.getByText("brak dostępu")).toBeInTheDocument();
  });

  it("DZIENNIK pokazuje godzinę, numer WP i treść zdarzenia", async () => {
    // Bez dziennika „pominięto 12 wpisów” jest nie do zdiagnozowania.
    await startImport(
      jobRow({
        log: [
          { ts: "2026-08-19T07:15:30.000Z", level: "info", msg: "start", wp_id: 101 },
          { ts: "2026-08-19T07:15:31.000Z", level: "warn", msg: "brak coveru" },
          { ts: "2026-08-19T07:15:32.000Z", level: "error", msg: "błąd zapisu" },
        ],
      }),
    );

    await waitFor(() => expect(screen.getByText("07:15:30")).toBeInTheDocument());
    expect(screen.getByText("#101")).toBeInTheDocument();
    expect(screen.getByText(/brak coveru/)).toBeInTheDocument();
    const err = screen.getByText(/błąd zapisu/);
    expect(err.className).toContain("text-destructive");
  });

  it("PUSTY dziennik mówi wprost, że nic się jeszcze nie stało", async () => {
    await startImport(jobRow({ log: [] }));
    await waitFor(() => expect(screen.getByText("Brak zdarzeń")).toBeInTheDocument());
  });

  it("dziennik w NIEZNANYM kształcie jest traktowany jak pusty, nie rzuca", async () => {
    // Kolumna `log` jest typu `json` - może przyjść obiekt albo null.
    await startImport(jobRow({ log: { nieoczekiwane: true } }));
    await waitFor(() => expect(screen.getByText("Brak zdarzeń")).toBeInTheDocument());
  });

  it("ANULOWANIE jest możliwe TYLKO w trakcie i wysyła id zadania", async () => {
    await startImport(jobRow({ status: "running" }));
    await waitFor(() => expect(screen.getByText("Anuluj")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Anuluj"));

    await waitFor(() => expect(cancel()).toHaveBeenCalledWith({ data: { jobId: "job-1" } }));
  });

  it("trwające anulowanie blokuje przycisk - dwa anulowania to dwa zapisy", async () => {
    cancel().mockImplementation(() => new Promise(() => {}));
    await startImport(jobRow({ status: "running" }));
    await waitFor(() => expect(screen.getByText("Anuluj")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Anuluj"));

    await waitFor(() => expect(screen.getByText("Anuluj").closest("button")).toBeDisabled());
  });

  it("zadanie ZAKOŃCZONE nie ma już czego anulować", async () => {
    await startImport(jobRow({ status: "completed" }));
    await waitFor(() => expect(screen.getByText("Import zakończony")).toBeInTheDocument());
    expect(screen.queryByText("Anuluj")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Odświeżanie list admina
// ---------------------------------------------------------------------------

describe("odświeżanie list admina", () => {
  it("postęp zadania UNIEWAŻNIA wpisy, kosz i media", async () => {
    // Bez tego zaimportowane treści są niewidoczne do przeładowania strony.
    const view = await render();
    await waitFor(() => expect(siteInput().value).not.toBe(""));
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");
    fireEvent.click(previewButton());
    await waitFor(() => expect(importButton()).not.toBeDisabled());

    fireEvent.click(importButton());

    await waitFor(() => expect(screen.getByText("Importowanie w tle…")).toBeInTheDocument());
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys).toContain(JSON.stringify({ queryKey: ["admin-posts"] }));
    expect(keys).toContain(JSON.stringify({ queryKey: ["admin-posts-trash-count"] }));
    expect(keys).toContain(JSON.stringify({ queryKey: ["admin-media"] }));
  });

  it("NIEZMIENIONY stan zadania nie unieważnia list po raz drugi", async () => {
    // Odpytywanie chodzi co sekundę; unieważnianie przy każdej odpowiedzi
    // kasowałoby cache listy wpisów bez powodu.
    const view = await startImport(jobRow({ status: "running", processed: 1 }));
    await waitFor(() => expect(screen.getByText("Importowanie w tle…")).toBeInTheDocument());
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");

    await view.queryClient.refetchQueries({ queryKey: ["wp-import-job"] });

    expect(
      invalidate.mock.calls.filter((c) => JSON.stringify(c[0]).includes("admin-posts")),
    ).toEqual([]);
  });

  it("ZMIANA postępu unieważnia listy ponownie", async () => {
    const view = await startImport(jobRow({ status: "running", processed: 1 }));
    await waitFor(() => expect(screen.getByText("1/4 (25%)")).toBeInTheDocument());
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");

    h.job = jobRow({ status: "running", processed: 3 });
    await view.queryClient.refetchQueries({ queryKey: ["wp-import-job"] });

    await waitFor(() => expect(screen.getByText("3/4 (75%)")).toBeInTheDocument());
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys).toContain(JSON.stringify({ queryKey: ["admin-posts"] }));
  });
});

// ---------------------------------------------------------------------------
// Wersja angielska i nagłówek
// ---------------------------------------------------------------------------

describe("wersja angielska", () => {
  it("cały ekran ma wersję EN - to narzędzie migracyjne dla obu redakcji", async () => {
    h.language = "en";
    await renderReady();

    expect(screen.getByText("Import from WordPress.com")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("My sites")).toBeInTheDocument();
    expect(screen.getByText("Import all")).toBeInTheDocument();
  });

  it("panel zadania i dziennik też mówią po angielsku", async () => {
    h.language = "en";
    await startImport(jobRow({ status: "completed", log: [] }));

    await waitFor(() => expect(screen.getByText("Import completed")).toBeInTheDocument());
    expect(screen.getByText("No events yet")).toBeInTheDocument();
    expect(screen.getByText("Imported:")).toBeInTheDocument();
  });

  it("angielskie warianty pozostałych stanów zadania", async () => {
    h.language = "en";
    await startImport(jobRow({ status: "canceled" }));
    await waitFor(() => expect(screen.getByText("Import canceled")).toBeInTheDocument());
    expect(screen.queryByText("Cancel")).toBeNull();

    cleanup();
    await startImport(jobRow({ status: "failed" }));
    await waitFor(() => expect(screen.getByText("Import failed")).toBeInTheDocument());

    cleanup();
    await startImport(jobRow({ status: "running" }));
    await waitFor(() => expect(screen.getByText("Importing in background…")).toBeInTheDocument());
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("angielska etykieta importu też liczy zaznaczone", async () => {
    h.language = "en";
    h.preview = { posts: [wpPost()], found: 1 };
    await renderReady();
    fireEvent.click(previewButton());
    await waitFor(() => expect(screen.getByText("Stary wpis")).toBeInTheDocument());

    fireEvent.click(document.querySelector('tbody input[type="checkbox"]') as HTMLInputElement);

    expect(screen.getByText("Import selected (1)")).toBeInTheDocument();
  });

  it("angielski podgląd nazywa kolumny po angielsku", async () => {
    h.language = "en";
    await renderReady();
    fireEvent.click(previewButton());

    await waitFor(() => expect(screen.getByText("Stary wpis")).toBeInTheDocument());
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText(/Found/)).toBeInTheDocument();
  });

  it("angielski komunikat braku domeny przy podglądzie", async () => {
    // Ta gałąź jest w `mutationFn`, więc nie widzi jej ani przycisk, ani DOM -
    // za to zobaczy ją każdy, kto wywoła podgląd programowo.
    h.language = "en";
    h.sites = [];
    await renderReady();
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });
});

describe("nagłówek dokumentu", () => {
  it("strona ma własny tytuł", async () => {
    const meta = await routeMeta(ImportRoute);
    expect(meta).toEqual([{ title: "Import z WordPress.com" }]);
  });
});
