// PIĘĆ HISTORYCZNYCH ADRESÓW PANELU KONTA, które po konsolidacji IA (§11 audytu
// finansów oraz konsolidacja edycji tożsamości) nie mają już własnej treści:
// `/profile/orders`, `/profile/subscription`, `/profile/account`,
// `/profile/social`, `/profile/author`.
//
// CO TEN PLIK DOWODZI - I DLACZEGO TO NIE JEST TEST DLA PROCENTU.
//
// Każdy z tych adresów żyje POZA aplikacją: w zakładkach przeglądarki, w mailach
// transakcyjnych („Twoje zamówienie" prowadziło na /profile/orders), w wynikach
// wyszukiwarki wewnętrznej, w powiadomieniach („uzupełnij profil eksperta")
// i w linkach, które użytkownicy wysyłali sobie sami. Usunięcie treści bez
// przekierowania zamienia je w 404 - a 404 na własnym koncie czyta się jak
// „straciłem dostęp do historii płatności", nie jak „przenieśliśmy stronę".
// Stąd trzy rzeczy warte dowodu:
//
//   1. PRZEKIEROWANIE ISTNIEJE i prowadzi pod KANONICZNY adres. Zła strona
//      docelowa jest gorsza niż 404: użytkownik szukający faktury trafia na
//      ekran, którego nie rozumie, i nie wie, że szukać ma gdzie indziej.
//   2. PRZEKIEROWANIE ZASTĘPUJE wpis w historii (`replace`). Bez tego przycisk
//      „wstecz" wraca na adres, który natychmiast przekierowuje z powrotem -
//      klasyczna pętla, z której wychodzi się tylko zamknięciem karty.
//   3. PARAMETR ZAKŁADKI MUSI DOJECHAĆ DO CELU I PRZEJŚĆ JEGO WALIDATOR.
//      Trzy stare adresy tożsamości prowadzą na tę samą stronę `/profile/edit`,
//      ale na TRZY różne zakładki. Slug, bio i linki mieszkają w zakładce
//      „social", profil eksperta w „expert". Przekierowanie bez parametru
//      wysypuje użytkownika na „dane podstawowe": patrzy na ekran bez swoich
//      linków (albo bez swojego profilu eksperta) i wnioskuje, że konsolidacja
//      je zjadła. Cel z kolei ODRZUCA zakładki spoza zbioru - gdyby ktoś
//      zmienił nazwę po jednej stronie, przekierowanie nadal by działało,
//      tylko cicho lądowało na „danych podstawowych".
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - POWŁOKI `/profile` ORAZ TRAS DOCELOWYCH `/profile/edit` i `/profile/plan`:
//   mają `src/routes/__tests__/profileShellRoutes.test.tsx` (bramka sesji,
//   zakładki tożsamości i ich bramka rolowa, trzy stany planu). Tu korzystamy
//   WYŁĄCZNIE z walidatora zakładki, żeby dowieść, że przekierowanie i cel się
//   dogadują.
// - TREŚCI `/profile/payments`: ma `profileSurfaceRoutes.test.tsx` - tam jest
//   dowód, że karty zamówień i dokumentów faktycznie stoją pod nowym adresem,
//   więc przekierowanie nie prowadzi w pustkę.
// - MECHANIKI PRZEKIEROWAŃ SERWEROWYCH (tabela `redirects`, 301/410):
//   to inna warstwa, `adminRedirectsRoute.test.tsx`.
import { describe, expect, it } from "vitest";
import { isRedirect } from "@tanstack/react-router";
import type { AnyRoute } from "@tanstack/react-router";

import { routeSearchValidator } from "@/test/routeHarness";
import { Route as OrdersRoute } from "@/routes/profile.orders";
import { Route as SubscriptionRoute } from "@/routes/profile.subscription";
import { Route as AccountRoute } from "@/routes/profile.account";
import { Route as SocialRoute } from "@/routes/profile.social";
import { Route as AuthorRoute } from "@/routes/profile.author";
import { Route as ProfileEditRoute } from "@/routes/profile.edit";

