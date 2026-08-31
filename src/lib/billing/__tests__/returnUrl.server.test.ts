// Adres POWROTU po płatności - 0 z 2 funkcji pokrytych do 31.08.2026.
//
// PO CO TEN PLIK ISTNIEJE. `absoluteReturnUrl` buduje adres, który wysyłamy
// OPERATOROWI PŁATNOŚCI jako `return_url` portalu klienta i sesji checkoutu
// (`src/utils/payments.functions.ts` - `createStripePortalSession`). Operator
// odsyła tam przeglądarkę po zakończeniu operacji, więc jest to klasyczna
// powierzchnia OPEN REDIRECT: adres składa się z dwóch części i KAŻDA z nich
// pochodzi z zewnątrz -
//   * ŚCIEŻKA - wprost z ładunku żądania (`data.returnPath`), sanityzowana
//     przez `safeReturnPath` (moduł `returnPath.ts`, testowany osobno);
//   * ORIGIN - z NAGŁÓWKÓW żądania (`origin`, `x-forwarded-proto`,
//     `x-forwarded-host`, `host`), bez żadnej listy dozwolonych hostów.
//
// Ten plik dowodzi obu połówek naprawdę, a nie „na oko": ścieżkę atakujemy
// pełnym repertuarem (obca domena, `//host`, `/\host`, `javascript:`, CRLF,
// przekroczona długość), a origin - podrobionymi nagłówkami. Wynik tej drugiej
// części jest NEGATYWNY i został zarejestrowany jako trzy `it.fails` na końcu
// pliku (opis defektu przy każdym).
//
// `safeReturnPath` biegnie PRAWDZIWY - to jest cała sanityzacja tej ścieżki,
// a test, który by ją atrapował, dowodziłby wyłącznie istnienia atrapy.
// Jedyną atrapą jest GRANICA: kontekst żądania frameworka (`getRequest`).
// Zero sieci, zero sekretów.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_RETURN_PATH } from "@/lib/billing/returnPath";

/** Kontekst żądania - jedyna granica, jaką ten moduł dotyka. */
const h = vi.hoisted(() => ({ request: null as { headers: Headers } | null }));

vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => h.request }));

const { absoluteReturnUrl, requestOrigin } = await import("@/lib/billing/returnUrl.server");

/** Origin serwisu w testach - „nasza" domena, na której powrót ma zostać. */
const NASZ_ORIGIN = "https://neweuropeanstrategies.com";

/** Żądanie z podanymi nagłówkami (bez sieci - sam kontener nagłówków). */
function zadanie(headers: Record<string, string>): void {
  h.request = { headers: new Headers(headers) };
}

