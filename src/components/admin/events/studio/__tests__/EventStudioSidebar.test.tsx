// LEWY PAS STUDIA - dwadziescia dziewiec ekranow jednego wydarzenia.
//
// PO CO TEN PLIK ISTNIEJE. Sidebar jest JEDYNA mapa studia: nie ma tu okruszkow
// ani drugiej nawigacji, wiec pozycja, ktorej sidebar nie narysuje, jest dla
// redaktora nieosiagalna, a pozycja narysowana za duzo prowadzi na ekran
// wylaczonego modulu. Obie pomylki wygladaja na ekranie jak poprawna lista.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. POZYCJA WYLACZONEGO MODULU PROWADZI DONIKAD. Rama liczy zbior sekcji do
//      ukrycia, ale to sidebar ma ich NIE RYSOWAC. Zgubiony filtr daje wiersz,
//      ktory po klikniecie oddaje zdanie „modul wylaczony" - czyli nawigacje
//      prowadzaca w slepy zaulek.
//   2. GRUPA BEZ DZIECI ZOSTAJE NAGLOWKIEM. Sam naglowek jest wierszem, ktory
//      po rozwinieciu nic nie pokazuje, a po klikniecie prowadzi na ekran
//      wylaczonego modulu.
//   3. NAGLOWEK GRUPY PROWADZI NA UKRYTE DZIECKO. Adres domyslny wypisany
//      w modelu moze byc wlasnie tym, ktory schowal przelacznik - wtedy klik
//      w nazwe grupy laduje na zdaniu o wylaczonym module zamiast na pierwszym
//      dzialajacym ekranie.
//   4. WYSZUKIWARKA ODDAJE WYNIK, KTORY NIE PROWADZI DO PRACY. Filtr modulow
//      musi dzialac PRZED wyszukiwaniem: haslo „stoliki" w wydarzeniu bez
//      gieldy spotkan ma nie dawac nic, a nie dawac wiersz do nikad.
//   5. GRUPA Z AKTYWNYM EKRANEM DAJE SIE ZWINAC. Kontrolka, ktora nie robi
//      tego, co obiecuje (grupa i tak zostaje otwarta), jest gorsza niz jej
//      brak - dlatego w tym stanie ma stac SAMA STRZALKA, bez przycisku.
//
// CZEGO SWIADOMIE NIE DUBLUJE. Modelu nawigacji (`eventStudioNav.test.ts`)
// i mapy „funkcja -> sekcje" (`eventFeatures.test.ts`). Zbior ukrytych sekcji
// liczy tu PRAWDZIWY `hiddenStudioSections`, bo przedmiotem dowodu jest droga
// „przelacznik -> brak wiersza w pasie", a nie tabela samej mapy.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";
import { STUDIO_EVENT_ID } from "@/test/events/adminEventStudioRows";
import {
  ALL_EVENT_FEATURES_ENABLED,
  hiddenStudioSections,
  type EventFeaturesDraft,
} from "@/lib/events/eventFeatures";
import type { EventStudioSection } from "@/lib/events/eventStudioNav";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-agenda", () => ({ ensureAgendaI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-meetings", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-onsite", () => ({ ensureOnsiteI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-registration", () => ({ ensureI18n: () => undefined }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/lib/icons/DynamicIcon", () => ({
  DynamicIcon: ({ name }: { name: string }) => <span data-testid={`ikona-${name}`} />,
}));

const { EventStudioSidebar } = await import("@/components/admin/events/studio/EventStudioSidebar");

function sciezka(ogon: string): string {
  return `/admin/events/${STUDIO_EVENT_ID}/${ogon}`;
}

/** Zbior sekcji ukrytych przez przelaczniki - liczony PRAWDZIWA mapa modulow. */
function ukryte(wylaczone: Partial<EventFeaturesDraft>): ReadonlySet<EventStudioSection> {
  return hiddenStudioSections({ ...ALL_EVENT_FEATURES_ENABLED, ...wylaczone });
}

function pas(
  options: {
    activeSection?: EventStudioSection | null;
    hiddenSections?: ReadonlySet<EventStudioSection>;
    publicHref?: string | null;
  } = {},
) {
  return render(
    <EventStudioSidebar
      eventId={STUDIO_EVENT_ID}
      eventTitle="Kongres Energetyczny"
      startsAtLabel="1 wrzesnia 2026, 11:00"
      activeSection={options.activeSection ?? null}
      hiddenSections={options.hiddenSections ?? new Set()}
      publicHref={options.publicHref ?? null}
    />,
  );
}

