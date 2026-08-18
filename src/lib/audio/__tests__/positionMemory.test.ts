// Pamięć pozycji odtwarzania narracji artykułu. Reguła decyduje o tym, czy
// czytelnik wróci tam, gdzie skończył, czy na początek 40-minutowego materiału.
//
// Trzy reguły, których złamanie widzi czytelnik:
//
//   1. KLUCZ JEST PER WPIS **I** PER JĘZYK. Jeden wpis ma dwie narracje (PL/EN)
//      o różnej długości; wspólny klucz przenosiłby pozycję z jednej na drugą -
//      czyli wznawiał angielską narrację w miejscu z polskiej.
//   2. USZKODZONY WPIS DAJE 0, NIE NaN. `audio.currentTime = NaN` rzuca, więc
//      jeden ręcznie zepsuty (albo obcięty) wpis w localStorage wywracałby
//      odtwarzanie zamiast po prostu wystartować od początku.
//   3. MATERIAŁ PRAWIE SKOŃCZONY NIE JEST ZAPISYWANY. Inaczej ponowne
//      odtworzenie startowałoby 3 sekundy przed końcem.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  POSITION_END_MARGIN,
  POSITION_MIN_SECONDS,
  POSITION_SAVE_INTERVAL,
  clearStoredPosition,
  isRestorablePosition,
  positionKey,
  readStoredPosition,
  writeStoredPosition,
} from "@/lib/audio/positionMemory";
import { memoryStorage, withStorage } from "@/test/postExperience/fixtures";

const POST = "11111111-1111-1111-1111-111111111111";
const OTHER_POST = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("positionKey - tożsamość materiału", () => {
  it("klucz niesie wpis I język", () => {
    expect(positionKey(POST, "pl")).toBe(`audio-pos:${POST}:pl`);
    expect(positionKey(POST, "en")).toBe(`audio-pos:${POST}:en`);
  });

  it("DWA JĘZYKI tego samego wpisu mają RÓŻNE klucze", () => {
    expect(positionKey(POST, "pl")).not.toBe(positionKey(POST, "en"));
    expect(positionKey(POST, "pl")).toContain(":pl");
  });

  it("dwa wpisy w tym samym języku mają różne klucze", () => {
    expect(positionKey(POST, "pl")).not.toBe(positionKey(OTHER_POST, "pl"));
    expect(positionKey(OTHER_POST, "pl")).toContain(OTHER_POST);
  });

  it("wszystkie klucze mają wspólny prefiks (da się je hurtowo znaleźć)", () => {
    expect(positionKey(POST, "pl").startsWith("audio-pos:")).toBe(true);
    expect(positionKey(OTHER_POST, "en").startsWith("audio-pos:")).toBe(true);
  });
});

describe("readStoredPosition / writeStoredPosition", () => {
  it("zapisuje i odczytuje pozycję w pełnych sekundach", () => {
    const key = positionKey(POST, "pl");
    writeStoredPosition(key, 123.87);
    expect(window.localStorage.getItem(key)).toBe("123");
    expect(readStoredPosition(key)).toBe(123);
  });

  it("BRAK wpisu daje 0", () => {
    expect(readStoredPosition(positionKey(POST, "pl"))).toBe(0);
    expect(window.localStorage.length).toBe(0);
  });

  it("WPIS NIELICZBOWY daje 0, nie NaN (element audio rzuca na NaN)", () => {
    const key = positionKey(POST, "pl");
    window.localStorage.setItem(key, "gdzieś-w-połowie");
    expect(readStoredPosition(key)).toBe(0);
    expect(Number.isNaN(readStoredPosition(key))).toBe(false);
  });

  it("wpis PUSTY, ZEROWY i UJEMNY dają 0", () => {
    const key = positionKey(POST, "pl");
    for (const raw of ["", "0", "-42"]) {
      window.localStorage.setItem(key, raw);
      expect(readStoredPosition(key)).toBe(0);
    }
    expect(readStoredPosition(key)).toBe(0);
  });

  it("wpis `Infinity` daje 0 (nie jest liczbą skończoną)", () => {
    const key = positionKey(POST, "pl");
    window.localStorage.setItem(key, "Infinity");
    expect(readStoredPosition(key)).toBe(0);
    expect(Number.isFinite(readStoredPosition(key))).toBe(true);
  });

  it("pozycja pod jednym kluczem NIE przecieka pod drugi", () => {
    writeStoredPosition(positionKey(POST, "pl"), 300);
    expect(readStoredPosition(positionKey(POST, "en"))).toBe(0);
    expect(readStoredPosition(positionKey(POST, "pl"))).toBe(300);
  });

  it("ZABLOKOWANY MAGAZYN przy zapisie nie rzuca (tryb prywatny, limit)", () => {
    const blocked = memoryStorage({ blockWrites: true });
    withStorage(blocked, () => {
      expect(() => writeStoredPosition(positionKey(POST, "pl"), 120)).not.toThrow();
      expect(readStoredPosition(positionKey(POST, "pl"))).toBe(0);
    });
    expect(window.localStorage.getItem(positionKey(POST, "pl"))).toBeNull();
  });

  it("ZABLOKOWANY MAGAZYN przy odczycie degraduje do 0", () => {
    const hostile = {
      ...memoryStorage(),
      getItem: () => {
        throw new DOMException("SecurityError");
      },
    } as unknown as Storage;
    withStorage(hostile, () => {
      expect(readStoredPosition(positionKey(POST, "pl"))).toBe(0);
      expect(() => readStoredPosition(positionKey(POST, "en"))).not.toThrow();
    });
  });
});

