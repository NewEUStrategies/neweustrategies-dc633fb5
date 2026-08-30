// Trzy sekcje studia wydarzenia, ktore stały na 0% funkcji:
//   `/admin/events/<id>/analytics`      - trasa CIENKA nad panelem analityki,
//   `/admin/events/<id>/communications` - DROGOWSKAZ, sekcja bez powierzchni,
//   `/admin/events/<id>/integrations`   - DROGOWSKAZ, sekcja bez powierzchni.
//
// PO CO TEN PLIK ISTNIEJE. Dwie z tych trzech trasy nie renderuja zadnej
// funkcji produktowej - i to jest DECYZJA, nie brak. Sidebar studia wymienia
// „Komunikacje" i „Integracje", bo naleza do mapy modulu; klikniecie w nie ma
// jednak konczyc sie ZDANIEM O TYM, GDZIE TA PRACA DZIS MIESZKA, a nie bialym
// ekranem. Test, ktory tylko „renderuje komponent", nie odroznia tych dwoch
// rzeczy - a dla redaktora to jest cala roznica miedzy „jeszcze tego nie ma"
// a „znowu sie nie wczytalo".
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. DROGOWSKAZ ZAMIENIA SIE W PUSTKE. Ktos usuwa zdanie opisowe albo
//      przycisk (bo „i tak nic tu nie ma") i sekcja zostaje sama nazwa nad
//      pusta ramka - nieodrozniallna od ekranu, ktoremu padlo zapytanie.
//   2. DROGOWSKAZ PROWADZI NIE TAM. Jeden komponent obsluguje OBIE sekcje,
//      a roznica miedzy nimi to dwa klucze i adres; podmieniona galaz `switch`
//      wysyla redaktora z komunikacji do integracji i odwrotnie. Na ekranie
//      wyglada to poprawnie, bo napis przycisku jest ten sam.
//   3. TRASA DROGOWSKAZU ZACZYNA PYTAC O DANE. Ekran nie renderuje wiersza
//      wydarzenia, wiec kazde zapytanie o niego jest wylacznie kosztem - i
//      wprowadza stan bledu tam, gdzie nie ma czego zepsuc.
//   4. STUDIO WCHODZI DO WYSZUKIWARKI. Adres z identyfikatorem wydarzenia
//      w indeksie Google to wyciek mapy panelu; `noindex, nofollow` musi stac
//      na KAZDEJ z trzech trasy.
//   5. ANALITYKA GUBI PARAMETR. Trasa czyta `$eventId` ze sciezki i podaje go
//      panelowi; zgubiony parametr nie wywraca ekranu, tylko pokazuje liczby
//      CUDZEGO wydarzenia.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Zawartosci pulpitu analityki - ma wlasny
// plik (`EventAnalyticsPanel.test.tsx`), tutaj panel stoi na atrapie, ktora
// zapisuje otrzymany wiersz. (2) Bramki dostepu do panelu - egzekwuje ja
// wspolny uklad `/admin` i `adminRouteAuthority.gate.test.ts`. (3) Spinnera
// i zdania „nie znaleziono" - nalezą do ramy studia (`EventStudioShell`),
// a nie do tych trzech trasy; tutaj dowodzimy tylko, ze trasa ich NIE DUBLUJE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  /** Wiersze, ktore trasa analityki podala panelowi - w kolejnosci renderu. */
  wiersze: [] as { id: string; title_pl: string }[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));

// `<Link>` prowadzi do modulu GLOBALNEGO, ktorego nie ma w drzewie zmontowanym
// przez harness - a router typuje `to` po zbiorze tras. Atrapa zostawia z niego
// to, co jest przedmiotem dowodu: prawdziwy `href` w dostepnym odnosniku.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// Pulpit analityki ma wlasny plik testowy i wlasne cztery zapytania. Tutaj
// przedmiotem dowodu jest to, CO trasa mu podaje - nie to, jak on to rysuje.
vi.mock("@/components/admin/events/organisms/EventAnalyticsPanel", () => ({
  EventAnalyticsPanel: ({ row }: { row: AdminEventDetailRow }) => {
    h.wiersze.push({ id: row.id, title_pl: row.title_pl });
    return <div data-testid="pulpit-analityki" data-event-id={row.id} />;
  },
}));

const { renderRoute, routeHead } = await import("@/test/routeHarness");
const { Route: AnalyticsRoute } = await import("@/routes/admin.events_.$eventId.analytics");
const { Route: CommunicationsRoute } =
  await import("@/routes/admin.events_.$eventId.communications");
const { Route: IntegrationsRoute } = await import("@/routes/admin.events_.$eventId.integrations");

const EVENT_ID = "3f1a0c8e-0000-4000-8000-000000000042";
const SEKCJE = "adminEvents.studio.sections.";
const EXTERNAL = "adminEvents.studio.external.";

