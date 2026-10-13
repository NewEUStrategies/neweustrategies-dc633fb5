// Trasa `/scanner` - adres, który bywa otwierany z linku NIOSĄCEGO
// POŚWIADCZENIE URZĄDZENIA.
//
// CO TEN PLIK DOWODZI (trasa stała na zerowym pokryciu, a jej cała treść to
// kontrakt adresu i nagłówka):
// 1. `noindex, nofollow` I `referrer: no-referrer` TO NIE OZDOBA. Bez
//    `noindex` wyszukiwarka może zindeksować adres skanera, a bez
//    `no-referrer` adres wychodzi w nagłówku odesłania do każdego zasobu, po
//    który strona sięgnie.
// 2. `ssr: false` JEST KONIECZNE. Poświadczenie siedzi w `localStorage`,
//    a kolejka skanów w IndexedDB - serwer nie widzi ani jednego, ani drugiego,
//    więc render serwerowy dawałby zawsze ekran parowania i podmieniał go po
//    hydracji, na oczach kolejki przy bramce.
// 3. TOKEN JEDZIE WE FRAGMENCIE (OPS-07). Link z panelu to `/scanner#t=<token>`:
//    fragmentu przeglądarka nie wysyła na serwer, więc poświadczenie nie trafia
//    do logów pierwszego żądania HTML. Trasa czyta go RAZ i od razu zdejmuje
//    z paska i historii (`history.replaceState`) - wzorzec biletu i raportu
//    sponsora. Trasa NIE MA `validateSearch` przyjmującego `t`.
// 4. STARY LINK `?t=` NIE PARUJE. Token z zapytania już wyciekł do logów -
//    trasa zdejmuje go z adresu, nie podaje aplikacji i każe pokazać prośbę
//    o nowy kod QR. (Dawny `it.fails` o kodzie złego kształtu, który przechodził
//    do aplikacji przez scalanie parametrów routera, jest tym samym zamknięty:
//    trasa w ogóle nie czyta tokenu z parametrów.)
// 5. OSOBNY ORIGIN (OPS-13). Z `VITE_SCANNER_ORIGIN` trasa pod originem
//    portalu przenosi urządzenie pod origin skanera (token we fragmencie) po
//    skasowaniu danych skanera z originu portalu - chyba że leżą tam niewysłane
//    skany: wtedy skaner pracuje dalej z banerem przeniesienia.
// 6. MANIFEST WISI PRZY TEJ TRASIE, nie w nagłówku serwisu: instalowalny ma być
//    skaner, a nie portal.
//
// Sama aplikacja skanera jest ZAŚLEPIONA - jej zachowanie ma własne pliki
// testowe (`ScannerApp.test.tsx` i panele). Tutaj przedmiotem dowodu jest
// WYŁĄCZNIE sklejenie trasy: nagłówek, adres i to, co trasa podaje aplikacji.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

interface AppProps {
  initialToken: string | null;
  notice?: string | null;
  relocateTo?: string | null;
}

const h = vi.hoisted(() => ({
  /** Kolejne propsy, jakie atrapa aplikacji dostała. */
  props: [] as AppProps[],
  /** Ile razy trasa rejestrowała workera powłoki offline. */
  swRegistrations: 0,
  /** Czy pod originem portalu leżą niewysłane skany. */
  holdsWork: false,
  purges: 0,
}));

vi.mock("@/components/events/scanner/organisms/ScannerApp", () => ({
  ScannerApp: (props: AppProps) => {
    h.props.push(props);
    return <div data-testid="scanner-app-stub">{props.initialToken ?? "brak-poświadczenia"}</div>;
  },
}));

// Zwiezla strona bledu ma wlasny plik testowy i ciagnie router (`Link`,
// `useRouter`). Tutaj liczy sie WYLACZNIE to, ktory jej wariant wybiera trasa
// skanera - przy bramce nie ma miejsca na pelna strone z nawigacja serwisu.
vi.mock("@/components/error/FriendlyErrorPage", () => ({
  FriendlyErrorPage: ({ variant }: { variant?: string }) => (
    <div data-testid="strona-bledu">{variant ?? "page"}</div>
  ),
}));

vi.mock("@/lib/events/scannerPwa", () => ({
  registerScannerServiceWorker: () => {
    h.swRegistrations += 1;
  },
}));

