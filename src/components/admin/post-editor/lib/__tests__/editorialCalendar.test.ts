import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHEDULE_HOUR,
  GRID_DAYS,
  canReschedule,
  dayKey,
  entryDate,
  gridRange,
  groupByDay,
  monthGrid,
  rescheduleTarget,
  type CalendarEntry,
} from "../editorialCalendar";

function post(over: Partial<CalendarEntry> = {}): CalendarEntry {
  return {
    id: "p1",
    status: "draft",
    published_at: null,
    publish_at: null,
    ...over,
  };
}

/** Lokalna data -> ISO, żeby fixture nie zależał od strefy środowiska testowego. */
function localIso(y: number, m: number, d: number, hh = 0, mm = 0): string {
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

describe("entryDate", () => {
  it("czyta publish_at dla wpisu zaplanowanego, a published_at dla opublikowanego", () => {
    const planned = localIso(2026, 9, 10, 14, 30);
    const actual = localIso(2026, 9, 11, 8, 0);
    expect(
      entryDate(post({ status: "scheduled", publish_at: planned, published_at: actual })),
    ).toBe(planned);
    expect(
      entryDate(post({ status: "published", publish_at: planned, published_at: actual })),
    ).toBe(actual);
  });

  it("nie daje daty szkicom ani wpisom w recenzji - te idą do backlogu, nie do siatki", () => {
    expect(entryDate(post({ status: "draft", publish_at: localIso(2026, 9, 10) }))).toBeNull();
    expect(
      entryDate(post({ status: "pending_review", publish_at: localIso(2026, 9, 10) })),
    ).toBeNull();
    expect(entryDate(post({ status: "archived", published_at: localIso(2026, 9, 10) }))).toBeNull();
  });

  it("zwraca null, gdy wpis zaplanowany nie ma jeszcze terminu", () => {
    expect(entryDate(post({ status: "scheduled", publish_at: null }))).toBeNull();
  });
});

describe("dayKey", () => {
  it("formatuje z wiodącymi zerami", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dayKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("liczy dzień LOKALNIE, nie w UTC", () => {
    // Wpis o 23:30 czasu lokalnego należy do TEGO dnia dla redaktora, choć
    // w UTC może już być doba następna. `toISOString().slice(0,10)` pomyliłby
    // się tu o jeden dzień dla każdej strefy na wschód od Greenwich.
    const late = new Date(2026, 6, 1, 23, 30);
    expect(dayKey(late)).toBe("2026-07-01");
  });
});

describe("monthGrid", () => {
  it("zawsze oddaje 6 pełnych tygodni", () => {
    for (let month = 0; month < 12; month++) {
      expect(monthGrid(new Date(2026, month, 1))).toHaveLength(GRID_DAYS);
    }
  });

  it("zaczyna się w poniedziałek dla KAŻDEGO miesiąca roku", () => {
    for (let month = 0; month < 12; month++) {
      const grid = monthGrid(new Date(2026, month, 1));
      expect(grid[0].getDay(), `miesiąc ${month + 1}`).toBe(1);
    }
  });

  it("miesiąc zaczynający się w niedzielę dostaje pełny wiersz poprzedzający", () => {
    // 1 listopada 2026 to niedziela. Przy naiwnym `getDay()` offset wyszedłby 0
    // i siatka zaczęłaby się od tej niedzieli, gubiąc cały tydzień przed nią.
    const first = new Date(2026, 10, 1);
    expect(first.getDay()).toBe(0);
    const grid = monthGrid(first);
    expect(dayKey(grid[0])).toBe("2026-10-26");
    expect(dayKey(grid[6])).toBe("2026-11-01");
  });

  it("miesiąc zaczynający się w poniedziałek nie dostaje pustego wiersza z przodu", () => {
    // 1 czerwca 2026 to poniedziałek - siatka startuje dokładnie od niego.
    const first = new Date(2026, 5, 1);
    expect(first.getDay()).toBe(1);
    expect(dayKey(monthGrid(first)[0])).toBe("2026-06-01");
  });

  it("obejmuje cały miesiąc, także 31-dniowy zaczynający się w niedzielę", () => {
    const grid = monthGrid(new Date(2026, 10, 1));
    const keys = new Set(grid.map(dayKey));
    for (let d = 1; d <= 30; d++) {
      expect(keys.has(`2026-11-${String(d).padStart(2, "0")}`), `dzień ${d}`).toBe(true);
    }
  });

  it("kolejne komórki różnią się dokładnie o jeden dzień (przejście przez granicę miesiąca)", () => {
    const grid = monthGrid(new Date(2026, 0, 1));
    for (let i = 1; i < grid.length; i++) {
      const diff = grid[i].getTime() - grid[i - 1].getTime();
      // Doba w milisekundach z tolerancją na zmianę czasu (siatka trzyma
      // północ lokalną, więc przy przejściu DST doba ma 23 albo 25 godzin).
      expect(diff).toBeGreaterThanOrEqual(23 * 3600_000);
      expect(diff).toBeLessThanOrEqual(25 * 3600_000);
    }
  });
});

describe("gridRange", () => {
  it("górna granica wskazuje dobę PO ostatniej komórce (zapytanie używa `lt`)", () => {
    const grid = monthGrid(new Date(2026, 5, 1));
    const { start, end } = gridRange(grid);
    expect(dayKey(start)).toBe(dayKey(grid[0]));
    // Bez tego przesunięcia wpisy z ostatniego dnia siatki wypadłyby z wyniku.
    expect(dayKey(end)).not.toBe(dayKey(grid[grid.length - 1]));
    expect(end.getTime()).toBeGreaterThan(grid[grid.length - 1].getTime());
  });

  it("nie mutuje ostatniej komórki siatki", () => {
    const grid = monthGrid(new Date(2026, 5, 1));
    const lastBefore = dayKey(grid[grid.length - 1]);
    gridRange(grid);
    expect(dayKey(grid[grid.length - 1])).toBe(lastBefore);
  });
});

describe("groupByDay", () => {
  it("grupuje po dniu i sortuje wpisy w obrębie dnia rosnąco po godzinie", () => {
    const late = post({
      id: "late",
      status: "scheduled",
      publish_at: localIso(2026, 9, 10, 17, 0),
    });
    const early = post({
      id: "early",
      status: "scheduled",
      publish_at: localIso(2026, 9, 10, 6, 0),
    });
    const noon = post({
      id: "noon",
      status: "published",
      published_at: localIso(2026, 9, 10, 12, 0),
    });

    const map = groupByDay([late, noon, early]);
    expect([...map.keys()]).toEqual(["2026-09-10"]);
    expect(map.get("2026-09-10")!.map((p) => p.id)).toEqual(["early", "noon", "late"]);
  });

  it("pomija wpisy bez daty zamiast wrzucać je do przypadkowej komórki", () => {
    const map = groupByDay([
      post({ id: "draft" }),
      post({ id: "sched", status: "scheduled", publish_at: localIso(2026, 9, 10, 9, 0) }),
    ]);
    expect(map.size).toBe(1);
    expect(map.get("2026-09-10")!.map((p) => p.id)).toEqual(["sched"]);
  });

  it("rozdziela wpisy na osobne dni", () => {
    const map = groupByDay([
      post({ id: "a", status: "scheduled", publish_at: localIso(2026, 9, 10, 9, 0) }),
      post({ id: "b", status: "scheduled", publish_at: localIso(2026, 9, 11, 9, 0) }),
    ]);
    expect([...map.keys()].sort()).toEqual(["2026-09-10", "2026-09-11"]);
  });

  it("pusta lista daje pustą mapę, nie wyjątek", () => {
    expect(groupByDay([]).size).toBe(0);
  });
});

describe("canReschedule", () => {
  const publisher = { canPublish: true };
  const writer = { canPublish: false };

  it("REGRESJA: opublikowanego NIE wolno przeciągnąć nawet publikującemu", () => {
    // Nagłówek trasy obiecuje to wprost („re-datowałoby archiwum, sitemapy
    // i feedy - świadomie zablokowane"), ale reguła istniała wyłącznie jako
    // prop `draggable` w komórce dnia; `onDragEnd`, czyli miejsce faktycznego
    // zapisu, nie sprawdzał statusu w ogóle.
    expect(canReschedule(post({ status: "published" }), publisher)).toBe(false);
  });

  it("pozwala planować wpis zaplanowany, szkic i recenzję", () => {
    expect(canReschedule(post({ status: "scheduled" }), publisher)).toBe(true);
    expect(canReschedule(post({ status: "draft" }), publisher)).toBe(true);
    expect(canReschedule(post({ status: "pending_review" }), publisher)).toBe(true);
  });

  it("odmawia roli bez prawa publikacji niezależnie od statusu", () => {
    expect(canReschedule(post({ status: "scheduled" }), writer)).toBe(false);
    expect(canReschedule(post({ status: "draft" }), writer)).toBe(false);
  });

  it("odmawia statusowi spoza workflow (archived)", () => {
    expect(canReschedule(post({ status: "archived" }), publisher)).toBe(false);
  });
});

describe("rescheduleTarget", () => {
  const publisher = { canPublish: true };

  it("zachowuje godzinę i minutę dotychczasowego terminu", () => {
    const outcome = rescheduleTarget(
      post({ status: "scheduled", publish_at: localIso(2026, 9, 10, 14, 45) }),
      "2026-09-17",
      publisher,
    );
    expect(outcome.kind).toBe("reschedule");
    const moved = new Date((outcome as { publishAtIso: string }).publishAtIso);
    expect(dayKey(moved)).toBe("2026-09-17");
    expect(moved.getHours()).toBe(14);
    expect(moved.getMinutes()).toBe(45);
  });

  it("szkic bez terminu dostaje domyślną godzinę publikacji", () => {
    const outcome = rescheduleTarget(post({ status: "draft" }), "2026-09-17", publisher);
    expect(outcome.kind).toBe("reschedule");
    const moved = new Date((outcome as { publishAtIso: string }).publishAtIso);
    expect(moved.getHours()).toBe(DEFAULT_SCHEDULE_HOUR);
    expect(moved.getMinutes()).toBe(0);
  });

  it("upuszczenie na ten sam dzień nie wywołuje zapisu", () => {
    // Pusty UPDATE i tak przeszedłby przez bramkę workflow i bumpnął
    // `updated_at`, fałszując historię edycji wpisu.
    const outcome = rescheduleTarget(
      post({ status: "scheduled", publish_at: localIso(2026, 9, 10, 14, 45) }),
      "2026-09-10",
      publisher,
    );
    expect(outcome).toEqual({ kind: "unchanged" });
  });

  it("odmawia zapisu wpisowi opublikowanemu i roli bez prawa publikacji", () => {
    expect(rescheduleTarget(post({ status: "published" }), "2026-09-17", publisher)).toEqual({
      kind: "denied",
    });
    expect(
      rescheduleTarget(post({ status: "draft" }), "2026-09-17", { canPublish: false }),
    ).toEqual({ kind: "denied" });
  });

  it("odmawia zapisu przy niepoprawnym kluczu dnia zamiast wyprodukować Invalid Date", () => {
    expect(rescheduleTarget(post({ status: "draft" }), "nie-data", publisher)).toEqual({
      kind: "denied",
    });
  });

  it("odmawia zapisu, gdy dotychczasowy termin jest nieparsowalny", () => {
    expect(
      rescheduleTarget(post({ status: "scheduled", publish_at: "🙂" }), "2026-09-17", publisher),
    ).toEqual({ kind: "denied" });
  });

  it("przenosi termin przez granicę miesiąca", () => {
    const outcome = rescheduleTarget(
      post({ status: "scheduled", publish_at: localIso(2026, 1, 31, 7, 15) }),
      "2026-02-01",
      publisher,
    );
    const moved = new Date((outcome as { publishAtIso: string }).publishAtIso);
    expect(dayKey(moved)).toBe("2026-02-01");
    expect(moved.getHours()).toBe(7);
    expect(moved.getMinutes()).toBe(15);
  });
});
