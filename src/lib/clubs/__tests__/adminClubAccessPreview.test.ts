// Wejście żywego podglądu zakładki „Dostęp": słownik etykiet i próg planu.
//
// CO TEN PLIK DOWODZI.
//   1. PODGLĄD I DROPLISTA MÓWIĄ TO SAMO. Zdanie podglądu bierze etykiety
//      z tych samych prefiksów i18n, z których droplista bierze podpowiedź pod
//      polem. Rozjazd tych dwóch miejsc daje panel, w którym pole opisuje
//      widoczność inaczej niż podgląd - a podgląd jest jedynym miejscem, gdzie
//      administrator widzi ILOCZYN pięciu ustawień.
//   2. ZDANIE SKŁADA SIĘ Z PIĘCIU PÓL, a tryb moderacji do niego NIE wchodzi:
//      moderacja nie zmienia tego, kto klub widzi i kto do niego wchodzi.
//   3. PRÓG PLANU EMITUJE SIĘ TYLKO PRZY REALNEJ ZMIANIE RANGI - a przy randze
//      spoza słownika (ręczny grant) wybór widocznej pozycji zmianą JEST
//      i musi się zapisać.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Kolejności zdań, podmiany `{{rank}}` ani reguł
// ostrzeżeń - to `accessSentence.test.ts`. Odwzorowania ranga -> plan -
// `planTiers.test.ts`. Renderu i wpięcia droplistów - `ClubAccessTab.test.tsx`.
// Tłumaczeń tu nie ma: `translate` jest wstrzykiwane i zwraca własny klucz.
import { describe, expect, it, vi } from "vitest";
import {
  CLUB_ACCESS_I18N,
  clubAccessSentenceInput,
  clubAccessSentenceLabels,
  clubMinTierPatch,
} from "../adminClubAccessPreview";
import type { ClubAccessDraftValues } from "../adminClubEditor";

const DRAFT: ClubAccessDraftValues = {
  visibility: "members",
  joinPolicy: "request",
  minTierRank: 20,
  attributionMode: "attributed",
  whoCanPost: "moderators",
  moderationMode: "trusted",
};

/** Atrapa tłumaczenia - oddaje klucz, więc asercja widzi ŹRÓDŁO napisu. */
const echoKey = (key: string): string => key;

describe("clubAccessSentenceInput", () => {
  it("bierze pięć pól dostępu i pomija tryb moderacji", () => {
    expect(clubAccessSentenceInput(DRAFT)).toEqual({
      visibility: "members",
      joinPolicy: "request",
      attributionMode: "attributed",
      whoCanPost: "moderators",
      minTierRank: 20,
    });
  });

  it("nie gubi rangi zero - „bez wymagań planu” to też ustawienie", () => {
    expect(clubAccessSentenceInput({ ...DRAFT, minTierRank: 0 }).minTierRank).toBe(0);
  });
});

