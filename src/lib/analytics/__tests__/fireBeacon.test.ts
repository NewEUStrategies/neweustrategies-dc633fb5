// Testy WSPÓLNEJ granicy błędu jednego beacona.
//
// PO CO OSOBNY PLIK, skoro zachowanie tej funkcji dowodzą już testy oba jej
// konsumentów (`googleSourceBadgeAnalytics`, `footerTracking`). Bo tamte
// dowodzą go PRZY OKAZJI - sprawdzają, że awaria jednego kanału nie zabiera
// drugiego, więc padną też wtedy, gdy zmieni się cokolwiek innego w tych
// modułach. Ten plik przypina sam KONTRAKT: co funkcja robi z wyjątkiem,
// ile razy woła nadanie i czego świadomie NIE robi. Regres w kontrakcie ma
// zapalać się tutaj, a nie jako zagadkowa czerwień w dwóch panelach naraz.
import { describe, expect, it, vi } from "vitest";

import { fireBeacon } from "../fireBeacon";

describe("fireBeacon - kontrakt granicy błędu", () => {
  it("wywołuje nadanie DOKŁADNIE raz", () => {
    // Raz, nie zero i nie dwa: granica błędu nie jest ani bramką, ani
    // mechanizmem ponawiania.
    const send = vi.fn();
    fireBeacon(send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("połyka wyjątek nadania - nie wypuszcza go do wołającego", () => {
    // To jest cała treść tej funkcji. Wołający to handler `click` linku
    // i handler `submit` formularza newslettera - wyjątek z analityki
    // zamieniłby nawigację albo zapis na zgłoszenie błędu aplikacji.
    const send = vi.fn(() => {
      throw new Error("sendBeacon: payload too large");
    });
    expect(() => fireBeacon(send)).not.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("połyka też rzut wartością, która nie jest błędem", () => {
    // `gtag` to cudzy kod wstrzyknięty przez CMP - nie ma gwarancji, że rzuca
    // instancją `Error`. `catch` bez parametru łapie każdą wartość i to jest
    // tu potrzebne, a nie kosmetyczne.
    expect(() =>
      fireBeacon(() => {
        throw "gtag not ready";
      }),
    ).not.toThrow();
  });

  it("NIE ponawia nadania po awarii", () => {
    // Świadomy brak: bufor w `track.ts` jest wycinany PRZED wysyłką, więc
    // partia utracona przez rzucający transport jest utracona bezpowrotnie.
    // Ponowienie tutaj dawałoby złudzenie odzyskania danych, których już nie ma.
    const send = vi.fn(() => {
      throw new Error("offline");
    });
    fireBeacon(send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("nie zgłasza awarii do konsoli - cisza jest konwencją tej warstwy", () => {
    // Kanarek konwencji, nie estetyki: log w tym miejscu oznaczałby hałas
    // w konsoli KAŻDEGO odwiedzającego z zablokowanym magazynem. Gdyby ktoś
    // dołożył tu `console.warn` „na czas debugowania”, ten przypadek zapali się
    // zamiast trafić na produkcję.
    const spies = {
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
    };
    try {
      fireBeacon(() => {
        throw new Error("localStorage is not available");
      });
      expect(spies.error).not.toHaveBeenCalled();
      expect(spies.warn).not.toHaveBeenCalled();
      expect(spies.log).not.toHaveBeenCalled();
      expect(spies.debug).not.toHaveBeenCalled();
    } finally {
      for (const spy of Object.values(spies)) spy.mockRestore();
    }
  });

  it("awaria JEDNEGO nadania nie rusza drugiego - dlatego wołamy osobno", () => {
    // Wzorzec, którego wymaga kontrakt: dwa wywołania, nie jeden wspólny `try`.
    // Wspólny blok wokół obu nadań to dokładnie ten defekt, który ta funkcja
    // naprawia - i ten przypadek pokazuje różnicę na tej samej parze atrap.
    const pierwszy = vi.fn(() => {
      throw new Error("magazyn zablokowany");
    });
    const drugi = vi.fn();

    fireBeacon(pierwszy);
    fireBeacon(drugi);

    expect(pierwszy).toHaveBeenCalledTimes(1);
    expect(drugi).toHaveBeenCalledTimes(1);
  });
});
