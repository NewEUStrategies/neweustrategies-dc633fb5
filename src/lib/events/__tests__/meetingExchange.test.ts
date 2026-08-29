// Testy odczytu stanu gieldy spotkan 1-1 (`event_meeting_exchange`).
//
// PO CO TEN PLIK ISTNIEJE. Modul jest JEDYNA granica miedzy `jsonb` z RPC
// a ekranem uczestnika. Wszystko, co przejdzie tedy zle, przechodzi CICHO:
// TypeScript widzi tu `Json`, wiec zadna literowka w nazwie pola nie wywala
// kompilacji, a `undefined` wrenderowane w liczniku daje "NaN" zamiast bledu.
// Lapiemy wiec cztery klasy usterek naraz.
//
// 1) UMOWA NAZW Z SQL-em. Kazde pole ekranu ma DOKLADNIE jedno zrodlo w
//    odpowiedzi RPC. Test kontraktu podaje komplet kluczy `snake_case`
//    z ROZNYMI wartosciami i porownuje CALY wynik - przemianowanie albo
//    zamiana dwoch pol miejscami (`invites_used` <-> `tables_count`,
//    `intro_pl` <-> `intro_en`) musi byc czerwone, a nie "prawie rowne".
//
// 2) `null` LIMITU KONTRA ZERO. `optionalInt` i `int` roznia sie wylacznie
//    wartoscia awaryjna, a pomylenie ich zamienia wydarzenie BEZ limitu
//    zaproszen w wydarzenie, w ktorym nie wolno zaprosic NIKOGO (albo
//    odwrotnie - obchodzi limit). Kazde pole jest tu sprawdzone po stronie
//    "brak klucza" osobno.
//
// 3) DEGRADACJA DO STANU BEZPIECZNEGO. Smiec zamiast obiektu, obce
//    `visibility`, okno dostepnosci bez identyfikatora - wynikiem ma byc
//    "gielda zamknieta"/pominiety wiersz, nigdy polstan, ktory pokazuje
//    przycisk odrzucany pozniej przez baze.
//
// 4) KOLEJNOSC BLOKAD. `exchangeBlock` to lancuch wczesnych powrotow, wiec
//    liczy sie nie tylko ZBIOR powodow, ale ich PIERWSZENSTWO: uczestnikowi
//    niezapisanemu na wydarzenie nie wolno pokazac "gielda zamknieta",
//    bo pchnie go to do czekania zamiast do rejestracji. Kazda para sasiednich
//    regul ma przypadek, w ktorym obie sa spelnione jednoczesnie.
//
// Modul jest czysty - nie dotyka ani sieci, ani bazy, ani przegladarki -
// wiec nie ma tu mocka klienta Supabase; mockowanie czegokolwiek oznaczaloby
// tutaj mockowanie testowanego kodu.
import { describe, expect, it } from "vitest";
import {
  EMPTY_MEETING_EXCHANGE,
  exchangeBlock,
  exchangeIntro,
  parseMeetingExchange,
  type MeetingExchange,
} from "@/lib/events/meetingExchange";
import { MEETING_VISIBILITIES } from "@/lib/events/meetingsApi";
import type { Json } from "@/integrations/supabase/types";

/**
 * RPC oddaje `jsonb`, ale test musi umiec podac takze wartosci, ktorych
 * JSON nie zna (`NaN`, `undefined`) - bo wlasnie przed nimi broni sie parser.
 */
function raw(value: unknown): Json {
  return value as Json;
}

/** Kompletna, poprawna odpowiedz RPC - baza dla testow "jedno pole zepsute". */
function fullRaw(): Record<string, unknown> {
  return {
    event_id: "evt-1",
    configured: true,
    is_enabled: true,
    visibility: "groups",
    open_now: true,
    slot_minutes: 20,
    break_minutes: 5,
    day_start_time: "09:00",
    day_end_time: "17:30",
    meeting_days: ["2026-09-01", "2026-09-02"],
    timezone: "Europe/Warsaw",
    invites_open_at: "2026-08-01T10:00:00Z",
    invites_close_at: "2026-08-30T10:00:00Z",
    intro_pl: "Zapros rozmowce",
    intro_en: "Invite a peer",
    invite_expires_after_hours: 48,
    max_invites_per_person: 10,
    max_meetings_per_day: 6,
    my_registration_id: "reg-1",
    can_meet: true,
    invites_used: 3,
    invites_left: 7,
    tables_count: 12,
    my_availability: [
      {
        id: "win-1",
        starts_at: "2026-09-01T09:00:00Z",
        ends_at: "2026-09-01T12:00:00Z",
        is_open: true,
        note: "rano",
      },
    ],
    my_meetings_summary: { incoming_pending: 1, outgoing_pending: 2, accepted: 3, held: 4 },
  };
}

