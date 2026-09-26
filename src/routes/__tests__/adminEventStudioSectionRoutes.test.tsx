// Sekcje studia wydarzenia, ktore stały na 0% funkcji:
//   `/admin/events/<id>/analytics`      - trasa CIENKA nad panelem analityki,
//   `/admin/events/<id>/integrations`   - DROGOWSKAZ, sekcja bez powierzchni,
// oraz dwie trasy CIENKIE F1-F5 (spec B.12):
//   `/admin/events/<id>/communications` - od F1-F5 prawdziwy panel
//      (przypomnienia, kalendarz, dziennik doreczen) zamiast drogowskazu,
//   `/admin/events/<id>/registration/policies` - zasady biletow.
//
// PO CO TEN PLIK ISTNIEJE. Trasa integracji nie renderuje zadnej funkcji
// produktowej - i to jest DECYZJA, nie brak. Sidebar studia wymienia
// „Integracje", bo naleza do mapy modulu; klikniecie w nie ma jednak konczyc
// sie ZDANIEM O TYM, GDZIE TA PRACA DZIS MIESZKA, a nie bialym ekranem
// („Komunikacja" byla takim drogowskazem do F1-F5; dzis ma panel). Test, ktory tylko „renderuje komponent", nie odroznia tych dwoch
// rzeczy - a dla redaktora to jest cala roznica miedzy „jeszcze tego nie ma"
// a „znowu sie nie wczytalo".
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. DROGOWSKAZ ZAMIENIA SIE W PUSTKE. Ktos usuwa zdanie opisowe albo
//      przycisk (bo „i tak nic tu nie ma") i sekcja zostaje sama nazwa nad
//      pusta ramka - nieodrozniallna od ekranu, ktoremu padlo zapytanie.
//   2. DROGOWSKAZ PROWADZI NIE TAM. Adres modulu globalnego stoi w galezi
//      `switch`; podmieniony wysyla redaktora pod cudzy modul, a na ekranie
//      wyglada to poprawnie, bo napis przycisku jest ten sam. Trasa komunikacji
//      nie moze tez wrocic do drogowskazu - rysuje panel F1-F5.
//   3. TRASA DROGOWSKAZU ZACZYNA PYTAC O DANE. Ekran nie renderuje wiersza
//      wydarzenia, wiec kazde zapytanie o niego jest wylacznie kosztem - i
//      wprowadza stan bledu tam, gdzie nie ma czego zepsuc.
//   4. STUDIO WCHODZI DO WYSZUKIWARKI. Adres z identyfikatorem wydarzenia
//      w indeksie Google to wyciek mapy panelu; `noindex, nofollow` musi stac
//      na KAZDEJ z tych trasy.
//   5. ANALITYKA GUBI PARAMETR. Trasa czyta `$eventId` ze sciezki i podaje go
//      panelowi; zgubiony parametr nie wywraca ekranu, tylko pokazuje liczby
//      CUDZEGO wydarzenia.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Zawartosci pulpitu analityki - ma wlasny
// plik (`EventAnalyticsPanel.test.tsx`), tutaj panel stoi na atrapie, ktora
// zapisuje otrzymany wiersz. (2) Bramki dostepu do panelu - egzekwuje ja
// wspolny uklad `/admin` i `adminRouteAuthority.gate.test.ts`. (3) Spinnera
// i zdania „nie znaleziono" - nalezą do ramy studia (`EventStudioShell`),
// a nie do tych trasy; tutaj dowodzimy tylko, ze trasa ich NIE DUBLUJE.
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

// Panele F1-F5 maja wlasne pliki testowe (formularze, zapis, dziennik); tutaj
// przedmiotem dowodu jest to, ze CIENKA trasa podaje im wiersz TEGO wydarzenia.
vi.mock("@/components/admin/events/organisms/EventCommunicationsPanel", () => ({
  EventCommunicationsPanel: ({ row }: { row: AdminEventDetailRow }) => {
    h.wiersze.push({ id: row.id, title_pl: row.title_pl });
    return <div data-testid="panel-komunikacji" data-event-id={row.id} />;
  },
}));
vi.mock("@/components/admin/events/organisms/EventRegistrationPoliciesPanel", () => ({
  EventRegistrationPoliciesPanel: ({ row }: { row: AdminEventDetailRow }) => {
    h.wiersze.push({ id: row.id, title_pl: row.title_pl });
    return <div data-testid="panel-zasad-biletow" data-event-id={row.id} />;
  },
}));

