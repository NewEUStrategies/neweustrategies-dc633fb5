// PIĘĆ TRAS POWIERZCHNI UCZESTNIKA - sklejenie adresu z ekranem.
//
//   `/events/<slug>/me`            - prywatny panel „Moje” na wydarzeniu,
//   `/events/<slug>/manage?token=` - samoobsługa zgłoszenia Z KLUCZEM w adresie,
//   `/events/invite/<token>`       - przyjęcie miejsca z pakietu, KLUCZ w ścieżce,
//   `/events/<slug>/participants`  - publiczna zakładka katalogu uczestników,
//   `/profile/events`              - historia wydarzeń w globalnym profilu.
//
// PO CO TESTOWAĆ TRASĘ, A NIE SAM KOMPONENT. `createFileRoute(...)` samo w sobie
// nie zna swojej ścieżki - `validateSearch`, `Route.useParams()`, `head()`
// i `ssr` zaczynają istnieć dopiero po sklejeniu z drzewem. Test renderujący
// komponent mija DOKŁADNIE tę warstwę, w której mieszkają błędy sklejenia.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TEGO PLIKU:
//
//  1. POŚWIADCZENIE WCHODZI DO WYSZUKIWARKI. Adres „manage” niesie
//     `manage_token`, a adres zaproszenia niesie jednorazowy klucz do
//     opłaconego miejsca. Zdjęty `noindex, nofollow` wstawia te klucze do
//     indeksu; zdjęty `referrer: no-referrer` wysyła je w nagłówku odsyłającym
//     do każdego hosta, na który uczestnik kliknie dalej. To nie jest ozdoba
//     nagłówka, tylko warunek tego, żeby klucz został kluczem.
//
//  2. KLUCZ JEDZIE NA SERWER RENDERUJĄCY. `ssr: false` na obu tych trasach jest
//     decyzją, nie optymalizacją: cała treść zależy od klucza z adresu i od
//     publicznego RPC wołanego z przeglądarki.
//
//  3. LITERÓWKA W ADRESIE ZUŻYWA PRÓBĘ W BAZIE. Kształt klucza sprawdza
//     `validateSearch` (manage) i `readPackageInviteToken` (zaproszenie), więc
//     adres z błędem dochodzi do ekranu jako BRAK KLUCZA, a nie jako klucz,
//     który zaraz wywoła odmowę.
//
//  4. PRYWATNY PANEL UCZESTNIKA TRAFIA DO INDEKSU. `/events/<slug>/me` to
//     jedyna zakładka powłoki, która nie jest stroną CMS-a organizatora - i
//     jedyna, która musi mieć `noindex`.
//
//  5. PUBLICZNA ZAKŁADKA DOSTAJE `noindex` „na wszelki wypadek”. Katalog
//     uczestników jest treścią organizatora i MA być znajdowany; dorzucony tam
//     `noindex` wycina z wyszukiwarki stronę, o którą organizator prosi.
//
//  6. TRASA GUBI PARAMETR. Zgubiony `slug` albo `token` nie wywraca ekranu -
//     pokazuje CUDZE dane albo pustkę, która wygląda jak awaria.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Wnętrza pięciu ekranów - każdy ma własny plik
// testowy (`EventMePanel`, `RegistrationManagePanel`, `PackageInviteAccept`,
// `EventAttendeesList`, `MyEventsPanel`). Tutaj stoją atrapy zapisujące to, co
// trasa im podała.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({
  panelMoje: [] as string[],
  panelZgloszenia: [] as { slug: string; token: string | null }[],
  zaproszenie: [] as (string | null)[],
  stronaModulu: [] as { slug: string; module: string }[],
  listaUczestnikow: [] as { slug: string; heading: boolean }[],
  mojeWydarzenia: 0,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/components/events/participant/organisms/EventMePanel", () => ({
  EventMePanel: ({ slug }: { slug: string }) => {
    h.panelMoje.push(slug);
    return <section data-testid="panel-moje" data-slug={slug} />;
  },
}));

vi.mock("@/components/events/registration/RegistrationManagePanel", () => ({
  RegistrationManagePanel: ({ slug, token }: { slug: string; token: string | null }) => {
    h.panelZgloszenia.push({ slug, token });
    return <section data-testid="panel-zgloszenia" data-slug={slug} data-token={token ?? ""} />;
  },
}));

