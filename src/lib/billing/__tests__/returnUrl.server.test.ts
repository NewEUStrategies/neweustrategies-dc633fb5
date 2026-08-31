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
//     `x-forwarded-host`, `host`), które do 31.08.2026 nie miały ŻADNEJ listy
//     dozwolonych hostów (trzy defekty zarejestrowane wtedy jako `it.fails`,
//     dziś naprawione i zielone - opis przy każdym na końcu pliku).
//
// Ten plik dowodzi obu połówek naprawdę, a nie „na oko": ścieżkę atakujemy
// pełnym repertuarem (obca domena, `//host`, `/\host`, `javascript:`, CRLF,
// przekroczona długość), a origin - podrobionymi nagłówkami.
//
// `safeReturnPath` biegnie PRAWDZIWY - to jest cała sanityzacja tej ścieżki,
// a test, który by ją atrapował, dowodziłby wyłącznie istnienia atrapy.
// Jedyną atrapą jest GRANICA: kontekst żądania frameworka (`getRequest`).
// Zero sieci, zero sekretów.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_RETURN_PATH } from "@/lib/billing/returnPath";

/** Kontekst żądania - jedyna granica, jaką ten moduł dotyka. */
const h = vi.hoisted(() => ({
  request: null as { headers: Headers } | null,
  /** Kontekst zadania poza zadaniem (cron, kolejka) - `getRequest` wtedy rzuca. */
  throws: false,
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (h.throws) throw new Error("poza kontekstem zadania");
    return h.request;
  },
}));

const { absoluteReturnUrl, requestOrigin } = await import("@/lib/billing/returnUrl.server");

/** Origin serwisu w testach - „nasza" domena, na której powrót ma zostać. */
const NASZ_ORIGIN = "https://neweuropeanstrategies.com";

/** Żądanie z podanymi nagłówkami (bez sieci - sam kontener nagłówków). */
function zadanie(headers: Record<string, string>): void {
  h.request = { headers: new Headers(headers) };
}

