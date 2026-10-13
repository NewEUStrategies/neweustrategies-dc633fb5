// Formularze studia, które edytują CHWILE jednego wydarzenia - „Informacje
// ogólne", „Ustawienia rejestracji", okno naboru, przyjęcie zgłoszenia z planem,
// klon edycji i harmonogram reklamy strony głównej - liczą zegar w STREFIE
// WYDARZENIA, nie przeglądarki (klasa OPS-15, X6).
//
// DEFEKT. Te ekrany trzymały w szkicu chwilę ISO, a kalendarz
// (`DateTimePicker`) pokazywał ją i składał z powrotem w strefie PRZEGLĄDARKI.
// Kreator (`EventCreateForm`) zapisuje od B3 godzinę wpisaną w strefie
// wydarzenia, więc organizator z Londynu widział na „Informacjach ogólnych"
// kongres warszawski godzinę wcześniej niż w kreatorze, a godzina wpisana tu
// liczyła się w jego strefie („nabór do 23:59" zamykał zgłoszenia o 00:59
// czasu kongresu).
//
// CAŁY PLIK BIEGNIE PRZY `TZ=Europe/London` dla wydarzenia w `Europe/Warsaw`
// (kanarek niżej to sprawdza). Noce zmiany czasu 2026 i oczekiwane chwile -
// jak w `eventLocalInputZone.test.ts` (reguła Postgresa: luka przesuwa
// godzinę do przodu, zakładka bierze DRUGIE wystąpienie):
//   * 29.03 - w Warszawie nie ma 02:00-02:59; „02:30" to 01:30Z (03:30 CEST);
//   * 25.10 - w Warszawie 02:00-02:59 wypada dwa razy; „02:30" to 01:30Z
//     (drugie, CET), pierwsze wystąpienie to 00:30Z (CEST).
//
// REGUŁA ZMIANY STREFY NA „INFORMACJACH OGÓLNYCH": chwile zostają, godziny
// w polach się przeliczają (`eventGeneralWithTimeZone`; uzasadnienie
// w nagłówku `eventGeneralDraft.ts`). Klon - odwrotnie: zostaje godzina, bo
// klon przesuwa cały program o różnicę zegarów lokalnych.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  eventGeneralDirty,
  eventGeneralDraftFromRow,
  eventGeneralInstant,
  eventGeneralPayload,
  eventGeneralWarnings,
  eventGeneralWithTimeZone,
  validateEventGeneralDraft,
} from "@/lib/events/eventGeneralDraft";
import {
  registrationOpensInstant,
  registrationSettingsDirty,
  registrationSettingsDraftFromRow,
  registrationSettingsPayload,
} from "@/lib/events/registrationSettingsDraft";
import {
  cfpSettingsDraftFromSettings,
  cfpSettingsPayload,
  validateCfpSettingsDraft,
} from "@/lib/events/cfpSettingsDraft";
import { cfpAcceptDraftFrom, cfpAcceptIssue, cfpAcceptPayload } from "@/lib/events/cfpReviewDraft";
import { parseCfpSettings } from "@/lib/events/cfpSurface";
import {
  cloneDraftFromPreview,
  cloneDraftInstant,
  cloneDraftToInput,
  eventCloneIssue,
} from "@/lib/events/eventCloneDraft";
import { homeAdDraftFromRow, homeAdInputFromDraft } from "@/lib/events/homeAdDraft";
import { validateHomeAd, type EventHomeAdRow } from "@/lib/events/sponsorBoardApi";
import { clonePreview, CLONE_SOURCE_ID } from "@/test/events/eventCloneFixtures";

const ORIGINAL_TZ = process.env.TZ;
const WARSZAWA = "Europe/Warsaw";
const LONDYN = "Europe/London";
const NOWY_JORK = "America/New_York";
const EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeAll(() => {
  process.env.TZ = LONDYN;
});

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("kanarek strefy maszyny", () => {
  it("maszyna jest naprawdę w Londynie - dawny kalendarz pokazałby godzinę londyńską", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(LONDYN);
    // `DateTimePicker` czytał `new Date(iso).getHours()`: 07:30Z to tu 08:30,
    // a w Warszawie 09:30. Oczekiwania niżej są różne od tej wartości.
    expect(new Date("2026-09-14T07:30:00.000Z").getHours()).toBe(8);
  });
});

// ------------------------------------------------------- Informacje ogólne