vi.mock("@/components/events/registration/PackageInviteAccept", () => ({
  PackageInviteAccept: ({ token }: { token: string | null }) => {
    h.zaproszenie.push(token);
    return <section data-testid="ekran-zaproszenia" data-token={token ?? ""} />;
  },
}));

vi.mock("@/components/events/public/molecules/EventModulePage", () => ({
  EventModulePage: ({
    slug,
    module,
    children,
  }: {
    slug: string;
    module: string;
    children?: ReactNode;
  }) => {
    h.stronaModulu.push({ slug, module });
    return (
      <main data-testid="strona-modulu" data-slug={slug} data-module={module}>
        {children}
      </main>
    );
  },
}));

vi.mock("@/components/events/public/organisms/EventAttendeesList", () => ({
  EventAttendeesList: ({ slug, heading }: { slug: string; heading?: boolean }) => {
    h.listaUczestnikow.push({ slug, heading: heading !== false });
    return <div data-testid="lista-uczestnikow" data-slug={slug} />;
  },
}));

vi.mock("@/components/profile/events/MyEventsPanel", () => ({
  MyEventsPanel: () => {
    h.mojeWydarzenia += 1;
    return <section data-testid="moje-wydarzenia" />;
  },
}));

vi.mock("@/components/error/FriendlyErrorPage", () => ({
  FriendlyErrorPage: ({ variant }: { variant?: string }) => (
    <div data-testid="ekran-bledu" data-variant={variant ?? ""} />
  ),
}));

const { renderRoute, routeMeta, routeSearchValidator } = await import("@/test/routeHarness");

const { Route: MeRoute } = await import("@/routes/events.$slug.me");
const { Route: ManageRoute } = await import("@/routes/events.$slug_.manage");
const { Route: InviteRoute } = await import("@/routes/events_.invite.$token");
const { Route: ParticipantsRoute } = await import("@/routes/events.$slug.participants");
const { Route: ProfileEventsRoute } = await import("@/routes/profile.events");

const SLUG = "kongres-cee-2026";
/** 24 bajty w base64url - dokładnie taki kształt daje `_event_new_qr_token()`. */
const MANAGE_TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";
const INVITE_TOKEN = "Zq7w_Er2-Ty5uIo8pAs1dFg4hJk6lZx0";

type Wpis = Record<string, unknown>;

/** Wartość `<meta name="...">` z `head()` trasy. */
function metaTresc(wpisy: Wpis[], name: string): unknown {
  return wpisy.find((wpis) => wpis.name === name)?.content;
}

function tytul(wpisy: Wpis[]): unknown {
  return wpisy.find((wpis) => "title" in wpis)?.title;
}

/**
 * STRAŻNIK, nie rzutowanie: warunek sprawdza w RUNTIME, że opcja trasy jest
 * komponentem, i dopiero to zawęża typ - dokładnie tak, jak `isHeadFn`
 * w `src/test/routeHarness.tsx`. Ekran awarii trasy z kluczem chcemy
 * WYRENDEROWAĆ (a nie tylko sprawdzić, że istnieje), bo dowodem jest to, CO on
 * pokazuje: wspólny ekran awarii bez echa poświadczenia z adresu.
 */
function jestKomponentem(value: unknown): value is () => ReactNode {
  return typeof value === "function";
}

/** `ssr` z opcji trasy - framework nie wystawia go w typie publicznym odczytu. */
function ssrTrasy(route: { options: { ssr?: unknown } }): unknown {
  return route.options.ssr;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.panelMoje.length = 0;
  h.panelZgloszenia.length = 0;
  h.zaproszenie.length = 0;
  h.stronaModulu.length = 0;
  h.listaUczestnikow.length = 0;
  h.mojeWydarzenia = 0;
});