beforeEach(() => {
  h.request = null;
  // Flaga „poza kontekstem zadania" MUSI wracac do falszu - inaczej pierwszy
  // test, ktory ja podniesie, wylaczylby kontekst zadania wszystkim kolejnym.
  h.throws = false;
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
// DEFEKTY NAPRAWIONE. Poniższe trzy przypadki były ZAREJESTROWANE jako
// świadomie czerwone (`it.fails`), bo naprawa nie była jedną linią: wymagała
// projektu bramki dla repo WIELONAJEMCOWEGO (hosty najemców siedzą w tabeli
// `tenants`, a `PUBLIC_SITE_URL` niesie tylko jeden adres) i decyzji, co robić
// z hostem spoza listy - odrzucać czy podmieniać na kanoniczny.
//
// JAK NAPRAWIONO (wspólnie dla całej trójki): `absoluteReturnUrl` nie skleja
// już adresu z surowym nagłówkiem - origin przechodzi przez bramkę
// dozwolonych hostów (kanoniczny `PUBLIC_SITE_URL` + hosty marki + lokalny dev
// + domeny najemców z `BILLING_RETURN_HOSTS`), a wszystko spoza listy ORAZ
// wszystko, czego nie da się sparsować, CICHO schodzi na origin kanoniczny.
// Uzasadnienie wariantu (podmiana zamiast odrzucenia) i powód, dla którego
// bramka nie pyta bazy o `tenants`, stoją w nagłówku `returnUrl.server.ts`.
// Te przypadki są teraz bramkami regresji: mają zostać ZIELONE.
// ---------------------------------------------------------------------------
describe("origin adresu powrotu przechodzi przez listę dozwolonych hostów", () => {
  it("podrobiony nagłówek `origin` NIE przenosi adresu powrotu na obcą domenę", () => {
    // CO BYŁO ZŁE. `absoluteReturnUrl` brało `origin` z żądania i używało go
    // bez sprawdzenia, czy to w ogóle nasza domena. Ścieżka była sanityzowana
    // wzorowo, ale sklejała się z ORIGINEM NAPASTNIKA - efekt ten sam, co przy
    // open redirect: `return_url` wysyłany operatorowi płatności wskazywał
    // `https://evil.example.org/...`.
    //
    // JAKIE TO BYŁO RYZYKO. Żądanie do server fn nie musi pochodzić z
    // przeglądarki (nagłówek `origin` jest wtedy dowolny), a i w przeglądarce
    // ten adres jest ostatnim, jaki użytkownik widzi po opuszczeniu operatora -
    // fałszywy ekran „płatność nie powiodła się, podaj kartę ponownie" na cudzej
    // domenie jest kompletnym scenariuszem wyłudzenia. Komentarz w
    // `returnPath.ts` obiecywał, że adres powrotu „nie może stać się wektorem
    // open redirect" - obietnica dotyczyła tylko połowy adresu.
    //
    // JAK NAPRAWIONO. Origin z nagłówka jest przepuszczany przez listę
    // dozwolonych hostów (`returnHostIsAllowed`), a host spoza listy schodzi
    // na origin kanoniczny.
    zadanie({ origin: "https://evil.example.org" });

    expect(absoluteReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`);
  });

  it("podrobiony `x-forwarded-host` NIE przenosi adresu powrotu na obcą domenę", () => {
    // CO BYŁO ZŁE. Druga droga do tego samego skutku - i groźniejsza, bo
    // `x-forwarded-host` bywa doklejany przez warstwę pośrednią. Jeżeli
    // KTÓRYKOLWIEK proxy przed aplikacją przepuszcza ten nagłówek od klienta
    // (typowa domyślna konfiguracja), atakujący ustawiał go w zwykłym żądaniu.
    //
    // JAKIE TO BYŁO RYZYKO. Poza przekierowaniem: ten sam mechanizm zatruwa
    // każdy bezwzględny adres budowany z „bieżącego origin" (linki w mailach,
    // wpisy w pamięci podręcznej krawędziowej). Tu widać go na powierzchni
    // płatniczej, bo to ona jako pierwsza dostała test.
    //
    // JAK NAPRAWIONO. Ta sama bramka co wyżej obejmuje OBA źródła originu -
    // nagłówek `origin` i host złożony z `x-forwarded-proto`/`x-forwarded-host`
    // (oraz `host`); żaden z nich nie trafia do adresu bez dopasowania do listy.
    zadanie({ "x-forwarded-host": "evil.example.org", "x-forwarded-proto": "https" });

    expect(absoluteReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`);
  });

  it("bezsensowny `x-forwarded-host` schodzi na fallback zamiast wywracać funkcję", () => {
    // CO BYŁO ZŁE. Origin z nagłówka trafiał wprost do `new URL(...)`. Host ze
    // spacją (albo z dowolnym znakiem niedozwolonym w nazwie hosta) sprawiał,
    // że konstruktor rzucał `TypeError: Invalid URL` - z FUNKCJI, która ma
    // JEDNO zadanie: zawsze oddać bezpieczny adres.
    //
    // JAKIE TO BYŁO RYZYKO. Wyjątek leciał przez `createStripePortalSession`,
    // która owija go we własny `catch` i oddaje użytkownikowi błąd zamiast
    // portalu klienta - czyli jednym nagłówkiem dało się zablokować anulowanie
    // subskrypcji, zmianę karty i pobranie faktur. Sanityzacja, która przy
    // złym wejściu rzuca zamiast wrócić do wartości domyślnej, jest bramką
    // otwartą na oścież w drugą stronę (odmowa usługi).
    //
    // JAK NAPRAWIONO. Rozbiór kandydata na origin siedzi w `parseHttpOrigin`
    // z własnym `try/catch`: nieparsowalny host daje `null` (czyli zejście na
    // origin kanoniczny), a `absoluteReturnUrl` ma dodatkowo `catch` ostatniej
    // szansy - nie ma drogi, którą ta funkcja rzuca.
    zadanie({ "x-forwarded-host": "evil example.org" });

    expect(absoluteReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}${DEFAULT_RETURN_PATH}`);
  });
});

// ---------------------------------------------------------------------------
// LISTA DOZWOLONYCH HOSTÓW - druga połowa bramki, dopisana 31.08.2026.
//
// PO CO OSOBNA SEKCJA. Naprawa open redirectu dołożyła do tego pliku CAŁĄ
// listę dozwolonych hostów (hosty deweloperskie, domeny marki, origin
// kanoniczny wraz z odpowiednikiem www/apex, zmienna `BILLING_RETURN_HOSTS`)
// - i pierwszy pomiar po naprawie pokazał 75,92% instrukcji. Czyli trzynaście
// instrukcji NOWEJ bramki bezpieczeństwa nie było wykonywanych przez żaden
// test: dokładnie wzorzec, przed którym ostrzega rozdz. 8.4 audytu (przybyły
// linie ścieżki krytycznej, pokrycie stoi w miejscu).
//
// Każda gałąź tej listy to osobna decyzja „wolno / nie wolno odesłać tam
// klienta po zapłacie", więc każda ma tu własny przypadek - i, co ważniejsze,
// własny KONTRPRZYKŁAD. Reguła, która przepuszcza `localhost`, ale nie
// odrzuca `localhost.evil.example.org`, nie jest regułą.
// ---------------------------------------------------------------------------
describe("lista dozwolonych hostów", () => {
  describe("hosty deweloperskie", () => {
    it.each(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"])(
      "host deweloperski %s zostaje jako origin powrotu",
      (host) => {
        zadanie({ origin: `http://${host}:5173` });

        expect(absoluteReturnUrl("/profile/plan")).toBe(`http://${host}:5173/profile/plan`);
      },
    );

    it("subdomena .localhost też jest dopuszczona - tak działa dev wielu najemców", () => {
      zadanie({ origin: "http://nes.localhost:5173" });

      expect(absoluteReturnUrl("/profile/plan")).toBe("http://nes.localhost:5173/profile/plan");
    });

    it("KONTRPRZYKŁAD: host KOŃCZĄCY SIĘ na localhost, ale cudzy, jest odrzucony", () => {
      // `localhost.evil.example.org` przechodziłby przez naiwne `includes`.
      // Reguła sprawdza SUFIKS `.localhost`, więc ten adres nią nie jest.
      zadanie({ origin: "https://localhost.evil.example.org" });

      expect(absoluteReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}/profile/plan`);
    });

    it("KONTRPRZYKŁAD: `notlocalhost` nie jest hostem deweloperskim", () => {
      zadanie({ origin: "https://notlocalhost" });

      expect(absoluteReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}/profile/plan`);
    });
  });

  describe("origin kanoniczny i jego odpowiednik www/apex", () => {
    it("host z PUBLIC_SITE_URL jest dopuszczony", () => {
      vi.stubEnv("PUBLIC_SITE_URL", "https://konfigurowany.example.com");
      zadanie({ origin: "https://konfigurowany.example.com" });

      expect(absoluteReturnUrl("/profile/plan")).toBe(
        "https://konfigurowany.example.com/profile/plan",
      );
    });

    it("wariant www hosta kanonicznego jest dopuszczony - to jedna rejestracja, nie dwa serwisy", () => {
      vi.stubEnv("PUBLIC_SITE_URL", "https://konfigurowany.example.com");
      zadanie({ origin: "https://www.konfigurowany.example.com" });

      expect(absoluteReturnUrl("/profile/plan")).toBe(
        "https://www.konfigurowany.example.com/profile/plan",
      );
    });

    it("i odwrotnie: apex jest dopuszczony, gdy kanoniczny niesie www", () => {
      vi.stubEnv("PUBLIC_SITE_URL", "https://www.konfigurowany.example.com");
      zadanie({ origin: "https://konfigurowany.example.com" });

      expect(absoluteReturnUrl("/profile/plan")).toBe(
        "https://konfigurowany.example.com/profile/plan",
      );
    });

    it("KONTRPRZYKŁAD: przedrostek `www` doklejony do CUDZEJ domeny nic nie daje", () => {
      vi.stubEnv("PUBLIC_SITE_URL", "https://konfigurowany.example.com");
      zadanie({ origin: "https://www.evil.example.org" });

      expect(absoluteReturnUrl("/profile/plan")).toBe(
        "https://konfigurowany.example.com/profile/plan",
      );
    });
  });

  describe("BILLING_RETURN_HOSTS - domeny najemców deklarowane przez wdrożenie", () => {
    it("brak zmiennej znaczy: żadnych dodatkowych hostów", () => {
      vi.stubEnv("BILLING_RETURN_HOSTS", undefined);
      zadanie({ origin: "https://najemca.example.org" });

      expect(absoluteReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}/profile/plan`);
    });

    it("pusta zmienna też nie dopuszcza niczego", () => {
      vi.stubEnv("BILLING_RETURN_HOSTS", "");
      zadanie({ origin: "https://najemca.example.org" });

      expect(absoluteReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}/profile/plan`);
    });

    it("host z listy jest dopuszczony", () => {
      vi.stubEnv("BILLING_RETURN_HOSTS", "najemca.example.org");
      zadanie({ origin: "https://najemca.example.org" });

      expect(absoluteReturnUrl("/profile/plan")).toBe("https://najemca.example.org/profile/plan");
    });

    it("lista wielu hostów - każdy z osobna", () => {
      vi.stubEnv("BILLING_RETURN_HOSTS", "a.example.org,b.example.org");
      zadanie({ origin: "https://b.example.org" });

      expect(absoluteReturnUrl("/profile/plan")).toBe("https://b.example.org/profile/plan");
    });

    it("spacje wokół przecinków i WIELKIE LITERY nie psują dopasowania", () => {
      // Wdrożenie wpisuje tę zmienną ręcznie, więc normalizacja jest tu
      // regułą, nie uprzejmością: literówka w formatowaniu nie może cicho
      // wyłączyć hosta najemcy z listy.
      vi.stubEnv("BILLING_RETURN_HOSTS", "  A.EXAMPLE.ORG , b.example.org  ");
      zadanie({ origin: "https://a.example.org" });

      expect(absoluteReturnUrl("/profile/plan")).toBe("https://a.example.org/profile/plan");
    });

    it("wpis śmieciowy jest pomijany, a poprawne z tej samej listy dalej działają", () => {
      vi.stubEnv("BILLING_RETURN_HOSTS", ",,   ,dobry.example.org,");
      zadanie({ origin: "https://dobry.example.org" });

      expect(absoluteReturnUrl("/profile/plan")).toBe("https://dobry.example.org/profile/plan");
    });

    it("każdy wpis dopuszcza też swój odpowiednik www", () => {
      vi.stubEnv("BILLING_RETURN_HOSTS", "najemca.example.org");
      zadanie({ origin: "https://www.najemca.example.org" });

      expect(absoluteReturnUrl("/profile/plan")).toBe(
        "https://www.najemca.example.org/profile/plan",
      );
    });

    it("KONTRPRZYKŁAD: host spoza listy nie przechodzi, mimo że lista jest ustawiona", () => {
      vi.stubEnv("BILLING_RETURN_HOSTS", "najemca.example.org");
      zadanie({ origin: "https://evil.example.org" });

      expect(absoluteReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}/profile/plan`);
    });

    it("KONTRPRZYKŁAD: przyklejenie dozwolonego hosta jako SUFIKSU nic nie daje", () => {
      // `evil-najemca.example.org` zawiera `najemca.example.org` jako podciąg.
      vi.stubEnv("BILLING_RETURN_HOSTS", "najemca.example.org");
      zadanie({ origin: "https://evil-najemca.example.org" });

      expect(absoluteReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}/profile/plan`);
    });
  });

  describe("schemat adresu", () => {
    it.each(["ftp://najemca.example.org", "javascript:alert(1)", "data:text/html,x"])(
      "kandydat %s nie jest http(s) i nie zostaje originem",
      (candidate) => {
        vi.stubEnv("BILLING_RETURN_HOSTS", "najemca.example.org");
        zadanie({ origin: candidate });

        expect(absoluteReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}/profile/plan`);
      },
    );
  });

  describe("kolejność zaufania nagłówków", () => {
    it("gdy `origin` i `x-forwarded-host` wskazują RÓŻNE hosty, wygrywa `origin`", () => {
      // Kolejność jest udokumentowana w module, ale dotąd nie była zapisana
      // testem - a to ona decyduje, który z dwóch nagłówków atakującego brany
      // jest pod uwagę jako pierwszy.
      vi.stubEnv("BILLING_RETURN_HOSTS", "pierwszy.example.org,drugi.example.org");
      zadanie({
        origin: "https://pierwszy.example.org",
        "x-forwarded-host": "drugi.example.org",
      });

      expect(absoluteReturnUrl("/profile/plan")).toBe("https://pierwszy.example.org/profile/plan");
    });

    it("gdy `origin` jest NIEDOZWOLONY, a `x-forwarded-host` dozwolony - wygrywa ten drugi", () => {
      vi.stubEnv("BILLING_RETURN_HOSTS", "drugi.example.org");
      zadanie({
        origin: "https://evil.example.org",
        "x-forwarded-host": "drugi.example.org",
      });

      expect(absoluteReturnUrl("/profile/plan")).toBe("https://drugi.example.org/profile/plan");
    });

    it("`x-forwarded-proto` decyduje o schemacie adresu zbudowanego z hosta proxy", () => {
      zadanie({ "x-forwarded-proto": "http", "x-forwarded-host": "localhost:5173" });

      expect(absoluteReturnUrl("/profile/plan")).toBe("http://localhost:5173/profile/plan");
    });

    it("bez `x-forwarded-proto` host proxy dostaje https - nie degradujemy schematu", () => {
      vi.stubEnv("BILLING_RETURN_HOSTS", "najemca.example.org");
      zadanie({ "x-forwarded-host": "najemca.example.org" });

      expect(absoluteReturnUrl("/profile/plan")).toBe("https://najemca.example.org/profile/plan");
    });
  });

  describe("poza kontekstem żądania", () => {
    it("gdy `getRequest` RZUCA (cron, kolejka), adres wraca na origin kanoniczny", () => {
      // Zadania w tle wołają tę samą funkcję, a tam kontekstu żądania nie ma.
      // Funkcja ma wtedy zejść na adres kanoniczny, a nie wywrócić zadania.
      h.throws = true;

      expect(absoluteReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}/profile/plan`);
    });

    it("gdy `getRequest` oddaje `null`, zachowanie jest takie samo", () => {
      h.request = null;

      expect(absoluteReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}/profile/plan`);
    });
  });
});
