// Decyzje nakładki reklamowej przyklejonej do dołu ekranu. RYZYKO: każda z tych
// czterech liczb/flag przekłada się wprost na to, czy czytelnik zobaczy reklamę,
// której nie da się zamknąć, czy reklamę, która nie pokaże się nigdy - a obie
// pomyłki są niewidoczne dla tsc i dla recenzji, bo `config` to `jsonb`.
//
// CO TEN PLIK DOWODZI.
//   1. Klucz sesyjny i identyfikator slotu koordynatora są KONTRAKTAMI, nie
//      szczegółem. Zmiana prefiksu klucza = wszyscy, którzy zamknęli nakładkę,
//      dostają ją z powrotem; zmiana `slideupSlotId` = `cancelOverlayRequest`
//      przestaje trafiać we własne żądanie i koordynator zostaje z sierotą
//      w kolejce. Literały zgadzają się dziś - tsc tego nie sprawdzi.
//   2. Domyślne wartości (`?? true`, `?? 3000`) obowiązują przy PUSTYM configu,
//      bo taki jest DEFAULT kolumny `ad_placements.config` ('{}'::jsonb).
//   3. Ujemne opóźnienie jest podciągane do zera, ale NIELICZBOWE daje `NaN` -
//      czyli natychmiastowe wyskoczenie nakładki zamiast opóźnienia wpisanego
//      przez redakcję. To jest defekt (`it.fails`), nie cecha.
//   4. Oba dojścia do `sessionStorage` są opakowane w try/catch, i każde
//      połknięcie błędu ma INNY skutek dla czytelnika: przy odczycie nakładka
//      wraca mimo zamknięcia, przy zapisie zamknięcie nie przeżywa odświeżenia.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Widocznego skutku tych decyzji w DOM (timer,
// przycisk zamknięcia, koordynator) dowodzi
// `src/components/ads/__tests__/FooterSlideup.test.tsx`. Tutaj są wyłącznie
// same decyzje, bez Reacta.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSlideupDismissed,
  markSlideupDismissed,
  slideupDelayMs,
  slideupDismissible,
  slideupSlotId,
  slideupStorageKey,
} from "@/lib/ads/footerSlideup";

describe("footerSlideup - kontrakty kluczy", () => {
  it("klucz sesyjny zamknięcia jest prefiksowany i zawiera id placementu", () => {
    expect(slideupStorageKey("pl-1")).toBe("ad_slideup_dismissed:pl-1");
  });

  it("id slotu koordynatora to 'footer-slideup:<id>' - tym samym napisem anuluje się żądanie", () => {
    expect(slideupSlotId("pl-1")).toBe("footer-slideup:pl-1");
  });

  it("dwa różne placementy nie dzielą ani klucza sesji, ani slotu koordynatora", () => {
    expect(slideupStorageKey("a")).not.toBe(slideupStorageKey("b"));
    expect(slideupSlotId("a")).not.toBe(slideupSlotId("b"));
  });
});

describe("footerSlideup - zamykalność", () => {
  it("pusty config (DEFAULT kolumny) daje nakładkę ZAMYKALNĄ", () => {
    expect(slideupDismissible({})).toBe(true);
  });

  it("dismissible: false wyłącza przycisk zamknięcia", () => {
    expect(slideupDismissible({ dismissible: false })).toBe(false);
  });

  it("dismissible: true nie zmienia domyślnej zamykalności", () => {
    expect(slideupDismissible({ dismissible: true })).toBe(true);
  });

  it("config zapisany jako jsonb 'null' wywraca odczyt - NOT NULL kolumny tego nie łapie", () => {
    // `config jsonb NOT NULL DEFAULT '{}'` przyjmuje wartość JSON `null`,
    // a PostgREST oddaje ją jako `null`. Fakt przypięty, żeby było widać,
    // że brak tu obrony - wyjątek leci z wnętrza useEffect nakładki.
    expect(() => slideupDismissible(null)).toThrow(TypeError);
  });
});