/** Adresy WSZYSTKICH odnosnikow pasa - do asercji „tego wiersza nie ma". */
function adresy(): string[] {
  return screen
    .getAllByRole("link")
    .map((link) => link.getAttribute("href") ?? "")
    .filter((value) => value !== "");
}

function href(tekst: string): string | null {
  const link = screen.queryByRole("link", { name: tekst });
  return link === null ? null : link.getAttribute("href");
}

function wpisz(fraza: string): void {
  fireEvent.change(screen.getByLabelText("adminEvents.studio.nav.searchPlaceholder"), {
    target: { value: fraza },
  });
}

afterEach(cleanup);

describe("EventStudioSidebar - pozycje wylaczonych modulow", () => {
  it("modul WLACZONY: grupa spotkan stoi w pasie i prowadzi na swoj pierwszy ekran", () => {
    pas({ activeSection: "meetingsTables" });

    expect(href("adminEvents.studio.groups.meetings")).toBe(sciezka("meetings/tables"));
    expect(href("adminEventMeetings.nav.tables")).toBe(sciezka("meetings/tables"));
  });

  it("modul WYLACZONY: ani grupy, ani zadnego adresu spotkan - wiersz do nikad nie powstaje", () => {
    // Druga polowa pary. Asercja idzie po KOMPLECIE adresow, a nie po jednej
    // etykiecie: pozycja moze zostac pod inna nazwa, a adres zdradza ja zawsze.
    pas({ hiddenSections: ukryte({ meetings: false }) });

    expect(href("adminEvents.studio.groups.meetings")).toBeNull();
    expect(adresy().some((adres) => adres.includes("/meetings/"))).toBe(false);
  });

  it("wylaczenie POJEDYNCZEJ sekcji zabiera jej wiersz, a grupe zostawia", () => {
    pas({ activeSection: "registrationList", hiddenSections: ukryte({ tickets: false }) });

    expect(href("adminEventRegistration.nav.registrations")).toBe(sciezka("registration/list"));
    expect(href("adminEventRegistration.nav.tickets")).toBeNull();
    expect(adresy()).not.toContain(sciezka("registration/tickets"));
  });

  it("naglowek grupy prowadzi na pierwsze WIDOCZNE dziecko, a nie na ukryte domyslne", () => {
    // Domyslnym dzieckiem grupy rejestracji sa „Ustawienia rejestracji"; gdy
    // przelacznik schowa cala grupe poza jednym ekranem, naglowek ma prowadzic
    // na TEN ekran, a nie na zdanie o wylaczonym module.
    const bezUstawien = new Set<EventStudioSection>([
      "registrationSettings",
      "registrationList",
      "registrationTickets",
      "registrationPackages",
      "registrationAudiences",
    ]);
    pas({ hiddenSections: bezUstawien });

    expect(href("adminEvents.studio.groups.registration")).toBe(sciezka("registration/form"));
  });

  it("wylaczenie WSZYSTKICH modulow zostawia pozycje, ktorych zaden przelacznik nie chowa", () => {
    // Pulpit, komunikacja, integracje, analityka i same „Funkcje dodatkowe" nie
    // maja przelacznika - inaczej dalo by sie wylaczyc ekran, z ktorego jako
    // jedynego da sie cokolwiek wlaczyc z powrotem.
    pas({
      hiddenSections: ukryte({
        pages: false,
        registration: false,
        tickets: false,
        sessions: false,
        meetings: false,
        onsite: false,
        sponsors: false,
      }),
    });

    expect(href("adminEvents.studio.sections.features")).toBe(sciezka("features"));
    expect(href("adminEvents.studio.sections.overview")).toBe(sciezka("overview"));
    expect(href("adminEvents.studio.sections.analytics")).toBe(sciezka("analytics"));
  });
});

describe("EventStudioSidebar - wyszukiwarka", () => {
  it("modul WLACZONY: haslo o stolikach prowadzi do gieldy spotkan", () => {
    pas();
    wpisz("adminEvents.studio.keywords.meetingsTables");

    expect(href("adminEventMeetings.nav.tables")).toBe(sciezka("meetings/tables"));
  });

  it("modul WYLACZONY: to samo haslo nie daje NICZEGO - wynik bez pracy jest gorszy niz brak", () => {
    // Filtr modulow musi stac PRZED wyszukiwaniem. Odwrotna kolejnosc dawalaby
    // trafienie w wydarzeniu, ktore gieldy spotkan nie ma.
    pas({ hiddenSections: ukryte({ meetings: false }) });
    wpisz("adminEvents.studio.keywords.meetingsTables");

    expect(screen.getByText("adminEvents.studio.nav.searchEmpty")).toBeInTheDocument();
    expect(href("adminEventMeetings.nav.tables")).toBeNull();
  });

  it("trafienie w nazwe GRUPY pokazuje cala grupe - naglowek bez dzieci nie jest wynikiem", () => {
    pas();
    wpisz("adminEvents.studio.groups.onsite");

    expect(href("adminEventOnsite.nav.desk")).toBe(sciezka("onsite/desk"));
    expect(href("adminEventOnsite.nav.leads")).toBe(sciezka("onsite/leads"));
  });

  it("fraza bez trafien konczy sie ZDANIEM, a nie pustym pasem", () => {
    pas();
    wpisz("kwantowy-teleport");

    expect(screen.getByText("adminEvents.studio.nav.searchEmpty")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "adminEvents.studio.sections.overview" })).toBeNull();
  });
});

