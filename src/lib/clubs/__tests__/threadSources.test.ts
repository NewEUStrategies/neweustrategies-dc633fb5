// Kontrakt źródeł wątku: skąd w klubie pochodzi to, co widać w strumieniu.
//
// CO TE TESTY PILNUJĄ. Panel źródeł jest jedyną powierzchnią, która twierdzi
// coś o CAŁYM klubie, patrząc na wycinek listy. Trzy rzeczy muszą być w nim
// prawdziwe, bo inaczej wprowadza w błąd zamiast orientować:
//   * kolejność źródeł ma iść po świeżości, a nie po kolejności wejściowej,
//   * licznik przy dziale ma mówić, ile wątków tego działu NAPRAWDĘ przyszło,
//     a nie ile z nich zmieściło się w panelu,
//   * wątek z działu, którego nie ma w liście działów, ma się pokazać bez
//     koloru - a nie zniknąć.
import { describe, expect, it } from "vitest";
import { buildClubSourceIndex, clubSourceOf, groupClubThreadsBySource } from "../threadSources";
import type { ClubGroupRow, ClubThreadListRow } from "../types";

function group(id: string, extra: Partial<ClubGroupRow> = {}): ClubGroupRow {
  return {
    id,
    slug: id,
    name_pl: `${id} PL`,
    name_en: `${id} EN`,
    icon: "layers",
    accent_color: "#ff0000",
    thread_count: 1,
    can_read: true,
    ...extra,
  } as unknown as ClubGroupRow;
}

function thread(
  id: string,
  groupId: string | null,
  stamp: string,
  extra: Partial<ClubThreadListRow> = {},
): ClubThreadListRow {
  return {
    id,
    slug: id,
    title: `Wątek ${id}`,
    group_id: groupId,
    group_name_pl: groupId === null ? null : `${groupId} z wiersza`,
    group_name_en: groupId === null ? null : `${groupId} from row`,
    created_at: stamp,
    last_reply_at: null,
    reply_count: 0,
    ...extra,
  } as unknown as ClubThreadListRow;
}

const PL = { isPl: true, unassignedLabel: "Poza działami" };

describe("buildClubSourceIndex", () => {
  it("bierze nazwę z języka interfejsu i normalizuje puste akcenty", () => {
    const index = buildClubSourceIndex(
      [group("a", { accent_color: "  ", icon: "" }), group("b")],
      false,
    );
    expect(index.get("a")?.name).toBe("a EN");
    expect(index.get("a")?.accent).toBeNull();
    expect(index.get("a")?.icon).toBeNull();
    expect(index.get("b")?.accent).toBe("#ff0000");
  });

  it("spada na nazwę PL, gdy dział nie ma tłumaczenia EN", () => {
    const index = buildClubSourceIndex([group("a", { name_en: "" })], false);
    expect(index.get("a")?.name).toBe("a PL");
  });
});

describe("clubSourceOf", () => {
  const index = buildClubSourceIndex([group("a")], true);

  it("woli nazwę z listy działów niż nazwę przywiezioną przez wiersz", () => {
    const mark = clubSourceOf(thread("t1", "a", "2026-08-01T10:00:00+00:00"), index, true);
    expect(mark?.name).toBe("a PL");
    expect(mark?.accent).toBe("#ff0000");
  });

  it("pokazuje dział spoza listy po nazwie z wiersza, bez akcentu", () => {
    // Dział prywatny albo taki, którego wołający nie może czytać: nazwa
    // przyjechała z wątkiem, koloru nie ma i nie wolno go zmyślać.
    const mark = clubSourceOf(thread("t1", "obcy", "2026-08-01T10:00:00+00:00"), index, true);
    expect(mark?.name).toBe("obcy z wiersza");
    expect(mark?.id).toBe("obcy");
    expect(mark?.accent).toBeNull();
  });

  it("zwraca null, gdy wiersz nie niesie ani działu, ani jego nazwy", () => {
    expect(clubSourceOf(thread("t1", null, "2026-08-01T10:00:00+00:00"), index, true)).toBeNull();
  });
});

