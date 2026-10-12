// Anomalie pomiaru ekspozycji sponsorów (`sponsorExposureAnomalies.ts`, OPS-09).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. FILTR „BEZ GRANICY" IDZIE DO BAZY JAKO NULL zamiast wypaść z wywołania;
//      miejsce na stronie (którego anomalie nie mają) wpada do argumentów.
//   2. ODMOWA BAZY GINIE - błąd RPC ma dojść do panelu jako `Error`.
//   3. OSTRZEŻENIE BEZ SENSU - linia z zerem, powód nieznany frontowi albo
//      liczby z kilku dni rozjechane z sumą.
//   4. ROZJAZD Z BAZĄ - nowa wartość CHECK-a powodów bez etykiety albo
//      etykieta bez wpisu w słowniku PL/EN.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

const {
  ADMIN_ANOMALY_LABEL_KEYS,
  SPONSOR_EXPOSURE_ANOMALY_REASONS,
  fetchSponsorExposureAnomalies,
  isSponsorExposureAnomalyReason,
  summarizeExposureAnomalies,
} = await import("@/lib/events/sponsorExposureAnomalies");
const { adminEventSponsorReportEn, adminEventSponsorReportPl } =
  await import("@/lib/i18n-admin-event-sponsor-report");

const EVENT = "e0000000-0000-4000-8000-000000000001";
const QUERY = { eventId: EVENT, from: null, to: null, placement: null, sponsorId: null } as const;

beforeEach(() => {
  rpc.mockReset();
});

describe("fetchSponsorExposureAnomalies", () => {
  it("filtry null wypadają, podane jadą pod nazwami RPC; miejsce na stronie nie jedzie wcale", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchSponsorExposureAnomalies(QUERY)).resolves.toEqual([]);
    expect(rpc).toHaveBeenLastCalledWith("admin_event_sponsor_exposure_anomalies", {
      p_event_id: EVENT,
    });

    const rows = [{ day: "2099-06-15", reason: "session_cap", hits: 3, sources: 1 }];
    rpc.mockResolvedValueOnce({ data: rows, error: null });
    await expect(
      fetchSponsorExposureAnomalies({
        eventId: EVENT,
        from: "2099-06-01",
        to: "2099-06-30",
        placement: "home_strip",
        sponsorId: "s",
      }),
    ).resolves.toEqual(rows);
    expect(rpc).toHaveBeenLastCalledWith("admin_event_sponsor_exposure_anomalies", {
      p_event_id: EVENT,
      p_from: "2099-06-01",
      p_to: "2099-06-30",
      p_sponsor_id: "s",
    });
  });

  it("odmowa bazy dochodzi jako Error z głową komunikatu", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "forbidden: admin role required" } });
    await expect(fetchSponsorExposureAnomalies(QUERY)).rejects.toThrow(
      "forbidden: admin role required",
    );
  });
});

describe("summarizeExposureAnomalies", () => {
  it("sumuje dni per powód w stałej kolejności; źródła to pary adres x dzień", () => {
    expect(
      summarizeExposureAnomalies([
        { day: "2099-06-16", reason: "invalid_session", hits: 2, sources: 1 },
        { day: "2099-06-15", reason: "session_cap", hits: 250, sources: 1 },
        { day: "2099-06-16", reason: "session_cap", hits: 10, sources: 2 },
        { day: "2099-06-15", reason: "rate_limited", hits: 700, sources: 1 },
      ]),
    ).toEqual([
      { reason: "rate_limited", hits: 700, sources: 1 },
      { reason: "session_cap", hits: 260, sources: 3 },
      { reason: "invalid_session", hits: 2, sources: 1 },
    ]);
  });

  it("zera, liczby spoza sensu i powód nieznany frontowi odpadają", () => {
    expect(
      summarizeExposureAnomalies([
        { day: "2099-06-15", reason: "session_cap", hits: 0, sources: 0 },
        { day: "2099-06-15", reason: "nowy_powod", hits: 5, sources: 1 },
        {
          day: "2099-06-15",
          reason: "rate_limited",
          hits: Number.NaN,
          sources: null as unknown as number,
        },
      ]),
    ).toEqual([]);
    expect(summarizeExposureAnomalies([])).toEqual([]);
  });

  it("strażnik powodu", () => {
    expect(isSponsorExposureAnomalyReason("session_cap")).toBe(true);
    expect(isSponsorExposureAnomalyReason("SESSION_CAP")).toBe(false);
    expect(isSponsorExposureAnomalyReason(7)).toBe(false);
  });
});

describe("parytet z bazą i słownikiem", () => {
  it("powody = CHECK event_sponsor_exposure_anomalies_reason_values (ostatnia definicja)", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const sql = readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => readFileSync(join(dir, file), "utf8"))
      .join("\n");
    const all = [
      ...sql.matchAll(
        /CONSTRAINT\s+event_sponsor_exposure_anomalies_reason_values\s+CHECK\s*\(\s*\w+\s+IN\s*\(([^)]*)\)/gi,
      ),
    ];
    expect(all.length).toBeGreaterThan(0);
    const reasons = all[all.length - 1][1]
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .sort();
    expect(reasons).toEqual([...SPONSOR_EXPOSURE_ANOMALY_REASONS].sort());
  });

  it("każda etykieta powodu i tytuł/podpowiedź ostrzeżenia są w PL i EN", () => {
    const pick = (tree: unknown, key: string): unknown =>
      key
        .split(".")
        .reduce<unknown>(
          (node, part) =>
            node !== null && typeof node === "object"
              ? (node as Record<string, unknown>)[part]
              : undefined,
          tree,
        );
    const keys = [
      ...Object.values(ADMIN_ANOMALY_LABEL_KEYS),
      "adminEventSponsorReport.anomalies.title",
      "adminEventSponsorReport.anomalies.hint",
    ];
    for (const key of keys) {
      expect(typeof pick(adminEventSponsorReportPl, key), `PL ${key}`).toBe("string");
      expect(typeof pick(adminEventSponsorReportEn, key), `EN ${key}`).toBe("string");
    }
  });
});