/** Stan gieldy zbudowany na EMPTY - do testow samych regul blokady. */
function exchange(patch: Partial<MeetingExchange> = {}): MeetingExchange {
  return { ...EMPTY_MEETING_EXCHANGE, ...patch };
}

/** Uczestnik, ktory ma prawo wyslac zaproszenie - punkt wyjscia do psucia. */
function allowed(patch: Partial<MeetingExchange> = {}): MeetingExchange {
  return exchange({
    configured: true,
    isEnabled: true,
    visibility: "everyone",
    myRegistrationId: "reg-1",
    canMeet: true,
    openNow: true,
    ...patch,
  });
}

describe("parseMeetingExchange - umowa nazw z RPC", () => {
  it("przepisuje komplet pol odpowiedzi na stan ekranu", () => {
    expect(parseMeetingExchange(raw(fullRaw()))).toEqual({
      eventId: "evt-1",
      configured: true,
      isEnabled: true,
      visibility: "groups",
      openNow: true,
      slotMinutes: 20,
      breakMinutes: 5,
      dayStartTime: "09:00",
      dayEndTime: "17:30",
      meetingDays: ["2026-09-01", "2026-09-02"],
      timezone: "Europe/Warsaw",
      invitesOpenAt: "2026-08-01T10:00:00Z",
      invitesCloseAt: "2026-08-30T10:00:00Z",
      introPl: "Zapros rozmowce",
      introEn: "Invite a peer",
      inviteExpiresAfterHours: 48,
      maxInvitesPerPerson: 10,
      maxMeetingsPerDay: 6,
      myRegistrationId: "reg-1",
      canMeet: true,
      invitesUsed: 3,
      invitesLeft: 7,
      tablesCount: 12,
      myAvailability: [
        {
          id: "win-1",
          startsAt: "2026-09-01T09:00:00Z",
          endsAt: "2026-09-01T12:00:00Z",
          isOpen: true,
          note: "rano",
        },
      ],
      summary: { incomingPending: 1, outgoingPending: 2, accepted: 3, held: 4 },
    } satisfies MeetingExchange);
  });

  it("czyta wstepy z rozdzielnych kluczy jezykowych, nie z jednego", () => {
    const parsed = parseMeetingExchange(raw({ intro_pl: "PL", intro_en: "EN" }));
    expect(parsed.introPl).toBe("PL");
    expect(parsed.introEn).toBe("EN");
  });

  it("nie myli licznikow zuzytych zaproszen ze stolikami", () => {
    const parsed = parseMeetingExchange(raw({ invites_used: 2, tables_count: 40 }));
    expect(parsed.invitesUsed).toBe(2);
    expect(parsed.tablesCount).toBe(40);
  });

  it("ignoruje klucze, ktorych ekran nie zna", () => {
    const parsed = parseMeetingExchange(raw({ ...fullRaw(), totally_new_column: "x" }));
    expect(parsed).not.toHaveProperty("totally_new_column");
    expect(parsed.eventId).toBe("evt-1");
  });
});

describe("parseMeetingExchange - odpowiedz, ktora nie jest obiektem", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["tablica", []],
    ["tablica z obiektem", [{ event_id: "evt-1" }]],
    ["napis", "event_meeting_exchange"],
    ["pusty napis", ""],
    ["liczba", 0],
    ["prawda", true],
  ])("degraduje do zamknietej gieldy, gdy RPC odda %s", (_label, value) => {
    expect(parseMeetingExchange(raw(value))).toEqual(EMPTY_MEETING_EXCHANGE);
  });

  it("pusty obiekt daje ten sam stan co brak odpowiedzi", () => {
    expect(parseMeetingExchange(raw({}))).toEqual(EMPTY_MEETING_EXCHANGE);
  });
});

