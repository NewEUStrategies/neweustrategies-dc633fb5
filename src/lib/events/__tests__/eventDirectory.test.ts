// Katalog okien profilu składa jedną osobę z kilku list - i to jest jedyne,
// co daje oknu sens: prelegent otwarty z agendy ma mieć biogram z listy
// prelegentów, a firma partnera - prelegentów, którzy w niej pracują.
//
// DLACZEGO TEN TEST ISTNIEJE. Tożsamość osoby idzie po trzech różnych
// identyfikatorach (konto, kartoteka, wpis rejestru), a instytucji - po
// nazwie. Pomyłka w kluczu nie rzuca wyjątku: daje po cichu DWIE osoby
// zamiast jednej albo firmę bez ludzi, czyli okno, które kłamie przez
// przemilczenie.
import { describe, expect, it } from "vitest";

import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import type { AgendaSession } from "@/lib/events/agendaSurface";
import {
  buildEventDirectory,
  directoryOrgKey,
  directoryOrgPeople,
  directoryOrgSessions,
  findDirectoryPerson,
  personKeyOf,
} from "@/lib/events/eventDirectory";
import type { AttendeeEntry } from "@/lib/events/publicEventApi";
import type { PublicSponsorTier } from "@/lib/events/sponsorsSurface";

function speaker(overrides: Partial<PublicSpeakerRow>): PublicSpeakerRow {
  return {
    speaker_profile_id: "sp-1",
    user_id: "u-1",
    person_id: null,
    slug: "anna-kowalska",
    display_name: "Anna Kowalska",
    avatar_url: "https://cdn.example.test/anna.jpg",
    job_title: "Dyrektorka",
    company: "WiseEuropa",
    headline_pl: "Prezes WiseEuropa",
    headline_en: null,
    bio_pl: "Biogram po polsku.",
    bio_en: null,
    topics_pl: ["Energetyka"],
    topics_en: [],
    languages: ["pl", "en"],
    talks_count: 3,
    rating: 4.5,
    reviews_count: 2,
    is_expert: true,
    has_speaker_profile: true,
    sort_order: 0,
    card_institution_logo_url: "https://cdn.example.test/wise.png",
    ...overrides,
  };
}

function session(overrides: Partial<AgendaSession>): AgendaSession {
  return {
    id: "s-1",
    eventId: "e-1",
    parentSessionId: null,
    titlePl: "Panel otwarcia",
    titleEn: "Opening panel",
    descriptionPl: null,
    descriptionEn: null,
    startsAt: "2026-11-19T09:00:00Z",
    endsAt: "2026-11-19T10:30:00Z",
    timezone: "Europe/Warsaw",
    format: "onsite",
    status: "scheduled",
    sortOrder: 0,
    chathamHouse: false,
    minTierRank: 0,
    requiresSignup: false,
    capacity: null,
    registeredCount: 0,
    seatsLeft: null,
    track: null,
    room: { id: "r-1", name: "Sala A", floor: null },
    affiliationPl: null,
    affiliationEn: null,
    sponsor: null,
    hasStream: false,
    hasRecording: false,
    mySignupStatus: null,
    accessState: "open",
    speakers: [],
    ...overrides,
  } as AgendaSession;
}

function attendee(overrides: Partial<AttendeeEntry>): AttendeeEntry {
  return {
    registrationId: "reg-1",
    userId: null,
    name: "Jan Nowak",
    jobTitle: "Analityk",
    company: "wiseeuropa",
    avatarUrl: null,
    profileSlug: "jan-nowak",
    companyLogoUrl: null,
    companyWebsite: "https://wise-europa.eu",
    industry: null,
    specialization: null,
    seekingPl: null,
    seekingEn: null,
    offeringPl: null,
    offeringEn: null,
    bioPl: null,
    bioEn: null,
    socialLinks: { linkedin: "https://linkedin.com/in/jan" },
    groups: [],
    ...overrides,
  };
}

const tiers: PublicSponsorTier[] = [
  {
    tierId: "t-1",
    key: "gold",
    namePl: "Partner strategiczny",
    nameEn: "Strategic partner",
    descriptionPl: null,
    descriptionEn: null,
    rank: 1,
    accentColor: "#C9A227",
    logoSize: "lg",
    benefits: [],
    sponsors: [
      {
        id: "sp-wise",
        name: "WiseEuropa",
        logoUrl: "https://cdn.example.test/wise-sponsor.png",
        websiteUrl: "https://wise-europa.eu",
        linkMode: "external",
        href: "https://wise-europa.eu/?utm_source=event",
        descriptionPl: "Think tank.",
        descriptionEn: "A think tank.",
        country: "PL",
        role: "partner",
        boothLabel: "B12",
        sortOrder: 0,
      },
    ],
  },
] as PublicSponsorTier[];

