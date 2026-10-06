// Kadrowanie mediów strumienia klubu (`feedMedia.ts`).
//
// CO TEN PLIK DOWODZI.
// (1) Trzy zalecane formaty (1200x627, 1080x1080, 1080x1350) mieszczą się
//     w ramie strumienia BEZ kadrowania - to one wyznaczają przedział 4:5..1.91:1.
// (2) Zdjęcie lekko poza przedziałem jest kadrowane, skrajne (panorama,
//     zrzut długiej strony) - wpisane w całości. Plik bez metadanych dostaje
//     ramę 16:9 i też nie jest obcinany.
// (3) Galeria układa się według PIERWSZEGO zdjęcia, pokazuje najwyżej cztery
//     kafle i liczy nadwyżkę do „+N".
// (4) Podpowiedzi kompozytora są wskazówkami jakości: niska rozdzielczość
//     względem formatu, waga powyżej 5 MB i skrajna proporcja.
import { describe, expect, it } from "vitest";
import {
  CLUB_FEED_RATIO_MAX,
  CLUB_FEED_RATIO_MIN,
  CLUB_POST_IMAGE_FORMATS,
  clubFeedFrame,
  clubImageAdvice,
  clubImageFormat,
  clubMediaRatio,
  planClubGallery,
} from "@/lib/clubs/feedMedia";

const size = (width: number | null, height: number | null) => ({ width, height });

describe("clubFeedFrame", () => {
  it("zalecane formaty wchodzą do strumienia bez kadrowania", () => {
    for (const format of CLUB_POST_IMAGE_FORMATS) {
      const frame = clubFeedFrame(size(format.width, format.height));
      expect(frame.fit).toBe("cover");
      expect(frame.ratio).toBeCloseTo(
        Math.min(CLUB_FEED_RATIO_MAX, format.width / format.height),
        2,
      );
    }
  });

  it("zdjęcie lekko poza przedziałem jest kadrowane do krawędzi przedziału", () => {
    // 0.74 -> rama 4:5, utrata ~8 % - kadrujemy; 0.625 traciłoby 28 % - już nie.
    expect(clubFeedFrame(size(1000, 1350))).toEqual({ ratio: CLUB_FEED_RATIO_MIN, fit: "cover" });
    expect(clubFeedFrame(size(1000, 1600))).toEqual({ ratio: CLUB_FEED_RATIO_MIN, fit: "contain" });
    expect(clubFeedFrame(size(2200, 1000))).toEqual({ ratio: CLUB_FEED_RATIO_MAX, fit: "cover" });
  });

  it("panorama i długi zrzut są wpisywane w całości", () => {
    expect(clubFeedFrame(size(4000, 1000)).fit).toBe("contain");
    expect(clubFeedFrame(size(1000, 4000)).fit).toBe("contain");
  });

  it("plik bez metadanych ma ramę 16:9 i nie jest obcinany", () => {
    expect(clubFeedFrame(size(null, null))).toEqual({ ratio: 16 / 9, fit: "contain" });
    expect(clubFeedFrame(size(0, 600))).toEqual({ ratio: 16 / 9, fit: "contain" });
    expect(clubMediaRatio(size(Number.NaN, 2))).toBeNull();
  });
});

describe("clubImageFormat", () => {
  it("rozpoznaje najbliższy zalecany format", () => {
    expect(clubImageFormat(size(1200, 627))).toBe("landscape");
    expect(clubImageFormat(size(1080, 1080))).toBe("square");
    expect(clubImageFormat(size(1080, 1350))).toBe("portrait");
    expect(clubImageFormat(size(1100, 1000))).toBe("square");
    expect(clubImageFormat(size(null, 1000))).toBeNull();
  });
});

describe("planClubGallery", () => {
  it("brak zdjęć to brak galerii", () => {
    expect(planClubGallery([])).toBeNull();
  });

  it("jedno zdjęcie dziedziczy ramę pojedynczą", () => {
    expect(planClubGallery([size(1080, 1350)])).toEqual({
      layout: "single",
      ratio: 0.8,
      visible: 1,
      overflow: 0,
      fit: "cover",
    });
  });

  it("para: dwa pionowe zachowują 4:5, każda inna para ma kwadratowe kafle", () => {
    expect(planClubGallery([size(1080, 1350), size(800, 1000)])?.ratio).toBe(8 / 5);
    expect(planClubGallery([size(1200, 627), size(1080, 1350)])?.ratio).toBe(2);
  });

  it("poziome pierwsze zdjęcie bierze górny rząd", () => {
    const plan = planClubGallery([size(1200, 627), size(1080, 1080), size(1080, 1080)]);
    expect(plan?.layout).toBe("top");
    expect(plan?.ratio).toBeCloseTo(1.91, 2);
    expect(plan?.visible).toBe(3);
  });

  it("kwadratowe i pionowe pierwsze zdjęcie bierze lewą kolumnę", () => {
    expect(planClubGallery([size(1080, 1080), size(1, 1), size(1, 1)])).toMatchObject({
      layout: "left",
      ratio: 3 / 2,
    });
    expect(planClubGallery([size(1080, 1350), size(1, 1), size(1, 1)])).toMatchObject({
      layout: "left",
      ratio: 6 / 5,
    });
  });

  it("najwyżej cztery kafle, reszta idzie do licznika", () => {
    const seven = Array.from({ length: 7 }, () => size(1200, 627));
    expect(planClubGallery(seven)).toMatchObject({ visible: 4, overflow: 3 });
  });

  it("pierwsze zdjęcie bez metadanych układa galerię poziomo", () => {
    expect(planClubGallery([size(null, null), size(1, 1), size(1, 1)])?.layout).toBe("top");
  });
});

describe("clubImageAdvice", () => {
  it("zdjęcie w zalecanym formacie i wadze nie dostaje uwag", () => {
    expect(clubImageAdvice({ width: 1200, height: 627, size: 400_000 })).toEqual([]);
  });

  it("zgłasza niską rozdzielczość, wagę i skrajną proporcję", () => {
    expect(clubImageAdvice({ width: 640, height: 640, size: 6 * 1024 * 1024 })).toEqual([
      "lowResolution",
      "heavy",
    ]);
    expect(clubImageAdvice({ width: 4000, height: 900, size: 1 })).toEqual(["extremeRatio"]);
  });

  it("bez metadanych ocenia wyłącznie wagę", () => {
    expect(clubImageAdvice({ width: null, height: null, size: 1 })).toEqual([]);
  });
});