describe("parseMeetingExchange - flagi", () => {
  it.each([
    ["configured", "configured"],
    ["is_enabled", "isEnabled"],
    ["open_now", "openNow"],
    ["can_meet", "canMeet"],
  ] as const)("%s jest prawda tylko dla literalnego true", (key, field) => {
    expect(parseMeetingExchange(raw({ [key]: true }))[field]).toBe(true);
    expect(parseMeetingExchange(raw({ [key]: false }))[field]).toBe(false);
    expect(parseMeetingExchange(raw({}))[field]).toBe(false);
  });

  it.each([
    ["napis 'true'", "true"],
    ["jedynka", 1],
    ["null", null],
    ["pusty obiekt", {}],
  ])("nie uznaje %s za wlaczona gielde", (_label, value) => {
    expect(parseMeetingExchange(raw({ is_enabled: value })).isEnabled).toBe(false);
  });

  it("zamkniecie zapisow czyta z odpowiedzi bazy, a nie z dat okna", () => {
    // `open_now` liczy baza; daty sluza tylko do podpisania decyzji uzytkownikowi,
    // wiec okno "otwarte wg dat" przy `open_now: false` ma zostac zamkniete.
    const parsed = parseMeetingExchange(
      raw({
        open_now: false,
        invites_open_at: "2000-01-01T00:00:00Z",
        invites_close_at: "2099-01-01T00:00:00Z",
      }),
    );
    expect(parsed.openNow).toBe(false);
    expect(parsed.invitesOpenAt).toBe("2000-01-01T00:00:00Z");
  });
});

describe("parseMeetingExchange - liczby z limitem i bez", () => {
  it.each([
    ["slot_minutes", "slotMinutes"],
    ["break_minutes", "breakMinutes"],
    ["invite_expires_after_hours", "inviteExpiresAfterHours"],
    ["max_invites_per_person", "maxInvitesPerPerson"],
    ["max_meetings_per_day", "maxMeetingsPerDay"],
    ["invites_left", "invitesLeft"],
  ] as const)("brak %s znaczy BRAK LIMITU (null), nie zero", (key, field) => {
    expect(parseMeetingExchange(raw({}))[field]).toBeNull();
    expect(parseMeetingExchange(raw({ [key]: null }))[field]).toBeNull();
    expect(parseMeetingExchange(raw({ [key]: 0 }))[field]).toBe(0);
  });

  it("limit rowny zero zostaje zerem, a nie brakiem limitu", () => {
    const parsed = parseMeetingExchange(raw({ max_invites_per_person: 0, invites_left: 0 }));
    expect(parsed.maxInvitesPerPerson).toBe(0);
    expect(parsed.invitesLeft).toBe(0);
  });

  it.each([
    ["napis z liczba", "10"],
    ["NaN", Number.NaN],
    ["nieskonczonosc", Number.POSITIVE_INFINITY],
    ["minus nieskonczonosc", Number.NEGATIVE_INFINITY],
    ["tablica", [5]],
    ["obiekt", { value: 5 }],
    ["prawda", true],
  ])("odrzuca %s jako limit zaproszen", (_label, value) => {
    expect(parseMeetingExchange(raw({ invites_left: value })).invitesLeft).toBeNull();
  });

  it.each([
    ["invites_used", "invitesUsed"],
    ["tables_count", "tablesCount"],
  ] as const)("brak %s znaczy zero, bo licznik zawsze cos pokazuje", (key, field) => {
    expect(parseMeetingExchange(raw({}))[field]).toBe(0);
    expect(parseMeetingExchange(raw({ [key]: null }))[field]).toBe(0);
    expect(parseMeetingExchange(raw({ [key]: "7" }))[field]).toBe(0);
    expect(parseMeetingExchange(raw({ [key]: Number.NaN }))[field]).toBe(0);
    expect(parseMeetingExchange(raw({ [key]: Number.POSITIVE_INFINITY }))[field]).toBe(0);
    expect(parseMeetingExchange(raw({ [key]: 7 }))[field]).toBe(7);
  });

  it("ucina czesc ulamkowa zamiast zaokraglac w gore", () => {
    // 19.9 minuty slotu to nadal 19 pelnych minut - zaokraglenie w gore
    // obiecywaloby uczestnikowi minute, ktorej harmonogram nie ma.
    const parsed = parseMeetingExchange(raw({ slot_minutes: 19.9, invites_used: 2.7 }));
    expect(parsed.slotMinutes).toBe(19);
    expect(parsed.invitesUsed).toBe(2);
  });

  it("ucina liczby ujemne w strone zera", () => {
    const parsed = parseMeetingExchange(raw({ invites_left: -1.8, invites_used: -3.2 }));
    expect(parsed.invitesLeft).toBe(-1);
    expect(parsed.invitesUsed).toBe(-3);
  });
});

