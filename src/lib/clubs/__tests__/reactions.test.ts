// Reakcje semantyczne: grupowanie wsadowe i optymistyczne przełączanie.
//
// Sedno: `applyReactionToggle` musi odwzorowywać regułę TRIGGERA w bazie,
// bo inaczej interfejs przez ułamek sekundy pokazuje stan, którego baza nigdy
// nie dopuści - a to najbardziej mylący rodzaj błędu, jaki może zrobić
// optymistyczna aktualizacja.
import { describe, expect, it } from "vitest";
import {
  CLUB_QUALITY_REACTIONS,
  CLUB_REACTION_KINDS,
  CLUB_STANCE_REACTIONS,
  applyReactionToggle,
  groupReactions,
  isStanceReaction,
  type ClubReactionTally,
} from "../types";

describe("słownik reakcji", () => {
  it("dzieli się na rozłączne grupy jakość i stanowisko", () => {
    for (const kind of CLUB_QUALITY_REACTIONS) {
      expect(isStanceReaction(kind), `${kind} nie jest stanowiskiem`).toBe(false);
    }
    for (const kind of CLUB_STANCE_REACTIONS) {
      expect(isStanceReaction(kind), `${kind} jest stanowiskiem`).toBe(true);
    }
  });

  it("ma dokładnie sześć rodzajów - słownik jest zamknięty, nie rozszerzalny", () => {
    expect(CLUB_REACTION_KINDS).toHaveLength(6);
    expect(new Set(CLUB_REACTION_KINDS).size).toBe(6);
  });
});

describe("groupReactions", () => {
  it("grupuje wsadowy wynik po celu", () => {
    const map = groupReactions([
      { target_id: "t1", kind: "insightful", total: 3, mine: true },
      { target_id: "t1", kind: "agree", total: 1, mine: false },
      { target_id: "t2", kind: "thanks", total: 2, mine: false },
    ]);
    expect(map.get("t1")).toHaveLength(2);
    expect(map.get("t2")).toHaveLength(1);
  });

  // Pasek, w którym przyciski skaczą po kliknięciu, jest nieużywalny.
  it("zachowuje stałą kolejność: najpierw jakość, potem stanowisko", () => {
    const map = groupReactions([
      { target_id: "t1", kind: "disagree", total: 1, mine: false },
      { target_id: "t1", kind: "insightful", total: 1, mine: false },
      { target_id: "t1", kind: "agree", total: 1, mine: false },
      { target_id: "t1", kind: "thanks", total: 1, mine: false },
    ]);
    expect(map.get("t1")?.map((r) => r.kind)).toEqual([
      "insightful",
      "thanks",
      "agree",
      "disagree",
    ]);
  });

  it("odsiewa rodzaj spoza słownika zamiast go renderować", () => {
    const map = groupReactions([
      { target_id: "t1", kind: "fire", total: 9, mine: true },
      { target_id: "t1", kind: "insightful", total: 1, mine: false },
    ]);
    expect(map.get("t1")).toHaveLength(1);
    expect(map.get("t1")?.[0].kind).toBe("insightful");
  });
});

describe("applyReactionToggle", () => {
  const insightful1: ClubReactionTally = { kind: "insightful", total: 1, mine: false };

  it("pierwsza reakcja na pustym pasku", () => {
    expect(applyReactionToggle([], "insightful")).toEqual([
      { kind: "insightful", total: 1, mine: true },
    ]);
  });

  it("dołączenie do cudzej reakcji podnosi licznik", () => {
    const out = applyReactionToggle([insightful1], "insightful");
    expect(out).toEqual([{ kind: "insightful", total: 2, mine: true }]);
  });

  it("kliknięcie własnej reakcji ją zdejmuje", () => {
    const out = applyReactionToggle([{ kind: "insightful", total: 2, mine: true }], "insightful");
    expect(out).toEqual([{ kind: "insightful", total: 1, mine: false }]);
  });

  it("zdjęcie ostatniej reakcji usuwa przycisk z paska", () => {
    const out = applyReactionToggle([{ kind: "thanks", total: 1, mine: true }], "thanks");
    expect(out).toEqual([]);
  });

  // TO JEST NAJWAŻNIEJSZY TEST TEGO PLIKU: odwzorowanie triggera
  // club_reactions_stance_exclusive. Baza podmienia stanowisko, więc klient
  // też musi je podmienić - a nie pokazać obu naraz.
  it("postawienie przeciwnego stanowiska PODMIENIA, nie dodaje drugiego", () => {
    const out = applyReactionToggle([{ kind: "agree", total: 3, mine: true }], "disagree");
    const agree = out.find((r) => r.kind === "agree");
    const disagree = out.find((r) => r.kind === "disagree");
    expect(agree).toEqual({ kind: "agree", total: 2, mine: false });
    expect(disagree).toEqual({ kind: "disagree", total: 1, mine: true });
    // Kluczowe: użytkownik nie ma naraz obu stanowisk.
    expect(out.filter((r) => r.mine && isStanceReaction(r.kind))).toHaveLength(1);
  });

  it("cudze przeciwne stanowisko zostaje nietknięte", () => {
    const out = applyReactionToggle([{ kind: "agree", total: 5, mine: false }], "disagree");
    expect(out.find((r) => r.kind === "agree")).toEqual({
      kind: "agree",
      total: 5,
      mine: false,
    });
    expect(out.find((r) => r.kind === "disagree")?.total).toBe(1);
  });

  // Reakcje jakościowe są NIEZALEŻNE - można postawić kilka naraz.
  it("reakcje jakościowe nie wykluczają się wzajemnie", () => {
    let out = applyReactionToggle([], "insightful");
    out = applyReactionToggle(out, "evidence");
    out = applyReactionToggle(out, "thanks");
    expect(out.filter((r) => r.mine)).toHaveLength(3);
  });

  it("stanowisko nie rusza reakcji jakościowych", () => {
    const out = applyReactionToggle(
      [
        { kind: "insightful", total: 2, mine: true },
        { kind: "agree", total: 1, mine: true },
      ],
      "disagree",
    );
    expect(out.find((r) => r.kind === "insightful")).toEqual({
      kind: "insightful",
      total: 2,
      mine: true,
    });
  });

  it("kolejność wynikowa pozostaje stała po każdej operacji", () => {
    let out = applyReactionToggle([], "disagree");
    out = applyReactionToggle(out, "insightful");
    out = applyReactionToggle(out, "thanks");
    const order = out.map((r) => r.kind);
    expect(order.indexOf("insightful")).toBeLessThan(order.indexOf("thanks"));
    expect(order.indexOf("thanks")).toBeLessThan(order.indexOf("disagree"));
  });
});