/** Wiersz `admin_event_detail` w części czytanej przez szkic terminu. */
function generalRow(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_type_id: "type-1",
    title_pl: "Kongres",
    title_en: "Congress",
    slug: "kongres-2026",
    // PostgREST oddaje `timestamptz` z `+00:00`, a `ends_at` - z ułamkiem sekundy.
    starts_at: "2026-09-14T07:30:00+00:00",
    ends_at: "2026-09-15T15:59:59.5+00:00",
    timezone: WARSZAWA,
    format: "online",
    languages: ["pl"],
    ...patch,
  };
}

describe("Informacje ogólne - termin w strefie wydarzenia", () => {
  it("wiersz z bazy daje zegar WARSZAWY, nie Londynu (przeglądarki)", () => {
    const draft = eventGeneralDraftFromRow(generalRow());
    expect(draft.startsAt).toBe("2026-09-14T09:30");
    expect(draft.endsAt).toBe("2026-09-15T17:59");
  });

  it("nietknięty zapis oddaje chwile z bazy co do milisekundy", () => {
    const draft = eventGeneralDraftFromRow(generalRow());
    const payload = eventGeneralPayload(EVENT, draft);
    expect(payload["starts_at"]).toBe("2026-09-14T07:30:00.000Z");
    // Pole pokazuje 17:59, a do bazy wraca 15:59:59.500Z - nie 15:59:00.
    expect(payload["ends_at"]).toBe("2026-09-15T15:59:59.500Z");
    expect(eventGeneralDirty(draft, eventGeneralDraftFromRow(generalRow()))).toBe(false);
  });

  it("godzina wpisana w polu jest godziną Warszawy, nie Londynu", () => {
    const draft = { ...eventGeneralDraftFromRow(generalRow()), startsAt: "2026-09-14T10:00" };
    // 10:00 CEST = 08:00Z; dawna konwersja (strefa maszyny) dałaby 09:00Z.
    expect(eventGeneralPayload(EVENT, draft)["starts_at"]).toBe("2026-09-14T08:00:00.000Z");
  });

  it("wiosenna luka: 02:30 29.03 zapisuje się jako 03:30 CEST", () => {
    const draft = {
      ...eventGeneralDraftFromRow(generalRow({ ends_at: null })),
      startsAt: "2026-03-29T02:30",
    };
    expect(eventGeneralInstant(draft, "startsAt")).toBe("2026-03-29T01:30:00.000Z");
  });

  it("jesienna zakładka: wpisane 02:30 25.10 to DRUGIE wystąpienie (CET)", () => {
    const draft = {
      ...eventGeneralDraftFromRow(generalRow({ ends_at: null })),
      startsAt: "2026-10-25T02:30",
    };
    expect(eventGeneralInstant(draft, "startsAt")).toBe("2026-10-25T01:30:00.000Z");
  });

  it("jesienna zakładka: PIERWSZE wystąpienie z bazy przeżywa nietknięty zapis", () => {
    const draft = eventGeneralDraftFromRow(
      generalRow({ starts_at: "2026-10-25T00:30:00+00:00", ends_at: null }),
    );
    expect(draft.startsAt).toBe("2026-10-25T02:30");
    expect(eventGeneralPayload(EVENT, draft)["starts_at"]).toBe("2026-10-25T00:30:00.000Z");
  });

  it("kolejność i długość liczą się na CHWILACH strefy wydarzenia", () => {
    // Początek: pierwsze 02:30 (00:30Z, z bazy); koniec: wpisane 02:15, czyli
    // DRUGIE wystąpienie (01:15Z) - późniejsze, choć napis jest „wcześniejszy".
    const base = eventGeneralDraftFromRow(
      generalRow({ starts_at: "2026-10-25T00:30:00+00:00", ends_at: null }),
    );
    expect(validateEventGeneralDraft({ ...base, endsAt: "2026-10-25T02:15" })).toEqual([]);
    expect(
      validateEventGeneralDraft({ ...base, endsAt: "2026-10-25T00:30" }).map((e) => e.field),
    ).toEqual(["endsAt"]);
    expect(eventGeneralWarnings({ ...base, endsAt: "2026-11-25T02:30" })).toContain(
      "adminEvents.general.warnings.veryLong",
    );
  });
});