describe("parseMeetingExchange - napisy", () => {
  it.each([
    ["event_id", "eventId"],
    ["day_start_time", "dayStartTime"],
    ["day_end_time", "dayEndTime"],
    ["timezone", "timezone"],
    ["invites_open_at", "invitesOpenAt"],
    ["invites_close_at", "invitesCloseAt"],
    ["my_registration_id", "myRegistrationId"],
  ] as const)("%s pusty lub bialy znaczy brak wartosci", (key, field) => {
    expect(parseMeetingExchange(raw({}))[field]).toBeNull();
    expect(parseMeetingExchange(raw({ [key]: "" }))[field]).toBeNull();
    expect(parseMeetingExchange(raw({ [key]: "   " }))[field]).toBeNull();
    expect(parseMeetingExchange(raw({ [key]: null }))[field]).toBeNull();
    expect(parseMeetingExchange(raw({ [key]: 123 }))[field]).toBeNull();
  });

  it("zachowuje napis w oryginalnej postaci, bez przycinania spacji", () => {
    expect(parseMeetingExchange(raw({ timezone: " Europe/Warsaw " })).timezone).toBe(
      " Europe/Warsaw ",
    );
  });

  it("wstep moze byc pustym napisem - to nie jest brak pola", () => {
    const parsed = parseMeetingExchange(raw({ intro_pl: "", intro_en: "EN" }));
    expect(parsed.introPl).toBe("");
    expect(parsed.introEn).toBe("EN");
  });

  it.each([
    ["brak klucza", {}],
    ["null", { intro_pl: null }],
    ["liczba", { intro_pl: 7 }],
    ["obiekt", { intro_pl: { pl: "x" } }],
  ])("wstep spoza typu napisowego (%s) degraduje do pustego napisu", (_label, payload) => {
    expect(parseMeetingExchange(raw(payload)).introPl).toBe("");
  });
});

describe("parseMeetingExchange - dni spotkan", () => {
  it("przepuszcza wylacznie niepuste napisy, zachowujac kolejnosc", () => {
    const parsed = parseMeetingExchange(
      raw({ meeting_days: ["2026-09-02", "", "2026-09-01", null, 5, {}, [], "2026-09-03"] }),
    );
    expect(parsed.meetingDays).toEqual(["2026-09-02", "2026-09-01", "2026-09-03"]);
  });

  it.each([
    ["brak klucza", {}],
    ["null", { meeting_days: null }],
    ["napis", { meeting_days: "2026-09-01" }],
    ["obiekt", { meeting_days: { 0: "2026-09-01" } }],
  ])("brak listy dni (%s) daje pusta liste", (_label, payload) => {
    expect(parseMeetingExchange(raw(payload)).meetingDays).toEqual([]);
  });

  it("pusta lista dni zostaje pusta", () => {
    expect(parseMeetingExchange(raw({ meeting_days: [] })).meetingDays).toEqual([]);
  });
});

describe("parseMeetingExchange - widocznosc gieldy", () => {
  it.each(MEETING_VISIBILITIES)("przyjmuje wartosc slownikowa %s", (value) => {
    expect(parseMeetingExchange(raw({ visibility: value })).visibility).toBe(value);
  });

  it.each([
    ["brak klucza", {}],
    ["null", { visibility: null }],
    ["wartosc spoza zbioru", { visibility: "sponsors" }],
    ["inna wielkosc liter", { visibility: "EVERYONE" }],
    ["pusty napis", { visibility: "" }],
    ["liczba", { visibility: 1 }],
    ["tablica", { visibility: ["everyone"] }],
  ])("degraduje %s do 'disabled', czyli do stanu bezpiecznego", (_label, payload) => {
    expect(parseMeetingExchange(raw(payload)).visibility).toBe("disabled");
  });
});