const { renderRoute, routeHead } = await import("@/test/routeHarness");
const { Route: AnalyticsRoute } = await import("@/routes/admin.events_.$eventId.analytics");
const { Route: CommunicationsRoute } =
  await import("@/routes/admin.events_.$eventId.communications");
const { Route: IntegrationsRoute } = await import("@/routes/admin.events_.$eventId.integrations");
const { Route: PoliciesRoute } =
  await import("@/routes/admin.events_.$eventId.registration.policies");

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
 * Sekcje bez wlasnej powierzchni, opisane DANYMI - dokladnie tak, jak rozni je
 * komponent: dwa klucze i adres docelowy. „Komunikacja" byla tu do F1-F5; dzis
 * ma prawdziwy panel (patrz blok „trasy cienkie F1-F5" nizej).
 */
const DROGOWSKAZY = [
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
      // Adres modulu stoi w galezi `switch`; podmieniona galaz
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

describe("komunikacja - od F1-F5 panel, a nie drogowskaz", () => {
  it("trasa komunikacji NIE rysuje drogowskazu: bez zdania „gdzie ta praca mieszka” i bez przycisku modulu", async () => {
    // Drogowskaz zna dzis wylacznie integracje (`EventStudioExternalKey`).
    // Powrot trasy komunikacji do drogowskazu pokazalby redaktorowi zdanie
    // o kampaniach zamiast przypomnien i dziennika doreczen TEGO wydarzenia.
    stub().setData("admin_event_detail", [detailRow()]);

    await renderRoute({
      route: CommunicationsRoute,
      path: "/admin/events/$eventId/communications",
      initialEntry: `/admin/events/${EVENT_ID}/communications`,
    });

    await waitFor(() => expect(screen.getByTestId("panel-komunikacji")).toBeInTheDocument());
    expect(screen.queryByText(`${EXTERNAL}communicationsDescription`)).toBeNull();
    expect(screen.queryByRole("link", { name: `${EXTERNAL}openModule` })).toBeNull();
  });
});

/** Trasy CIENKIE F1-F5 nad panelami ustawien uczestnika (spec B.12). */
const TRASY_F1_F5 = [
  {
    nazwa: "communications",
    route: CommunicationsRoute,
    sciezka: "/admin/events/$eventId/communications",
    adres: `/admin/events/${EVENT_ID}/communications`,
    tytulDokumentu: "Communications · Event · Admin",
    panel: "panel-komunikacji",
  },
  {
    nazwa: "registration/policies",
    route: PoliciesRoute,
    sciezka: "/admin/events/$eventId/registration/policies",
    adres: `/admin/events/${EVENT_ID}/registration/policies`,
    tytulDokumentu: "Ticket policies · Event · Admin",
    panel: "panel-zasad-biletow",
  },
] as const;

describe.each(TRASY_F1_F5)(
  "/admin/events/<id>/$nazwa - trasa CIENKA nad panelem F1-F5",
  ({ route, sciezka, adres, tytulDokumentu, panel }) => {
    it("podaje panelowi wiersz TEGO wydarzenia, wziety z parametru sciezki", async () => {
      stub().setData("admin_event_detail", [detailRow()]);

      await renderRoute({ route, path: sciezka, initialEntry: adres });

      await waitFor(() => expect(screen.getByTestId(panel)).toBeInTheDocument());
      expect(stub().lastCall("admin_event_detail")?.arg("p_event_id")).toBe(EVENT_ID);
      expect(h.wiersze.at(-1)).toEqual({ id: EVENT_ID, title_pl: "Kongres Energetyczny" });
    });

    it("dopoki wiersz nie przyszedl albo go nie ma, trasa MILCZY", async () => {
      stub().setData("admin_event_detail", []);

      const { container } = await renderRoute({ route, path: sciezka, initialEntry: adres });

      expect(container.textContent).toBe("");
      await waitFor(() => expect(stub().callsFor("admin_event_detail")).toHaveLength(1));
      expect(screen.queryByTestId(panel)).toBeNull();
      expect(container.textContent).toBe("");
    });

    it("naglowek dokumentu: sam tytul i `noindex, nofollow` - BEZ opisu (R-ROUTE)", () => {
      const entries = meta(route);
      expect(tytul(entries)).toBe(tytulDokumentu);
      expect(metaTresc(entries, "robots")).toBe("noindex, nofollow");
      expect(metaTresc(entries, "description")).toBeUndefined();
      expect(entries).toHaveLength(2);
    });
  },
);
