// Treść przypomnień F2: parser partii `_event_reminders_claim`, mail o
// wydarzeniu i o sesji (kontrakt wierszy B.8), adres przycisku, SMS w GSM-7.
//
// STAWKI: (1) wiersze szczegółów to DOKŁADNIE etykiety z
// `PARTICIPANT_TX_DETAIL_LABELS`, w tej kolejności - inaczej mail mówi co innego
// niż podgląd w panelu; (2) uszkodzony, ale zarezerwowany wiersz wraca jako
// identyfikator do zamknięcia, nie znika; (3) SMS mieści się w jednym
// segmencie GSM-7 nawet przy długim tytule z polskimi znakami.
import { describe, expect, it } from "vitest";

import { PARTICIPANT_TX_DETAIL_LABELS, txCopy } from "@/lib/email-templates/tx-copy";
import { gsm7Septets, isGsm7 } from "@/lib/events/gsm7";
import {
  buildReminderEmail,
  buildReminderSms,
  parseReminderClaims,
  reminderCtaPath,
  reminderIdempotencyKey,
  reminderMoment,
  reminderPlace,
  type ReminderClaim,
} from "@/lib/events/reminderNotice.server";

const DELIVERY = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";
const REGISTRATION = "44444444-4444-4444-8444-444444444444";
const SESSION = "55555555-5555-4555-8555-555555555555";
const STARTS = "2030-06-10T16:00:00Z";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    delivery_id: DELIVERY,
    kind: "event_reminder",
    channel: "email",
    dedupe_key: `er:${REGISTRATION}:email:60:1907164800`,
    tenant_id: TENANT,
    event_id: EVENT,
    registration_id: REGISTRATION,
    session_id: null,
    lead_minutes: 60,
    starts_at: STARTS,
    lang: "pl",
    email: "anna@example.org",
    phone: null,
    first_name: "Anna",
    event_slug: "kongres-2030",
    event_title_pl: "Kongres Strategii",
    event_title_en: "Strategy Congress",
    event_timezone: "Europe/Warsaw",
    event_location: "Centrum Konferencyjne",
    event_format: "onsite",
    event_street_address: "ul. Prosta 1",
    event_postal_code: "00-001",
    event_city: "Warszawa",
    event_country: null,
    session_title_pl: null,
    session_title_en: null,
    room_name: null,
    ...overrides,
  };
}

function claim(overrides: Record<string, unknown> = {}): ReminderClaim {
  const parsed = parseReminderClaims([row(overrides)]);
  expect(parsed.invalidIds).toEqual([]);
  expect(parsed.claims).toHaveLength(1);
  return parsed.claims[0]!;
}

const SESSION_ROW = {
  kind: "session_reminder",
  dedupe_key: `sr:${SESSION}:user:email:15:1907164800`,
  session_id: SESSION,
  session_title_pl: "Panel otwarcia",
  session_title_en: "Opening panel",
  room_name: "Sala Kolumnowa",
};

describe("parseReminderClaims", () => {
  it("nie-tablica i elementy nie-obiekty dają pusty wynik", () => {
    expect(parseReminderClaims(null)).toEqual({ claims: [], invalidIds: [] });
    expect(parseReminderClaims({ a: 1 })).toEqual({ claims: [], invalidIds: [] });
    expect(parseReminderClaims([1, "x", null, [row()]])).toEqual({ claims: [], invalidIds: [] });
  });

  it("pełny wiersz -> wysyłka z polami camelCase i językiem pl/en", () => {
    const c = claim({ lang: "en" });
    expect(c).toMatchObject({
      deliveryId: DELIVERY,
      kind: "event_reminder",
      channel: "email",
      tenantId: TENANT,
      eventId: EVENT,
      registrationId: REGISTRATION,
      sessionId: null,
      lang: "en",
      email: "anna@example.org",
      eventSlug: "kongres-2030",
      eventTimezone: "Europe/Warsaw",
    });
    expect(claim({ lang: "de" }).lang).toBe("pl");
  });

  it.each([
    ["rodzaj spoza katalogu", { kind: "waitlist_offer" }],
    ["kanał inapp (dzwonki wysyła baza)", { channel: "inapp" }],
    ["brak slugu", { event_slug: "" }],
    ["nieczytelny start", { starts_at: "jutro" }],
    ["zły identyfikator wydarzenia", { event_id: "abc" }],
    ["sesja bez identyfikatora sesji", { kind: "session_reminder", session_id: null }],
  ])("zarezerwowany, ale uszkodzony wiersz (%s) wraca do zamknięcia", (_label, overrides) => {
    expect(parseReminderClaims([row(overrides)])).toEqual({ claims: [], invalidIds: [DELIVERY] });
  });

  it("wiersz bez identyfikatora rezerwacji jest pomijany (nie ma czego zamknąć)", () => {
    expect(parseReminderClaims([row({ delivery_id: "x" })])).toEqual({
      claims: [],
      invalidIds: [],
    });
  });

  it("brak strefy -> Europe/Warsaw", () => {
    expect(claim({ event_timezone: null }).eventTimezone).toBe("Europe/Warsaw");
  });
});

