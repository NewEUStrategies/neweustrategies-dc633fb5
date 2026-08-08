// Kontrakt strumienia huba.
//
// CO TE TESTY PILNUJĄ. Kolejność w strumieniu jest jedyną rzeczą, której
// użytkownik nie może sam poprawić: jeśli karta kontekstowa wyląduje nie tam,
// gdzie powinna, wygląda to jak awaria, a nie jak decyzja. Dlatego przeplot
// jest czystą funkcją i ma tu opisane WSZYSTKIE swoje przypadki brzegowe -
// łącznie z tym najważniejszym, czyli klubem, który dopiero powstał.
import { describe, expect, it } from "vitest";
import { buildClubFeed, CLUB_FEED_MODES, type ClubFeedMode } from "../clubFeed";
import type { ClubThreadListRow } from "../types";
import type { ClubDocumentRow, ClubEventRow, ClubMilestoneRow } from "../workspaceTypes";

function threads(count: number): ClubThreadListRow[] {
  return Array.from(
    { length: count },
    (_, i) => ({ id: `t${i}`, title: `Wątek ${i}` }) as ClubThreadListRow,
  );
}

function documents(count: number): ClubDocumentRow[] {
  return Array.from({ length: count }, (_, i) => ({ id: `d${i}` }) as ClubDocumentRow);
}

function events(count: number): ClubEventRow[] {
  return Array.from({ length: count }, (_, i) => ({ id: `e${i}` }) as ClubEventRow);
}

function milestones(states: readonly string[]): ClubMilestoneRow[] {
  return states.map((state, i) => ({ id: `m${i}`, state }) as ClubMilestoneRow);
}

/** Pozycje (0-indeksowane) kart innych niż wątek. */
function contextPositions(entries: ReturnType<typeof buildClubFeed>): number[] {
  return entries.flatMap((entry, index) => (entry.kind === "thread" ? [] : [index]));
}

const EMPTY = { threads: [], documents: [], events: [], milestones: [] };

describe("buildClubFeed - tryb `all`", () => {
  it("wstawia karty kontekstowe na umówionych pozycjach", () => {
    const feed = buildClubFeed({
      mode: "all",
      threads: threads(12),
      documents: documents(5),
      events: events(3),
      milestones: milestones(["active"]),
    });

    // Wydarzenie po 2. wątku, dokumenty po 5., etap po 9. - licząc w WĄTKACH,
    // więc w wyjściu przesuwają się o liczbę wstawionych wcześniej kart.
    expect(feed[2]?.kind).toBe("event");
    expect(feed[6]?.kind).toBe("documents");
    expect(feed[11]?.kind).toBe("milestone");
    expect(feed).toHaveLength(15);
  });

  it("żadne dwie karty kontekstowe nie stoją obok siebie", () => {
    const feed = buildClubFeed({
      mode: "all",
      threads: threads(12),
      documents: documents(3),
      events: events(1),
      milestones: milestones(["active"]),
    });
    const positions = contextPositions(feed);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]! - positions[i - 1]!).toBeGreaterThan(1);
    }
  });

  it("pomija kartę źródła, które nie ma treści", () => {
    const feed = buildClubFeed({
      mode: "all",
      threads: threads(12),
      documents: [],
      events: events(2),
      milestones: [],
    });
    expect(feed.filter((e) => e.kind === "documents")).toHaveLength(0);
    expect(feed.filter((e) => e.kind === "milestone")).toHaveLength(0);
    expect(feed.filter((e) => e.kind === "event")).toHaveLength(1);
  });

  // NAJWAŻNIEJSZY przypadek: klub, który dopiero powstał. Kontekst jest wtedy
  // CAŁĄ treścią, jaka istnieje, i ukrycie go zostawiłoby pustą stronę.
  it("dowozi kontekst także wtedy, gdy wątków jest mniej niż pozycji", () => {
    const feed = buildClubFeed({
      mode: "all",
      threads: threads(1),
      documents: documents(2),
      events: events(1),
      milestones: milestones(["planned"]),
    });
    expect(feed.map((e) => e.kind)).toEqual(["thread", "event", "documents", "milestone"]);
  });

  it("klub bez wątków, ale z terminem, NIE jest pusty", () => {
    const feed = buildClubFeed({
      ...EMPTY,
      mode: "all",
      events: events(1),
    });
    expect(feed).toHaveLength(1);
    expect(feed[0]?.kind).toBe("event");
  });

  it("klub bez niczego daje pusty strumień", () => {
    expect(buildClubFeed({ ...EMPTY, mode: "all" })).toEqual([]);
  });

  it("karta dokumentów bierze najwyżej trzy pozycje", () => {
    const feed = buildClubFeed({ ...EMPTY, mode: "all", documents: documents(9) });
    const card = feed.find((e) => e.kind === "documents");
    expect(card?.kind === "documents" && card.documents).toHaveLength(3);
  });

  // Etap zamknięty nie jest kontekstem dla nowej rozmowy - szukamy aktywnego,
  // a dopiero w jego braku zaplanowanego.
  it("bierze etap aktywny przed zaplanowanym i pomija zamknięty", () => {
    const active = buildClubFeed({
      ...EMPTY,
      mode: "all",
      milestones: milestones(["done", "planned", "active"]),
    });
    const entry = active[0];
    expect(entry?.kind === "milestone" && entry.milestone.id).toBe("m2");

    const planned = buildClubFeed({
      ...EMPTY,
      mode: "all",
      milestones: milestones(["done", "planned"]),
    });
    const fallback = planned[0];
    expect(fallback?.kind === "milestone" && fallback.milestone.id).toBe("m1");

    const closed = buildClubFeed({ ...EMPTY, mode: "all", milestones: milestones(["done"]) });
    expect(closed).toEqual([]);
  });

  it("bierze NAJBLIŻSZY termin, a nie dowolny", () => {
    const feed = buildClubFeed({ ...EMPTY, mode: "all", events: events(4) });
    const entry = feed[0];
    expect(entry?.kind === "event" && entry.event.id).toBe("e0");
  });
});

