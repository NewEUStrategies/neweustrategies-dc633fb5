// Kontekst korelacji - id, które łączy kliknięcie z wierszem w domain_events.
// Bez niego optymistyczne mutacje nie mają czego oczekiwać (useEventConfirmedMutation
// wycofa poprawny zapis po timeoucie), a ślad „co się wydarzyło po moim kliknięciu"
// przestaje istnieć.
//
// Dwie rzeczy nie były tu mierzone i obie psują się CICHO:
//
//   1. FALLBACK generatora id dla środowisk bez `crypto.randomUUID`. Nagłówek
//      wychodzi zawsze; jeśli fallback zbuduje ciąg, którego kolumna `uuid`
//      w bazie nie przyjmie, emiter zapisze NULL i potwierdzenia przestaną
//      działać dla całej klasy klientów - a testy z `crypto` w środowisku
//      nigdy tej gałęzi nie odwiedzają.
//   2. STOS zagnieżdżonych kontekstów. Gdyby to była pojedyncza zmienna,
//      wewnętrzne wywołanie kasowałoby id zewnętrznego i dalsze żądania tej
//      samej operacji leciałyby bez nagłówka.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORRELATION_HEADER,
  currentCorrelationId,
  newCorrelationId,
  runWithCorrelation,
} from "@/lib/realtime/correlationContext";

// Kanoniczny kształt UUID v4 z wariantem RFC 4122 zaszytym w fallbacku ("a").
const UUID_V4_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Stos żyje w module - test, który zostawi na nim id, zafałszuje następny.
  expect(currentCorrelationId()).toBeNull();
});

describe("CORRELATION_HEADER", () => {
  it("jest dokładnie nagłówkiem, który czytają emitery w bazie", () => {
    // Triggery DB czytają `request.headers ->> 'x-correlation-id'`. Zmiana tej
    // stałej po jednej stronie zrywa ślad, nie psując żadnego typu.
    expect(CORRELATION_HEADER).toBe("x-correlation-id");
  });
});

