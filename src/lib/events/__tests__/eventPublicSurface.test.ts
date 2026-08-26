// Regula sekcji strony wydarzenia, agendy i partnerow - bez sieci.
//
// TE TRZY MODULY SA CZYSTE CELOWO: `event_sections`, `event_agenda`
// i `event_sponsors_public` oddaja ksztalt, ktory front musi zrozumiec tak
// samo w karcie sesji, w zakladce dnia i w „mojej agendzie". Test tej reguly
// jest jednoczesnie testem wszystkich trzech widokow.
import { describe, expect, it } from "vitest";

import {
  findEventSection,
  lockReasonKey,
  parseEventSections,
  sectionEmptyKey,
  sectionHeadingKey,
  sectionLockCopy,
  shouldRenderSection,
  type EventSectionRow,
} from "@/lib/events/eventSections";
import {
  agendaSeatsLeft,
  agendaSessionTitle,
  agendaSignupControl,
  agendaStateKey,
  agendaTrackOptions,
  filterAgenda,
  groupAgendaByDay,
  hasOwnAgenda,
  ownAgenda,
  parseEventAgenda,
  type EventAgendaRow,
} from "@/lib/events/agendaSurface";
import {
  groupSponsorMaterials,
  parseSponsorMaterials,
  parseSponsorTiers,
  sponsorLogoClass,
  sponsorMaterialKindKey,
  sponsorRoleKey,
  type EventSponsorMaterialRow,
  type EventSponsorTierRow,
} from "@/lib/events/sponsorsSurface";

function sectionRow(over: Partial<EventSectionRow>): EventSectionRow {
  return {
    section_key: "agenda",
    sort_order: 30,
    heading_pl: "",
    heading_en: "",
    visibility: "public",
    min_tier_rank: 0,
    is_locked: false,
    lock_reason: "none",
    has_content: true,
    ...over,
  } as EventSectionRow;
}

function agendaRow(over: Partial<EventAgendaRow>): EventAgendaRow {
  return {
    id: "s1",
    event_id: "e1",
    parent_session_id: "",
    title_pl: "Sesja otwarcia",
    title_en: "Opening session",
    description_pl: "",
    description_en: "",
    starts_at: "2026-09-01T08:00:00Z",
    ends_at: "2026-09-01T09:00:00Z",
    timezone: "Europe/Warsaw",
    format: "onsite",
    status: "published",
    sort_order: 1,
    chatham_house: false,
    min_tier_rank: 0,
    requires_signup: false,
    capacity: 0,
    registered_count: 0,
    seats_left: 0,
    track_id: "",
    track_key: "",
    track_name_pl: "",
    track_name_en: "",
    track_accent_color: "",
    room_id: "",
    room_name: "",
    room_floor: "",
    has_stream: false,
    has_recording: false,
    my_signup_status: "",
    access_state: "open",
    speakers: [],
    ...over,
  } as EventAgendaRow;
}

