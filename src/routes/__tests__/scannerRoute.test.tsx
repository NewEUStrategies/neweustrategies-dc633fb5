// Trasa `/scanner` - adres, który bywa otwierany z linku NIOSĄCEGO
// POŚWIADCZENIE URZĄDZENIA.
//
// CO TEN PLIK DOWODZI (trasa stała na zerowym pokryciu, a jej cała treść to
// kontrakt adresu i nagłówka):
// 1. `noindex, nofollow` I `referrer: no-referrer` TO NIE OZDOBA. Link
//    z panelu wygląda tak: `/scanner?t=<poświadczenie>`. Bez `noindex`
//    wyszukiwarka może zindeksować adres razem z parametrem, a bez
//    `no-referrer` poświadczenie wychodzi w nagłówku odesłania do każdego
//    zasobu, po który strona sięgnie.
// 2. `ssr: false` JEST KONIECZNE. Poświadczenie siedzi w `localStorage`,
//    a kolejka skanów w IndexedDB - serwer nie widzi ani jednego, ani drugiego,
//    więc render serwerowy dawałby zawsze ekran parowania i podmieniał go po
//    hydracji, na oczach kolejki przy bramce.
// 3. KSZTAŁT POŚWIADCZENIA SPRAWDZAMY W WALIDATORZE ADRESU: kod o złym
//    kształcie ma nie jechać do bramki. Sam walidator robi swoje (blok
//    „walidacja poświadczenia w adresie"), ale skutek NIE dochodzi do
//    komponentu - patrz `it.fails` na końcu pliku.
// 4. POŚWIADCZENIE NIE ZOSTAJE W ADRESIE. Po pierwszym odczycie wpis w historii
//    jest podmieniany na czysty `/scanner` - inaczej kod zostaje w historii
//    przeglądarki, na zrzucie ekranu i w pasku adresu podanym komuś do ręki.
// 5. MANIFEST WISI PRZY TEJ TRASIE, nie w nagłówku serwisu: instalowalny ma być
//    skaner, a nie portal.
//
// Sama aplikacja skanera jest ZAŚLEPIONA - jej zachowanie ma własne pliki
// testowe (`ScannerApp.test.tsx` i panele). Tutaj przedmiotem dowodu jest
// WYŁĄCZNIE sklejenie trasy: nagłówek, walidacja adresu i to, co trasa podaje
// aplikacji w propsie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Kolejne wartości `initialToken`, jakie atrapa aplikacji dostała w propsie. */
  initialTokens: [] as (string | null)[],
  /** Ile razy trasa rejestrowała workera powłoki offline. */
  swRegistrations: 0,
}));

vi.mock("@/components/events/scanner/organisms/ScannerApp", () => ({
  ScannerApp: ({ initialToken }: { initialToken: string | null }) => {
    h.initialTokens.push(initialToken);
    return <div data-testid="scanner-app-stub">{initialToken ?? "brak-poświadczenia"}</div>;
  },
}));

vi.mock("@/lib/events/scannerPwa", () => ({
  registerScannerServiceWorker: () => {
    h.swRegistrations += 1;
  },
}));

import {
  renderRoute,
  routeHead,
  routeSearchValidator,
  type RouteMetaEntry,
} from "@/test/routeHarness";
import { Route as ScannerRoute } from "@/routes/scanner";

const PATH = "/scanner";

/** Kod o kształcie, który przepuszcza `SCANNER_TOKEN_PATTERN` (16-128 base64url). */
const TOKEN = "nes-scanner-token-0123456789";

function mount(entry = PATH) {
  return renderRoute({ route: ScannerRoute, path: PATH, initialEntry: entry });
}

/**
 * Wartość `content` wpisu meta o danej nazwie - z twardym błędem, gdy wpisu
 * nie ma. Test „przechodzący" na brakującym meta nie dowodzi niczego, a tu
 * brakujący wpis znaczy wyciek poświadczenia.
 */
function metaContent(meta: RouteMetaEntry[] | undefined, name: string): string {
  const found = (meta ?? []).find((entry) => entry.name === name);
  const content = found?.content;
  if (typeof content !== "string") throw new Error(`test: brak meta name="${name}"`);
  return content;
}

/** `href` linku o danym `rel` z `head().links` - patrz `metaContent`. */
function linkHref(links: Record<string, unknown>[] | undefined, rel: string): string {
  const found = (links ?? []).find((entry) => entry.rel === rel);
  const href = found?.href;
  if (typeof href !== "string") throw new Error(`test: brak linku rel="${rel}"`);
  return href;
}

beforeEach(() => {
  cleanup();
  h.initialTokens = [];
  h.swRegistrations = 0;
});