describe("Trasy z POŚWIADCZENIEM w adresie - `noindex` jest warunkiem, nie ozdobą", () => {
  it("samoobsługa zgłoszenia: `noindex, nofollow` ORAZ `no-referrer`", async () => {
    const wpisy = await routeMeta(ManageRoute);

    expect(metaTresc(wpisy, "robots")).toBe("noindex, nofollow");
    // Bez tego klucz `manage_token` wyjedzie w nagłówku `Referer` na pierwszy
    // obcy host, na który uczestnik kliknie z tej strony.
    expect(metaTresc(wpisy, "referrer")).toBe("no-referrer");
    expect(tytul(wpisy)).toBeTruthy();
  });

  it("zaproszenie na miejsce z pakietu: `noindex, nofollow` ORAZ `no-referrer`", async () => {
    const wpisy = await routeMeta(InviteRoute);

    expect(metaTresc(wpisy, "robots")).toBe("noindex, nofollow");
    expect(metaTresc(wpisy, "referrer")).toBe("no-referrer");
    expect(tytul(wpisy)).toBeTruthy();
  });

  it("obie trasy z kluczem mają `ssr: false` - klucz nie jedzie na serwer renderujący", () => {
    expect(ssrTrasy(ManageRoute)).toBe(false);
    expect(ssrTrasy(InviteRoute)).toBe(false);
  });

  it("obie trasy z kluczem mają WŁASNY ekran błędu i braku - i to JEDEN ekran, nie dwa", () => {
    // Ta sama funkcja pod „błędem” i pod „nie znaleziono”: awaria zapytania
    // i nieznany adres wyglądają dla uczestnika tak samo, bo w obu wypadkach
    // ma dokładnie jedną rzecz do zrobienia - i jest tylko jedno miejsce do
    // poprawienia, gdyby ten ekran miał się zmienić.
    expect(ManageRoute.options.errorComponent).toBe(ManageRoute.options.notFoundComponent);
    expect(InviteRoute.options.errorComponent).toBe(InviteRoute.options.notFoundComponent);
  });

  it("ekran awarii trasy z kluczem to WSPÓLNY ekran serwisu, bez echa poświadczenia", () => {
    const ekranZgloszenia = ManageRoute.options.errorComponent;
    const ekranZaproszenia = InviteRoute.options.errorComponent;
    if (!jestKomponentem(ekranZgloszenia) || !jestKomponentem(ekranZaproszenia)) {
      throw new Error("test: trasa z kluczem nie ma komponentu awarii");
    }

    const zgloszenie = render(ekranZgloszenia());
    expect(zgloszenie.getByTestId("ekran-bledu").getAttribute("data-variant")).toBe("compact");
    expect(zgloszenie.container.textContent).not.toContain(MANAGE_TOKEN);
    zgloszenie.unmount();

    const zaproszenie = render(ekranZaproszenia());
    expect(zaproszenie.getByTestId("ekran-bledu").getAttribute("data-variant")).toBe("compact");
    expect(zaproszenie.container.textContent).not.toContain(INVITE_TOKEN);
  });
});

describe("Prywatny panel uczestnika a publiczna zakładka - dwie różne decyzje o indeksie", () => {
  it("`/events/<slug>/me` jest prywatne: `noindex, nofollow`", async () => {
    const wpisy = await routeMeta(MeRoute);

    expect(metaTresc(wpisy, "robots")).toBe("noindex, nofollow");
    expect(tytul(wpisy)).toBeTruthy();
  });

  it("katalog uczestników NIE dostaje `noindex` - to treść organizatora, ma być znajdowana", async () => {
    const wpisy = await routeMeta(ParticipantsRoute);

    // Zakładka nie deklaruje własnego nagłówka: tytuł i opis daje dokument
    // strony CMS-a nad listą, a widoczność w wyszukiwarce jest tu ZAMIERZONA.
    expect(metaTresc(wpisy, "robots")).toBeUndefined();
  });

  it("`/profile/events` nie powtarza `noindex` - dziedziczy go po układzie `/profile`", async () => {
    const wpisy = await routeMeta(ProfileEventsRoute);

    // Powtórzony nagłówek na trasie dziecka to drugie miejsce do rozjechania
    // się z układem; bramkę i `robots` niesie `src/routes/profile.tsx`.
    expect(wpisy).toEqual([]);
  });
});