describe("reminderPlace", () => {
  it("lokalizacja i adres w jednej linii", () => {
    expect(reminderPlace(claim())).toBe("Centrum Konferencyjne, ul. Prosta 1, 00-001 Warszawa");
  });

  it("bez powtórzeń, gdy lokalizacja zawiera adres albo odwrotnie", () => {
    expect(
      reminderPlace(
        claim({ event_location: "Centrum, ul. Prosta 1, 00-001 Warszawa", event_city: "Warszawa" }),
      ),
    ).toBe("Centrum, ul. Prosta 1, 00-001 Warszawa");
    expect(
      reminderPlace(
        claim({ event_location: "Warszawa", event_street_address: null, event_postal_code: null }),
      ),
    ).toBe("Warszawa");
  });

  it("sam adres, gdy brak lokalizacji", () => {
    expect(reminderPlace(claim({ event_location: null }))).toBe("ul. Prosta 1, 00-001 Warszawa");
  });

  it("bez lokalizacji i adresu -> Online (wiersz jest zawsze)", () => {
    expect(
      reminderPlace(
        claim({
          event_location: null,
          event_street_address: null,
          event_postal_code: null,
          event_city: null,
          event_format: "online",
        }),
      ),
    ).toBe("Online");
  });
});

describe("reminderCtaPath", () => {
  it("wydarzenie -> /events/<slug>, sesja -> zakładka planu z kotwicą sesji", () => {
    expect(reminderCtaPath(claim())).toBe("/events/kongres-2030");
    expect(reminderCtaPath(claim(SESSION_ROW))).toBe(
      `/events/kongres-2030/me?tab=schedule#event-session-${SESSION}`,
    );
  });
});

describe("reminderMoment", () => {
  it("termin w strefie wydarzenia z krótką nazwą strefy", () => {
    const moment = reminderMoment(STARTS, "Europe/Warsaw", "en");
    expect(moment).toMatch(/18:00/);
    expect(moment).toMatch(/\(.+\)$/);
    expect(reminderMoment("nie-data", "Europe/Warsaw", "pl")).toBe("");
  });
});

describe("buildReminderEmail", () => {
  it("wydarzenie: dokładnie wiersze event, date, place (kontrakt B.8)", () => {
    const email = buildReminderEmail(claim())!;
    const labels = txCopy("event_reminder", "pl").labels;
    expect(email.type).toBe("event_reminder");
    expect(email.details.map((d) => d.label)).toEqual(
      PARTICIPANT_TX_DETAIL_LABELS.event_reminder.map((key) => labels[key]),
    );
    expect(email.details[0]!.value).toBe("Kongres Strategii");
    expect(email.details[1]!.value).toBe(reminderMoment(STARTS, "Europe/Warsaw", "pl"));
    expect(email).toMatchObject({
      to: "anna@example.org",
      lang: "pl",
      subjectName: "Kongres Strategii",
      ctaPath: "/events/kongres-2030",
      metaName: "Anna",
      tenantId: TENANT,
      idempotencyKey: `event-reminder:er:${REGISTRATION}:email:60:1907164800`,
    });
  });

  it("sesja: event, session, date, room; temat = tytuł sesji w języku odbiorcy", () => {
    const email = buildReminderEmail(claim({ ...SESSION_ROW, lang: "en" }))!;
    const labels = txCopy("event_session_reminder", "en").labels;
    expect(email.type).toBe("event_session_reminder");
    expect(email.details.map((d) => d.label)).toEqual(
      PARTICIPANT_TX_DETAIL_LABELS.event_session_reminder.map((key) => labels[key]),
    );
    expect(email.details.map((d) => d.value)).toEqual([
      "Strategy Congress",
      "Opening panel",
      reminderMoment(STARTS, "Europe/Warsaw", "en"),
      "Sala Kolumnowa",
    ]);
    expect(email.subjectName).toBe("Opening panel");
  });

  it("sesja bez sali pomija wyłącznie wiersz room", () => {
    const email = buildReminderEmail(claim({ ...SESSION_ROW, room_name: null }))!;
    const labels = txCopy("event_session_reminder", "pl").labels;
    expect(email.details.map((d) => d.label)).toEqual([labels.event, labels.session, labels.date]);
  });

  it("brak tytułu w języku odbiorcy -> tytuł w drugim języku", () => {
    const email = buildReminderEmail(claim({ lang: "en", event_title_en: null }))!;
    expect(email.subjectName).toBe("Kongres Strategii");
  });

  it("brak adresu albo kanał inny niż email -> null", () => {
    expect(buildReminderEmail(claim({ email: null }))).toBeNull();
    expect(buildReminderEmail(claim({ channel: "sms", phone: "+48600100200" }))).toBeNull();
  });
});

describe("buildReminderSms", () => {
  const LONG_TITLE =
    "Międzynarodowy Kongres Strategii Europejskich: bezpieczeństwo, energia, łańcuchy dostaw i przyszłość Unii";

  it.each(["pl", "en"] as const)("jeden segment GSM-7 przy długim tytule (%s)", (lang) => {
    const body = buildReminderSms(
      claim({ channel: "sms", phone: "+48600100200", lang, event_title_pl: LONG_TITLE }),
    )!;
    expect(isGsm7(body)).toBe(true);
    expect(gsm7Septets(body)).toBeLessThanOrEqual(160);
    expect(body).toContain("10.06 18:00");
  });

  it("krótki tytuł wchodzi w całości, transliterowany", () => {
    const body = buildReminderSms(
      claim({ channel: "sms", phone: "+48600100200", event_title_pl: "Śniadanie łączności" }),
    )!;
    expect(body).toContain("Sniadanie lacznosci");
    expect(body.startsWith("NES przypomina:")).toBe(true);
  });

  it("SMS tylko o wydarzeniu i tylko dla kanału sms", () => {
    expect(buildReminderSms(claim())).toBeNull();
    expect(buildReminderSms(claim({ ...SESSION_ROW, channel: "sms" }))).toBeNull();
  });
});

describe("reminderIdempotencyKey", () => {
  it("= klucz deduplikacji dziennika z prefiksem rodziny", () => {
    expect(reminderIdempotencyKey(claim())).toBe(
      `event-reminder:er:${REGISTRATION}:email:60:1907164800`,
    );
  });
});
