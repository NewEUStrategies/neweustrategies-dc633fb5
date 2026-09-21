// Adres powrotu drugiego silnika checkoutu (Stripe Embedded Checkout).
//
// DLACZEGO TEN PLIK ZOSTAŁ PRZEPISANY, A NIE TYLKO ROZSZERZONY. Poprzednia
// wersja miała cztery przypadki i jeden z nich - „falls back to forwarded
// host/proto" - UTRWALAŁ defekt: przypinał zaufanie do `X-Forwarded-Host` jako
// zachowanie poprawne. Gorzej: forge'ował `neweuropeanstrategies.com`, czyli
// host, który przechodzi bramkę tak samo PRZED naprawą, jak PO niej, więc nie
// odróżniał niczego. Każdy przypadek o bramce musi dziś forge'ować host, który
// na żadnej liście NIE stoi - inaczej dowodzi konfiguracji, nie kodu.
//
// Bramka (lista dozwolonych hostów) ma własną, czterdziestoprzypadkową macierz
// w `lib/billing/__tests__/returnUrl.server.test.ts` i po tej zmianie obsługuje
// OBA silniki. Tutaj sprawdzamy złożenie: połowę ŚCIEŻKI (odcięcie hosta
// klienta) i to, że połowa ORIGIN naprawdę przez bramkę przechodzi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Kontekst żądania - jedyna granica, jaką ta ścieżka dotyka. Zero sieci. */
const h = vi.hoisted(() => ({ request: null as { headers: Headers } | null }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => h.request }));

const { resolveReturnUrl } = await import("../resolveReturnUrl");

const NASZ_ORIGIN = "https://neweuropeanstrategies.com";

function zadanie(headers: Record<string, string>): void {
  h.request = { headers: new Headers(headers) };
}

