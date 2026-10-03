// Trasa publiczna `/donate` - nasz własny checkout darowizn. Do dziś: 0 funkcji.
//
// CO NIESIE PLIK TRASY, A CZEGO NIE MA W TEŚCIE FORMULARZA:
//
//   1. KONTRAKT ADRESU POWROTU. Operator płatności po udanej wpłacie odsyła
//      darczyńcę na `/donate?status=thanks`. `validateSearch` przepuszcza tylko
//      napis i przycina go do 32 znaków - parametr ląduje w stanie routera, więc
//      nie może być dowolnie długim śmieciem z cudzego linku.
//   2. EKRAN PODZIĘKOWANIA ZAMIAST FORMULARZA. Po powrocie z płatności strona
//      NIE może pokazać formularza ponownie: darczyńca, który właśnie zapłacił,
//      widziałby zaproszenie do drugiej wpłaty i nie wiedziałby, czy pierwsza
//      przeszła. Dowód jest w obie strony - każda inna wartość to formularz.
//   3. JĘZYK NAGŁÓWKA Z ADRESU. `head()` wybiera język z PREFIKSU ścieżki
//      (`activeLang`), nie z interfejsu: robot indeksujący `/en/donate` nie ma
//      sesji, więc angielskie meta muszą wynikać z samego adresu.
//
// GRANICE: formularz (`DonationForm` ma własny, pełny test - tu jest znacznikiem),
// odczyt adresu żądania (`getRequestUrl`), rejestracja słownika i i18n (atrapa
// zwraca KLUCZ). Router, `validateSearch` i `head()` biegną PRAWDZIWE.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  ensureI18n: vi.fn(),
  /** Adres żądania widziany przez `head()` (`null` = brak kontekstu żądania). */
  requestUrl: null as string | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-donate", () => ({ ensureI18n: h.ensureI18n }));
vi.mock("@/lib/seo/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/request")>()),
  getRequestUrl: () => h.requestUrl,
}));
vi.mock("@/components/donations/DonationForm", () => ({
  DonationForm: () => <div data-testid="donation-form" />,
}));

import { renderRoute, routeHead, routeSearchValidator } from "@/test/routeHarness";
import { Route as DonateRoute } from "@/routes/donate";

const PATH = "/donate";

/** Wartość wpisu `meta` po nazwie (`title`, `name`, `property` albo `httpEquiv`). */
function metaValue(meta: Record<string, unknown>[] | undefined, key: string): unknown {
  const entries = meta ?? [];
  if (key === "title") return entries.find((entry) => "title" in entry)?.title;
  return entries.find(
    (entry) => entry.name === key || entry.property === key || entry.httpEquiv === key,
  )?.content;
}

function zamontuj(initialEntry: string = PATH) {
  return renderRoute({ route: DonateRoute, path: PATH, initialEntry });
}

beforeEach(() => {
  h.ensureI18n.mockReset();
  h.requestUrl = null;
});

// ---------------------------------------------------------------------------
describe("validateSearch - kontrakt adresu powrotu", () => {
  const validate = routeSearchValidator(DonateRoute);

  it("przepuszcza status z adresu powrotu operatora", () => {
    expect(validate({ status: "thanks" })).toEqual({ status: "thanks" });
  });

  it("przycina status do 32 znaków", () => {
    const long = "thanks-" + "x".repeat(60);
    const result = validate({ status: long });

    expect(result.status).toBe(long.slice(0, 32));
    expect(String(result.status)).toHaveLength(32);
  });

  it("wartość inna niż napis nie trafia do stanu routera", () => {
    expect(validate({ status: 1 })).toEqual({ status: undefined });
    expect(validate({ status: ["thanks"] })).toEqual({ status: undefined });
    expect(validate({ status: { thanks: true } })).toEqual({ status: undefined });
    expect(validate({ status: true })).toEqual({ status: undefined });
  });

  it("brak parametru i parametry obce dają pusty status", () => {
    expect(validate({})).toEqual({ status: undefined });
    expect(validate({ utm_source: "newsletter" })).toEqual({ status: undefined });
  });
});

