// Okno ważności KODU WYDARZENIA (dostęp, rabat, odsłonięcie biletów) - zegar
// w STREFIE WYDARZENIA, nie przeglądarki (F12/F15, klasa OPS-15).
//
// DEFEKT. `eventCodeRowToDraft` wycinał z chwili bazy zegar UTC
// (`iso.slice(0, 16)`), a `eventCodeDraftToPayload` czytał go jako czas
// PRZEGLĄDARKI (`new Date(napis)`). Zapis bez dotykania dat przesuwał okno
// o przesunięcie strefy przeglądarki - w Warszawie latem o 2 h na zapis,
// w Londynie o 1 h - i błąd narastał z każdym zapisem. Baza egzekwuje to okno
// (`redeem`/`validate`: `now() < valid_from`, `now() > valid_until`), więc kod
// otwierał się i zamykał o złej godzinie.
//
// CAŁY PLIK BIEGNIE PRZY `TZ=Europe/London` dla wydarzenia w `Europe/Warsaw`
// (kanarek niżej to sprawdza): dopiero rozjazd strefy maszyny i strefy
// wydarzenia pokazuje, czyja godzina trafia do bazy. Noce zmiany czasu 2026
// i oczekiwane chwile - jak w `eventLocalInputZone.test.ts` (reguła Postgresa:
// luka przesuwa godzinę do przodu, zakładka bierze DRUGIE wystąpienie).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  emptyEventCodeDraft,
  eventCodeDraftInstant,
  eventCodeDraftIssue,
  eventCodeDraftToPayload,
  eventCodeRowToDraft,
  type EventCodeDraft,
  type EventCodeRow,
} from "@/lib/events/eventCodesApi";

const ORIGINAL_TZ = process.env.TZ;
const WARSZAWA = "Europe/Warsaw";
const LONDYN = "Europe/London";

beforeAll(() => {
  process.env.TZ = LONDYN;
});

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

/** Wiersz kodu tak, jak oddaje go PostgREST: `timestamptz` w UTC z `+00:00`. */
const row = (validFrom: string | null, validUntil: string | null): EventCodeRow => ({
  id: "c1",
  code: "VIP10",
  name: null,
  description: null,
  active: true,
  appliesDiscount: true,
  revealsHidden: false,
  discountKind: "percent",
  discountPercent: 10,
  discountCents: null,
  currency: null,
  maxRedemptions: null,
  redemptionsCount: 0,
  validFrom,
  validUntil,
  ticketTypeIds: [],
  // Reguła kumulacji (TIX-13a) nie dotyczy okna ważności; `null` = baza bez kolumn.
  stacking: null,
});

/** Payload -> wiersz, jak po zapisie i ponownym odczycie przez PostgREST. */
const reread = (previous: EventCodeRow, payload: ReturnType<typeof eventCodeDraftToPayload>) => {
  const pg = (iso: string | null) => (iso === null ? null : iso.replace(".000Z", "+00:00"));
  return { ...previous, validFrom: pg(payload.valid_from), validUntil: pg(payload.valid_until) };
};

const draft = (patch: Partial<EventCodeDraft>): EventCodeDraft => ({
  ...emptyEventCodeDraft("PLN", WARSZAWA),
  code: "VIP10",
  amount: "10",
  ...patch,
});

describe("kanarek strefy maszyny", () => {
  it("maszyna jest w Londynie - dawny zapis czytał pole w strefie Londynu", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(LONDYN);
    // Dawna konwersja: 18:00 z pola -> 18:00 BST -> 17:00Z (19:00 w Warszawie).
    expect(new Date("2026-05-01T18:00").toISOString()).toBe("2026-05-01T17:00:00.000Z");
  });
});

describe("eventCodeRowToDraft - pola pokazują zegar Warszawy", () => {
  it("lato (CEST, UTC+2): 08:00Z-16:00Z to 10:00-18:00 w polach", () => {
    const d = eventCodeRowToDraft(
      row("2026-05-01T08:00:00+00:00", "2026-05-10T16:00:00+00:00"),
      WARSZAWA,
    );
    expect(d.timeZone).toBe(WARSZAWA);
    expect(d.validFrom).toBe("2026-05-01T10:00");
    expect(d.validUntil).toBe("2026-05-10T18:00");
    expect(d.savedTimes).toEqual({
      validFrom: "2026-05-01T08:00:00.000Z",
      validUntil: "2026-05-10T16:00:00.000Z",
    });
  });

  it("zima (CET, UTC+1): 17:00Z to 18:00 w polu", () => {
    expect(eventCodeRowToDraft(row(null, "2026-11-20T17:00:00+00:00"), WARSZAWA).validUntil).toBe(
      "2026-11-20T18:00",
    );
  });

  it("brak terminu to puste pole, a strefa nieznana Intl degraduje do strefy serwisu", () => {
    const d = eventCodeRowToDraft(row(null, null), "Mars/Olympus");
    expect(d.validFrom).toBe("");
    expect(d.validUntil).toBe("");
    expect(d.timeZone).toBe(WARSZAWA);
  });
});