describe("groupClubThreadsBySource", () => {
  it("porządkuje źródła po najświeższym wątku, nie po kolejności wejściowej", () => {
    const sources = groupClubThreadsBySource({
      threads: [
        thread("t1", "a", "2026-08-01T10:00:00+00:00"),
        thread("t2", "b", "2026-08-05T10:00:00+00:00"),
        // Odpowiedź jest świeższa niż założenie wątku - i to ona decyduje.
        thread("t3", "c", "2026-07-01T10:00:00+00:00", {
          last_reply_at: "2026-08-09T10:00:00+00:00",
        }),
      ],
      groups: [group("a"), group("b"), group("c")],
      ...PL,
    });
    expect(sources.map((s) => s.id)).toEqual(["c", "b", "a"]);
  });

  it("liczy WSZYSTKIE wątki źródła z okna, choć pokazuje tylko część", () => {
    const sources = groupClubThreadsBySource({
      threads: [
        thread("t1", "a", "2026-08-01T10:00:00+00:00"),
        thread("t2", "a", "2026-08-02T10:00:00+00:00"),
        thread("t3", "a", "2026-08-03T10:00:00+00:00"),
        thread("t4", "a", "2026-08-04T10:00:00+00:00"),
      ],
      groups: [group("a")],
      maxPerSource: 2,
      ...PL,
    });
    expect(sources[0]?.matched).toBe(4);
    expect(sources[0]?.threads.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("niesie licznik CAŁEGO działu, żeby zgadzał się z liczbą w szynie", () => {
    // Okno listy przyniosło jeden wątek, ale dział ma ich w klubie dwanaście.
    // Panel ma pokazać dwanaście - tę samą liczbę, co drzewo działów.
    const sources = groupClubThreadsBySource({
      threads: [
        thread("t1", "a", "2026-08-01T10:00:00+00:00"),
        thread("t2", null, "2026-08-02T10:00:00+00:00"),
      ],
      groups: [group("a", { thread_count: 12 })],
      ...PL,
    });
    const known = sources.find((s) => s.id === "a");
    expect(known?.threadCount).toBe(12);
    expect(known?.matched).toBe(1);
    // Kubełek bez działu nie ma wiersza w `club_groups`, więc nie ma totalu.
    expect(sources.find((s) => s.id === null)?.threadCount).toBeNull();
  });

  it("zachowuje kolejność wejściową wątków wewnątrz źródła", () => {
    // Wejście jest w porządku "gorące", czyli NIE chronologicznym - panel nie
    // ma prawa go przesortować, bo to ranking, o który poprosił wołający.
    const sources = groupClubThreadsBySource({
      threads: [
        thread("stary", "a", "2026-01-01T10:00:00+00:00"),
        thread("nowy", "a", "2026-08-08T10:00:00+00:00"),
      ],
      groups: [group("a")],
      ...PL,
    });
    expect(sources[0]?.threads.map((t) => t.id)).toEqual(["stary", "nowy"]);
  });

  it("zbiera wątki bez działu w jeden kubełek z podaną etykietą", () => {
    const sources = groupClubThreadsBySource({
      threads: [
        thread("t1", null, "2026-08-01T10:00:00+00:00"),
        thread("t2", null, "2026-08-02T10:00:00+00:00"),
      ],
      groups: [],
      ...PL,
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.id).toBeNull();
    expect(sources[0]?.name).toBe("Poza działami");
    expect(sources[0]?.matched).toBe(2);
  });

  it("oddaje WSZYSTKIE źródła - przycinanie należy do widoku", () => {
    // Limit zaszyty tutaj oddawał listę, po której nie dało się poznać, że coś
    // jeszcze istnieje. Widok przycina i MÓWI, ile schował.
    const sources = groupClubThreadsBySource({
      threads: [
        thread("t1", "a", "2026-08-01T10:00:00+00:00"),
        thread("t2", "b", "2026-08-02T10:00:00+00:00"),
        thread("t3", "c", "2026-08-03T10:00:00+00:00"),
      ],
      groups: [group("a"), group("b"), group("c")],
      ...PL,
    });
    expect(sources.map((s) => s.id)).toEqual(["c", "b", "a"]);
  });

  it("na pustym wejściu zwraca pustą listę, a nie kubełek-widmo", () => {
    expect(groupClubThreadsBySource({ threads: [], groups: [group("a")], ...PL })).toEqual([]);
  });
});
