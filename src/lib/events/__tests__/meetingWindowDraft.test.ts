// Szkic okna dostepnosci - strefa pol, regula zmiany czasu i bramka zapisu.
//
// CALY PLIK BIEGNIE PRZY `TZ=Europe/London` dla wydarzenia w `Europe/Warsaw`
// (OPS-15): uczestnik z Londynu planuje kongres w Warszawie. Na maszynie CI
// (`TZ: UTC`) albo w Warszawie dawna konwersja w strefie przegladarki dawala
// wyniki wygladajace poprawnie - dopiero rozjazd strefy maszyny i strefy
// wydarzenia pokazuje, czyja godzina trafia do bazy.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MAX_WINDOW_MINUTES,
  MIN_WINDOW_MINUTES,
  NEW_WINDOW_DRAFT,
  draftFromWindow,
  hasZoneChoice,
  isoToLocalInput,
  localInputToIso,
  resolveWindowField,
  switchDraftZone,
  validateWindowDraft,
  windowInstants,
  windowPayload,
  windowZones,
  type WindowDraft,
  type WindowZones,
} from "@/lib/events/meetingWindowDraft";

const ORIGINAL_TZ = process.env.TZ;
const WARSZAWA = "Europe/Warsaw";
const LONDYN = "Europe/London";

let STREFY: WindowZones;

beforeAll(() => {
  process.env.TZ = LONDYN;
  // Strefa uczestnika z `Intl`, dokladnie tak jak na ekranie.
  STREFY = windowZones(WARSZAWA);
});

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

function draft(
  startsAtLocal: string,
  endsAtLocal: string,
  over: Partial<WindowDraft> = {},
): WindowDraft {
  return { ...NEW_WINDOW_DRAFT, startsAtLocal, endsAtLocal, ...over };
}

describe("meetingWindowDraft - strefa wydarzenia jest domyslna (OPS-15)", () => {
  it("kanarek: strefa uczestnika to naprawde Londyn, a strefa wydarzenia - Warszawa", () => {
    expect(STREFY).toEqual({ event: WARSZAWA, viewer: LONDYN });
    expect(hasZoneChoice(STREFY)).toBe(true);
    // Dawna konwersja (`new Date(napis)`) czytalaby 9:30 jako godzine londynska.
    expect(new Date("2026-09-14T09:30").toISOString()).toBe("2026-09-14T08:30:00.000Z");
  });

  it("ODBIOR OPS-15: 9:30 wpisane w Londynie dla kongresu w Warszawie zapisuje sie jako 9:30 w Warszawie", () => {
    const payload = windowPayload(draft("2026-09-14T09:30", "2026-09-14T13:00"), STREFY);
    // 09:30 CEST = 07:30 UTC. Dawna konwersja dawala 08:30 UTC, czyli 10:30
    // czasu kongresu - godzine obok slotow z siatki bazy.
    expect(payload?.startsAt).toBe("2026-09-14T07:30:00.000Z");
    expect(payload?.endsAt).toBe("2026-09-14T11:00:00.000Z");
  });

  it("nowy szkic startuje w strefie wydarzenia", () => {
    expect(NEW_WINDOW_DRAFT.inputZone).toBe("event");
  });

  it("ISO -> pole -> ISO wraca do tej samej chwili w strefie wydarzenia", () => {
    const iso = localInputToIso("2026-09-14T09:30", WARSZAWA);
    expect(iso).toBe("2026-09-14T07:30:00.000Z");
    expect(isoToLocalInput(iso, WARSZAWA)).toBe("2026-09-14T09:30");
  });

  it("odrzuca wartosc niepelna zamiast zwracac Invalid Date", () => {
    expect(localInputToIso("", WARSZAWA)).toBeNull();
    expect(localInputToIso("2026-09-14", WARSZAWA)).toBeNull();
    expect(isoToLocalInput("nie-data", WARSZAWA)).toBe("");
    expect(isoToLocalInput(null, WARSZAWA)).toBe("");
  });

  it("brak strefy wydarzenia degraduje do strefy domyslnej, nie do strefy przegladarki", () => {
    const strefy = windowZones(null);
    expect(strefy.event).toBe(WARSZAWA);
    expect(windowPayload(draft("2026-09-14T09:30", "2026-09-14T10:00"), strefy)?.startsAt).toBe(
      "2026-09-14T07:30:00.000Z",
    );
  });

  it("ta sama strefa po obu stronach nie daje wyboru", () => {
    expect(hasZoneChoice(windowZones(WARSZAWA, WARSZAWA))).toBe(false);
  });
});

