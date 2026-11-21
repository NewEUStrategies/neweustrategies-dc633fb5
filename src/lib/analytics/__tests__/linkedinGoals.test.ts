import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LINKEDIN_FUNNEL, LINKEDIN_GOALS, LINKEDIN_GOAL_COUNTING } from "../linkedinGoals";
import { MarketingConfigSchema } from "../config";

const consent = vi.hoisted(() => ({ marketing: true }));
vi.mock("@/lib/ads/consent", () => ({
  hasCategoryConsent: (category: string) => category === "marketing" && consent.marketing,
}));

import {
  __resetLinkedInInsightForTests,
  configureLinkedInConversions,
  installLinkedInAutoGoals,
} from "../linkedinInsightEvents";

describe("lejek LinkedIn w panelu Pixels", () => {
  it("każdy cel stoi w dokładnie jednym etapie lejka", () => {
    const placed = LINKEDIN_FUNNEL.flatMap((group) => group.goals);
    expect([...placed].sort()).toEqual([...LINKEDIN_GOALS].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("etapy idą w kolejności LinkedIn: górny, środkowy, dolny, transakcja", () => {
    expect(LINKEDIN_FUNNEL.map((group) => group.stage)).toEqual([
      "top",
      "middle",
      "bottom",
      "closed",
    ]);
  });

  it("zakup liczy się za każdym razem, wyświetlenie strony raz", () => {
    expect(LINKEDIN_GOAL_COUNTING.purchase).toBe("every");
    expect(LINKEDIN_GOAL_COUNTING.page_view).toBe("one");
  });

  it("ustawienia mają pole na każdy cel", () => {
    const ids = MarketingConfigSchema.parse({}).linkedin_conversions;
    expect(Object.keys(ids).sort()).toEqual([...LINKEDIN_GOALS].sort());
  });
});

describe("installLinkedInAutoGoals", () => {
  let calls: Array<Record<string, unknown> | undefined> = [];
  let stop: () => void = () => undefined;

  beforeEach(() => {
    consent.marketing = true;
    calls = [];
    __resetLinkedInInsightForTests();
    (window as Window & { lintrk?: unknown }).lintrk = (
      _action: string,
      payload?: Record<string, unknown>,
    ) => {
      calls.push(payload);
    };
    configureLinkedInConversions({ download: "111", video_view: "222" });
    calls = [];
    stop = installLinkedInAutoGoals();
  });
  afterEach(() => {
    stop();
    delete (window as Window & { lintrk?: unknown }).lintrk;
    document.body.innerHTML = "";
  });

  const sent = (id: number) => calls.filter((p) => p?.["conversion_id"] === id).length;

  it("pobranie pliku liczy się raz na plik", () => {
    const link = document.createElement("a");
    link.href = "/files/raport.pdf";
    link.addEventListener("click", (e) => e.preventDefault());
    document.body.appendChild(link);
    link.click();
    link.click();
    expect(sent(111)).toBe(1);
  });

  it("zwykły odnośnik nie jest pobraniem", () => {
    const link = document.createElement("a");
    link.href = "/artykuly/strategia";
    link.addEventListener("click", (e) => e.preventDefault());
    document.body.appendChild(link);
    link.click();
    expect(sent(111)).toBe(0);
  });

  it("uruchomienie filmu liczy się raz na film", () => {
    const video = document.createElement("video");
    video.src = "https://example.test/film.mp4";
    document.body.appendChild(video);
    video.dispatchEvent(new Event("play"));
    video.dispatchEvent(new Event("play"));
    expect(sent(222)).toBe(1);
  });

  it("bez zgody marketingowej nic nie idzie", () => {
    consent.marketing = false;
    const video = document.createElement("video");
    video.src = "https://example.test/inny.mp4";
    document.body.appendChild(video);
    video.dispatchEvent(new Event("play"));
    expect(sent(222)).toBe(0);
  });
});
