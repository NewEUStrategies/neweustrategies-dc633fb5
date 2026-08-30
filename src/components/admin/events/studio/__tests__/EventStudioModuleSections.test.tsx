// DWADZIESCIA DWA EKRANY STUDIA, ktore montuja ISTNIEJACE panele modulu.
//
// PO CO TEN PLIK ISTNIEJE. Ten modul nie ma wlasnej logiki produktowej - i to
// wlasnie czyni go grozniejszym, niz wyglada. Jest listą sklejen „adres ->
// panel", a kazde sklejenie da sie pomylic tak, ze na ekranie NIC nie wyglada
// zle: panel sasiada pod cudzym tytulem, `eventId` wziety z innego pola, ekran
// bez `key`, ktory przy zmianie wydarzenia przepisuje szkic poprzedniego.
// Dwadziescia dwa razy „prawie dobrze" to dwadziescia dwa ciche defekty.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. EKRAN PROWADZI DONIKAD. Sidebar wymienia sekcje, trasa istnieje, a ekran
//      jest sama rama z tytulem - bo panel wypadl przy refaktorze importow.
//      Redaktor widzi naglowek i pustke, nieodrozniallna od zapytania, ktore
//      padlo. Dowodem jest KOMPLET: kazda sekcja montuje swoj panel.
//   2. TYTUL ROZJEZDZA SIE Z SIDEBAREM. Naglowek ma pochodzic z TEGO SAMEGO
//      klucza slownika, co pozycja w lewym pasie; przepisany „na piechote"
//      rozjezdza sie przy pierwszej korekcie nazwy i redaktor za kazdym razem
//      upewnia sie, czy trafil na ten ekran.
//   3. PANEL DOSTAJE ZLE WYDARZENIE. `row.id` zamienione na `row.event_type_id`
//      albo na pusty napis nie wywraca ekranu - pokazuje CUDZE zgloszenia.
//   4. ZNIKA `key={eventId}`. Przelaczenie wydarzenia w sidebarze zostawia
//      wtedy stan formularza poprzedniego wydarzenia w polach nowego.
//   5. EKRAN DORABIA SOBIE BRAMKE MODULU. Bramka wylaczonych modulow stoi
//      w ramie studia (`EventStudioShell`) i ma tam JEDNO miejsce; drugi
//      warunek tutaj rozjechalby sie przy pierwszym nowym ekranie.
//
// CZEGO SWIADOMIE NIE DUBLUJE. Zawartosci samych paneli - kazdy ma wlasny plik
// testowy i wlasne zapytania. Tutaj stoja atrapy, ktore ZAPISUJA otrzymane
// wlasciwosci, bo przedmiotem dowodu jest sklejenie, a nie panel.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";

import { axeViolations, summarize } from "@/test/axe";
import { adminEventDetailRow, STUDIO_EVENT_ID } from "@/test/events/adminEventStudioRows";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";

const h = vi.hoisted(() => ({
  /** Wszystkie zamontowane panele: nazwa -> wlasciwosci, w kolejnosci. */
  montaze: [] as { panel: string; props: Record<string, unknown> }[],
}));

/**
 * Atrapa panelu. Rysuje znacznik z nazwa i identyfikatorem wydarzenia oraz
 * ZAPISUJE komplet wlasciwosci - `eventSlug`, `timezone` i tytul wydarzenia
 * jada do paneli osobno i kazdy z nich da sie zgubic po cichu.
 */
