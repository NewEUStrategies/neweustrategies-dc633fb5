// TYTUŁ KARTY PRZEGLĄDARKI W JĘZYKU INTERFEJSU - siedem tras modułu 20.
//
// CO TO DOWODZI. `head()` tych tras zwracał napisy WYŁĄCZNIE po polsku, choć
// komponent tuż niżej woła `useTranslation()`. Użytkownik z angielskim
// interfejsem dostawał angielską stronę i polską kartę przeglądarki - a przy
// udostępnieniu linku polski podgląd. Defekt A6 audytu.
//
// DLACZEGO ŻADNA BRAMKA TEGO NIE ŁAPAŁA, I DLACZEGO TO NIE JEST LUKA.
// `src/lib/ci/monolingualUserText.ts` nazywa tę klasę wprost jako świadomie
// pozostawioną poza zasięgiem („właściwości obiektów"), a meta w `head()` ma
// dokładnie ten kształt. Bramka nie przeoczyła - zdecydowała, że nie patrzy.
// Rozszerzenie jej zasięgu dotyka całego repozytorium i wymaga własnej linii
// bazowej, więc NIE jest częścią tej pracy. Ten plik jest zamiast tego
// punktowym dowodem dla siedmiu tras, które mieszczą się w module 20.
//
// ROZSTRZYGNIĘCIE O i18n (nie badaj tego od nowa). `head()` wykonuje się przy
// ROZWIĄZYWANIU TRASY - poza drzewem Reacta i poza dostawcą i18next - więc
// `t()` tam nie istnieje, a `i18n.language` jest singletonem współdzielonym
// między równoległymi żądaniami SSR. Repozytorium ma na to jeden wzorzec:
// dwujęzyczny literał wybierany przez `activeLang(url)` (`welcome.tsx`,
// `login.tsx`). Tu asertujemy na literałach, dokładnie jak `loginRoute.test.tsx`.
//
// CZEGO TEN PLIK ŚWIADOMIE NIE ROBI. Nie przepisuje tych tras na
// `buildContentHead`. Tamta funkcja twardo ustawia `twitter:card:
// "summary_large_image"` (dwie z tych tras emitują `summary`), zawsze dokłada
// `og:image`, `og:site_name`, `og:locale`, `twitter:*` oraz `canonical`
// z klastrem hreflang - a `/people` i `/reading-list` są w
// NON_LOCALIZED_PREFIXES, więc ich klaster hreflang wskazywałby TRZY razy ten
// sam adres, czyli byłby sprzecznym sygnałem dla wyszukiwarek. Naprawiamy
// defekt językowy, nie przebudowujemy powierzchni SEO.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Adres żądania widziany przez `head()`. Pusty = gałąź zapasowa `|| "/x"`. */
  requestUrl: "",
}));

vi.mock("@/lib/seo/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/request")>()),
  getRequestUrl: () => h.requestUrl,
}));

import type { AnyRoute } from "@tanstack/react-router";
import { routeHead } from "@/test/routeHarness";
// Import STATYCZNY, nie `await import()` w tabeli - `vi.mock` i tak jest
// hoistowane nad importy, a statyczny kształt daje `routeHead` KONKRETNY typ
// trasy zamiast `unknown` (to jest idiom `membershipRegistrationRoute.test.tsx`).
import { Route as PeopleRoute } from "@/routes/people";
import { Route as CartRoute } from "@/routes/cart";
import { Route as ContributorsRoute } from "@/routes/contributors";
import { Route as ReadingListRoute } from "@/routes/reading-list";
import { Route as AdminI18nRoute } from "@/routes/admin.i18n";
import { Route as AdminMonetizationLedgerRoute } from "@/routes/admin.monetization-ledger";
import { Route as AdminReadingTimeRoute } from "@/routes/admin.reading-time";

/** Wartość `title` z tablicy `meta` - jedyny wpis, który ją niesie. */
function tytul(meta: ReadonlyArray<Record<string, unknown>>): string {
  const wpis = meta.find((m) => typeof m.title === "string");
  if (!wpis || typeof wpis.title !== "string") {
    throw new Error("test: head() nie zwrócił wpisu z tytułem");
  }
  return wpis.title;
}

/** Wartość `content` wpisu `meta` o danej nazwie/właściwości. */
function meta(
  wpisy: ReadonlyArray<Record<string, unknown>>,
  klucz: "name" | "property",
  wartosc: string,
): string | undefined {
  const wpis = wpisy.find((m) => m[klucz] === wartosc);
  return typeof wpis?.content === "string" ? wpis.content : undefined;
}

interface Przypadek {
  readonly route: AnyRoute;
  readonly adresPl: string;
  readonly adresEn: string;
  readonly tytulPl: string;
  readonly tytulEn: string;
  /** `robots`, którego trasa ma NIE zgubić przy zmianie językowej. */
  readonly robots: string;
}