/**
 * `beforeLoad` tych tras nie czyta ANI JEDNEGO argumentu - przekierowanie jest
 * bezwarunkowe. Sprawdzamy to w RUNTIME (`value.length === 0` znaczy, że
 * funkcja nie deklaruje parametrów), a nie rzutowaniem: gdyby ktoś dołożył tam
 * warunek zależny od kontekstu (sesja, rola), strażnik przestanie pasować
 * i test padnie z czytelnym komunikatem, zamiast wywalić się na `undefined`
 * w środku frameworka.
 */
type BezargumentowyBeforeLoad = () => unknown;

function jestBezargumentowa(value: unknown): value is BezargumentowyBeforeLoad {
  return typeof value === "function" && value.length === 0;
}

/** To, co rzuciło `beforeLoad` trasy. Brak wyjątku = brak przekierowania. */
function rzuconePrzezBeforeLoad(route: AnyRoute): unknown {
  const beforeLoad = route.options.beforeLoad;
  if (!jestBezargumentowa(beforeLoad)) {
    throw new Error("test: `beforeLoad` trasy czyta argumenty - strażnik wymaga aktualizacji");
  }
  try {
    beforeLoad();
  } catch (thrown) {
    return thrown;
  }
  throw new Error("`beforeLoad` NIE przekierował - stara zakładka i link z maila dadzą 404");
}

/** Opcje przekierowania trasy w kształcie, którego dotyczą asercje. */
function przekierowanie(route: AnyRoute) {
  const thrown = rzuconePrzezBeforeLoad(route);
  // STRAŻNIK frameworka, nie rzutowanie: `isRedirect` sprawdza w runtime, że to
  // przekierowanie routera, i dopiero to zawęża typ do obiektu z `options`.
  if (!isRedirect(thrown)) {
    throw new Error("test: `beforeLoad` rzucił czymś, co nie jest przekierowaniem routera");
  }
  return thrown.options;
}

/**
 * Parametry zapytania przekierowania jako zwykły obiekt.
 *
 * `RedirectOptions.search` jest UNIĄ: framework przyjmuje tam obiekt ALBO
 * funkcję przepisującą poprzedni search, więc rozłożenie go bez zawężenia się
 * nie kompiluje. STRAŻNIK, nie rzutowanie: warunek sprawdza w runtime, że to
 * obiekt (a nie funkcja i nie tablica), i to on zawęża typ.
 */
function searchPrzekierowania(route: AnyRoute): Record<string, unknown> {
  const search: unknown = przekierowanie(route).search;
  if (search === null || typeof search !== "object" || Array.isArray(search)) {
    throw new Error("test: przekierowanie nie niesie obiektu parametrów zapytania");
  }
  return { ...search };
}

describe.each([
  ["/profile/orders", OrdersRoute, "/profile/payments"],
  ["/profile/subscription", SubscriptionRoute, "/profile/plan"],
  ["/profile/account", AccountRoute, "/profile/edit"],
  ["/profile/social", SocialRoute, "/profile/edit"],
  ["/profile/author", AuthorRoute, "/profile/edit"],
])("%s - historyczny adres panelu konta", (_zrodlo, route, cel) => {
  it(`prowadzi pod kanoniczny adres ${cel}, a nie w 404`, () => {
    expect(przekierowanie(route).to).toBe(cel);
  });

  it("ZASTĘPUJE wpis w historii - inaczej „wstecz” zapętla nawigację", () => {
    // Bez `replace` w historii zostaje adres, który natychmiast przekierowuje
    // z powrotem: „wstecz" nie wychodzi z pętli, wychodzi z niej zamknięcie
    // karty.
    expect(przekierowanie(route).replace).toBe(true);
  });

  it("nie ma komponentu - jej jedynym zadaniem jest przekierowanie", () => {
    // Komponent na trasie przekierowującej to martwy kod, który przy pierwszej
    // zmianie `beforeLoad` zaczyna się nagle renderować.
    expect(route.options.component).toBeUndefined();
  });
});

