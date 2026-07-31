// Kontrakt harmonogramu doręczeń: progi świeżości, normalizacja wejścia z
// sieci i wykrywanie awarii w wyniku ticku.
//
// Te funkcje decydują, czy operator zobaczy „zastój" zamiast „kolejka pusta",
// więc mają test jednostkowy - regresja tutaj wycisza alarm, którego brak był
// pierwotną przyczyną martwego harmonogramu na produkcji.
import { describe, expect, it } from "vitest";
import {
  countTickFailures,
  isSchedulerAlarming,
  normalizeArmOrigin,
  normalizeSchedulerSource,
  parseSchedulerJob,
  schedulerFreshness,
  SCHEDULER_JOBS,
  SCHEDULER_SOURCES,
} from "../scheduler";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);
const agoMs = (ms: number) => new Date(NOW - ms).toISOString();

describe("schedulerFreshness", () => {
  it("świeży przebieg z ostatnich minut", () => {
    expect(schedulerFreshness(agoMs(30_000), NOW)).toBe("fresh");
    expect(schedulerFreshness(agoMs(5 * 60_000), NOW)).toBe("fresh");
  });

  it("opóźnienie, gdy minutowy cron milczy, a siatka 5-minutowa jeszcze łapie", () => {
    expect(schedulerFreshness(agoMs(7 * 60_000), NOW)).toBe("lagging");
    expect(schedulerFreshness(agoMs(19 * 60_000), NOW)).toBe("lagging");
  });

  it("zastój po przekroczeniu progu", () => {
    expect(schedulerFreshness(agoMs(21 * 60_000), NOW)).toBe("stale");
    expect(schedulerFreshness(agoMs(6 * 60 * 60_000), NOW)).toBe("stale");
  });

  it("brak przebiegu to osobny stan (nieuzbrojony), nie zastój", () => {
    expect(schedulerFreshness(null, NOW)).toBe("never");
    expect(schedulerFreshness(undefined, NOW)).toBe("never");
    expect(schedulerFreshness("", NOW)).toBe("never");
    expect(schedulerFreshness("nie-data", NOW)).toBe("never");
  });

  it("przyjmuje Date i epoch, nie tylko ISO", () => {
    expect(schedulerFreshness(new Date(NOW - 60_000), NOW)).toBe("fresh");
    expect(schedulerFreshness(NOW - 60_000, NOW)).toBe("fresh");
  });

  it("zegar w przyszłości nie jest awarią doręczeń (brak fałszywego alarmu)", () => {
    expect(schedulerFreshness(agoMs(-90 * 60_000), NOW)).toBe("fresh");
  });

  it("alarmuje wyłącznie przy zastoju i braku przebiegów", () => {
    expect(isSchedulerAlarming("fresh")).toBe(false);
    expect(isSchedulerAlarming("lagging")).toBe(false);
    expect(isSchedulerAlarming("stale")).toBe(true);
    expect(isSchedulerAlarming("never")).toBe(true);
  });
});

describe("parseSchedulerJob", () => {
  it("brak wartości i puste wejście to pełny tick", () => {
    expect(parseSchedulerJob(null)).toBe("all");
    expect(parseSchedulerJob(undefined)).toBe("all");
    expect(parseSchedulerJob("   ")).toBe("all");
  });

  it("przyjmuje każdy job z kontraktu, także z szumem w wielkości znaków", () => {
    for (const job of SCHEDULER_JOBS) {
      expect(parseSchedulerJob(job)).toBe(job);
      expect(parseSchedulerJob(` ${job.toUpperCase()} `)).toBe(job);
    }
  });

  it("nieznany job to null - endpoint musi zwrócić 400, nie cicho zrobić 'all'", () => {
    expect(parseSchedulerJob("drop-database")).toBeNull();
    expect(parseSchedulerJob("push;all")).toBeNull();
  });
});

describe("normalizeSchedulerSource", () => {
  it("zna wszystkie źródła z kontraktu DB", () => {
    for (const source of SCHEDULER_SOURCES) {
      expect(normalizeSchedulerSource(source)).toBe(source);
    }
  });

  it("mapuje aliasy i myślnik na kształt z CHECK-a", () => {
    expect(normalizeSchedulerSource("github-actions")).toBe("github_actions");
    expect(normalizeSchedulerSource("GitHub")).toBe("github_actions");
    expect(normalizeSchedulerSource("gha")).toBe("github_actions");
    expect(normalizeSchedulerSource("cron")).toBe("pg_cron");
    expect(normalizeSchedulerSource("postgres")).toBe("pg_cron");
  });

  it("nieznane źródło spada do 'external' (log przyjmuje każdy scheduler)", () => {
    expect(normalizeSchedulerSource("uptime-robot")).toBe("external");
    expect(normalizeSchedulerSource(null)).toBe("external");
    expect(normalizeSchedulerSource("")).toBe("external");
  });
});

describe("normalizeArmOrigin", () => {
  it("zwraca sam origin, bez ścieżki i końcowego ukośnika", () => {
    expect(normalizeArmOrigin("https://neweuropeanstrategies.com/admin/community")).toBe(
      "https://neweuropeanstrategies.com",
    );
    expect(normalizeArmOrigin("https://nes.example:8443/")).toBe("https://nes.example:8443");
  });

  it("odrzuca to, czego cron bazy nie może wołać", () => {
    expect(normalizeArmOrigin("http://neweuropeanstrategies.com")).toBeNull();
    expect(normalizeArmOrigin("https://localhost:8080")).toBeNull();
    expect(normalizeArmOrigin("https://127.0.0.1")).toBeNull();
    expect(normalizeArmOrigin("neweuropeanstrategies.com")).toBeNull();
    expect(normalizeArmOrigin("")).toBeNull();
    expect(normalizeArmOrigin(null)).toBeNull();
  });
});

describe("countTickFailures", () => {
  it("puste, gdy wszystkie joby zwróciły dane", () => {
    expect(
      countTickFailures({
        push: { claimed: 3, sent: 3 },
        eventReminders: 2,
        semanticIndex: { scanned: 0, embedded: 0 },
      }),
    ).toEqual([]);
  });

  it("pominięcia (budżet czasu, cykl pracy) nie są awarią", () => {
    expect(
      countTickFailures({
        digestDaily: { error: "skipped_duty_cycle" },
        linkCheck: { error: "skipped_time_budget" },
      }),
    ).toEqual([]);
  });

  it("realne błędy wracają z nazwą joba - to treść alertu", () => {
    expect(
      countTickFailures({
        push: { error: "claim_push_jobs: permission denied" },
        digestWeekly: { claimed: 0, sent: 0 },
        integrations: { error: "fetch failed" },
      }),
    ).toEqual(["push: claim_push_jobs: permission denied", "integrations: fetch failed"]);
  });

  it("pominięcie push z braku VAPID nie jest błędem joba (osobne pole)", () => {
    expect(
      countTickFailures({ push: { claimed: 0, sent: 0, skipped: "vapid_not_configured" } }),
    ).toEqual([]);
  });
});
