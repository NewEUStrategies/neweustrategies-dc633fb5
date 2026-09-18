// Reguła progu „za mały / za duży plik" przy rekomendacji rozmiaru obrazu.
//
// Testujemy GRANICE, nie środek przedziału: cała wartość tej reguły siedzi
// w tym, gdzie dokładnie kończy się milczenie, a zaczyna ostrzeżenie. Próg
// przesunięty o kilka procent zamienia pomocną podpowiedź w szum, który
// redakcja nauczy się ignorować - razem z ostrzeżeniami prawdziwymi.
import { describe, expect, it } from "vitest";
import {
  RECOMMENDED_SIZE_MAX_SCALE,
  RECOMMENDED_SIZE_MIN_SCALE,
  isImageOversized,
  isImageTooSmall,
} from "../recommendedSize";

const rec = { width: 1000, height: 1000 };

describe("isImageTooSmall", () => {
  it("milczy dla pliku zgodnego z rekomendacją", () => {
    expect(isImageTooSmall({ width: 1000, height: 1000 }, rec)).toBe(false);
    expect(isImageTooSmall({ width: 1600, height: 1600 }, rec)).toBe(false);
  });

  it("milczy dla drobnego niedoboru - ostrzeżenie o 5% byłoby szumem", () => {
    expect(isImageTooSmall({ width: 950, height: 950 }, rec)).toBe(false);
  });

  it("dokładnie na progu jeszcze milczy, poniżej - już nie", () => {
    const edge = rec.width * RECOMMENDED_SIZE_MIN_SCALE;
    expect(isImageTooSmall({ width: edge, height: edge }, rec)).toBe(false);
    expect(isImageTooSmall({ width: edge - 1, height: edge }, rec)).toBe(true);
  });

  it("wystarczy JEDEN wymiar poniżej progu - panorama rozciągnięta w pionie też jest rozmyta", () => {
    expect(isImageTooSmall({ width: 1200, height: 400 }, rec)).toBe(true);
  });

  it("nie orzeka niczego o wymiarach, których nie zna", () => {
    expect(isImageTooSmall({ width: 0, height: 0 }, rec)).toBe(false);
    expect(isImageTooSmall({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(false);
  });
});

describe("isImageOversized", () => {
  it("milczy dla pliku mieszczącego się w dwukrotności rekomendacji", () => {
    const edge = rec.width * RECOMMENDED_SIZE_MAX_SCALE;
    expect(isImageOversized({ width: edge, height: edge }, rec)).toBe(false);
  });

  it("mówi dopiero powyżej tej dwukrotności - rekomendacja SAMA liczy już ekran Retina", () => {
    expect(isImageOversized({ width: 2001, height: 2001 }, rec)).toBe(true);
  });
});