describe("Informacje ogólne - zmiana strefy zostawia CHWILE, przelicza godziny", () => {
  it("Warszawa -> Londyn: pola pokazują te same chwile po londyńsku, ładunek ich nie rusza", () => {
    const saved = eventGeneralDraftFromRow(generalRow());
    const moved = eventGeneralWithTimeZone(saved, LONDYN);
    expect(moved.timezone).toBe(LONDYN);
    expect(moved.startsAt).toBe("2026-09-14T08:30");
    expect(moved.endsAt).toBe("2026-09-15T16:59");
    const payload = eventGeneralPayload(EVENT, moved);
    expect(payload["starts_at"]).toBe("2026-09-14T07:30:00.000Z");
    expect(payload["ends_at"]).toBe("2026-09-15T15:59:59.500Z");
    expect(payload["timezone"]).toBe(LONDYN);
    expect(eventGeneralDirty(moved, saved)).toBe(true);
  });

  it("powrót do poprzedniej strefy oddaje dokładnie poprzednie pola - szkic nie jest brudny", () => {
    const saved = eventGeneralDraftFromRow(generalRow());
    const back = eventGeneralWithTimeZone(eventGeneralWithTimeZone(saved, LONDYN), WARSZAWA);
    expect(back.startsAt).toBe(saved.startsAt);
    expect(back.endsAt).toBe(saved.endsAt);
    expect(eventGeneralDirty(back, saved)).toBe(false);
  });

  it("godzina zmieniona przed zmianą strefy liczy się w strefie, w której ją wpisano", () => {
    const saved = eventGeneralDraftFromRow(generalRow());
    const moved = eventGeneralWithTimeZone({ ...saved, startsAt: "2026-09-14T10:00" }, LONDYN);
    expect(moved.startsAt).toBe("2026-09-14T09:00");
    expect(eventGeneralPayload(EVENT, moved)["starts_at"]).toBe("2026-09-14T08:00:00.000Z");
  });

  it("chwila wypadająca w nowej strefie na PIERWSZE wystąpienie godziny nie przeskakuje o godzinę", () => {
    // 06:30 w Warszawie 1.11.2026 (CET) = 05:30Z = 01:30 EDT w Nowym Jorku,
    // czyli PIERWSZE z dwóch 01:30 tamtej nocy. Bez kotwicy pole „01:30" w nowej
    // strefie dałoby drugie wystąpienie (06:30Z) - termin przesunąłby się o godzinę.
    const saved = eventGeneralDraftFromRow(generalRow({ ends_at: null }));
    const moved = eventGeneralWithTimeZone({ ...saved, startsAt: "2026-11-01T06:30" }, NOWY_JORK);
    expect(moved.startsAt).toBe("2026-11-01T01:30");
    expect(eventGeneralPayload(EVENT, moved)["starts_at"]).toBe("2026-11-01T05:30:00.000Z");
  });

  it("puste albo niepełne pole zostaje napisem - nie ma czego przeliczać", () => {
    const saved = eventGeneralDraftFromRow(generalRow({ ends_at: null }));
    const moved = eventGeneralWithTimeZone(saved, LONDYN);
    expect(moved.endsAt).toBe("");
    expect(eventGeneralPayload(EVENT, moved)["ends_at"]).toBe("");
  });
});

// ---------------------------------------------------- Ustawienia rejestracji

describe("Ustawienia rejestracji - otwarcie zapisów w strefie wydarzenia", () => {
  const row = (rsvp: string | null, timezone: string = WARSZAWA) => ({
    rsvp_opens_at: rsvp,
    timezone,
    registration_mode: "rsvp",
  });

  it("pole pokazuje zegar Warszawy, a nietknięty zapis oddaje chwilę z bazy z sekundami", () => {
    const draft = registrationSettingsDraftFromRow(row("2026-08-31T22:00:30+00:00"));
    expect(draft.rsvpOpensAt).toBe("2026-09-01T00:00");
    expect(registrationSettingsPayload(EVENT, draft).rsvp_opens_at).toBe(
      "2026-08-31T22:00:30.000Z",
    );
    expect(
      registrationSettingsDirty(
        draft,
        registrationSettingsDraftFromRow(row("2026-08-31T22:00:30+00:00")),
      ),
    ).toBe(false);
    // Strefy ten ekran nie zapisuje - ładunek nie ma klucza `timezone`.
    expect(registrationSettingsPayload(EVENT, draft)).not.toHaveProperty("timezone");
  });

  it("wpisana godzina jest godziną Warszawy; luka 29.03 i zakładka 25.10 jak w bazie", () => {
    const draft = registrationSettingsDraftFromRow(row(null));
    expect(registrationOpensInstant({ ...draft, rsvpOpensAt: "2026-09-01T09:00" })).toBe(
      "2026-09-01T07:00:00.000Z",
    );
    expect(registrationOpensInstant({ ...draft, rsvpOpensAt: "2026-03-29T02:30" })).toBe(
      "2026-03-29T01:30:00.000Z",
    );
    expect(registrationOpensInstant({ ...draft, rsvpOpensAt: "2026-10-25T02:30" })).toBe(
      "2026-10-25T01:30:00.000Z",
    );
  });

  it("po zmianie strefy na „Informacjach ogólnych” pole pokazuje TĘ SAMĄ chwilę w nowej strefie", () => {
    const draft = registrationSettingsDraftFromRow(row("2026-08-31T22:00:00+00:00", LONDYN));
    expect(draft.rsvpOpensAt).toBe("2026-08-31T23:00");
    expect(registrationSettingsPayload(EVENT, draft).rsvp_opens_at).toBe(
      "2026-08-31T22:00:00.000Z",
    );
  });
});

