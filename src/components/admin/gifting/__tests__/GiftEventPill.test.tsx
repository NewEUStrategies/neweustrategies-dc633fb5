// Atom plakietki typu zdarzenia w audycie - CZY AUDYT PRZEŻYJE TYP Z PRZYSZŁOŚCI.
//
// CO TEN PLIK DOWODZI.
//   1. NIEZNANY TYP ZDARZENIA NIE WYWALA RENDERU i nie znika z tabeli: dostaje
//      tonację neutralną i etykietę od wołającego. To jest cały sens tej gałęzi -
//      trigger w bazie może dopisać nowy typ zdarzenia bez wdrożenia frontu,
//      a audyt urwany po cichu jest gorszy niż brak audytu.
//   2. ZNANE TYPY MAJĄ ROZŁĄCZNE TONACJE (pięć typów, pięć klas) - `Record`
//      w typach gwarantuje tylko obecność klucza, nie różność wartości.
//   3. `isKnownEventType` UŻYWA OPERATORA `in`, więc przechodzi ŁAŃCUCH
//      PROTOTYPÓW: zdarzenie o nazwie własności Object.prototype jest uznane za
//      znane, a do className wjeżdża źródło funkcji. Defekt zgłoszony niżej
//      przez it.fails; tsc go nie widzi, bo `type in obj` jest legalnym
//      zawężeniem typu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Tego, że etykietą nieznanego typu jest SUROWY
// `event_type` ze słownika przez `defaultValue` - dowód wymaga PRAWDZIWEGO
// tłumacza (atrapy w repo filtrują `defaultValue`) i stoi w
// `GiftEventRowRealDictionary.test.tsx`.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  EVENT_PILL_CLS,
  GiftEventPill,
  isKnownEventType,
} from "@/components/admin/gifting/atoms/GiftEventPill";

function klasa(type: string): string {
  const { unmount } = render(<GiftEventPill type={type} label={`L-${type}`} />);
  const cls = screen.getByText(`L-${type}`).className;
  unmount();
  return cls;
}

describe("plakietka typu zdarzenia audytu", () => {
  it("zdarzenie NIEZNANE tej wersji buildu renderuje się z tonacją neutralną", () => {
    render(<GiftEventPill type="quota_topped_up" label="quota_topped_up" />);

    const plakietka = screen.getByText("quota_topped_up");
    expect(plakietka.className).toContain(EVENT_PILL_CLS.expired);
  });

  it("nieznany typ NIE podszywa się pod żaden typ znany", () => {
    const nieznany = klasa("quota_topped_up");

    for (const znany of ["created", "redeemed", "revoked", "exhausted"] as const) {
      expect(nieznany).not.toContain(EVENT_PILL_CLS[znany]);
    }
  });

  it("pięć znanych typów ma PIĘĆ różnych tonacji", () => {
    const klasy = Object.values(EVENT_PILL_CLS);

    expect(klasy).toHaveLength(5);
    expect(new Set(klasy).size).toBe(5);
  });

  it("etykieta jedzie do DOM nietknięta - atom nie tłumaczy", () => {
    render(<GiftEventPill type="created" label="cokolwiek podał wołający" />);

    expect(screen.getByText("cokolwiek podał wołający")).toBeTruthy();
  });

  // DEFEKT (usuwa się RAZEM z sąsiednim `it` poniżej po naprawie).
  it.fails("typ zdarzenia o nazwie własności Object.prototype jest UZNANY ZA NIEZNANY", () => {
    // Oczekiwane: `toString` nie jest typem zdarzenia audytu, więc plakietka
    // dostaje tonację neutralną. Naprawa to jedna linia w atomie:
    // Object.prototype.hasOwnProperty.call(EVENT_PILL_CLS, type).
    expect(isKnownEventType("toString")).toBe(false);
    expect(klasa("toString")).toContain(EVENT_PILL_CLS.expired);
  });

  it("STAN FAKTYCZNY: `in` łapie prototyp, więc do className wjeżdża źródło funkcji", () => {
    // Skutek widoczny dla admina jest kosmetyczny (React ustawia className
    // właściwością, więc nie ma wektora XSS), ale gałąź „nieznany typ nie
    // wysypuje renderu" przestaje działać dokładnie dla tych nazw.
    expect(isKnownEventType("toString")).toBe(true);
    expect(klasa("toString")).toContain("native code");
  });
});
