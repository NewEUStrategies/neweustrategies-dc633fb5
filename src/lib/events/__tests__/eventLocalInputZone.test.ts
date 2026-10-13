// Pola `datetime-local` formularzy panelu (bilet, pakiet, sesja, gielda) -
// zegar w STREFIE WYDARZENIA, nie przegladarki (klasa OPS-15, przekazanie S6).
//
// CALY PLIK BIEGNIE PRZY `TZ=Europe/London` dla wydarzenia w `Europe/Warsaw`:
// organizator z Londynu ustawia sprzedaz, sesje i gielde warszawskiego
// kongresu. Na maszynie CI (`TZ: UTC`) albo w Warszawie dawna konwersja
// (`new Date(napis)`) dawala wyniki wygladajace poprawnie - dopiero rozjazd
// strefy maszyny i strefy wydarzenia pokazuje, czyja godzina trafia do bazy.
//
// NOCE ZMIANY CZASU 2026 (te same daty w Londynie i Warszawie - regula UE):
//   * 29.03 - w Warszawie nie ma godzin 02:00-02:59 (CET -> CEST);
//   * 25.10 - w Warszawie godziny 02:00-02:59 wypadaja dwa razy (CEST -> CET).
// Oczekiwane chwile sa wartosciami z PostgreSQL 16 (`timestamp AT TIME ZONE`),
// tak jak w `timezoneWallClock.test.ts`: luka przesuwa godzine o dlugosc luki
// do przodu, zakladka bierze DRUGIE wystapienie.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import {
  canonicalInstant,
  eventLocalInput,
  eventLocalInputHint,
  eventLocalInputToIso,
  resolveEventLocalInput,
} from "@/lib/events/eventLocalInput";
import {
  emptySessionDraft,
  sessionDraftFromRow,
  sessionDraftToInput,
  validateSessionDraft,
} from "@/lib/events/sessionDraft";
import {
  emptyTicketDraft,
  phasesFromJson,
  ticketDraftFromRow,
  ticketDraftIssue,
  ticketDraftToInput,
} from "@/lib/events/ticketDraft";
import {
  emptyPackageDraft,
  packageDraftFromRow,
  packageDraftToInput,
} from "@/lib/events/packageDraft";
import {
  draftFromSettings,
  settingsInputFromDraft,
  validateSettingsDraft,
} from "@/lib/events/meetingsSettingsDraft";
import type { MeetingSettings } from "@/lib/events/meetingsApi";
import type { EventSessionDetailRow } from "@/lib/events/sessionsApi";
import type { EventPackageRow } from "@/lib/events/packagesApi";
import { eventTicketRow } from "@/test/events/adminSalesRows";

const ORIGINAL_TZ = process.env.TZ;
const WARSZAWA = "Europe/Warsaw";
const LONDYN = "Europe/London";
const EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeAll(() => {
  process.env.TZ = LONDYN;
});

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

