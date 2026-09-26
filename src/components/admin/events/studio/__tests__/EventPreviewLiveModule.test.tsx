// PODSTRONY MODULOWE W PODGLADZIE STUDIA - program, prelegenci, uczestnicy,
// partnerzy.
//
// PO CO TEN PLIK ISTNIEJE. To jest jedyne miejsce, w ktorym redaktor widzi
// SZKIC swojego wydarzenia narysowany komponentami PRODUKCYJNYMI. Publiczne
// projekcje maja bramke `status = 'published'`, wiec na szkicu oddawaly pustke -
// i wlasnie dlatego ten modul istnieje. Jego cala wartosc to dwie rzeczy naraz:
// ZERO WLASNEGO UKLADU (rysuja komponenty strony) i MARTWE PRZYCISKI ZAPISU
// (organizator nie zapisuje sie na sesje z ekranu panelu).
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. PODGLAD ZACZYNA ZAPISYWAC NA SESJE. Karta sesji ma przycisk zapisu;
//      w podgladzie musi byc martwy. `signedIn={false}` to jeden props - a jego
//      utrata daje organizatorowi zapis na wlasna sesje z panelu.
//   2. PUSTA POWIERZCHNIA ZAMIENIA SIE W PUSTKE. „Nie ma jeszcze programu" to
//      zdanie; jego brak daje bialy prostokat nieodrozniallny od zapytania,
//      ktore padlo.
//   3. PASMO ZE SZKICAMI PRZESTAJE BYC OZNACZONE. Redaktor musi widziec, ze
//      pasmo ma sesje NIEOPUBLIKOWANE i ze samo nie jest publiczne - inaczej
//      podglad obiecuje program, ktorego uczestnik nie zobaczy.
//   4. NIEZNANY MODUL RYSUJE COS. Materialy i dyskusje nie maja w podgladzie
//      wlasnej powierzchni danych; ten modul ma wtedy oddac `null`, a nie pusta
//      ramke pod naglowkiem podstrony.
//   5. ZAKLADKA „PARTNERZY" ZNOWU JEST PUSTA. Publiczna `/partners` rysuje pod
//      dokumentem CMS sekcje partnerow, a zasiany dokument ma tylko naglowek -
//      bez galezi `partners` redaktor nie widzial tam nikogo, nawet partnerow
//      ogloszonych. Plakietka „nieogloszony" jedzie napisem ze slownika PANELU.
//   6. WCZYTYWANIE I AWARIA UDAJA „BRAK PARTNEROW". Zakladka otwiera sie,
//      zanim lista dojedzie, a RPC potrafi pasc - zdanie „dodaj ich na
//      tablicy" pada TYLKO po odpowiedzi; wczesniej szkielet, po awarii zdanie
//      o awarii (oba z organizmu strony publicznej).
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Mapowan `previewLiveData` (RPC -> ksztalt
// powierzchni publicznej) - maja wlasny plik testowy. (2) Wygladu kart
// produkcyjnych - `AgendaSessionCard`, `EventSpeakersGridView`,
// `EventAttendeesGridView` i `EventSponsorsSectionView` maja swoje testy i stoja
// tu atrapami, ktore ZAPISUJA otrzymane wlasciwosci. Przedmiotem dowodu jest ROZDZIELNIK: ktory
// modul dostaje ktore fakty i z jakimi ograniczeniami.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";
import type { AgendaSession } from "@/lib/events/agendaSurface";
import type { PreviewTrackChip } from "@/lib/events/previewLiveData";
import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import type { AttendeeEntry } from "@/lib/events/publicEventApi";
import type { PublicSponsorTier } from "@/lib/events/sponsorsSurface";

const h = vi.hoisted(() => ({
  /** Karty sesji: identyfikator i to, czy przycisk zapisu jest zywy. */
  karty: [] as { id: string; signedIn: boolean; pending: boolean }[],
  /** Prelegenci i uczestnicy przekazani widokom produkcyjnym. */
  prelegenci: [] as { ilu: number; lang: string }[],
  uczestnicy: [] as { ilu: number; lang: string }[],
  /** Poziomy partnerow i napis plakietki przekazane widokowi sekcji. */
  partnerzy: [] as { ilu: number; draftLabel: string | undefined }[],
  lang: "pl",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-event-front", () => ({ ensureI18n: () => undefined }));

vi.mock("@/components/events/public/molecules/AgendaSessionCard", () => ({
  AgendaSessionCard: (props: { session: AgendaSession; signedIn: boolean; pending: boolean }) => {
    h.karty.push({ id: props.session.id, signedIn: props.signedIn, pending: props.pending });
    return <div data-testid={`sesja-${props.session.id}`} />;
  },
}));

vi.mock("@/components/events/public/organisms/EventSpeakersGrid", () => ({
  EventSpeakersGridView: (props: { speakers: readonly PublicSpeakerRow[]; lang: string }) => {
    h.prelegenci.push({ ilu: props.speakers.length, lang: props.lang });
    return <div data-testid="prelegenci" />;
  },
}));

vi.mock("@/components/events/public/organisms/EventAttendeesList", () => ({
  EventAttendeesGridView: (props: { entries: readonly AttendeeEntry[]; lang: string }) => {
    h.uczestnicy.push({ ilu: props.entries.length, lang: props.lang });
    return <div data-testid="uczestnicy" />;
  },
}));

vi.mock("@/components/events/public/organisms/EventSponsorsSection", () => ({
  EventSponsorsSectionPending: () => <div data-testid="partnerzy-wczytywanie" />,
  EventSponsorsSectionError: (props: { message: string }) => (
    <p data-testid="partnerzy-awaria">{props.message}</p>
  ),
  EventSponsorsSectionView: (props: {
    tiers: readonly PublicSponsorTier[];
    draftLabel?: string;
  }) => {
    h.partnerzy.push({ ilu: props.tiers.length, draftLabel: props.draftLabel });
    return <div data-testid="partnerzy" />;
  },
}));

const { EventPreviewLiveModule, EMPTY_PREVIEW_LIVE_DATA } =
  await import("@/components/admin/events/studio/EventPreviewLiveModule");

const P = "adminEvents.studio.preview.";

function sesja(overrides: Partial<AgendaSession> = {}): AgendaSession {
  return {
    id: "5a1c0000-0000-4000-8000-000000000001",
    eventId: "3f1a0c8e-0000-4000-8000-000000000042",
    parentSessionId: null,
    titlePl: "Otwarcie kongresu",
    titleEn: "Congress opening",
    descriptionPl: null,
    descriptionEn: null,
    startsAt: "2026-09-01T09:00:00.000Z",
    endsAt: "2026-09-01T10:00:00.000Z",
    timezone: "Europe/Warsaw",
    format: "onsite",
    status: "published",
    sortOrder: 0,
    chathamHouse: false,
    minTierRank: 0,
    requiresSignup: false,
    capacity: null,
    registeredCount: 0,
    seatsLeft: null,
    track: null,
    room: null,
    hasStream: false,
    hasRecording: false,
    mySignupStatus: null,
    accessState: "open",
    speakers: [],
    ...overrides,
    affiliationPl: overrides.affiliationPl ?? null,
    affiliationEn: overrides.affiliationEn ?? null,
    sponsor: overrides.sponsor ?? null,
  };
}

function pasmo(overrides: Partial<PreviewTrackChip> = {}): PreviewTrackChip {
  return {
    id: "7c3e0000-0000-4000-8000-000000000001",
    namePl: "Energetyka",
    nameEn: "Energy",
    accentColor: "#2f6f4e",
    sessionsCount: 5,
    draftCount: 0,
    isPublic: true,
    ...overrides,
    sponsorName: overrides.sponsorName ?? null,
    sponsorLogoUrl: overrides.sponsorLogoUrl ?? null,
  };
}

function prelegent(id: string): PublicSpeakerRow {
  return {
    speaker_profile_id: id,
    user_id: "",
    person_id: id,
    slug: null,
    display_name: "A. Nowak",
    avatar_url: null,
    job_title: null,
    company: null,
    headline_pl: null,
    headline_en: null,
    bio_pl: null,
    bio_en: null,
    topics_pl: [],
    topics_en: [],
    languages: [],
    talks_count: 0,
    rating: 0,
    reviews_count: 0,
    is_expert: false,
    has_speaker_profile: false,
    sort_order: 0,
  };
}

function uczestnik(id: string): AttendeeEntry {
  return {
    registrationId: id,
    userId: null,
    name: "A. Nowak",
    jobTitle: null,
    company: null,
    avatarUrl: null,
    profileSlug: null,
    companyLogoUrl: null,
    companyWebsite: null,
    industry: null,
    specialization: null,
    seekingPl: null,
    seekingEn: null,
    offeringPl: null,
    offeringEn: null,
    bioPl: null,
    bioEn: null,
    socialLinks: {},
    groups: [],
  };
}

function poziom(tierId: string): PublicSponsorTier {
  return {
    tierId,
    key: tierId,
    namePl: "Zloty",
    nameEn: "Gold",
    descriptionPl: null,
    descriptionEn: null,
    rank: 10,
    accentColor: null,
    logoSize: "md",
    benefits: [],
    sponsors: [],
  };
}

function modul(module: string, dane: Partial<typeof EMPTY_PREVIEW_LIVE_DATA> = {}) {
  return render(
    <EventPreviewLiveModule module={module} data={{ ...EMPTY_PREVIEW_LIVE_DATA, ...dane }} />,
  );
}

afterEach(() => {
  cleanup();
  h.karty = [];
  h.prelegenci = [];
  h.uczestnicy = [];
  h.partnerzy = [];
  h.lang = "pl";
});

describe("EventPreviewLiveModule - program", () => {
  it("BEZ SESJI oddaje ZDANIE, a nie bialy prostokat", () => {
    modul("agenda");

    expect(screen.getByText(`${P}moduleEmptyAgenda`)).toBeInTheDocument();
    expect(h.karty).toHaveLength(0);
  });

  it("Z SESJAMI rysuje karty PRODUKCYJNE, z martwym przyciskiem zapisu", () => {
    // Druga polowa pary - i najwazniejsza asercja tego pliku. Podglad NIE
    // zapisuje na sesje: „niezalogowany" wygasza przycisk zapisu bez dokladania
    // warunku do samej karty.
    modul("agenda", {
      sessions: [sesja({ id: "sesja-1" }), sesja({ id: "sesja-2", requiresSignup: true })],
    });

    expect(h.karty.map((karta) => karta.id)).toEqual(["sesja-1", "sesja-2"]);
    expect(h.karty.every((karta) => karta.signedIn === false)).toBe(true);
    expect(h.karty.every((karta) => karta.pending === false)).toBe(true);
  });

  it("DZIEN JEST ZAKLADKA, jak na stronie - nie plaska lista naglowkow", () => {
    // Podglad rysuje `EventAgendaBoardView`, ten sam widok, co strona: dni sa
    // zakladkami, a lista pokazuje dzien AKTYWNY. Wczesniej stala tu wlasna
    // plaska lista dni i redaktor widzial w studiu inny uklad niz uczestnik.
    modul("agenda", {
      sessions: [
        sesja({ id: "dzien-2", startsAt: "2026-09-02T09:00:00.000Z" }),
        sesja({ id: "dzien-1", startsAt: "2026-09-01T09:00:00.000Z" }),
      ],
    });

    const zakladki = screen.getAllByRole("tab");
    expect(zakladki).toHaveLength(2);
    expect(zakladki[0]).toHaveAttribute("aria-selected", "true");
    // Wczesniejszy dzien jest pierwszy - mimo odwrotnej kolejnosci na wejsciu.
    expect(h.karty.map((karta) => karta.id)).toEqual(["dzien-1"]);
  });

  it("PASMA stoja nad programem z liczba sesji i kolorem akcentu", () => {
    modul("agenda", { tracks: [pasmo()] });

    expect(screen.getByText(`${P}tracksLabel`)).toBeInTheDocument();
    expect(screen.getByText("Energetyka")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("pasmo ze SZKICAMI i pasmo NIEPUBLICZNE sa oznaczone - inaczej podglad obiecuje za duzo", () => {
    modul("agenda", { tracks: [pasmo({ draftCount: 3, isPublic: false })] });

    // Liczba szkicow jedzie PARAMETREM klucza, nie w kluczu.
    expect(screen.getByText(`${P}trackDraftBadge(count=3)`)).toBeInTheDocument();
    expect(screen.getByText(`${P}trackPrivateBadge`)).toBeInTheDocument();
  });

  it("pasmo ze SPONSOREM pokazuje jego logo i nazwe, pasmo bez akcentu - kolor neutralny", () => {
    const { container } = modul("agenda", {
      tracks: [
        pasmo({
          accentColor: null,
          sponsorName: "Orlen Energia",
          sponsorLogoUrl: "https://cdn.example.org/orlen.png",
        }),
      ],
    });

    expect(screen.getByText("Orlen Energia")).toBeInTheDocument();
    expect(container.querySelector("img")?.getAttribute("src")).toContain("orlen.png");
    // Bez akcentu nie ma wlasnego koloru - zostaje klasa neutralna z motywu.
    expect(container.querySelector("li")?.getAttribute("style")).toBeNull();
  });

  it.each<[string, Partial<PreviewTrackChip>, string]>([
    ["en", {}, "Energy"],
    ["en", { nameEn: null }, "Energetyka"],
    ["pl", { namePl: null }, "Energy"],
    ["pl", { namePl: null, nameEn: null }, ""],
  ])("nazwa pasma w jezyku %s (%o) to „%s”", (lang, patch, nazwa) => {
    h.lang = lang;
    const { container } = modul("agenda", { tracks: [pasmo(patch)] });

    expect(container.querySelector("li .font-medium")?.textContent).toBe(nazwa);
  });

  it("BEZ PASM pasek pasm w ogole sie nie rysuje", () => {
    modul("agenda", { sessions: [sesja()] });

    expect(screen.queryByText(`${P}tracksLabel`)).toBeNull();
  });
});

describe("EventPreviewLiveModule - prelegenci i uczestnicy", () => {
  it("BEZ PRELEGENTOW zdanie, Z PRELEGENTAMI produkcyjna siatka", () => {
    const puste = modul("speakers");
    expect(screen.getByText(`${P}moduleEmptySpeakers`)).toBeInTheDocument();
    expect(h.prelegenci).toHaveLength(0);
    puste.unmount();

    modul("speakers", { speakers: [prelegent("p-1"), prelegent("p-2")] });
    expect(screen.getByTestId("prelegenci")).toBeInTheDocument();
    expect(h.prelegenci.at(-1)).toEqual({ ilu: 2, lang: "pl" });
  });

  it("BEZ UCZESTNIKOW zdanie, Z UCZESTNIKAMI produkcyjny katalog", () => {
    const puste = modul("participants");
    expect(screen.getByText(`${P}moduleEmptyAttendees`)).toBeInTheDocument();
    expect(h.uczestnicy).toHaveLength(0);
    puste.unmount();

    modul("participants", { attendees: [uczestnik("u-1")] });
    expect(screen.getByTestId("uczestnicy")).toBeInTheDocument();
    expect(h.uczestnicy.at(-1)).toEqual({ ilu: 1, lang: "pl" });
  });
});

describe("EventPreviewLiveModule - partnerzy", () => {
  it("BEZ PARTNEROW zdanie z drogą do tablicy, a nie pusta zakladka", () => {
    modul("partners");

    expect(screen.getByText(`${P}moduleEmptyPartners`)).toBeInTheDocument();
    expect(h.partnerzy).toHaveLength(0);
  });

  it("Z PARTNERAMI produkcyjna sekcja „Partnerzy” z napisem plakietki ze slownika PANELU", () => {
    modul("partners", { sponsorTiers: [poziom("t-1"), poziom("t-2")] });

    expect(screen.getByTestId("partnerzy")).toBeInTheDocument();
    expect(h.partnerzy.at(-1)).toEqual({ ilu: 2, draftLabel: `${P}sponsorDraftBadge` });
  });

  it("W TRAKCIE WCZYTYWANIA szkielet strony publicznej - nie „nie ma jeszcze partnerow”", () => {
    modul("partners", { sponsorsStatus: { state: "pending" } });

    expect(screen.getByTestId("partnerzy-wczytywanie")).toBeInTheDocument();
    expect(screen.queryByText(`${P}moduleEmptyPartners`)).toBeNull();
    expect(h.partnerzy).toHaveLength(0);
  });

  it("PO AWARII zdanie o awarii - nawet gdy w pamieci zostaly wiersze sprzed niej", () => {
    // Kolejnosc jak `isError` przed `data` w `EventSponsorsSection`: awaria
    // odswiezenia nie moze wygladac ani jak pustka, ani jak aktualna lista.
    modul("partners", {
      sponsorTiers: [poziom("t-1")],
      sponsorsStatus: { state: "error", message: "Nie udalo sie wczytac partnerow." },
    });

    expect(screen.getByTestId("partnerzy-awaria")).toHaveTextContent(
      "Nie udalo sie wczytac partnerow.",
    );
    expect(screen.queryByText(`${P}moduleEmptyPartners`)).toBeNull();
    expect(h.partnerzy).toHaveLength(0);
  });
});

describe("EventPreviewLiveModule - granice rozdzielnika", () => {
  it("NIEZNANY modul oddaje NIC - materialy i dyskusje nie maja wlasnej powierzchni", () => {
    const { container } = modul("materials", { sessions: [sesja()] });

    expect(container.innerHTML).toBe("");
    expect(h.karty).toHaveLength(0);
  });

  it("modul czyta TYLKO swoja czesc faktow - program nie siega po uczestnikow", () => {
    modul("agenda", {
      sessions: [sesja()],
      speakers: [prelegent("p-1")],
      attendees: [uczestnik("u-1")],
      sponsorTiers: [poziom("t-1")],
    });

    expect(h.prelegenci).toHaveLength(0);
    expect(h.uczestnicy).toHaveLength(0);
    expect(h.partnerzy).toHaveLength(0);
  });

  it("dyskusje nie rysuja partnerow, choc fakty ich nie brakuje", () => {
    const { container } = modul("discussions", { sponsorTiers: [poziom("t-1")] });

    expect(container.innerHTML).toBe("");
    expect(h.partnerzy).toHaveLength(0);
  });

  it("pusty komplet faktow jest STALA - nie nowym obiektem przy kazdym renderze", () => {
    // `EMPTY_PREVIEW_LIVE_DATA` wchodzi do tablic zaleznosci nakladki; nowy
    // obiekt za kazdym razem dawalby przerysowanie w kolko.
    expect(EMPTY_PREVIEW_LIVE_DATA).toEqual({
      sessions: [],
      tracks: [],
      speakers: [],
      attendees: [],
      sponsorTiers: [],
      // Pusty komplet to ODPOWIEDZ bez partnerow (kanwa bez nakladki), nie
      // wczytywanie - inaczej bramka parytetu rysowalaby szkielet.
      sponsorsStatus: { state: "ready" },
    });
  });
});

describe("EventPreviewLiveModule - dostepnosc", () => {
  it("program z pasmami nie ma naruszen axe", async () => {
    const { container } = modul("agenda", {
      tracks: [pasmo({ draftCount: 2, isPublic: false })],
      sessions: [sesja()],
    });

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