describe("Kontrakt adresu samoobsługi zgłoszenia (`validateSearch`)", () => {
  const waliduj = routeSearchValidator(ManageRoute);

  it("klucz o poprawnym kształcie przechodzi bez zmian", () => {
    expect(waliduj({ token: MANAGE_TOKEN })).toEqual({ token: MANAGE_TOKEN });
  });

  it("klucz wklejony z białymi znakami zostaje PRZYCIĘTY, a nie odrzucony", () => {
    expect(waliduj({ token: `  ${MANAGE_TOKEN}\n` })).toEqual({ token: MANAGE_TOKEN });
  });

  it("klucz o złym kształcie znika z adresu - do ekranu dojeżdża BRAK klucza", () => {
    expect(waliduj({ token: "za-krotki" })).toEqual({});
    expect(waliduj({ token: `${MANAGE_TOKEN}XX` })).toEqual({});
    expect(waliduj({ token: "Ab3d/Xy9-Qw1zEr4TyU7iOp2AsDf1gHj" })).toEqual({});
  });

  it("brak parametru i parametr nie-napis też dają pusty adres", () => {
    expect(waliduj({})).toEqual({});
    expect(waliduj({ token: 12345 })).toEqual({});
    expect(waliduj({ token: null })).toEqual({});
  });

  it("obce parametry adresu NIE przeciekają dalej - trasa zna wyłącznie `token`", () => {
    expect(waliduj({ token: MANAGE_TOKEN, utm_source: "mail", next: "/admin" })).toEqual({
      token: MANAGE_TOKEN,
    });
  });
});