describe("clearStoredPosition", () => {
  it("usuwa zapisaną pozycję (materiał odsłuchany do końca)", () => {
    const key = positionKey(POST, "pl");
    writeStoredPosition(key, 200);
    clearStoredPosition(key);
    expect(readStoredPosition(key)).toBe(0);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("usuwa TYLKO wskazany klucz", () => {
    writeStoredPosition(positionKey(POST, "pl"), 100);
    writeStoredPosition(positionKey(POST, "en"), 200);
    clearStoredPosition(positionKey(POST, "pl"));
    expect(readStoredPosition(positionKey(POST, "pl"))).toBe(0);
    expect(readStoredPosition(positionKey(POST, "en"))).toBe(200);
  });

  it("na nieistniejącym kluczu nie rzuca", () => {
    expect(() => clearStoredPosition(positionKey(POST, "pl"))).not.toThrow();
    expect(window.localStorage.length).toBe(0);
  });

  it("ZABLOKOWANY MAGAZYN nie rzuca", () => {
    const hostile = {
      ...memoryStorage(),
      removeItem: () => {
        throw new DOMException("SecurityError");
      },
    } as unknown as Storage;
    withStorage(hostile, () => {
      expect(() => clearStoredPosition(positionKey(POST, "pl"))).not.toThrow();
    });
    expect(window.localStorage.length).toBe(0);
  });
});

describe("isRestorablePosition - czy warto wznawiać", () => {
  it("OFFSET TRYWIALNY (<= 5 s) nie jest wart zapisu", () => {
    expect(POSITION_MIN_SECONDS).toBe(5);
    expect(isRestorablePosition(0, 600)).toBe(false);
    expect(isRestorablePosition(5, 600)).toBe(false);
  });

  it("sekunda POWYŻEJ progu już jest warta zapisu", () => {
    expect(isRestorablePosition(5.01, 600)).toBe(true);
    expect(isRestorablePosition(6, 600)).toBe(true);
  });

  it("MATERIAŁ PRAWIE SKOŃCZONY (<= 5 s od końca) nie jest wznawiany", () => {
    expect(POSITION_END_MARGIN).toBe(5);
    expect(isRestorablePosition(595, 600)).toBe(false);
    expect(isRestorablePosition(600, 600)).toBe(false);
  });

  it("sekunda przed marginesem końca jeszcze jest wznawiana", () => {
    expect(isRestorablePosition(594.9, 600)).toBe(true);
    expect(isRestorablePosition(300, 600)).toBe(true);
  });

  it("NIEZNANA DŁUGOŚĆ (NaN) nie blokuje zapisu - metadane mogą jeszcze nie być wczytane", () => {
    expect(isRestorablePosition(120, Number.NaN)).toBe(true);
    expect(isRestorablePosition(120, Number.POSITIVE_INFINITY)).toBe(true);
  });

  it("DŁUGOŚĆ ZEROWA (strumień bez metadanych) nie blokuje zapisu", () => {
    expect(isRestorablePosition(120, 0)).toBe(true);
    expect(isRestorablePosition(120, -1)).toBe(true);
  });

  it("materiał KRÓTSZY niż podwójny margines nigdy nie jest wznawiany", () => {
    // 8-sekundowa zajawka: pozycja > 5 s jest jednocześnie <= dur - 5.
    expect(isRestorablePosition(6, 8)).toBe(false);
    expect(isRestorablePosition(3, 8)).toBe(false);
  });

  it("pozycja UJEMNA (zepsuty wpis) nie jest wznawiana", () => {
    expect(isRestorablePosition(-10, 600)).toBe(false);
    expect(isRestorablePosition(-0.1, 600)).toBe(false);
  });
});

describe("throttle zapisu", () => {
  it("odstęp zapisu jest dodatni i mieści się w sekundach, nie w minutach", () => {
    expect(POSITION_SAVE_INTERVAL).toBe(5000);
    expect(POSITION_SAVE_INTERVAL).toBeLessThanOrEqual(10_000);
  });
});
