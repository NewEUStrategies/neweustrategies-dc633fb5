// Kadrowanie okładki klubu - wspólna funkcja dla każdej powierzchni.
//
// CO TEN PLIK DOWODZI.
//  1. Normalizacja `cover_position_y`: wartości spoza 0-100 są przycinane,
//     ułamki zaokrąglane, a wszystko, co nie jest skończoną liczbą, schodzi do
//     środka (50) - tak wyglądała okładka przed wprowadzeniem kadrowania.
//  2. `object-position` ma JEDEN zapis (`center <Y>%`), więc nagłówek, atom
//     `ClubCover`, edytor i widżety nie mogą się rozjechać w formacie.
//  3. Pomiar proporcji ramki: element bez wymiarów (poza układem, jsdom) daje
//     proporcję zapasową, a nie `Infinity` czy `NaN` w `aspect-ratio`.
//  4. Proporcje miniatur podglądu są ZGODNE z klasami atomu `ClubCover` -
//     liczby i klasy Tailwinda muszą zostać literałami w dwóch miejscach, więc
//     tylko test pilnuje, że mówią to samo.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { ClubCover } from "@/components/clubs/atoms/ClubCover";
import {
  CLUB_COVER_DEFAULT_POSITION_Y,
  CLUB_COVER_HUB_FALLBACK_RATIO,
  CLUB_COVER_PREVIEW_FRAMES,
  clubCoverObjectPosition,
  measureFrameRatio,
  normalizeClubCoverPositionY,
} from "@/lib/clubs/coverFrame";

function elementWithRect(width: number, height: number): Element {
  const element = document.createElement("div");
  element.getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 }) as DOMRect;
  return element;
}

describe("normalizeClubCoverPositionY", () => {
  it.each([
    [0, 0],
    [37, 37],
    [100, 100],
    [-5, 0],
    [250, 100],
    [33.4, 33],
    [66.5, 67],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeClubCoverPositionY(input)).toBe(expected);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["napis", "30"],
  ])("%s schodzi do środka kadru", (_nazwa, input) => {
    expect(normalizeClubCoverPositionY(input)).toBe(CLUB_COVER_DEFAULT_POSITION_Y);
    expect(CLUB_COVER_DEFAULT_POSITION_Y).toBe(50);
  });
});

describe("clubCoverObjectPosition", () => {
  it("zapisuje kadr jako `center <Y>%`", () => {
    expect(clubCoverObjectPosition(30)).toBe("center 30%");
    expect(clubCoverObjectPosition(null)).toBe("center 50%");
    expect(clubCoverObjectPosition(140)).toBe("center 100%");
  });
});

describe("measureFrameRatio", () => {
  it("oddaje szerokość przez wysokość wyrysowanej ramki", () => {
    expect(measureFrameRatio(elementWithRect(1534, 208))).toBeCloseTo(1534 / 208, 6);
  });

  it.each([
    ["brak elementu", null],
    ["undefined", undefined],
    ["zerowa wysokość", elementWithRect(800, 0)],
    ["zerowa szerokość", elementWithRect(0, 160)],
    ["NaN", elementWithRect(Number.NaN, 160)],
  ])("%s daje proporcję zapasową", (_nazwa, element) => {
    expect(measureFrameRatio(element)).toBe(CLUB_COVER_HUB_FALLBACK_RATIO);
    expect(measureFrameRatio(element, 7)).toBe(7);
  });
});

describe("CLUB_COVER_PREVIEW_FRAMES - parytet z atomem ClubCover", () => {
  const COVER = "https://neweuropeanstrategies.com/media/club-covers/klub/okladka.jpg";

  function ratioOf(key: string): number {
    const frame = CLUB_COVER_PREVIEW_FRAMES.find((f) => f.key === key);
    if (!frame) throw new Error(`brak ramki ${key}`);
    return frame.ratio;
  }

  it("baner: 3:1 na telefonie, 4:1 od `sm`", () => {
    const { container } = render(<ClubCover url={COVER} variant="banner" />);
    const classes = container.firstElementChild?.getAttribute("class") ?? "";
    expect(classes).toContain("aspect-[3/1]");
    expect(classes).toContain("sm:aspect-[4/1]");
    expect(ratioOf("bannerMobile")).toBe(3);
    expect(ratioOf("bannerDesktop")).toBe(4);
  });

  it("kafel katalogu: 16:9", () => {
    const { container } = render(<ClubCover url={COVER} variant="card" />);
    expect(container.firstElementChild?.getAttribute("class")).toContain("aspect-[16/9]");
    expect(ratioOf("card")).toBeCloseTo(16 / 9, 10);
  });

  it("każda miniatura ma osobny klucz etykiety", () => {
    const keys = CLUB_COVER_PREVIEW_FRAMES.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