// ----------------------------------------------------------------- Nabór

describe("Okno naboru - zegar strefy wydarzenia", () => {
  const settings = (opens: string | null, closes: string | null) =>
    parseCfpSettings({ event_timezone: WARSZAWA, opens_at: opens, closes_at: closes });

  it("„do 23:59” to 23:59 w Warszawie, a nietknięte pole wraca z sekundami", () => {
    const draft = cfpSettingsDraftFromSettings(
      settings("2026-09-01T08:00:00+00:00", "2026-09-30T21:59:59+00:00"),
    );
    expect(draft.opensAt).toBe("2026-09-01T10:00");
    expect(draft.closesAt).toBe("2026-09-30T23:59");
    const payload = cfpSettingsPayload(EVENT, draft);
    expect(payload.opensAt).toBe("2026-09-01T08:00:00.000Z");
    expect(payload.closesAt).toBe("2026-09-30T21:59:59.000Z");
  });

  it("godzina wpisana jest godziną Warszawy; zakładka 25.10 bierze drugie wystąpienie", () => {
    const draft = cfpSettingsDraftFromSettings(settings(null, null));
    expect(cfpSettingsPayload(EVENT, { ...draft, closesAt: "2026-09-30T23:59" }).closesAt).toBe(
      "2026-09-30T21:59:00.000Z",
    );
    expect(cfpSettingsPayload(EVENT, { ...draft, closesAt: "2026-10-25T02:30" }).closesAt).toBe(
      "2026-10-25T01:30:00.000Z",
    );
  });

  it("kolejność okna to porządek chwil w strefie wydarzenia", () => {
    // Otwarcie: pierwsze 02:30 (z bazy, 00:30Z); termin: wpisane 02:15 =
    // drugie wystąpienie (01:15Z) - PO otwarciu, choć napis jest wcześniejszy.
    const draft = cfpSettingsDraftFromSettings(settings("2026-10-25T00:30:00+00:00", null));
    expect(validateCfpSettingsDraft({ ...draft, closesAt: "2026-10-25T02:15" })).toEqual([]);
  });
});

describe("Przyjęcie zgłoszenia z planem - termin sesji w strefie wydarzenia", () => {
  const base = cfpAcceptDraftFrom({
    decisionNote: "",
    feedbackToSpeaker: "",
    trackId: null,
    timeZone: WARSZAWA,
  });

  it("09:00-09:30 to godziny programu w Warszawie, nie w Londynie", () => {
    const payload = cfpAcceptPayload("s1", {
      ...base,
      schedule: true,
      startsAt: "2026-10-01T09:00",
      endsAt: "2026-10-01T09:30",
    });
    expect(payload.schedule).toMatchObject({
      startsAt: "2026-10-01T07:00:00.000Z",
      endsAt: "2026-10-01T07:30:00.000Z",
    });
  });

  it("sesja przez noc zmiany czasu liczy długość na chwilach", () => {
    // 01:30 CEST (23:30Z) -> 02:30 drugie (01:30Z): dwie godziny, w porządku.
    const overnight = {
      ...base,
      schedule: true,
      startsAt: "2026-10-25T01:30",
      endsAt: "2026-10-25T02:30",
    };
    expect(cfpAcceptIssue(overnight)).toBeNull();
    expect(cfpAcceptPayload("s1", overnight).schedule).toMatchObject({
      startsAt: "2026-10-24T23:30:00.000Z",
      endsAt: "2026-10-25T01:30:00.000Z",
    });
  });
});

// ------------------------------------------------------------------- Klon

