import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-workflows";
import {
  BADGE_STATUSES,
  DELIVERY_STATUSES,
  WORKFLOW_RUN_STATUSES,
  runStatusDescriptor,
} from "../runStatus";

/**
 * Zbiór wartości z CHECK-a `status` dla wskazanej tabeli, czytany WPROST
 * z migracji. Bez tego test porównywałby katalog z jego własną kopią, a to
 * dowodzi wyłącznie tego, że ktoś umie skopiować listę.
 */
function statusCheckValues(migration: string, table: string): string[] {
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
  const tableAt = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${table}`);
  expect(tableAt, `nie znaleziono tabeli ${table} w ${migration}`).toBeGreaterThan(-1);
  const body = sql.slice(tableAt, tableAt + 2000);
  const match = body.match(/status text NOT NULL[^,]*?CHECK \(status IN \(([^)]*)\)\)/s);
  expect(match, `nie znaleziono CHECK-a status dla ${table}`).not.toBeNull();
  return [...match![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("katalog statusów jest LUSTREM CHECK-ów z migracji", () => {
  it("statusy przebiegu przepisu zgadzają się z workflow_runs", () => {
    const fromDb = statusCheckValues("20260711204000_workflow_engine.sql", "workflow_runs");
    expect([...WORKFLOW_RUN_STATUSES].sort()).toEqual([...fromDb].sort());
  });

  it("statusy dostawy zgadzają się z integration_deliveries", () => {
    const fromDb = statusCheckValues(
      "20260711203000_idempotency_and_integration_outbox.sql",
      "integration_deliveries",
    );
    expect([...DELIVERY_STATUSES].sort()).toEqual([...fromDb].sort());
  });

  it("REGRESJA: KAŻDY status dopuszczony przez bazę ma etykietę", () => {
    // Mapa w komponencie znała 'pending' i 'retry' - wartości, których żaden
    // CHECK nie dopuszcza (pozostałość po wcześniejszym kształcie tabeli) -
    // a nie znała 'queued' ani 'delivering', które występują naprawdę. Te dwa
    // trafiały do gałęzi domyślnej, więc polski panel pokazywał surową
    // wartość z bazy zamiast etykiety.
    for (const status of BADGE_STATUSES) {
      const descriptor = runStatusDescriptor(status);
      expect(descriptor.labelKey, `status ${status} bez etykiety`).not.toBeNull();
    }
  });

  it("katalog odznaki nie zna statusów, których baza nie dopuszcza", () => {
    const allowed = new Set<string>([...WORKFLOW_RUN_STATUSES, ...DELIVERY_STATUSES]);
    for (const status of BADGE_STATUSES) {
      expect(allowed.has(status), `status ${status} spoza CHECK-ów`).toBe(true);
    }
    // Wprost: dwa statusy usunięte z mapy nie mogą wrócić bez zmiany CHECK-a.
    expect(runStatusDescriptor("pending").labelKey).toBeNull();
    expect(runStatusDescriptor("retry").labelKey).toBeNull();
  });
});

describe("runStatusDescriptor", () => {
  it("powodzenie jest zielone niezależnie od powierzchni", () => {
    // 'succeeded' opisuje przebieg przepisu, 'delivered' dostawę outboxu -
    // dwa różne słowa na ten sam wynik, więc muszą wyglądać tak samo.
    expect(runStatusDescriptor("succeeded").tone).toBe("success");
    expect(runStatusDescriptor("delivered").tone).toBe("success");
    expect(runStatusDescriptor("succeeded").icon).toBe("check");
    expect(runStatusDescriptor("delivered").icon).toBe("check");
  });

  it("porażka jest czerwona, a stany przejściowe bursztynowe", () => {
    expect(runStatusDescriptor("failed").tone).toBe("danger");
    expect(runStatusDescriptor("queued").tone).toBe("warning");
    expect(runStatusDescriptor("delivering").tone).toBe("warning");
  });

  it("porzucona dostawa nie udaje błędu przejściowego", () => {
    // 'dead' znaczy „nie będzie kolejnej próby" - ton neutralny i czaszka
    // odróżniają ją od 'failed', które jeszcze wróci do kolejki.
    const dead = runStatusDescriptor("dead");
    expect(dead.tone).toBe("neutral");
    expect(dead.icon).toBe("skull");
  });

  it("nieznany status zostaje pokazany surowo, zamiast dostać wymyśloną etykietę", () => {
    const unknown = runStatusDescriptor("cos_nowego_z_migracji");
    expect(unknown.labelKey).toBeNull();
    expect(unknown.tone).toBe("neutral");
  });
});

describe("parytet PL/EN etykiet statusów", () => {
  it.each([...BADGE_STATUSES])("status %s ma tłumaczenie PL i EN, i są różne", (status) => {
    const key = runStatusDescriptor(status).labelKey!;
    const pl = i18n.getFixedT("pl")(key);
    const en = i18n.getFixedT("en")(key);

    // `t()` na brakującym kluczu oddaje sam klucz - to jest test na to,
    // że etykieta faktycznie istnieje w OBU drzewach, a nie tylko w jednym.
    expect(pl, `brak PL dla ${key}`).not.toBe(key);
    expect(en, `brak EN dla ${key}`).not.toBe(key);
    expect(pl).not.toBe("");
    expect(en).not.toBe("");
  });

  it("polskie etykiety są po polsku, nie angielskimi literałami", () => {
    // Cztery z sześciu etykiet były wcześniej wpisane w komponent jako gołe
    // angielskie napisy ("delivered", "pending", "retry", "dead") obok dwóch
    // przetłumaczonych - w polskim panelu dawało to mieszankę dwóch języków
    // w jednej kolumnie tabeli.
    const pl = (key: string) => i18n.getFixedT("pl")(key);
    expect(pl("adminWorkflows.runs.statusDelivered")).toBe("Dostarczone");
    expect(pl("adminWorkflows.runs.statusQueued")).toBe("W kolejce");
    expect(pl("adminWorkflows.runs.statusDelivering")).toBe("Wysyłanie");
    expect(pl("adminWorkflows.runs.statusDead")).toBe("Porzucone");
  });
});