// ---------------------------------------------------------------------------
describe("head() - język nagłówka z adresu", () => {
  it("adres bez prefiksu daje polskie meta i kanoniczny adres strony", () => {
    h.requestUrl = "https://nes.example/donate";
    const { meta } = routeHead(DonateRoute);

    expect(metaValue(meta, "title")).toBe("Darowizna - New European Strategies");
    expect(String(metaValue(meta, "description"))).toContain("Wesprzyj niezależną analizę");
    expect(metaValue(meta, "content-language")).toBe("pl");
    expect(metaValue(meta, "og:url")).toBe("https://nes.example/donate");
    expect(metaValue(meta, "og:type")).toBe("website");
  });

  it("prefiks /en daje angielskie meta, niezależnie od interfejsu", () => {
    h.requestUrl = "https://nes.example/en/donate";
    const { meta } = routeHead(DonateRoute);

    expect(metaValue(meta, "title")).toBe("Donate - New European Strategies");
    expect(String(metaValue(meta, "description"))).toContain(
      "Support independent European policy analysis",
    );
    expect(metaValue(meta, "content-language")).toBe("en");
    expect(metaValue(meta, "og:url")).toBe("https://nes.example/en/donate");
  });

  it("bez kontekstu żądania cofa się do własnej ścieżki i języka domyślnego", () => {
    h.requestUrl = null;
    const { meta } = routeHead(DonateRoute);

    expect(metaValue(meta, "title")).toBe("Darowizna - New European Strategies");
    expect(metaValue(meta, "og:url")).toBe(PATH);
  });

  it("zamontowana trasa oddaje ten sam nagłówek do <HeadContent/>", async () => {
    h.requestUrl = "https://nes.example/en/donate";
    const view = await zamontuj();

    expect(metaValue(view.meta(), "title")).toBe("Donate - New European Strategies");
    cleanup();
  });
});

// ---------------------------------------------------------------------------
describe("strona /donate - formularz albo podziękowanie", () => {
  it("bez statusu pokazuje nagłówek i formularz wpłaty", async () => {
    const view = await zamontuj();

    expect(view.currentPath()).toBe(PATH);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("donate.title");
    expect(screen.getByText("donate.subtitle")).toBeInTheDocument();
    expect(screen.getByTestId("donation-form")).toBeInTheDocument();
    expect(screen.queryByText("donate.thanksTitle")).toBeNull();
    // Słownik rejestruje się w chunku KOMPONENTU trasy, nie w entry.
    expect(h.ensureI18n).toHaveBeenCalled();
    cleanup();
  });

  it("po powrocie z płatności dziękuje i NIE zaprasza do drugiej wpłaty", async () => {
    const view = await zamontuj(`${PATH}?status=thanks`);

    expect(view.search()).toEqual({ status: "thanks" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("donate.thanksTitle");
    expect(screen.getByText("donate.thanksBody")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "donate.backHome" }).getAttribute("href")).toBe("/");
    expect(screen.queryByTestId("donation-form")).toBeNull();
    cleanup();
  });

  it("inny status (np. przerwana płatność) wraca do formularza", async () => {
    await zamontuj(`${PATH}?status=cancelled`);

    expect(screen.getByTestId("donation-form")).toBeInTheDocument();
    expect(screen.queryByText("donate.thanksTitle")).toBeNull();
    cleanup();
  });

  it("status tylko ZACZYNAJĄCY się od `thanks` nie udaje podziękowania", async () => {
    const view = await zamontuj(`${PATH}?status=thanks${"x".repeat(40)}`);

    expect(String(view.search().status)).toHaveLength(32);
    expect(screen.getByTestId("donation-form")).toBeInTheDocument();
    expect(screen.queryByText("donate.thanksTitle")).toBeNull();
    cleanup();
  });
});
