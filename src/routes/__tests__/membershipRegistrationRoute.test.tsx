// Trasa `/membership-registration` - PIĄTE wejście użytkownika do portalu
// uwierzytelnienia i drugie (obok `/login`) miejsce, które montuje `AuthPortal`.
//
// DLACZEGO TA TRASA MA WŁASNY PLIK, choć komponent jest jednolinijkowy.
// Audyt pokrycia portalu logowania wymienił z nazwy cztery pliki i tę trasę
// pominął, mimo że stoi na zerowym pokryciu (8 linii, 6 gałęzi, 2 funkcje).
// Cała jej treść to `head()` - a `head()` trasy publicznej nie jest ozdobą:
// to jedyne miejsce, w którym rozstrzyga się, czy strona rejestracji istnieje
// dla wyszukiwarki i w jakim języku.
//
// NAJWAŻNIEJSZY KONTRAST TEGO PLIKU: `/login` JEST wyłączone z indeksu
// (`robots: "noindex, nofollow"`), a `/membership-registration` NIE JEST -
// i to jest poprawne, bo to publiczna strona pozyskania członka, docelowa dla
// kampanii i wyników wyszukiwania. Obie trasy mają `head()` zbudowany z tego
// samego szablonu, więc pomyłka „ujednolicam obie strony auth" jest tu realna
// i idzie w obie strony: dodanie `noindex` tutaj wycina stronę rejestracji
// z wyszukiwarki (utrata pozyskania), a usunięcie go z `/login` wpuszcza
// formularz logowania do indeksu. Dlatego asercja o BRAKU `robots` jest tu tak
// samo świadoma jak asercja o jego OBECNOŚCI w `loginRoute.test.tsx`.
//
// O i18n: rozstrzygnięcie jest identyczne jak dla `/login` (patrz komentarz
// w `loginRoute.test.tsx`) - `head()` wykonuje się przy rozwiązywaniu trasy,
// poza drzewem Reacta i poza dostawcą i18next, a język bierze z ADRESU
// (`activeLang`). Asertujemy więc na literałach i nie wymuszamy tu i18next.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type * as AuthPortalModule from "@/components/auth/AuthPortal";

const h = vi.hoisted(() => ({
  /** Adres żądania widziany przez `head()`; pusty ciąg = gałąź fallbacku `||`. */
  requestUrl: "",
  /** Kolejne wartości `initialMode`, jakie atrapa portalu dostała w propsach. */
  initialModes: [] as (string | undefined)[],
}));

vi.mock("@/lib/seo/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/request")>()),
  getRequestUrl: () => h.requestUrl,
}));

// Prawdziwy `AuthPortal` ciągnie supabase, useAuth, useServerFn i dwa obrazki.
// Przedmiotem dowodu jest tu WYŁĄCZNIE prop `initialMode`, który trasa podaje;
// zachowanie samego portalu ma własny plik testowy (AuthPortal.test.tsx).
// Typ atrapy bierzemy z prawdziwego modułu (import tylko typu), żeby zmiana
// kształtu propsów wysadziła kompilację, a nie ten test.
vi.mock("@/components/auth/AuthPortal", () => {
  const AuthPortal: typeof AuthPortalModule.AuthPortal = ({ initialMode }) => {
    h.initialModes.push(initialMode);
    return <div data-testid="auth-portal-stub">{String(initialMode)}</div>;
  };
  return { AuthPortal };
});

import { renderRoute, routeHead, type RouteMetaEntry } from "@/test/routeHarness";
import { Route as MembershipRegistrationRoute } from "@/routes/membership-registration";

const PATH = "/membership-registration";

function mount(entry = PATH) {
  return renderRoute({ route: MembershipRegistrationRoute, path: PATH, initialEntry: entry });
}

/** Wartość `content` wpisu meta wskazanego atrybutem - z twardym błędem, gdy
 *  wpisu nie ma (test „przechodzący" na brakującym meta nie dowodzi niczego). */
function metaContent(
  meta: RouteMetaEntry[] | undefined,
  key: "name" | "property",
  value: string,
): string {
  const found = (meta ?? []).find((entry) => entry[key] === value);
  const content = found?.content;
  if (typeof content !== "string") throw new Error(`test: brak meta ${key}="${value}"`);
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
  h.requestUrl = "";
  h.initialModes = [];
});

afterEach(() => {
  cleanup();
});