describe("trasa /scanner - adres bywa nośnikiem poświadczenia", () => {
  it("jest poza indeksem i poza nagłówkiem odesłania", () => {
    // Dwa wpisy, jedno uzasadnienie: `/scanner?t=<kod>` nie ma prawa trafić
    // ani do wyszukiwarki, ani do `Referer` wychodzącego żądania.
    const head = routeHead(ScannerRoute);

    expect(metaContent(head.meta, "robots")).toBe("noindex, nofollow");
    expect(metaContent(head.meta, "referrer")).toBe("no-referrer");
  });

  it("`noindex` widać także z zamontowanej trasy, nie tylko z wywołania head()", async () => {
    const view = await mount();

    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(view.meta()).toContainEqual({ name: "referrer", content: "no-referrer" });
  });

  it("render serwerowy jest WYŁĄCZONY - inaczej ekran parowania mrugałby po hydracji", () => {
    // Poświadczenie żyje w `localStorage`, a kolejka w IndexedDB. Serwer nie
    // widzi żadnego z nich, więc każdy render serwerowy tej trasy jest
    // z definicji nieprawdziwy.
    expect(ScannerRoute.options.ssr).toBe(false);
  });

  it("nagłówek niesie tytuł aplikacji i opis bez danych wydarzenia", () => {
    const head = routeHead(ScannerRoute);

    expect(head.meta).toContainEqual({ title: "Skaner NES" });
    expect(metaContent(head.meta, "description")).toBe(
      "Odprawa uczestników, skan leadów i rejestr wydruku identyfikatorów.",
    );
  });

  it("manifest i ikona wiszą PRZY TEJ TRASIE - instalowalny jest skaner, nie portal", () => {
    const head = routeHead(ScannerRoute);

    expect(linkHref(head.links, "manifest")).toBe("/scanner/manifest.webmanifest");
    expect(linkHref(head.links, "apple-touch-icon")).toBe("/scanner/icon-192.png");
  });

  it("nagłówek opisuje aplikację telefonu, a nie stronę serwisu", () => {
    // Widok bez pasków przeglądarki i z obszarem poza wcięciem ekranu -
    // wolontariusz trzyma telefon jedną ręką, w drugiej ma czytnik.
    const head = routeHead(ScannerRoute);

    expect(metaContent(head.meta, "viewport")).toBe(
      "width=device-width, initial-scale=1, viewport-fit=cover",
    );
    expect(metaContent(head.meta, "mobile-web-app-capable")).toBe("yes");
    expect(metaContent(head.meta, "apple-mobile-web-app-capable")).toBe("yes");
    expect(metaContent(head.meta, "apple-mobile-web-app-title")).toBe("NES Scan");
    expect(metaContent(head.meta, "theme-color")).toBe("#141414");
  });
});

describe("trasa /scanner - walidacja poświadczenia w adresie", () => {
  const validate = routeSearchValidator(ScannerRoute);

  it("kod o poprawnym kształcie przechodzi, obcięty z białych znaków", () => {
    expect(validate({ t: `  ${TOKEN}  ` })).toEqual({ t: TOKEN });
  });

  it("kod za krótki NIE dociera do aplikacji", () => {
    // Wzorzec `_event_scanner_device_auth` to 16-128 znaków base64url. Kod
    // urwany przy kopiowaniu linku ma zniknąć z parametrów, a nie pojechać
    // do bramki po odmowę.
    expect(validate({ t: "za-krotki" })).toEqual({});
  });

  it("kod ze znakiem spoza base64url NIE dociera do aplikacji", () => {
    expect(validate({ t: "token z panelu: abcdefghijkl" })).toEqual({});
  });

  it("parametr o innym typie niż napis jest ignorowany", () => {
    // `?t[]=a&t[]=b` i podobne kształty przychodzą jako tablica albo liczba.
    expect(validate({ t: 1234567890 })).toEqual({});
    expect(validate({ t: [TOKEN] })).toEqual({});
    expect(validate({ t: null })).toEqual({});
  });

  it("adres bez parametru zostaje pusty, a obce parametry nie przechodzą", () => {
    // Trasa przyjmuje DOKŁADNIE jeden parametr. Wszystko inne (identyfikatory
    // kampanii, śmieci z czytnika QR) ginie, zamiast wracać w historii.
    expect(validate({})).toEqual({});
    expect(validate({ t: TOKEN, utm_source: "qr", foo: "bar" })).toEqual({ t: TOKEN });
  });
});

