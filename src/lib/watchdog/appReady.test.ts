// FLAGA GOTOWOŚCI APLIKACJI - kontrakt, który przechodzi przez CZTERY granice,
// z których TRZY nie mogą tego modułu zaimportować.
//
// PO CO TEN PLIK POWSTAŁ. `src/lib/watchdog/appReady.ts` nie miał ANI JEDNEGO
// testu - sprawdzone grepem po całym `src/`: jedyne odwołania do
// `markAppReady` / `isAppReady` / `READY_FLAG_KEY` są w kodzie produkcyjnym
// (`routes/__root.tsx:597`, `watchdog/previewWatchdog.ts:146,184`), a sąsiedni
// `previewWatchdog.test.ts` nie dotyka go w ogóle.
//
// DLACZEGO BRAK POKRYCIA JEST TU DROŻSZY NIŻ ZWYKLE. Nazwa `__nesAppReady`
// występuje w repozytorium PIĘĆ razy, a `import` łączy tylko dwa z tych miejsc:
//   1. `lib/watchdog/appReady.ts` - jedyne źródło (`READY_FLAG_KEY`);
//   2. `lib/watchdog/previewWatchdog.ts` - importuje, więc rename go złamie
//      widocznie;
//   3. `lib/observability/bootProbeScript.ts` - flaga siedzi w STRINGU
//      `BOOT_PROBE_SCRIPT`, bo to inline'owy skrypt klasyczny w `<head>`.
//      Żaden import, żaden typ. Rename stałej zostawia tam martwy odczyt;
//   4. `e2e/boot-artifact.spec.ts` - BRAMA HYDRATACJI boot-testu, literał
//      w `page.waitForFunction`, wykonywany w przeglądarce;
//   5. `e2e/boot-timing.spec.ts` - to samo plus akcesor podstawiany
//      `addInitScript`, z którego bierze się CAŁY pomiar czasu do gotowości.
//
// CENA ROZJECHANIA SIĘ TYCH PIĘCIU MIEJSC jest asymetryczna i dlatego groźna:
// aplikacja działa DALEJ (flaga to czysty sygnał), ale `__nesBootDead` zaczyna
// się ustawiać na każdym zdrowym dokumencie, a oba testy artefaktu zawieszają
// się na 60 s i padają z timeoutu, wskazując na „martwą hydratację", której nie
// ma. Czyli: zero objawów w produkcie i fałszywy alarm w bramce - najgorsza
// możliwa kombinacja. Nic w repozytorium tego nie pilnowało; ten plik pilnuje.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { BOOT_PROBE_SCRIPT } from "@/lib/observability/bootProbeScript";

import { isAppReady, markAppReady, READY_FLAG_KEY } from "./appReady";

type ReadyWindow = Window & { __nesAppReady?: boolean };

function w(): ReadyWindow {
  return window as ReadyWindow;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete w().__nesAppReady;
});

describe("READY_FLAG_KEY - kontrakt nazwy przez granice bez importu", () => {
  it("ma DOKŁADNIE tę nazwę, którą znają skrypt sondy i oba testy artefaktu", () => {
    // Literał, nie odwołanie: tu właśnie ma boleć, gdy ktoś zmieni nazwę bez
    // przejścia przez pozostałe cztery miejsca.
    expect(READY_FLAG_KEY).toBe("__nesAppReady");
  });

  it("sonda bootu czyta TĘ SAMĄ nazwę w swoim stringu", () => {
    // `BOOT_PROBE_SCRIPT` to inline'owy skrypt KLASYCZNY - nic go nie typuje,
    // więc jedyna możliwa kontrola jest tekstowa. Bez tej flagi timer sondy
    // uznałby za martwy każdy zdrowy boot (`__nesBootDead` po 15 s).
    expect(BOOT_PROBE_SCRIPT).toContain(READY_FLAG_KEY);
  });

  it("oba testy artefaktu odpytują TĘ SAMĄ nazwę", () => {
    // Testy e2e wykonują się w przeglądarce i nie mają jak zaimportować stałej.
    // Ich rozjechanie się z modułem nie objawia się błędem, tylko 60-sekundowym
    // timeoutem z komunikatem o martwej hydratacji, której nie ma.
    for (const spec of ["e2e/boot-artifact.spec.ts", "e2e/boot-timing.spec.ts"]) {
      const source = readFileSync(resolve(process.cwd(), spec), "utf8");
      expect(source, `${spec} nie odpytuje ${READY_FLAG_KEY}`).toContain(READY_FLAG_KEY);
    }
  });
});

