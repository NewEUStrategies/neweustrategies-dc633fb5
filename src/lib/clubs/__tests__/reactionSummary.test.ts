// Liczba RÓŻNYCH osób pod celem (`countDistinctReactors`).
//
// CO TEN PLIK DOWODZI. Suma reakcji nie jest liczbą ludzi - jedna osoba może
// postawić kilka rodzajów naraz. Funkcja oddaje liczbę osób tylko wtedy, gdy
// jest PEWNA (jeden rodzaj albo kompletna lista twarzy), a w każdym innym
// przypadku `null`, żeby licznik nie zmyślał „i 3 inne osoby".
import { describe, expect, it } from "vitest";
import { CLUB_REACTION_ACTOR_LIMIT, countDistinctReactors } from "@/lib/clubs/reactionSummary";
import type { ClubReactionActor, ClubReactionTally } from "@/lib/clubs/types";

function actor(userId: string | null, kinds: ClubReactionActor["kinds"]): ClubReactionActor {
  return { userId, name: userId, headline: null, avatarUrl: null, slug: null, isMe: false, kinds };
}

describe("countDistinctReactors", () => {
  it("brak reakcji to zero osób", () => {
    expect(countDistinctReactors([], undefined)).toBe(0);
    expect(countDistinctReactors([{ kind: "agree", total: 0, mine: false }], [])).toBe(0);
  });

  it("jeden rodzaj: licznik JEST liczbą osób, także bez listy twarzy", () => {
    expect(countDistinctReactors([{ kind: "insightful", total: 40, mine: false }], undefined)).toBe(
      40,
    );
  });

  it("jedna osoba z dwiema reakcjami to jedna osoba, nie dwie", () => {
    const tallies: ClubReactionTally[] = [
      { kind: "insightful", total: 1, mine: false },
      { kind: "evidence", total: 1, mine: false },
    ];
    expect(countDistinctReactors(tallies, [actor("u1", ["insightful", "evidence"])])).toBe(1);
  });

  it("dwie osoby i cztery reakcje to dwie osoby", () => {
    const tallies: ClubReactionTally[] = [
      { kind: "insightful", total: 2, mine: false },
      { kind: "evidence", total: 2, mine: false },
    ];
    const actors = [
      actor("u1", ["insightful", "evidence"]),
      actor("u2", ["insightful", "evidence"]),
    ];
    expect(countDistinctReactors(tallies, actors)).toBe(2);
  });

  it("kilka rodzajów bez listy twarzy - liczba niepewna", () => {
    const tallies: ClubReactionTally[] = [
      { kind: "insightful", total: 2, mine: false },
      { kind: "agree", total: 1, mine: false },
    ];
    expect(countDistinctReactors(tallies, undefined)).toBeNull();
  });

  it("rodzaj powyżej limitu RPC - lista twarzy niekompletna, liczba niepewna", () => {
    const tallies: ClubReactionTally[] = [
      { kind: "insightful", total: CLUB_REACTION_ACTOR_LIMIT + 1, mine: false },
      { kind: "agree", total: 1, mine: false },
    ];
    expect(countDistinctReactors(tallies, [actor("u1", ["insightful"])])).toBeNull();
  });

  it("anonim trybu poufnego nie da się scalić - liczba niepewna", () => {
    const tallies: ClubReactionTally[] = [
      { kind: "insightful", total: 1, mine: false },
      { kind: "agree", total: 1, mine: false },
    ];
    expect(
      countDistinctReactors(tallies, [actor(null, ["insightful"]), actor(null, ["agree"])]),
    ).toBeNull();
  });

  it("twarze spóźnione względem liczników - najliczniejszy rodzaj jest dolną granicą", () => {
    const tallies: ClubReactionTally[] = [
      { kind: "insightful", total: 3, mine: false },
      { kind: "agree", total: 1, mine: false },
    ];
    expect(countDistinctReactors(tallies, [actor("u1", ["insightful"])])).toBe(3);
  });
});
