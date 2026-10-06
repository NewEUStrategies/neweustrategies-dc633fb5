// Czas publikacji pod autorem karty (`ClubFeedTime`).
//
// CO TEN PLIK DOWODZI. Zegar strumienia tyka co 30 s, a wpis bywa świeższy niż
// ostatnie tyknięcie (albo zegar klienta spóźnia się względem serwera). Karta
// nigdy nie może wtedy powiedzieć „za 20 sekund" - punkt odniesienia nie jest
// wcześniejszy niż sam wpis. Tyknięcie zegara odświeża tekst bez przeładowania.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ClubFeedTime } from "@/components/clubs/molecules/ClubFeedCard";
import { CLUB_FEED_CLOCK_TICK_MS } from "@/lib/clubs/feedClock";

const BASE = Date.parse("2026-10-06T10:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ClubFeedTime", () => {
  it("wpis świeższy niż ostatnie tyknięcie to „teraz”, a nie czas w przyszłości", () => {
    const future = new Date(BASE + 20_000).toISOString();
    render(<ClubFeedTime iso={future} lang="pl" />);
    const time = screen.getByText(/./, { selector: "time" });
    expect(time.getAttribute("datetime")).toBe(future);
    expect(time.textContent).not.toMatch(/^za /);
  });

  it("tyknięcie zegara przesuwa czas względny bez przeładowania", () => {
    const iso = new Date(BASE - 30_000).toISOString();
    render(<ClubFeedTime iso={iso} lang="en" />);
    const time = screen.getByText(/./, { selector: "time" });
    const before = time.textContent;

    act(() => vi.advanceTimersByTime(CLUB_FEED_CLOCK_TICK_MS * 4));

    expect(time.textContent).not.toBe(before);
    expect(time.textContent).toMatch(/minute/);
  });
});