describe("zapis bez dotykania dat - okno stoi w miejscu", () => {
  it("trzy kolejne zapisy oddają TE SAME bajty (dawniej 08:00Z -> 07:00Z -> 06:00Z ...)", () => {
    let current = row("2026-05-01T08:00:00+00:00", "2026-05-10T16:00:00+00:00");
    const payloads: string[] = [];
    for (let save = 0; save < 3; save += 1) {
      const payload = eventCodeDraftToPayload("ev1", eventCodeRowToDraft(current, WARSZAWA));
      payloads.push(JSON.stringify([payload.valid_from, payload.valid_until]));
      current = reread(current, payload);
    }
    expect(new Set(payloads).size).toBe(1);
    expect(JSON.parse(payloads[0] as string)).toEqual([
      "2026-05-01T08:00:00.000Z",
      "2026-05-10T16:00:00.000Z",
    ]);
  });

  it("sekundy i milisekundy z bazy przeżywają zapis (pole ich nie pokazuje)", () => {
    const p = eventCodeDraftToPayload(
      "ev1",
      eventCodeRowToDraft(row(null, "2026-11-20T22:59:59.999+00:00"), WARSZAWA),
    );
    expect(p.valid_until).toBe("2026-11-20T22:59:59.999Z");
  });

  it("PIERWSZE wystąpienie jesiennej 02:30 nie przeskakuje na drugie", () => {
    // 00:30Z = 02:30 CEST, pierwsze wystąpienie; pole pokazuje „02:30", które
    // bez pamięci chwili rozstrzygnęłoby się na drugie (01:30Z).
    const d = eventCodeRowToDraft(row("2026-10-25T00:30:00+00:00", null), WARSZAWA);
    expect(d.validFrom).toBe("2026-10-25T02:30");
    expect(eventCodeDraftToPayload("ev1", d).valid_from).toBe("2026-10-25T00:30:00.000Z");
  });
});

describe("wpisane godziny to zegar Warszawy, nie Londynu", () => {
  it("18:00 wpisane w Londynie zamyka kod o 18:00 w Warszawie (16:00Z latem, 17:00Z zimą)", () => {
    expect(
      eventCodeDraftToPayload("ev1", draft({ validUntil: "2026-05-01T18:00" })).valid_until,
    ).toBe("2026-05-01T16:00:00.000Z");
    expect(
      eventCodeDraftToPayload("ev1", draft({ validUntil: "2026-11-20T18:00" })).valid_until,
    ).toBe("2026-11-20T17:00:00.000Z");
  });

  it("LUKA 29.03: 02:30 nie istnieje w Warszawie - zapis 03:30 CEST (01:30Z)", () => {
    expect(
      eventCodeDraftToPayload("ev1", draft({ validFrom: "2026-03-29T02:30" })).valid_from,
    ).toBe("2026-03-29T01:30:00.000Z");
  });

  it("ZAKŁADKA 25.10: wpisane 02:30 to drugie wystąpienie (01:30Z)", () => {
    expect(
      eventCodeDraftToPayload("ev1", draft({ validFrom: "2026-10-25T02:30" })).valid_from,
    ).toBe("2026-10-25T01:30:00.000Z");
  });

  it("zmienione pole nie korzysta z pamięci chwili", () => {
    const d = eventCodeRowToDraft(row(null, "2026-05-10T16:00:00+00:00"), WARSZAWA);
    const changed = { ...d, validUntil: "2026-05-10T19:00" };
    expect(eventCodeDraftToPayload("ev1", changed).valid_until).toBe("2026-05-10T17:00:00.000Z");
  });

  it("puste pole to brak ograniczenia", () => {
    const p = eventCodeDraftToPayload("ev1", draft({}));
    expect(p.valid_from).toBeNull();
    expect(p.valid_until).toBeNull();
  });
});

describe("eventCodeDraftIssue - kolejność porównywana na CHWILACH", () => {
  it("od >= do to `dates`, a od < do przechodzi", () => {
    expect(
      eventCodeDraftIssue(draft({ validFrom: "2026-05-02T10:00", validUntil: "2026-05-01T10:00" })),
    ).toBe("dates");
    expect(
      eventCodeDraftIssue(draft({ validFrom: "2026-05-01T10:00", validUntil: "2026-05-01T10:00" })),
    ).toBe("dates");
    expect(
      eventCodeDraftIssue(draft({ validFrom: "2026-05-01T10:00", validUntil: "2026-05-01T10:01" })),
    ).toBeNull();
  });

  it("zakładka: 02:59 (pierwsze, z bazy) -> 02:30 (drugie) to poprawne okno", () => {
    // Napisowo 02:30 < 02:59, ale chwilowo 02:30 CET (01:30Z) jest PO 02:59
    // CEST (00:59Z) - porównanie napisów odrzuciłoby poprawne okno.
    const d = eventCodeRowToDraft(row("2026-10-25T00:59:00+00:00", null), WARSZAWA);
    const typed = { ...d, validUntil: "2026-10-25T02:30" };
    expect(eventCodeDraftInstant(typed, "validFrom")).toBe("2026-10-25T00:59:00.000Z");
    expect(eventCodeDraftInstant(typed, "validUntil")).toBe("2026-10-25T01:30:00.000Z");
    expect(eventCodeDraftIssue(typed)).toBeNull();
  });

  it("niepełny albo nieistniejący zegar to `dates`, a nie cicho wyczyszczony termin", () => {
    expect(eventCodeDraftIssue(draft({ validFrom: "2026-05-01" }))).toBe("dates");
    expect(eventCodeDraftIssue(draft({ validUntil: "2026-02-30T10:00" }))).toBe("dates");
  });
});
