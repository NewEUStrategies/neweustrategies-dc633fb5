// Żywy podgląd ustawień dostępu i ostrzeżenia o kombinacjach.
import { describe, expect, it } from "vitest";
import {
  buildAccessSentences,
  detectAccessWarnings,
  type AccessSentenceInput,
  type AccessSentenceLabels,
} from "../accessSentence";

const LABELS: AccessSentenceLabels = {
  visibility: {
    public: "Widoczny dla wszystkich.",
    members: "Widoczny dla zalogowanych.",
    private: "Karta widoczna, treść nie.",
    secret: "Widoczny tylko dla członków.",
  },
  joinPolicy: {
    open: "Wejście otwarte.",
    request: "Wejście na prośbę.",
    invite: "Wejście na zaproszenie.",
  },
  attribution: {
    attributed: "Wypowiedzi podpisane.",
    chatham: "Reguła Chatham House.",
    anonymous_allowed: "Autor decyduje.",
  },
  whoCanPost: {
    members: "Temat zakłada każdy członek.",
    moderators: "Temat zakłada moderator.",
    staff_only: "Temat zakłada redakcja.",
  },
  tierRequired: "Wymaga planu rangi {{rank}}.",
  tierNone: "Bez wymagań planu.",
};

const BASE: AccessSentenceInput = {
  visibility: "members",
  joinPolicy: "request",
  attributionMode: "attributed",
  whoCanPost: "moderators",
  minTierRank: 0,
};

describe("buildAccessSentences", () => {
  it("składa pięć zdań w stałej kolejności odpowiadającej polom formularza", () => {
    const out = buildAccessSentences(BASE, LABELS);
    expect(out).toEqual([
      "Widoczny dla zalogowanych.",
      "Wejście na prośbę.",
      "Bez wymagań planu.",
      "Temat zakłada moderator.",
      "Wypowiedzi podpisane.",
    ]);
  });

  it("podmienia rangę planu w zdaniu o progu", () => {
    const out = buildAccessSentences({ ...BASE, minTierRank: 3 }, LABELS);
    expect(out[2]).toBe("Wymaga planu rangi 3.");
  });

  it("ranga zero to brak wymagań, nie ranga 0", () => {
    const out = buildAccessSentences({ ...BASE, minTierRank: 0 }, LABELS);
    expect(out[2]).toBe("Bez wymagań planu.");
  });
});

describe("detectAccessWarnings", () => {
  it("domyślna kombinacja nie budzi ostrzeżeń", () => {
    expect(detectAccessWarnings(BASE)).toEqual([]);
  });

  // Najczęstsza pomyłka: klub, który miał być dla członków, jest publiczny
  // i wpuszcza każdego bez decyzji człowieka.
  it("ostrzega przy kombinacji publiczny + wejście otwarte", () => {
    expect(detectAccessWarnings({ ...BASE, visibility: "public", joinPolicy: "open" })).toContain(
      "public_open",
    );
  });

  it("ostrzega przy sprzecznej kombinacji ukryty + wejście otwarte", () => {
    expect(detectAccessWarnings({ ...BASE, visibility: "secret", joinPolicy: "open" })).toContain(
      "secret_public_entry",
    );
  });

  it("ostrzega przy Chatham House w klubie publicznym", () => {
    expect(
      detectAccessWarnings({ ...BASE, visibility: "public", attributionMode: "chatham" }),
    ).toContain("chatham_public");
  });

  it("zwraca komplet ostrzeżeń, gdy zachodzi więcej niż jedno", () => {
    const out = detectAccessWarnings({
      ...BASE,
      visibility: "public",
      joinPolicy: "open",
      attributionMode: "chatham",
    });
    expect(out).toContain("public_open");
    expect(out).toContain("chatham_public");
    expect(out).toHaveLength(2);
  });

  // Klub publiczny na zaproszenie to POPRAWNA i częsta kombinacja (publiczna
  // wizytówka zamkniętego grona, V1 §1.1) - nie wolno jej zgłaszać jako błędu.
  it("nie ostrzega przy publiczny + na zaproszenie", () => {
    expect(detectAccessWarnings({ ...BASE, visibility: "public", joinPolicy: "invite" })).toEqual(
      [],
    );
  });
});