describe("directoryOrgKey", () => {
  it("zrównuje wielkość liter, interpunkcję i rozkład znaków diakrytycznych", () => {
    expect(directoryOrgKey("WiseEuropa")).toBe(directoryOrgKey("  wiseeuropa "));
    expect(directoryOrgKey("„Układ Sił”")).toBe(directoryOrgKey("Układ Sił"));
    // Tekst wklejony z macOS bywa rozłożony („o" + akcent) - to nadal ta sama nazwa.
    expect(directoryOrgKey("Łódź".normalize("NFD"))).toBe(directoryOrgKey("Łódź"));
    expect(directoryOrgKey("")).toBeNull();
    expect(directoryOrgKey(null)).toBeNull();
  });

  it("nie skleja odmian - różne słowa to różne instytucje", () => {
    expect(directoryOrgKey("Centralny Port Komunikacyjny")).not.toBe(
      directoryOrgKey("Centralnego Portu Komunikacyjnego"),
    );
  });
});

describe("personKeyOf", () => {
  it("konto wygrywa z kartoteką, kartoteka z zapisem", () => {
    expect(personKeyOf({ userId: "u", speakerProfileId: "s", personId: "p" })).toBe("u:u");
    expect(personKeyOf({ userId: "", speakerProfileId: "s" })).toBe("s:s");
    expect(personKeyOf({ personId: "p", registrationId: "r" })).toBe("p:p");
    expect(personKeyOf({ registrationId: "r" })).toBe("r:r");
    expect(personKeyOf({})).toBeNull();
  });
});