describe("footerSlideup - opóźnienie emisji", () => {
  it("pusty config daje 3000 ms - nakładka nie wyskakuje na wejściu", () => {
    expect(slideupDelayMs({})).toBe(3000);
  });

  it("wartość z panelu jest brana dosłownie", () => {
    expect(slideupDelayMs({ delay_ms: 500 })).toBe(500);
  });

  it("zero jest respektowane jako zero, a nie mylone z brakiem wartości", () => {
    expect(slideupDelayMs({ delay_ms: 0 })).toBe(0);
  });

  it("ujemne opóźnienie jest podciągane do zera (Math.max), nie do domyślnych 3000", () => {
    expect(slideupDelayMs({ delay_ms: -1000 })).toBe(0);
  });

  it("liczba w cudzysłowie nadal działa - Number() ją konwertuje", () => {
    expect(slideupDelayMs({ delay_ms: "1500" as unknown as number })).toBe(1500);
  });

  it("nieliczbowe delay_ms daje NaN (stan faktyczny, przypięty)", () => {
    expect(Number.isNaN(slideupDelayMs({ delay_ms: "wkrótce" as unknown as number }))).toBe(true);
  });

  // DEFEKT. `Number("wkrótce")` to NaN, `Math.max(0, NaN)` to nadal NaN,
  // a `setTimeout(fn, NaN)` odpala się jak z zerem. Redakcja wpisuje opóźnienie
  // słownie, a czytelnik dostaje nakładkę NATYCHMIAST - dokładnie odwrotnie niż
  // brzmiała intencja wpisu. OCZEKIWANE: wartość nie do sparsowania cofa się do
  // domyślnych 3000 ms (tak samo jak brak wartości).
  it.fails("nieliczbowe delay_ms POWINNO cofać się do domyślnych 3000 ms", () => {
    expect(slideupDelayMs({ delay_ms: "wkrótce" as unknown as number })).toBe(3000);
  });
});

describe("footerSlideup - pamięć zamknięcia w sessionStorage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("brak wpisu = nakładka jeszcze niezamknięta", () => {
    expect(isSlideupDismissed("p1")).toBe(false);
  });

  it("markSlideupDismissed zapisuje dokładnie '1' pod kluczem placementu", () => {
    markSlideupDismissed("p1");
    expect(sessionStorage.getItem("ad_slideup_dismissed:p1")).toBe("1");
    expect(isSlideupDismissed("p1")).toBe(true);
  });

  it("zamknięcie jednego placementu nie ucisza drugiego", () => {
    markSlideupDismissed("p1");
    expect(isSlideupDismissed("p2")).toBe(false);
  });

  it("wartość inna niż '1' NIE liczy się jako zamknięcie (kontrakt wartości, nie samego klucza)", () => {
    sessionStorage.setItem("ad_slideup_dismissed:p1", "true");
    expect(isSlideupDismissed("p1")).toBe(false);
  });

  it("wyjątek przy ODCZYCIE (tryb prywatny) = nakładka traktowana jak niezamknięta", () => {
    sessionStorage.setItem("ad_slideup_dismissed:p1", "1");
    vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new DOMException("dostęp do magazynu zablokowany");
    });
    // Czytelnik zamknął nakładkę, ale przeglądarka nie daje odczytać zapisu -
    // reklama wraca. Świadomy kompromis, przypięty, żeby zmiana była widoczna.
    expect(isSlideupDismissed("p1")).toBe(false);
  });

  it("wyjątek przy ZAPISIE nie wywraca zamknięcia, ale nie zostawia śladu", () => {
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new DOMException("przekroczony limit magazynu");
    });
    expect(() => markSlideupDismissed("p1")).not.toThrow();
    vi.restoreAllMocks();
    // Nic nie zostało zapisane: po odświeżeniu nakładka wróci.
    expect(isSlideupDismissed("p1")).toBe(false);
  });
});