describe("Montowanie tras - co ekran dostaje z adresu", () => {
  it("panel „Moje” dostaje slug ze ścieżki", async () => {
    await renderRoute({
      route: MeRoute,
      path: "/events/$slug/me",
      initialEntry: `/events/${SLUG}/me`,
    });

    await waitFor(() => expect(screen.getByTestId("panel-moje")).toBeTruthy());
    expect(h.panelMoje).toContain(SLUG);
  });

  it("samoobsługa zgłoszenia dostaje slug ORAZ klucz z adresu", async () => {
    await renderRoute({
      route: ManageRoute,
      path: "/events/$slug/manage",
      initialEntry: `/events/${SLUG}/manage?token=${MANAGE_TOKEN}`,
    });

    await waitFor(() => expect(screen.getByTestId("panel-zgloszenia")).toBeTruthy());
    expect(h.panelZgloszenia.at(-1)).toEqual({ slug: SLUG, token: MANAGE_TOKEN });
  });

  it("adres bez klucza daje panelowi `null`, a nie pusty napis", async () => {
    await renderRoute({
      route: ManageRoute,
      path: "/events/$slug/manage",
      initialEntry: `/events/${SLUG}/manage`,
    });

    await waitFor(() => expect(screen.getByTestId("panel-zgloszenia")).toBeTruthy());
    expect(h.panelZgloszenia.at(-1)).toEqual({ slug: SLUG, token: null });
  });

  it("STAN FAKTYCZNY: literówka w kluczu DOJEŻDŻA do panelu mimo walidatora", async () => {
    // Router SKLEJA wynik `validateSearch` z parametrami, które przepuścił
    // rodzic. Ani korzeń (`__root.tsx`), ani układ `/events` nie mają własnego
    // `validateSearch`, więc surowe `token=ABC` przeżywa, a `{}` zwrócone przez
    // trasę niczego nie kasuje. Ten przypadek utrwala TO, CO JEST - żeby zmiana
    // zachowania (naprawa albo regres) była widoczna, a nie cicha.
    const { search } = await renderRoute({
      route: ManageRoute,
      path: "/events/$slug/manage",
      initialEntry: `/events/${SLUG}/manage?token=ABC`,
    });

    await waitFor(() => expect(screen.getByTestId("panel-zgloszenia")).toBeTruthy());
    expect(search()).toEqual({ token: "ABC" });
    expect(h.panelZgloszenia.at(-1)?.token).toBe("ABC");
  });

  it.fails(
    "DEFEKT: klucz o złym kształcie z adresu i tak dojeżdża do panelu - zużyje próbę limitu w bazie",
    async () => {
      // Nagłówek trasy mówi wprost: „adres z literówką ma dojechać do strony
      // jako brak klucza, a nie jako klucz, który zaraz wywoła odmowę z bazy”.
      // `validateSearch` jako funkcja rzeczywiście oddaje `{}` (dowód wyżej),
      // ale router MERGUJE go z parametrami rodzica - a żaden przodek tej trasy
      // nie waliduje własnego adresu, więc surowe `token=ABC` przeżywa.
      // `RegistrationManagePanel` bierze je jako `activeToken` i WŁĄCZA
      // zapytanie (`enabled: activeToken !== null`), czyli robi dokładnie to,
      // czego trasa miała zabronić: pyta bazę o literówkę i zużywa próbę
      // limitu na kluczu, który nie ma prawa istnieć.
      await renderRoute({
        route: ManageRoute,
        path: "/events/$slug/manage",
        initialEntry: `/events/${SLUG}/manage?token=ABC`,
      });

      await waitFor(() => expect(screen.getByTestId("panel-zgloszenia")).toBeTruthy());

      // ASERCJA DOCELOWA: do panelu ma dojechać BRAK klucza, nie literówka.
      expect(h.panelZgloszenia.at(-1)?.token).toBeNull();
    },
  );

  it("zaproszenie dostaje token ze ŚCIEŻKI, a nie z zapytania", async () => {
    await renderRoute({
      route: InviteRoute,
      path: "/events/invite/$token",
      initialEntry: `/events/invite/${INVITE_TOKEN}`,
    });

    await waitFor(() => expect(screen.getByTestId("ekran-zaproszenia")).toBeTruthy());
    expect(h.zaproszenie.at(-1)).toBe(INVITE_TOKEN);
  });

  it("zaproszenie z tokenem o złym kształcie dostaje `null` - ekran powie o złym odnośniku", async () => {
    await renderRoute({
      route: InviteRoute,
      path: "/events/invite/$token",
      initialEntry: "/events/invite/za-krotki",
    });

    await waitFor(() => expect(screen.getByTestId("ekran-zaproszenia")).toBeTruthy());
    expect(h.zaproszenie.at(-1)).toBeNull();
  });

  it("zakładka uczestników sięga po moduł `participants` i NIE dubluje nagłówka listy", async () => {
    await renderRoute({
      route: ParticipantsRoute,
      path: "/events/$slug/participants",
      initialEntry: `/events/${SLUG}/participants`,
    });

    await waitFor(() => expect(screen.getByTestId("lista-uczestnikow")).toBeTruthy());
    expect(h.stronaModulu.at(-1)).toEqual({ slug: SLUG, module: "participants" });
    // `heading={false}`: `h1` i zdanie wstępu daje dokument strony CMS nad listą.
    expect(h.listaUczestnikow.at(-1)).toEqual({ slug: SLUG, heading: false });
  });

  it("historia wydarzeń w profilu to CIENKA trasa nad panelem - zero własnej logiki", async () => {
    await renderRoute({
      route: ProfileEventsRoute,
      path: "/profile/events",
      initialEntry: "/profile/events",
    });

    await waitFor(() => expect(screen.getByTestId("moje-wydarzenia")).toBeTruthy());
    expect(h.mojeWydarzenia).toBeGreaterThan(0);
  });
});

describe("Trasy uczestnika - dostępność", () => {
  it("zamontowana trasa samoobsługi zgłoszenia nie ma naruszeń axe", async () => {
    const { container } = await renderRoute({
      route: ManageRoute,
      path: "/events/$slug/manage",
      initialEntry: `/events/${SLUG}/manage?token=${MANAGE_TOKEN}`,
    });

    await waitFor(() => expect(screen.getByTestId("panel-zgloszenia")).toBeTruthy());
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("zamontowana trasa zaproszenia nie ma naruszeń axe", async () => {
    const { container } = await renderRoute({
      route: InviteRoute,
      path: "/events/invite/$token",
      initialEntry: `/events/invite/${INVITE_TOKEN}`,
    });

    await waitFor(() => expect(screen.getByTestId("ekran-zaproszenia")).toBeTruthy());
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("zamontowana trasa panelu „Moje” nie ma naruszeń axe", async () => {
    const { container } = await renderRoute({
      route: MeRoute,
      path: "/events/$slug/me",
      initialEntry: `/events/${SLUG}/me`,
    });

    await waitFor(() => expect(screen.getByTestId("panel-moje")).toBeTruthy());
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