describe("eventSections - kolejnosc, zamki i nagłówki", () => {
  it("porzadkuje sekcje po `sort_order`, a nieznany klucz odrzuca", () => {
    const parsed = parseEventSections([
      sectionRow({ section_key: "sponsors", sort_order: 50 }),
      sectionRow({ section_key: "agenda", sort_order: 30 }),
      sectionRow({ section_key: "wystawcy", sort_order: 10 }),
    ]);
    expect(parsed.map((section) => section.key)).toEqual(["agenda", "sponsors"]);
  });

  it("zamek bez nazwanego powodu zostaje wymogiem zapisu, a nie znika", () => {
    const [section] = parseEventSections([sectionRow({ is_locked: true, lock_reason: "kosmos" })]);
    expect(section.lockReason).toBe("registration_required");
    expect(sectionLockCopy(section.lockReason)?.actionKey).toBe(
      "eventFront.locks.registrationRequired.action",
    );
  });

  it("nieznana widocznosc czyta sie jako NAJWEZSZA, nie jako publiczna", () => {
    const [section] = parseEventSections([sectionRow({ visibility: "kosmos" })]);
    expect(section.visibility).toBe("registered");
  });

  it("sekcja zamknieta renderuje sie ZAWSZE, pusta - nie", () => {
    const locked = parseEventSections([
      sectionRow({ is_locked: true, lock_reason: "tier_required", has_content: false }),
    ])[0];
    const emptyOpen = parseEventSections([sectionRow({ has_content: false })])[0];
    expect(shouldRenderSection(locked)).toBe(true);
    expect(shouldRenderSection(emptyOpen)).toBe(false);
  });

  it("klucze nagłówka i zamka odpowiadaja slownikowi front-endu", () => {
    expect(sectionHeadingKey("materials")).toBe("eventFront.sections.materials.heading");
    expect(sectionEmptyKey("materials")).toBe("eventFront.sections.materials.empty");
    expect(lockReasonKey("auth_required")).toBe("eventFront.lockReasons.authRequired");
    expect(sectionLockCopy("none")).toBeNull();
  });

  it("znajduje sekcje po kluczu albo oddaje null", () => {
    const sections = parseEventSections([sectionRow({ section_key: "speakers" })]);
    expect(findEventSection(sections, "speakers")?.key).toBe("speakers");
    expect(findEventSection(sections, "map")).toBeNull();
  });
});