describe("meetingWindowDraft - przelacznik „moja strefa”", () => {
  it("w trybie `viewer` 9:30 znaczy 9:30 w Londynie", () => {
    const payload = windowPayload(
      draft("2026-09-14T09:30", "2026-09-14T13:00", { inputZone: "viewer" }),
      STREFY,
    );
    expect(payload?.startsAt).toBe("2026-09-14T08:30:00.000Z");
    expect(payload?.endsAt).toBe("2026-09-14T12:00:00.000Z");
  });

  it("przelaczenie PRZEPISUJE pola na nowa strefe, a okno zostaje ta sama chwila", () => {
    const wydarzenie = draft("2026-09-14T09:30", "2026-09-14T13:00");
    const moja = switchDraftZone(wydarzenie, "viewer", STREFY);
    expect(moja).toMatchObject({
      inputZone: "viewer",
      startsAtLocal: "2026-09-14T08:30",
      endsAtLocal: "2026-09-14T12:00",
    });
    expect(windowPayload(moja, STREFY)).toEqual(windowPayload(wydarzenie, STREFY));

    const zPowrotem = switchDraftZone(moja, "event", STREFY);
    expect(zPowrotem).toEqual(wydarzenie);
  });

  it("przelaczenie na ten sam tryb nie tworzy nowego szkicu", () => {
    const szkic = draft("2026-09-14T09:30", "2026-09-14T13:00");
    expect(switchDraftZone(szkic, "event", STREFY)).toBe(szkic);
  });

  it("pole puste albo niepelne przechodzi przez przelaczenie bez zmian", () => {
    const moja = switchDraftZone(draft("", "2026-09-14"), "viewer", STREFY);
    expect(moja.startsAtLocal).toBe("");
    expect(moja.endsAtLocal).toBe("2026-09-14");
    expect(moja.inputZone).toBe("viewer");
  });

  it("przelaczenie przez polnoc zmienia tez date pola", () => {
    const moja = switchDraftZone(draft("2026-09-15T00:30", "2026-09-15T01:30"), "viewer", STREFY);
    expect(moja.startsAtLocal).toBe("2026-09-14T23:30");
    expect(moja.endsAtLocal).toBe("2026-09-15T00:30");
  });
});