describe("parseMeetingExchange - wlasne okna dostepnosci", () => {
  it.each([
    ["brak klucza", {}],
    ["null", { my_availability: null }],
    ["obiekt zamiast listy", { my_availability: { id: "win-1" } }],
    ["napis", { my_availability: "win-1" }],
  ])("brak listy okien (%s) daje pusta liste", (_label, payload) => {
    expect(parseMeetingExchange(raw(payload)).myAvailability).toEqual([]);
  });

  it.each([
    ["bez identyfikatora", { starts_at: "A", ends_at: "B" }],
    ["z pustym identyfikatorem", { id: "  ", starts_at: "A", ends_at: "B" }],
    ["bez poczatku", { id: "win-1", ends_at: "B" }],
    ["bez konca", { id: "win-1", starts_at: "A" }],
    ["z granicami spoza typu napisowego", { id: "win-1", starts_at: 1, ends_at: 2 }],
  ])("pomija okno %s, bo nie da sie go ani pokazac, ani usunac", (_label, item) => {
    expect(parseMeetingExchange(raw({ my_availability: [item] })).myAvailability).toEqual([]);
  });

  it.each([
    ["null", null],
    ["napis", "win-1"],
    ["liczba", 3],
    ["tablica", ["win-1"]],
  ])("pomija element listy, ktory nie jest obiektem (%s)", (_label, item) => {
    expect(parseMeetingExchange(raw({ my_availability: [item] })).myAvailability).toEqual([]);
  });

  it("zachowuje poprawne okna mimo smieci obok nich", () => {
    const parsed = parseMeetingExchange(
      raw({
        my_availability: [
          null,
          { id: "win-1", starts_at: "A1", ends_at: "B1" },
          { starts_at: "A2", ends_at: "B2" },
          { id: "win-2", starts_at: "A2", ends_at: "B2", is_open: false, note: "zajete" },
        ],
      }),
    );
    expect(parsed.myAvailability).toEqual([
      { id: "win-1", startsAt: "A1", endsAt: "B1", isOpen: true, note: null },
      { id: "win-2", startsAt: "A2", endsAt: "B2", isOpen: false, note: "zajete" },
    ]);
  });

  it.each([
    ["brak klucza", undefined],
    ["null", null],
    ["napis 'false'", "false"],
    ["zero", 0],
    ["prawda", true],
  ])("okno jest otwarte, dopoki is_open nie jest literalnym false (%s)", (_label, isOpen) => {
    const item: Record<string, unknown> = { id: "win-1", starts_at: "A", ends_at: "B" };
    if (isOpen !== undefined) item.is_open = isOpen;
    expect(parseMeetingExchange(raw({ my_availability: [item] })).myAvailability[0].isOpen).toBe(
      true,
    );
  });

  it("zamkniete okno nadal trafia na liste, bo rezerwuje czas", () => {
    const parsed = parseMeetingExchange(
      raw({ my_availability: [{ id: "win-1", starts_at: "A", ends_at: "B", is_open: false }] }),
    );
    expect(parsed.myAvailability).toHaveLength(1);
    expect(parsed.myAvailability[0].isOpen).toBe(false);
  });

  it.each([
    ["brak klucza", {}],
    ["pusty napis", { note: "" }],
    ["same spacje", { note: "   " }],
    ["null", { note: null }],
    ["liczba", { note: 12 }],
  ])("notatka bez tresci (%s) zapisuje sie jako null", (_label, patch) => {
    const parsed = parseMeetingExchange(
      raw({ my_availability: [{ id: "win-1", starts_at: "A", ends_at: "B", ...patch }] }),
    );
    expect(parsed.myAvailability[0].note).toBeNull();
  });

  it("pusta lista okien zostaje pusta", () => {
    expect(parseMeetingExchange(raw({ my_availability: [] })).myAvailability).toEqual([]);
  });
});