describe("agendaSurface - dni, filtry i kontrolka zapisu", () => {
  it("grupuje po dniu w STREFIE WYDARZENIA, nie przegladarki", () => {
    // 23:30 UTC to juz nastepny dzien w Warszawie - sesja nalezy do 2 wrzesnia.
    const sessions = parseEventAgenda([
      agendaRow({ id: "a", starts_at: "2026-09-01T06:00:00Z" }),
      agendaRow({ id: "b", starts_at: "2026-09-01T23:30:00Z" }),
    ]);
    const days = groupAgendaByDay(sessions);
    expect(days.map((day) => day.key)).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("odrzuca sesje bez identyfikatora albo bez daty", () => {
    expect(parseEventAgenda([agendaRow({ id: "" }), agendaRow({ starts_at: "" })])).toHaveLength(0);
  });

  it("nieznany `access_state` czyta sie jako wymog zapisu", () => {
    const [session] = parseEventAgenda([agendaRow({ access_state: "kosmos" })]);
    expect(session.accessState).toBe("signup_required");
    expect(agendaStateKey(session.accessState)).toBe("eventFront.agenda.states.signupRequired");
  });

  it("sesja odwolana i bez zapisow nie ma kontrolki", () => {
    const [cancelled] = parseEventAgenda([
      agendaRow({ status: "cancelled", requires_signup: true, access_state: "cancelled" }),
    ]);
    const [open] = parseEventAgenda([agendaRow({ requires_signup: false })]);
    expect(agendaSignupControl(cancelled)).toBeNull();
    expect(agendaSignupControl(open)).toBeNull();
  });

  it("komplet daje kontrolke REZERWY, a zapisany - rezygnacje", () => {
    const [full] = parseEventAgenda([
      agendaRow({ requires_signup: true, access_state: "full", capacity: 10, seats_left: 0 }),
    ]);
    const [mine] = parseEventAgenda([
      agendaRow({
        requires_signup: true,
        access_state: "signed_up",
        my_signup_status: "registered",
      }),
    ]);
    expect(agendaSignupControl(full)?.labelKey).toBe("eventFront.agenda.actions.joinWaitlist");
    expect(agendaSignupControl(mine)?.action).toBe("cancel");
  });

  it("bramka warstwy zdejmuje kontrolke - klik prowadzilby w sciane", () => {
    const [gated] = parseEventAgenda([
      agendaRow({ requires_signup: true, access_state: "tier_required", min_tier_rank: 2 }),
    ]);
    expect(agendaSignupControl(gated)).toBeNull();
  });

  it("liczba wolnych miejsc pojawia sie tylko przy sesji z zapisami", () => {
    const [withSignup] = parseEventAgenda([
      agendaRow({ requires_signup: true, capacity: 30, seats_left: 4 }),
    ]);
    const [withoutSignup] = parseEventAgenda([
      agendaRow({ requires_signup: false, seats_left: 4 }),
    ]);
    expect(agendaSeatsLeft(withSignup)).toBe(4);
    expect(agendaSeatsLeft(withoutSignup)).toBeNull();
  });

  it("filtruje po nurcie i po wlasnych zapisach", () => {
    const sessions = parseEventAgenda([
      agendaRow({ id: "a", track_id: "t1", track_key: "policy" }),
      agendaRow({ id: "b", track_id: "t2", track_key: "energy", my_signup_status: "registered" }),
    ]);
    expect(filterAgenda(sessions, { trackId: "t1", onlyMine: false })).toHaveLength(1);
    expect(filterAgenda(sessions, { trackId: null, onlyMine: true })).toHaveLength(1);
    expect(hasOwnAgenda(sessions)).toBe(true);
    expect(agendaTrackOptions(sessions).map((track) => track.key)).toEqual(["energy", "policy"]);
  });

  it("fraza z pola wyszukiwania trafia w tytul w DRUGIM jezyku i bez ogonkow", () => {
    const sessions = parseEventAgenda([
      agendaRow({ id: "a", title_pl: "Bezpieczeństwo energetyczne", title_en: "Energy security" }),
      agendaRow({ id: "b", title_pl: "Rynek pracy", title_en: "Labour market" }),
    ]);
    const find = (query: string) =>
      filterAgenda(sessions, { trackId: null, onlyMine: false, query });
    expect(find("bezpieczenstwo").map((session) => session.id)).toEqual(["a"]);
    expect(find("labour").map((session) => session.id)).toEqual(["b"]);
    // Pole w spoczynku nie moze ukrywac programu.
    expect(find("   ")).toHaveLength(2);
  });

  it("wyszukiwanie znajduje sesje po NAZWISKU prelegenta", () => {
    const sessions = parseEventAgenda([
      agendaRow({
        id: "a",
        speakers: [{ user_id: "u1", display_name: "Anna Zabłocka", headline_pl: "PwC" }],
      }),
      agendaRow({ id: "b" }),
    ]);
    expect(
      filterAgenda(sessions, { trackId: null, onlyMine: false, query: "zablocka" }).map(
        (session) => session.id,
      ),
    ).toEqual(["a"]);
  });

  it("harmonogram uczestnika pomija REZYGNACJE i porzadkuje po godzinie", () => {
    const sessions = parseEventAgenda([
      agendaRow({ id: "late", starts_at: "2026-09-01T12:00:00Z", my_signup_status: "waitlist" }),
      agendaRow({ id: "gone", starts_at: "2026-09-01T09:00:00Z", my_signup_status: "cancelled" }),
      agendaRow({ id: "early", starts_at: "2026-09-01T10:00:00Z", my_signup_status: "registered" }),
    ]);
    expect(ownAgenda(sessions).map((session) => session.id)).toEqual(["early", "late"]);
    // Rezygnacja nie jest miejscem na sali, wiec nie wlacza filtra „tylko moje".
    expect(hasOwnAgenda(parseEventAgenda([agendaRow({ my_signup_status: "cancelled" })]))).toBe(
      false,
    );
    expect(
      filterAgenda(parseEventAgenda([agendaRow({ my_signup_status: "cancelled" })]), {
        trackId: null,
        onlyMine: true,
      }),
    ).toHaveLength(0);
  });

  it("tytul sesji ma JEDNA regule dla bloku i dla harmonogramu", () => {
    const [onlyEn] = parseEventAgenda([agendaRow({ title_pl: "", title_en: "Closing panel" })]);
    expect(agendaSessionTitle(onlyEn, "pl")).toBe("Closing panel");
  });

  it("prelegent bez identyfikatora wypada, kolejnosc bierze sie z `sort_order`", () => {
    const [session] = parseEventAgenda([
      agendaRow({
        speakers: [
          { user_id: "u2", display_name: "Bogna", sort_order: 2 },
          { display_name: "Duch" },
          { user_id: "u1", display_name: "Anna", sort_order: 1 },
        ],
      }),
    ]);
    expect(session.speakers.map((speaker) => speaker.displayName)).toEqual(["Anna", "Bogna"]);
  });
});

describe("sponsorsSurface - poziomy, rozmiary i materialy", () => {
  function tierRow(over: Partial<EventSponsorTierRow>): EventSponsorTierRow {
    return {
      tier_id: "t1",
      tier_key: "gold",
      tier_name_pl: "Złoty",
      tier_name_en: "Gold",
      tier_description_pl: "",
      tier_description_en: "",
      tier_rank: 30,
      tier_accent_color: "",
      tier_logo_size: "lg",
      benefits: [],
      sponsors: [{ id: "s1", name: "Firma", sort_order: 1 }],
      ...over,
    } as EventSponsorTierRow;
  }

  it("grupa BEZ poziomu ląduje na koncu, reszta po randze malejaco", () => {
    const tiers = parseSponsorTiers([
      tierRow({
        tier_id: null as unknown as string,
        tier_rank: 0,
        tier_key: null as unknown as string,
      }),
      tierRow({ tier_id: "t2", tier_key: "silver", tier_rank: 20 }),
      tierRow({ tier_id: "t1", tier_key: "gold", tier_rank: 30 }),
    ]);
    expect(tiers.map((tier) => tier.key)).toEqual(["gold", "silver", null]);
  });

  it("poziom bez opublikowanych partnerow nie wraca na strone", () => {
    expect(parseSponsorTiers([tierRow({ sponsors: [] })])).toHaveLength(0);
  });

  it("partner bez nazwy wypada - samo logo jest obrazkiem bez tresci", () => {
    const [tier] = parseSponsorTiers([
      tierRow({
        sponsors: [
          { id: "s1", name: "" },
          { id: "s2", name: "Realna" },
        ],
      }),
    ]);
    expect(tier.sponsors.map((sponsor) => sponsor.name)).toEqual(["Realna"]);
  });

  it("rozmiar logotypu wynika z poziomu, a nie z liczby partnerow", () => {
    expect(sponsorLogoClass("lg")).not.toBe(sponsorLogoClass("sm"));
    expect(sponsorRoleKey("media_partner")).toBe("eventFront.sponsors.roles.mediaPartner");
  });

  it("material bez adresu nie staje sie przyciskiem donikad", () => {
    const rows: EventSponsorMaterialRow[] = [
      {
        id: "m1",
        sponsor_id: "s1",
        sponsor_name: "Firma",
        sponsor_logo_url: "",
        tier_id: "t1",
        tier_name_pl: "Złoty",
        tier_name_en: "Gold",
        tier_rank: 30,
        title_pl: "Raport",
        title_en: "Report",
        kind: "document",
        url: "",
        sort_order: 1,
      } as EventSponsorMaterialRow,
    ];
    expect(parseSponsorMaterials(rows)).toHaveLength(0);
  });

  it("materialy grupuja sie po partnerze, a nieznany rodzaj czyta sie jako odnosnik", () => {
    const rows = [
      {
        id: "m1",
        sponsor_id: "s1",
        sponsor_name: "Firma",
        sponsor_logo_url: "",
        tier_id: "t1",
        tier_name_pl: "",
        tier_name_en: "",
        tier_rank: 10,
        title_pl: "A",
        title_en: "A",
        kind: "kosmos",
        url: "https://example.test/a",
        sort_order: 1,
      },
      {
        id: "m2",
        sponsor_id: "s1",
        sponsor_name: "Firma",
        sponsor_logo_url: "",
        tier_id: "t1",
        tier_name_pl: "",
        tier_name_en: "",
        tier_rank: 10,
        title_pl: "B",
        title_en: "B",
        kind: "video",
        url: "https://example.test/b",
        sort_order: 2,
      },
    ] as EventSponsorMaterialRow[];
    const materials = parseSponsorMaterials(rows);
    expect(materials[0].kind).toBe("link");
    expect(groupSponsorMaterials(materials)).toHaveLength(1);
    expect(sponsorMaterialKindKey("logo_pack")).toBe("eventFront.materials.kinds.logoPack");
  });
});