describe("newCorrelationId - ścieżka natywna", () => {
  it("deleguje do crypto.randomUUID, gdy jest dostępne", () => {
    const randomUUID = vi.fn(() => "0189d1f0-1111-4222-a333-444455556666");
    vi.stubGlobal("crypto", { randomUUID });

    expect(newCorrelationId()).toBe("0189d1f0-1111-4222-a333-444455556666");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("w normalnym środowisku zwraca poprawny UUID v4", () => {
    expect(newCorrelationId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("newCorrelationId - fallback bez crypto.randomUUID", () => {
  it("działa, gdy globalne crypto nie istnieje w ogóle", () => {
    vi.stubGlobal("crypto", undefined);
    expect(newCorrelationId()).toMatch(UUID_V4_SHAPE);
  });

  it("działa, gdy crypto istnieje, ale nie ma randomUUID (starsze przeglądarki)", () => {
    // Dokładnie ten przypadek: `crypto.getRandomValues` jest od dawna, a
    // `randomUUID` doszło znacznie później i nie ma go w kontekstach
    // niezabezpieczonych (http bez TLS).
    vi.stubGlobal("crypto", { getRandomValues: () => undefined });
    expect(newCorrelationId()).toMatch(UUID_V4_SHAPE);
  });

  it("trzyma wersję 4 i wariant RFC także przy skrajnych losowaniach", () => {
    // Wersja i wariant są WPISANE na stałe, nie losowane - kolumna `uuid`
    // w Postgresie przyjmie tylko poprawnie zbudowany ciąg.
    vi.stubGlobal("crypto", undefined);
    vi.spyOn(Math, "random").mockReturnValue(0);
    // Bez `padStart(4, "0")` zerowe losowanie dałoby "0-0-40-a0-000" -
    // kształt, którego baza nie przyjmie, a JS-owi nic nie zgłosi.
    expect(newCorrelationId()).toBe("00000000-0000-4000-a000-000000000000");

    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    expect(newCorrelationId()).toBe("fffefffe-fffe-4ffe-affe-fffefffefffe");
  });

  it("kolejne wywołania dają RÓŻNE identyfikatory", () => {
    // Powtórzony id sklejałby dwie niezależne mutacje: potwierdzenie jednej
    // zamykałoby oczekiwanie drugiej i UI utrwalałby zapis, który nie doszedł.
    vi.stubGlobal("crypto", undefined);
    const generated = new Set(Array.from({ length: 200 }, () => newCorrelationId()));
    expect(generated.size).toBe(200);
  });
});

describe("currentCorrelationId / runWithCorrelation", () => {
  it("poza kontekstem zwraca null", () => {
    expect(currentCorrelationId()).toBeNull();
  });

  it("wystawia id WEWNĄTRZ wywołania i sprząta po powrocie", async () => {
    const seen: Array<string | null> = [];
    const result = await runWithCorrelation("id-zewnetrzny", async () => {
      seen.push(currentCorrelationId());
      return "wynik";
    });

    expect(result).toBe("wynik");
    expect(seen).toEqual(["id-zewnetrzny"]);
    expect(currentCorrelationId()).toBeNull();
  });

  it("zagnieżdżenie NIE gubi identyfikatora zewnętrznego", async () => {
    // To jest cały powód, dla którego stoi tu stos, a nie zmienna: mutacja
    // wołająca inną operację z własnym id musi po powrocie nadal stemplować
    // swoje żądania swoim identyfikatorem.
    const seen: Array<string | null> = [];
    await runWithCorrelation("zewnetrzny", async () => {
      seen.push(currentCorrelationId());
      await runWithCorrelation("wewnetrzny", async () => {
        seen.push(currentCorrelationId());
      });
      seen.push(currentCorrelationId());
    });

    expect(seen).toEqual(["zewnetrzny", "wewnetrzny", "zewnetrzny"]);
    expect(currentCorrelationId()).toBeNull();
  });

  it("zdejmuje id ze stosu także wtedy, gdy funkcja RZUCI", async () => {
    // Bez `finally` pierwszy błąd sieci zostawiłby id na stosie na zawsze,
    // a każde kolejne żądanie w tej karcie szłoby ze stemplem cudzej operacji.
    await expect(
      runWithCorrelation("id-z-bledem", async () => {
        throw new Error("serwer odmówił");
      }),
    ).rejects.toThrow("serwer odmówił");

    expect(currentCorrelationId()).toBeNull();
  });

  it("rzut z wnętrza zagnieżdżenia przywraca id zewnętrzne", async () => {
    const seen: Array<string | null> = [];
    await runWithCorrelation("zewnetrzny", async () => {
      await expect(
        runWithCorrelation("wewnetrzny", async () => {
          throw new Error("bum");
        }),
      ).rejects.toThrow("bum");
      seen.push(currentCorrelationId());
    });

    expect(seen).toEqual(["zewnetrzny"]);
  });

  it("ten sam identyfikator zagnieżdżony dwa razy zdejmuje się raz na wywołanie", async () => {
    const seen: Array<string | null> = [];
    await runWithCorrelation("ten-sam", async () => {
      await runWithCorrelation("ten-sam", async () => undefined);
      // Gdyby sprzątanie usuwało PIERWSZE wystąpienie zamiast ostatniego,
      // wynik byłby ten sam; gdyby usuwało wszystkie - tu byłby już null.
      seen.push(currentCorrelationId());
    });

    expect(seen).toEqual(["ten-sam"]);
    expect(currentCorrelationId()).toBeNull();
  });

  it("zakończenie w INNEJ kolejności niż start zdejmuje własne id, nie wierzchołek", async () => {
    // Dwie operacje w locie naraz (dwa kliknięcia) kończą się w kolejności
    // odpowiedzi serwera, nie wywołania. Sprzątanie przez `pop()` zdjęłoby
    // wtedy cudze id i druga operacja dokończyłaby się bez stempla.
    // `runWithCorrelation` woła `fn()` SYNCHRONICZNIE, a executor obietnicy też
    // biegnie od razu - więc po obu wywołaniach mamy w ręku dwa zwolnienia
    // w kolejności startu.
    const releases: Array<() => void> = [];
    const start = (correlationId: string) =>
      runWithCorrelation(
        correlationId,
        () =>
          new Promise<void>((resolve) => {
            releases.push(resolve);
          }),
      );

    const first = start("pierwszy");
    const second = start("drugi");
    expect(releases).toHaveLength(2);
    expect(currentCorrelationId()).toBe("drugi");

    releases[0]();
    await first;
    expect(currentCorrelationId()).toBe("drugi");

    releases[1]();
    await second;
    expect(currentCorrelationId()).toBeNull();
  });
});
