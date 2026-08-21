// Reguła roboczej listy kompetencji: `isExpertiseDraftFull` i `toggleExpertiseDraft`.
//
// CO TEN PLIK DOWODZI. Trzy przypadki przełącznika, z których TRZECI nie da się
// dowieść z interfejsu: przy dobitym limicie przycisk nieaktywnego obszaru jest
// wyłączony, więc kliknięcie nigdy nie dojdzie do handlera. Reguła „przy limicie
// lista nie zmienia się ani na jotę” musi więc mieć dowód tutaj - inaczej
// pierwsza zmiana w formularzu (np. usunięcie atrybutu `disabled`) po cichu
// wpuściłaby trzynastą deklarację do zapisu, który ZASTĘPUJE cały zbiór.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Formularza `ClubExpertiseEditor` - wyłączanie
// przycisków, zapis i toasty mają dowód w `clubMoleculePanels.test.tsx`. Tu
// jest wyłącznie reguła, bez Reacta.
import { describe, expect, it } from "vitest";
import { CLUB_EXPERTISE_MAX } from "@/lib/clubs/networkTypes";
import { isExpertiseDraftFull, toggleExpertiseDraft } from "@/lib/clubs/expertiseDraft";

describe("isExpertiseDraftFull", () => {
  it.each([
    { ile: 0, pelna: false },
    { ile: CLUB_EXPERTISE_MAX - 1, pelna: false },
    { ile: CLUB_EXPERTISE_MAX, pelna: true },
    // Zbiór dłuższy od limitu bierze się z obniżenia limitu po stronie kodu:
    // stara deklaracja nie może przez to przestać być „pełna”.
    { ile: CLUB_EXPERTISE_MAX + 3, pelna: true },
  ])("$ile deklaracji przy limicie $pelna", ({ ile, pelna }) => {
    const draft = Array.from({ length: ile }, (_, index) => `obszar-${index}`);
    expect(isExpertiseDraftFull(draft)).toBe(pelna);
  });

  it("limit wolno podać jawnie - reguła nie jest przywiązana do stałej", () => {
    expect(isExpertiseDraftFull(["energy", "transport"], 2)).toBe(true);
    expect(isExpertiseDraftFull(["energy"], 2)).toBe(false);
  });
});

describe("toggleExpertiseDraft", () => {
  it("obszar spoza listy dochodzi NA KOŃCU - kolejność klikania, nie katalogu", () => {
    expect(toggleExpertiseDraft(["transport"], "energy", false)).toEqual(["transport", "energy"]);
  });

  it("obszar z listy z niej WYPADA, także przy dobitym limicie", () => {
    expect(toggleExpertiseDraft(["transport", "energy"], "transport", false)).toEqual(["energy"]);
    // Zdjęcie deklaracji jest jedyną drogą wyjścia z limitu - musi działać
    // dokładnie wtedy, gdy dodawanie jest zablokowane.
    expect(toggleExpertiseDraft(["transport", "energy"], "energy", true)).toEqual(["transport"]);
  });

  it("przy limicie nowy obszar NIE wchodzi i wraca TA SAMA tablica", () => {
    const draft = ["transport", "energy"];
    const wynik = toggleExpertiseDraft(draft, "finance", true);
    expect(wynik).toEqual(["transport", "energy"]);
    // Ta sama referencja: React nie przerysowuje formularza po kliknięciu,
    // które niczego nie zmieniło.
    expect(wynik).toBe(draft);
  });

  it("wejście nie jest mutowane - lista robocza to stan Reacta", () => {
    const draft = ["transport"];
    toggleExpertiseDraft(draft, "energy", false);
    toggleExpertiseDraft(draft, "transport", false);
    expect(draft).toEqual(["transport"]);
  });

  it("dwa przełączenia tego samego obszaru wracają do punktu wyjścia", () => {
    const raz = toggleExpertiseDraft(["energy"], "transport", false);
    expect(toggleExpertiseDraft(raz, "transport", false)).toEqual(["energy"]);
  });
});