function atrapa(nazwa: string) {
  return (props: Record<string, unknown>) => {
    h.montaze.push({ panel: nazwa, props });
    return <div data-testid={`panel-${nazwa}`} data-event-id={String(props.eventId ?? "")} />;
  };
}

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-community-events", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-agenda", () => ({ ensureAgendaI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-meetings", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-onsite", () => ({ ensureOnsiteI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-registration", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-sponsors", () => ({ ensureSponsorsI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-terms", () => ({ ensureTermsI18n: () => undefined }));

vi.mock("@/components/admin/community/EventSpeakersManager", () => ({
  EventSpeakersManager: atrapa("speakers"),
}));
vi.mock("@/components/admin/events/organisms/AgendaConflictsPanel", () => ({
  AgendaConflictsPanel: atrapa("conflicts"),
}));
vi.mock("@/components/admin/events/organisms/AgendaRoomsPanel", () => ({
  AgendaRoomsPanel: atrapa("rooms"),
}));
vi.mock("@/components/admin/events/organisms/EventProgramPanel", () => ({
  EventProgramPanel: atrapa("tracks"),
}));
vi.mock("@/components/admin/events/organisms/EventTermsPanel", () => ({
  EventTermsPanel: atrapa("terms"),
}));
vi.mock("@/components/admin/events/organisms/EventPackagesPanel", () => ({
  EventPackagesPanel: atrapa("packages"),
}));
vi.mock("@/components/admin/events/organisms/EventAudienceGrantsPanel", () => ({
  EventAudienceGrantsPanel: atrapa("audiences"),
}));
vi.mock("@/components/admin/events/organisms/EventTicketsPanel", () => ({
  EventTicketsPanel: atrapa("tickets"),
}));
vi.mock("@/components/admin/events/organisms/GroupMembersPanel", () => ({
  GroupMembersPanel: atrapa("members"),
}));
vi.mock("@/components/admin/events/organisms/MeetingSettingsPanel", () => ({
  MeetingSettingsPanel: atrapa("meetingSettings"),
}));
vi.mock("@/components/admin/events/organisms/MeetingStatsPanel", () => ({
  MeetingStatsPanel: atrapa("meetingStats"),
}));
vi.mock("@/components/admin/events/organisms/MeetingTablesPanel", () => ({
  MeetingTablesPanel: atrapa("meetingTables"),
}));
vi.mock("@/components/admin/events/organisms/MeetingsListPanel", () => ({
  MeetingsListPanel: atrapa("meetingsList"),
}));
vi.mock("@/components/admin/events/organisms/OnsiteBadgesPanel", () => ({
  OnsiteBadgesPanel: atrapa("badges"),
}));
vi.mock("@/components/admin/events/organisms/OnsiteBadgePrintPanel", () => ({
  OnsiteBadgePrintPanel: atrapa("badgePrint"),
}));
vi.mock("@/components/admin/events/organisms/OnsiteCheckpointsPanel", () => ({
  OnsiteCheckpointsPanel: atrapa("checkpoints"),
}));
vi.mock("@/components/admin/events/organisms/OnsiteDeskPanel", () => ({
  OnsiteDeskPanel: atrapa("desk"),
}));
vi.mock("@/components/admin/events/organisms/OnsiteDevicesPanel", () => ({
  OnsiteDevicesPanel: atrapa("devices"),
}));
vi.mock("@/components/admin/events/organisms/OnsiteLeadsPanel", () => ({
  OnsiteLeadsPanel: atrapa("leads"),
}));
vi.mock("@/components/admin/events/organisms/OnsiteLogPanel", () => ({
  OnsiteLogPanel: atrapa("log"),
}));
vi.mock("@/components/admin/events/organisms/OnsiteStatsPanel", () => ({
  OnsiteStatsPanel: atrapa("onsiteStats"),
}));
vi.mock("@/components/admin/events/organisms/RegistrationFieldsPanel", () => ({
  RegistrationFieldsPanel: atrapa("form"),
}));
vi.mock("@/components/admin/events/organisms/RegistrationsListPanel", () => ({
  RegistrationsListPanel: atrapa("registrations"),
}));
vi.mock("@/components/admin/events/organisms/SponsorTiersPanel", () => ({
  SponsorTiersPanel: atrapa("sponsorTiers"),
}));
vi.mock("@/components/admin/events/organisms/SponsorsListPanel", () => ({
  SponsorsListPanel: atrapa("sponsors"),
}));

const S = await import("@/components/admin/events/studio/EventStudioModuleSections");

type Ekran = ComponentType<{ row: AdminEventDetailRow }>;

/**
 * KOMPLET sekcji jednopanelowych: komponent, KLUCZ tytulu i nazwa panelu.
 *
 * Tabela jest jednoczesnie spisem tresci modulu. Sekcja dopisana bez wiersza
 * tutaj nie jest zadnym bledem kompilacji - dlatego nizej stoi osobna asercja
 * o LICZBIE eksportowanych ekranow.
 */
const EKRANY: readonly { nazwa: string; ekran: Ekran; tytul: string; panel: string }[] = [
  {
    nazwa: "EventRegistrationListSection",
    ekran: S.EventRegistrationListSection,
    tytul: "adminEventRegistration.nav.registrations",
    panel: "registrations",
  },
  {
    nazwa: "EventRegistrationTicketsSection",
    ekran: S.EventRegistrationTicketsSection,
    tytul: "adminEventRegistration.nav.tickets",
    panel: "tickets",
  },
  {
    nazwa: "EventRegistrationPackagesSection",
    ekran: S.EventRegistrationPackagesSection,
    tytul: "adminEventRegistration.packages.title",
    panel: "packages",
  },
  {
    nazwa: "EventRegistrationAudiencesSection",
    ekran: S.EventRegistrationAudiencesSection,
    tytul: "adminEventRegistration.audienceGrants.title",
    panel: "audiences",
  },
  {
    nazwa: "EventRegistrationFormSection",
    ekran: S.EventRegistrationFormSection,
    tytul: "adminEventRegistration.nav.form",
    panel: "form",
  },
  {
    nazwa: "EventContentSpeakersSection",
    ekran: S.EventContentSpeakersSection,
    tytul: "adminEvents.nav.speakers",
    panel: "speakers",
  },
  {
    nazwa: "EventContentTracksSection",
    ekran: S.EventContentTracksSection,
    tytul: "adminEventAgenda.nav.tracks",
    panel: "tracks",
  },
  {
    nazwa: "EventContentRoomsSection",
    ekran: S.EventContentRoomsSection,
    tytul: "adminEventAgenda.nav.rooms",
    panel: "rooms",
  },
  {
    nazwa: "EventContentConflictsSection",
    ekran: S.EventContentConflictsSection,
    tytul: "adminEventAgenda.nav.conflicts",
    panel: "conflicts",
  },
  {
    nazwa: "EventMeetingsTablesSection",
    ekran: S.EventMeetingsTablesSection,
    tytul: "adminEventMeetings.nav.tables",
    panel: "meetingTables",
  },
  {
    nazwa: "EventMeetingsSettingsSection",
    ekran: S.EventMeetingsSettingsSection,
    tytul: "adminEventMeetings.nav.settings",
    panel: "meetingSettings",
  },
  {
    nazwa: "EventMeetingsListSection",
    ekran: S.EventMeetingsListSection,
    tytul: "adminEventMeetings.nav.meetings",
    panel: "meetingsList",
  },
  {
    nazwa: "EventMeetingsStatsSection",
    ekran: S.EventMeetingsStatsSection,
    tytul: "adminEventMeetings.nav.stats",
    panel: "meetingStats",
  },
  {
    nazwa: "EventOnsiteDeskSection",
    ekran: S.EventOnsiteDeskSection,
    tytul: "adminEventOnsite.nav.desk",
    panel: "desk",
  },
  {
    nazwa: "EventOnsiteLogSection",
    ekran: S.EventOnsiteLogSection,
    tytul: "adminEventOnsite.nav.log",
    panel: "log",
  },
  {
    nazwa: "EventOnsiteStatsSection",
    ekran: S.EventOnsiteStatsSection,
    tytul: "adminEventOnsite.nav.stats",
    panel: "onsiteStats",
  },
  {
    nazwa: "EventOnsiteCheckpointsSection",
    ekran: S.EventOnsiteCheckpointsSection,
    tytul: "adminEventOnsite.nav.checkpoints",
    panel: "checkpoints",
  },
  {
    nazwa: "EventOnsiteDevicesSection",
    ekran: S.EventOnsiteDevicesSection,
    tytul: "adminEventOnsite.nav.devices",
    panel: "devices",
  },
  {
    nazwa: "EventOnsiteLeadsSection",
    ekran: S.EventOnsiteLeadsSection,
    tytul: "adminEventOnsite.nav.leads",
    panel: "leads",
  },
];

function tytulEkranu(): string {
  return screen.getByRole("heading", { level: 1 }).textContent ?? "";
}

function montaz(panel: string): Record<string, unknown> | undefined {
  return h.montaze.find((wpis) => wpis.panel === panel)?.props;
}

afterEach(() => {
  cleanup();
  h.montaze = [];
});

describe("EventStudioModuleSections - kazdy ekran montuje SWOJ panel", () => {
  it.each(EKRANY)(
    "$nazwa: tytul z klucza slownika i panel z identyfikatorem wydarzenia",
    ({ ekran: Ekran, tytul, panel }) => {
      render(<Ekran row={adminEventDetailRow()} />);

      expect(tytulEkranu()).toBe(tytul);
      expect(screen.getByTestId(`panel-${panel}`).getAttribute("data-event-id")).toBe(
        STUDIO_EVENT_ID,
      );
      // ZADEN ekran nie montuje dwoch paneli - poza odznakami, ktore maja
      // wlasny wiersz nizej.
      expect(h.montaze).toHaveLength(1);
    },
  );

  it("odznaki to JEDYNY ekran z dwoma panelami - drukiem i lista", () => {
    render(<S.EventOnsiteBadgesSection row={adminEventDetailRow()} />);

    expect(tytulEkranu()).toBe("adminEventOnsite.nav.badges");
    expect(h.montaze.map((wpis) => wpis.panel)).toEqual(["badgePrint", "badges"]);
    // Wydruk potrzebuje NAZWY wydarzenia - odznaka bez niej jest kartka
    // z samym nazwiskiem.
    expect(montaz("badgePrint")?.eventTitle).toBe("Kongres Energetyczny");
  });

  it("wydruk odznak bierze nazwe angielska, gdy polskiej nie ma", () => {
    render(<S.EventOnsiteBadgesSection row={adminEventDetailRow({ title_pl: "" })} />);

    expect(montaz("badgePrint")?.eventTitle).toBe("Energy Congress");
  });
});

describe("EventStudioModuleSections - dane, ktore panel dostaje osobno", () => {
  it("lista zgloszen dostaje ADRES wydarzenia - panel sam go nie zna", () => {
    // Bez `eventSlug` wiersz zgloszenia nie ma jak prowadzic na strone
    // publiczna wydarzenia.
    render(<S.EventRegistrationListSection row={adminEventDetailRow()} />);

    expect(montaz("registrations")?.eventSlug).toBe("kongres-energetyczny");
  });

  it("pasma dostaja STREFE WYDARZENIA i jej etykiete - godziny sesji nie moga isc w strefie przegladarki", () => {
    render(<S.EventContentTracksSection row={adminEventDetailRow()} />);

    expect(montaz("tracks")?.timezone).toBe("Europe/Warsaw");
    expect(montaz("tracks")?.timeZoneLabel).toBe("Europe/Warsaw");
  });

  it("otwarte pasmo trzyma TRASA, nie ekran - `?track=` wraca po odswiezeniu", () => {
    const otwarte: (string | null)[] = [];
    render(
      <S.EventContentTracksSection
        row={adminEventDetailRow()}
        openedTrackId="track-7"
        onOpenTrack={(id) => otwarte.push(id)}
      />,
    );

    expect(montaz("tracks")?.openedTrackId).toBe("track-7");
    const otworz = montaz("tracks")?.onOpenTrack;
    expect(typeof otworz).toBe("function");
    (otworz as (id: string | null) => void)("track-9");
    expect(otwarte).toEqual(["track-9"]);
  });
});

describe("EventStudioModuleSections - dwa ekrany z zakladkami", () => {
  it("„Sponsorzy i reklama”: lista domyslnie, poziomy pod druga zakladka", () => {
    // Zakladki zostaja TYLKO tutaj i w regulaminach, bo sidebar wzorca jest
    // dwupoziomowy - „Kreator > Sponsorzy > Poziomy" byloby trzecim poziomem.
    render(<S.EventSponsorsSection row={adminEventDetailRow()} />);

    expect(tytulEkranu()).toBe("adminEvents.studio.sections.sponsors");
    expect(screen.getByTestId("panel-sponsors").getAttribute("data-event-id")).toBe(
      STUDIO_EVENT_ID,
    );

    // Radix Tabs przelacza sie na `mousedown`, nie na syntetycznym `click` -
    // to ten sam wzorzec, co w testach panelu doswiadczen wpisu.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "adminEventSponsors.nav.tiers" }));
    expect(screen.getByTestId("panel-sponsorTiers").getAttribute("data-event-id")).toBe(
      STUDIO_EVENT_ID,
    );
  });

  it("„Regulaminy”: zgody domyslnie, czlonkostwa pod druga zakladka", () => {
    render(<S.EventTermsSection row={adminEventDetailRow()} />);

    expect(tytulEkranu()).toBe("adminEvents.studio.sections.terms");
    expect(screen.getByTestId("panel-terms")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "adminEventTerms.nav.members" }));
    expect(screen.getByTestId("panel-members").getAttribute("data-event-id")).toBe(STUDIO_EVENT_ID);
  });
});

describe("EventStudioModuleSections - granice modulu", () => {
  it("spis ekranow jest KOMPLETNY - nowa sekcja bez wiersza w tabeli czerwieni ten test", () => {
    // Tabela wyzej jest spisem tresci modulu, ale sama z siebie nie wie
    // o ekranie dopisanym obok. Ta asercja lapie wlasnie taki przypadek: liczba
    // eksportowanych komponentow musi zgadzac sie z tym, co przetestowano
    // (19 jednopanelowych + odznaki + dwa ekrany z zakladkami).
    const eksporty = Object.keys(S).filter((nazwa) => nazwa.endsWith("Section"));
    expect(eksporty).toHaveLength(EKRANY.length + 3);
  });

  it("ekran NIE MA wlasnej bramki modulu - jedyna stoi w ramie studia", () => {
    // Wylaczony modul tlumaczy `EventStudioDisabledSection` montowany przez
    // rame. Drugi warunek tutaj rozjechalby sie przy pierwszym nowym ekranie:
    // ktos dopisalby sekcje i zapomnial o bramce, a ta chowalaby sie
    // w sidebarze, zyjac jednoczesnie pod adresem.
    render(
      <S.EventMeetingsTablesSection row={adminEventDetailRow({ features: { meetings: false } })} />,
    );

    expect(screen.getByTestId("panel-meetingTables")).toBeInTheDocument();
    expect(screen.queryByText("adminEvents.studio.features.disabled.title")).toBeNull();
  });

  it("ekran modulowy nie ma naruszen axe", async () => {
    const { container } = render(<S.EventSponsorsSection row={adminEventDetailRow()} />);

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