describe("EventStudioSidebar - stan grup i aktywny ekran", () => {
  it("grupy sa domyslnie ZWINIETE, otwiera sie ta z aktywnym ekranem", () => {
    pas({ activeSection: "onsiteLog" });

    expect(href("adminEventOnsite.nav.log")).toBe(sciezka("onsite/log"));
    // Grupa bez aktywnego ekranu zostaje zwinieta - dwadziescia dziewiec
    // wierszy naraz to lista do przewijania przy kazdym spojrzeniu.
    expect(href("adminEventMeetings.nav.tables")).toBeNull();
  });

  it("grupy z aktywnym ekranem NIE DA SIE zwinac - i dlatego nie ma tam przycisku", () => {
    pas({ activeSection: "onsiteLog" });

    // Przycisk strzalki istnieje dla grup, w ktorych nie stoimy...
    expect(
      screen.getAllByRole("button", { name: "adminEvents.studio.nav.expandGroup" }).length,
    ).toBeGreaterThan(0);
    // ...ale nie ma ani jednego przycisku „zwin", bo jedyna otwarta grupa jest
    // otwarta z definicji.
    expect(
      screen.queryByRole("button", { name: "adminEvents.studio.nav.collapseGroup" }),
    ).toBeNull();
  });

  it("strzalka zaglada do grupy, w ktorej nie stoimy, i zwija ja z powrotem", () => {
    pas({ activeSection: "overview" });
    expect(href("adminEventMeetings.nav.tables")).toBeNull();

    const strzalki = screen.getAllByRole("button", {
      name: "adminEvents.studio.nav.expandGroup",
    });
    // Grupy w kolejnosci modelu: kreator, rejestracja, tresc, spotkania, na miejscu.
    fireEvent.click(strzalki[3]);
    expect(href("adminEventMeetings.nav.tables")).toBe(sciezka("meetings/tables"));

    fireEvent.click(screen.getByRole("button", { name: "adminEvents.studio.nav.collapseGroup" }));
    expect(href("adminEventMeetings.nav.tables")).toBeNull();
  });

  it("aktywna pozycja niesie `aria-current` - podswietlenie samym kolorem nie dojdzie do czytnika", () => {
    pas({ activeSection: "onsiteLog" });

    const aktywna = screen.getByRole("link", { name: "adminEventOnsite.nav.log" });
    expect(aktywna).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "adminEventOnsite.nav.desk" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

describe("EventStudioSidebar - naglowek wydarzenia i wyjscia", () => {
  it("naglowek pokazuje nazwe, termin i DWA rozne wyjscia", () => {
    pas({ publicHref: "/events/kongres-energetyczny" });

    expect(screen.getByText("Kongres Energetyczny")).toBeInTheDocument();
    expect(screen.getByText("1 wrzesnia 2026, 11:00")).toBeInTheDocument();
    // „Powrot do listy" wraca do katalogu w panelu, „Otworz wydarzenie" pokazuje,
    // co widzi uczestnik - to sa dwa rozne wyjscia i oba musza byc.
    expect(href("adminEvents.studio.nav.backToList")).toBe("/admin/events/list");
    expect(href("adminEvents.studio.nav.openEvent")).toBe("/events/kongres-energetyczny");
  });

  it("SZKIC dostaje zdanie zamiast odnosnika - nie ma czego otwierac", () => {
    pas({ publicHref: null });

    expect(href("adminEvents.studio.nav.openEvent")).toBeNull();
    expect(screen.getByText("adminEvents.studio.nav.openEventDraft")).toBeInTheDocument();
  });

  it("pas nie ma naruszen axe - takze po rozwinieciu grupy", async () => {
    const { container } = pas({ activeSection: "onsiteLog", publicHref: "/events/kongres" });

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
