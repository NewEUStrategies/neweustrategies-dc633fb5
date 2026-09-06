// SCHOWEK BUDOWNICZEGO - granica zaufania, ktora dotad nie miala wlasnego testu.
//
// `clipboard.ts` to trzydziesci linii, ktore w raporcie pokrycia wygladaja na
// zamkniete (100% linii), bo `copyToClipboard` i `readClipboard` sa wolane
// z testu haka `useBuilderClipboard` SCIEZKA SZCZESLIWA. Nie ma natomiast ani
// jednego dowodu na to, co robia ODMOWY - a to one sa tu cala wartoscia:
//
// 1. ZAPIS MOZE SIE NIE UDAC. `sessionStorage.setItem` rzuca realnie: przy
//    przekroczeniu limitu (sekcja z obrazami w data-URI potrafi miec megabajty),
//    w trybie prywatnym Safari i przy zablokowanych danych witryny. Produkcja
//    ten wyjatek POLYKA (`catch { /* ignore */ }`), wiec kopiowanie nigdy nie
//    zglasza porazki.
// 2. ODCZYT DOSTAJE DANE, KTORYCH NIE WYPRODUKOWALA TA SESJA. `sessionStorage`
//    jest wspolny dla calego pochodzenia, wiec do klucza `builder.clipboard.v1`
//    moze trafic dowolny string: uciety zapis, koperta ze starego wydania,
//    wpis od innego skryptu. Kazde z tych wejsc musi dac `null`, a nie wyjatek
//    w trakcie wklejania.
//
// GRANICA DOWODU: ten plik pilnuje WYLACZNIE kontraktu `clipboard.ts` (co
// wchodzi do `sessionStorage` i co z niego wraca). Tego, ze wklejona koperta
// jest jeszcze raz przepuszczana przez `safeParseBuilderDoc`, dowodzi
// `src/components/admin/builder/ui/hooks/__tests__/useBuilderClipboard.test.tsx`
// ("wklejenie sanityzuje dokument przy okazji") - i to jest jedyny powod, dla
// ktorego brak walidacji ksztaltu `node` ponizej nie konczy sie awaria kanwy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard, readClipboard, type ClipEnvelope } from "@/lib/builder/clipboard";
import type { ColumnNode, SectionNode, WidgetNode } from "@/lib/builder/types";

const KEY = "builder.clipboard.v1";

const widget = (id: string): WidgetNode => ({ id, kind: "widget", type: "text", content: {} });

const column = (id: string, children: WidgetNode[] = []): ColumnNode => ({
  id,
  kind: "column",
  span: { desktop: 12 },
  children,
});

const section = (id: string, children: ColumnNode[] = []): SectionNode => ({
  id,
  kind: "section",
  children,
});

/**
 * Podstawia w miejsce `sessionStorage` magazyn w pamieci, ktory potrafi
 * ODMOWIC zapisu albo odczytu. Prawdziwego `sessionStorage` happy-dom nie da
 * sie w tym celu podszpiegowac - jest proxy, ktore nie oddaje podmienionej
 * metody z powrotem, wiec atrapa przeciekalaby na kolejne przypadki.
 */
function stubStorage(
  seed: Record<string, string>,
  awaria: { przyZapisie?: () => never; przyOdczycie?: () => never },
): void {
  const dane = new Map(Object.entries(seed));
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string): string | null => {
      awaria.przyOdczycie?.();
      return dane.has(key) ? (dane.get(key) as string) : null;
    },
    setItem: (key: string, value: string): void => {
      awaria.przyZapisie?.();
      dane.set(key, value);
    },
    removeItem: (key: string): void => {
      dane.delete(key);
    },
    clear: (): void => {
      dane.clear();
    },
  });
}

