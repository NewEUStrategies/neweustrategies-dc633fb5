// Okno dostępności giełdy i formularze panelu mają JEDNĄ regułę „nietkniętego
// pola" (przekazanie B3): `resolveWindowField` woła `resolveEventLocalInput`
// z `lib/events/eventLocalInput.ts`, zamiast trzymać jej kopię.
//
// DLACZEGO TEST NA WYWOŁANIE, A NIE TYLKO NA WYNIK. Dwie kopie dawały dziś te
// same chwile - i właśnie dlatego rozjechałyby się po cichu przy pierwszej
// poprawce jednej z nich. Szpieg na wspólnej funkcji czerwienieje, gdy kopia
// wróci; tabela niżej pilnuje, że delegacja niczego nie zmieniła w wyniku.
//
// Plik biegnie przy `TZ=Europe/London` dla wydarzenia w `Europe/Warsaw`, jak
// pozostałe testy strefy wydarzenia.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock("@/lib/events/eventLocalInput", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/events/eventLocalInput")>();
  return {
    ...actual,
    resolveEventLocalInput: (...args: Parameters<typeof actual.resolveEventLocalInput>) => {
      h.calls.push(args);
      return actual.resolveEventLocalInput(...args);
    },
  };
});

import { resolveEventLocalInput } from "@/lib/events/eventLocalInput";
import {
  draftFromWindow,
  resolveWindowField,
  windowInstants,
  windowZones,
} from "@/lib/events/meetingWindowDraft";

const ORIGINAL_TZ = process.env.TZ;
const WARSZAWA = "Europe/Warsaw";

beforeAll(() => {
  process.env.TZ = "Europe/London";
});

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

beforeEach(() => {
  h.calls = [];
});

describe("resolveWindowField deleguje do resolveEventLocalInput", () => {
  it("woła wspólną funkcję z (napis, strefa, chwila z bazy)", () => {
    resolveWindowField("2026-09-14T10:00", "2026-09-14T08:00:00.000Z", WARSZAWA);
    expect(h.calls).toEqual([["2026-09-14T10:00", WARSZAWA, "2026-09-14T08:00:00.000Z"]]);
  });

  it("szkic okna liczy chwile tą samą drogą (start i koniec)", () => {
    const zones = windowZones(WARSZAWA, "Europe/London");
    const draft = draftFromWindow(
      {
        id: "w1",
        startsAt: "2026-09-14T07:30:00+00:00",
        endsAt: "2026-09-14T09:00:00+00:00",
        isOpen: true,
        note: null,
      },
      zones,
    );
    const instants = windowInstants(draft, zones);
    expect(h.calls).toHaveLength(2);
    expect(instants.startsAt).toEqual({ iso: "2026-09-14T07:30:00.000Z", resolution: "exact" });
    expect(draft.startsAtSaved).toBe("2026-09-14T07:30:00.000Z");
  });
});

describe("delegacja nie zmienia wyniku", () => {
  it.each<[string, string, string | null]>([
    ["zwykla godzina", "2026-09-14T10:00", null],
    ["nietkniete pole z sekundami", "2026-09-14T10:59", "2026-09-14T08:59:59.500Z"],
    ["pierwsze wystapienie jesiennej 02:30", "2026-10-25T02:30", "2026-10-25T00:30:00.000Z"],
    ["drugie wystapienie bez pamieci", "2026-10-25T02:30", null],
    ["wiosenna luka", "2026-03-29T02:30", null],
    ["pole zmienione", "2026-09-14T11:00", "2026-09-14T08:59:59.500Z"],
    ["spacje wokol napisu", "  2026-09-14T10:59 ", "2026-09-14T08:59:59.500Z"],
    ["puste pole", "", "2026-09-14T08:59:59.500Z"],
    ["niepelna data", "2026-09-14", null],
    ["zla chwila z bazy", "2026-09-14T10:00", "nie-data"],
  ])("%s", (_nazwa, value, saved) => {
    expect(resolveWindowField(value, saved, WARSZAWA)).toEqual(
      resolveEventLocalInput(value, WARSZAWA, saved),
    );
  });
});