describe("buildEventDirectory", () => {
  it("skleja prelegenta z listy, z obsady sesji i z katalogu uczestników w jedną osobę", () => {
    const directory = buildEventDirectory(
      {
        speakers: [speaker({})],
        sessions: [
          session({
            speakers: [
              {
                userId: "u-1",
                slug: null,
                displayName: "Anna Kowalska",
                avatarUrl: null,
                headlinePl: "Inny podpis z agendy",
                headlineEn: null,
                role: "moderator",
                sortOrder: 0,
              },
            ],
          }),
        ],
        attendees: [attendee({ registrationId: "reg-anna", userId: "u-1", name: "Anna Kowalska" })],
      },
      "pl",
    );

    expect(directory.people.size).toBe(1);
    const anna = findDirectoryPerson(directory, "u-1");
    expect(anna?.key).toBe("u:u-1");
    // Lista prelegentów jest źródłem pierwszym - jej stanowisko nie ustępuje agendzie.
    expect(anna?.position).toBe("Prezes");
    expect(anna?.orgName).toBe("WiseEuropa");
    expect(anna?.bio).toBe("Biogram po polsku.");
    expect(anna?.isExpert).toBe(true);
    expect(anna?.profileHref).toBe("/author/anna-kowalska");
    expect(anna?.sessions).toEqual([
      expect.objectContaining({
        id: "s-1",
        title: "Panel otwarcia",
        role: "moderator",
        room: "Sala A",
      }),
    ]);
    expect(anna?.attendee?.registrationId).toBe("reg-anna");
    // Aliasy prowadzą do tej samej osoby z każdej strony.
    expect(findDirectoryPerson(directory, "sp-1")?.key).toBe("u:u-1");
    expect(findDirectoryPerson(directory, "reg-anna")?.key).toBe("u:u-1");
  });

  it("prelegent bez konta dostaje klucz wpisu rejestru, a obsada po kartotece trafia do niego", () => {
    const directory = buildEventDirectory(
      {
        speakers: [speaker({ user_id: "", person_id: "person-9", speaker_profile_id: "sp-9" })],
        sessions: [
          session({
            speakers: [
              {
                userId: "person-9",
                slug: null,
                displayName: "Anna Kowalska",
                avatarUrl: null,
                headlinePl: null,
                headlineEn: null,
                role: "speaker",
                sortOrder: 0,
              },
            ],
          }),
        ],
      },
      "pl",
    );
    expect(directory.people.size).toBe(1);
    expect(findDirectoryPerson(directory, "person-9")?.key).toBe("s:sp-9");
    expect(findDirectoryPerson(directory, "person-9")?.sessions).toHaveLength(1);
  });

  it("instytucja partnera zbiera prelegentów i uczestników tej samej nazwy oraz wspierane sesje", () => {
    const directory = buildEventDirectory(
      {
        speakers: [speaker({})],
        sponsorTiers: tiers,
        sessions: [
          session({
            id: "s-2",
            startsAt: "2026-11-19T12:00:00Z",
            sponsor: { id: "sp-wise", name: "WISEEUROPA", logoUrl: null, role: "partner" },
          }),
        ],
        attendees: [attendee({})],
      },
      "pl",
    );
    const key = directoryOrgKey("WiseEuropa") ?? "";
    const org = directory.orgs.get(key);
    expect(org?.name).toBe("WiseEuropa");
    expect(org?.logoUrl).toBe("https://cdn.example.test/wise-sponsor.png");
    expect(org?.description).toBe("Think tank.");
    expect(org?.sponsor).toEqual(
      expect.objectContaining({
        id: "sp-wise",
        role: "partner",
        tierName: "Partner strategiczny",
        boothLabel: "B12",
        href: "https://wise-europa.eu/?utm_source=event",
      }),
    );
    // Prelegent przed uczestnikiem.
    expect(directoryOrgPeople(directory, key).map((person) => person.name)).toEqual([
      "Anna Kowalska",
      "Jan Nowak",
    ]);
    expect(directoryOrgSessions(directory, key).map((item) => item.id)).toEqual(["s-2"]);
  });

  it("druga instytucja tej samej osoby dostaje własne okno, a jej logo i strona nie trafiają do pierwszej", () => {
    const directory = buildEventDirectory(
      {
        speakers: [
          speaker({
            company: "Uniwersytet Warszawski",
            headline_pl: "",
            job_title: "Profesor",
            card_institution_logo_url: null,
          }),
          speaker({
            user_id: "u-2",
            speaker_profile_id: "sp-2",
            slug: "bob",
            display_name: "Bob Nowak",
            company: "Uniwersytet Warszawski",
            headline_pl: "",
            job_title: "Adiunkt",
            card_institution_logo_url: null,
          }),
        ],
        attendees: [
          attendee({
            registrationId: "reg-anna",
            userId: "u-1",
            name: "Anna Kowalska",
            company: "Ministerstwo Finansów",
            companyLogoUrl: "https://cdn.example.test/mf.png",
            companyWebsite: "https://gov.pl/finanse",
          }),
        ],
      },
      "pl",
    );
    const uw = directory.orgs.get(directoryOrgKey("Uniwersytet Warszawski") ?? "");
    const mf = directory.orgs.get(directoryOrgKey("Ministerstwo Finansów") ?? "");
    expect(uw?.logoUrl).toBeNull();
    expect(uw?.website).toBeNull();
    expect(mf?.logoUrl).toBe("https://cdn.example.test/mf.png");
    expect(mf?.website).toBe("https://gov.pl/finanse");
    // Osoba zostaje przy instytucji z listy prelegentów - pierwsze źródło.
    expect(findDirectoryPerson(directory, "u-1")?.orgKey).toBe(uw?.key);
    expect(findDirectoryPerson(directory, "u-1")?.orgLogoUrl).toBeNull();
  });

  it("osoba spoza list nie nadpisuje znanej i nie jest mutowana", () => {
    const extra = {
      ...buildEventDirectory({ speakers: [speaker({})] }, "pl").people.get("u:u-1")!,
      key: "m:autor",
      name: "Autor Wątku",
      orgKey: null,
      orgName: "Polityka",
      speakerRow: null,
      sessions: [],
    };
    const directory = buildEventDirectory({ extraPeople: [extra] }, "en");
    expect(findDirectoryPerson(directory, "m:autor")?.orgKey).toBe(directoryOrgKey("Polityka"));
    expect(extra.orgKey).toBeNull();
  });

  it("wybiera język interfejsu z zapasem na drugi", () => {
    const directory = buildEventDirectory(
      { speakers: [speaker({ bio_pl: "Tylko po polsku", bio_en: "" })] },
      "en",
    );
    expect(findDirectoryPerson(directory, "u-1")?.bio).toBe("Tylko po polsku");
  });
});