describe("meetingWindowDraft - noc zmiany czasu (ostatnia niedziela marca i pazdziernika 2026)", () => {
  it("LUKA: 02:30 29 marca nie istnieje w Warszawie - zapisujemy 03:30 CEST i mowimy o tym", () => {
    const { startsAt } = windowInstants(draft("2026-03-29T02:30", "2026-03-29T05:00"), STREFY);
    expect(startsAt).toEqual({ iso: "2026-03-29T01:30:00.000Z", resolution: "gap" });
    expect(isoToLocalInput(startsAt?.iso, WARSZAWA)).toBe("2026-03-29T03:30");
  });

  it("ZAKLADKA: 02:30 25 pazdziernika wypada dwa razy - przyjmujemy drugie (CET), jak baza", () => {
    const { startsAt } = windowInstants(draft("2026-10-25T02:30", "2026-10-25T05:00"), STREFY);
    expect(startsAt).toEqual({ iso: "2026-10-25T01:30:00.000Z", resolution: "overlap" });
  });

  it("dlugosc okna liczy sie z chwil: 01:00-04:00 w noc wiosenna trwa 2 godziny", () => {
    const wiosna = draft("2026-03-29T01:00", "2026-03-29T04:00");
    expect(validateWindowDraft(wiosna, STREFY)).toBeNull();
    const payload = windowPayload(wiosna, STREFY);
    expect(payload?.startsAt).toBe("2026-03-29T00:00:00.000Z");
    expect(payload?.endsAt).toBe("2026-03-29T02:00:00.000Z");
  });

  it("dlugosc okna liczy sie z chwil: 01:00-04:00 w noc jesienna trwa 4 godziny", () => {
    const payload = windowPayload(draft("2026-10-25T01:00", "2026-10-25T04:00"), STREFY);
    expect(payload?.startsAt).toBe("2026-10-24T23:00:00.000Z");
    expect(payload?.endsAt).toBe("2026-10-25T03:00:00.000Z");
  });

  it("00:00-16:30 w noc wiosenna (15,5 h) miesci sie w limicie 16 godzin, zwyklego dnia nie", () => {
    // Wedlug zegara to 16,5 godziny, ale zegar przeskakuje godzine - baza
    // liczy `ends_at - starts_at` z chwil, wiec okno przejdzie jej CHECK.
    expect(validateWindowDraft(draft("2026-03-29T00:00", "2026-03-29T16:30"), STREFY)).toBeNull();
    // Ten sam napis zwyklego dnia jest za dlugi.
    expect(validateWindowDraft(draft("2026-03-30T00:00", "2026-03-30T16:30"), STREFY)).toBe(
      "tooLong",
    );
  });

  it("strefa uczestnika ma te sama regule: 01:30 29 marca nie istnieje w Londynie", () => {
    const { startsAt } = windowInstants(
      draft("2026-03-29T01:30", "2026-03-29T05:00", { inputZone: "viewer" }),
      STREFY,
    );
    expect(startsAt).toEqual({ iso: "2026-03-29T01:30:00.000Z", resolution: "gap" });
  });

  it("strefa uczestnika ma te sama regule: 01:30 25 pazdziernika w Londynie to drugie wystapienie", () => {
    const { startsAt } = windowInstants(
      draft("2026-10-25T01:30", "2026-10-25T05:00", { inputZone: "viewer" }),
      STREFY,
    );
    expect(startsAt).toEqual({ iso: "2026-10-25T01:30:00.000Z", resolution: "overlap" });
  });
});

describe("meetingWindowDraft - edycja istniejacego okna", () => {
  it("z wiersza bazy robi szkic w strefie WYDARZENIA z zachowanym id, stanem i chwilami", () => {
    const result = draftFromWindow(
      {
        id: "w-1",
        startsAt: "2026-09-14T07:00:00+00:00",
        endsAt: "2026-09-14T10:00:00+00:00",
        isOpen: false,
        note: null,
      },
      STREFY,
    );
    expect(result).toEqual({
      id: "w-1",
      startsAtLocal: "2026-09-14T09:00",
      endsAtLocal: "2026-09-14T12:00",
      inputZone: "event",
      startsAtSaved: "2026-09-14T07:00:00.000Z",
      endsAtSaved: "2026-09-14T10:00:00.000Z",
      isOpen: false,
      note: "",
    });
    expect(windowPayload(result, STREFY)?.isOpen).toBe(false);
  });

  it("szkic z wiersza w trybie `viewer` ma pola w strefie uczestnika", () => {
    const result = draftFromWindow(
      {
        id: "w-1",
        startsAt: "2026-09-14T07:00:00Z",
        endsAt: "2026-09-14T10:00:00Z",
        isOpen: true,
        note: null,
      },
      STREFY,
      "viewer",
    );
    expect(result.startsAtLocal).toBe("2026-09-14T08:00");
    expect(result.inputZone).toBe("viewer");
  });

  it("NIETKNIETE pole oddaje chwile z bazy - takze PIERWSZE wystapienie godziny jesiennej nocy", () => {
    // 00:30 UTC to 02:30 CEST, czyli PIERWSZE z dwoch 02:30 w Warszawie. Sam
    // napis "02:30" regula zakladki zamienilaby na drugie (01:30 UTC) - zapis
    // samej notatki przesunalby okno o godzine.
    const result = draftFromWindow(
      {
        id: "w-9",
        startsAt: "2026-10-25T00:30:00.000Z",
        endsAt: "2026-10-25T04:00:00.000Z",
        isOpen: true,
        note: "panel",
      },
      STREFY,
    );
    expect(result.startsAtLocal).toBe("2026-10-25T02:30");
    const payload = windowPayload({ ...result, note: "panel B" }, STREFY);
    expect(payload?.startsAt).toBe("2026-10-25T00:30:00.000Z");
    expect(payload?.endsAt).toBe("2026-10-25T04:00:00.000Z");
  });

  it("NIETKNIETE pole zachowuje sekundy, ktorych pole nie pokazuje", () => {
    const result = draftFromWindow(
      {
        id: "w-2",
        startsAt: "2026-09-14T07:30:45+00:00",
        endsAt: "2026-09-14T11:00:00+00:00",
        isOpen: true,
        note: null,
      },
      STREFY,
    );
    expect(windowPayload(result, STREFY)?.startsAt).toBe("2026-09-14T07:30:45.000Z");
  });

  it("nietkniete pole przezywa przelaczenie strefy w obie strony", () => {
    const result = draftFromWindow(
      {
        id: "w-9",
        startsAt: "2026-10-25T00:30:00.000Z",
        endsAt: "2026-10-25T04:00:00.000Z",
        isOpen: true,
        note: null,
      },
      STREFY,
    );
    const tam = switchDraftZone(result, "viewer", STREFY);
    expect(windowPayload(tam, STREFY)?.startsAt).toBe("2026-10-25T00:30:00.000Z");
    const zPowrotem = switchDraftZone(tam, "event", STREFY);
    expect(windowPayload(zPowrotem, STREFY)?.startsAt).toBe("2026-10-25T00:30:00.000Z");
  });

  it("ZMIENIONE pole idzie przez konwersje, a nie przez chwile z bazy", () => {
    const result = draftFromWindow(
      {
        id: "w-2",
        startsAt: "2026-09-14T07:30:45+00:00",
        endsAt: "2026-09-14T11:00:00+00:00",
        isOpen: true,
        note: null,
      },
      STREFY,
    );
    const payload = windowPayload({ ...result, startsAtLocal: "2026-09-14T10:00" }, STREFY);
    expect(payload?.startsAt).toBe("2026-09-14T08:00:00.000Z");
    expect(resolveWindowField("2026-09-14T10:00", result.startsAtSaved, WARSZAWA)).toEqual({
      iso: "2026-09-14T08:00:00.000Z",
      resolution: "exact",
    });
  });
});