describe("buildClubFeed - tryby dedykowane", () => {
  it("`threads` oddaje wyłącznie wątki, bez kontekstu", () => {
    const feed = buildClubFeed({
      mode: "threads",
      threads: threads(3),
      documents: documents(5),
      events: events(5),
      milestones: milestones(["active"]),
    });
    expect(feed).toHaveLength(3);
    expect(feed.every((e) => e.kind === "thread")).toBe(true);
  });

  // W trybie dedykowanym paczka byłaby UKRYWANIEM treści, po którą użytkownik
  // świadomie przełączył widok - stąd jeden dokument na kartę.
  it("`documents` rozbija paczkę na pojedyncze karty", () => {
    const feed = buildClubFeed({ ...EMPTY, mode: "documents", documents: documents(5) });
    expect(feed).toHaveLength(5);
    for (const entry of feed) {
      expect(entry.kind === "documents" && entry.documents).toHaveLength(1);
    }
  });

  it("`calendar` oddaje wszystkie terminy", () => {
    const feed = buildClubFeed({ ...EMPTY, mode: "calendar", events: events(4) });
    expect(feed).toHaveLength(4);
    expect(feed.every((e) => e.kind === "event")).toBe(true);
  });
});

describe("klucze wpisów", () => {
  it("są unikatowe w każdym trybie", () => {
    for (const mode of CLUB_FEED_MODES) {
      const feed = buildClubFeed({
        mode: mode satisfies ClubFeedMode,
        threads: threads(12),
        documents: documents(6),
        events: events(4),
        milestones: milestones(["active", "planned"]),
      });
      const keys = feed.map((e) => e.key);
      expect(new Set(keys).size, `tryb ${mode}`).toBe(keys.length);
    }
  });

  // Klucz paczki niesie identyfikatory, więc dojście nowego dokumentu
  // przemontuje kartę zamiast domalować wiersz w starej.
  it("klucz paczki dokumentów zmienia się wraz z jej zawartością", () => {
    const before = buildClubFeed({ ...EMPTY, mode: "all", documents: documents(3) })[0]?.key;
    const after = buildClubFeed({
      ...EMPTY,
      mode: "all",
      documents: [{ id: "nowy" } as ClubDocumentRow, ...documents(2)],
    })[0]?.key;
    expect(before).not.toBe(after);
  });
});