beforeEach(() => {
  h.request = null;
  // CI bywa uruchamiane z ustawionym PUBLIC_SITE_URL. Bez wyzerowania OBU
  // zmiennych przypadki o „obcym hoście" dowodziłyby konfiguracji maszyny,
  // a nie bramki.
  vi.stubEnv("PUBLIC_SITE_URL", "");
  vi.stubEnv("BILLING_RETURN_HOSTS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveReturnUrl - połowa ORIGIN przechodzi przez bramkę hostów", () => {
  it("KONTRPRZYKŁAD: `x-forwarded-host` SPOZA listy NIE staje się originem powrotu", () => {
    // To jest cały defekt: nagłówek doklejony przez warstwę pośrednią albo
    // podany wprost w wywołaniu server fn przenosił `return_url` na obcą
    // domenę - fałszywy ekran „zapłać jeszcze raz" po udanej transakcji.
    zadanie({ "x-forwarded-proto": "https", "x-forwarded-host": "evil.example.org" });

    expect(resolveReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}/profile/plan`);
  });

  it("KONTRPRZYKŁAD: podrobiony nagłówek `origin` też nie przechodzi", () => {
    zadanie({ origin: "https://evil.example.org" });

    expect(resolveReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}/profile/plan`);
  });

  it("KONTRPRZYKŁAD: `localhost.evil.example.org` nie jest hostem deweloperskim", () => {
    // Dopasowanie po sufiksie `.localhost`, nie po podciągu - inaczej wystarczy
    // zarejestrować domenę zaczynającą się od „localhost".
    zadanie({ origin: "https://localhost.evil.example.org" });

    expect(resolveReturnUrl("/success")).toBe(`${NASZ_ORIGIN}/success`);
  });

  it("składa origin z `x-forwarded-proto` i `x-forwarded-host`, gdy host JEST zadeklarowany", () => {
    // Następca przypadku „falls back to forwarded host/proto". Dowodzi tego
    // samego SKŁADANIA schematu z hostem proxy, ale na hoście dopuszczonym
    // JAWNIE - więc przypadek pada, jeżeli ktoś usunie bramkę.
    vi.stubEnv("BILLING_RETURN_HOSTS", "najemca.example.org");
    zadanie({ "x-forwarded-proto": "https", "x-forwarded-host": "najemca.example.org" });

    expect(resolveReturnUrl("/profile/plan")).toBe("https://najemca.example.org/profile/plan");
  });

  it("host marki przechodzi - produkcja za terminatorem TLS", () => {
    zadanie({ "x-forwarded-proto": "https", "x-forwarded-host": "neweuropeanstrategies.com" });

    expect(resolveReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}/profile/plan`);
  });

  it("lokalny dev zachowuje schemat http i port", () => {
    zadanie({ origin: "http://localhost:8080" });

    expect(resolveReturnUrl("/success")).toBe("http://localhost:8080/success");
  });

  it("nagłówek `origin` ma pierwszeństwo przed hostem z proxy - gdy oba są dozwolone", () => {
    vi.stubEnv("BILLING_RETURN_HOSTS", "podglad.example.com,drugi.example.org");
    zadanie({
      origin: "https://podglad.example.com",
      "x-forwarded-host": "drugi.example.org",
      "x-forwarded-proto": "https",
    });

    expect(resolveReturnUrl("/success")).toBe("https://podglad.example.com/success");
  });

  it("poza kontekstem żądania (cron, kolejka) adres wraca na origin kanoniczny", () => {
    h.request = null;

    expect(resolveReturnUrl("/profile/plan")).toBe(`${NASZ_ORIGIN}/profile/plan`);
  });

  it("PUBLIC_SITE_URL jest originem kanonicznym wdrożenia", () => {
    vi.stubEnv("PUBLIC_SITE_URL", "https://wdrozenie.example.org");
    zadanie({ "x-forwarded-host": "evil.example.org" });

    expect(resolveReturnUrl("/profile/plan")).toBe("https://wdrozenie.example.org/profile/plan");
  });
});

describe("resolveReturnUrl - połowa ŚCIEŻKI odrzuca host klienta", () => {
  it("strips external host from client-provided absolute URL", () => {
    zadanie({ origin: NASZ_ORIGIN });

    expect(resolveReturnUrl("https://evil.example.com/steal")).toBe(`${NASZ_ORIGIN}/steal`);
  });

  it("preserves query and hash while normalizing origin", () => {
    zadanie({ origin: NASZ_ORIGIN });

    expect(resolveReturnUrl("https://evil.example.com/path?x=1#tab")).toBe(
      `${NASZ_ORIGIN}/path?x=1#tab`,
    );
  });

  it("KONTRPRZYKŁAD: `//host` w ŚCIEŻCE nie nadpisuje autorytetu adresu", () => {
    // DRUGI, OSOBNY OTWÓR - bramka originu go NIE zamykała. `pathname` może
    // zaczynać się od `//`, a `//host` jest adresem protokoło-względnym, który
    // nadpisuje autorytet bazy. ZMIERZONE na wersji z samą bramką originu:
    // `https://neweuropeanstrategies.com//evil.example.org/x` dawało
    // `https://evil.example.org/x`. Dlatego niezmiennikiem jest SKUTEK
    // (origin wyniku), a nie lista zakazanych prefiksów.
    zadanie({ origin: NASZ_ORIGIN });

    expect(resolveReturnUrl("https://neweuropeanstrategies.com//evil.example.org/steal")).toBe(
      `${NASZ_ORIGIN}/profile/plan`,
    );
  });

  it("KONTRPRZYKŁAD: `//host` podany wprost jako ścieżka też nie przechodzi", () => {
    zadanie({ origin: NASZ_ORIGIN });

    expect(resolveReturnUrl("//evil.example.org/steal")).toBe(`${NASZ_ORIGIN}/steal`);
  });

  it("KONTRPRZYKŁAD: `/\\host` (ukośnik wsteczny) też nie nadpisuje autorytetu", () => {
    zadanie({ origin: NASZ_ORIGIN });

    const wynik = resolveReturnUrl("https://neweuropeanstrategies.com/\\evil.example.org/steal");
    expect(new URL(wynik).origin).toBe(NASZ_ORIGIN);
  });

  it("zwykła ścieżka z podwójnym ukośnikiem W ŚRODKU jest nienaruszona", () => {
    // Kontrola, że niezmiennik nie jest nadgorliwy: `//` w środku ścieżki nie
    // przenosi autorytetu i ma przejść bez podmiany.
    zadanie({ origin: NASZ_ORIGIN });

    expect(resolveReturnUrl("/profile//plan")).toBe(`${NASZ_ORIGIN}/profile//plan`);
  });

  it("nieparsowalne wejście schodzi na domyślny ekran, a nie rzuca", () => {
    // Gałąź `catch` ostatniej szansy. PRZED zmianą ten wyjątek leciał przez
    // `createCheckoutOrder` i `createDonationCheckout`; doktryna jest ta sama
    // co w `absoluteReturnUrl` - funkcja budująca adres powrotu nigdy nie rzuca,
    // bo wyjątek zamieniłby open redirect w odmowę usługi.
    zadanie({ origin: NASZ_ORIGIN });

    expect(resolveReturnUrl("http://[")).toBe(`${NASZ_ORIGIN}/profile/plan`);
  });
});