describe("markAppReady / isAppReady", () => {
  it("przed wywołaniem aplikacja NIE jest gotowa", () => {
    expect(isAppReady()).toBe(false);
  });

  it("ustawia flagę i zgłasza gotowość", () => {
    markAppReady();
    expect(w().__nesAppReady).toBe(true);
    expect(isAppReady()).toBe(true);
  });

  it("jest idempotentny - korzeń może zamontować się ponownie", () => {
    markAppReady();
    markAppReady();
    expect(isAppReady()).toBe(true);
  });

  it("wymaga DOKŁADNIE `true`, a nie dowolnej wartości prawdziwej", () => {
    // Porównanie `=== true`, nie truthy. Gdyby cokolwiek innego postawiło tam
    // liczbę albo napis (a nazwa jest globalna na `window`, więc może), sygnał
    // „aplikacja żyje" byłby zmyślony.
    const loose = w() as unknown as Record<string, unknown>;
    loose[READY_FLAG_KEY] = 1;
    expect(isAppReady()).toBe(false);
    loose[READY_FLAG_KEY] = "true";
    expect(isAppReady()).toBe(false);
    loose[READY_FLAG_KEY] = true;
    expect(isAppReady()).toBe(true);
  });

  it("zapis idzie przez PRZYPISANIE WŁAŚCIWOŚCI, więc akcesor go widzi", () => {
    // TO NIE JEST DETAL IMPLEMENTACYJNY, tylko podstawa pomiaru czasu:
    // `e2e/boot-timing.spec.ts` podstawia (przez `addInitScript`, przed
    // pierwszym skryptem dokumentu) akcesor na `window.__nesAppReady`, żeby
    // dostać DOKŁADNY moment gotowości zamiast odpytywania co klatkę.
    // Przejście na `Object.defineProperty(..., { value: true })` albo zapis na
    // innym obiekcie ominęłoby setter, a pomiar zszedłby cicho do wariantu
    // zapasowego o rozdzielczości ~16 ms - bez żadnej porażki testu.
    const observed: boolean[] = [];
    let stored: boolean | undefined;
    Object.defineProperty(window, READY_FLAG_KEY, {
      configurable: true,
      get: () => stored,
      set: (next: boolean) => {
        stored = next;
        observed.push(next);
      },
    });

    markAppReady();

    expect(observed).toEqual([true]);
    // Getter oddaje to, co zapisano - inaczej sonda bootu i watchdog podglądu
    // widziałyby coś innego niż to, co ustawił korzeń.
    expect(isAppReady()).toBe(true);
  });
});

describe("poza przeglądarką (render SSR)", () => {
  it("markAppReady jest no-opem i nie rzuca", () => {
    // Efekt montowania korzenia jest kliencki, ale moduł jest importowany
    // statycznie przez `routes/__root.tsx`, czyli WYKONUJE SIĘ też na serwerze.
    // Rzut przy braku `window` wywróciłby render dokumentu.
    vi.stubGlobal("window", undefined);
    expect(() => markAppReady()).not.toThrow();
  });

  it("isAppReady zwraca false, a nie rzuca", () => {
    vi.stubGlobal("window", undefined);
    expect(isAppReady()).toBe(false);
  });
});