describe("trasa /membership-registration - widoczność w wyszukiwarce", () => {
  it("NIE wyłącza się z indeksu - to publiczna strona pozyskania członka", () => {
    // Odwrotność `/login`. Gdyby ktoś „ujednolicił" obie strony auth i dopisał
    // tu `robots: "noindex, nofollow"`, strona rejestracji wypadłaby z wyników
    // wyszukiwania - czyli z kanału pozyskania - a w aplikacji nie byłoby tego
    // widać wcale. Sprawdzamy BRAK wpisu, nie jego treść.
    const head = routeHead(MembershipRegistrationRoute);
    const robots = (head.meta ?? []).filter((entry) => entry.name === "robots");

    expect(robots).toEqual([]);
  });

  it("kontrast z /login: tam robots jest, tutaj go nie ma", async () => {
    // Ta sama asercja widziana z zamontowanej trasy, żeby dowód nie opierał się
    // wyłącznie na wywołaniu `head()` w izolacji.
    const view = await mount();

    expect(view.meta().find((entry) => entry.name === "robots")).toBeUndefined();
  });
});

describe("trasa /membership-registration - head: język brany z adresu", () => {
  it("prefiks /en w adresie daje angielski tytuł, opis i znacznik języka", () => {
    h.requestUrl = "https://example.org/en/membership-registration";
    const head = routeHead(MembershipRegistrationRoute);

    expect(head.meta).toContainEqual({ title: "Create your account - New European Strategies" });
    expect(head.meta).toContainEqual({
      name: "description",
      content:
        "Register a New European Strategies account: strategy, knowledge and impact in one ecosystem.",
    });
    expect(head.meta).toContainEqual({ httpEquiv: "content-language", content: "en" });
  });

  it("adres bez prefiksu językowego daje nagłówek polski", () => {
    h.requestUrl = "https://example.org/membership-registration";
    const head = routeHead(MembershipRegistrationRoute);

    expect(head.meta).toContainEqual({ title: "Załóż konto - New European Strategies" });
    expect(head.meta).toContainEqual({
      name: "description",
      content:
        "Załóż konto w New European Strategies: strategia, wiedza i wpływ - jeden ekosystem.",
    });
    expect(head.meta).toContainEqual({ httpEquiv: "content-language", content: "pl" });
  });
});

describe("trasa /membership-registration - head: adres kanoniczny", () => {
  it("kanoniczny i og:url biorą adres z getRequestUrl", () => {
    h.requestUrl = "https://example.org/membership-registration";
    const head = routeHead(MembershipRegistrationRoute);

    expect(linkHref(head.links, "canonical")).toBe("https://example.org/membership-registration");
    expect(metaContent(head.meta, "property", "og:url")).toBe(
      "https://example.org/membership-registration",
    );
  });

  it("pusty getRequestUrl spada na '/membership-registration', a nie na pusty adres", () => {
    // Gałąź `||` w `membership-registration.tsx:13`. Na stronie WPUSZCZONEJ do
    // indeksu pusty kanoniczny jest groźniejszy niż na `/login`: bez niego
    // wyszukiwarka sama wybiera adres reprezentatywny i potrafi zindeksować
    // wariant z parametrami kampanii jako osobną stronę.
    h.requestUrl = "";
    const head = routeHead(MembershipRegistrationRoute);

    const canonical = linkHref(head.links, "canonical");
    expect(canonical).toBe(PATH);
    expect(canonical).not.toBe("");
    expect(metaContent(head.meta, "property", "og:url")).toBe(PATH);
    // Adres bez prefiksu = wariant polski, więc nagłówek jest polski.
    expect(head.meta).toContainEqual({ title: "Załóż konto - New European Strategies" });
  });
});

describe("trasa /membership-registration - portal startuje w rejestracji", () => {
  it("AuthPortal dostaje initialMode 'signup', a nie domyślne logowanie", async () => {
    // Powód istnienia tej trasy: ten sam portal, ale otwarty na rejestracji.
    // Gdyby prop przestał dochodzić, kampania kierująca na „Załóż konto"
    // wysyłałaby ludzi na formularz LOGOWANIA - a osoba bez konta nie ma się
    // czym zalogować i po prostu odpada.
    await mount();

    expect(h.initialModes).toEqual(["signup"]);
    expect(screen.getByTestId("auth-portal-stub")).toHaveTextContent("signup");
  });

  it("trasa nie przyjmuje trybu z adresu - ?mode=signin nie przestawia portalu", async () => {
    // Ta trasa świadomie NIE ma `validateSearch` ani odczytu search: tryb jest
    // przypisany na stałe. Asercja pilnuje, żeby nikt nie „dorobił" tu obsługi
    // `?mode=` przez przypadek, bo wtedy adres kampanijny mógłby przestawić
    // stronę rejestracji w logowanie.
    await mount(`${PATH}?mode=signin`);

    expect(h.initialModes).toEqual(["signup"]);
    expect(screen.getByTestId("auth-portal-stub")).toHaveTextContent("signup");
  });
});