describe("clubAccessSentenceLabels - słownik etykiet", () => {
  it("widoczność i atrybucja biorą PODPOWIEDZI, nie same nazwy pozycji", () => {
    // To jest cała różnica: `club.visibility.public` to „Publiczny", a
    // `club.visibilityHint.public` to zdanie o skutku. W zdaniu podglądu ma
    // stać zdanie o skutku.
    const labels = clubAccessSentenceLabels(0, echoKey);
    expect(labels.visibility.public).toBe("club.visibilityHint.public");
    expect(labels.attribution.chatham).toBe("club.attributionHint.chatham");
  });

  it("polityka wstępu i „kto zakłada temat” biorą nazwy pozycji droplisty", () => {
    const labels = clubAccessSentenceLabels(0, echoKey);
    expect(labels.joinPolicy.open).toBe("club.joinPolicy.open");
    expect(labels.whoCanPost.staff_only).toBe("club.whoCanPost.staff_only");
  });

  it("każdy wymiar ma etykietę na KAŻDĄ swoją wartość - brak jednej to puste zdanie", () => {
    const labels = clubAccessSentenceLabels(20, echoKey);
    expect(Object.keys(labels.visibility).sort()).toEqual([
      "members",
      "private",
      "public",
      "secret",
    ]);
    expect(Object.keys(labels.joinPolicy).sort()).toEqual(["invite", "open", "request"]);
    expect(Object.keys(labels.attribution).sort()).toEqual([
      "anonymous_allowed",
      "attributed",
      "chatham",
    ]);
    expect(Object.keys(labels.whoCanPost).sort()).toEqual(["members", "moderators", "staff_only"]);
  });

  it.each([
    [0, "club.planTierHint.free"],
    [10, "club.planTierHint.plus"],
    [20, "club.planTierHint.pro"],
    [60, "club.planTierHint.presidents_circle"],
    // Ranga z ręcznego grantu degraduje się w dół do najbliższego progu -
    // dokładnie tak, jak wyświetla ją droplista.
    [35, "club.planTierHint.corporate"],
  ])("ranga %i opisuje plan kluczem %s", (rank, expected) => {
    expect(clubAccessSentenceLabels(rank, echoKey).tierRequired).toBe(expected);
  });

  it("zdanie „bez wymagań” jest tłumaczone ZAWSZE, także przy progu > 0", () => {
    // Wyborem między progiem a jego brakiem rządzi `buildAccessSentences`,
    // więc oba fragmenty muszą być gotowe niezależnie od rangi.
    const translate = vi.fn(echoKey);
    const labels = clubAccessSentenceLabels(20, translate);
    expect(labels.tierNone).toBe("adminClubs.accessPreviewNoTier");
    expect(translate).toHaveBeenCalledWith("adminClubs.accessPreviewNoTier");
  });

  it("woła tłumaczenie DOKŁADNIE raz na fragment zdania - 13 pozycji plus dwa progi", () => {
    const translate = vi.fn(echoKey);
    clubAccessSentenceLabels(20, translate);
    expect(translate).toHaveBeenCalledTimes(4 + 3 + 3 + 3 + 2);
  });

  it("prefiksy zdania są TYMI SAMYMI stałymi, których używają droplisty", () => {
    const translate = vi.fn(echoKey);
    clubAccessSentenceLabels(0, translate);
    const keys = translate.mock.calls.map(([key]) => key);
    expect(keys).toContain(`${CLUB_ACCESS_I18N.visibilityHint}.members`);
    expect(keys).toContain(`${CLUB_ACCESS_I18N.joinPolicy}.request`);
    expect(keys).toContain(`${CLUB_ACCESS_I18N.attributionHint}.attributed`);
    expect(keys).toContain(`${CLUB_ACCESS_I18N.whoCanPost}.moderators`);
    // Nazwy pozycji droplisty (bez sufiksu „Hint") do zdania NIE wchodzą.
    expect(keys).not.toContain(`${CLUB_ACCESS_I18N.visibility}.members`);
  });
});

describe("clubMinTierPatch - emisja progu planu", () => {
  it("wybór pozycji odpowiadającej zapisanej randze NIE jest zmianą", () => {
    expect(clubMinTierPatch("pro", 20)).toBeNull();
    expect(clubMinTierPatch("free", 0)).toBeNull();
  });

  it("wybór innego planu emituje jego rangę", () => {
    expect(clubMinTierPatch("vip", 20)).toEqual({ minTierRank: 25 });
    expect(clubMinTierPatch("free", 60)).toEqual({ minTierRank: 0 });
  });

  it("przy randze spoza słownika wybór WIDOCZNEJ pozycji zapisuje realny próg", () => {
    // Ranga 35 wyświetla się jako `corporate` (30). To jest właśnie ten wypadek,
    // w którym „brak zmiany" w interfejsie oznacza obniżenie progu - dlatego
    // łatka MUSI powstać, żeby zapisany stan zgadzał się z tym, co widać.
    expect(clubMinTierPatch("corporate", 35)).toEqual({ minTierRank: 30 });
  });

  it("łatka niesie WYŁĄCZNIE rangę - żadne inne pole dostępu się nie rusza", () => {
    const patch = clubMinTierPatch("partner", 0);
    expect(patch).not.toBeNull();
    expect(Object.keys(patch ?? {})).toEqual(["minTierRank"]);
  });
});