function limitMiejsca(): never {
  throw new DOMException("przekroczono limit miejsca", "QuotaExceededError");
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("copyToClipboard - zapis koperty", () => {
  it("zapisuje koperte pod stalym kluczem, wiec czyta ja rowniez INNA karta", () => {
    // Klucz jest czescia kontraktu miedzy kartami: gdyby byl losowany per
    // instancja buildera, kopiowanie dzialaloby tylko w obrebie jednej karty.
    copyToClipboard({ kind: "widget", node: widget("w1") });

    const raw = sessionStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ kind: "widget", node: widget("w1") });
  });

  it("przechodzi w obie strony dla kazdego z czterech rodzajow wezla", () => {
    const koperty: ClipEnvelope[] = [
      { kind: "widget", node: widget("w1") },
      { kind: "column", node: column("c1", [widget("w1")]) },
      { kind: "inner-section", node: { id: "i1", kind: "inner-section", columns: [column("c1")] } },
      { kind: "section", node: section("s1", [column("c1")]) },
    ];

    for (const koperta of koperty) {
      copyToClipboard(koperta);
      expect(readClipboard()).toEqual(koperta);
    }
  });

  it("nadpisuje poprzednia zawartosc - schowek trzyma DOKLADNIE jeden wezel", () => {
    copyToClipboard({ kind: "widget", node: widget("stary") });
    copyToClipboard({ kind: "widget", node: widget("nowy") });

    expect(readClipboard()?.node.id).toBe("nowy");
  });

  it("nie rzuca, gdy zapis do sessionStorage konczy sie wyjatkiem", () => {
    // Limit miejsca / tryb prywatny / zablokowane dane witryny. Wyjatek
    // wypuszczony z uchwytu klawiatury (Ctrl+C) zabilby cala kanwe, wiec
    // polkniecie go jest tu swiadome - i musi byc przypiete.
    stubStorage({}, { przyZapisie: limitMiejsca });

    expect(() => copyToClipboard({ kind: "widget", node: widget("w1") })).not.toThrow();
  });

  // DEFEKT: NIEUDANE KOPIOWANIE ZOSTAWIA W SCHOWKU POPRZEDNI WEZEL.
  //
  // WEJSCIE: redaktor kopiuje sekcje A (zapis sie udaje), potem kopiuje
  //   sekcje B, przy ktorej `sessionStorage.setItem` rzuca `QuotaExceededError`
  //   (sekcja B niesie obrazy w data-URI i nie miesci sie w limicie).
  // CO PSUJE: `copyToClipboard` (src/lib/builder/clipboard.ts:14-20) lapie
  //   wyjatek pustym `catch` i NIE ROBI NIC WIECEJ - nie zwraca statusu i nie
  //   kasuje klucza. Pod `builder.clipboard.v1` zostaje nietknieta koperta
  //   sekcji A, a wolajacy nie ma zadnego sposobu, zeby dowiedziec sie
  //   o porazce (funkcja zwraca `void`).
  // KONSEKWENCJA: nastepne wklejenie wstawia SEKCJE A. Redaktor widzi, ze
  //   "cos sie wklejilo", wiec nie podejrzewa awarii - i dopiero po publikacji
  //   okazuje sie, ze na stronie stoi duplikat starej sekcji zamiast nowej.
  //   Cicha podmiana tresci jest grozniejsza niz brak reakcji na Ctrl+C, bo
  //   braku reakcji nie da sie przeoczyc, a poprawnie wygladajacego duplikatu
  //   - tak.
  // WYMAGANA POPRAWKA: `copyToClipboard` musi na sciezce bledu usunac klucz
  //   (`sessionStorage.removeItem(KEY)`, sam tez w `try`) i zwrocic informacje
  //   o niepowodzeniu (np. `boolean`), zeby powierzchnia wywolujaca mogla
  //   pokazac komunikat. Wtedy wklejenie po nieudanym kopiowaniu nic nie robi,
  //   zamiast wstawiac cudzy wezel.
  it.fails("DEFEKT: nieudane kopiowanie NIE moze zostawiac w schowku poprzedniego wezla", () => {
    copyToClipboard({ kind: "section", node: section("A", [column("cA")]) });
    const zapisanaSekcjaA = sessionStorage.getItem(KEY) as string;
    stubStorage({ [KEY]: zapisanaSekcjaA }, { przyZapisie: limitMiejsca });

    copyToClipboard({ kind: "section", node: section("B", [column("cB")]) });

    expect(readClipboard()).toBeNull();
  });
});