describe("Klon edycji - termin w strefie nowej edycji", () => {
  // Podpowiedź z bazy: ta sama godzina lokalna rok później (09:00 w Warszawie,
  // 15.06.2027 to CEST), z sekundami źródła.
  const preview = () => {
    const base = clonePreview();
    return clonePreview({
      target: { ...base.target, suggestedStartsAt: "2027-06-15T07:00:30.000Z" },
    });
  };
  const plain = { id: CLONE_SOURCE_ID, externalMode: false, externalUrl: null };

  it("podpowiedź jest zegarem Warszawy, a nietknięta wraca z sekundami", () => {
    const draft = cloneDraftFromPreview(preview());
    expect(draft.startsAt).toBe("2027-06-15T09:00");
    expect(draft.codeSuffix).toBe("-2027");
    expect(cloneDraftToInput(plain, draft).startsAt).toBe("2027-06-15T07:00:30.000Z");
  });

  it("zmiana strefy zostawia GODZINĘ i przelicza chwilę (jak klon przesuwa program)", () => {
    const draft = { ...cloneDraftFromPreview(preview()), timezone: LONDYN };
    expect(draft.startsAt).toBe("2027-06-15T09:00");
    // 09:00 BST = 08:00Z; dawny szkic z chwilą ISO wysłałby wciąż 07:00:30Z.
    expect(cloneDraftToInput(plain, draft).startsAt).toBe("2027-06-15T08:00:00.000Z");
  });

  it("koniec i kolejność liczą się na chwilach strefy edycji; rail formatuje tę chwilę", () => {
    const draft = cloneDraftFromPreview(preview());
    expect(eventCloneIssue({ ...draft, endsAt: "2027-06-15T09:00" }, false)).toBe(
      "adminEventClone.issues.endsAt",
    );
    expect(cloneDraftToInput(plain, { ...draft, endsAt: "2027-06-16T18:00" }).endsAt).toBe(
      "2027-06-16T16:00:00.000Z",
    );
    expect(cloneDraftInstant({ ...draft, startsAt: "2027-03-28T02:30" }, "startsAt")).toBe(
      "2027-03-28T01:30:00.000Z",
    );
  });
});

// ------------------------------------------------- Reklama strony głównej

describe("Reklama strony głównej - harmonogram w strefie wydarzenia", () => {
  const row = (startsAt: string, endsAt: string): EventHomeAdRow => ({
    id: "ad1",
    image_url: "https://cdn.example.org/a.webp",
    image_mobile_url: "",
    link_url: "",
    alt_text: "",
    group_ids: [],
    starts_at: startsAt,
    ends_at: endsAt,
    is_active: true,
    views: 0,
    clicks: 0,
    sort_order: 0,
    sponsor_id: "",
    sponsor_name: "",
  });

  it("wiersz daje zegar Warszawy, a nietknięty zapis oddaje chwile z bazy z sekundami", () => {
    const draft = homeAdDraftFromRow(
      EVENT,
      row("2026-09-01T06:00:00+00:00", "2026-09-07T21:59:59+00:00"),
      WARSZAWA,
    );
    expect(draft.startsAt).toBe("2026-09-01T08:00");
    expect(draft.endsAt).toBe("2026-09-07T23:59");
    const input = homeAdInputFromDraft(draft);
    expect(input.startsAt).toBe("2026-09-01T06:00:00.000Z");
    expect(input.endsAt).toBe("2026-09-07T21:59:59.000Z");
    // Kontekst strefy nie trafia do wejścia zapisu.
    expect(input).not.toHaveProperty("timeZone");
    expect(input).not.toHaveProperty("savedTimes");
  });

  it("wpisana godzina to Warszawa; zakładka 25.10 bierze drugie wystąpienie; puste = bez granicy", () => {
    const draft = homeAdDraftFromRow(EVENT, null, WARSZAWA);
    const input = homeAdInputFromDraft({
      ...draft,
      startsAt: "2026-10-24T09:00",
      endsAt: "2026-10-25T02:30",
    });
    expect(input.startsAt).toBe("2026-10-24T07:00:00.000Z");
    expect(input.endsAt).toBe("2026-10-25T01:30:00.000Z");
    expect(homeAdInputFromDraft(draft)).toMatchObject({ startsAt: "", endsAt: "" });
  });

  it("walidacja kolejności widzi chwile, które pójdą do bazy", () => {
    const draft = homeAdDraftFromRow(
      EVENT,
      row("2026-09-01T06:00:00+00:00", "2026-09-07T21:59:59+00:00"),
      WARSZAWA,
    );
    // Koniec przestawiony na 08:00 w Warszawie = początek z bazy (06:00Z).
    expect(validateHomeAd(homeAdInputFromDraft({ ...draft, endsAt: "2026-09-01T08:00" }))).toEqual([
      "endsAt",
    ]);
    expect(validateHomeAd(homeAdInputFromDraft({ ...draft, endsAt: "2026-09-01T08:01" }))).toEqual(
      [],
    );
  });
});