/** Atrapa `t`: klucz z parametrami, jak `i18nStub` - test widzi, CO podpis mowi. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params === undefined
    ? key
    : `${key}(${Object.entries(params)
        .map(([name, value]) => `${name}=${String(value)}`)
        .sort()
        .join(",")})`) as unknown as TFunction;

describe("kanarek strefy maszyny", () => {
  it("maszyna jest naprawde w Londynie - dawna konwersja dalaby godzine londynska", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(LONDYN);
    // `new Date(napis)` czyta 18:00 jako 18:00 BST = 17:00 UTC, czyli 19:00
    // czasu kongresu. Wszystkie oczekiwania nizej sa rozne od tej wartosci.
    expect(new Date("2026-09-30T18:00").toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });
});

describe("eventLocalInput - zegar wydarzenia w obie strony", () => {
  it("18:00 wpisane w Londynie dla Warszawy to 18:00 w Warszawie (16:00 UTC)", () => {
    expect(eventLocalInputToIso("2026-09-30T18:00", WARSZAWA)).toBe("2026-09-30T16:00:00.000Z");
    expect(eventLocalInput("2026-09-30T16:00:00.000Z", WARSZAWA)).toBe("2026-09-30T18:00");
  });

  it("zima: CET = UTC+1", () => {
    expect(eventLocalInputToIso("2026-12-01T09:30", WARSZAWA)).toBe("2026-12-01T08:30:00.000Z");
    expect(eventLocalInput("2026-12-01T08:30:00.000Z", WARSZAWA)).toBe("2026-12-01T09:30");
  });

  it("puste, niepelne i nieistniejace daty daja null, nigdy Invalid Date", () => {
    expect(eventLocalInputToIso("", WARSZAWA)).toBeNull();
    expect(eventLocalInputToIso("  ", WARSZAWA)).toBeNull();
    expect(eventLocalInputToIso("2026-09-30", WARSZAWA)).toBeNull();
    expect(eventLocalInputToIso("2026-02-30T10:00", WARSZAWA)).toBeNull();
    expect(eventLocalInput(null, WARSZAWA)).toBe("");
    expect(eventLocalInput("nie-data", WARSZAWA)).toBe("");
    expect(canonicalInstant("nie-data")).toBeNull();
    expect(canonicalInstant("2026-09-30T18:00:00+02:00")).toBe("2026-09-30T16:00:00.000Z");
  });

  it("strefa nieznana Intl degraduje do strefy serwisu (Warszawa), nie do Londynu", () => {
    expect(eventLocalInputToIso("2026-09-30T18:00", "Mars/Olympus")).toBe(
      "2026-09-30T16:00:00.000Z",
    );
  });

  it("LUKA 29.03: 02:30 nie istnieje - zapis 03:30 CEST (01:30 UTC)", () => {
    expect(resolveEventLocalInput("2026-03-29T02:30", WARSZAWA)).toEqual({
      iso: "2026-03-29T01:30:00.000Z",
      resolution: "gap",
    });
    // Granice luki istnieja normalnie.
    expect(resolveEventLocalInput("2026-03-29T01:59", WARSZAWA)?.resolution).toBe("exact");
    expect(resolveEventLocalInput("2026-03-29T03:00", WARSZAWA)).toEqual({
      iso: "2026-03-29T01:00:00.000Z",
      resolution: "exact",
    });
  });

  it("ZAKLADKA 25.10: 02:30 wypada dwa razy - przyjmujemy drugie (CET, 01:30 UTC)", () => {
    expect(resolveEventLocalInput("2026-10-25T02:30", WARSZAWA)).toEqual({
      iso: "2026-10-25T01:30:00.000Z",
      resolution: "overlap",
    });
    // Pierwsze wystapienie (CEST) pokazuje sie w polu tym samym napisem.
    expect(eventLocalInput("2026-10-25T00:30:00.000Z", WARSZAWA)).toBe("2026-10-25T02:30");
  });

  it("nietkniete pole oddaje chwile z bazy - sekundy i PIERWSZE wystapienie godziny", () => {
    // Bez pamieci chwili: 23:59:59 przyciete do 23:59:00 ...
    expect(eventLocalInputToIso("2026-09-30T23:59", WARSZAWA)).toBe("2026-09-30T21:59:00.000Z");
    expect(eventLocalInputToIso("2026-09-30T23:59", WARSZAWA, "2026-09-30T21:59:59.000Z")).toBe(
      "2026-09-30T21:59:59.000Z",
    );
    // ... i termin z pierwszego wystapienia 02:30 przesuniety o godzine.
    expect(eventLocalInputToIso("2026-10-25T02:30", WARSZAWA, "2026-10-25T00:30:00.000Z")).toBe(
      "2026-10-25T00:30:00.000Z",
    );
  });

  it("pole ZMIENIONE nie korzysta z pamieci chwili", () => {
    expect(eventLocalInputToIso("2026-09-30T23:00", WARSZAWA, "2026-09-30T21:59:59.000Z")).toBe(
      "2026-09-30T21:00:00.000Z",
    );
  });
});

describe("eventLocalInputHint - podpis pola", () => {
  it("zwykla godzina: nazwa strefy; cichy wariant nie powtarza jej", () => {
    expect(eventLocalInputHint(t, "pl", "2026-09-30T18:00", WARSZAWA)).toBe(
      "adminEvents.eventTime.zone(zone=Europe/Warsaw)",
    );
    expect(eventLocalInputHint(t, "pl", "", WARSZAWA)).toBe(
      "adminEvents.eventTime.zone(zone=Europe/Warsaw)",
    );
    expect(
      eventLocalInputHint(t, "pl", "2026-09-30T18:00", WARSZAWA, null, { quietWhenExact: true }),
    ).toBeUndefined();
  });

  it("luka i zakladka maja wlasne zdanie z godzina, ktora zapiszemy - takze w cichym wariancie", () => {
    const gap = eventLocalInputHint(t, "pl", "2026-03-29T02:30", WARSZAWA, null, {
      quietWhenExact: true,
    });
    expect(gap).toBe("adminEvents.eventTime.gap(value=03:30,zone=Europe/Warsaw)");
    const overlap = eventLocalInputHint(t, "en", "2026-10-25T02:30", WARSZAWA);
    expect(overlap?.startsWith("adminEvents.eventTime.overlap(")).toBe(true);
    expect(overlap).toContain("zone=Europe/Warsaw");
    expect(overlap).toContain("02:30");
  });

  it("nietkniete pierwsze wystapienie godziny nie udaje zakladki", () => {
    expect(
      eventLocalInputHint(t, "pl", "2026-10-25T02:30", WARSZAWA, "2026-10-25T00:30:00.000Z"),
    ).toBe("adminEvents.eventTime.zone(zone=Europe/Warsaw)");
  });
});

describe("sessionDraft w strefie wydarzenia", () => {
  const row = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    title_pl: "Otwarcie",
    title_en: "Opening",
    starts_at: "2026-09-14T07:30:00.000Z",
    ends_at: "2026-09-14T08:45:30.000Z",
  } as unknown as EventSessionDetailRow;

  it("pola pokazuja zegar Warszawy, a zapis bez zmian oddaje chwile co do sekundy", () => {
    const draft = sessionDraftFromRow(row, WARSZAWA);
    expect(draft.timeZone).toBe(WARSZAWA);
    expect(draft.startsAt).toBe("2026-09-14T09:30");
    expect(draft.endsAt).toBe("2026-09-14T10:45");
    const input = sessionDraftToInput(draft, EVENT);
    expect(input.startsAt).toBe("2026-09-14T07:30:00.000Z");
    expect(input.endsAt).toBe("2026-09-14T08:45:30.000Z");
  });

  it("ODBIOR: 9:30 z programu wpisane w Londynie to 9:30 w Warszawie (07:30 UTC)", () => {
    const draft = {
      ...emptySessionDraft(10, WARSZAWA),
      titlePl: "Panel",
      titleEn: "Panel",
      startsAt: "2026-09-14T09:30",
      endsAt: "2026-09-14T10:30",
    };
    expect(validateSessionDraft(draft)).toEqual([]);
    const input = sessionDraftToInput(draft, EVENT);
    // Dawna konwersja dawala 08:30 UTC, czyli 10:30 czasu kongresu.
    expect(input.startsAt).toBe("2026-09-14T07:30:00.000Z");
    expect(input.endsAt).toBe("2026-09-14T08:30:00.000Z");
  });

  it("noc wiosennej zmiany: 01:30-03:30 trwa godzine, 02:30-03:15 konczy sie przed poczatkiem", () => {
    const base = { ...emptySessionDraft(10, WARSZAWA), titlePl: "Noc", titleEn: "Night" };
    const night = sessionDraftToInput(
      { ...base, startsAt: "2026-03-29T01:30", endsAt: "2026-03-29T03:30" },
      EVENT,
    );
    expect(night.startsAt).toBe("2026-03-29T00:30:00.000Z");
    expect(night.endsAt).toBe("2026-03-29T01:30:00.000Z");
    // 02:30 nie istnieje i przesuwa sie na 03:30 - wiec 03:15 jest PRZED nim.
    expect(
      validateSessionDraft({
        ...base,
        startsAt: "2026-03-29T02:30",
        endsAt: "2026-03-29T03:15",
      }).map((error) => error.field),
    ).toEqual(["endsAt"]);
  });
});

describe("ticketDraft w strefie wydarzenia", () => {
  it("sprzedaz do 18:00 wpisana w Londynie zamyka sie o 18:00 czasu kongresu", () => {
    const draft = {
      ...emptyTicketDraft(10, WARSZAWA),
      key: "standard",
      namePl: "Standard",
      nameEn: "Standard",
      salesFrom: "2026-09-01T09:00",
      salesTo: "2026-09-30T18:00",
      earlyBirdPriceCents: "0",
      earlyBirdUntil: "2026-09-10T23:59",
    };
    expect(ticketDraftIssue(draft)).toBeNull();
    const input = ticketDraftToInput(draft, EVENT);
    expect(input.salesFrom).toBe("2026-09-01T07:00:00.000Z");
    expect(input.salesTo).toBe("2026-09-30T16:00:00.000Z");
    expect(input.earlyBirdUntil).toBe("2026-09-10T21:59:00.000Z");
  });

  it("przelacznik aktywnosci (wiersz -> szkic -> payload) nie rusza terminow ani faz", () => {
    const row = eventTicketRow({
      sales_from: "2026-10-25T00:30:00.000Z", // 02:30 CEST - pierwsze wystapienie
      sales_to: "2026-12-31T22:59:59.000Z",
      early_bird_price_cents: 900,
      early_bird_until: "2026-11-30T22:59:59.999Z",
      price_schedule: [
        {
          label_pl: "Faza I",
          label_en: "Phase I",
          from: "2026-10-25T00:30:00.000Z",
          to: "2026-11-01T10:15:45.000Z",
          price_cents: 900,
        },
      ],
    });
    const draft = ticketDraftFromRow(row, WARSZAWA);
    expect(draft.salesFrom).toBe("2026-10-25T02:30");
    expect(draft.salesTo).toBe("2026-12-31T23:59");
    const input = ticketDraftToInput(draft, EVENT);
    expect(input.salesFrom).toBe("2026-10-25T00:30:00.000Z");
    expect(input.salesTo).toBe("2026-12-31T22:59:59.000Z");
    expect(input.earlyBirdUntil).toBe("2026-11-30T22:59:59.999Z");
    expect(input.priceSchedule[0].from).toBe("2026-10-25T00:30:00.000Z");
    expect(input.priceSchedule[0].to).toBe("2026-11-01T10:15:45.000Z");
  });

  it("faza z nowo wpisana granica liczy sie w strefie wydarzenia, z regula zakladki", () => {
    const [phase] = phasesFromJson([{ price_cents: 900 }], WARSZAWA);
    const draft = {
      ...emptyTicketDraft(10, WARSZAWA),
      key: "standard",
      namePl: "Standard",
      nameEn: "Standard",
      priceCents: "1000",
      phases: [{ ...phase, from: "2026-10-25T02:30", to: "2026-10-26T00:00" }],
    };
    expect(ticketDraftIssue(draft)).toBeNull();
    const input = ticketDraftToInput(draft, EVENT);
    expect(input.priceSchedule[0].from).toBe("2026-10-25T01:30:00.000Z");
    expect(input.priceSchedule[0].to).toBe("2026-10-25T23:00:00.000Z");
  });
});

describe("packageDraft w strefie wydarzenia", () => {
  const row = {
    id: "p-1",
    key: "delegacja",
    ticket_type_id: "t-1",
    name_pl: "Delegacja",
    name_en: "Delegation",
    description_pl: "",
    description_en: "",
    audience: "company",
    seats: 5,
    price_cents: 50000,
    currency: "PLN",
    quota: null,
    sales_from: "2026-09-10T06:30:30.000Z",
    sales_to: "2026-09-30T20:00:00.000Z",
    min_tier_rank: 0,
    requires_verification: false,
    is_active: true,
    sort_order: 100,
  } as unknown as EventPackageRow;

  it("okno pokazuje zegar Warszawy, a przelacznik oddaje je co do sekundy", () => {
    const draft = packageDraftFromRow(row, WARSZAWA);
    expect(draft.salesFrom).toBe("2026-09-10T08:30");
    expect(draft.salesTo).toBe("2026-09-30T22:00");
    const input = packageDraftToInput({ ...draft, isActive: false }, EVENT);
    expect(input.salesFrom).toBe("2026-09-10T06:30:30.000Z");
    expect(input.salesTo).toBe("2026-09-30T20:00:00.000Z");
  });

  it("nowy pakiet: okno wpisane w Londynie jest oknem w Warszawie", () => {
    const input = packageDraftToInput(
      {
        ...emptyPackageDraft(100, WARSZAWA),
        key: "delegacja",
        ticketTypeId: "t-1",
        namePl: "Delegacja",
        nameEn: "Delegation",
        salesFrom: "2026-03-29T02:30",
        salesTo: "2026-04-01T12:00",
      },
      EVENT,
    );
    expect(input.salesFrom).toBe("2026-03-29T01:30:00.000Z");
    expect(input.salesTo).toBe("2026-04-01T10:00:00.000Z");
  });
});

describe("meetingsSettingsDraft - okno zaproszen w strefie gieldy", () => {
  const SETTINGS = {
    configured: true,
    event_id: "e1",
    event_timezone: WARSZAWA,
    is_enabled: true,
    slot_minutes: 20,
    break_minutes: 5,
    day_start_time: "09:00:00",
    day_end_time: "17:00:00",
    meeting_days: ["2026-09-14"],
    timezone: WARSZAWA,
    invites_open_at: "2026-09-01T07:00:00.000Z",
    invites_close_at: "2026-09-13T21:59:59.000Z",
    max_invites_per_person: null,
    max_meetings_per_day: null,
    invite_expires_after_hours: 72,
    visibility: "everyone",
    intro_pl: "",
    intro_en: "",
    updated_at: null,
    requester_groups: [],
    invitee_groups: [],
    available_groups: [],
    tables_count: 0,
    seats_count: 0,
    participants_count: 0,
    with_availability_count: 0,
  } as unknown as MeetingSettings;

  it("pola pokazuja zegar gieldy, a zapis bez zmian oddaje chwile co do sekundy", () => {
    const draft = draftFromSettings(SETTINGS);
    expect(draft.invitesOpenAt).toBe("2026-09-01T09:00");
    expect(draft.invitesCloseAt).toBe("2026-09-13T23:59");
    const input = settingsInputFromDraft("e1", draft);
    expect(input.invitesOpenAt).toBe("2026-09-01T07:00:00.000Z");
    expect(input.invitesCloseAt).toBe("2026-09-13T21:59:59.000Z");
  });

  it("ODBIOR: zaproszenia od 9:00 wpisane w Londynie otwieraja sie o 9:00 w Warszawie", () => {
    const draft = { ...draftFromSettings(SETTINGS), invitesOpenAt: "2026-09-02T09:00" };
    expect(validateSettingsDraft(draft)).toEqual([]);
    // Dawna konwersja: 09:00 BST = 08:00 UTC, czyli 10:00 czasu kongresu.
    expect(settingsInputFromDraft("e1", draft).invitesOpenAt).toBe("2026-09-02T07:00:00.000Z");
  });

  it("strefa gieldy inna niz wydarzenia: pola sa zegarem strefy z formularza", () => {
    const draft = {
      ...draftFromSettings(SETTINGS),
      timezone: "Europe/Lisbon",
      invitesOpenAt: "2026-09-02T09:00",
    };
    expect(settingsInputFromDraft("e1", draft).invitesOpenAt).toBe("2026-09-02T08:00:00.000Z");
  });

  it("kolejnosc okna liczy sie z chwil, takze w noc zakladki 25.10", () => {
    // 02:45 w noc zakladki to tez drugie wystapienie (CET), wiec 02:30 -> 02:45
    // jest poprawnym oknem 15 minut, a odwrotnie - bledem kolejnosci.
    const base = draftFromSettings({ ...SETTINGS, invites_open_at: null, invites_close_at: null });
    expect(
      validateSettingsDraft({
        ...base,
        invitesOpenAt: "2026-10-25T02:30",
        invitesCloseAt: "2026-10-25T02:45",
      }),
    ).toEqual([]);
    expect(
      validateSettingsDraft({
        ...base,
        invitesOpenAt: "2026-10-25T02:45",
        invitesCloseAt: "2026-10-25T02:30",
      }),
    ).toContain("windowOrder");
  });
});