describe("readClipboard - odmowy na uszkodzonej zawartosci", () => {
  it("pusty schowek daje null", () => {
    expect(readClipboard()).toBeNull();
  });

  it("pusty string pod kluczem daje null bez proby parsowania", () => {
    sessionStorage.setItem(KEY, "");

    expect(readClipboard()).toBeNull();
  });

  it("uszkodzony JSON daje null zamiast wyjatku w trakcie wklejania", () => {
    // Uciety zapis (karta zamknieta w trakcie `setItem`) to najczestsze zrodlo
    // takiej zawartosci. `JSON.parse` rzuca tu skladniowo - wyjatek musi zostac
    // zamieniony na "schowek pusty", inaczej Ctrl+V wywala kanwe.
    sessionStorage.setItem(KEY, '{"kind":"widget","node":{"id":"w1"');

    expect(readClipboard()).toBeNull();
  });

  it("zapisany null (poprawny JSON, pusta wartosc) daje null", () => {
    sessionStorage.setItem(KEY, "null");

    expect(readClipboard()).toBeNull();
  });

  it("wartosc skalarna zamiast koperty daje null", () => {
    sessionStorage.setItem(KEY, "42");

    expect(readClipboard()).toBeNull();
  });

  it("koperta BEZ pola kind daje null", () => {
    sessionStorage.setItem(KEY, JSON.stringify({ node: widget("w1") }));

    expect(readClipboard()).toBeNull();
  });

  it("koperta BEZ pola node daje null", () => {
    sessionStorage.setItem(KEY, JSON.stringify({ kind: "widget" }));

    expect(readClipboard()).toBeNull();
  });

  it("koperta z pustym kind daje null", () => {
    sessionStorage.setItem(KEY, JSON.stringify({ kind: "", node: widget("w1") }));

    expect(readClipboard()).toBeNull();
  });

  it("wyjatek przy samym odczycie z sessionStorage daje null", () => {
    // Przegladarka potrafi rzucic `SecurityError` z `getItem`, gdy uzytkownik
    // zablokowal dane witryny. To ta sama gala `catch`, co uszkodzony JSON,
    // ale INNE wejscie - i tylko ono dowodzi, ze `try` obejmuje rowniez odczyt.
    stubStorage(
      { [KEY]: JSON.stringify({ kind: "widget", node: widget("w1") }) },
      {
        przyOdczycie: () => {
          throw new DOMException("dostep do danych witryny zablokowany", "SecurityError");
        },
      },
    );

    expect(readClipboard()).toBeNull();
  });

  it("STAN FAKTYCZNY: kind spoza katalogu i node niebedacy wezlem przechodza dalej", () => {
    // `readClipboard` sprawdza wylacznie OBECNOSC obu pol - nie sprawdza, czy
    // `kind` jest jednym z czterech rodzajow ani czy `node` ma ksztalt wezla.
    // Trzyma to razem dopiero `safeParseBuilderDoc` po stronie wklejania
    // (dowod: useBuilderClipboard.test.tsx, "wklejenie sanityzuje dokument
    // przy okazji"). Przypiete, zeby usuniecie tamtej sanityzacji nie przeszlo
    // niezauwazone: bez niej TA zawartosc trafia prosto do dokumentu.
    sessionStorage.setItem(KEY, JSON.stringify({ kind: "nieznany-rodzaj", node: 7 }));

    const koperta = readClipboard();

    expect(koperta).toEqual({ kind: "nieznany-rodzaj", node: 7 });
  });
});