describe("parseMeetingExchange - licznik wlasnych spotkan", () => {
  it("czyta cztery liczniki z rozdzielnych kluczy", () => {
    const parsed = parseMeetingExchange(
      raw({
        my_meetings_summary: {
          incoming_pending: 5,
          outgoing_pending: 4,
          accepted: 3,
          held: 2,
        },
      }),
    );
    expect(parsed.summary).toEqual({
      incomingPending: 5,
      outgoingPending: 4,
      accepted: 3,
      held: 2,
    });
  });

  it.each([
    ["brak klucza", {}],
    ["null", { my_meetings_summary: null }],
    ["tablica", { my_meetings_summary: [] }],
    ["napis", { my_meetings_summary: "0" }],
    ["liczba", { my_meetings_summary: 4 }],
  ])("brak licznikow (%s) daje same zera, a nie NaN", (_label, payload) => {
    expect(parseMeetingExchange(raw(payload)).summary).toEqual({
      incomingPending: 0,
      outgoingPending: 0,
      accepted: 0,
      held: 0,
    });
  });

  it("niepelny licznik uzupelnia brakujace pola zerami", () => {
    const parsed = parseMeetingExchange(raw({ my_meetings_summary: { accepted: 2 } }));
    expect(parsed.summary).toEqual({
      incomingPending: 0,
      outgoingPending: 0,
      accepted: 2,
      held: 0,
    });
  });

  it("liczniki spoza typu liczbowego degraduja do zera", () => {
    const parsed = parseMeetingExchange(
      raw({
        my_meetings_summary: {
          incoming_pending: "3",
          outgoing_pending: null,
          accepted: Number.NaN,
          held: 1.9,
        },
      }),
    );
    expect(parsed.summary).toEqual({
      incomingPending: 0,
      outgoingPending: 0,
      accepted: 0,
      held: 1,
    });
  });
});

describe("parseMeetingExchange - wspoldzielenie stalej EMPTY", () => {
  // ZACHOWANIE OBECNE, prawdopodobnie usterka: brak odpowiedzi zwraca SAM
  // obiekt `EMPTY_MEETING_EXCHANGE`, a brak licznikow - jego zagniezdzone
  // `summary`. Kazda mutacja wyniku po stronie wolajacego (np. `state.summary
  // .accepted += 1` w optymistycznej aktualizacji) przepisalaby stala na cala
  // aplikacje. Test zapisuje ten fakt, zeby ewentualne skopiowanie stalej bylo
  // swiadoma zmiana, a nie przypadkiem.
  it("brak odpowiedzi oddaje wspoldzielona referencje stalej", () => {
    expect(parseMeetingExchange(null)).toBe(EMPTY_MEETING_EXCHANGE);
    expect(parseMeetingExchange(raw([]))).toBe(EMPTY_MEETING_EXCHANGE);
  });

  it("dwa odczyty bez licznikow dziela ten sam obiekt summary", () => {
    const first = parseMeetingExchange(raw({ event_id: "evt-1" }));
    const second = parseMeetingExchange(raw({ event_id: "evt-2" }));
    expect(first.summary).toBe(second.summary);
    expect(first.summary).toBe(EMPTY_MEETING_EXCHANGE.summary);
  });

  it("odczyt z wlasnym licznikiem nie dotyka stalej", () => {
    const parsed = parseMeetingExchange(raw({ my_meetings_summary: { accepted: 9 } }));
    expect(parsed.summary).not.toBe(EMPTY_MEETING_EXCHANGE.summary);
    expect(EMPTY_MEETING_EXCHANGE.summary.accepted).toBe(0);
  });
});

describe("exchangeIntro", () => {
  it("dla angielskiego bierze wstep angielski", () => {
    expect(exchangeIntro(exchange({ introPl: "PL", introEn: "EN" }), "en")).toBe("EN");
  });

  it("dla polskiego bierze wstep polski", () => {
    expect(exchangeIntro(exchange({ introPl: "PL", introEn: "EN" }), "pl")).toBe("PL");
  });

  it("brakujacy wstep angielski degraduje do polskiego", () => {
    expect(exchangeIntro(exchange({ introPl: "PL", introEn: "" }), "en")).toBe("PL");
  });

  it("brakujacy wstep polski degraduje do angielskiego", () => {
    expect(exchangeIntro(exchange({ introPl: "", introEn: "EN" }), "pl")).toBe("EN");
  });

  it("wstep zlozony z samych bialych znakow liczy sie jako brak", () => {
    expect(exchangeIntro(exchange({ introPl: "PL", introEn: "  \n\t " }), "en")).toBe("PL");
  });

  it("gdy oba wstepy sa puste, oddaje pusty napis", () => {
    expect(exchangeIntro(exchange({ introPl: "", introEn: "" }), "en")).toBe("");
    expect(exchangeIntro(exchange({ introPl: "", introEn: "" }), "pl")).toBe("");
  });

  it("gdy oba wstepy sa bialymi znakami, oddaje wersje zapasowa bez zmian", () => {
    expect(exchangeIntro(exchange({ introPl: " ", introEn: "  " }), "en")).toBe(" ");
  });

  it("nie przycina zwracanego wstepu", () => {
    expect(exchangeIntro(exchange({ introPl: "  PL  ", introEn: "" }), "pl")).toBe("  PL  ");
  });

  it.each([
    ["pl", "PL"],
    ["EN", "PL"],
    ["en-GB", "PL"],
    ["fr", "PL"],
    ["", "PL"],
  ])("jezyk %s inny niz dokladnie 'en' traktuje jako polski", (lang, expected) => {
    expect(exchangeIntro(exchange({ introPl: "PL", introEn: "EN" }), lang)).toBe(expected);
  });
});