beforeEach(() => {
  h.request = null;
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("origin bieżącego żądania", () => {
  it("nagłówek `origin` ma pierwszeństwo przed hostem z proxy", () => {
    // Kolejność źródeł nie jest kosmetyką: w dev/preview to jedyny nagłówek,
    // który niesie SCHEMAT (http na localhoście). Odwrócenie kolejności dałoby
    // adres https na porcie deweloperskim - operator odesłałby w pustkę.
    zadanie({
      origin: "http://localhost:8080",
      "x-forwarded-host": "preview.example.com",
      "x-forwarded-proto": "https",
    });

    expect(requestOrigin()).toBe("http://localhost:8080");
  });

  it("bez `origin` składa adres z `x-forwarded-proto` i `x-forwarded-host`", () => {
    zadanie({ "x-forwarded-proto": "https", "x-forwarded-host": "preview.example.com" });

    expect(requestOrigin()).toBe("https://preview.example.com");
  });

  it("bez nagłówków proxy bierze `host`, a schemat domyśla się na https", () => {
    // Za terminatorem TLS aplikacja widzi ruch po http - domyślne „https"
    // jest tu regułą, nie zgadywanką: adres powrotu po http zostałby przez
    // operatora odrzucony albo zdegradowałby sesję do niezaszyfrowanej.
    zadanie({ host: "neweuropeanstrategies.com" });

    expect(requestOrigin()).toBe(NASZ_ORIGIN);
  });

  it("`x-forwarded-host` wygrywa z `host` (za proxy liczy się host publiczny)", () => {
    zadanie({ host: "wewnetrzny-uslugowy:8080", "x-forwarded-host": "neweuropeanstrategies.com" });

    expect(requestOrigin()).toBe(NASZ_ORIGIN);
  });

  it("bez kontekstu żądania (cron, kolejka) używa PUBLIC_SITE_URL", () => {
    // Ta gałąź jest realna: przypomnienia i webhooki wołają warstwę
    // rozliczeniową poza żądaniem HTTP. Adres z konfiguracji jest wtedy
    // JEDYNYM prawdziwym źródłem domeny serwisu.
    vi.stubEnv("PUBLIC_SITE_URL", "https://konfigurowany.example.com");
    h.request = null;

    expect(requestOrigin()).toBe("https://konfigurowany.example.com");
  });

  it("bez żądania i bez konfiguracji spada na wbudowaną domenę serwisu", () => {
    vi.stubEnv("PUBLIC_SITE_URL", undefined);
    h.request = null;

    expect(requestOrigin()).toBe(NASZ_ORIGIN);
  });

  it("żądanie bez nagłówków `origin`/`host` też schodzi do konfiguracji", () => {
    // `Headers` bez interesujących nas kluczy oddaje `null`, a nie wyjątek -
    // gałąź musi zejść do PUBLIC_SITE_URL, nie zbudować „https://null".
    vi.stubEnv("PUBLIC_SITE_URL", "https://konfigurowany.example.com");
    zadanie({ "user-agent": "vitest" });

    expect(requestOrigin()).toBe("https://konfigurowany.example.com");
  });
});

describe("adres powrotu - ścieżka od klienta (open redirect)", () => {
  beforeEach(() => {
    zadanie({ origin: NASZ_ORIGIN });
  });

  it("poprawna ścieżka względna zachowuje zapytanie i kotwicę", () => {
    expect(absoluteReturnUrl("/events/bilety?tab=platnosci#potwierdzenie")).toBe(
      `${NASZ_ORIGIN}/events/bilety?tab=platnosci#potwierdzenie`,
    );
  });

  it("BEZWZGLĘDNY adres obcej domeny NIE staje się adresem powrotu", () => {
    // Gdyby ładunek żądania mógł podstawić pełny URL, operator odesłałby
    // klienta (razem z parametrami sesji w referrerze) na cudzą stronę
    // wyglądającą jak nasza - to jest cały mechanizm oszustwa „zapłać jeszcze
    // raz". Powrót MUSI zostać na naszej domenie.
    expect(absoluteReturnUrl("https://evil.example.org/zaplac-ponownie")).toBe(
      `${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`,
    );
  });

  it("adres protokołowo-względny `//evil.example.org` jest odrzucony", () => {
    // `//host` w `new URL(...)` przejmuje CAŁY origin, mimo że wygląda jak
    // ścieżka - najczęstszy sposób obejścia naiwnego sprawdzenia „zaczyna się
    // od ukośnika".
    expect(absoluteReturnUrl("//evil.example.org/panel")).toBe(
      `${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`,
    );
  });

  it("wariant z odwrotnym ukośnikiem `/\\evil.example.org` też jest odrzucony", () => {
    // Przeglądarki normalizują `\` do `/`, więc `/\host` działa jak `//host`.
    expect(absoluteReturnUrl("/\\evil.example.org/panel")).toBe(
      `${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`,
    );
  });

  it("schemat `javascript:` nie przechodzi", () => {
    expect(absoluteReturnUrl("javascript:alert(document.cookie)")).toBe(
      `${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`,
    );
  });

  it("schemat udający ścieżkę (`/javascript:...`) nie przechodzi", () => {
    // Ta postać zaczyna się od ukośnika, więc mija sprawdzenie „względna" -
    // odrzuca ją dopiero jawny wzorzec schematu w `safeReturnPath`.
    expect(absoluteReturnUrl("/javascript:alert(1)")).toBe(`${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`);
  });

  it("`data:` w ścieżce nie przechodzi", () => {
    expect(absoluteReturnUrl("/data:text/html;base64,PHNjcmlwdD4=")).toBe(
      `${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`,
    );
  });

  it("CR/LF w ścieżce (wstrzyknięcie nagłówka) jest odrzucone", () => {
    // Adres powrotu ląduje w żądaniu do operatora i w jego przekierowaniu;
    // znak końca wiersza to klasyczny wektor doklejenia własnego nagłówka.
    expect(absoluteReturnUrl("/profile/plan\r\nSet-Cookie: sesja=przejeta")).toBe(
      `${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`,
    );
  });

  it("znak sterujący NUL w ścieżce jest odrzucony", () => {
    expect(absoluteReturnUrl("/profile/\u0000plan")).toBe(`${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`);
  });

  it("ścieżka dłuższa niż limit jest odrzucona", () => {
    // Limit 300 znaków chroni żądanie do operatora przed ładunkiem
    // upchniętym w adresie powrotu.
    expect(absoluteReturnUrl(`/${"a".repeat(301)}`)).toBe(`${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`);
  });

  it("pusty napis i same białe znaki schodzą na domyślną ścieżkę", () => {
    expect(absoluteReturnUrl("")).toBe(`${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`);
    expect(absoluteReturnUrl("   ")).toBe(`${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`);
  });

  it("brak ścieżki (null/undefined) daje domyślny ekran planu", () => {
    expect(absoluteReturnUrl(null)).toBe(`${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`);
    expect(absoluteReturnUrl(undefined)).toBe(`${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`);
  });

  it("własny fallback wywołującego jest użyty zamiast domyślnego", () => {
    // Powrót z checkoutu biletowego wraca na wydarzenie, nie na plan - bez
    // tego parametru każda odmowa lądowałaby w cudzym kontekście.
    expect(absoluteReturnUrl("https://evil.example.org", "/events/kongres")).toBe(
      `${NASZ_ORIGIN}/events/kongres`,
    );
  });

  it("wyjście z katalogu (`/../`) zostaje w obrębie naszej domeny", () => {
    // `new URL` normalizuje `..` - dowodzimy, że normalizacja NIE wyprowadza
    // poza origin (adres pozostaje nasz, zmienia się tylko ścieżka).
    const url = new URL(absoluteReturnUrl("/../../admin/uzytkownicy"));

    expect(url.origin).toBe(NASZ_ORIGIN);
    expect(url.pathname).toBe("/admin/uzytkownicy");
  });

  it("adres powrotu zawsze jest bezwzględny (operator nie przyjmuje względnych)", () => {
    expect(absoluteReturnUrl("/profile/plan").startsWith("https://")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DEFEKTY. Poniższe trzy przypadki są ZAREJESTROWANE, nie naprawione: reguła
// zadania zakazuje zmian w kodzie produkcyjnym, a naprawa nie jest jedną linią
// (wymaga decyzji, która domena jest dozwolona dla KTÓREGO najemcy - repo jest
// wielonajemcowe, hosty siedzą w tabeli `tenants`, a `PUBLIC_SITE_URL` niesie
// tylko jeden adres). To jest projekt bramki, a nie poprawka w teście.
// ---------------------------------------------------------------------------
describe("DEFEKT: origin adresu powrotu pochodzi z nagłówków bez listy dozwolonych", () => {
  it.fails("podrobiony nagłówek `origin` przenosi adres powrotu na obcą domenę", () => {
    // CO JEST ZŁE. `requestOrigin()` bierze `origin` z żądania i używa go bez
    // sprawdzenia, czy to w ogóle nasza domena. Ścieżka jest sanityzowana
    // wzorowo, ale skleja się z ORIGINEM NAPASTNIKA - efekt jest ten sam, co
    // przy open redirect: `return_url` wysyłany operatorowi płatności wskazuje
    // `https://evil.example.org/...`.
    //
    // DLACZEGO TO RYZYKO. Żądanie do server fn nie musi pochodzić z
    // przeglądarki (nagłówek `origin` jest wtedy dowolny), a i w przeglądarce
    // ten adres jest ostatnim, jaki użytkownik widzi po opuszczeniu operatora -
    // fałszywy ekran „płatność nie powiodła się, podaj kartę ponownie" na cudzej
    // domenie jest kompletnym scenariuszem wyłudzenia. Komentarz w
    // `returnPath.ts` obiecuje, że adres powrotu „nie może stać się wektorem
    // open redirect" - obietnica dotyczy tylko połowy adresu.
    //
    // DLACZEGO NIE NAPRAWIAM. Zakaz zmian w kodzie produkcyjnym; poprawka to
    // lista dozwolonych hostów (per najemca) plus decyzja, co robić z ruchem
    // spoza listy - odrzucać czy cicho podmieniać na kanoniczny adres.
    zadanie({ origin: "https://evil.example.org" });

    expect(absoluteReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`);
  });

  it.fails("podrobiony `x-forwarded-host` przenosi adres powrotu na obcą domenę", () => {
    // CO JEST ZŁE. Druga droga do tego samego skutku - i groźniejsza, bo
    // `x-forwarded-host` bywa doklejany przez warstwę pośrednią. Jeżeli
    // KTÓRYKOLWIEK proxy przed aplikacją przepuszcza ten nagłówek od klienta
    // (typowa domyślna konfiguracja), atakujący ustawia go w zwykłym żądaniu.
    //
    // DLACZEGO TO RYZYKO. Poza przekierowaniem: ten sam mechanizm zatruwa
    // każdy bezwzględny adres budowany z „bieżącego origin" (linki w mailach,
    // wpisy w pamięci podręcznej krawędziowej). Tu widać go na powierzchni
    // płatniczej, bo to ona jako pierwsza dostała test.
    //
    // DLACZEGO NIE NAPRAWIAM. Jak wyżej - bramka listy hostów jest decyzją
    // właściciela modułu, a zaufanie do `x-forwarded-*` zależy od konfiguracji
    // krawędzi, której test jednostkowy nie zna.
    zadanie({ "x-forwarded-host": "evil.example.org", "x-forwarded-proto": "https" });

    expect(absoluteReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`);
  });

  it.fails("bezsensowny `x-forwarded-host` wywraca funkcję zamiast zejść na fallback", () => {
    // CO JEST ZŁE. Origin z nagłówka trafia wprost do `new URL(...)`. Host ze
    // spacją (albo z dowolnym znakiem niedozwolonym w nazwie hosta) sprawia,
    // że konstruktor rzuca `TypeError: Invalid URL` - z FUNKCJI, która ma
    // JEDNO zadanie: zawsze oddać bezpieczny adres.
    //
    // DLACZEGO TO RYZYKO. Wyjątek leci przez `createStripePortalSession`,
    // która owija go we własny `catch` i oddaje użytkownikowi błąd zamiast
    // portalu klienta - czyli jednym nagłówkiem da się zablokować anulowanie
    // subskrypcji, zmianę karty i pobranie faktur. Sanityzacja, która przy
    // złym wejściu rzuca zamiast wrócić do wartości domyślnej, jest bramką
    // otwartą na oścież w drugą stronę (odmowa usługi).
    //
    // DLACZEGO NIE NAPRAWIAM. Ta sama przyczyna źródłowa co wyżej (origin bez
    // walidacji) i ta sama naprawa - walidacja hosta w `requestOrigin()`.
    // Rejestruję osobno, bo skutek jest inny: nie przekierowanie, lecz awaria.
    zadanie({ "x-forwarded-host": "evil example.org" });

    expect(absoluteReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`);
  });
});