describe("meetingWindowDraft - bramka zapisu", () => {
  it("nie przepuszcza okna konczacego sie przed poczatkiem", () => {
    expect(validateWindowDraft(draft("2026-09-14T11:00", "2026-09-14T10:00"), STREFY)).toBe(
      "order",
    );
    expect(validateWindowDraft(draft("2026-09-14T10:00", "2026-09-14T10:00"), STREFY)).toBe(
      "order",
    );
  });

  it("pilnuje granic dlugosci z migracji", () => {
    expect(validateWindowDraft(draft("2026-09-14T10:00", "2026-09-14T10:10"), STREFY)).toBe(
      "tooShort",
    );
    expect(validateWindowDraft(draft("2026-09-14T10:00", "2026-09-15T10:00"), STREFY)).toBe(
      "tooLong",
    );
    expect(validateWindowDraft(draft("2026-09-14T10:00", "2026-09-14T10:15"), STREFY)).toBeNull();
    expect(MIN_WINDOW_MINUTES).toBe(15);
    expect(MAX_WINDOW_MINUTES).toBe(960);
  });

  it("zglasza brak danych, a nie falszywy blad zakresu", () => {
    expect(validateWindowDraft(NEW_WINDOW_DRAFT, STREFY)).toBe("incomplete");
    expect(windowPayload(NEW_WINDOW_DRAFT, STREFY)).toBeNull();
  });

  it("zamienia pusta notatke na null, a nie na pusty napis", () => {
    const payload = windowPayload(
      draft("2026-09-14T10:00", "2026-09-14T11:00", { note: "   " }),
      STREFY,
    );
    expect(payload?.note).toBeNull();
    const withNote = windowPayload(
      draft("2026-09-14T10:00", "2026-09-14T11:00", { note: " panel " }),
      STREFY,
    );
    expect(withNote?.note).toBe("panel");
  });

  it("odrzuca zbyt dluga notatke", () => {
    expect(
      validateWindowDraft(
        draft("2026-09-14T10:00", "2026-09-14T11:00", { note: "x".repeat(301) }),
        STREFY,
      ),
    ).toBe("noteTooLong");
  });
});