describe("exchangeBlock", () => {
  it("nie blokuje uczestnika, ktory spelnia wszystkie warunki", () => {
    expect(exchangeBlock(allowed())).toBeNull();
  });

  it("gielda nieskonfigurowana blokuje przed wszystkim innym", () => {
    // Wszystkie pozostale reguly sa tu rowniez zlamane - liczy sie pierwszenstwo.
    expect(exchangeBlock(exchange())).toBe("notConfigured");
  });

  it("wylaczona gielda blokuje mimo poprawnej widocznosci", () => {
    expect(exchangeBlock(allowed({ isEnabled: false }))).toBe("disabled");
  });

  it("widocznosc 'disabled' blokuje mimo wlaczonej gieldy", () => {
    expect(exchangeBlock(allowed({ visibility: "disabled" }))).toBe("disabled");
  });

  it.each(MEETING_VISIBILITIES.filter((value) => value !== "disabled"))(
    "widocznosc %s nie jest sama w sobie blokada",
    (value) => {
      expect(exchangeBlock(allowed({ visibility: value }))).toBeNull();
    },
  );

  it("brak rejestracji wygrywa z zamknietymi zapisami", () => {
    // Uczestnikowi niezapisanemu nie wolno pokazac "zamkniete" - ma sie zapisac,
    // a nie czekac na otwarcie okna.
    expect(exchangeBlock(allowed({ myRegistrationId: null, openNow: false }))).toBe(
      "notRegistered",
    );
  });

  it("brak rejestracji wygrywa z brakiem uprawnien grupy", () => {
    expect(exchangeBlock(allowed({ myRegistrationId: null, canMeet: false }))).toBe(
      "notRegistered",
    );
  });

  it("pusty identyfikator rejestracji nie jest brakiem rejestracji", () => {
    // Parser oddaje `null` dla pustego napisu, wiec pusty napis dochodzacy
    // z innego zrodla nadal przechodzi dalej - reguly patrza wylacznie na null.
    expect(exchangeBlock(allowed({ myRegistrationId: "" }))).toBeNull();
  });

  it("grupa bez prawa do spotkan blokuje mimo otwartych zapisow", () => {
    expect(exchangeBlock(allowed({ canMeet: false }))).toBe("notAllowed");
  });

  it("brak uprawnien grupy wygrywa z zamknietymi zapisami", () => {
    expect(exchangeBlock(allowed({ canMeet: false, openNow: false }))).toBe("notAllowed");
  });

  it("zamkniete zapisy blokuja uprawnionego i zapisanego uczestnika", () => {
    expect(exchangeBlock(allowed({ openNow: false }))).toBe("closed");
  });

  it("wylaczona gielda wygrywa z brakiem rejestracji", () => {
    expect(exchangeBlock(allowed({ isEnabled: false, myRegistrationId: null }))).toBe("disabled");
  });

  it("stan swiezo sparsowanej pustej odpowiedzi jest nieskonfigurowany", () => {
    expect(exchangeBlock(parseMeetingExchange(null))).toBe("notConfigured");
  });

  it("kompletna odpowiedz RPC z otwartymi zapisami nie blokuje", () => {
    expect(exchangeBlock(parseMeetingExchange(raw(fullRaw())))).toBeNull();
  });
});