describe("trasa /scanner - poświadczenie znika z adresu", () => {
  it("token z linku trafia do aplikacji i NATYCHMIAST wypada z parametrów", async () => {
    // Sedno tej trasy. Aplikacja czyta kod RAZ (`useState`), a wpis w historii
    // jest podmieniany na czysty `/scanner` - poświadczenie nie zostaje ani
    // w pasku adresu, ani w historii przeglądarki.
    const view = await mount(`${PATH}?t=${TOKEN}`);

    expect(h.initialTokens[0]).toBe(TOKEN);
    await waitFor(() => expect(view.search()).toEqual({}));
    expect(view.currentPath()).toBe(PATH);
    expect(screen.getByTestId("scanner-app-stub")).toHaveTextContent(TOKEN);
  });

  it("czyszczenie adresu NIE odbiera aplikacji odczytanego poświadczenia", async () => {
    // Gdyby `initialToken` szedł wprost z parametrów, podmiana adresu
    // wyrzuciłaby operatora z powrotem na ekran parowania w tej samej sekundzie,
    // w której link go sparował.
    const view = await mount(`${PATH}?t=${TOKEN}`);
    await waitFor(() => expect(view.search()).toEqual({}));

    expect(h.initialTokens.length).toBeGreaterThan(0);
    expect([...new Set(h.initialTokens)]).toEqual([TOKEN]);
  });

  it("nawet kod o złym kształcie znika z adresu", async () => {
    // Podmiana wpisu w historii nie ogląda się na kształt: cokolwiek przyszło
    // w `?t=`, ma zniknąć z paska adresu i z historii. To działa.
    const view = await mount(`${PATH}?t=za-krotki`);

    await waitFor(() => expect(view.search()).toEqual({}));
    expect(view.currentPath()).toBe(PATH);
  });

  it("wejście bez parametru startuje bez poświadczenia", async () => {
    await mount();

    expect(h.initialTokens).toEqual([null]);
  });
});

describe("trasa /scanner - powłoka aplikacji", () => {
  it("trasa rejestruje workera powłoki offline dokładnie raz na wejście", async () => {
    await mount();

    expect(h.swRegistrations).toBe(1);
  });

  it("ekran skanera jest samodzielną aplikacją w `main`, bez nawigacji serwisu", async () => {
    // Każdy dodatkowy element to miejsce, w które można kliknąć przez pomyłkę
    // w trakcie odprawy.
    await mount();

    const app = screen.getByTestId("scanner-app-stub");
    expect(app.closest("main")).not.toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("contentinfo")).toBeNull();
  });

  it("błąd i brak trasy prowadzą do TEJ SAMEJ, zwięzłej strony błędu", () => {
    // Przy bramce nie ma miejsca na pełną stronę błędu z nawigacją serwisu -
    // i nie ma powodu, żeby dwie ścieżki awarii wyglądały inaczej.
    expect(ScannerRoute.options.errorComponent).toBe(ScannerRoute.options.notFoundComponent);
    expect(typeof ScannerRoute.options.errorComponent).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// DEFEKT. Test poniżej opisuje zachowanie, którego trasa NIE MA - i dlatego
// jest `it.fails`. Zieleń znaczy, że defekt zniknął i test trzeba przepiąć
// na zwykłe `it`.
// ---------------------------------------------------------------------------
describe("trasa /scanner - defekty", () => {
  it.fails("kod o złym kształcie z linku NIE dociera do aplikacji", async () => {
    // `validateSearch` zwraca `{}` dla kodu o złym kształcie (dowodzi tego blok
    // „walidacja poświadczenia w adresie" wyżej) - ale router NIE ZASTĘPUJE nim
    // parametrów, tylko SCALA jedno z drugim:
    //
    //     preMatchSearch = { ...parentSearch, ...strictSearch }   (router-core)
    //
    // czyli `{ t: "za-krotki" }` scalone z `{}` to nadal `{ t: "za-krotki" }`.
    // W efekcie `Route.useSearch()` oddaje kod, który walidator odrzucił,
    // a trasa podaje go aplikacji jako `initialToken`.
    //
    // KOSZT PRZY BRAMCE. `useScannerRuntime` bierze `initialToken ?? readStoredToken()`,
    // więc byle jakie `?t=` ma PIERWSZEŃSTWO nad działającym poświadczeniem
    // z pamięci urządzenia. Wolontariusz, który otworzył link urwany przy
    // kopiowaniu (dokładnie scenariusz z nagłówka `ScannerPairingCard`) albo
    // dostał adres z cudzym, przypadkowym `?t=`, ląduje na ekranie parowania
    // z komunikatem odmowy - zamiast na wznowionej, już sparowanej sesji.
    //
    // NAPRAWA jest po stronie trasy, nie routera: `useState(isScannerToken(...) ? ... : null)`
    // (walidator adresu zostaje - on odpowiada za kształt `search`, nie za prop).
    await mount(`${PATH}?t=za-krotki`);

    expect(h.initialTokens).toEqual([null]);
    expect(screen.getByTestId("scanner-app-stub")).toHaveTextContent("brak-poświadczenia");
  });
});