vi.mock("@/lib/events/scannerRelocation", () => ({
  holdsScannerWork: () => Promise.resolve(h.holdsWork),
  purgeScannerData: () => {
    h.purges += 1;
    window.localStorage.removeItem("nes.scanner.device-token");
    return Promise.resolve(true);
  },
}));

import { renderRoute, routeHead, type RouteMetaEntry } from "@/test/routeHarness";
import { Route as ScannerRoute } from "@/routes/scanner";

const PATH = "/scanner";

/** Kod o kształcie, który przepuszcza `SCANNER_TOKEN_PATTERN` (16-128 base64url). */
const TOKEN = "nes-scanner-token-0123456789";

/**
 * Adres przeglądarki, z którego trasa czyta wejście. Historia routera w teście
 * jest pamięciowa, a trasa - jak strona biletu i raportu sponsora - czyta
 * `window.location` wprost, więc ustawiamy go tak, jak zrobiłby to link.
 */
function openAt(url: string) {
  window.history.replaceState(null, "", url);
  return renderRoute({ route: ScannerRoute, path: PATH, initialEntry: PATH });
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

function lastProps(): AppProps {
  const last = h.props.at(-1);
  if (last === undefined) throw new Error("test: aplikacja skanera nie została zamontowana");
  return last;
}

beforeEach(() => {
  cleanup();
  h.props = [];
  h.swRegistrations = 0;
  h.holdsWork = false;
  h.purges = 0;
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("trasa /scanner - adres bywa nośnikiem poświadczenia", () => {
  it("jest poza indeksem i poza nagłówkiem odesłania", () => {
    const head = routeHead(ScannerRoute);

    expect(metaContent(head.meta, "robots")).toBe("noindex, nofollow");
    expect(metaContent(head.meta, "referrer")).toBe("no-referrer");
  });

  it("`noindex` widać także z zamontowanej trasy, nie tylko z wywołania head()", async () => {
    const view = await openAt(PATH);

    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(view.meta()).toContainEqual({ name: "referrer", content: "no-referrer" });
  });

  it("render serwerowy jest WYŁĄCZONY - inaczej ekran parowania mrugałby po hydracji", () => {
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

describe("trasa /scanner - poświadczenie we FRAGMENCIE (OPS-07)", () => {
  it("trasa NIE ma `validateSearch` - parametr `t` w zapytaniu nie jest przyjmowany", () => {
    expect(ScannerRoute.options.validateSearch).toBeUndefined();
  });

  it("parowanie fragmentem: token trafia do aplikacji i NATYCHMIAST znika z adresu i historii", async () => {
    await openAt(`${PATH}#t=${TOKEN}`);

    await waitFor(() => expect(h.props.length).toBeGreaterThan(0));
    expect(lastProps()).toEqual({ initialToken: TOKEN, notice: null, relocateTo: null });
    expect(screen.getByTestId("scanner-app-stub")).toHaveTextContent(TOKEN);
    // Wpis historii PODMIENIONY (nie dopisany) na czysty `/scanner`.
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe(PATH);
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("czyszczenie adresu NIE odbiera aplikacji odczytanego poświadczenia", async () => {
    await openAt(`${PATH}#t=${TOKEN}`);
    await waitFor(() => expect(h.props.length).toBeGreaterThan(0));

    expect([...new Set(h.props.map((props) => props.initialToken))]).toEqual([TOKEN]);
  });

  it("kod o złym kształcie we fragmencie NIE dociera do aplikacji, a i tak znika z adresu", async () => {
    await openAt(`${PATH}#t=za-krotki`);
    await waitFor(() => expect(h.props.length).toBeGreaterThan(0));

    expect(lastProps().initialToken).toBeNull();
    expect(window.location.hash).toBe("");
  });

  it("STARY link `?t=` NIE paruje: token nie dociera do aplikacji, znika z adresu, ekran prosi o nowy kod", async () => {
    // Token z zapytania przeszedł już przez logi serwera i historię -
    // użycie go utrwalałoby wyciek (także dawny scenariusz `it.fails`:
    // parametr scalany przez router docierał do aplikacji mimo walidatora).
    await openAt(`${PATH}?t=${TOKEN}`);
    await waitFor(() => expect(h.props.length).toBeGreaterThan(0));

    expect(lastProps()).toEqual({ initialToken: null, notice: "legacy_link", relocateTo: null });
    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("wejście bez parametrów startuje bez poświadczenia i bez komunikatu", async () => {
    await openAt(PATH);
    await waitFor(() => expect(h.props.length).toBeGreaterThan(0));

    expect(lastProps()).toEqual({ initialToken: null, notice: null, relocateTo: null });
  });
});

describe("trasa /scanner - osobny origin skanera (OPS-13)", () => {
  async function routeWithScannerOrigin() {
    vi.stubEnv("VITE_SCANNER_ORIGIN", "https://scan.example.eu");
    vi.resetModules();
    const { Route } = await import("@/routes/scanner");
    return Route;
  }

  it("pod originem portalu bez niewysłanych skanów: dane skanera znikają, a urządzenie jedzie pod origin skanera z tokenem we FRAGMENCIE", async () => {
    const replace = vi.spyOn(window.location, "replace").mockImplementation(() => undefined);
    window.localStorage.setItem("nes.scanner.device-token", TOKEN);
    const Route = await routeWithScannerOrigin();
    window.history.replaceState(null, "", PATH);
    await renderRoute({ route: Route, path: PATH, initialEntry: PATH });

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(`https://scan.example.eu/scanner#t=${TOKEN}`),
    );
    // Token z originu portalu zniknął PRZED przekierowaniem.
    expect(h.purges).toBe(1);
    expect(window.localStorage.getItem("nes.scanner.device-token")).toBeNull();
    // Skaner nie wystartował pod originem portalu ani nie zarejestrował workera.
    expect(h.props).toEqual([]);
    expect(h.swRegistrations).toBe(0);
  });

  it("link z fragmentem otwarty pod originem portalu jedzie dalej ze SWOIM tokenem, a stary link - z komunikatem", async () => {
    const replace = vi.spyOn(window.location, "replace").mockImplementation(() => undefined);
    const Route = await routeWithScannerOrigin();
    window.history.replaceState(null, "", `${PATH}#t=${TOKEN}`);
    await renderRoute({ route: Route, path: PATH, initialEntry: PATH });
    await waitFor(() =>
      expect(replace).toHaveBeenLastCalledWith(`https://scan.example.eu/scanner#t=${TOKEN}`),
    );

    cleanup();
    const Route2 = await routeWithScannerOrigin();
    window.history.replaceState(null, "", `${PATH}?t=${TOKEN}`);
    await renderRoute({ route: Route2, path: PATH, initialEntry: PATH });
    await waitFor(() =>
      expect(replace).toHaveBeenLastCalledWith("https://scan.example.eu/scanner#e=legacy_link"),
    );
  });

  it("niewysłane skany pod originem portalu: skaner pracuje tu dalej, z banerem przeniesienia", async () => {
    const replace = vi.spyOn(window.location, "replace").mockImplementation(() => undefined);
    h.holdsWork = true;
    const Route = await routeWithScannerOrigin();
    window.history.replaceState(null, "", PATH);
    await renderRoute({ route: Route, path: PATH, initialEntry: PATH });

    await waitFor(() => expect(h.props.length).toBeGreaterThan(0));
    expect(lastProps()).toMatchObject({ relocateTo: "https://scan.example.eu" });
    expect(replace).not.toHaveBeenCalled();
    expect(h.purges).toBe(0);
  });
});

describe("trasa /scanner - powłoka aplikacji", () => {
  it("trasa rejestruje workera powłoki offline dokładnie raz na wejście", async () => {
    await openAt(PATH);
    await waitFor(() => expect(h.props.length).toBeGreaterThan(0));

    expect(h.swRegistrations).toBe(1);
  });

  it("ekran skanera jest samodzielną aplikacją w `main`, bez nawigacji serwisu", async () => {
    // Każdy dodatkowy element to miejsce, w które można kliknąć przez pomyłkę
    // w trakcie odprawy.
    await openAt(PATH);

    const app = await screen.findByTestId("scanner-app-stub");
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

  it("strona błędu skanera jest wariantem ZWIĘZŁYM - bez nawigacji i stopki serwisu", () => {
    // Sama tożsamość obu wpisów (przypadek wyżej) nie mówi jeszcze, CO się
    // narysuje. Telefon przy bramce ma ekran wielkości dłoni: pełnoekranowa
    // strona błędu z menu serwisu spycha jedyny przydatny przycisk pod zgięcie.
    const Ekran = ScannerRoute.options.errorComponent;
    if (typeof Ekran !== "function") throw new Error("test: trasa nie ma komponentu błędu");

    render(<Ekran error={new Error("awaria wczytywania")} reset={() => {}} />);

    expect(screen.getByTestId("strona-bledu")).toHaveTextContent("compact");
  });
});