const PRZYPADKI: ReadonlyArray<readonly [string, Przypadek]> = [
  [
    "/people",
    {
      route: PeopleRoute,
      adresPl: "/people",
      adresEn: "/en/people",
      tytulPl: "Osoby | New European Strategies",
      tytulEn: "People | New European Strategies",
      robots: "noindex, nofollow",
    },
  ],
  [
    "/cart",
    {
      route: CartRoute,
      adresPl: "/cart",
      adresEn: "/en/cart",
      tytulPl: "Mój koszyk - New European Strategies",
      tytulEn: "My cart - New European Strategies",
      robots: "noindex, nofollow",
    },
  ],
  [
    "/contributors",
    {
      route: ContributorsRoute,
      adresPl: "/contributors",
      adresEn: "/en/contributors",
      tytulPl: "Tablica kontrybutorów",
      tytulEn: "Contributor board",
      robots: "noindex, nofollow",
    },
  ],
  [
    "/reading-list",
    {
      route: ReadingListRoute,
      adresPl: "/reading-list",
      adresEn: "/en/reading-list",
      tytulPl: "Twoja lista do przeczytania",
      tytulEn: "Your reading list",
      // Świadomie samo `noindex`, bez `nofollow` - patrz komentarz w trasie.
      robots: "noindex",
    },
  ],
  [
    "/admin/i18n",
    {
      route: AdminI18nRoute,
      adresPl: "/admin/i18n",
      adresEn: "/en/admin/i18n",
      tytulPl: "Audyt tłumaczeń widgetów | Panel New European Strategies",
      tytulEn: "Widget translation audit | New European Strategies panel",
      robots: "noindex, nofollow",
    },
  ],
  [
    "/admin/monetization-ledger",
    {
      route: AdminMonetizationLedgerRoute,
      adresPl: "/admin/monetization-ledger",
      adresEn: "/en/admin/monetization-ledger",
      tytulPl: "Monetyzacja - rejestr | Panel",
      tytulEn: "Monetization - ledger | Panel",
      robots: "noindex, nofollow",
    },
  ],
  [
    "/admin/reading-time",
    {
      route: AdminReadingTimeRoute,
      adresPl: "/admin/reading-time",
      adresEn: "/en/admin/reading-time",
      tytulPl: "Czas czytania - admin",
      tytulEn: "Reading time - admin",
      robots: "noindex, nofollow",
    },
  ],
];

beforeEach(() => {
  h.requestUrl = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("moduł 20: tytuł dokumentu idzie za językiem adresu", () => {
  it.each(PRZYPADKI)("%s - adres bez prefiksu daje tytuł POLSKI", (_nazwa, p) => {
    h.requestUrl = p.adresPl;

    expect(tytul(routeHead(p.route).meta ?? [])).toBe(p.tytulPl);
  });

  it.each(PRZYPADKI)("%s - adres z prefiksem /en daje tytuł ANGIELSKI", (_nazwa, p) => {
    // To jest cały defekt A6: przed naprawą ta asercja dostawała polski napis
    // na angielskim interfejsie.
    h.requestUrl = p.adresEn;

    expect(tytul(routeHead(p.route).meta ?? [])).toBe(p.tytulEn);
  });

  it.each(PRZYPADKI)("%s - zmiana języka NIE gubi `robots`", (_nazwa, p) => {
    // Naprawa językowa nie może przy okazji otworzyć indeksowania prywatnej
    // powierzchni ani znormalizować `noindex` do `noindex, nofollow`.
    for (const adres of [p.adresPl, p.adresEn]) {
      h.requestUrl = adres;

      expect(meta(routeHead(p.route).meta ?? [], "name", "robots")).toBe(p.robots);
    }
  });

  it.each(PRZYPADKI)(
    "%s - PUSTY getRequestUrl spada na własną ścieżkę, nie na pustą",
    (_nazwa, p) => {
      // Gałąź `|| "/x"`. Bez niej `activeLang("")` wchodzi w `catch` i wynik
      // zależałby od globalnego stanu i18n zamiast od adresu.
      h.requestUrl = "";

      expect(tytul(routeHead(p.route).meta ?? [])).toBe(p.tytulPl);
    },
  );
});

describe("moduł 20: opis strony też jest dwujęzyczny tam, gdzie istnieje", () => {
  const Z_OPISEM: ReadonlyArray<readonly [string, AnyRoute, string]> = [
    ["/people", PeopleRoute, "/en/people"],
    ["/cart", CartRoute, "/en/cart"],
    ["/admin/i18n", AdminI18nRoute, "/en/admin/i18n"],
  ];

  it.each(Z_OPISEM)("%s - opis po angielsku nie jest polskim napisem", (_n, route, adresEn) => {
    h.requestUrl = adresEn;
    const wpisy = routeHead(route).meta ?? [];
    const opis = meta(wpisy, "name", "description");

    expect(opis).toBeTruthy();
    // Litery wyłącznie polskie w tym zestawie - obecność którejkolwiek znaczy,
    // że opis nie został przetłumaczony.
    expect(opis).not.toMatch(/[ąćęłńóśżź]/i);
  });

  it("/people i /cart trzymają og:* zgodne z tytułem i opisem w OBU językach", () => {
    for (const [adres, oczekiwanyTytul] of [
      ["/people", "Osoby | New European Strategies"],
      ["/en/people", "People | New European Strategies"],
    ] as const) {
      h.requestUrl = adres;
      const wpisy = routeHead(PeopleRoute).meta ?? [];

      expect(meta(wpisy, "property", "og:title")).toBe(oczekiwanyTytul);
      expect(meta(wpisy, "property", "og:description")).toBe(meta(wpisy, "name", "description"));
      // Powierzchnia SEO ma zostać nietknięta - `summary`, nie
      // `summary_large_image` (patrz nagłówek pliku).
      expect(meta(wpisy, "name", "twitter:card")).toBe("summary");
      expect(meta(wpisy, "property", "og:type")).toBe("website");
    }
  });
});