/** Wiersz `admin_event_detail` w minimalnym ksztalcie, ktorego dotyka atrapa. */
function detailRow(): Record<string, string> {
  return { id: EVENT_ID, title_pl: "Kongres Energetyczny", title_en: "Energy Congress" };
}

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function meta(route: Parameters<typeof routeHead>[0]): Record<string, unknown>[] {
  return (routeHead(route).meta ?? []) as Record<string, unknown>[];
}

/** Wartosc znacznika `<meta name="...">` z `head()` trasy. */
function metaTresc(entries: Record<string, unknown>[], name: string): unknown {
  return entries.find((entry) => entry.name === name)?.content;
}

function tytul(entries: Record<string, unknown>[]): unknown {
  return entries.find((entry) => "title" in entry)?.title;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.wiersze = [];
});

afterEach(cleanup);

describe("/admin/events/$eventId/analytics - trasa CIENKA nad pulpitem", () => {
  it("podaje pulpitowi wiersz TEGO wydarzenia, wziety z parametru sciezki", async () => {
    // To jest cala robota tej trasy. Zgubiony `$eventId` nie wywraca ekranu -
    // pokazuje liczby cudzego wydarzenia, a te wygladaja rownie wiarygodnie.
    stub().setData("admin_event_detail", [detailRow()]);

    await renderRoute({
      route: AnalyticsRoute,
      path: "/admin/events/$eventId/analytics",
      initialEntry: `/admin/events/${EVENT_ID}/analytics`,
    });

    await waitFor(() => expect(screen.getByTestId("pulpit-analityki")).toBeInTheDocument());
    expect(stub().lastCall("admin_event_detail")?.arg("p_event_id")).toBe(EVENT_ID);
    expect(h.wiersze.at(-1)).toEqual({ id: EVENT_ID, title_pl: "Kongres Energetyczny" });
  });

  it("dopoki wiersz nie przyszedl, trasa MILCZY - nie rysuje wlasnego spinnera", async () => {
    // Rama studia ma juz spinner i zdanie „nie znaleziono". Drugi komplet w
    // sekcji dalby dwa stany oczekiwania jeden pod drugim i dwa miejsca do
    // rozjechania sie, gdy zdanie zmieni brzmienie.
    stub().setData("admin_event_detail", [detailRow()]);

    const { container } = await renderRoute({
      route: AnalyticsRoute,
      path: "/admin/events/$eventId/analytics",
      initialEntry: `/admin/events/${EVENT_ID}/analytics`,
    });

    // Pierwszy render: zapytanie dopiero rusza, wiec trasa oddaje pustke...
    expect(container.textContent).toBe("");
    expect(container.querySelector(".animate-spin")).toBeNull();
    // ...a nie jest to pustka „na zawsze": zapytanie o wiersz JEST w drodze.
    await waitFor(() => expect(screen.getByTestId("pulpit-analityki")).toBeInTheDocument());
  });

  it("wydarzenie NIEZNALEZIONE zostawia trasę pustą, bez wlasnego komunikatu", async () => {
    // `admin_event_detail` oddaje pusty zbior takze wtedy, gdy identyfikator
    // z adresu nalezy do innej organizacji. Zdanie „nie znaleziono" mowi rama
    // studia; trasa, ktora powiedzialaby je drugi raz, dalaby dwa komunikaty
    // o tym samym - i tylko jeden z nich bylby aktualizowany.
    stub().setData("admin_event_detail", []);

    const { container } = await renderRoute({
      route: AnalyticsRoute,
      path: "/admin/events/$eventId/analytics",
      initialEntry: `/admin/events/${EVENT_ID}/analytics`,
    });

    await waitFor(() => expect(stub().callsFor("admin_event_detail")).toHaveLength(1));
    expect(screen.queryByTestId("pulpit-analityki")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("naglowek dokumentu trzyma studio POZA wyszukiwarka", () => {
    const entries = meta(AnalyticsRoute);
    expect(tytul(entries)).toBe("Analytics · Event · Admin");
    expect(metaTresc(entries, "robots")).toBe("noindex, nofollow");
    expect(String(metaTresc(entries, "description"))).toContain("check-in");
  });
});

/**
 * Obie sekcje bez wlasnej powierzchni, opisane DANYMI - dokladnie tak, jak
 * rozni je komponent: dwa klucze i adres docelowy.
 */
const DROGOWSKAZY = [
  {
    nazwa: "communications",
    route: CommunicationsRoute,
    sciezka: "/admin/events/$eventId/communications",
    tytulDokumentu: "Communications · Event · Admin",
    sekcjaKey: `${SEKCJE}communications`,
    tytulKey: `${EXTERNAL}communicationsTitle`,
    opisKey: `${EXTERNAL}communicationsDescription`,
    cel: "/admin/newsletter/campaigns",
  },
  {
    nazwa: "integrations",
    route: IntegrationsRoute,
    sciezka: "/admin/events/$eventId/integrations",
    tytulDokumentu: "Integrations · Event · Admin",
    sekcjaKey: `${SEKCJE}integrations`,
    tytulKey: `${EXTERNAL}integrationsTitle`,
    opisKey: `${EXTERNAL}integrationsDescription`,
    cel: "/admin/integrations",
  },
] as const;

describe.each(DROGOWSKAZY)(
  "/admin/events/<id>/$nazwa - sekcja BEZ wlasnej powierzchni",
  ({ nazwa, route, sciezka, tytulDokumentu, sekcjaKey, tytulKey, opisKey, cel }) => {
    async function pokaz() {
      return renderRoute({
        route,
        path: sciezka,
        initialEntry: `/admin/events/${EVENT_ID}/${nazwa}`,
      });
    }

    it("MOWI, ze modulu per wydarzenie jeszcze nie ma - i gdzie ta praca dzis mieszka", async () => {
      // To jest utrwalenie ZASLEPKI JAKO DECYZJI. Ekran ma trzy czesci i
      // wszystkie trzy sa konieczne: nazwe sekcji (ta sama, co w sidebarze -
      // redaktor ma wiedziec, ze trafil tam, gdzie klikal), naglowek wiersza
      // i ZDANIE o tym, gdzie kampanie/integracje sa dzis ustawiane. Bez
      // zdania zostaje sama nazwa nad pusta ramka, czyli obraz nie do
      // odroznienia od nieudanego wczytania.
      await pokaz();

      expect(screen.getByRole("heading", { level: 1, name: sekcjaKey })).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 2, name: tytulKey })).toBeInTheDocument();
      expect(screen.getByText(opisKey)).toBeInTheDocument();
    });

    it("odsyla do modulu GLOBALNEGO, a nie do jego kopii w studiu", async () => {
      // Jeden komponent obsluguje obie sekcje; podmieniona galaz `switch`
      // wysyla redaktora pod cudzy adres, a napis przycisku jest ten sam,
      // wiec na ekranie nic nie wyglada podejrzanie.
      await pokaz();

      const link = screen.getByRole("link", { name: `${EXTERNAL}openModule` });
      expect(link.getAttribute("href")).toBe(cel);
    });

    it("NIE PYTA BAZY O NIC - pustka jest zamierzona, nie jest skutkiem odmowy", async () => {
      // Najwazniejsza asercja tego pliku. Ekran jest drogowskazem, wiec nie
      // wysyla ani jednego zapytania: nie ma czego wczytac, nie ma czego
      // zepsuc i nie ma stanu bledu, ktory redaktor moglby wziac za „modul
      // jest, tylko sie nie otworzyl".
      await pokaz();

      expect(stub().names()).toEqual([]);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("naglowek dokumentu trzyma studio POZA wyszukiwarka", () => {
      const entries = meta(route);
      expect(tytul(entries)).toBe(tytulDokumentu);
      expect(metaTresc(entries, "robots")).toBe("noindex, nofollow");
      expect(String(metaTresc(entries, "description"))).toContain("this event");
    });

    it("jest czysty dla axe", async () => {
      const { container } = await pokaz();

      const violations = await axeViolations(container);
      expect(violations, summarize(violations)).toEqual([]);
    });
  },
);

describe("drogowskazy studia - dwie sekcje, nie jedna", () => {
  it("komunikacja i integracje maja ROZNE zdanie i ROZNY adres docelowy", async () => {
    // Komponent jest jeden, wiec najtansza regresja tego obszaru to sekcja,
    // ktora po refaktorze pokazuje tresc siostry. Ten test porownuje oba
    // ekrany wprost, zamiast sprawdzac kazdy z osobna przeciw literałowi.
    const komunikacja = await renderRoute({
      route: CommunicationsRoute,
      path: "/admin/events/$eventId/communications",
      initialEntry: `/admin/events/${EVENT_ID}/communications`,
    });
    const tekstKomunikacji = komunikacja.container.textContent ?? "";
    const celKomunikacji = komunikacja.container.querySelector("a")?.getAttribute("href");
    komunikacja.unmount();

    const integracje = await renderRoute({
      route: IntegrationsRoute,
      path: "/admin/events/$eventId/integrations",
      initialEntry: `/admin/events/${EVENT_ID}/integrations`,
    });

    expect(integracje.container.textContent ?? "").not.toBe(tekstKomunikacji);
    expect(integracje.container.querySelector("a")?.getAttribute("href")).not.toBe(celKomunikacji);
  });
});