describe.each([
  ["/profile/social", SocialRoute, "social", "slug, bio i linki społecznościowe"],
  ["/profile/author", AuthorRoute, "expert", "profil eksperta i dorobek"],
])("%s - parametr zakładki musi dojechać do celu", (_zrodlo, route, zakladka, co) => {
  it(`niesie \`?tab=${zakladka}\`, bo bez niego ${co} wyglądają na utracone`, () => {
    // Zawartość tożsamości mieszka w JEDNEJ z trzech zakładek `/profile/edit`.
    // Przekierowanie bez parametru wysypuje użytkownika na „dane podstawowe" -
    // patrzy na ekran bez swoich rzeczy i wnioskuje, że konsolidacja je zjadła.
    expect(searchPrzekierowania(route)).toEqual({ tab: zakladka });
  });

  it("parametr PRZECHODZI przez walidator strony docelowej", () => {
    // To jedyny dowód, który łączy dwie trasy: `/profile/edit` odrzuca
    // zakładki spoza zbioru (`tab` staje się `undefined`). Gdyby ktoś zmienił
    // nazwę zakładki po jednej stronie, przekierowanie nadal by działało,
    // tylko cicho lądowało na „danych podstawowych".
    expect(routeSearchValidator(ProfileEditRoute)(searchPrzekierowania(route))).toEqual({
      tab: zakladka,
    });
  });
});

describe("trzy stare adresy tożsamości - jedna strona, TRZY różne zakładki", () => {
  it("prowadzą na tę samą stronę edycji", () => {
    expect(przekierowanie(AccountRoute).to).toBe("/profile/edit");
    expect(przekierowanie(SocialRoute).to).toBe("/profile/edit");
    expect(przekierowanie(AuthorRoute).to).toBe("/profile/edit");
  });

  it("ale każdy na SWOJĄ zakładkę - zamiana wysyła użytkownika na cudzy ekran", () => {
    // Trzy przekierowania w jedno miejsce to najłatwiejsza pomyłka copy-paste
    // w całym tym zestawie: wystarczy skopiować `search` z sąsiedniej trasy
    // i autor ląduje na linkach społecznościowych, a nie na swoim dorobku.
    expect(przekierowanie(AccountRoute).search).toBeUndefined();
    expect(searchPrzekierowania(SocialRoute)).toEqual({ tab: "social" });
    expect(searchPrzekierowania(AuthorRoute)).toEqual({ tab: "expert" });
  });

  it("`/profile/account` celowo NIE niesie zakładki - „basic” jest domyślną", () => {
    // Dane podstawowe to zakładka otwierana bez parametru, a `?tab=basic`
    // walidator celu i tak sprowadza do `undefined` (patrz profileShellRoutes).
    // Doklejenie go tutaj rozmnożyłoby warianty tego samego adresu.
    expect(routeSearchValidator(ProfileEditRoute)({})).toEqual({ tab: undefined });
    expect(przekierowanie(AccountRoute).search).toBeUndefined();
  });
});

describe("dwa przekierowania rozliczeniowe nie mieszają celów", () => {
  it("zamówienia idą do PŁATNOŚCI, a subskrypcja do PLANU", () => {
    // Oba adresy dotyczą pieniędzy i oba zostały skonsolidowane w tym samym
    // audycie, ale w DWA różne miejsca: historia transakcji i faktury żyją na
    // `/profile/payments`, a status planu i portal operatora na `/profile/plan`.
    // Zamiana celów posłałaby szukającego faktury na ekran zmiany planu.
    expect(przekierowanie(OrdersRoute).to).not.toBe(przekierowanie(SubscriptionRoute).to);
    expect(przekierowanie(OrdersRoute).to).toBe("/profile/payments");
    expect(przekierowanie(SubscriptionRoute).to).toBe("/profile/plan");
  });

  it("żadne z nich nie niesie parametrów zapytania", () => {
    // Parametr na tych celach byłby przypadkiem (obie strony pokazują całość),
    // a niepotrzebne `?` w adresie rozmnaża warianty URL-a w historii.
    expect(przekierowanie(OrdersRoute).search).toBeUndefined();
    expect(przekierowanie(SubscriptionRoute).search).toBeUndefined();
  });
});
