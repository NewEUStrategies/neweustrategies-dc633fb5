// Scalanie dwoch warstw wyszukiwania.
//
// Warstwa semantyczna klubow istniala od PR 197 - tabela embeddingow, batch
// w jobs-tick, indeks IVFFlat i RPC - i nie miala ani jednego wolajacego.
// Te testy pilnuja REGULY SCALANIA, ktora decyduje, co czytelnik zobaczy na
// gorze: dosłowne trafienie bije podobienstwo, a duplikat nie wystepuje dwa razy.
import { describe, expect, it } from "vitest";
import {
  mergeClubSearchResults,
  toClubSearchResult,
  toClubSemanticResult,
  type ClubSearchHit,
  type ClubSemanticHit,
} from "../types";

function textHit(id: string, overrides: Partial<ClubSearchHit> = {}): ClubSearchHit {
  return {
    thread_id: id,
    thread_slug: `watek-${id}`,
    title: `Wątek ${id}`,
    kind: "discussion",
    club_id: "club-1",
    club_slug: "klub",
    club_name_pl: "Klub",
    club_name_en: "Club",
    reply_count: 3,
    last_reply_at: "2026-08-01T00:00:00Z",
    rank: 0.9,
    snippet: "fragment <b>frazy</b>",
    ...overrides,
  };
}

function semanticHit(id: string, overrides: Partial<ClubSemanticHit> = {}): ClubSemanticHit {
  return {
    thread_id: id,
    thread_slug: `watek-${id}`,
    title: `Wątek ${id}`,
    kind: "position",
    club_id: "club-1",
    club_slug: "klub",
    club_name_pl: "Klub",
    club_name_en: "Club",
    reply_count: 7,
    last_reply_at: "2026-08-02T00:00:00Z",
    similarity: 0.42,
    ...overrides,
  };
}

describe("mapowanie warstw na wiersz wyniku", () => {
  it("trafienie pełnotekstowe niesie fragment i znacznik 'text'", () => {
    const row = toClubSearchResult(textHit("a"));
    expect(row.match).toBe("text");
    expect(row.snippet).toBe("fragment <b>frazy</b>");
  });

  it("trafienie semantyczne nie udaje, że ma fragment", () => {
    const row = toClubSemanticResult(semanticHit("b"));
    expect(row.match).toBe("semantic");
    expect(row.snippet).toBeNull();
  });
});

describe("scalanie", () => {
  it("dosłowne trafienie stoi przed podobieństwem", () => {
    const merged = mergeClubSearchResults([textHit("a")], [semanticHit("b")]);
    expect(merged.map((r) => r.thread_id)).toEqual(["a", "b"]);
  });

  // Ten sam wątek trafiony obiema drogami to JEDEN wynik - i to w wersji
  // pełnotekstowej, bo tylko ona niesie fragment z podświetleniem, czyli dowód
  // dla czytelnika, dlaczego wiersz tu jest.
  it("wątek trafiony dwiema drogami wychodzi raz, w wersji z fragmentem", () => {
    const merged = mergeClubSearchResults([textHit("a")], [semanticHit("a"), semanticHit("c")]);
    expect(merged.map((r) => r.thread_id)).toEqual(["a", "c"]);
    expect(merged[0].match).toBe("text");
    expect(merged[0].snippet).not.toBeNull();
  });

  it("limit obowiązuje po scaleniu, nie osobno dla każdej warstwy", () => {
    const merged = mergeClubSearchResults(
      [textHit("a"), textHit("b")],
      [semanticHit("c"), semanticHit("d")],
      3,
    );
    expect(merged).toHaveLength(3);
    expect(merged.map((r) => r.thread_id)).toEqual(["a", "b", "c"]);
  });

  it("brak warstwy semantycznej daje czysty wynik pełnotekstowy", () => {
    const merged = mergeClubSearchResults([textHit("a")], []);
    expect(merged).toHaveLength(1);
    expect(merged[0].match).toBe("text");
  });

  // Bramka AI bywa niedostępna, a wtedy FTS nic nie znajduje dla frazy opisowej.
  // Pusty wynik jest wtedy poprawny - byle nie wywracał scalania.
  it("obie warstwy puste dają pustą listę, a nie wyjątek", () => {
    expect(mergeClubSearchResults([], [])).toEqual([]);
  });
});
